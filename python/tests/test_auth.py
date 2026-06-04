from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct

from dcn.client import Client
from dcn.crypto import sign_login_nonce
from fixtures import ADDR, ApiRouter


class TestDcnAuth(unittest.TestCase):
    def setUp(self) -> None:
        self.router = ApiRouter()
        self.client = Client(
            base_url="https://example.invalid/chain",
            transport=httpx.MockTransport(self.router),
        )

    def last_request(self) -> httpx.Request:
        return self.router.requests[-1]

    def test_login_with_signature_sets_token_and_posts_auth_body(self) -> None:
        out = self.client.login_with_signature(ADDR, "Login nonce: abcd-efgh", "0xSIG")
        self.assertEqual(out.access_token, "access-123")
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
            out = self.client.login_with_account(account)  # type: ignore[arg-type]
        self.assertEqual(out.access_token, "access-123")
        self.assertEqual(self.client.access_token, "access-123")

    def test_sign_login_nonce_returns_expected_message_and_valid_signature(self) -> None:
        account = Account.create()

        message, signature = sign_login_nonce(account, "nonce-123")
        recovered = Account.recover_message(
            encode_defunct(text=message),
            signature=signature,
        )

        self.assertEqual(message, "Login nonce: nonce-123")
        self.assertEqual(recovered.lower(), account.address.lower())


if __name__ == "__main__":
    unittest.main()
