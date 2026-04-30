from __future__ import annotations

import os
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any, Optional

import httpx
from eth_account import Account

from .crypto import sign_login_nonce

DEFAULT_BASE = "https://api.decentralised.art/chain"


class DcnApiError(RuntimeError):
    def __init__(self, status_code: int, body: Any) -> None:
        super().__init__(f"DCN API request failed with status {status_code}")
        self.status_code = status_code
        self.body = body


@dataclass
class Client:
    base_url: Optional[str] = None
    access_token: Optional[str] = None
    timeout: float = 15.0
    verify_ssl: bool = True
    transport: Optional[httpx.BaseTransport] = None

    def __post_init__(self) -> None:
        base = (self.base_url or os.getenv("DCN_API_BASE") or DEFAULT_BASE).rstrip("/")
        self._client = httpx.Client(
            base_url=base,
            timeout=self.timeout,
            verify=self.verify_ssl,
            transport=self.transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: Optional[dict[str, Any]] = None,
        auth: bool = True,
    ) -> Any:
        headers = {}
        if auth and self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"

        clean_params = {
            key: value for key, value in (params or {}).items() if value is not None
        }
        resp = self._client.request(
            method,
            path.lstrip("/"),
            json=json_body,
            params=clean_params,
            headers=headers,
        )
        body = self._decode_response(resp)
        if not 200 <= resp.status_code < 300:
            raise DcnApiError(resp.status_code, body)
        return body

    @staticmethod
    def _decode_response(resp: httpx.Response) -> Any:
        if resp.status_code == 204 or not resp.content:
            return None
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return resp.text

    def _exists(self, path: str) -> bool:
        resp = self._client.request("HEAD", path.lstrip("/"))
        if resp.status_code == 404:
            return False
        if not 200 <= resp.status_code < 300:
            raise DcnApiError(resp.status_code, self._decode_response(resp))
        return True

    def version(self) -> dict[str, Any]:
        return self._request("GET", "/version", auth=False)

    def get_nonce(self, address: str) -> dict[str, Any]:
        return self._request("GET", f"/nonce/{address}", auth=False)

    def login_with_signature(self, address: str, message: str, signature: str) -> dict[str, Any]:
        resp = self._request(
            "POST",
            "/auth",
            auth=False,
            json_body={"address": address, "message": message, "signature": signature},
        )
        self.access_token = resp["access_token"]
        return resp

    def login_with_account(self, account: Account) -> dict[str, Any]:
        nonce = self.get_nonce(account.address)["nonce"]
        message, signature = sign_login_nonce(account, nonce)
        return self.login_with_signature(account.address, message, signature)

    def list_accounts(self, *, limit: int = 50, after: Optional[str] = None) -> dict[str, Any]:
        return self._request(
            "GET",
            "/accounts",
            auth=False,
            params={"limit": limit, "after": after},
        )

    def account_info(
        self,
        address: str,
        *,
        limit: int = 50,
        after_connectors: Optional[str] = None,
        after_transformations: Optional[str] = None,
        after_conditions: Optional[str] = None,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/account/{address}",
            auth=False,
            params={
                "limit": limit,
                "after_connectors": after_connectors,
                "after_transformations": after_transformations,
                "after_conditions": after_conditions,
            },
        )

    def connector_exists(self, name: str) -> bool:
        return self._exists(f"/connector/{name}")

    def connector_get(self, name: str) -> dict[str, Any]:
        return self._request("GET", f"/connector/{name}", auth=False)

    def connector_post(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/connector", json_body=request)

    def transformation_exists(self, name: str) -> bool:
        return self._exists(f"/transformation/{name}")

    def transformation_get(self, name: str) -> dict[str, Any]:
        return self._request("GET", f"/transformation/{name}", auth=False)

    def transformation_post(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/transformation", json_body=request)

    def condition_exists(self, name: str) -> bool:
        return self._exists(f"/condition/{name}")

    def condition_get(self, name: str) -> dict[str, Any]:
        return self._request("GET", f"/condition/{name}", auth=False)

    def condition_post(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/condition", json_body=request)

    def execute(
        self,
        connector_name: str,
        particles_count: int | str,
        dynamic_ri: Optional[dict[str, dict[str, int]]] = None,
    ) -> list[dict[str, Any]]:
        body = {"connector_name": connector_name, "particles_count": particles_count}
        if dynamic_ri is not None:
            body["dynamic_ri"] = dynamic_ri
        return self._request("POST", "/execute", json_body=body)

    def list_formats(self, *, limit: int = 50, after: Optional[str] = None) -> dict[str, Any]:
        return self._request(
            "GET",
            "/formats",
            auth=False,
            params={"limit": limit, "after": after},
        )

    def format_info(
        self,
        format_hash: str,
        *,
        limit: int = 50,
        after: Optional[str] = None,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/format/{format_hash}",
            auth=False,
            params={"limit": limit, "after": after},
        )

    def feed(
        self,
        *,
        limit: int = 50,
        before: Optional[str] = None,
        event_type: Optional[str] = None,
        include_unfinalized: Optional[bool] = None,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            "/feed",
            auth=False,
            params={
                "limit": limit,
                "before": before,
                "type": event_type,
                "include_unfinalized": None
                if include_unfinalized is None
                else int(include_unfinalized),
            },
        )

    def feed_stream(
        self,
        *,
        since_seq: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> AbstractContextManager[httpx.Response]:
        return self._client.stream(
            "GET",
            "feed/stream",
            params={
                key: value
                for key, value in {"since_seq": since_seq, "limit": limit}.items()
                if value is not None
            },
        )
