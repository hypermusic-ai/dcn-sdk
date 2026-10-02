"""decentralised.art Python library."""

from importlib.metadata import PackageNotFoundError, version

from .client import Client

__all__ = ["Client"]

try:
    __version__ = version("decentralised-art")
except PackageNotFoundError:  # running from a source tree that is not installed
    __version__ = "0.0.0"
__author__ = "decentralised.art"
__credits__ = ""
