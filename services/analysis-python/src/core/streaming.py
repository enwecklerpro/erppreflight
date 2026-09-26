"""
ERP Preflight — bounded-memory artifact streaming for multi-GB logs.

The NestJS API streams large artifacts from object storage to ``POST /api/v1/analyze/stream`` instead of
buffering them (the analysis service still never talks to storage itself). The request body is framed as::

    <one line of JSON: the AnalysisRequest metadata, without raw_content>\\n
    <the artifact bytes, unmodified>

The artifact part is spooled to a temporary file in fixed-size chunks while its SHA-256, size and line count are
computed; engines then read it line by line (possibly in several passes) through :class:`LineSource`. Nothing
ever holds the whole artifact in memory. The same :class:`LineSource` interface wraps inline text
(:class:`TextLineSource`) so engines implement ONE line-based code path for both transports and produce
identical findings for identical input.
"""

from __future__ import annotations

import codecs
import hashlib
import os
import tempfile
from typing import AsyncIterator, Iterator, Optional, Tuple

CHUNK_SIZE = 1024 * 1024
MAX_METADATA_BYTES = 1024 * 1024
HEAD_SAMPLE_BYTES = 64 * 1024
# A single line longer than this is cut (the remainder is skipped) so one newline-free region cannot defeat the
# memory bound. Applied identically to inline text so both transports see the same lines.
MAX_LINE_BYTES = 1024 * 1024


def _bounded_line(line: str) -> str:
    if len(line) * 4 <= MAX_LINE_BYTES:
        return line
    data = line.encode("utf-8", errors="surrogatepass")
    if len(data) <= MAX_LINE_BYTES:
        return line
    return data[:MAX_LINE_BYTES].decode("utf-8", errors="replace")


class StreamFramingError(ValueError):
    """The request body does not start with a JSON metadata line."""


class StreamTooLargeError(ValueError):
    def __init__(self, limit_bytes: int):
        super().__init__(f"Streamed artifact exceeds the {limit_bytes} byte limit.")
        self.limit_bytes = limit_bytes


class LineSource:
    """Re-iterable source of (1-indexed line number, line) pairs.

    Lines are split on ``\\n``; a trailing ``\\r`` is removed (CRLF logs). Iterating twice yields the same lines."""

    size_bytes: int = 0
    sha256: str = ""
    line_count: int = 0
    transport: str = "INLINE"

    def iter_lines(self) -> Iterator[Tuple[int, str]]:  # pragma: no cover - interface
        raise NotImplementedError

    def head_text(self, max_bytes: int = HEAD_SAMPLE_BYTES) -> str:  # pragma: no cover - interface
        raise NotImplementedError


class TextLineSource(LineSource):
    """Inline payload already in memory (``raw_content``)."""

    transport = "INLINE"

    def __init__(self, text: str):
        self._text = text
        data = text.encode("utf-8", errors="surrogatepass")
        self.size_bytes = len(data)
        self.sha256 = hashlib.sha256(data).hexdigest()
        self.line_count = text.count("\n") + (0 if not text or text.endswith("\n") else 1)

    def iter_lines(self) -> Iterator[Tuple[int, str]]:
        start = 0
        text = self._text
        n = len(text)
        line_no = 0
        while start < n:
            end = text.find("\n", start)
            if end == -1:
                end = n
            line_no += 1
            line = text[start:end]
            if line.endswith("\r"):
                line = line[:-1]
            yield line_no, _bounded_line(line)
            start = end + 1

    def head_text(self, max_bytes: int = HEAD_SAMPLE_BYTES) -> str:
        return _cut_at_line(self._text[:max_bytes], complete=len(self._text) <= max_bytes)


def _cut_at_line(sample: str, complete: bool) -> str:
    if complete:
        return sample
    cut = sample.rfind("\n")
    return sample[: cut + 1] if cut > 0 else sample


class SpooledArtifact(LineSource):
    """Artifact body spooled to a temporary file (bounded memory, any size up to the configured limit)."""

    transport = "STREAM"

    def __init__(self, path: str, size_bytes: int, sha256: str, line_count: int):
        self.path = path
        self.size_bytes = size_bytes
        self.sha256 = sha256
        self.line_count = line_count

    def iter_lines(self) -> Iterator[Tuple[int, str]]:
        """Reads 1 MiB chunks through an incremental UTF-8 decoder and splits them into lines.

        Memory: one chunk plus at most one partial line (capped at MAX_LINE_BYTES characters — an over-long line
        is cut to its first MAX_LINE_BYTES bytes exactly like :class:`TextLineSource` does, the rest is skipped)."""
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        line_no = 0
        carry = ""
        skipping = False  # inside the remainder of an over-long line
        with open(self.path, "rb") as fh:
            while True:
                data = fh.read(CHUNK_SIZE)
                final = not data
                text = decoder.decode(data, final=final)
                if text:
                    parts = text.split("\n")
                    last = parts.pop()  # text after the final newline of this chunk (partial line)
                    for part in parts:
                        if skipping:
                            skipping = False  # the over-long line ends here; it was already emitted
                            continue
                        line = carry + part if carry else part
                        carry = ""
                        line_no += 1
                        if line.endswith("\r"):
                            line = line[:-1]
                        yield line_no, _bounded_line(line)
                    if not skipping:
                        carry = carry + last if carry else last
                        if len(carry) > MAX_LINE_BYTES:
                            # >= MAX_LINE_BYTES bytes without a newline: emit the bounded prefix now, skip the rest.
                            line_no += 1
                            yield line_no, _bounded_line(carry[: MAX_LINE_BYTES + 1])
                            carry = ""
                            skipping = True
                if final:
                    break
        if carry and not skipping:
            line_no += 1
            if carry.endswith("\r"):
                carry = carry[:-1]
            yield line_no, _bounded_line(carry)

    def head_text(self, max_bytes: int = HEAD_SAMPLE_BYTES) -> str:
        with open(self.path, "rb") as fh:
            sample = fh.read(max_bytes)
        return _cut_at_line(sample.decode("utf-8", errors="replace"), complete=self.size_bytes <= max_bytes)

    def close(self) -> None:
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass

    def __enter__(self) -> "SpooledArtifact":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


async def read_framed_stream(
    chunks: AsyncIterator[bytes],
    max_artifact_bytes: int,
    spool_dir: Optional[str] = None,
) -> Tuple[bytes, SpooledArtifact]:
    """Splits a framed body into (metadata JSON bytes, spooled artifact).

    Raises :class:`StreamFramingError` when no metadata line arrives within ``MAX_METADATA_BYTES`` and
    :class:`StreamTooLargeError` once the artifact part exceeds ``max_artifact_bytes`` (reading stops there)."""
    header = bytearray()
    metadata: Optional[bytes] = None
    digest = hashlib.sha256()
    size = 0
    newlines = 0
    last_byte = b""
    fd, path = tempfile.mkstemp(prefix="erpp-stream-", suffix=".log", dir=spool_dir or None)
    try:
        with os.fdopen(fd, "wb") as out:
            async for chunk in chunks:
                if not chunk:
                    continue
                if metadata is None:
                    header.extend(chunk)
                    nl = header.find(b"\n")
                    if nl == -1:
                        if len(header) > MAX_METADATA_BYTES:
                            raise StreamFramingError("metadata line exceeds 1 MiB or is missing")
                        continue
                    metadata = bytes(header[:nl])
                    chunk = bytes(header[nl + 1:])
                    header.clear()
                    if not chunk:
                        continue
                size += len(chunk)
                if size > max_artifact_bytes:
                    raise StreamTooLargeError(max_artifact_bytes)
                digest.update(chunk)
                newlines += chunk.count(b"\n")
                last_byte = chunk[-1:]
                out.write(chunk)
        if metadata is None:
            if header.strip():
                metadata = bytes(header)
            else:
                raise StreamFramingError("empty request body")
        line_count = newlines + (1 if size and last_byte != b"\n" else 0)
        return metadata, SpooledArtifact(path, size, digest.hexdigest(), line_count)
    except BaseException:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        raise


__all__ = [
    "LineSource",
    "TextLineSource",
    "SpooledArtifact",
    "StreamFramingError",
    "StreamTooLargeError",
    "read_framed_stream",
    "HEAD_SAMPLE_BYTES",
]
