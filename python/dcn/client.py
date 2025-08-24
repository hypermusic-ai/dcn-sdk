# dcn/client.py
from __future__ import annotations
import importlib, os, re
from dataclasses import dataclass, field
import logging
from typing import Any, Callable, List, Optional, Tuple
from collections.abc import Mapping

import httpx
from eth_account import Account

# --- generated client ---
from .dcn_api_client import Client as _GenClient
from .dcn_api_client import AuthenticatedClient as _GenAuthClient
from .dcn_api_client.models import AuthRequest, RefreshRequest, FeatureCreateRequest, TransformationCreateRequest
from .dcn_api_client.models import AuthResponse, RefreshResponse, NonceResponse, VersionResponse, AccountResponse
from .dcn_api_client.models import FeatureGetResponse, TransformationGetResponse, FeatureCreateResponse, TransformationCreateResponse
# --- local helpers ---
from .crypto import sign_login_nonce

DEFAULT_BASE = "https://api.decentralised.art"
_PAIR_RE = re.compile(r"\((\d+);(\d+)\)")

def _resolve_op(candidates: list[str]):
    """
    Import and return an operation *module*, e.g.
    'dcn.dcn_api_client.api.version.get_version'.
    """
    last_exc = None
    for dotted in candidates:
        try:
            mod = importlib.import_module(dotted)
            # sanity: module must expose sync()/sync_detailed()
            if hasattr(mod, "sync") or hasattr(mod, "sync_detailed"):
                return mod
        except Exception as e:
            last_exc = e
    raise ImportError(f"Unable to resolve any of: {candidates}") from last_exc

def _encode_running_instances(running_instances: List[Tuple[int, int]]) -> str:
    return "[" + ",".join(f"({a};{b})" for a, b in running_instances) + "]"

@dataclass(init=False)
class Client:
    base_url: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    timeout: float = 15.0
    auto_refresh: bool = True
    verify_ssl: bool = True
    transport: Optional[httpx.BaseTransport] = None

    _client: _GenClient | _GenAuthClient = field(init=False, repr=False)

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
        self.base_url = base_url
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.timeout = timeout
        self.auto_refresh = auto_refresh
        self.verify_ssl = verify_ssl
        self.transport = transport
        self.__post_init__()

    def __post_init__(self) -> None:
        base = (self.base_url or os.getenv("DCN_API_BASE") or DEFAULT_BASE).rstrip("/")
        self._client = (
            _GenAuthClient(base_url=base, token=self.access_token,
                           verify_ssl=self.verify_ssl, timeout=self.timeout)
            if self.access_token
            else _GenClient(base_url=base, verify_ssl=self.verify_ssl, timeout=self.timeout)
        )
        # Optional: inject custom httpx transport (best-effort across generator versions)
        if self.transport is not None:
            for attr in ("_client", "client", "_sync_client"):
                c = getattr(self._client, attr, None)
                if isinstance(c, httpx.Client):
                    setattr(self._client, attr, httpx.Client(
                        timeout=self.timeout, verify=self.verify_ssl, transport=self.transport
                    ))
                    break

    # -------------------- tokens --------------------

    def _set_tokens(self, access: Optional[str], refresh: Optional[str] = None) -> None:
        if access:
            self.access_token = access
            # Rebuild as AuthenticatedClient now that we have a token
            self._client = _GenAuthClient(
                base_url=getattr(self._client, "base_url", (self.base_url or DEFAULT_BASE)),
                token=self.access_token,
                verify_ssl=self.verify_ssl,
                timeout=self.timeout,
            )
        if refresh is not None:
            self.refresh_token = refresh

    # -------------------- helpers --------------------
    def _call(self, op_func: Callable, *args, **kwargs):
        if hasattr(op_func, "sync_detailed"):
            resp = op_func.sync_detailed(client=self._client, *args, **kwargs)
            if self.auto_refresh and resp.status_code == 401 and self.refresh_token:
                logging.warn("Token expired, refreshing...")
                self.refresh()
                resp = op_func.sync_detailed(client=self._client, *args, **kwargs)
            if 200 <= resp.status_code < 300:
                return getattr(resp, "parsed", None)
            raise RuntimeError(f"HTTP {resp.status_code}: {getattr(resp, 'content', '')}")
        try:
            return op_func.sync(client=self._client, *args, **kwargs)
        except httpx.HTTPStatusError as e:
            if self.auto_refresh and e.response.status_code == 401 and self.refresh_token:
                self.refresh()
                return op_func.sync(client=self._client, *args, **kwargs)
            raise

    # -------------------- public API --------------------

    # Version
    def version(self) -> VersionResponse:
        fn = _resolve_op([
            "dcn.dcn_api_client.api.version.get_version",
        ])
        return self._call(fn)

    # Auth
    def get_nonce(self, address: str) -> NonceResponse:
        fn = _resolve_op([
            "dcn.dcn_api_client.api.auth.get_nonce",
        ])
        return self._call(fn, address=address)

    def login_with_account(self, account: Account) -> AuthResponse:
        nonce_resp = self.get_nonce(account.address)
        nonce = getattr(nonce_resp, "nonce", None) or (nonce_resp.get("nonce") if isinstance(nonce_resp, dict) else None)
        if not nonce:
            raise RuntimeError(f"Nonce response missing 'nonce': {nonce_resp!r}")

        message, signature = sign_login_nonce(account, nonce)

        fn = _resolve_op([
            "dcn.dcn_api_client.api.auth.post_auth",
        ])
        resp = self._call(fn, body = AuthRequest(account.address, message, signature))

        access = getattr(resp, "access_token", None) or (resp.get("access_token") if isinstance(resp, dict) else None)
        refresh = getattr(resp, "refresh_token", None) or (resp.get("refresh_token") if isinstance(resp, dict) else None)
        self._set_tokens(access, refresh)
        return resp

    def refresh(self) -> RefreshResponse:
        if not self.access_token or not self.refresh_token:
            raise RuntimeError("Missing tokens for refresh")
        fn = _resolve_op([
            "dcn.dcn_api_client.api.auth.post_refresh",
        ])
        resp = self._call(fn, x_refresh_token=self.refresh_token, body=RefreshRequest())
        new_access = getattr(resp, "access_token", None) or (resp.get("access_token") if isinstance(resp, dict) else None)
        self._set_tokens(new_access)
        return resp

    # Account
    def account_info(self, address: str, *, limit: int = 50, page: int = 0) -> AccountResponse:
        fn = _resolve_op([
            "dcn.dcn_api_client.api.account.get_account_info",
        ])
        return self._call(fn, address=address, limit=limit, page=page)

    # Feature
    def feature_get(self, name: str, version: Optional[str] = None) -> FeatureGetResponse:
        if version is None:
            fn = _resolve_op([
                "dcn.dcn_api_client.api.feature.get_feature_by_name",
            ])
            return self._call(fn, feature_name=name)
        fn = _resolve_op([
            "dcn.dcn_api_client.api.feature.get_feature_by_name_version",
        ])
        return self._call(fn, feature_name=name, feature_version=version)

    def feature_post(self, req: FeatureCreateRequest) -> FeatureCreateResponse:
        fn = _resolve_op([
            "dcn.dcn_api_client.api.feature.post_feature",
        ])
        return self._call(fn, body=req)

    def feature_post(self, src_dict: Mapping[str, Any]) -> FeatureCreateResponse:
        fn = _resolve_op([
            "dcn.dcn_api_client.api.feature.post_feature",
        ])
        return self._call(fn, body=FeatureCreateRequest.from_dict(src_dict))

    # Transformation
    def transformation_get(self, name: str, version: Optional[str] = None) -> TransformationGetResponse:
        if version is None:
            fn = _resolve_op([
                "dcn.dcn_api_client.api.transformation.get_transformation_by_name",
            ])
            return self._call(fn, transformation_name=name)
        fn = _resolve_op([
            "dcn.dcn_api_client.api.transformation.get_transformation_by_name_version",
        ])
        return self._call(fn, transformation_name=name, transformation_version=version)

    def transformation_post(self, req: TransformationCreateRequest) -> TransformationCreateResponse:
        fn = _resolve_op([
            "dcn.dcn_api_client.api.transformation.post_transformation",
        ])
        return self._call(fn, body=req)

    def transformation_post(self, src_dict: Mapping[str, Any]) -> TransformationCreateResponse:
        fn = _resolve_op([
            "dcn.dcn_api_client.api.transformation.post_transformation",
        ])
        return self._call(fn, body=TransformationCreateRequest.from_dict(src_dict))

    # Execute
    def execute(self, feature_name: str, num_samples: int, running_instances: Optional[List[Tuple[int, int]]] = None):
        if running_instances:
            fn = _resolve_op([
                "dcn.dcn_api_client.api.execute.get_execute_with_running_instances",
            ])
            running_instances = _encode_running_instances(running_instances)
            return self._call(fn, feature_name=feature_name, num_samples=num_samples, running_instances=running_instances)
        fn = _resolve_op([
            "dcn.dcn_api_client.api.execute.get_execute_no_running_instances",
        ])
        return self._call(fn, feature_name=feature_name, num_samples=num_samples)
