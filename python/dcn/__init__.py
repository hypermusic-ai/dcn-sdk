"""Decentralized Creative Network Python library."""

from .api import get_account, post_auth, post_refresh
from .client import Client

__all__ = ["Client", "get_account", "post_auth", "post_refresh"]

__version__ = "0.1.0"
__author__  = "hypermusic.ai"
__credits__ = ""