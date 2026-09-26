"""OpenTelemetry tracing for the analysis service (opt-in, fail-open).

Tracing is enabled only when ``OTEL_EXPORTER_OTLP_ENDPOINT`` (or the traces-specific
``OTEL_EXPORTER_OTLP_TRACES_ENDPOINT``) is set AND the optional ``otel`` extra is installed
(``pip install .[otel]``). Otherwise every helper here is a no-op, so the deterministic engines
never depend on telemetry being available.

The API propagates W3C ``traceparent`` headers on its calls to this service, so spans produced
here join the same distributed trace as the NestJS request / BullMQ job that dispatched them.

Spans never carry artifact content, tenant identifiers or finding text: only engine type,
status, counts and durations.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any, Iterator, Optional

logger = logging.getLogger("erppreflight.observability")

_tracer: Any = None
_provider: Any = None


def tracing_endpoint() -> Optional[str]:
    return (
        os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
        or os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        or None
    )


def is_enabled() -> bool:
    return _tracer is not None


def setup_tracing(app: Any, service_name: str, service_version: str, environment: str) -> bool:
    """Instruments ``app`` with OpenTelemetry when configured. Returns True when tracing is active."""
    global _tracer, _provider
    if _tracer is not None:
        return True
    if not tracing_endpoint() or os.environ.get("OTEL_SDK_DISABLED", "").lower() == "true":
        return False
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        logger.warning(
            "OTEL_EXPORTER_OTLP_ENDPOINT is set but the OpenTelemetry packages are not installed "
            "(install the 'otel' extra); tracing disabled."
        )
        return False

    resource = Resource.create(
        {
            "service.name": os.environ.get("OTEL_SERVICE_NAME", service_name),
            "service.version": service_version,
            "deployment.environment": environment,
        }
    )
    provider = TracerProvider(resource=resource)
    # The exporter reads OTEL_EXPORTER_OTLP_* (endpoint, headers, timeout) from the environment.
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=provider,
        excluded_urls="health,metrics",
    )
    _provider = provider
    _tracer = trace.get_tracer("erppreflight.analysis", service_version)
    logger.info("OpenTelemetry tracing enabled for %s", service_name)
    return True


def shutdown_tracing() -> None:
    global _tracer, _provider
    if _provider is not None:
        try:
            _provider.shutdown()
        except Exception:  # noqa: BLE001 — shutdown must never raise
            pass
    _tracer = None
    _provider = None


class _NoopSpan:
    def set_attribute(self, key: str, value: Any) -> None:  # noqa: D401
        return None

    def record_exception(self, exc: BaseException) -> None:
        return None

    def set_error(self, message: str) -> None:
        return None


class _Span:
    def __init__(self, span: Any):
        self._span = span

    def set_attribute(self, key: str, value: Any) -> None:
        self._span.set_attribute(key, value)

    def record_exception(self, exc: BaseException) -> None:
        # Record only the exception type: messages may echo customer payload fragments.
        self._span.set_attribute("error.type", type(exc).__name__)
        self.set_error(type(exc).__name__)

    def set_error(self, message: str) -> None:
        from opentelemetry.trace import Status, StatusCode

        self._span.set_status(Status(StatusCode.ERROR, message))


@contextmanager
def engine_span(engine_type: str) -> Iterator[Any]:
    """Wraps one engine execution in an ``analysis.engine`` span (no-op when tracing is off)."""
    if _tracer is None:
        yield _NoopSpan()
        return
    with _tracer.start_as_current_span(
        "analysis.engine",
        attributes={"erppreflight.engine": engine_type},
        record_exception=False,
    ) as span:
        yield _Span(span)
