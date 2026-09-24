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
