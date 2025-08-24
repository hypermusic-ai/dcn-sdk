# tests/test_client_unittest.py
from __future__ import annotations

import os
import sys
import types
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import httpx

# Ensure eth_account import in dcn.client won't fail (used only for typing here)
try:
    import eth_account  # type: ignore
except Exception:  # pragma: no cover
    eth_account = ModuleType("eth_account")
    class Account: ...
    eth_account.Account = Account
    sys.modules["eth_account"] = eth_account


# ---------- Helpers to stub the generated client & ops ----------

class FakeClient:
    def __init__(self, *, base_url: str, verify_ssl: bool, timeout: float):
        self.base_url = base_url
        self.verify_ssl = verify_ssl
        self.timeout = timeout
        self.client = httpx.Client()

class FakeAuthClient(FakeClient):
    def __init__(self, *, base_url: str, token: str, verify_ssl: bool, timeout: float):
        super().__init__(base_url=base_url, verify_ssl=verify_ssl, timeout=timeout)
        self.token = token

def make_sync_module(handler):
    """
    Create a module exposing a 'sync(client=..., **kwargs)' function that dispatches to handler.
    """
    m = ModuleType("op_sync")
    m.calls = []
    def sync(*, client, **kwargs):
        m.calls.append(("sync", kwargs))
        return handler(m, client, **kwargs)
    m.sync = sync
    return m

def make_sync_detailed_module(handler):
    """
    Create a module exposing 'sync_detailed(client=..., **kwargs)'.
    """
    m = ModuleType("op_sync_detailed")
    m.calls = []
    def sync_detailed(*, client, **kwargs):
        m.calls.append(("sync_detailed", kwargs))
        return handler(m, client, **kwargs)
    m.sync_detailed = sync_detailed
    return m

class DummyResp:
    def __init__(self, status_code: int, parsed=None, content=b""):
        self.status_code = status_code
        self.parsed = parsed
        self.content = content


class TestDcnSDKClient(unittest.TestCase):
    def setUp(self):
        # Clean env between tests
        os.environ.pop("DCN_API_BASE", None)

        # Import and patch dcn.client to use our fakes
        import dcn.client as client_mod
        self.client_mod = client_mod

        # Patch generated client classes with fakes
        self._p1 = patch.object(client_mod, "_GenClient", FakeClient)
        self._p2 = patch.object(client_mod, "_GenAuthClient", FakeAuthClient)
        self._p1.start()
        self._p2.start()
        self.addCleanup(self._p1.stop)
        self.addCleanup(self._p2.stop)

        # Make model classes trivial so we don't depend on the real generated models
        class _Model:
            def __init__(self, *a, **k):
                self.args = a
                self.kwargs = k
        self._p3 = patch.object(client_mod, "AuthRequest", _Model)
        self._p4 = patch.object(client_mod, "RefreshRequest", _Model)
        self._p3.start(); self._p4.start()
        self.addCleanup(self._p3.stop); self.addCleanup(self._p4.stop)

    # ---------- Unit tests for helpers ----------

    def test_encode_ranges(self):
        m = self.client_mod
        self.assertEqual(m._encode_ranges([(1,2),(3,4)]), "[(1;2)(3;4)]")
        self.assertEqual(m._encode_ranges([]), "[]")

    def test_resolve_op_success_and_failure(self):
        m = self.client_mod
        modname_ok = "dcn.dcn_api_client.api.version.get_version"
        good = make_sync_module(lambda mod, c, **kw: "1.2.3")
        with patch.dict(sys.modules, {modname_ok: good}):
            resolved = m._resolve_op(["does.not.exist", modname_ok])
            self.assertIs(resolved, good)
        with self.assertRaises(ImportError):
            m._resolve_op(["x.y.z.not_here", "also.missing"])

    # ---------- SDK initialization & transport injection ----------

    def test_init_uses_default_base_and_authclient_when_token(self):
        m = self.client_mod
        s = m.Client(access_token="abc123")
        self.assertIsInstance(s._client, FakeAuthClient)
        self.assertEqual(s._client.base_url, m.DEFAULT_BASE)

    def test_init_uses_env_base_when_set(self):
        m = self.client_mod
        with patch.dict(os.environ, {"DCN_API_BASE": "https://custom.base/"}):
            s = m.Client()
            self.assertIsInstance(s._client, FakeClient)
            self.assertEqual(s._client.base_url, "https://custom.base")

    def test_transport_injection_replaces_httpx_client(self):
        m = self.client_mod
        transport = httpx.MockTransport(lambda r: httpx.Response(204))
        s = m.Client(transport=transport)
        # new httpx.Client should be created carrying our transport
        self.assertIs(getattr(s._client.client, "_transport"), transport)

    # ---------- Tokens flow ----------

    def test_set_tokens_rebuilds_client_and_sets_refresh(self):
        m = self.client_mod
        s = m.Client()
        self.assertIsInstance(s._client, FakeClient)  # unauth initially
        s._set_tokens("new_access", "new_refresh")
        self.assertIsInstance(s._client, FakeAuthClient)
        self.assertEqual(s.access_token, "new_access")
        self.assertEqual(s.refresh_token, "new_refresh")

    # ---------- _call behavior: sync path ----------

    def test_call_sync_raises_without_refresh_on_401(self):
        m = self.client_mod

        def handler(mod, client, **kw):
            req = httpx.Request("GET", "https://x")
            resp = httpx.Response(401, request=req)
            raise httpx.HTTPStatusError("unauth", request=req, response=resp)

        modname = "dcn.dcn_api_client.api.version.get_version"
        with patch.dict(sys.modules, {modname: make_sync_module(handler)}):
            s = m.Client(access_token="tok")  # but no refresh token to auto-refresh
            with self.assertRaises(httpx.HTTPStatusError):
                s.version()

    def test_call_sync_auto_refresh_and_retry(self):
        m = self.client_mod
        calls = {"version": 0, "refresh": 0}

        def version_handler(mod, client, **kw):
            calls["version"] += 1
            if calls["version"] == 1:
                req = httpx.Request("GET", "https://x")
                resp = httpx.Response(401, request=req)
                raise httpx.HTTPStatusError("unauth", request=req, response=resp)
            return "ok"

        def refresh_handler(mod, client, **kw):
            calls["refresh"] += 1
            return {"access_token": "new123"}

        with patch.dict(sys.modules, {
            "dcn.dcn_api_client.api.version.get_version": make_sync_module(version_handler),
            "dcn.dcn_api_client.api.auth.post_refresh": make_sync_module(refresh_handler),
        }):
            s = m.Client(access_token="old", refresh_token="rftok")
            out = s.version()
            self.assertEqual(out, "ok")
            self.assertEqual(calls["version"], 2)
            self.assertEqual(calls["refresh"], 1)
            self.assertEqual(s.access_token, "new123")

    # ---------- _call behavior: sync_detailed path ----------

    def test_call_sync_detailed_auto_refresh_and_retry(self):
        m = self.client_mod
        calls = {"version": 0, "refresh": 0}

        def version_detailed_handler(mod, client, **kw):
            calls["version"] += 1
            if calls["version"] == 1:
                return DummyResp(401, parsed=None, content=b"expired")
            return DummyResp(200, parsed="v1.0")

        def refresh_handler(mod, client, **kw):
            calls["refresh"] += 1
            return {"access_token": "xyz"}

        with patch.dict(sys.modules, {
            "dcn.dcn_api_client.api.version.get_version": make_sync_detailed_module(version_detailed_handler),
            "dcn.dcn_api_client.api.auth.post_refresh": make_sync_module(refresh_handler),
        }):
            s = m.Client(access_token="old", refresh_token="rftok")
            out = s.version()
            self.assertEqual(out, "v1.0")
            self.assertEqual(calls["version"], 2)
            self.assertEqual(calls["refresh"], 1)
            self.assertEqual(s.access_token, "xyz")

    # ---------- Auth flows ----------

    def test_login_with_account_happy_path_dict_nonce(self):
        m = self.client_mod

        with patch.dict(sys.modules, {
            "dcn.dcn_api_client.api.auth.get_nonce": make_sync_module(lambda mod, c, **kw: {"nonce": "hello"}),
            "dcn.dcn_api_client.api.auth.post_auth": make_sync_module(lambda mod, c, **kw: {"access_token": "A", "refresh_token": "R"}),
        }):
            with patch.object(m, "sign_login_nonce", lambda account, nonce: ("<message>", "<sig>")):
                s = m.Client()
                acct = SimpleNamespace(address="0xabc")
                resp = s.login_with_account(acct)
                self.assertEqual(resp["access_token"], "A")
                self.assertEqual(resp["refresh_token"], "R")
                self.assertEqual(s.access_token, "A")
                self.assertEqual(s.refresh_token, "R")
                self.assertIsInstance(s._client, FakeAuthClient)

    def test_login_with_account_attr_nonce(self):
        m = self.client_mod

        class NonceObj:
            def __init__(self): self.nonce = "hi"

        with patch.dict(sys.modules, {
            "dcn.dcn_api_client.api.auth.get_nonce": make_sync_module(lambda mod, c, **kw: NonceObj()),
            "dcn.dcn_api_client.api.auth.post_auth": make_sync_module(lambda mod, c, **kw: {"access_token": "X", "refresh_token": "Y"}),
        }):
            with patch.object(m, "sign_login_nonce", lambda a, n: ("msg", "sig")):
                s = m.Client()
                resp = s.login_with_account(SimpleNamespace(address="0xdef"))
                self.assertEqual(resp["access_token"], "X")
                self.assertEqual(s.access_token, "X")

    def test_refresh_requires_tokens(self):
        m = self.client_mod
        s = m.Client()
        with self.assertRaises(RuntimeError):
            s.refresh()

    # ---------- Public endpoints wiring ----------

    def test_account_info_wires_params_and_returns_value(self):
        m = self.client_mod
        seen = {}
        def handler(mod, client, *, address, limit, page):
            seen.update(address=address, limit=limit, page=page)
            return {"ok": True}

        with patch.dict(sys.modules, {
            "dcn.dcn_api_client.api.account.get_account_info": make_sync_module(handler)
        }):
            s = m.Client()
            out = s.account_info("0xabc", limit=5, page=2)
            self.assertEqual(out, {"ok": True})
            self.assertEqual(seen, {"address": "0xabc", "limit": 5, "page": 2})

    def test_feature_get_by_name_and_version_switches_ops(self):
        m = self.client_mod
        m_by_name = make_sync_module(lambda mod, c, **kw: ("by_name", kw))
        m_by_name_ver = make_sync_module(lambda mod, c, **kw: ("by_name_version", kw))
        with patch.dict(sys.modules, {
            "dcn.dcn_api_client.api.feature.get_feature_by_name": m_by_name,
            "dcn.dcn_api_client.api.feature.get_feature_by_name_version": m_by_name_ver,
        }):
            s = m.Client()
            out1 = s.feature_get("F")
            out2 = s.feature_get("F", "1.0.0")
            self.assertEqual(out1[0], "by_name")
            self.assertEqual(out1[1]["feature_name"], "F")
            self.assertEqual(out2[0], "by_name_version")
            self.assertEqual(out2[1]["feature_version"], "1.0.0")

    def test_feature_post_passes_json_body(self):
        m = self.client_mod
        seen = {}
        def handler(mod, client, *, json_body):
            seen["json_body"] = json_body
            return {"ok": True}
        with patch.dict(sys.modules, {
            "dcn.dcn_api_client.api.feature.post_feature": make_sync_module(handler)
        }):
            s = m.Client()
            out = s.feature_post({"x": 1})
            self.assertEqual(out, {"ok": True})
            self.assertEqual(seen["json_body"], {"x": 1})

    def test_transformation_get_and_post(self):
        m = self.client_mod
        m_by_name = make_sync_module(lambda mod, c, **kw: ("t_by_name", kw))
        m_by_name_ver = make_sync_module(lambda mod, c, **kw: ("t_by_name_version", kw))
        m_post = make_sync_module(lambda mod, c, **kw: ("t_post", kw))
        with patch.dict(sys.modules, {
            "dcn.dcn_api_client.api.transformation.get_transformation_by_name": m_by_name,
            "dcn.dcn_api_client.api.transformation.get_transformation_by_name_version": m_by_name_ver,
            "dcn.dcn_api_client.api.transformation.post_transformation": m_post,
        }):
            s = m.Client()
            out1 = s.transformation_get("T")
            out2 = s.transformation_get("T", "2.0")
            out3 = s.transformation_post({"a": 1})
            self.assertEqual(out1[0], "t_by_name")
            self.assertEqual(out1[1]["transformation_name"], "T")
            self.assertEqual(out2[0], "t_by_name_version")
            self.assertEqual(out2[1]["transformation_version"], "2.0")
            self.assertEqual(out3[0], "t_post")
            self.assertEqual(out3[1]["json_body"], {"a": 1})

    def test_execute_with_and_without_ranges(self):
        m = self.client_mod
        seen = {}
        def no_pairs(mod, client, *, feature_name, num_samples):
            seen["no_pairs"] = (feature_name, num_samples)
            return "nopairs"
        def with_pairs(mod, client, *, feature_name, num_samples, pairs):
            seen["with_pairs"] = (feature_name, num_samples, pairs)
            return "withpairs"

        with patch.dict(sys.modules, {
            "dcn.dcn_api_client.api.execute.get_execute_no_pairs": make_sync_module(no_pairs),
            "dcn.dcn_api_client.api.execute.get_execute_with_pairs": make_sync_module(with_pairs),
        }):
            s = m.Client()
            out1 = s.execute("Feat", 5)
            out2 = s.execute("Feat", 5, ranges=[(0, 2), (10, 20)])

            self.assertEqual(out1, "nopairs")
            self.assertEqual(out2, "withpairs")
            self.assertEqual(seen["no_pairs"], ("Feat", 5))
            self.assertEqual(seen["with_pairs"], ("Feat", 5, "[(0;2)(10;20)]"))


if __name__ == "__main__":
    unittest.main()
