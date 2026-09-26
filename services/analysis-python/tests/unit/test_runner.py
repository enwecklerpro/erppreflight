import pytest
from src.core.runner import EngineRunner
from src.core.registry import EngineRegistry
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.models.enums import EngineType, AnalysisStatus, Severity, ConfidenceClass, TrustLevel
from pathlib import Path

OPD_VALID_SCENARIO = (Path(__file__).resolve().parent.parent / "fixtures" / "domain1" / "opd_scenario_valid.json").read_text()
# Minimal contract-valid OPD payload (a document scenario) so mocked engines pass the input gate.
MOCK_PAYLOAD = '{"scenario": {"DocumentType": "NB"}}'


@pytest.mark.asyncio
async def test_engine_runner_executes_successfully():
    req = AnalysisRequest(
        job_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        tenant_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        project_id="cccccccc-cccc-cccc-cccc-cccccccccccc",
        engine_type=EngineType.OPD_GUARD,
        target_release="S4H_2023",
        raw_content=OPD_VALID_SCENARIO,
    )
    response = await EngineRunner.execute(req)
    assert response.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL)
    assert response.job_id == req.job_id
    assert response.engine_type == EngineType.OPD_GUARD
    assert response.metrics.execution_time_ms >= 0


@pytest.mark.asyncio
async def test_engine_runner_demotes_missing_evidence_to_unknown(monkeypatch):
    """EngineRunner demotes findings with missing evidence to UNKNOWN (0.30)."""
    engine = EngineRegistry.get(EngineType.OPD_GUARD)

    async def mock_analyze(request):
        f = Finding(
            rule_id="OPD_UNREACHABLE_RULE",
            severity=Severity.MAJOR,
            category="CONFIG",
            title="Rule without evidence",
            description="Finding lacking evidence",
            confidence=ConfidenceClass.RULE_DERIVED,
            confidence_score=0.85,
            remediation="Add evidence",
            evidence=[],
        )
        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=request.engine_type,
            findings=[f],
        )

    monkeypatch.setattr(engine, "analyze", mock_analyze)

    req = AnalysisRequest(
        job_id="11111111-1111-1111-1111-111111111111",
        tenant_id="22222222-2222-2222-2222-222222222222",
        project_id="33333333-3333-3333-3333-333333333333",
        engine_type=EngineType.OPD_GUARD,
        raw_content=MOCK_PAYLOAD,
    )
    resp = await EngineRunner.execute(req)
    assert resp.status == AnalysisStatus.COMPLETED
    assert len(resp.findings) == 1
    assert resp.findings[0].confidence == ConfidenceClass.UNKNOWN
    assert resp.findings[0].confidence_score == 0.30


@pytest.mark.asyncio
async def test_engine_runner_demotes_ai_request_to_inferred(monkeypatch):
    """When request configuration indicates AI, findings with evidence are demoted to INFERRED (0.60)."""
    engine = EngineRegistry.get(EngineType.OPD_GUARD)
    ev = Evidence(
        artifact_path="manifest.xml",
        line_number=1,
        sha256="a" * 64,
        provenance=ConfidenceClass.VERIFIED,
        source_type=TrustLevel.CUSTOMER_EVIDENCE,
    )

    async def mock_analyze(request):
        f = Finding(
            rule_id="OPD_CHANNEL_INACTIVE",
            severity=Severity.CRITICAL,
            category="AI",
            title="AI generated finding claiming verified",
            description="AI router output",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Check finding",
            evidence=[ev],
        )
        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=request.engine_type,
            findings=[f],
        )

    monkeypatch.setattr(engine, "analyze", mock_analyze)

    req = AnalysisRequest(
        job_id="11111111-1111-1111-1111-111111111111",
        tenant_id="22222222-2222-2222-2222-222222222222",
        project_id="33333333-3333-3333-3333-333333333333",
        engine_type=EngineType.OPD_GUARD,
        configuration={"is_ai_generated": True},
        raw_content=MOCK_PAYLOAD,
    )
    resp = await EngineRunner.execute(req)
    assert resp.findings[0].confidence == ConfidenceClass.INFERRED
    assert resp.findings[0].confidence_score == 0.60


@pytest.mark.asyncio
async def test_engine_runner_demotes_evidence_provenance_inferred(monkeypatch):
    """When finding evidence has INFERRED provenance, EngineRunner demotes finding to INFERRED (0.60)."""
    engine = EngineRegistry.get(EngineType.OPD_GUARD)
    ev_inferred = Evidence(
        artifact_path="llm_output.json",
        line_number=1,
        sha256="b" * 64,
        provenance=ConfidenceClass.INFERRED,
        source_type=TrustLevel.INFERRED,
    )

    async def mock_analyze(request):
        f = Finding(
            rule_id="OPD_RELEVANCE_SUPPRESSED",
            severity=Severity.MAJOR,
            category="INTEGRATION",
            title="Inferred evidence finding",
            description="Finding with inferred evidence",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Review",
            evidence=[ev_inferred],
        )
        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=request.engine_type,
            findings=[f],
        )

    monkeypatch.setattr(engine, "analyze", mock_analyze)

    req = AnalysisRequest(
        job_id="11111111-1111-1111-1111-111111111111",
        tenant_id="22222222-2222-2222-2222-222222222222",
        project_id="33333333-3333-3333-3333-333333333333",
        engine_type=EngineType.OPD_GUARD,
        raw_content=MOCK_PAYLOAD,
    )
    resp = await EngineRunner.execute(req)
    assert resp.findings[0].confidence == ConfidenceClass.INFERRED
    assert resp.findings[0].confidence_score == 0.60
