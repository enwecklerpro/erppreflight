"""Regression tests for audit defects H1-H6, M1, M4, M5, L1 (analysis-python hardening)."""

import base64
import io
import json
import re
import uuid
import zipfile
from pathlib import Path

import pytest
from pydantic import ValidationError

import src.engines  # noqa: F401 — registers engines
from src.core.base_engine import BaseEngine
from src.core.exceptions import EngineInputError
from src.core.registry import EngineRegistry
from src.core.runner import EngineRunner
from src.engines.decommission_audit import _locate_line_in_text as decom_locate
from src.engines.api_change import _locate_token_in_text as api_locate
from src.models.enums import AnalysisStatus, ArtifactType, ConfidenceClass, EngineType, Severity, TrustLevel
from src.models.evidence import Evidence
from src.models.finding import Finding
from src.models.request import AnalysisOptions, AnalysisRequest
from src.models.response import AnalysisResponse
from src.parsers.safe_zip import ArchiveSecurityError, SafeZipReader
from src.platform.confidence import ConfidenceClassifier

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
JOB = "11111111-1111-1111-1111-111111111111"
TENANT = "22222222-2222-2222-2222-222222222222"
PROJECT = "33333333-3333-3333-3333-333333333333"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def fixture(rel: str) -> str:
    return (FIXTURES / rel).read_text()


def req(engine_type, **kw) -> AnalysisRequest:
    kw.setdefault("job_id", JOB)
    return AnalysisRequest(tenant_id=TENANT, project_id=PROJECT, engine_type=engine_type, **kw)


async def run(engine_type, **kw) -> AnalysisResponse:
    return await EngineRunner.execute(req(engine_type, **kw))


def rules(resp):
    return [f.rule_id for f in resp.findings]


def _zip(entries, compression=zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# H1: no default identities, no positive verdict from insufficient input
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_decom_no_target_user_is_insufficient_input():
    resp = await run(EngineType.SAFE_DECOMMISSION_PREFLIGHT, raw_content=json.dumps({"users": [], "jobs": []}))
    assert resp.status == AnalysisStatus.FAILED
    assert rules(resp) == ["DECOM_INSUFFICIENT_INPUT"]
    assert resp.findings[0].confidence == ConfidenceClass.UNKNOWN
    assert "BATCH_ADMIN" not in resp.model_dump_json()


@pytest.mark.asyncio
async def test_decom_target_without_tables_is_insufficient_input():
    resp = await run(EngineType.SAFE_DECOMMISSION_PREFLIGHT, configuration={"target_user": "JDOE"})
    assert resp.status == AnalysisStatus.FAILED
    assert rules(resp) == ["DECOM_INSUFFICIENT_INPUT"]


@pytest.mark.asyncio
async def test_decom_missing_required_tables_withholds_safe_verdict():
    payload = {"target_user": "JDOE", "evaluation_date": "2026-09-15", "users": [{"bname": "JDOE", "lock_status": 64}]}
    resp = await run(EngineType.SAFE_DECOMMISSION_PREFLIGHT, raw_content=json.dumps(payload))
    assert "DECOM_SAFE_FOR_ARCHIVING" not in rules(resp)
    withheld = [f for f in resp.findings if f.rule_id == "DECOM_INSUFFICIENT_INPUT"]
    assert len(withheld) == 1 and withheld[0].confidence == ConfidenceClass.UNKNOWN
    assert set(withheld[0].technical_details["missingTables"]) == {"TBTCO", "RFCDES", "SWWWIHEAD"}
    assert resp.status == AnalysisStatus.PARTIAL


@pytest.mark.asyncio
async def test_decom_user_absent_from_usr02_never_safe():
    payload = {"target_user": "GHOST", "users": [], "jobs": [], "rfc_destinations": [], "work_items": []}
    resp = await run(EngineType.SAFE_DECOMMISSION_PREFLIGHT, raw_content=json.dumps(payload))
    assert "DECOM_SAFE_FOR_ARCHIVING" not in rules(resp)


@pytest.mark.asyncio
async def test_decom_complete_input_still_yields_verdict():
    resp = await run(EngineType.SAFE_DECOMMISSION_PREFLIGHT, raw_content=fixture("domain5/decom_clean_user.json"))
    assert rules(resp) == ["DECOM_SAFE_FOR_ARCHIVING"]


@pytest.mark.asyncio
async def test_refresh_without_sid_never_verified():
    payload = {"rfc_destinations": [], "scot": {"hold_outbound": True}, "logical_systems": []}
    resp = await run(EngineType.SYSTEM_REFRESH_DELTA_GUARD, raw_content=json.dumps(payload))
    assert "REFRESH_ISOLATION_VERIFIED" not in rules(resp)
    assert "REFRESH_INSUFFICIENT_INPUT" in rules(resp)
    assert "QAS" not in resp.model_dump_json()


@pytest.mark.asyncio
async def test_refresh_missing_sections_withholds_verdict():
    resp = await run(EngineType.SYSTEM_REFRESH_DELTA_GUARD, raw_content=json.dumps({"sid": "QAS", "client": "100"}))
    assert "REFRESH_ISOLATION_VERIFIED" not in rules(resp)
    assert rules(resp) == ["REFRESH_INSUFFICIENT_INPUT"]
    assert resp.status == AnalysisStatus.PARTIAL


@pytest.mark.asyncio
async def test_refresh_reads_alternative_destination_keys():
    payload = {
        "sid": "QAS",
        "rfc_destinations": [{"name": "PRD_RFC", "host": "prd-app01.corp.internal"}],
        "scot": {"hold_outbound": True},
        "logical_systems": [],
    }
    resp = await run(EngineType.SYSTEM_REFRESH_DELTA_GUARD, raw_content=json.dumps(payload, indent=1))
    assert "REFRESH_RFC_TARGETS_PRODUCTION" in rules(resp)


@pytest.mark.asyncio
async def test_refresh_clean_fixture_still_verified():
    resp = await run(EngineType.SYSTEM_REFRESH_DELTA_GUARD, raw_content=fixture("domain5/refresh_clean_isolated.json"))
    assert rules(resp) == ["REFRESH_ISOLATION_VERIFIED"]


# ---------------------------------------------------------------------------
# H2: change pointer — no MATMAS default, no findings from the built-in profile alone
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cp_without_message_type_is_insufficient():
    resp = await run(EngineType.CHANGE_POINTER_COVERAGE_AUDITOR, raw_content=json.dumps({"bd52_fields": []}))
    assert resp.status == AnalysisStatus.FAILED
    assert rules(resp) == ["CP_INSUFFICIENT_INPUT"]
    assert "MATMAS" not in resp.model_dump_json()


@pytest.mark.asyncio
async def test_cp_without_bd52_is_insufficient():
    resp = await run(EngineType.CHANGE_POINTER_COVERAGE_AUDITOR, raw_content=json.dumps({"target_message_type": "DEBMAS"}))
    assert rules(resp) == ["CP_INSUFFICIENT_INPUT"]


@pytest.mark.asyncio
async def test_cp_standard_profile_findings_never_verified():
    payload = {"target_message_type": "MATMAS", "bd50_msg_types": ["MATMAS"], "bd52_fields": [["MARA", "MATKL"]]}
    resp = await run(EngineType.CHANGE_POINTER_COVERAGE_AUDITOR, raw_content=json.dumps(payload))
    missing = [f for f in resp.findings if f.rule_id == "CP_FIELD_NOT_CONFIGURED_BD52"]
    assert missing
    for f in missing:
        assert f.technical_details["expectedFieldSource"] == "STANDARD_PROFILE"
        assert f.confidence != ConfidenceClass.VERIFIED
        assert f.evidence[0].source_type == TrustLevel.CURATED_RULE


# ---------------------------------------------------------------------------
# H3: inline content contract (API sends raw_content; no S3 access here)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_s3_key_only_request_fails_with_insufficient_input():
    resp = await run(EngineType.CLEAN_CORE_OBJECT_GUARD, artifact_s3_key="tenants/a/projects/b/x.abap")
    assert resp.status == AnalysisStatus.FAILED
    assert rules(resp) == ["CLEAN_CORE_INSUFFICIENT_INPUT"]
    assert resp.findings[0].confidence == ConfidenceClass.UNKNOWN
    assert resp.findings[0].confidence_score == 0.30
    assert "object storage" in resp.error_message


@pytest.mark.asyncio
async def test_option_only_configuration_is_not_input():
    resp = await run(EngineType.MFS_BLACKBOX, configuration={"deterministicOnly": True, "allowAiAssistance": False})
    assert rules(resp) == ["MFS_INSUFFICIENT_INPUT"]


@pytest.mark.asyncio
async def test_base64_text_payload_is_decoded():
    raw = fixture("domain5/decom_clean_user.json")
    encoded = base64.b64encode(raw.encode()).decode()
    plain = await run(EngineType.SAFE_DECOMMISSION_PREFLIGHT, raw_content=raw)
    b64 = await run(EngineType.SAFE_DECOMMISSION_PREFLIGHT, raw_content=encoded, raw_content_encoding="base64")
    assert [f.model_dump() for f in b64.findings] == [f.model_dump() for f in plain.findings]


def test_invalid_base64_rejected_at_validation():
    with pytest.raises(ValidationError):
        req(EngineType.OPD_GUARD, raw_content="%%%not-base64%%%", raw_content_encoding="base64")


@pytest.mark.asyncio
async def test_binary_payload_rejected_by_text_engine():
    data = base64.b64encode(b"\x89PNG\r\n\x1a\n\xff\xfe\x00binary").decode()
    resp = await run(EngineType.CLEAN_CORE_OBJECT_GUARD, raw_content=data, raw_content_encoding="base64")
    assert resp.status == AnalysisStatus.FAILED
    assert rules(resp) == ["CLEAN_CORE_INVALID_INPUT"]


@pytest.mark.asyncio
async def test_base64_zip_software_collection_is_parsed():
    archive = _zip({"export/manifest.json": fixture("domain4/sc_circular.json")})
    resp = await run(
        EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
        raw_content=base64.b64encode(archive).decode(),
        raw_content_encoding="base64",
        artifact_type=ArtifactType.ZIP,
    )
    assert "SC_CIRCULAR_DEPENDENCY" in rules(resp)


# ---------------------------------------------------------------------------
# H4: no fabricated line numbers; confidence demotion on unverifiable evidence
# ---------------------------------------------------------------------------

def test_locate_helpers_return_none_when_not_found():
    assert decom_locate("line one\nline two", "ABSENT") == (None, None, "")
    assert decom_locate("", "X") == (None, None, "")
    assert decom_locate("a\nb TOKEN", "TOKEN") == (2, 3, "b TOKEN")
    assert api_locate("x\ny", "missing") == (None, None, "")


def _finding(**ev_kw) -> Finding:
    ev = Evidence(artifact_path="a.json", **ev_kw)
    return Finding(
        rule_id="T", severity=Severity.MAJOR, category="C", title="t", description="d",
        confidence=ConfidenceClass.VERIFIED, confidence_score=1.0, remediation="r", evidence=[ev],
    )


def test_classifier_demotes_evidence_without_line_number():
    f = ConfidenceClassifier.classify(_finding(sha256="a" * 64))
    assert f.confidence == ConfidenceClass.UNKNOWN and f.confidence_score == 0.30


def test_classifier_demotes_invalid_sha256():
    f = ConfidenceClassifier.classify(_finding(sha256="not-a-hash", line_number=3))
    assert f.confidence == ConfidenceClass.UNKNOWN


def test_classifier_keeps_verifiable_evidence():
    f = ConfidenceClassifier.classify(_finding(sha256="a" * 64, line_number=3))
    assert f.confidence == ConfidenceClass.VERIFIED and f.confidence_score == 1.0


@pytest.mark.asyncio
async def test_runner_demotes_unlocated_evidence(monkeypatch):
    engine = EngineRegistry.get(EngineType.WORKFLOW_STUCK_EXPLAINER)

    async def fake(request):
        return AnalysisResponse(job_id=request.job_id, engine_type=request.engine_type,
                                findings=[_finding(sha256="b" * 64)])

    monkeypatch.setattr(engine, "analyze", fake)
    resp = await run(EngineType.WORKFLOW_STUCK_EXPLAINER, raw_content="{}")
    assert resp.findings[0].confidence == ConfidenceClass.UNKNOWN


# ---------------------------------------------------------------------------
# H5: evidence snippets redacted before leaving the service
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_runner_redacts_evidence_snippets():
    raw = json.dumps({
        "sid": "QAS",
        "rfc_destinations": [{"destination": "SAP_PROD_CENTRAL", "target_host": "prd-app01.corp.internal",
                              "password": "hunter2hunter2"}],
        "scot": {"hold_outbound": True},
        "logical_systems": [],
    })
    resp = await run(EngineType.SYSTEM_REFRESH_DELTA_GUARD, raw_content=raw)
    snippets = [e.snippet for f in resp.findings for e in f.evidence if e.snippet]
    assert any("SAP_PROD_CENTRAL" in s for s in snippets)
    assert all("hunter2hunter2" not in s for s in snippets)
    assert any("[REDACTED:SECRET" in s for s in snippets)


# ---------------------------------------------------------------------------
# H6: safe zip reader
# ---------------------------------------------------------------------------

def test_safe_zip_rejects_ratio_bomb():
    bomb = _zip({"xl/sharedStrings.xml": b"A" * (20 * 1024 * 1024)})
    assert len(bomb) < 100 * 1024
    with SafeZipReader(bomb) as zf:
        with pytest.raises(ArchiveSecurityError):
            zf.read("xl/sharedStrings.xml")


def test_safe_zip_rejects_path_traversal():
    with pytest.raises(ArchiveSecurityError):
        SafeZipReader(_zip({"../../etc/passwd": b"x"}))
    with pytest.raises(ArchiveSecurityError):
        SafeZipReader(_zip({"/abs/path.json": b"x"}))


def test_safe_zip_rejects_too_many_entries_and_total_volume():
    with pytest.raises(ArchiveSecurityError):
        SafeZipReader(_zip({f"f{i}.txt": b"x" for i in range(5)}), max_entries=4)
    data = _zip({"a.bin": bytes(range(256)) * 40, "b.bin": bytes(range(256)) * 40}, zipfile.ZIP_STORED)
    with SafeZipReader(data, max_total_bytes=15000) as zf:
        zf.read("a.bin")
        with pytest.raises(ArchiveSecurityError):
            zf.read("b.bin")


def test_safe_zip_rejects_malformed_archive():
    with pytest.raises(ArchiveSecurityError):
        SafeZipReader(b"PK\x03\x04not really a zip")


@pytest.mark.asyncio
async def test_opd_xlsx_bomb_rejected():
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    bomb = _zip({
        "xl/workbook.xml": f'<workbook {ns}><sheets><sheet name="Output Type"/></sheets></workbook>',
        "xl/sharedStrings.xml": f"<sst {ns}><si><t>" + "A" * (20 * 1024 * 1024) + "</t></si></sst>",
    })
    resp = await run(EngineType.OPD_GUARD, raw_content=base64.b64encode(bomb).decode(),
                     raw_content_encoding="base64", artifact_type=ArtifactType.XLSX)
    assert resp.status == AnalysisStatus.FAILED
    assert rules(resp) == ["OPD_ARCHIVE_REJECTED"]


@pytest.mark.asyncio
async def test_software_collection_zip_slip_rejected():
    archive = _zip({"../manifest.json": fixture("domain4/sc_circular.json")})
    resp = await run(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD, raw_content=base64.b64encode(archive).decode(),
                     raw_content_encoding="base64", artifact_type=ArtifactType.ZIP)
    assert rules(resp) == ["SC_ARCHIVE_REJECTED"]


# ---------------------------------------------------------------------------
# M1: deterministic ids and fingerprints
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_identical_runs_are_byte_identical():
    raw = fixture("domain3/cp_missing_field.json")
    a = await run(EngineType.CHANGE_POINTER_COVERAGE_AUDITOR, raw_content=raw)
    b = await run(EngineType.CHANGE_POINTER_COVERAGE_AUDITOR, raw_content=raw)
    assert a.findings
    assert [f.model_dump_json() for f in a.findings] == [f.model_dump_json() for f in b.findings]
    for f in a.findings:
        assert UUID_RE.match(f.id)
        assert re.fullmatch(r"[0-9a-f]{64}", f.fingerprint)


@pytest.mark.asyncio
async def test_ids_scoped_to_job_fingerprints_stable():
    raw = fixture("domain3/cp_missing_field.json")
    a = await run(EngineType.CHANGE_POINTER_COVERAGE_AUDITOR, raw_content=raw)
    b = await run(EngineType.CHANGE_POINTER_COVERAGE_AUDITOR, raw_content=raw, job_id=str(uuid.UUID(int=7)))
    assert [f.fingerprint for f in a.findings] == [f.fingerprint for f in b.findings]
    assert not set(f.id for f in a.findings) & set(f.id for f in b.findings)
    assert len({f.id for f in a.findings}) == len(a.findings)


# ---------------------------------------------------------------------------
# M4 / M5: malformed and mis-shaped input
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("engine_type,prefix", [
    (EngineType.SAFE_DECOMMISSION_PREFLIGHT, "DECOM"),
    (EngineType.SYSTEM_REFRESH_DELTA_GUARD, "REFRESH"),
    (EngineType.CHANGE_POINTER_COVERAGE_AUDITOR, "CP"),
    (EngineType.CUSTOM_FIELD_FLOW_DOCTOR, "FIELD"),
    (EngineType.OPD_GUARD, "OPD"),
])
async def test_malformed_json_is_parse_error(engine_type, prefix):
    resp = await run(engine_type, raw_content='{\n  "a": [1, 2\n')
    assert resp.status == AnalysisStatus.FAILED
    assert rules(resp) == [f"{prefix}_PARSE_ERROR"]
    f = resp.findings[0]
    assert f.confidence == ConfidenceClass.UNKNOWN
    assert f.evidence and f.evidence[0].line_number is not None


@pytest.mark.asyncio
async def test_top_level_list_is_invalid_input():
    resp = await run(EngineType.SAFE_DECOMMISSION_PREFLIGHT, raw_content="[1, 2, 3]")
    assert rules(resp) == ["DECOM_INVALID_INPUT"]


@pytest.mark.asyncio
async def test_bad_scalar_type_is_invalid_input():
    payload = {"target_user": "X", "users": [], "grace_period_days": "abc"}
    resp = await run(EngineType.SAFE_DECOMMISSION_PREFLIGHT, raw_content=json.dumps(payload))
    assert rules(resp) == ["DECOM_INVALID_INPUT"]
    assert "grace_period_days" in resp.error_message


@pytest.mark.asyncio
async def test_unexpected_engine_exception_not_leaked(monkeypatch):
    engine = EngineRegistry.get(EngineType.IAM_COST_OPTIMIZER)

    async def boom(request):
        raise AttributeError("'list' object has no attribute 'get' /internal/path/secret")

    monkeypatch.setattr(engine, "analyze", boom)
    # A contract-valid payload so the (monkeypatched) engine body actually runs.
    resp = await run(EngineType.IAM_COST_OPTIMIZER, raw_content='{"roles": [{"role_name": "Z_ROLE"}]}')
    assert resp.status == AnalysisStatus.FAILED
    assert rules(resp) == ["IAM_INVALID_INPUT"]
    assert "/internal/path" not in resp.model_dump_json()


# ---------------------------------------------------------------------------
# L1: max findings and payload size
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_max_findings_enforced():
    raw = fixture("domain1/opd_decision_table.csv")
    full = await run(EngineType.OPD_GUARD, raw_content=raw, artifact_type=ArtifactType.CSV)
    assert len(full.findings) > 3
    capped = await run(EngineType.OPD_GUARD, raw_content=raw, artifact_type=ArtifactType.CSV,
                       options=AnalysisOptions(max_findings=3))
    assert len(capped.findings) == 3
    assert capped.metrics.additional_metrics["findingsTruncated"] is True
    assert capped.metrics.additional_metrics["totalFindingsBeforeTruncation"] == len(full.findings)


@pytest.mark.asyncio
async def test_payload_size_cap(monkeypatch):
    monkeypatch.setenv("MAX_PAYLOAD_SIZE_MB", "1")
    resp = await run(EngineType.CLEAN_CORE_OBJECT_GUARD, raw_content="A" * (1024 * 1024 + 10))
    assert resp.status == AnalysisStatus.FAILED
    assert rules(resp) == ["CLEAN_CORE_PAYLOAD_TOO_LARGE"]


def test_http_payload_size_limit(client):
    from src.config import get_settings
    too_big = int(get_settings().MAX_PAYLOAD_SIZE_MB * 1024 * 1024 * 4 / 3) + 128 * 1024
    r = client.post("/api/v1/analyze", content=b"x", headers={"content-length": str(too_big),
                                                              "content-type": "application/json"})
    assert r.status_code == 413


# ---------------------------------------------------------------------------
# Registry determinism
# ---------------------------------------------------------------------------

def test_registry_refuses_to_shadow_engine():
    class ShadowEngine(BaseEngine):
        engine_type = EngineType.OPD_GUARD
        name = "shadow"
        description = "shadow"

        async def analyze(self, request):  # pragma: no cover
            raise NotImplementedError

    original = EngineRegistry.get(EngineType.OPD_GUARD)
    with pytest.raises(ValueError):
        EngineRegistry.register(ShadowEngine)
    assert EngineRegistry.get(EngineType.OPD_GUARD) is original
    # idempotent for the same class
    EngineRegistry.register(type(original))
    assert EngineRegistry.get(EngineType.OPD_GUARD) is original


def test_engine_input_error_carries_rule_id():
    e = EngineInputError("X_PARSE_ERROR", "bad", line_number=2)
    assert e.rule_id == "X_PARSE_ERROR" and e.line_number == 2
