# Python DCN SDK

## Quickstart

```python
from eth_account import Account
import dcn

# Create an ephemeral account (or use your own private key)
acct = Account.create()

# Client points to the public DCN API by default:
# https://api.decentralised.art
sdk_client = dcn.Client()

# Read API server version
version = sdk_client.version()

# Get account information
acc_info = sdk_client.account_info("a616c5cb71e76c253808d90daba4540bfe6cc863", limit = 10, page = 1)

# Obtain feature data
feature_info = sdk_client.feature_get("pitch")

# Obtain transformation data
transform_info = sdk_client.transformation_get("mul")

# Authenticate (nonce + ECDSA sign under the hood)
sdk_client.login_with_account(acct)

# Create a transformation, need to be logged first
sdk_client.transformation_post({
    "name": "add",
    "sol_src": "return x + args[0];"
})

# Create a feature with dimensions & transformations, need to be logged first
sdk_client.feature_post({
  "name": "melody",
  "dimensions": [
    {
      "feature_name": "pitch",
      "transformations": [
        {"name": "add", "args": [1]},
        {"name": "mul", "args": [2]}
      ]
    },
    {"feature_name": "time", "transformations": []}
  ]
})

# Execute a feature for N samples, need to be logged first
result = sdk_client.execute("melody", 64)

# Execute a feature for N samples with Running Instances, need to be logged first
result = sdk_client.execute("melody", 64, [(12,3),(1,1)])
```

## Code generation

We use `openapi-python-client` to generate `dcn_api_client` from `spec/api.yaml`.

Automatic during pip build via `python/hatch_build.py`

Manual (from `/python` directory):

```bash
pipx install openapi-python-client
cd python
python gen_client.py
```

This regenerates the client into `python/dcn/dcn_api_client`

## Testing

To install test target run:

```bash
pip install -e '.[test]'
```
