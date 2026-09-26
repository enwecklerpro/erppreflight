"""Rule inventory, remediation docs, admin catalog and telemetry (AGENTS.md Axiom 2 #5, #11, #13, #14)."""

from __future__ import annotations

import inspect
import sys

import pytest
from starlette.testclient import TestClient

import src.engines  # noqa: F401
from src.core.registry import EngineRegistry
from src.core.runner import EngineRunner, UndeclaredRuleError
from src.main import create_app
from src.models.enums import AnalysisStatus, ConfidenceClass, EngineType, Severity
from src.models.finding import Finding
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse

ENGINES = list(EngineType)


def _all_declared():
    for et in ENGINES:
        engine = EngineRegistry.get(et)
        for code, spec in engine.get_rule_catalog().items():
            yield et, code, spec


@pytest.mark.parametrize("engine_type,code,spec", list(_all_declared()), ids=lambda v: getattr(v, "code", str(v)))
def test_every_declared_code_has_remediation(engine_type, code, spec):
    assert spec.code == code
    assert spec.title.strip()
    assert len(spec.remediation.strip()) >= 40, f"{code}: remediation guide too thin"
    assert isinstance(spec.severity, Severity)
    assert code.startswith(EngineRegistry.get(engine_type).get_rule_prefix().split("_")[0] + "_")


def test_finding_codes_are_globally_unique():
    seen = {}
    for et in ENGINES:
        for code in EngineRegistry.get(et).finding_codes:
            assert code not in seen, f"{code} declared by {seen.get(code)} and {et}"
            seen[code] = et


@pytest.mark.parametrize("engine_type", ENGINES, ids=[e.value for e in ENGINES])
def test_declared_codes_are_implemented(engine_type):
    """The inventory is truthful: every declared engine code is referenced by the engine's rule code."""
    engine = EngineRegistry.get(engine_type)
    module_src = inspect.getsource(sys.modules[type(engine).__module__])
    start = module_src.find("RULES = rule_catalog(")
    end = module_src.find("INPUT_CONTRACT = InputContract(")
    body = module_src[:start] + module_src[end:]
    prefix = engine.get_rule_prefix()
    for code in engine.finding_codes:
        short = code[len(prefix) + 1:]
        assert code in body or f'"{short}"' in body, f"{code} is declared but never emitted"


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


def test_engine_catalog_endpoint_exposes_real_rule_inventory(client):
    r = client.get("/api/v1/engines")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 19
    for entry in entries:
        engine = EngineRegistry.get(EngineType(entry["engine_type"]))
        assert entry["rule_count"] == len(engine.finding_codes) == len(entry["rule_codes"])
        assert set(entry["rule_codes"]) == set(engine.finding_codes)
        rule_codes = {r["code"] for r in entry["rules"]}
        assert set(engine.finding_codes) <= rule_codes
        assert all(r["remediation"] for r in entry["rules"])
        assert entry["input_contract"]["acceptedFormats"]
        assert entry["version"] and entry["domain"] and entry["target_releases"]
        assert entry["health"]["status"] == "OPERATIONAL"
    summary = client.get("/api/v1/engines-summary").json()
    assert summary["engines"] == 19
    assert summary["totalRules"] == sum(len(EngineRegistry.get(e).finding_codes) for e in ENGINES)


def test_engine_health_endpoint(client):
    r = client.get("/api/v1/engines/CLEAN_CORE_OBJECT_GUARD/health")
    assert r.status_code == 200
    names = {c["name"] for c in r.json()["checks"]}
    assert "knowledge_snapshot_loaded" in names


@pytest.mark.asyncio
async def test_strict_mode_rejects_undeclared_codes(monkeypatch):
    engine = EngineRegistry.get(EngineType.OPD_GUARD)

    async def rogue(request):
        return AnalysisResponse(job_id=request.job_id, engine_type=request.engine_type, findings=[Finding(
            rule_id="OPD_NOT_IN_CATALOG", severity=Severity.MAJOR, category="X", title="t", description="d",
            confidence=ConfidenceClass.RULE_DERIVED, remediation="r")])

    monkeypatch.setattr(engine, "analyze", rogue)
    req = AnalysisRequest(job_id="j", tenant_id="t", project_id="p", engine_type=EngineType.OPD_GUARD,
                          raw_content='{"scenario": {"DocumentType": "NB"}}')
    with pytest.raises(UndeclaredRuleError):
        await EngineRunner.execute(req)
    monkeypatch.setenv("ERPP_STRICT_RULE_CATALOG", "0")
    resp = await EngineRunner.execute(req)
    assert resp.metrics.additional_metrics["undeclaredRuleIds"] == ["OPD_NOT_IN_CATALOG"]


@pytest.mark.asyncio
async def test_empty_remediation_is_filled_from_catalog(monkeypatch):
    engine = EngineRegistry.get(EngineType.OPD_GUARD)

    async def terse(request):
        return AnalysisResponse(job_id=request.job_id, engine_type=request.engine_type, findings=[Finding(
            rule_id="OPD_UNREACHABLE_RULE", severity=Severity.MINOR, category="X", title="t", description="d",
            confidence=ConfidenceClass.RULE_DERIVED, remediation="")])

    monkeypatch.setattr(engine, "analyze", terse)
    req = AnalysisRequest(job_id="j", tenant_id="t", project_id="p", engine_type=EngineType.OPD_GUARD,
                          raw_content='{"scenario": {"DocumentType": "NB"}}')
    resp = await EngineRunner.execute(req)
    assert resp.findings[0].remediation == engine.finding_codes["OPD_UNREACHABLE_RULE"].remediation


@pytest.mark.asyncio
async def test_runner_records_telemetry():
    source = "REPORT zdemo.\nSELECT * FROM mara INTO TABLE @DATA(lt).\nCALL FUNCTION lv_fm.\n"
    req = AnalysisRequest(job_id="tel", tenant_id="t", project_id="p",
                          engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD, raw_content=source)
    resp = await EngineRunner.execute(req)
    m = resp.metrics
    assert resp.status == AnalysisStatus.COMPLETED
    assert m.peak_memory_bytes > 0
    assert m.rules_evaluated > 0
    assert m.finding_count == len(resp.findings) == 2
    assert m.unknown_finding_count == 1 and m.unknown_finding_rate == 0.5
    assert m.rules_declared == len(EngineRegistry.get(EngineType.CLEAN_CORE_OBJECT_GUARD).finding_codes)
    tel = m.additional_metrics["telemetry"]
    assert tel["findingCount"] == 2 and tel["unknownFindingRate"] == 0.5 and tel["peakMemoryBytes"] > 0
    assert tel["durationMs"] >= 0 and tel["rulesEvaluated"] == m.rules_evaluated


@pytest.mark.asyncio
async def test_failed_input_also_records_telemetry():
    req = AnalysisRequest(job_id="tel2", tenant_id="t", project_id="p", engine_type=EngineType.MFS_BLACKBOX,
                          raw_content="{}")
    resp = await EngineRunner.execute(req)
    assert resp.status == AnalysisStatus.FAILED
    assert resp.metrics.additional_metrics["telemetry"]["unknownFindingRate"] == 1.0
