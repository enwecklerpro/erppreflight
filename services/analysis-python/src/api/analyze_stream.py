"""Streaming analysis transport for multi-GB artifacts (MFS BlackBox telegram logs).

``POST /api/v1/analyze/stream`` — body framing (see ``src/core/streaming.py``)::

    {"job_id": …, "tenant_id": …, "project_id": …, "engine_type": "MFS_BLACKBOX", …}\\n
    <artifact bytes>

The metadata line is an :class:`AnalysisRequest` without ``raw_content`` / ``artifacts``. The artifact part is
spooled to disk in 1 MiB chunks (never held in memory), bounded by ``MAX_STREAM_SIZE_MB``, then evaluated line
by line by the engine's ``analyze_stream``. The response is the same :class:`AnalysisResponse` as
``/api/v1/analyze``; the NestJS API uses this endpoint for large delimited logs instead of buffering them.
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import ValidationError

from src.config import get_settings
from src.core.exceptions import EngineNotFoundError
from src.core.registry import EngineRegistry
from src.core.runner import EngineRunner
from src.core.streaming import StreamFramingError, StreamTooLargeError, read_framed_stream
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse
from src.observability import engine_span

router = APIRouter(prefix="/api/v1", tags=["Analysis"])
logger = logging.getLogger("erppreflight.analysis.stream")

STREAM_PATH = "/api/v1/analyze/stream"


def _parse_metadata(raw: bytes) -> AnalysisRequest:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Stream metadata line is not valid JSON: {exc}") from None
    if not isinstance(data, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Stream metadata line must be a JSON object.")
    if data.get("raw_content") or data.get("artifacts"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Stream metadata must not carry raw_content or artifacts; the artifact is the request body.",
        )
    if data.get("raw_content_encoding", "utf-8") != "utf-8":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The streaming transport accepts text artifacts only.")
    try:
        return AnalysisRequest.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            [{"loc": list(e.get("loc", ())), "msg": e.get("msg")} for e in exc.errors(include_url=False, include_input=False)],
        ) from None


@router.post("/analyze/stream", response_model=AnalysisResponse)
async def analyze_stream(http_request: Request) -> AnalysisResponse:
    """Streams a large artifact through a streaming-capable engine with bounded memory."""
    settings = get_settings()
    limit = int(settings.MAX_STREAM_SIZE_MB) * 1024 * 1024
    try:
        metadata, artifact = await read_framed_stream(
            http_request.stream(), max_artifact_bytes=limit, spool_dir=settings.STREAM_SPOOL_DIR or None
        )
    except StreamFramingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid stream framing: {exc}") from None
    except StreamTooLargeError as exc:
        raise HTTPException(413, str(exc)) from None

    with artifact:
        request = _parse_metadata(metadata)
        try:
            engine = EngineRegistry.get(request.engine_type)
        except EngineNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None
        if not engine.supports_streaming:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Engine '{request.engine_type.value}' does not support the streaming transport.",
            )
        with engine_span(request.engine_type.value) as span:
            try:
                # Line-by-line evaluation is CPU-bound: keep the event loop responsive for health checks.
                response = await asyncio.to_thread(_run_sync, request, artifact)
            except Exception as exc:  # noqa: BLE001
                span.record_exception(exc)
                logger.exception("streamed analysis failed for job %s", request.job_id)
                raise HTTPException(
                    status.HTTP_500_INTERNAL_SERVER_ERROR, "Analysis execution failed due to an internal error."
                ) from None
            span.set_attribute("erppreflight.analysis.status", str(response.status.value))
            span.set_attribute("erppreflight.findings.count", len(response.findings))
            span.set_attribute("erppreflight.stream.bytes", int(artifact.size_bytes))
        logger.info(
            "streamed analysis job=%s engine=%s bytes=%d lines=%d status=%s findings=%d",
            request.job_id, request.engine_type.value, artifact.size_bytes, artifact.line_count,
            response.status.value, len(response.findings),
        )
        return response


def _run_sync(request: AnalysisRequest, artifact) -> AnalysisResponse:
    return asyncio.run(EngineRunner.execute_stream(request, artifact))
