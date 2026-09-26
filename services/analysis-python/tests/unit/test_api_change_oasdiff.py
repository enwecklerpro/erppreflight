"""API Change Guard — oasdiff-level breaking-change categories and stored project baselines (KNOWN_LIMITATIONS E4).

Golden fixtures: tests/fixtures/domain3/api_oasdiff_{baseline,candidate}.json (OpenAPI 3) and
api_edmx_structure_{baseline,candidate}.xml (OData V2). Every breaking change is a deterministic diff:
VERIFIED confidence, evidence with line + SHA-256 of the specification that contains the element, and an RFC 6901
JSON pointer (OpenAPI) / XPath locator (EDMX) in technical_details.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

import src.engines  # noqa: F401
from src.core.runner import EngineRunner
from src.models.enums import AnalysisStatus, ConfidenceClass, EngineType, Severity
from src.models.request import AnalysisRequest

F = Path(__file__).resolve().parents[1] / "fixtures" / "domain3"
OAS_BASE = (F / "api_oasdiff_baseline.json").read_text(encoding="utf-8")
OAS_CAND = (F / "api_oasdiff_candidate.json").read_text(encoding="utf-8")
EDMX_BASE = (F / "api_edmx_structure_baseline.xml").read_text(encoding="utf-8")
EDMX_CAND = (F / "api_edmx_structure_candidate.xml").read_text(encoding="utf-8")


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _stored(content: str, explicit: bool = False, **kw) -> dict:
    return {"id": kw.get("id", "3b1e2c1a-0000-4000-8000-000000000001"), "name": kw.get("name", "Sales Order API"),
            "version": kw.get("version", "1.4.0"), "format": "OPENAPI", "sha256": kw.get("sha256", _sha(content)),
            "content": content, "explicit": explicit}


def _run(raw: str | None, configuration: dict | None = None, job: str = "api-oasdiff"):
    req = AnalysisRequest(job_id=job, tenant_id="t", project_id="p", engine_type=EngineType.API_CHANGE_GUARD,
                          raw_content=raw, configuration=configuration or {})
    return asyncio.run(EngineRunner.execute(req))


def _by_category(resp) -> dict:
    out: dict = {}
    for f in resp.findings:
        out.setdefault(f.technical_details.get("changeCategory"), []).append(f)
    return out


@pytest.fixture(scope="module")
def oas():
    return _run(OAS_CAND, {"sourceFileName": "salesorder-v2.json", "stored_baseline": _stored(OAS_BASE)})


@pytest.fixture(scope="module")
def edmx():
    return _run(EDMX_CAND, {"sourceFileName": "API_SALES_ORDER_SRV.edmx",
                            "stored_baseline": {**_stored(EDMX_BASE), "format": "EDMX"}})


OPENAPI_CATEGORIES = {
    "api-path-removed": "API_BREAKING_ENDPOINT_REMOVED",
    "api-operation-removed": "API_BREAKING_OPERATION_REMOVED",
    "request-parameter-renamed": "API_BREAKING_PARAM_RENAMED",
    "request-parameter-became-required": "API_BREAKING_REQUIRED_PARAM_ADDED",
    "request-parameter-type-changed": "API_BREAKING_TYPE_CHANGED",
    "request-parameter-format-changed": "API_BREAKING_FORMAT_CHANGED",
    "request-parameter-enum-value-removed": "API_BREAKING_ENUM_RESTRICTED",
    "response-property-removed": "API_BREAKING_RESPONSE_PROPERTY_REMOVED",
    "response-success-status-removed": "API_BREAKING_RESPONSE_STATUS_REMOVED",
    "response-non-success-status-removed": "API_BREAKING_RESPONSE_STATUS_REMOVED",
    "operation-security-changed": "API_BREAKING_SECURITY_CHANGED",
    "security-scheme-removed": "API_BREAKING_SECURITY_CHANGED",
    "schema-property-removed": "API_BREAKING_FIELD_REMOVED",
    "property-format-changed": "API_BREAKING_FORMAT_CHANGED",
    "property-became-non-nullable": "API_BREAKING_REQUIRED_PROPERTY_ADDED",
    "enum-value-removed": "API_BREAKING_ENUM_RESTRICTED",
}


def test_openapi_every_oasdiff_category_detected(oas):
    assert oas.status == AnalysisStatus.COMPLETED
    cats = _by_category(oas)
    for cat, code in OPENAPI_CATEGORIES.items():
        assert cat in cats, f"missing {cat}"
        assert all(f.rule_id == code for f in cats[cat]), cat
    assert oas.metrics.additional_metrics["breakingByCategory"]["request-parameter-renamed"] == 1


def test_openapi_pointers_lines_and_hashes(oas):
    base_sha, cand_sha = _sha(OAS_BASE), _sha(OAS_CAND)
    base_lines, cand_lines = OAS_BASE.splitlines(), OAS_CAND.splitlines()
    for f in oas.findings:
        ev = f.evidence[0]
        td = f.technical_details
        assert td["jsonPointer"].startswith("/"), f.rule_id
        if td["specRole"] == "baseline":
            assert ev.sha256 == base_sha and ev.artifact_path == "api-baseline:Sales Order API@1.4.0"
            lines = base_lines
        else:
            assert ev.sha256 == cand_sha and ev.artifact_path == "salesorder-v2.json"
            lines = cand_lines
        assert ev.line_number and 1 <= ev.line_number <= len(lines)
        assert lines[ev.line_number - 1].strip() in ev.snippet
        if "BREAKING" in f.rule_id and "NON_BREAKING" not in f.rule_id:
            assert f.confidence == ConfidenceClass.VERIFIED and f.confidence_score == 1.0

    cats = _by_category(oas)
    renamed = cats["request-parameter-renamed"][0]
    assert renamed.technical_details["previousName"] == "companyCode"
    assert renamed.technical_details["parameter"] == "companyCodeId"
    assert renamed.technical_details["jsonPointer"] == "/paths/~1salesOrders/get/parameters/0"
    assert '"companyCodeId"' in renamed.evidence[0].snippet
    removed_prop = cats["response-property-removed"][0]
    assert removed_prop.technical_details["jsonPointer"] == (
        "/paths/~1salesOrders/get/responses/200/content/application~1json/schema/items/properties/currency"
    )
    assert cats["api-path-removed"][0].technical_details["jsonPointer"] == "/paths/~1salesOrders~1{salesOrder}~1items"
    assert cats["security-scheme-removed"][0].technical_details["jsonPointer"] == "/components/securitySchemes/basicAuth"
    assert cats["response-success-status-removed"][0].severity == Severity.MAJOR
    assert cats["response-non-success-status-removed"][0].severity == Severity.MINOR


def test_openapi_no_new_required_param_duplicate_for_rename(oas):
    """The rename replaces the 'new required parameter' finding for companyCodeId."""
    added = [f for f in oas.findings if f.rule_id == "API_BREAKING_REQUIRED_PARAM_ADDED"]
    assert [f.technical_details["parameter"] for f in added] == ["salesOrg"]


def test_shared_component_removal_is_reported_once(oas):
    """paymentTerms disappears from the SalesOrder component used by three responses: one FIELD_REMOVED, no
    response-property duplicates."""
    assert not any(f.technical_details.get("responseProperty") == "paymentTerms" for f in oas.findings)


EDMX_CATEGORIES = {
    "edmx-entity-type-removed": "API_BREAKING_ENTITY_REMOVED",
    "edmx-entity-set-removed": "API_BREAKING_ENTITYSET_REMOVED",
    "edmx-property-removed": "API_BREAKING_FIELD_REMOVED",
    "edmx-navigation-property-removed": "API_BREAKING_NAVIGATION_REMOVED",
    "edmx-entity-key-changed": "API_BREAKING_KEY_CHANGED",
    "property-became-non-nullable": "API_BREAKING_REQUIRED_PROPERTY_ADDED",
}


def test_edmx_structure_categories(edmx):
    assert edmx.status == AnalysisStatus.COMPLETED
    cats = _by_category(edmx)
    for cat, code in EDMX_CATEGORIES.items():
        assert cat in cats and cats[cat][0].rule_id == code, cat
    key = cats["edmx-entity-key-changed"][0]
    assert key.technical_details["baselineKeys"] == ["SalesOrder", "SalesOrderItem"]
    assert key.technical_details["candidateKeys"] == ["SalesOrderItemUUID"]
    assert key.technical_details["xmlPath"] == "//EntityType[@Name='A_SalesOrderItemType']/Key"
    assert key.severity == Severity.CRITICAL
    nav = cats["edmx-navigation-property-removed"][0]
    assert nav.technical_details["xmlPath"].endswith("NavigationProperty[@Name='to_Partner']")
    assert "to_Partner" in nav.evidence[0].snippet
    for f in edmx.findings:
        assert f.evidence[0].sha256 in (_sha(EDMX_BASE), _sha(EDMX_CAND))


# ---------------------------------------------------------------------------------------- stored baselines
def test_stored_baseline_metrics(oas):
    m = oas.metrics.additional_metrics
    assert m["baselineSource"] == "STORED_BASELINE"
    assert m["baselineSelection"] == "ACTIVE"
    assert m["baselineSha256"] == _sha(OAS_BASE)
    assert m["candidateSha256"] == _sha(OAS_CAND)
    assert m["baselineId"] == "3b1e2c1a-0000-4000-8000-000000000001"


def test_tampered_stored_baseline_is_rejected():
    resp = _run(OAS_CAND, {"stored_baseline": _stored(OAS_BASE, sha256="0" * 64)})
    assert resp.status == AnalysisStatus.FAILED
    assert [f.rule_id for f in resp.findings] == ["API_INVALID_INPUT"]
    assert "integrity" in resp.error_message


def test_single_spec_without_baseline_still_insufficient():
    resp = _run(OAS_CAND)
    assert resp.status == AnalysisStatus.FAILED
    assert [f.rule_id for f in resp.findings] == ["API_INSUFFICIENT_INPUT"]


def test_bundle_baseline_wins_over_active_but_not_over_explicit():
    bundle = json.dumps({"baseline": json.loads(OAS_CAND), "candidate": json.loads(OAS_CAND)})
    active = _run(bundle, {"stored_baseline": _stored(OAS_BASE)})
    assert active.metrics.additional_metrics["baselineSource"] == "INPUT"
    assert active.metrics.additional_metrics["breakingChangesCount"] == 0
    explicit = _run(bundle, {"stored_baseline": _stored(OAS_BASE, explicit=True)})
    assert explicit.metrics.additional_metrics["baselineSource"] == "STORED_BASELINE"
    assert explicit.metrics.additional_metrics["baselineSelection"] == "EXPLICIT"
    assert explicit.metrics.additional_metrics["breakingChangesCount"] > 0


def test_identical_spec_against_stored_baseline_is_clean():
    resp = _run(OAS_BASE, {"stored_baseline": _stored(OAS_BASE)})
    assert resp.status == AnalysisStatus.COMPLETED
    assert resp.findings == []


def test_yaml_candidate_against_stored_json_baseline():
    import yaml

    resp = _run(yaml.safe_dump(json.loads(OAS_CAND), sort_keys=False), {"stored_baseline": _stored(OAS_BASE)})
    cats = _by_category(resp)
    assert "request-parameter-renamed" in cats and "security-scheme-removed" in cats


def test_determinism(oas):
    again = _run(OAS_CAND, {"sourceFileName": "salesorder-v2.json", "stored_baseline": _stored(OAS_BASE)})
    assert [f.model_dump(mode="json") for f in again.findings] == [f.model_dump(mode="json") for f in oas.findings]


# ---------------------------------------------------------------------------------------- security semantics
def _sec_spec(global_sec, op_sec=None):
    op = {"responses": {"200": {"description": "ok"}}}
    if op_sec is not None:
        op["security"] = op_sec
    doc = {"openapi": "3.0.0", "info": {"title": "t", "version": "1"}, "paths": {"/x": {"get": op}},
           "components": {"securitySchemes": {"oauth2": {"type": "oauth2", "flows": {}}}}}
    if global_sec is not None:
        doc["security"] = global_sec
    return json.dumps(doc)


@pytest.mark.parametrize("base,cand,breaking", [
    (None, [{"oauth2": []}], True),                            # public -> protected
    ([{"oauth2": ["a"]}], [{"oauth2": ["a", "b"]}], True),     # extra scope required
    ([{"oauth2": ["a"]}], [{"oauth2": ["a"]}, {"apiKey": []}], False),  # alternative added
    ([{"oauth2": ["a"]}], None, False),                        # became public
])
def test_global_security_semantics(base, cand, breaking):
    resp = _run(None, {"baseline": _sec_spec(base), "candidate": _sec_spec(cand)})
    found = any(f.technical_details.get("changeCategory") == "global-security-changed" for f in resp.findings)
    assert found is breaking


# ---------------------------------------------------------------------------------------- properties
BASE_DOC = json.loads(OAS_BASE)


@settings(max_examples=40, deadline=4000, suppress_health_check=[HealthCheck.too_slow])
@given(st.sampled_from(sorted(BASE_DOC["paths"])), st.data())
def test_property_removing_any_operation_is_detected(path, data):
    methods = sorted(BASE_DOC["paths"][path])
    method = data.draw(st.sampled_from(methods))
    cand = copy.deepcopy(BASE_DOC)
    del cand["paths"][path][method]
    if not cand["paths"][path]:
        del cand["paths"][path]
    resp = _run(json.dumps(cand), {"stored_baseline": _stored(OAS_BASE)})
    codes = {f.rule_id for f in resp.findings}
    assert codes & {"API_BREAKING_OPERATION_REMOVED", "API_BREAKING_ENDPOINT_REMOVED"}
    for f in resp.findings:
        assert f.confidence in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED)
        assert len(f.evidence[0].sha256) == 64


@settings(max_examples=40, deadline=4000, suppress_health_check=[HealthCheck.too_slow])
@given(st.sampled_from(sorted(BASE_DOC["components"]["schemas"]["SalesOrder"]["properties"])))
def test_property_removing_any_schema_property_is_detected(prop):
    cand = copy.deepcopy(BASE_DOC)
    del cand["components"]["schemas"]["SalesOrder"]["properties"][prop]
    resp = _run(json.dumps(cand), {"stored_baseline": _stored(OAS_BASE)})
    removed = [f for f in resp.findings if f.rule_id == "API_BREAKING_FIELD_REMOVED"]
    assert [f.technical_details["property"] for f in removed] == [prop]
    assert removed[0].technical_details["jsonPointer"] == f"/components/schemas/SalesOrder/properties/{prop}"


@settings(max_examples=40, deadline=4000, suppress_health_check=[HealthCheck.too_slow])
@given(st.text(max_size=200))
def test_property_garbage_candidate_never_yields_verdict(text):
    resp = _run(text, {"stored_baseline": _stored(OAS_BASE)})
    if resp.status == AnalysisStatus.FAILED:
        assert all(f.confidence == ConfidenceClass.UNKNOWN for f in resp.findings)
