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

account = Account.create()
sdk.login_with_account(account)

result = sdk.execute(
    "pitch",
    8,
    {"0": {"start_point": 12, "transformation_shift": 3}},
)
print(result[0].path)
```

The SDK defaults to the chain API base URL, `https://api.decentralised.art/chain`.
Set `DCN_API_BASE` or pass `Client(base_url=...)` to target another chain API.

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
