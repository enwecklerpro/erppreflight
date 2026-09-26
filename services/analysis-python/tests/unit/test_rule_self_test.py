"""
Rule self-test against golden fixtures (spec 10.10, AGENTS.md Axiom 2 #4/#8/#9).

Guards the golden manifest itself (every case emits exactly its recorded codes, file hashes match) and
the self-test semantics the Rule Admin publish gate relies on: positive cases must emit the rule,
negative cases must not, uncovered rules report NO_FIXTURES, and the verdict digest is deterministic.
"""

from __future__ import annotations

import asyncio
import hashlib
import json

import pytest

import src.engines  # noqa: F401 — registers all engines
from src.core.runner import EngineRunner
from src.models.request import AnalysisRequest
from src.selftest import golden
from src.selftest.golden import (
    FIXTURE_DIR,
    FixtureIntegrityError,
    GoldenCase,
    UnknownRuleError,
    cases_for_rule,
    coverage_report,
    load_manifest,
    read_case_content,
    rule_index,
    run_rule_self_test,
)

MANIFEST = load_manifest()
COVERAGE = coverage_report()
COVERED_RULES = [r["ruleCode"] for r in COVERAGE["rules"] if r["covered"]]
GAP_RULES = [r["ruleCode"] for r in COVERAGE["rules"] if not r["covered"]]


def run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize("case_id", sorted(MANIFEST.cases))
def test_golden_case_emits_exactly_its_recorded_codes(case_id):
    case = MANIFEST.cases[case_id]
    content = read_case_content(case)
    req = AnalysisRequest(
        job_id=golden.SELF_TEST_JOB_ID,
        tenant_id=golden.SELF_TEST_TENANT_ID,
        project_id=golden.SELF_TEST_PROJECT_ID,
        engine_type=case.engine,
        target_release=case.target_release or MANIFEST.default_target_release,
        raw_content=content,
        configuration=dict(case.configuration),
    )
    resp = run(EngineRunner.execute(req))
    assert resp.status.value == case.expected_status
    assert sorted({f.rule_id for f in resp.findings}) == case.expected_codes


def test_every_fixture_file_is_referenced_and_hash_verified():
    referenced = {c.file for c in MANIFEST.cases.values()}
    on_disk = {str(p.relative_to(FIXTURE_DIR)) for p in FIXTURE_DIR.rglob("*") if p.is_file()}
    assert on_disk == referenced, "unreferenced or missing golden fixture files"
    for case in MANIFEST.cases.values():
        data = (FIXTURE_DIR / case.file).read_bytes()
        assert hashlib.sha256(data).hexdigest() == case.sha256, case.file
        assert case.file.startswith(case.engine.value + "/")


def test_manifest_codes_are_declared_by_their_engine():
    index = rule_index()
    for case_id, case in MANIFEST.cases.items():
        for code in case.expected_codes:
            assert index.get(code) == case.engine, f"{case_id}: {code} not declared by {case.engine.value}"


def test_coverage_report_is_consistent():
    s = COVERAGE["summary"]
    assert s["rules"] == len(rule_index()) == len(COVERAGE["rules"])
    assert s["covered"] + s["gaps"] == s["rules"]
    assert s["covered"] == len(COVERED_RULES)
    # Every engine contributes covered finding rules; most declared finding rules have golden coverage.
    assert s["findingRulesCovered"] >= 120
    engines_with_coverage = {r["engineType"] for r in COVERAGE["rules"] if r["covered"] and not r["inputValidationRule"]}
    assert len(engines_with_coverage) == 19
    for r in COVERAGE["rules"]:
        assert r["ruleVersion"] and "#" in r["ruleVersion"]
        if r["covered"]:
            assert r["positiveCases"] and r["negativeCases"] and r["gap"] is None


@pytest.mark.parametrize("rule_code", COVERED_RULES)
def test_covered_rule_self_test_passes(rule_code):
    result = run(run_rule_self_test(rule_code))
    assert result["status"] == "PASSED", [c for c in result["cases"] if not c["passed"]]
    assert result["passed"] is True
    kinds = {c["kind"] for c in result["cases"]}
    assert kinds == {"POSITIVE", "NEGATIVE"}
    assert all(len(c["fixtureSha256"]) == 64 for c in result["cases"])


@pytest.mark.parametrize("rule_code", GAP_RULES)
def test_uncovered_rule_reports_no_fixtures(rule_code):
    result = run(run_rule_self_test(rule_code))
    assert result["status"] == "NO_FIXTURES"
    assert result["passed"] is False
    assert result["coverageGap"] in ("NO_FIXTURES", "NO_POSITIVE_FIXTURE", "NO_NEGATIVE_FIXTURE")
    assert result["cases"] == []


def test_known_gaps_are_reported_honestly():
    # Size / archive rejections need multi-megabyte or crafted archive inputs; they stay gaps on purpose.
    assert "OPD_PAYLOAD_TOO_LARGE" in GAP_RULES
    assert "CLEAN_CORE_ARCHIVE_REJECTED" in GAP_RULES
    assert "OPD_DETERMINATION_STEP_MISSING" in COVERED_RULES


def test_self_test_digest_is_deterministic():
    a = run(run_rule_self_test("OPD_CHANNEL_INACTIVE"))
    b = run(run_rule_self_test("OPD_CHANNEL_INACTIVE"))
    assert a["resultDigest"] == b["resultDigest"]
    stripped = {k: v for k, v in a.items() if k not in ("durationMs", "resultDigest")}
    recomputed = hashlib.sha256(json.dumps(stripped, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert recomputed == a["resultDigest"]
    assert a["ruleVersion"].startswith(a["engineVersion"] + "#")


def test_negative_case_that_fires_fails_the_self_test():
    """A manifest in which a 'negative' case actually emits the rule must fail (the gate works)."""
    manifest = load_manifest().model_copy(deep=True)
    rc = cases_for_rule("OPD_CHANNEL_INACTIVE", rule_index()["OPD_CHANNEL_INACTIVE"], manifest)
    positive_id = rc.positive[0]
    # Re-label the positive case as a negative one by dropping the code from its expectations.
    manifest.cases[positive_id] = manifest.cases[positive_id].model_copy(
        update={"expected_codes": [c for c in manifest.cases[positive_id].expected_codes if c != "OPD_CHANNEL_INACTIVE"]}
    )
    # Keep at least one positive case so the rule is not reported as a gap.
    fake_positive = manifest.cases[rc.negative[0]].model_copy(update={"expected_codes": ["OPD_CHANNEL_INACTIVE"]})
    manifest.cases["zz_fake_positive"] = fake_positive
    result = run(run_rule_self_test("OPD_CHANNEL_INACTIVE", manifest))
    assert result["status"] == "FAILED"
    failed = {c["caseId"]: c for c in result["cases"] if not c["passed"]}
    assert positive_id in failed and failed[positive_id]["kind"] == "NEGATIVE"
    assert "zz_fake_positive" in failed and failed["zz_fake_positive"]["kind"] == "POSITIVE"


def test_tampered_fixture_is_an_error_not_a_pass(tmp_path, monkeypatch):
    manifest = load_manifest().model_copy(deep=True)
    rc = cases_for_rule("OPD_CHANNEL_INACTIVE", rule_index()["OPD_CHANNEL_INACTIVE"], manifest)
    cid = rc.positive[0]
    manifest.cases[cid] = manifest.cases[cid].model_copy(update={"sha256": "0" * 64})
    result = run(run_rule_self_test("OPD_CHANNEL_INACTIVE", manifest))
    assert result["status"] == "ERROR"
    assert result["passed"] is False


def test_fixture_path_confinement():
    bad = GoldenCase.model_validate({
        "engine": "OPD_GUARD", "file": "../../../main.py", "sha256": "0" * 64, "origin": "authored-golden",
        "expectedStatus": "COMPLETED", "expectedCodes": [],
    })
    with pytest.raises(FixtureIntegrityError):
        read_case_content(bad)


def test_unknown_rule_raises():
    with pytest.raises(UnknownRuleError):
        run(run_rule_self_test("NOT_A_REAL_RULE"))


def test_self_test_api_endpoints(client):
    cov = client.get("/api/v1/rules/golden-coverage")
    assert cov.status_code == 200
    body = cov.json()
    assert body["summary"]["covered"] == COVERAGE["summary"]["covered"]
    ok = client.post("/api/v1/rules/OPD_CHANNEL_INACTIVE/self-test")
    assert ok.status_code == 200 and ok.json()["status"] == "PASSED"
    gap = client.post("/api/v1/rules/ECC_IDOC_UNSUPPORTED_BLOCKER/self-test")
    assert gap.status_code == 200 and gap.json()["status"] == "NO_FIXTURES"
    assert client.post("/api/v1/rules/NOT_A_REAL_RULE/self-test").status_code == 404
    assert client.post("/api/v1/rules/bad%20code/self-test").status_code == 422
