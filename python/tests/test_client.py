from __future__ import annotations

import json
import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import httpx

try:
    import eth_account  # type: ignore
except Exception:
    eth_account = ModuleType("eth_account")
    eth_account_messages = ModuleType("eth_account.messages")

    class Account: ...

    eth_account_messages.encode_defunct = lambda text: text
    eth_account.Account = Account
    sys.modules["eth_account"] = eth_account
    sys.modules["eth_account.messages"] = eth_account_messages

from dcn.client import Client, DcnApiError

ADDR = "0x1111111111111111111111111111111111111111"
FORMAT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


def make_json(data: object, status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=data,
        headers={"content-type": "application/json"},
    )


class ApiRouter:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        method = request.method
        query = dict(request.url.params)

        if path.endswith("/version") and method == "GET":
            return make_json({"version": "0.4.0", "build_timestamp": "2026-04-30T00:00:00Z"})

        if "/nonce/" in path and method == "GET":
            return make_json({"nonce": "abcd-efgh"})

        if path.endswith("/auth") and method == "POST":
            body = json.loads(request.content.decode())
            if body["message"] == "Login nonce: abcd-efgh":
                return make_json({"access_token": "access-123"})
            return make_json({"error": "bad_request"}, 400)

        if path.endswith("/accounts") and method == "GET":
            return make_json({
                "limit": int(query["limit"]),
                "total_accounts": 1,
                "cursor": {"has_more": False, "next_after": None},
                "accounts": [ADDR],
            })

        if "/account/" in path and method == "GET":
            return make_json({
                "address": path.rsplit("/", 1)[1],
                "limit": int(query["limit"]),
                "owned_connectors": ["pitch"],
                "owned_transformations": ["identity"],
                "owned_conditions": ["always"],
                "cursor_connectors": {"has_more": False, "next_after": None},
                "cursor_transformations": {"has_more": False, "next_after": None},
                "cursor_conditions": {"has_more": False, "next_after": None},
            })

        if "/connector/" in path and method == "HEAD":
            if path.endswith("/broken"):
                return httpx.Response(
                    503,
                    text="temporarily down",
                    headers={"content-type": "text/plain"},
                )
            return httpx.Response(404 if path.endswith("/missing") else 200)
        if "/connector/" in path and method == "GET":
            if path.endswith("/missing"):
                return make_json({"error": "not_found"}, 404)
            if path.endswith("/plain-error"):
                return httpx.Response(
                    500,
                    text="plain failure",
                    headers={"content-type": "text/plain"},
                )
            return make_json({
                "name": path.rsplit("/", 1)[1],
                "dimensions": [{"transformations": [{"name": "identity", "args": []}]}],
                "condition_name": "",
                "condition_args": [],
                "owner": ADDR,
                "address": "0x0",
                "format_hash": FORMAT,
            })
        if path.endswith("/connector") and method == "POST":
            body = json.loads(request.content.decode())
            return make_json({"name": body["name"], "owner": ADDR, "address": "0x0", "format_hash": FORMAT}, 201)

        if "/transformation/" in path and method == "HEAD":
            return httpx.Response(404 if path.endswith("/missing") else 200)
        if "/transformation/" in path and method == "GET":
            return make_json({"name": path.rsplit("/", 1)[1], "owner": ADDR, "address": "0x0", "sol_src": "return x;"})
        if path.endswith("/transformation") and method == "POST":
            body = json.loads(request.content.decode())
            return make_json({"name": body["name"], "owner": ADDR, "address": "0x0"}, 201)

        if "/condition/" in path and method == "HEAD":
            return httpx.Response(404 if path.endswith("/missing") else 200)
        if "/condition/" in path and method == "GET":
            return make_json({"name": path.rsplit("/", 1)[1], "owner": ADDR, "address": "0x0", "sol_src": "return true;"})
        if path.endswith("/condition") and method == "POST":
            body = json.loads(request.content.decode())
            return make_json({"name": body["name"], "owner": ADDR, "address": "0x0"}, 201)

        if path.endswith("/execute") and method == "POST":
            body = json.loads(request.content.decode())
            return make_json([{"path": f"/{body['connector_name']}", "data": [1, 2, 3]}])

        if path.endswith("/formats") and method == "GET":
            return make_json({
                "limit": int(query["limit"]),
                "total_formats": 1,
                "cursor": {"has_more": False, "next_after": None},
                "formats": [FORMAT],
            })

        if "/format/" in path and method == "GET":
            return make_json({
                "format_hash": path.rsplit("/", 1)[1],
                "limit": int(query["limit"]),
                "total_connectors": 1,
                "cursor": {"has_more": False, "next_after": None},
                "scalars": ["scalar:0"],
                "connectors": ["pitch"],
            })

        if path.endswith("/feed") and method == "GET":
            return make_json({
                "limit": int(query["limit"]),
                "cursor": {"has_more": False, "next_before": None},
                "items": [{
                    "feed_id": "eth:1:connector_added:pitch",
                    "event_type": "connector_added",
                    "status": "finalized",
                    "visible": True,
                    "tx_hash": "0xabc",
                    "block_number": 1,
                    "tx_index": 0,
                    "log_index": 0,
                    "history_cursor": "cursor",
                    "created_at_ms": 1,
                    "updated_at_ms": 1,
                    "projector_version": 1,
                    "payload": {"type": "connector", "name": "pitch", "owner": ADDR},
                }],
            })

        if path.endswith("/feed/stream") and method == "GET":
            return httpx.Response(
                200,
                text='event: stream_meta\ndata: {"has_more":false}\n\n',
                headers={"content-type": "text/event-stream"},
            )

        return make_json({"error": "not_found", "path": path}, 404)


class TestDcnClient(unittest.TestCase):
    def setUp(self) -> None:
        self.router = ApiRouter()
        self.client = Client(
            base_url="https://example.invalid/chain",
            access_token="access-123",
            transport=httpx.MockTransport(self.router),
        )

    def last_request(self) -> httpx.Request:
        return self.router.requests[-1]

    def test_version_uses_chain_base_url(self) -> None:
        out = self.client.version()
        self.assertEqual(out["version"], "0.4.0")
        self.assertEqual(str(self.last_request().url), "https://example.invalid/chain/version")

    def test_env_base_url_and_context_manager(self) -> None:
        router = ApiRouter()
        with patch.dict("os.environ", {"DCN_API_BASE": "https://env.invalid/chain/"}):
            with Client(transport=httpx.MockTransport(router)) as client:
                out = client.version()
                self.assertEqual(out["version"], "0.4.0")
            self.assertTrue(client._client.is_closed)

        self.assertEqual(str(router.requests[-1].url), "https://env.invalid/chain/version")

    def test_public_reads_omit_auth_and_mutations_attach_bearer(self) -> None:
        self.client.version()
        self.assertNotIn("authorization", self.last_request().headers)

        self.client.execute("pitch", 8)
        self.assertEqual(self.last_request().headers["authorization"], "Bearer access-123")

    def test_login_with_signature_sets_token_and_posts_auth_body(self) -> None:
        self.client.access_token = None
        out = self.client.login_with_signature(ADDR, "Login nonce: abcd-efgh", "0xSIG")
        self.assertEqual(out["access_token"], "access-123")
        self.assertEqual(self.client.access_token, "access-123")

        request = self.last_request()
        self.assertNotIn("authorization", request.headers)
        self.assertEqual(
            json.loads(request.content.decode()),
            {"address": ADDR, "message": "Login nonce: abcd-efgh", "signature": "0xSIG"},
        )

    def test_login_with_account_sets_access_token(self) -> None:
        account = SimpleNamespace(address=ADDR)
        with patch("dcn.client.sign_login_nonce", return_value=("Login nonce: abcd-efgh", "0xSIG")):
            self.client.access_token = None
            out = self.client.login_with_account(account)  # type: ignore[arg-type]
        self.assertEqual(out["access_token"], "access-123")
        self.assertEqual(self.client.access_token, "access-123")

    def test_account_endpoints(self) -> None:
        listed = self.client.list_accounts(limit=2, after=ADDR)
        self.assertEqual(listed["accounts"], [ADDR])
        self.assertEqual(dict(self.last_request().url.params)["after"], ADDR)

        info = self.client.account_info(
            ADDR,
            limit=3,
            after_connectors="pitch",
            after_transformations="identity",
            after_conditions="always",
        )
        self.assertEqual(info["owned_connectors"], ["pitch"])
        query = dict(self.last_request().url.params)
        self.assertEqual(query["after_connectors"], "pitch")
        self.assertEqual(query["after_transformations"], "identity")
        self.assertEqual(query["after_conditions"], "always")

    def test_connector_endpoints(self) -> None:
        self.assertTrue(self.client.connector_exists("pitch"))
        self.assertFalse(self.client.connector_exists("missing"))
        self.assertEqual(self.client.connector_get("pitch")["format_hash"], FORMAT)
        created = self.client.connector_post({
            "name": "melody",
            "dimensions": [{"transformations": [{"name": "identity", "args": []}]}],
            "condition_name": "",
            "condition_args": [],
        })
        self.assertEqual(created["name"], "melody")
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {
                "name": "melody",
                "dimensions": [{"transformations": [{"name": "identity", "args": []}]}],
                "condition_name": "",
                "condition_args": [],
            },
        )

    def test_transformation_and_condition_endpoints(self) -> None:
        self.assertTrue(self.client.transformation_exists("identity"))
        self.assertFalse(self.client.transformation_exists("missing"))
        self.assertEqual(self.client.transformation_get("identity")["sol_src"], "return x;")
        transformation = self.client.transformation_post({"name": "shift", "sol_src": "return x + 1;"})
        self.assertEqual(transformation, {"name": "shift", "owner": ADDR, "address": "0x0"})
        self.assertNotIn("sol_src", transformation)
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"name": "shift", "sol_src": "return x + 1;"},
        )

        self.assertTrue(self.client.condition_exists("always"))
        self.assertFalse(self.client.condition_exists("missing"))
        self.assertEqual(self.client.condition_get("always")["sol_src"], "return true;")
        condition = self.client.condition_post({"name": "gate", "sol_src": "return true;"})
        self.assertEqual(condition, {"name": "gate", "owner": ADDR, "address": "0x0"})
        self.assertNotIn("sol_src", condition)
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"name": "gate", "sol_src": "return true;"},
        )

    def test_execute_uses_post_body(self) -> None:
        out = self.client.execute("pitch", 8, {"0": {"start_point": 12, "transformation_shift": 3}})
        self.assertEqual(out[0]["path"], "/pitch")
        body = json.loads(self.last_request().content.decode())
        self.assertEqual(body["connector_name"], "pitch")
        self.assertEqual(body["particles_count"], 8)
        self.assertEqual(body["dynamic_ri"]["0"]["start_point"], 12)

        self.client.execute("pitch", "8")
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"connector_name": "pitch", "particles_count": "8"},
        )

    def test_format_and_feed_endpoints(self) -> None:
        self.assertEqual(self.client.list_formats(limit=4, after=FORMAT)["formats"], [FORMAT])
        self.assertEqual(dict(self.last_request().url.params)["after"], FORMAT)

        self.assertEqual(self.client.format_info(FORMAT, limit=5, after="pitch")["connectors"], ["pitch"])
        self.assertEqual(dict(self.last_request().url.params)["after"], "pitch")

        feed = self.client.feed(
            limit=6,
            before="cursor",
            event_type="connector_added",
            include_unfinalized=True,
        )
        self.assertEqual(feed["items"][0]["event_type"], "connector_added")
        query = dict(self.last_request().url.params)
        self.assertEqual(query["before"], "cursor")
        self.assertEqual(query["type"], "connector_added")
        self.assertEqual(query["include_unfinalized"], "1")

    def test_feed_omits_optional_query_params_when_unset(self) -> None:
        self.client.feed()
        query = dict(self.last_request().url.params)
        self.assertEqual(query, {"limit": "50"})

    def test_feed_stream_endpoint(self) -> None:
        with self.client.feed_stream(since_seq=10, limit=20) as response:
            self.assertEqual(response.status_code, 200)
            self.assertIn("event: stream_meta", response.text)

        query = dict(self.last_request().url.params)
        self.assertEqual(query, {"since_seq": "10", "limit": "20"})

    def test_api_error_includes_status_and_body(self) -> None:
        with self.assertRaises(DcnApiError) as raised:
            self.client.connector_get("missing")
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(raised.exception.body["error"], "not_found")

    def test_text_error_body_and_head_error(self) -> None:
        with self.assertRaises(DcnApiError) as raised:
            self.client.connector_get("plain-error")
        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(raised.exception.body, "plain failure")

        with self.assertRaises(DcnApiError) as head_raised:
            self.client.connector_exists("broken")
        self.assertEqual(head_raised.exception.status_code, 503)
        self.assertEqual(head_raised.exception.body, "temporarily down")


if __name__ == "__main__":
    unittest.main()
