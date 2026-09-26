import json
import logging
import os
import threading
import time
import tracemalloc
from typing import Any, Dict, List, Optional

from src.config import get_settings
from src.core.base_engine import BaseEngine
from src.core.contracts import validate_request_input
from src.core.exceptions import EngineInputError
from src.core.registry import EngineRegistry
from src.models.enums import AnalysisStatus, ConfidenceClass, Severity, TrustLevel
from src.models.finding import Finding, compute_finding_fingerprint, compute_finding_id
from src.models.request import AnalysisRequest
from src.models.response import AnalysisMetrics, AnalysisResponse
from src.platform.confidence import ConfidenceClassifier, lacks_verifiable_evidence
from src.platform.evidence import EvidenceEngine
from src.platform.redaction import SecretRedactionEngine

# Configuration keys that are execution options, not analysable artifact data.
OPTION_CONFIG_KEYS = frozenset({
    "deterministicOnly", "deterministic_only",
    "allowAiAssistance", "allow_ai_assistance",
    "is_ai_generated", "ai_generated",
    "strictValidation", "strict_validation",
    "maxFindings", "max_findings",
    "targetRelease", "target_release",
    "artifact_path", "file_name",
    "sourceFileId", "sourceFileName", "source_file_id", "source_file_name",
    "evaluation_date", "snapshot_date",
})


logger = logging.getLogger("erppreflight.analysis.runner")


class UndeclaredRuleError(AssertionError):
    """Raised in strict mode when an engine emits a finding code missing from its declared catalog."""


def _strict_rule_catalog() -> bool:
    return os.environ.get("ERPP_STRICT_RULE_CATALOG", "").strip().lower() in ("1", "true", "yes")


class _MemoryTracer:
    """Reference-counted tracemalloc session so concurrent analyses share one trace (Axiom 2 #11).

    Peak memory is process-wide while tracing is active; with concurrent requests it is an upper bound
    for the individual analysis."""

    _lock = threading.Lock()
    _active = 0
    _owned = False

    @classmethod
    def start(cls) -> None:
        with cls._lock:
            if cls._active == 0:
                if not tracemalloc.is_tracing():
                    tracemalloc.start()
                    cls._owned = True
                tracemalloc.reset_peak()
            cls._active += 1

    @classmethod
    def stop(cls) -> int:
        with cls._lock:
            peak = tracemalloc.get_traced_memory()[1] if tracemalloc.is_tracing() else 0
            cls._active = max(0, cls._active - 1)
            if cls._active == 0 and cls._owned:
                tracemalloc.stop()
                cls._owned = False
            return int(peak)


def _has_structured_config(configuration: Dict[str, Any]) -> bool:
    if not isinstance(configuration, dict):
        return False
    for key, value in configuration.items():
        if key in OPTION_CONFIG_KEYS:
            continue
        if value is None or value == "" or value == [] or value == {}:
            continue
        return True
    return False


def _has_inline_content(request: AnalysisRequest) -> bool:
    raw = request.get_raw_bytes()
    if raw and raw.strip():
        return True
    for art in request.artifacts:
        data = art.get_raw_bytes()
        if data and data.strip():
            return True
    return False


def _payload_size_bytes(request: AnalysisRequest) -> int:
    size = len(request.get_raw_bytes() or b"")
    for art in request.artifacts:
        size += len(art.get_raw_bytes() or b"")
    try:
        size += len(json.dumps(request.configuration, default=str))
    except (TypeError, ValueError, RecursionError):
        pass
    return size


def _artifact_path(request: AnalysisRequest) -> str:
    if request.artifact_s3_key:
        return request.artifact_s3_key
    for art in request.artifacts:
        if art.file_name:
            return art.file_name
    return "inline_payload"


class EngineRunner:
    """Orchestrates request validation, engine execution, metrics, and confidence invariants."""

    @classmethod
    async def execute(cls, request: AnalysisRequest) -> AnalysisResponse:
        engine = EngineRegistry.get(request.engine_type)
        start_time = time.perf_counter()
        _MemoryTracer.start()
        peak = 0
        try:
            response = await cls._execute(request, engine, start_time)
        finally:
            peak = _MemoryTracer.stop()
        cls._record_telemetry(engine, response, start_time, peak)
        return response

    @classmethod
    async def _execute(cls, request: AnalysisRequest, engine: BaseEngine, start_time: float) -> AnalysisResponse:
        settings = get_settings()
        prefix = engine.get_rule_prefix()

        # L1: payload size cap
        max_bytes = int(settings.MAX_PAYLOAD_SIZE_MB) * 1024 * 1024
        payload_size = _payload_size_bytes(request)
        if payload_size > max_bytes:
            return cls._finalize(request, cls._input_failure(
                request, engine, f"{prefix}_PAYLOAD_TOO_LARGE",
                f"Payload of {payload_size} bytes exceeds the {settings.MAX_PAYLOAD_SIZE_MB} MB limit.",
                start_time, include_evidence=False,
            ), settings)

        # H3: the API sends artifacts inline (raw_content); this service never fetches from storage.
        if not _has_inline_content(request) and not _has_structured_config(request.configuration):
            detail = (
                f"artifact_s3_key '{request.artifact_s3_key}' was provided without inline raw_content; "
                "the analysis service does not read from object storage."
                if request.artifact_s3_key
                else "No raw_content, artifacts, or structured configuration data were supplied."
            )
            return cls._finalize(request, cls._input_failure(
                request, engine, f"{prefix}_INSUFFICIENT_INPUT", detail, start_time, include_evidence=False,
            ), settings)

        if (
            request.raw_content is None
            and request.get_raw_bytes()
            and not engine.accepts_binary_input
        ):
            return cls._finalize(request, cls._input_failure(
                request, engine, f"{prefix}_INVALID_INPUT",
                "Binary (non UTF-8) payload is not supported by this engine.", start_time,
            ), settings)

        try:
            # Explicit per-engine input contract (formats + Pydantic model) before any rule runs.
            validate_request_input(engine, request)
            response = await engine.analyze(request)
        except EngineInputError as e:
            return cls._finalize(request, cls._input_failure(
                request, engine, e.rule_id, e.message, start_time,
                line_number=e.line_number, column_number=e.column_number, details=e.details,
            ), settings)
        except Exception as e:  # noqa: BLE001 — never leak raw exception text to callers
            logger.warning(
                "engine %s rejected input for job %s: %s", engine.engine_type.value, request.job_id,
                type(e).__name__,
            )
            return cls._finalize(request, cls._input_failure(
                request, engine, f"{prefix}_INVALID_INPUT",
                "Input could not be processed: the payload does not have the structure this engine requires.",
                start_time,
            ), settings)

        elapsed_ms = int((time.perf_counter() - start_time) * 1000)
        if response.metrics is None:
            response.metrics = AnalysisMetrics()
        response.metrics.execution_time_ms = elapsed_ms

        # Check request-level and engine-level AI provenance indicators
        is_request_ai = bool(
            request.configuration.get("is_ai_generated", False)
            or request.options.custom_params.get("is_ai_generated", False)
            or getattr(engine, "is_ai_engine", False)
        )

        # Enforce epistemic confidence invariants on all findings
        for finding in response.findings:
            finding_is_ai = (
                is_request_ai
                or getattr(finding, "is_ai_generated", False)
                or bool(finding.technical_details.get("is_ai_generated"))
                or bool(finding.technical_details.get("ai_generated"))
                or any(
                    e.provenance == ConfidenceClass.INFERRED or e.source_type == TrustLevel.INFERRED
                    for e in (finding.evidence or [])
                )
            )
            ConfidenceClassifier.classify(
                finding,
                is_ai_generated=finding_is_ai,
                missing_evidence=lacks_verifiable_evidence(finding.evidence),
            )

        return cls._finalize(request, response, settings)

    # ------------------------------------------------------------------
    # Post-processing shared by success and failure paths
    # ------------------------------------------------------------------
    @classmethod
    def _finalize(cls, request: AnalysisRequest, response: AnalysisResponse, settings) -> AnalysisResponse:
        # Axiom 2 #5/#14: every emitted code must be declared in the engine's rule catalog, and every
        # finding carries remediation text (catalog text fills an empty engine-specific remediation).
        engine = EngineRegistry.get(request.engine_type)
        catalog = engine.get_rule_catalog()
        undeclared = sorted({f.rule_id for f in response.findings if f.rule_id not in catalog})
        if undeclared:
            if _strict_rule_catalog():
                raise UndeclaredRuleError(
                    f"{engine.engine_type.value} emitted undeclared finding codes: {undeclared}"
                )
            logger.error("engine %s emitted undeclared finding codes %s", engine.engine_type.value, undeclared)
            if response.metrics is None:
                response.metrics = AnalysisMetrics()
            response.metrics.additional_metrics["undeclaredRuleIds"] = undeclared
        for finding in response.findings:
            spec = catalog.get(finding.rule_id)
            if spec is not None and not (finding.remediation or "").strip():
                finding.remediation = spec.remediation

        # H5: secret redaction on every evidence snippet before anything leaves the service
        redactor = SecretRedactionEngine(tenant_id=request.tenant_id)
        for finding in response.findings:
            for ev in finding.evidence or []:
                if ev.snippet:
                    result = redactor.redact(ev.snippet)
                    if result.redactions_count:
                        # Snippet-level hashes must stay verifiable against the stored (sanitized) snippet;
                        # artifact-level hashes are left untouched.
                        if ev.sha256 == result.sha256_original:
                            ev.sha256 = result.sha256_sanitized
                        ev.snippet = result.sanitized_text

        # L1: enforce max findings (request option bounded by service configuration)
        limit = max(1, min(int(request.options.max_findings), int(settings.MAX_FINDINGS_PER_ANALYSIS)))
        if len(response.findings) > limit:
            total = len(response.findings)
            response.findings = response.findings[:limit]
            if response.metrics is None:
                response.metrics = AnalysisMetrics()
            response.metrics.additional_metrics["findingsTruncated"] = True
            response.metrics.additional_metrics["totalFindingsBeforeTruncation"] = total
            response.metrics.additional_metrics["maxFindings"] = limit
            if response.status == AnalysisStatus.COMPLETED:
                response.status = AnalysisStatus.PARTIAL

        # M1: deterministic fingerprint and id (scoped to job so persisted ids never collide)
        seen: Dict[str, int] = {}
        for finding in response.findings:
            fp = compute_finding_fingerprint(finding, request.engine_type.value)
            ordinal = seen.get(fp, 0)
            seen[fp] = ordinal + 1
            finding.fingerprint = fp
            finding.id = compute_finding_id(fp, request.job_id, ordinal)
        return response

    @classmethod
    def _record_telemetry(cls, engine: BaseEngine, response: AnalysisResponse, start_time: float, peak: int) -> None:
        """Axiom 2 #11: duration, peak memory, rules evaluated, finding count and unknown-finding rate."""
        if response.metrics is None:
            response.metrics = AnalysisMetrics()
        m = response.metrics
        m.execution_time_ms = int((time.perf_counter() - start_time) * 1000)
        total = len(response.findings)
        unknown = sum(1 for f in response.findings if f.confidence == ConfidenceClass.UNKNOWN)
        m.peak_memory_bytes = peak
        m.finding_count = total
        m.unknown_finding_count = unknown
        m.unknown_finding_rate = round(unknown / total, 4) if total else 0.0
        m.rules_declared = len(engine.finding_codes)
        m.additional_metrics["telemetry"] = {
            "durationMs": m.execution_time_ms,
            "peakMemoryBytes": peak,
            "rulesEvaluated": m.rules_evaluated,
            "rulesDeclared": m.rules_declared,
            "findingCount": total,
            "unknownFindingCount": unknown,
            "unknownFindingRate": m.unknown_finding_rate,
            "engineVersion": engine.version,
            "status": response.status.value,
        }

    @classmethod
    def _input_failure(
        cls,
        request: AnalysisRequest,
        engine: BaseEngine,
        rule_id: str,
        message: str,
        start_time: float,
        line_number: Optional[int] = None,
        column_number: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None,
        include_evidence: bool = True,
    ) -> AnalysisResponse:
        """Builds a FAILED response carrying a single UNKNOWN-confidence input finding (never a verdict)."""
        evidence: List = []
        raw = request.get_raw_bytes()
        if include_evidence and raw:
            snippet = None
            if line_number and request.raw_content:
                lines = request.raw_content.splitlines()
                if 0 < line_number <= len(lines):
                    snippet = lines[line_number - 1].strip()[:500]
            evidence.append(EvidenceEngine.create_evidence(
                artifact_path=_artifact_path(request),
                content=raw,
                line_number=line_number,
                column_number=column_number,
                snippet=snippet,
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            ))
        finding = Finding(
            rule_id=rule_id,
            # Missing input is informational (no verdict); malformed/oversized input is a blocking defect.
            severity=Severity.INFO if rule_id.endswith("_INSUFFICIENT_INPUT") else Severity.MAJOR,
            category="INPUT_VALIDATION",
            title=f"{engine.name}: analysis could not be performed ({rule_id})",
            description=message,
            confidence=ConfidenceClass.UNKNOWN,
            confidence_score=0.30,
            remediation=(
                "Supply a complete, well-formed artifact export in the format documented for this engine "
                "and re-run the analysis. No verdict has been produced for this input."
            ),
            evidence=evidence,
            technical_details={"inputError": True, **(details or {})},
        )
        # Input failures are never promoted above UNKNOWN.
        finding.confidence = ConfidenceClass.UNKNOWN
        finding.confidence_score = 0.30
        elapsed_ms = int((time.perf_counter() - start_time) * 1000)
        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=request.engine_type,
            status=AnalysisStatus.FAILED,
            findings=[finding],
            metrics=AnalysisMetrics(execution_time_ms=elapsed_ms, rules_evaluated=0, artifacts_scanned=0),
            error_message=message,
        )
