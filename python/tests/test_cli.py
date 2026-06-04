from __future__ import annotations

import io
import json
import sys
import unittest
from types import ModuleType
from unittest.mock import patch

try:
    import eth_account  # type: ignore
except Exception:
    eth_account = ModuleType("eth_account")
    eth_account_messages = ModuleType("eth_account.messages")

    class Account:
        pass

    eth_account_messages.encode_defunct = lambda text: text
    eth_account.Account = Account
    sys.modules["eth_account"] = eth_account
    sys.modules["eth_account.messages"] = eth_account_messages

from dcn import cli


class TestCli(unittest.TestCase):
    def test_version_command_prints_json_and_passes_base_url(self) -> None:
        with patch("dcn.cli.Client") as client_cls:
            client = client_cls.return_value
            client.version.return_value = {
                "version": "0.4.0",
                "build_timestamp": "2026-04-30T00:00:00Z",
            }

            stdout = io.StringIO()
            with patch.object(
                sys,
                "argv",
                ["dcn-auth", "--base-url", "https://example.invalid/chain", "version"],
            ), patch("sys.stdout", stdout):
                cli.main()

        client_cls.assert_called_once_with(base_url="https://example.invalid/chain")
        client.version.assert_called_once_with()
        self.assertEqual(
            json.loads(stdout.getvalue()),
            {"version": "0.4.0", "build_timestamp": "2026-04-30T00:00:00Z"},
        )

    def test_nonce_command_prints_json_for_address(self) -> None:
        with patch("dcn.cli.Client") as client_cls:
            client = client_cls.return_value
            client.get_nonce.return_value = {"nonce": "abcd-efgh"}

            stdout = io.StringIO()
            with patch.object(
                sys,
                "argv",
                ["dcn-auth", "nonce", "0x1111111111111111111111111111111111111111"],
            ), patch("sys.stdout", stdout):
                cli.main()

        client_cls.assert_called_once_with(base_url=None)
        client.get_nonce.assert_called_once_with("0x1111111111111111111111111111111111111111")
        self.assertEqual(json.loads(stdout.getvalue()), {"nonce": "abcd-efgh"})


if __name__ == "__main__":
    unittest.main()
