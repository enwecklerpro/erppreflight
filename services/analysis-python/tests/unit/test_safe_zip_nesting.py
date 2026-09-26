"""SafeZipReader nesting and shared global budgets (AGENTS.md §4.5)."""

from __future__ import annotations

import io
import zipfile

import pytest

from src.parsers.safe_zip import (
    MAX_NESTED_ARCHIVE_LEVELS,
    ArchiveSecurityError,
    SafeZipReader,
    inspect_archive,
)


def _zip(members: dict, compression=zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _nest(levels: int, leaf: bytes = b'{"collections": []}') -> bytes:
    """levels=1: outer zip containing the leaf; levels=n: n-1 archives nested inside the outer one."""
    data, name = leaf, "manifest.json"
    for i in range(levels):
        data, name = _zip({name: data}), f"level{i}.zip"
    return data


def test_max_nesting_constant_is_two():
    assert MAX_NESTED_ARCHIVE_LEVELS == 2


@pytest.mark.parametrize("levels", [1, 2, 3])
def test_nesting_up_to_two_levels_is_walked(levels):
    manifest = inspect_archive(_nest(levels))
    assert len(manifest) == 1
    path, size = manifest[0]
    assert path.endswith("manifest.json") and size > 0
    assert path.count("!/") == levels - 1


def test_third_nested_level_is_rejected():
    with pytest.raises(ArchiveSecurityError, match="nesting exceeds 2 levels"):
        inspect_archive(_nest(4))


def test_nested_archive_detected_by_magic_bytes_not_extension():
    inner = _zip({"a.txt": b"hello"})
    outer = _zip({"innocent.txt": inner})
    with SafeZipReader(outer) as zf:
        paths = [p for p, _ in zf.walk()]
    assert paths == ["innocent.txt!/a.txt"]


def test_entry_budget_is_shared_across_levels():
    inner = _zip({f"f{i}.txt": b"x" for i in range(6)})
    outer = _zip({"inner.zip": inner, "a.txt": b"1"})
    with pytest.raises(ArchiveSecurityError, match="entries"):
        inspect_archive(outer, max_entries=5)


def test_total_uncompressed_budget_is_shared_across_levels():
    inner = _zip({"big.bin": b"\0" * 400_000})
    outer = _zip({"inner.zip": inner, "other.bin": b"\1" * 400_000}, compression=zipfile.ZIP_STORED)
    with pytest.raises(ArchiveSecurityError, match="total uncompressed"):
        inspect_archive(outer, max_total_bytes=500_000)


def test_nested_zip_bomb_ratio_rejected():
    inner = _zip({"bomb.bin": b"\0" * (30 * 1024 * 1024)})
    outer = _zip({"inner.zip": inner})
    with pytest.raises(ArchiveSecurityError, match="expansion ratio"):
        inspect_archive(outer)


def test_path_traversal_inside_nested_archive_rejected():
    inner = _zip({"../../etc/passwd": b"x"})
    outer = _zip({"inner.zip": inner})
    with pytest.raises(ArchiveSecurityError, match="path traversal"):
        inspect_archive(outer)


def test_malformed_nested_archive_rejected_without_exception_text():
    outer = _zip({"inner.zip": b"PK\x03\x04garbage-not-a-zip"})
    with pytest.raises(ArchiveSecurityError) as exc:
        inspect_archive(outer)
    assert "Malformed ZIP archive (nested: inner.zip)" in str(exc.value)
