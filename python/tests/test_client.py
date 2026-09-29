from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import httpx

from dcn.client import (
    AlreadyPublished,
    Client,
    ConfirmResponse,
    DcnApiError,
    PreparedPublication,
    PublishError,
)

from eth_account import Account

from fixtures import ADDR, FORMAT, HASH, SIGNING, TX, ApiRouter


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
        self.client.simulate("pitch", 8)
        self.assertEqual(self.last_request().headers["authorization"], "Bearer access-123")
        self.client.publish_prepare("connector", "pitch")
        self.assertEqual(self.last_request().headers["authorization"], "Bearer access-123")
        self.client.publish_send("connector", "pitch", HASH, "0x02abcd")
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
        self.assertEqual(self.client.transformation_get("identity").args_count, 1)
        transformation = self.client.transformation_post({
            "name": "shift",
            "sol_src": "return x + 1;",
        })
        self.assertEqual(transformation.name, "shift")
        self.assertEqual(transformation.owner, ADDR)
        self.assertEqual(transformation.address, "0x0")
        self.assertEqual(transformation.args_count, 1)
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"name": "shift", "sol_src": "return x + 1;"},
        )

        self.assertTrue(self.client.condition_exists("always"))
        self.assertFalse(self.client.condition_exists("missing"))
        self.assertEqual(self.client.condition_get("always").args_count, 0)
        condition = self.client.condition_post({"name": "gate", "sol_src": "return true;"})
        self.assertEqual(condition.name, "gate")
        self.assertEqual(condition.owner, ADDR)
        self.assertEqual(condition.address, "0x0")
        self.assertEqual(condition.args_count, 0)
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"name": "gate", "sol_src": "return true;"},
        )

    def test_execute_uses_post_body(self) -> None:
        out = self.client.execute("pitch", 8, {"0": {"start_point": 12, "transformation_shift": 3}})
        self.assertEqual(out.block_number, 7)
        self.assertEqual(out.runner, ADDR)
        self.assertEqual(out.particles[0].path, "/pitch")
        body = json.loads(self.last_request().content.decode())
        self.assertEqual(body["connector_name"], "pitch")
        self.assertEqual(body["particles_count"], 8)
        self.assertEqual(body["dynamic_ri"]["0"]["start_point"], 12)

        self.client.execute("pitch", "8")
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"connector_name": "pitch", "particles_count": "8"},
        )

    def test_simulate_uses_post_body(self) -> None:
        out = self.client.simulate("pitch", 4, {"1": {"start_point": 0, "transformation_shift": 1}})
        self.assertEqual([item.path for item in out], ["/pitch"])
        self.assertEqual(str(self.last_request().url), "https://example.invalid/chain/simulate")
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {
                "connector_name": "pitch",
                "particles_count": 4,
                "dynamic_ri": {"1": {"start_point": 0, "transformation_shift": 1}},
            },
        )

    def test_publish_prepare_and_confirm(self) -> None:
        prepared = self.client.publish_prepare("connector", "pitch")
        assert isinstance(prepared, PreparedPublication)
        self.assertEqual(prepared.transaction.chain_id, "0x1")
        self.assertEqual(
            str(self.last_request().url),
            "https://example.invalid/chain/publish/connector/prepare",
        )
        self.assertEqual(json.loads(self.last_request().content.decode()), {"name": "pitch"})

        self.assertIsInstance(self.client.publish_prepare("condition", "done"), AlreadyPublished)

        pending = self.client.publish_confirm("connector", "pitch", HASH, "0x00")
        assert isinstance(pending, PublishError)
        self.assertEqual(pending.status, "pending")

        mined = self.client.publish_confirm("connector", "pitch", HASH, TX)
        assert isinstance(mined, ConfirmResponse)
        self.assertEqual(mined.block_number, 8)
        self.assertEqual(
            str(self.last_request().url),
            "https://example.invalid/chain/publish/connector",
        )

        with self.assertRaises(ValueError):
            self.client.publish_prepare("bogus", "pitch")

    def test_publish_prepare_for_relay_and_send(self) -> None:
        prepared = self.client.publish_prepare("transformation", "shift", relay=True)
        assert isinstance(prepared, PreparedPublication)
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"name": "shift", "relay": True},
        )
        self.assertEqual(prepared.to_dict()["signing"], SIGNING)

        sent = self.client.publish_send("transformation", "shift", HASH, "0x02abcd")
        self.assertEqual(sent.tx_hash, TX)
        self.assertEqual(
            str(self.last_request().url),
            "https://example.invalid/chain/publish/transformation/send",
        )
        self.assertEqual(
            json.loads(self.last_request().content.decode()),
            {"name": "shift", "content_hash": HASH, "raw_tx": "0x02abcd"},
        )

    def test_publish_signs_locally_relays_and_confirms_until_mined(self) -> None:
        account = Account.from_key("0x" + "51" * 32)
        self.router.owner = account.address
        self.router.pending_confirms = 1

        mined = self.client.publish("transformation", "shift", account, poll_interval=0)
        assert isinstance(mined, ConfirmResponse)
        self.assertEqual(mined.tx_hash, TX)

        paths = [request.url.path for request in self.router.requests]
        self.assertEqual(paths, [
            "/chain/publish/transformation/prepare",
            "/chain/publish/transformation/send",
            "/chain/publish/transformation",
            "/chain/publish/transformation",
        ])
        sent = json.loads(self.router.requests[1].content.decode())
        self.assertEqual(sent["name"], "shift")
        self.assertEqual(sent["content_hash"], HASH)
        # A real type-2 transaction the owner's key signed.
        self.assertTrue(sent["raw_tx"].startswith("0x02"))
        self.assertEqual(Account.recover_transaction(sent["raw_tx"]), account.address)

    def test_publish_signs_with_the_account_used_to_log_in(self) -> None:
        account = Account.from_key("0x" + "51" * 32)
        self.router.owner = account.address

        # No account has logged in yet, and nothing is prepared without one.
        with self.assertRaises(RuntimeError):
            self.client.publish("transformation", "shift")
        self.assertEqual(self.router.requests, [])

        self.client.login_with_account(account)
        mined = self.client.publish("transformation", "shift", poll_interval=0)
        self.assertIsInstance(mined, ConfirmResponse)
        sent = next(
            json.loads(request.content.decode())
            for request in self.router.requests
            if request.url.path.endswith("/send")
        )
        self.assertEqual(Account.recover_transaction(sent["raw_tx"]), account.address)

        # A signature login forgets the account of an earlier login.
        self.client.login_with_signature(account.address, "Login nonce: abcd-efgh", "0xSIG")
        with self.assertRaises(RuntimeError):
            self.client.publish("transformation", "shift")

    def test_publish_signs_nothing_it_should_not(self) -> None:
        account = Account.from_key("0x" + "51" * 32)

        # Prepared for a different owner.
        with self.assertRaises(ValueError):
            self.client.publish("transformation", "shift", account)

        self.router.owner = account.address
        with self.assertRaises(ValueError):
            self.client.publish("transformation", "shift", account, chain_id=5)
        with self.assertRaises(ValueError):
            self.client.publish("transformation", "shift", account, max_fee_per_gas=1_000_000_000)

        existing = self.client.publish("transformation", "done", account)
        self.assertIsInstance(existing, AlreadyPublished)
        paths = [request.url.path for request in self.router.requests]
        self.assertFalse(any(path.endswith("/send") for path in paths))

        mined = self.client.publish(
            "transformation", "shift", account, chain_id=1, max_fee_per_gas=3_500_000_000
        )
        self.assertIsInstance(mined, ConfirmResponse)

    def test_publish_gives_up_after_the_configured_confirmation_attempts(self) -> None:
        account = Account.from_key("0x" + "51" * 32)
        self.router.owner = account.address
        self.router.pending_confirms = 10

        with self.assertRaises(TimeoutError):
            self.client.publish(
                "transformation", "shift", account, poll_interval=0, max_confirm_attempts=3
            )
        paths = [request.url.path for request in self.router.requests]
        self.assertEqual(paths.count("/chain/publish/transformation"), 3)

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
