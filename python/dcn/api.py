from __future__ import annotations
from typing import Optional, Dict, Any
import os
import sys
import json
import requests
from eth_account import Account
from eth_account.messages import encode_defunct

DEFAULT_DCN_API_BASE = "https://api.decentralised.art"

def _get_api_base() -> str:
    return os.getenv("DCN_API_BASE") or DEFAULT_DCN_API_BASE

def _handle_response(r: requests.Response) -> Any:
    try:
        data = r.json()
    except json.JSONDecodeError:
        r.raise_for_status()
        return {"raw": r.text}
    r.raise_for_status()
    return data

def _get_nonce(address: str, timeout: float = 10.0) -> str:
    r = requests.get(f"{_get_api_base()}/nonce/{address}", headers={"Accept": "application/json"}, timeout=timeout)
    data = _handle_response(r)
    if isinstance(data, dict) and "nonce" in data:
        return str(data["nonce"])
    raise ValueError(f"Unexpected nonce response shape: {data!r}")



def get_account(private_key: Optional[str] = None) -> Account:
    """
    Resolve an Ethereum account from (in order): explicit arg, DCN_PRIVATE_KEY env,
    otherwise create an ephemeral local account.
    """
    priv = (
        private_key
        or os.getenv("DCN_PRIVATE_KEY")
    )
    return Account.from_key(priv) if priv else Account.create()

def post_auth(account: Account, timeout: float = 10.0) -> Dict[str, Any]:
    """
    Calls POST {api_base}/auth with a signed nonce message.

    Returns parsed JSON (e.g. access_token / refresh_token).
    """

    nonce = _get_nonce(account.address, timeout=timeout)
    message_text = f"Login nonce: {nonce}"
    signature = account.sign_message(encode_defunct(text=message_text)).signature.hex()

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    payload = {
        "address": account.address,
        "message": message_text,
        "signature": signature
    }

    r = requests.post(f"{_get_api_base()}/auth", headers=headers, json=payload, timeout=timeout)
    return _handle_response(r)

def post_refresh(access_token: str, refresh_token: str, timeout: float = 10.0) -> dict:
    """
    Calls /refresh using headers:
      - Authorization: Bearer <access_token>
      - X-Refresh-Token: <refresh_token>

    Returns parsed JSON (expected to include new access_token and refresh_token).
    """

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {access_token}",
        "X-Refresh-Token": refresh_token,
    }

    payload={}
    
    r = requests.post(f"{_get_api_base()}/refresh", headers=headers, json=payload, timeout=timeout)
    return _handle_response(r)
