import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Injects and propagates X-Correlation-ID and X-Process-Time headers."""

    async def dispatch(self, request: Request, call_next) -> Response:
        correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
        start_time = time.perf_counter()

        response = await call_next(request)

        process_time_ms = int((time.perf_counter() - start_time) * 1000)
        response.headers["X-Correlation-ID"] = correlation_id
        response.headers["X-Process-Time-Ms"] = str(process_time_ms)
        return response


class PayloadSizeLimitMiddleware(BaseHTTPMiddleware):
    """Rejects requests whose declared Content-Length exceeds MAX_PAYLOAD_SIZE_MB with HTTP 413.

    EngineRunner additionally enforces the limit on decoded payload bytes (bodies without a length header)."""

    def __init__(self, app, max_bytes: int):
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next) -> Response:
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                too_large = int(declared) > self.max_bytes
            except ValueError:
                return Response("Invalid Content-Length header.", status_code=400)
            if too_large:
                return Response(
                    f"Payload exceeds the {self.max_bytes} byte limit.",
                    status_code=413,
                )
        return await call_next(request)
