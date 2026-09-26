"""
ERP Preflight — Safe ZIP Reader (AGENTS.md §4.5 Archive Protection)

Memory-bounded archive access that never trusts central-directory size headers:
- maximum 100:1 expansion ratio (per entry and in total, measured on actual decompressed bytes,
  total measured against the OUTERMOST archive's compressed size)
- maximum 500 MB total uncompressed volume (running counter shared across all nesting levels)
- maximum entry count (shared across all nesting levels)
- at most 2 nested archive levels (outer.zip -> level1.zip -> level2.zip); a third level is rejected
- nested archives are detected by magic bytes, never by file extension
- path traversal / absolute path / encrypted member rejection
- chunked decompression with running byte counters: reading aborts as soon as a limit is crossed
"""

from __future__ import annotations

import io
import zipfile
import zlib
from dataclasses import dataclass
from typing import Dict, Iterator, List, Optional, Tuple

from src.core.exceptions import SecurityViolationError

MAX_COMPRESSION_RATIO = 100
MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
MAX_ENTRIES = 1000
MAX_ENTRY_BYTES = 100 * 1024 * 1024
MAX_NESTED_ARCHIVE_LEVELS = 2
READ_CHUNK_BYTES = 64 * 1024
# Small members legitimately compress very well (e.g. a 4 KB XML of repeated tags); the ratio
# check only applies once an entry has produced more than this many bytes.
RATIO_GRACE_BYTES = 1024 * 1024
ZIP_MAGIC = b"PK\x03\x04"


class ArchiveSecurityError(SecurityViolationError):
    """Raised when an archive violates ingestion safety limits (zip bomb, zip slip, too many entries)."""


def is_zip_bytes(data: bytes) -> bool:
    return bytes(data[:4]) == ZIP_MAGIC


def _is_unsafe_member_name(name: str) -> bool:
    normalized = name.replace("\\", "/")
    if normalized.startswith("/") or (len(normalized) > 1 and normalized[1] == ":"):
        return True
    return any(part == ".." for part in normalized.split("/"))


@dataclass
class _Budget:
    """Global limits shared by an archive and every archive nested inside it."""
    outer_compressed_size: int
    max_ratio: int
    max_total_bytes: int
    max_entries: int
    max_entry_bytes: int
    total_read: int = 0
    entries_seen: int = 0


class SafeZipReader:
    """Bounded, read-only view over an in-memory ZIP archive (optionally nested inside another)."""

    def __init__(
        self,
        data: bytes,
        max_ratio: int = MAX_COMPRESSION_RATIO,
        max_total_bytes: int = MAX_TOTAL_UNCOMPRESSED_BYTES,
        max_entries: int = MAX_ENTRIES,
        max_entry_bytes: int = MAX_ENTRY_BYTES,
        max_nesting: int = MAX_NESTED_ARCHIVE_LEVELS,
        _budget: Optional[_Budget] = None,
        _level: int = 0,
        _label: str = "",
    ) -> None:
        if not isinstance(data, (bytes, bytearray)):
            raise ArchiveSecurityError("Archive payload must be bytes.")
        self.level = _level
        self.max_nesting = max_nesting
        self.label = _label
        self.budget = _budget or _Budget(
            outer_compressed_size=max(len(data), 1),
            max_ratio=max_ratio,
            max_total_bytes=max_total_bytes,
            max_entries=max_entries,
            max_entry_bytes=max_entry_bytes,
        )
        try:
            self._zf = zipfile.ZipFile(io.BytesIO(bytes(data)), "r")
            infos = self._zf.infolist()
        except (zipfile.BadZipFile, zipfile.LargeZipFile, ValueError, OSError, EOFError, RuntimeError, NotImplementedError, zlib.error):
            raise ArchiveSecurityError(f"Malformed ZIP archive{self._where()}.") from None

        self.budget.entries_seen += len(infos)
        if self.budget.entries_seen > self.budget.max_entries:
            raise ArchiveSecurityError(
                f"Archive contains more than {self.budget.max_entries} entries across all nesting levels."
            )
        self._infos: Dict[str, zipfile.ZipInfo] = {}
        for info in infos:
            if _is_unsafe_member_name(info.filename):
                raise ArchiveSecurityError(f"Archive member path traversal rejected: {info.filename!r}")
            if info.flag_bits & 0x1:
                raise ArchiveSecurityError(f"Encrypted archive member rejected: {info.filename!r}")
            self._infos[info.filename] = info

    # Backwards-compatible attribute names
    @property
    def total_read(self) -> int:
        return self.budget.total_read

    @property
    def max_ratio(self) -> int:
        return self.budget.max_ratio

    def _where(self) -> str:
        return f" (nested: {self.label})" if self.label else ""

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
        b = self.budget
        out = bytearray()
        member_compressed = max(info.compress_size, 1)
        try:
            with self._zf.open(info, "r") as fh:
                while True:
                    chunk = fh.read(READ_CHUNK_BYTES)
                    if not chunk:
                        break
                    out.extend(chunk)
                    b.total_read += len(chunk)
                    if len(out) > b.max_entry_bytes:
                        raise ArchiveSecurityError(
                            f"Archive member {name!r} exceeds {b.max_entry_bytes} uncompressed bytes."
                        )
                    if b.total_read > b.max_total_bytes:
                        raise ArchiveSecurityError(
                            f"Archive exceeds {b.max_total_bytes} total uncompressed bytes."
                        )
                    if len(out) > RATIO_GRACE_BYTES and len(out) > member_compressed * b.max_ratio:
                        raise ArchiveSecurityError(
                            f"Archive member {name!r} exceeds {b.max_ratio}:1 expansion ratio."
                        )
                    if b.total_read > RATIO_GRACE_BYTES and b.total_read > b.outer_compressed_size * b.max_ratio:
                        raise ArchiveSecurityError(f"Archive exceeds {b.max_ratio}:1 total expansion ratio.")
        except ArchiveSecurityError:
            raise
        except (zipfile.BadZipFile, zipfile.LargeZipFile, NotImplementedError, EOFError, OSError, ValueError, RuntimeError, zlib.error):
            raise ArchiveSecurityError(f"Archive member {name!r} could not be decompressed.") from None
        return bytes(out)

    def read_optional(self, name: str) -> Optional[bytes]:
        return self.read(name) if name in self._infos else None

    def open_nested(self, name: str, data: Optional[bytes] = None) -> "SafeZipReader":
        """Opens a member that is itself a ZIP archive, sharing this archive's global budget."""
        if self.level + 1 > self.max_nesting:
            raise ArchiveSecurityError(
                f"Archive nesting exceeds {self.max_nesting} levels at member {name!r}."
            )
        payload = data if data is not None else self.read(name)
        label = f"{self.label}!/{name}" if self.label else name
        return SafeZipReader(
            payload, max_nesting=self.max_nesting, _budget=self.budget, _level=self.level + 1, _label=label
        )

    def walk(self) -> Iterator[Tuple[str, bytes]]:
        """Yields (path, bytes) for every regular file, descending into nested archives (by magic
        bytes) up to MAX_NESTED_ARCHIVE_LEVELS. Paths of nested members use ``outer.zip!/inner``."""
        for name in sorted(self._infos):
            if self._infos[name].is_dir():
                continue
            data = self.read(name)
            path = f"{self.label}!/{name}" if self.label else name
            if is_zip_bytes(data):
                with self.open_nested(name, data) as nested:
                    yield from nested.walk()
            else:
                yield path, data


def open_safe_zip(data: bytes, **limits) -> SafeZipReader:
    return SafeZipReader(data, **limits)


def inspect_archive(data: bytes, **limits) -> List[Tuple[str, int]]:
    """Fully walks an archive (all nesting levels) under the global limits and returns a manifest
    of (path, uncompressed_size). Raises ArchiveSecurityError on any violation."""
    manifest: List[Tuple[str, int]] = []
    with SafeZipReader(data, **limits) as zf:
        for path, content in zf.walk():
            manifest.append((path, len(content)))
    return manifest


__all__ = [
    "ArchiveSecurityError",
    "SafeZipReader",
    "open_safe_zip",
    "inspect_archive",
    "is_zip_bytes",
    "MAX_COMPRESSION_RATIO",
    "MAX_TOTAL_UNCOMPRESSED_BYTES",
    "MAX_ENTRIES",
    "MAX_NESTED_ARCHIVE_LEVELS",
]
