import pytest
from pydantic import ValidationError
from src.models.enums import EngineType, Severity, ConfidenceClass, ArtifactType
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse
from src.models.finding import Finding
from src.models.evidence import Evidence


def test_evidence_model_validation():
    ev = Evidence(
        artifact_path="sap/bc/form.xml",
        line_number=42,
        sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        provenance=ConfidenceClass.VERIFIED,
    )
    assert ev.line_number == 42
    assert ev.trust_score == 1.0


def test_finding_model_validation():
    finding = Finding(
        rule_id="OPD_RULE_001",
        severity=Severity.HIGH if hasattr(Severity, "HIGH") else Severity.CRITICAL,
        category="OUTPUT_CONTROL",
        title="Missing determination step",
        description="BRFplus determination table missing required row.",
        confidence=ConfidenceClass.RULE_DERIVED,
        remediation="Maintain decision table row in S/4HANA OPD transaction.",
    )
    assert finding.confidence == ConfidenceClass.RULE_DERIVED
    assert finding.id is not None


def test_analysis_request_valid():
    req = AnalysisRequest(
        job_id="11111111-1111-1111-1111-111111111111",
        tenant_id="22222222-2222-2222-2222-222222222222",
        project_id="33333333-3333-3333-3333-333333333333",
        engine_type=EngineType.OPD_GUARD,
        target_release="S4H_2023",
        artifact_type=ArtifactType.CSV,
    )
    assert req.engine_type == EngineType.OPD_GUARD
    assert req.target_release == "S4H_2023"


def test_analysis_request_invalid_engine():
    with pytest.raises(ValidationError):
        AnalysisRequest(
            job_id="11111111-1111-1111-1111-111111111111",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type="INVALID_ENGINE_NAME",
        )
