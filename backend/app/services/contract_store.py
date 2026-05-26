"""
Ephemeral in-memory store for extracted contract text.
Keys are UUID4 strings. No persistence required — the file_id only
needs to survive the upload→analyze two-step flow within a single session.
"""
import uuid
from typing import Optional


class ContractStore:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def save(self, text: str) -> str:
        """Store contract text and return a new UUID file_id."""
        file_id = str(uuid.uuid4())
        self._store[file_id] = text
        return file_id

    def get(self, file_id: str) -> Optional[str]:
        """Return text for the given file_id, or None if not found."""
        return self._store.get(file_id)

    def delete(self, file_id: str) -> None:
        """Remove an entry (no-op if not present)."""
        self._store.pop(file_id, None)
