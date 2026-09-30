from __future__ import annotations

import unittest

from decentralised_art import Client as PublicClient
from decentralised_art.client import Client


class TestEntrypoint(unittest.TestCase):
    def test_exports_public_client_facade(self) -> None:
        self.assertIs(PublicClient, Client)


if __name__ == "__main__":
    unittest.main()
