from __future__ import annotations

import os
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, Generator, Mapping, Optional, TypeVar, Union, cast

import httpx
from eth_account import Account

from .crypto import sign_login_nonce
from .dcn_api_client.api.account import get_account, get_accounts
from .dcn_api_client.api.auth import get_nonce, post_auth
from .dcn_api_client.api.condition import (
    get_condition,
    head_condition,
    post_condition,
)
from .dcn_api_client.api.connector import (
    get_connector,
    head_connector,
    post_connector,
)
from .dcn_api_client.api.core import get_version
from .dcn_api_client.api.feed import get_feed
from .dcn_api_client.api.format_ import get_format, get_formats
from .dcn_api_client.api.runner import post_execute
from .dcn_api_client.api.transformation import (
    get_transformation,
    head_transformation,
    post_transformation,
)
from .dcn_api_client.client import AuthenticatedClient, Client as GeneratedClient
from .dcn_api_client.models.account_info_response import AccountInfoResponse
from .dcn_api_client.models.account_list_response import AccountListResponse
from .dcn_api_client.models.auth_request import AuthRequest
from .dcn_api_client.models.auth_response import AuthResponse
from .dcn_api_client.models.condition_info_response import ConditionInfoResponse
from .dcn_api_client.models.connector_info_response import ConnectorInfoResponse
from .dcn_api_client.models.create_condition_request import CreateConditionRequest
from .dcn_api_client.models.create_condition_response import CreateConditionResponse
from .dcn_api_client.models.create_connector_request import CreateConnectorRequest
from .dcn_api_client.models.create_connector_response import CreateConnectorResponse
from .dcn_api_client.models.create_transformation_request import (
    CreateTransformationRequest,
)
from .dcn_api_client.models.create_transformation_response import (
    CreateTransformationResponse,
)
from .dcn_api_client.models.execute_request import ExecuteRequest
from .dcn_api_client.models.execute_request_dynamic_ri import ExecuteRequestDynamicRi
from .dcn_api_client.models.feed_event_type import FeedEventType
from .dcn_api_client.models.feed_page import FeedPage
from .dcn_api_client.models.format_info_response import FormatInfoResponse
from .dcn_api_client.models.format_list_response import FormatListResponse
from .dcn_api_client.models.get_feed_include_unfinalized import GETFeedIncludeUnfinalized
from .dcn_api_client.models.nonce_response import NonceResponse
from .dcn_api_client.models.particles_result_item import ParticlesResultItem
from .dcn_api_client.models.running_instance import RunningInstance
from .dcn_api_client.models.transformation_info_response import TransformationInfoResponse
from .dcn_api_client.models.version_response import VersionResponse
from .dcn_api_client.types import Response, UNSET, Unset

DEFAULT_BASE = "https://api.decentralised.art/chain"

T = TypeVar("T")


class DcnApiError(RuntimeError):
    """Error raised for non-2xx DCN API responses."""

    def __init__(self, status_code: int, body: object) -> None:
        super().__init__(f"DCN API request failed with status {status_code}")
        self.status_code = status_code
        self.body = body


def _optional(value: Optional[T]) -> Union[T, Unset]:
    return UNSET if value is None else value


def _decode_error(response: Response[object]) -> object:
    if response.parsed is not None:
        return response.parsed
    if not response.content:
        return None
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            return httpx.Response(
                int(response.status_code),
                content=response.content,
                headers=response.headers,
            ).json()
        except ValueError:
            return response.content.decode(errors="replace")
    return response.content.decode(errors="replace")


def _expect(response: Response[object], typ: type[T]) -> T:
    if HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
        if isinstance(response.parsed, typ):
            return response.parsed
        raise DcnApiError(int(response.status_code), _decode_error(response))
    raise DcnApiError(int(response.status_code), _decode_error(response))


def _expect_list(response: Response[object], item_type: type[T]) -> list[T]:
    if HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
        parsed = response.parsed
        items = cast(list[object], parsed)
        if isinstance(parsed, list) and all(isinstance(item, item_type) for item in items):
            return cast(list[T], parsed)
        raise DcnApiError(int(response.status_code), _decode_error(response))
    raise DcnApiError(int(response.status_code), _decode_error(response))


def _request_dict(request: Mapping[str, object] | T, typ: type[T]) -> T:
    if isinstance(request, typ):
        return request
    return cast(T, typ.from_dict(request))  # type: ignore[attr-defined]


@dataclass
class Client:
    """DCN Chain API facade.

    Defaults to `https://api.decentralised.art/chain`; override with `base_url`
    or `DCN_API_BASE`.
    """

    base_url: Optional[str] = None
    """Chain API base URL."""

    access_token: Optional[str] = None
    """Bearer access token used for protected publish/execute endpoints."""

    timeout: float = 15.0
    """HTTP request timeout in seconds."""

    verify_ssl: bool = True
    """Whether to verify TLS certificates."""

    transport: Optional[httpx.BaseTransport] = None
    """Optional custom httpx transport for tests or instrumentation."""

    def __post_init__(self) -> None:
        base = (self.base_url or os.getenv("DCN_API_BASE") or DEFAULT_BASE).rstrip("/")
        timeout = httpx.Timeout(self.timeout)
        self._client = httpx.Client(
            base_url=base,
            timeout=timeout,
            verify=self.verify_ssl,
            transport=self.transport,
        )
        self._generated = GeneratedClient(
            base_url=base,
            timeout=timeout,
            verify_ssl=self.verify_ssl,
        ).set_httpx_client(self._client)
        self._authenticated = AuthenticatedClient(
            base_url=base,
            token="",
            timeout=timeout,
            verify_ssl=self.verify_ssl,
        ).set_httpx_client(self._client)

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    @contextmanager
    def _auth_headers(self) -> Generator[AuthenticatedClient, None, None]:
        previous = self._client.headers.get("Authorization")
        if self.access_token:
            self._client.headers["Authorization"] = f"Bearer {self.access_token}"
        try:
            yield self._authenticated
        finally:
            if previous is None:
                self._client.headers.pop("Authorization", None)
            else:
                self._client.headers["Authorization"] = previous

    def _call(
        self,
        module: Any,
        client: GeneratedClient | AuthenticatedClient,
        *args: object,
        **kwargs: object,
    ) -> Response[object]:
        request_kwargs = module._get_kwargs(*args, **kwargs)
        response = self._client.request(**request_kwargs)
        if HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
            return cast(Response[object], module._build_response(client=client, response=response))
        return Response(
            status_code=HTTPStatus(response.status_code),
            content=response.content,
            headers=response.headers,
            parsed=None,
        )

    def _exists(self, response: Response[object]) -> bool:
        if response.status_code == HTTPStatus.NOT_FOUND:
            return False
        if HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
            return True
        raise DcnApiError(int(response.status_code), _decode_error(response))

    def version(self) -> VersionResponse:
        """Get chain API version metadata.

        Returns service version and build timestamp.
        """
        return _expect(
            self._call(get_version, self._generated),
            VersionResponse,
        )

    def get_nonce(self, address: str) -> NonceResponse:
        """Get a one-time nonce for an address.

        Sign `Login nonce: <nonce>` and submit it to `login_with_signature`.
        """
        return _expect(
            self._call(get_nonce, self._generated, address),
            NonceResponse,
        )

    def login_with_signature(self, address: str, message: str, signature: str) -> AuthResponse:
        """Authenticate using an address, signed login message, and signature.

        Stores the returned bearer token on this client for protected endpoints.
        """
        resp = _expect(
            self._call(
                post_auth,
                self._generated,
                body=AuthRequest(address=address, message=message, signature=signature),
            ),
            AuthResponse,
        )
        self.access_token = resp.access_token
        return resp

    def login_with_account(self, account: Account) -> AuthResponse:
        """Authenticate with an eth-account account.

        Fetches a nonce, signs `Login nonce: <nonce>`, then stores the returned bearer token.
        """
        address = cast(str, getattr(account, "address"))
        nonce = self.get_nonce(address).nonce
        message, signature = sign_login_nonce(account, nonce)
        return self.login_with_signature(address, message, signature)

    def list_accounts(self, *, limit: int = 50, after: Optional[str] = None) -> AccountListResponse:
        """List chain accounts known to the registry.

        Uses cursor-based pagination.
        """
        return _expect(
            self._call(
                get_accounts,
                self._generated,
                limit=limit,
                after=_optional(after),
            ),
            AccountListResponse,
        )

    def account_info(
        self,
        address: str,
        *,
        limit: int = 50,
        after_connectors: Optional[str] = None,
        after_transformations: Optional[str] = None,
        after_conditions: Optional[str] = None,
    ) -> AccountInfoResponse:
        """Get owned connectors, transformations, and conditions for an address.

        Each ownership list has its own cursor.
        """
        return _expect(
            self._call(
                get_account,
                self._generated,
                address,
                limit=limit,
                after_connectors=_optional(after_connectors),
                after_transformations=_optional(after_transformations),
                after_conditions=_optional(after_conditions),
            ),
            AccountInfoResponse,
        )

    def connector_exists(self, name: str) -> bool:
        """Check connector existence.

        Returns true when the connector exists, false on 404.
        """
        return self._exists(self._call(head_connector, self._generated, name))

    def connector_get(self, name: str) -> ConnectorInfoResponse:
        """Get connector by name.

        Returns connector definition, owner, address, and derived format hash.
        """
        return _expect(
            self._call(get_connector, self._generated, name),
            ConnectorInfoResponse,
        )

    def connector_post(
        self,
        request: CreateConnectorRequest | Mapping[str, object],
    ) -> CreateConnectorResponse:
        """Publish a connector definition.

        Requires bearer authentication.
        """
        with self._auth_headers() as client:
            return _expect(
                self._call(
                    post_connector,
                    client,
                    body=_request_dict(request, CreateConnectorRequest),
                ),
                CreateConnectorResponse,
            )

    def transformation_exists(self, name: str) -> bool:
        """Check transformation existence.

        Returns true when the transformation exists, false on 404.
        """
        return self._exists(self._call(head_transformation, self._generated, name))

    def transformation_get(self, name: str) -> TransformationInfoResponse:
        """Get transformation by name.

        Returns transformation source metadata, owner, and deployed address.
        """
        return _expect(
            self._call(get_transformation, self._generated, name),
            TransformationInfoResponse,
        )

    def transformation_post(
        self,
        request: CreateTransformationRequest | Mapping[str, object],
    ) -> CreateTransformationResponse:
        """Publish a transformation definition.

        Requires bearer authentication.
        """
        with self._auth_headers() as client:
            return _expect(
                self._call(
                    post_transformation,
                    client,
                    body=_request_dict(request, CreateTransformationRequest),
                ),
                CreateTransformationResponse,
            )

    def condition_exists(self, name: str) -> bool:
        """Check condition existence.

        Returns true when the condition exists, false on 404.
        """
        return self._exists(self._call(head_condition, self._generated, name))

    def condition_get(self, name: str) -> ConditionInfoResponse:
        """Get condition by name.

        Returns condition source metadata, owner, and deployed address.
        """
        return _expect(
            self._call(get_condition, self._generated, name),
            ConditionInfoResponse,
        )

    def condition_post(
        self,
        request: CreateConditionRequest | Mapping[str, object],
    ) -> CreateConditionResponse:
        """Publish a condition definition.

        Requires bearer authentication.
        """
        with self._auth_headers() as client:
            return _expect(
                self._call(
                    post_condition,
                    client,
                    body=_request_dict(request, CreateConditionRequest),
                ),
                CreateConditionResponse,
            )

    def execute(
        self,
        connector_name: str,
        particles_count: int | str,
        dynamic_ri: Optional[Mapping[str, RunningInstance | Mapping[str, object]]] = None,
    ) -> list[ParticlesResultItem]:
        """Execute a connector.

        `particles_count` accepts protobuf JSON uint32 values and rejects values
        greater than 65536. Requires bearer authentication.
        """
        dynamic: ExecuteRequestDynamicRi | Unset = UNSET
        if dynamic_ri is not None:
            dynamic = ExecuteRequestDynamicRi.from_dict(
                {
                    key: value.to_dict() if isinstance(value, RunningInstance) else dict(value)
                    for key, value in dynamic_ri.items()
                }
            )
        with self._auth_headers() as client:
            return _expect_list(
                self._call(
                    post_execute,
                    client,
                    body=ExecuteRequest(
                        connector_name=connector_name,
                        particles_count=particles_count,
                        dynamic_ri=dynamic,
                    ),
                ),
                ParticlesResultItem,
            )

    def list_formats(self, *, limit: int = 50, after: Optional[str] = None) -> FormatListResponse:
        """List connector format hashes known to the registry.

        Uses cursor-based pagination.
        """
        return _expect(
            self._call(
                get_formats,
                self._generated,
                limit=limit,
                after=_optional(after),
            ),
            FormatListResponse,
        )

    def format_info(
        self,
        format_hash: str,
        *,
        limit: int = 50,
        after: Optional[str] = None,
    ) -> FormatInfoResponse:
        """Get format membership.

        Lists connector names and scalar labels for a format hash.
        """
        return _expect(
            self._call(
                get_format,
                self._generated,
                format_hash,
                limit=limit,
                after=_optional(after),
            ),
            FormatInfoResponse,
        )

    def feed(
        self,
        *,
        limit: int = 50,
        before: Optional[str] = None,
        event_type: Optional[FeedEventType | str] = None,
        include_unfinalized: Optional[bool] = None,
    ) -> FeedPage:
        """List feed items.

        Returns newest-first feed items with compact payload metadata. Hydrate
        full details via entity endpoints.
        """
        feed_type = _optional(
            FeedEventType(event_type) if isinstance(event_type, str) else event_type
        )
        include: GETFeedIncludeUnfinalized | Unset = UNSET
        if include_unfinalized is not None:
            include = (
                GETFeedIncludeUnfinalized.VALUE_1
                if include_unfinalized
                else GETFeedIncludeUnfinalized.VALUE_0
            )
        return _expect(
            self._call(
                get_feed,
                self._generated,
                limit=limit,
                before=_optional(before),
                type_=feed_type,
                include_unfinalized=include,
            ),
            FeedPage,
        )

    def feed_stream(
        self,
        *,
        since_seq: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> AbstractContextManager[httpx.Response]:
        """Open the feed Server-Sent Events stream.

        Starts with bounded replay from `since_seq`, then tails live feed deltas.
        """
        return self._client.stream(
            "GET",
            "feed/stream",
            params={
                key: value
                for key, value in {"since_seq": since_seq, "limit": limit}.items()
                if value is not None
            },
        )
