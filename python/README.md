# Python DCN SDK

## Quick Start

```python
from eth_account import Account
import dcn

sdk = dcn.Client()  # https://api.decentralised.art/chain

version = sdk.version()
print(version["version"], version["build_timestamp"])

connector = sdk.connector_get("pitch")
print(connector["format_hash"])

feed = sdk.feed(limit=10, include_unfinalized=True)
print([item["payload"]["name"] for item in feed["items"]])

account = Account.create()
sdk.login_with_account(account)

result = sdk.execute(
    "pitch",
    8,
    {"0": {"start_point": 12, "transformation_shift": 3}},
)
print(result)
```

The SDK defaults to the chain API base URL, `https://api.decentralised.art/chain`.
Set `DCN_API_BASE` or pass `Client(base_url=...)` to target another chain API.

## Code Generation

The package keeps `spec/api.yaml` as an aggregate OpenAPI contract. Generated
clients can be regenerated manually:

```bash
cd python
python gen_client.py
```

## Testing

```bash
pip install -e '.[test]'
python -m unittest discover -s tests -p 'test_*.py' -v
```
