import time
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse, AnalysisMetrics
from src.models.enums import AnalysisStatus, ConfidenceClass, TrustLevel
from src.core.registry import EngineRegistry
from src.platform.confidence import ConfidenceClassifier


class EngineRunner:
    """Orchestrates request validation, engine execution, metrics, and confidence invariants."""

    @classmethod
    async def execute(cls, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        engine = EngineRegistry.get(request.engine_type)

        try:
            response = await engine.analyze(request)
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

                has_no_evidence = not finding.evidence or len(finding.evidence) == 0

                ConfidenceClassifier.classify(
                    finding,
                    is_ai_generated=finding_is_ai,
                    missing_evidence=has_no_evidence,
                )

            return response
        except Exception as e:
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
            return AnalysisResponse(
                job_id=request.job_id,
                engine_type=request.engine_type,
                status=AnalysisStatus.FAILED,
                findings=[],
                metrics=AnalysisMetrics(execution_time_ms=elapsed_ms, rules_evaluated=0, artifacts_scanned=0),
                error_message=str(e),
            )
