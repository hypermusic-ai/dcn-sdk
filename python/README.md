# Python DCN SDK

## Install

Install a pinned GitHub Release:

```bash
pip install "dcn @ https://github.com/hypermusic-ai/dcn-sdk/releases/download/v0.1.0/dcn-python-sdk.tar.gz"
```

Install the latest GitHub Release:

```bash
pip install "dcn @ https://github.com/hypermusic-ai/dcn-sdk/releases/latest/download/dcn-python-sdk.tar.gz"
```

Prefer the pinned URL in production so installs are reproducible.

## Quick Start

```python
from eth_account import Account
import dcn

sdk = dcn.Client()  # https://api.decentralised.art/chain

version = sdk.version()
print(version.version, version.build_timestamp)

connector = sdk.connector_get("pitch")
print(connector.format_hash)

feed = sdk.feed(limit=10, include_unfinalized=True)
print([item.payload.name for item in feed.items])

# Execution needs no login.
result = sdk.execute(
    "pitch",
    8,
    {"0": {"start_point": 12, "transformation_shift": 3}},
)
print(result.block_number, result.particles[0].path)

account = Account.create()
sdk.login_with_account(account)

# Entities created through *_post are local until published by their owner.
sdk.transformation_post({"name": "shift", "sol_src": "return x + 1;"})
print(sdk.simulate("pitch", 8)[0].path)
```

The SDK defaults to the chain API base URL, `https://api.decentralised.art/chain`.
Set `DCN_API_BASE` or pass `Client(base_url=...)` to target another chain API.

### Publishing on chain

The owner pays for the publication and the server never holds their key. `publish`
needs no chain RPC endpoint. It prepares the publication, signs it locally with the
account passed to `login_with_account` (or one you pass explicitly), lets the server
broadcast it through its own node, and confirms it until mined:

```python
result = sdk.publish(
    "transformation",
    "shift",
    max_fee_per_gas=50_000_000_000,  # refuse to sign above 50 gwei
)
print(type(result).__name__)  # ConfirmResponse, or AlreadyPublished if it already was
```

The steps are also available one by one: `publish_prepare(kind, name, relay=True)`,
`publish_send(kind, name, content_hash, raw_tx)` and `publish_confirm`.

To send the transaction yourself instead, for example through your own node with
[web3.py](https://web3py.readthedocs.io/) v7 (not an SDK dependency):

```python
import time

from web3 import Web3
from web3.middleware import SignAndSendRawMiddlewareBuilder

from dcn.client import PreparedPublication

w3 = Web3(Web3.HTTPProvider("https://<chain-rpc-url>"))
w3.middleware_onion.inject(SignAndSendRawMiddlewareBuilder.build(account), layer=0)

prepared = sdk.publish_prepare("transformation", "shift")
if isinstance(prepared, PreparedPublication):
    tx = prepared.transaction  # hex quantities, as eth_sendTransaction expects
    tx_hash = w3.eth.send_transaction({
        "from": tx.from_,
        "to": tx.to,
        "data": tx.data,
        "chainId": int(tx.chain_id, 16),
        "gas": int(tx.gas, 16),
    }).to_0x_hex()

    # Confirm looks the receipt up once; repeat while it is still pending.
    confirmed = sdk.publish_confirm("transformation", "shift", prepared.content_hash, tx_hash)
    while confirmed.status == "pending":
        time.sleep(3)
        confirmed = sdk.publish_confirm("transformation", "shift", prepared.content_hash, tx_hash)
    print(confirmed.status, confirmed.tx_hash)  # "mined"
# Otherwise AlreadyPublished: the registry already holds this exact entity.
```

## Code Generation

The package generates its client from the OpenAPI source files in
`../submodules/dcn-api-spec/services`. The SDK-owned
`scripts/bundle-openapi.py` first bundles those per-service specs into one SDK
OpenAPI document under `../build/openapi/`, then `openapi-python-client`
generates `dcn/dcn_api_client`.

Generated clients can be regenerated manually:

```bash
cd python
python scripts/codegen.py
```

## Testing

```bash
pip install -e '.[test]'
python -m unittest discover -s tests -p 'test_*.py' -v
```
