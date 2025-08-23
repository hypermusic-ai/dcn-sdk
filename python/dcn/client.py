# dcn_sdk/client.py
from __future__ import annotations

import importlib
import os
import re
from typing import Callable, List, Optional, Tuple

import httpx
from eth_account import Account

# --- generated client root (vendored under dcn_sdk/_gen/) ---
from ._gen.dcn_api_client import Client as _GenClient
from ._gen.dcn_api_client.models import (
    FeatureCreateRequest,
    TransformationCreateRequest,
)

# --- local helpers ---
from .crypto import sign_login_nonce


DEFAULT_BASE = "https://api.decentralised.art"
_PAIR_RE = re.compile(r"\((\d+);(\d+)\)")


class DcnSDK:
    """
    Thin, production-friendly wrapper over the generated client.

    - Uses api.yaml-generated package: dcn_sdk._gen.dcn_api_client
    - Handles nonce → sign → auth; caches tokens
    - Optional single auto-refresh on 401 for protected calls
    - Encodes execute() ranges `(start;shift)` into the path form

    Regenerate the underlying client with:
      openapi-python-client generate --path api.yaml --config openapi-python-client.json --meta all
    and copy `dcn_api_client/` into `dcn_sdk/_gen/`.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        *,
        timeout: float = 15.0,
        auto_refresh: bool = True,
        verify_ssl: bool = True,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        base = (base_url or os.getenv("DCN_API_BASE") or DEFAULT_BASE).rstrip("/")
        self._access = access_token
        self._refresh = refresh_token
        self._auto_refresh = auto_refresh

        # httpx.Client only used by the generated client internally; we pass config via _GenClient
        self._client = _GenClient(base_url=base, token=self._access, verify_ssl=verify_ssl, timeout=timeout)

        # If you want to inject a custom transport (e.g., for tests), we can override httpx settings
        if transport is not None:
            # openapi-python-client currently doesn't expose transport directly;
            # you can still monkey-patch via client._client if present (best-effort).
            try:
                if hasattr(self._client, "_client") and isinstance(self._client._client, httpx.Client):
                    self._client._client = httpx.Client(timeout=timeout, verify=verify_ssl, transport=transport)
            except Exception:
                pass

    # ---------------------------------------------------------------------
    # Token plumbing
    # ---------------------------------------------------------------------

    @property
    def access_token(self) -> Optional[str]:
        return self._access

    @property
    def refresh_token(self) -> Optional[str]:
        return self._refresh

    def _set_tokens(self, access: Optional[str], refresh: Optional[str] = None) -> None:
        if access:
            self._access = access
            # Recreate the generated client to propagate the token
            self._client = _GenClient(
                base_url=self._client.base_url,
                token=self._access,
                verify_ssl=self._client.verify_ssl,
                timeout=self._client.timeout,
            )
        if refresh is not None:
            self._refresh = refresh

    # ---------------------------------------------------------------------
    # Import helpers (robust to tag/module layout)
    # ---------------------------------------------------------------------

    @staticmethod
    def _resolve_func(candidates: List[str]) -> Callable:
        """
        Try importing a function from a list of possible module paths.

        openapi-python-client groups endpoints by tag; if you didn’t add tags
        it may place them under `api.default`. OperationIds become snake_case.
        """
        last_exc: Optional[Exception] = None
        for dotted in candidates:
            mod_name, _, func = dotted.rpartition(".")
            try:
                mod = importlib.import_module(mod_name)
                return getattr(mod, func)
            except Exception as e:  # noqa: BLE001
                last_exc = e
        raise ImportError(f"Unable to resolve any of: {candidates}") from last_exc

    def _call(self, op_func: Callable, *args, **kwargs):
        """
        Call a generated endpoint with single auto-refresh (401) retry if enabled.

        We prefer `sync_detailed` to inspect status codes; fall back to `sync`.
        """
        # Prefer sync_detailed for explicit status/parsed access
        if hasattr(op_func, "sync_detailed"):
            resp = op_func.sync_detailed(client=self._client, *args, **kwargs)
            if self._auto_refresh and resp.status_code == 401 and self._refresh:
                self.refresh()
                resp = op_func.sync_detailed(client=self._client, *args, **kwargs)
            if 200 <= resp.status_code < 300:
                return getattr(resp, "parsed", None)
            # Raise consistent HTTP-like error
            raise RuntimeError(f"HTTP {resp.status_code}: {getattr(resp, 'content', '')}")
        # Fallback: sync (already parsed or None)
        try:
            return op_func.sync(client=self._client, *args, **kwargs)
        except httpx.HTTPStatusError as e:
            if self._auto_refresh and e.response.status_code == 401 and self._refresh:
                self.refresh()
                return op_func.sync(client=self._client, *args, **kwargs)
            raise

    @staticmethod
    def _encode_ranges(ranges: List[Tuple[int, int]]) -> str:
        """Encode [(start, shift), ...] -> '(start;shift)(start;shift)...'"""
        return "".join(f"({a};{b})" for a, b in ranges)

    # ---------------------------------------------------------------------
    # Public API (high-level)
    # ---------------------------------------------------------------------

    # --- Version ---
    def version(self):
        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.version.get_version",
            "dcn_sdk._gen.dcn_api_client.api.default.get_version",
        ])
        return self._call(fn)

    # --- Auth flow ---
    def get_nonce(self, address: str):
        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.auth.get_nonce",
            "dcn_sdk._gen.dcn_api_client.api.default.get_nonce",
        ])
        return self._call(fn, address=address)

    def login_with_account(self, account: Account):
        """Nonce -> sign -> POST /auth; caches access/refresh tokens."""
        nonce_resp = self.get_nonce(account.address)
        # Generated models often expose attributes; support dict too:
        nonce = getattr(nonce_resp, "nonce", None) or (nonce_resp.get("nonce") if isinstance(nonce_resp, dict) else None)
        if not nonce:
            raise RuntimeError(f"Nonce response missing 'nonce': {nonce_resp!r}")

        message, signature = sign_login_nonce(account, nonce)

        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.auth.post_auth",
            "dcn_sdk._gen.dcn_api_client.api.default.post_auth",
        ])
        resp = self._call(fn, json_body={"address": account.address, "message": message, "signature": signature})

        access = getattr(resp, "access_token", None) or (resp.get("access_token") if isinstance(resp, dict) else None)
        refresh = getattr(resp, "refresh_token", None) or (resp.get("refresh_token") if isinstance(resp, dict) else None)
        self._set_tokens(access, refresh)
        return resp

    def refresh(self):
        if not self._access or not self._refresh:
            raise RuntimeError("Missing tokens for refresh")
        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.auth.post_refresh",
            "dcn_sdk._gen.dcn_api_client.api.default.post_refresh",
        ])
        # Most servers expect Authorization + X-Refresh-Token
        # openapi-python-client passes extra headers via `headers` kw.
        resp = self._call(fn, headers={"X-Refresh-Token": self._refresh}, json_body={})
        new_access = getattr(resp, "access_token", None) or (resp.get("access_token") if isinstance(resp, dict) else None)
        self._set_tokens(new_access)
        return resp

    # --- Account ---
    def account_info(self, address: str, *, limit: int = 50, page: int = 0):
        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.account.get_account_info",
            "dcn_sdk._gen.dcn_api_client.api.default.get_account_info",
        ])
        return self._call(fn, address=address, limit=limit, page=page)

    # --- Feature ---
    def feature_get(self, name: str, version: Optional[str] = None):
        if version is None:
            fn = self._resolve_func([
                "dcn_sdk._gen.dcn_api_client.api.feature.get_by_name",
                "dcn_sdk._gen.dcn_api_client.api.default.get_by_name",
            ])
            return self._call(fn, feature_name=name)
        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.feature.get_by_name_version",
            "dcn_sdk._gen.dcn_api_client.api.default.get_by_name_version",
        ])
        return self._call(fn, feature_name=name, feature_version=version)

    def feature_post(self, req: FeatureCreateRequest):
        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.feature.post_feature",
            "dcn_sdk._gen.dcn_api_client.api.default.post_feature",
        ])
        return self._call(fn, json_body=req)

    # --- Transformation ---
    def transformation_get(self, name: str, version: Optional[str] = None):
        if version is None:
            fn = self._resolve_func([
                "dcn_sdk._gen.dcn_api_client.api.transformation.get_by_name",
                "dcn_sdk._gen.dcn_api_client.api.default.get_by_name",
            ])
            return self._call(fn, transformation_name=name)
        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.transformation.get_by_name_version",
            "dcn_sdk._gen.dcn_api_client.api.default.get_by_name_version",
        ])
        return self._call(fn, transformation_name=name, transformation_version=version)

    def transformation_post(self, req: TransformationCreateRequest):
        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.transformation.post_transformation",
            "dcn_sdk._gen.dcn_api_client.api.default.post_transformation",
        ])
        return self._call(fn, json_body=req)

    # --- Execute ---
    def execute(self, feature_name: str, num_samples: int, ranges: Optional[List[Tuple[int, int]]] = None):
        if ranges:
            fn = self._resolve_func([
                "dcn_sdk._gen.dcn_api_client.api.execute.get_with_pairs",
                "dcn_sdk._gen.dcn_api_client.api.default.get_with_pairs",
            ])
            pairs = self._encode_ranges(ranges)
            return self._call(fn, feature_name=feature_name, num_samples=num_samples, pairs=pairs)
        fn = self._resolve_func([
            "dcn_sdk._gen.dcn_api_client.api.execute.get_no_pairs",
            "dcn_sdk._gen.dcn_api_client.api.default.get_no_pairs",
        ])
        return self._call(fn, feature_name=feature_name, num_samples=num_samples)
