# Python DCN SDK

## Quickstart

```python
from eth_account import Account
import dcn

# Create an ephemeral account (or use your own private key)
acct = Account.create()

# Client points to the public DCN API by default:
# "https://api.decentralised.art"
sdk = dcn.Client()

# Authenticate (nonce + ECDSA sign under the hood)
sdk.login_with_account(acct)

# Create a transformation
sdk.transformation_post({
    "name": "add",
    "sol_src": "return x + args[0];"
})

# Create a feature with dimensions & transformations
sdk.feature_post({
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

# Execute a feature for N samples
result = sdk.execute("melody", 64)

# Execute a feature for N samples with Running Instances
result = sdk.execute("melody", 64, [(12,3),(1,1)])

# Obtain objects data
transform_info = sdk.transformation_get("add")
feature_info = sdk.feature_get("melody")
```

## JSON → model convenience

The Python wrapper accepts plain dicts/lists and converts them to the generated model classes for you.

These two calls are equivalent:

```python
# Convenient dicts
sdk.feature_post({"name":"melody","dimensions":[{"feature_name":"pitch","transformations":[{"name":"add","args":[1]}]}]})

# Explicit model usage (if you prefer)
from dcn.dcn_api_client.models import FeatureCreateRequest, FeatureDimensionCreateRequest, TransformationRef
req = FeatureCreateRequest(
    name="melody",
    dimensions=[
        FeatureDimensionCreateRequest(
            feature_name="pitch",
            transformations=[TransformationRef(name="add", args=[1])]
        )
    ],
)
sdk.feature_post(req)
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
