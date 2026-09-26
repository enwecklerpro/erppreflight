"""Disk-exhaustion / DoS guards of the streaming transport (POST /api/v1/analyze/stream).

* the spool stops (and removes its partial file) before the volume's free space drops below the reserve;
* a declared Content-Length above the stream limit is refused before anything is spooled;
* at most MAX_CONCURRENT_STREAMS requests spool / evaluate at once; the rest wait, then get 503.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import AsyncIterator

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402

import src.api.analyze_stream as stream_api  # noqa: E402
import src.core.streaming as streaming  # noqa: E402
from src.config import get_settings  # noqa: E402
from src.core.streaming import SpoolDiskFullError, read_framed_stream  # noqa: E402


async def _chunks(data: bytes, size: int) -> AsyncIterator[bytes]:
    for i in range(0, len(data), size):
        yield data[i:i + size]


def test_spool_stops_below_free_disk_reserve(tmp_path, monkeypatch):
    monkeypatch.setattr(streaming, "_free_bytes", lambda _d: 10 * 1024 * 1024)  # 10 MiB free
    body = b"{}\n" + b"a,b\n" * 1000
    with pytest.raises(SpoolDiskFullError):
        asyncio.run(read_framed_stream(_chunks(body, 512), 1 << 30, str(tmp_path), min_free_bytes=1024 * 1024))
    assert list(tmp_path.iterdir()) == []  # partial spool removed


def test_spool_passes_with_enough_free_space(tmp_path, monkeypatch):
    monkeypatch.setattr(streaming, "_free_bytes", lambda _d: 1 << 40)
    meta, art = asyncio.run(
        read_framed_stream(_chunks(b"{}\nx\ny\n", 3), 1 << 30, str(tmp_path), min_free_bytes=1024 * 1024)
    )
    with art:
        assert meta == b"{}" and art.line_count == 2


META = {"job_id": "adm", "tenant_id": "t", "project_id": "p", "engine_type": "MFS_BLACKBOX",
        "artifact_s3_key": "tenants/t/projects/p/f/log.csv", "artifact_type": "CSV"}


def test_endpoint_answers_507_when_disk_reserve_reached(client, monkeypatch):
    monkeypatch.setattr(streaming, "_free_bytes", lambda _d: 0)
    res = client.post("/api/v1/analyze/stream", content=json.dumps(META).encode() + b"\na,b\n1,2\n")
    assert res.status_code == 507, res.text


def test_endpoint_rejects_declared_oversize_before_spooling(client, monkeypatch):
    small = get_settings().model_copy(update={"MAX_STREAM_SIZE_MB": 1})
    monkeypatch.setattr(stream_api, "get_settings", lambda: small)
    called = []
    monkeypatch.setattr(stream_api, "read_framed_stream", lambda *a, **k: called.append(1))
    res = client.post(
        "/api/v1/analyze/stream",
        content=b"x",
        headers={"content-length": str(50 * 1024 * 1024)},
    )
    assert res.status_code == 413
    assert called == []


def test_admission_waits_then_503(monkeypatch):
    monkeypatch.setattr(stream_api, "_SLOT_POLL_SECONDS", 0.01)

    async def scenario():
        async with stream_api._stream_slot(1, 1):
            assert stream_api._active_streams == 1
            with pytest.raises(HTTPException) as exc:
                async with stream_api._stream_slot(1, 0.05):
                    pass  # pragma: no cover
            assert exc.value.status_code == 503
        assert stream_api._active_streams == 0
        # A freed slot is taken by the next waiter.
        async with stream_api._stream_slot(1, 0.05):
            assert stream_api._active_streams == 1

    asyncio.run(scenario())
    assert stream_api._active_streams == 0
