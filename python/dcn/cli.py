import json
from .api import get_account, post_auth

def main() -> None:
    acct = get_account()
    result = post_auth(acct)
    print(json.dumps(result, indent=2))