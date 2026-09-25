"""
ERP Preflight — Safe ZIP Reader (AGENTS.md §4.5 Archive Protection)

Memory-bounded archive access that never trusts central-directory size headers:
- maximum 100:1 expansion ratio (total and per entry, measured on actual decompressed bytes)
- maximum 500 MB total uncompressed volume (running counter across all reads)
- maximum entry count
- path traversal / absolute path rejection
- nested archives are not expanded (at most one level is opened by this reader)
- chunked decompression with running byte counters: reading aborts as soon as a limit is crossed
"""

from __future__ import annotations

import io
import zipfile
from typing import Dict, List, Optional

from src.core.exceptions import SecurityViolationError

MAX_COMPRESSION_RATIO = 100
MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
MAX_ENTRIES = 1000
MAX_ENTRY_BYTES = 100 * 1024 * 1024
READ_CHUNK_BYTES = 64 * 1024
# Small members legitimately compress very well (e.g. a 4 KB XML of repeated tags); the ratio
# check only applies once an entry has produced more than this many bytes.
RATIO_GRACE_BYTES = 1024 * 1024


class ArchiveSecurityError(SecurityViolationError):
    """Raised when an archive violates ingestion safety limits (zip bomb, zip slip, too many entries)."""


def _is_unsafe_member_name(name: str) -> bool:
    normalized = name.replace("\\", "/")
    if normalized.startswith("/") or (len(normalized) > 1 and normalized[1] == ":"):
        return True
    return any(part == ".." for part in normalized.split("/"))


class SafeZipReader:
    """Bounded, read-only view over an in-memory ZIP archive."""

    def __init__(
        self,
        data: bytes,
        max_ratio: int = MAX_COMPRESSION_RATIO,
        max_total_bytes: int = MAX_TOTAL_UNCOMPRESSED_BYTES,
        max_entries: int = MAX_ENTRIES,
        max_entry_bytes: int = MAX_ENTRY_BYTES,
    ) -> None:
        if not isinstance(data, (bytes, bytearray)):
            raise ArchiveSecurityError("Archive payload must be bytes.")
        self.max_ratio = max_ratio
        self.max_total_bytes = max_total_bytes
        self.max_entry_bytes = max_entry_bytes
        self.compressed_size = max(len(data), 1)
        self.total_read = 0
        try:
            self._zf = zipfile.ZipFile(io.BytesIO(bytes(data)), "r")
        except (zipfile.BadZipFile, zipfile.LargeZipFile, ValueError, OSError) as exc:
            raise ArchiveSecurityError(f"Malformed ZIP archive: {exc}") from exc

        infos = self._zf.infolist()
        if len(infos) > max_entries:
            raise ArchiveSecurityError(f"Archive contains {len(infos)} entries (limit {max_entries}).")
        self._infos: Dict[str, zipfile.ZipInfo] = {}
        for info in infos:
            if _is_unsafe_member_name(info.filename):
                raise ArchiveSecurityError(f"Archive member path traversal rejected: {info.filename!r}")
            if info.flag_bits & 0x1:
                raise ArchiveSecurityError(f"Encrypted archive member rejected: {info.filename!r}")
            self._infos[info.filename] = info

    def __enter__(self) -> "SafeZipReader":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def close(self) -> None:
        self._zf.close()

    def namelist(self) -> List[str]:
        return list(self._infos.keys())

    def read(self, name: str) -> bytes:
        """Reads a member in chunks, enforcing per-entry, total and ratio limits on real output bytes."""
        info = self._infos.get(name)
        if info is None:
            raise KeyError(name)
        if info.is_dir():
            return b""
        out = bytearray()
        member_compressed = max(info.compress_size, 1)
        try:
            with self._zf.open(info, "r") as fh:
                while True:
                    chunk = fh.read(READ_CHUNK_BYTES)
                    if not chunk:
                        break
                    out.extend(chunk)
                    self.total_read += len(chunk)
                    if len(out) > self.max_entry_bytes:
                        raise ArchiveSecurityError(
                            f"Archive member {name!r} exceeds {self.max_entry_bytes} uncompressed bytes."
                        )
                    if self.total_read > self.max_total_bytes:
                        raise ArchiveSecurityError(
                            f"Archive exceeds {self.max_total_bytes} total uncompressed bytes."
                        )
                    if len(out) > RATIO_GRACE_BYTES and len(out) > member_compressed * self.max_ratio:
                        raise ArchiveSecurityError(
                            f"Archive member {name!r} exceeds {self.max_ratio}:1 expansion ratio."
                        )
                    if self.total_read > RATIO_GRACE_BYTES and self.total_read > self.compressed_size * self.max_ratio:
                        raise ArchiveSecurityError(f"Archive exceeds {self.max_ratio}:1 total expansion ratio.")
        except ArchiveSecurityError:
            raise
        except (zipfile.BadZipFile, zipfile.LargeZipFile, NotImplementedError, EOFError, OSError, ValueError, RuntimeError) as exc:
            raise ArchiveSecurityError(f"Archive member {name!r} could not be decompressed: {exc}") from exc
        return bytes(out)

    def read_optional(self, name: str) -> Optional[bytes]:
        return self.read(name) if name in self._infos else None


def open_safe_zip(data: bytes, **limits) -> SafeZipReader:
    return SafeZipReader(data, **limits)


__all__ = [
    "ArchiveSecurityError",
    "SafeZipReader",
    "open_safe_zip",
    "MAX_COMPRESSION_RATIO",
    "MAX_TOTAL_UNCOMPRESSED_BYTES",
    "MAX_ENTRIES",
]
