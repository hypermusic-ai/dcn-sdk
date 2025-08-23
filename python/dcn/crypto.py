from __future__ import annotations
from eth_account import Account
from eth_account.messages import encode_defunct

def sign_login_nonce(account: Account, nonce: str) -> tuple[str, str]:
    message_text = f"Login nonce: {nonce}"
    sig = account.sign_message(encode_defunct(text=message_text)).signature.hex()
    return message_text, sig
