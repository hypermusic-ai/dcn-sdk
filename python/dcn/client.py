from __future__ import annotations
from dataclasses import dataclass

from typing import Optional, Dict, Any
import requests
from eth_account import Account

from .api import get_account

@dataclass
class Client:
    session : requests.Session
    account : Account
    timeout : float

    def __init__( self, *, private_key: Optional[str] = None,
                 session: Optional[requests.Session] = None, timeout: float = 10.0 ):
        self.session = session or requests.Session()
        self.account = get_account(private_key)
        self.timeout = timeout
