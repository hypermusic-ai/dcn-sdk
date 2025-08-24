from __future__ import annotations
from typing import Optional


class DcnError(Exception):
    """Base SDK error."""


class DcnHTTPError(DcnError):
    def __init__(self, status: int, body: Optional[object] = None, message: str = ""):
        super().__init__(message or f"HTTP {status}")
        self.status = status
        self.body = body


class DcnAuthError(DcnError):
    """Auth / token problems."""


class DcnValidationError(DcnError):
    """Local model validation failed."""
