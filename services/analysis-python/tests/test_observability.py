"""Observability: tracing is opt-in, fail-open, and never alters analysis output."""

import importlib

import pytest
from fastapi.testclient import TestClient

from src import observability


@pytest.fixture(autouse=True)
def _reset_tracing(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", raising=False)
    observability.shutdown_tracing()
    yield
    observability.shutdown_tracing()


def test_tracing_disabled_without_endpoint():
    from src.main import create_app

    app = create_app()
    assert observability.is_enabled() is False
    with observability.engine_span("CLEAN_CORE") as span:
        span.set_attribute("erppreflight.findings.count", 3)  # no-op, must not raise
    client = TestClient(app)
    assert client.get("/health").status_code == 200


def test_endpoint_without_packages_fails_open(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

    def fake_import(name, *args, **kwargs):
        if name.startswith("opentelemetry"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", fake_import)
    from fastapi import FastAPI

    assert observability.setup_tracing(FastAPI(), "analysis-python", "test", "test") is False
    assert observability.is_enabled() is False


def test_engine_span_exported_when_enabled(monkeypatch):
    pytest.importorskip("opentelemetry.sdk.trace")
    pytest.importorskip("opentelemetry.instrumentation.fastapi")
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    from fastapi import FastAPI

    assert observability.setup_tracing(FastAPI(), "analysis-python", "test", "test") is True
    exporter = InMemorySpanExporter()
    observability._provider.add_span_processor(SimpleSpanProcessor(exporter))
    with observability.engine_span("CLEAN_CORE") as span:
        span.set_attribute("erppreflight.findings.count", 2)
    spans = exporter.get_finished_spans()
    assert [s.name for s in spans] == ["analysis.engine"]
    assert spans[0].attributes["erppreflight.engine"] == "CLEAN_CORE"
    assert spans[0].attributes["erppreflight.findings.count"] == 2


def test_module_import_has_no_side_effects():
    importlib.reload(observability)
    assert observability.is_enabled() is False
