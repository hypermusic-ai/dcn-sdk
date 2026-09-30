from __future__ import annotations

from eth_account.messages import encode_defunct
from eth_account.signers.local import LocalAccount


def sign_login_nonce(account: LocalAccount, nonce: str) -> tuple[str, str]:
    message_text = f"Login nonce: {nonce}"
    sig = account.sign_message(encode_defunct(text=message_text)).signature.hex()
    return message_text, sig
