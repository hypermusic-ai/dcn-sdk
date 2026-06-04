from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import httpx

from dcn.client import Client, DcnApiError

from fixtures import ADDR, FORMAT, ApiRouter


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
        self.assertEqual(out.version, "0.4.0")
        self.assertEqual(str(self.last_request().url), "https://example.invalid/chain/version")

    def test_env_base_url_and_context_manager(self) -> None:
        router = ApiRouter()
        with patch.dict("os.environ", {"DCN_API_BASE": "https://env.invalid/chain/"}):
            with Client(transport=httpx.MockTransport(router)) as client:
                out = client.version()
                self.assertEqual(out.version, "0.4.0")
            self.assertTrue(client._client.is_closed)

        self.assertEqual(str(router.requests[-1].url), "https://env.invalid/chain/version")

    def test_public_reads_omit_auth_and_mutations_attach_bearer(self) -> None:
        self.client.version()
        self.assertNotIn("authorization", self.last_request().headers)

        self.client.execute("pitch", 8)
        self.assertEqual(self.last_request().headers["authorization"], "Bearer access-123")

    def test_account_endpoints(self) -> None:
        listed = self.client.list_accounts(limit=2, after=ADDR)
        self.assertEqual(listed.accounts, [ADDR])
        self.assertEqual(dict(self.last_request().url.params)["after"], ADDR)

        info = self.client.account_info(
            ADDR,
            limit=3,
            after_connectors="pitch",
            after_transformations="identity",
            after_conditions="always",
        )
        self.assertEqual(info.owned_connectors, ["pitch"])
        query = dict(self.last_request().url.params)
        self.assertEqual(query["after_connectors"], "pitch")
        self.assertEqual(query["after_transformations"], "identity")
        self.assertEqual(query["after_conditions"], "always")

    def test_connector_endpoints(self) -> None:
        self.assertTrue(self.client.connector_exists("pitch"))
        self.assertFalse(self.client.connector_exists("missing"))
        self.assertEqual(self.client.connector_get("pitch").format_hash, FORMAT)
        created = self.client.connector_post({
            "name": "melody",
            "dimensions": [{"transformations": [{"name": "identity", "args": []}]}],
            "condition_name": "",
            "condition_args": [],
        })
        self.assertEqual(created.name, "melody")
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
        self.assertEqual(self.client.transformation_get("identity").sol_src, "return x;")
        transformation = self.client.transformation_post({
            "name": "shift",
            "sol_src": "return x + 1;",
        })
        self.assertEqual(transformation.name, "shift")
        self.assertEqual(transformation.owner, ADDR)
        self.assertEqual(transformation.address, "0x0")
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"name": "shift", "sol_src": "return x + 1;"},
        )

        self.assertTrue(self.client.condition_exists("always"))
        self.assertFalse(self.client.condition_exists("missing"))
        self.assertEqual(self.client.condition_get("always").sol_src, "return true;")
        condition = self.client.condition_post({"name": "gate", "sol_src": "return true;"})
        self.assertEqual(condition.name, "gate")
        self.assertEqual(condition.owner, ADDR)
        self.assertEqual(condition.address, "0x0")
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"name": "gate", "sol_src": "return true;"},
        )

    def test_execute_uses_post_body(self) -> None:
        out = self.client.execute("pitch", 8, {"0": {"start_point": 12, "transformation_shift": 3}})
        self.assertEqual(out[0].path, "/pitch")
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
        self.assertEqual(self.client.list_formats(limit=4, after=FORMAT).formats, [FORMAT])
        self.assertEqual(dict(self.last_request().url.params)["after"], FORMAT)

        self.assertEqual(
            self.client.format_info(FORMAT, limit=5, after="pitch").connectors,
            ["pitch"],
        )
        self.assertEqual(dict(self.last_request().url.params)["after"], "pitch")

        feed = self.client.feed(
            limit=6,
            before="cursor",
            event_type="connector_added",
            include_unfinalized=True,
        )
        self.assertEqual(feed.items[0].event_type.value, "connector_added")
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
