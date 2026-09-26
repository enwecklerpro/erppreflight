"""
Rule self-test against the golden fixture set (spec 10.10 Rule Admin: "Publishing requires tests to pass").

The golden set lives in ``src/selftest/golden`` so it ships with the service image (the pytest tree is
excluded from images). ``manifest.json`` lists *cases*: one engine input (a fixture file plus optional
configuration / target release) together with the exact finding codes the engine must emit for it.

For a rule code R of engine E:

* **positive cases** — cases of E whose ``expectedCodes`` contain R: running them MUST emit R;
* **negative cases** — cases of E that ran to a verdict (COMPLETED / PARTIAL) and whose ``expectedCodes``
  do not contain R: running them MUST NOT emit R.

A rule without at least one positive and one negative case is a coverage gap: its self-test reports
``NO_FIXTURES`` and the API refuses to publish it.

Determinism (AGENTS.md Axiom 2 #4): cases run through the production :class:`EngineRunner` with fixed job /
tenant / project identifiers; the result digest covers the rule version, fixture hashes and emitted
finding fingerprints and excludes timing, so two runs on identical inputs yield the same digest. The
self-test never changes engine behaviour or persisted findings.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field

from src.core.registry import EngineRegistry
from src.core.runner import EngineRunner
from src.models.enums import EngineType
from src.models.request import AnalysisRequest

GOLDEN_DIR = Path(__file__).resolve().parent / "golden"
MANIFEST_PATH = GOLDEN_DIR / "manifest.json"
FIXTURE_DIR = GOLDEN_DIR / "fixtures"

# Fixed identifiers: the self-test is not an analysis of customer data and must be reproducible.
SELF_TEST_JOB_ID = "golden-self-test"
SELF_TEST_TENANT_ID = "00000000-0000-0000-0000-000000000000"
SELF_TEST_PROJECT_ID = "00000000-0000-0000-0000-000000000000"

VERDICT_STATUSES = frozenset({"COMPLETED", "PARTIAL"})
MAX_FIXTURE_BYTES = 512 * 1024


class GoldenCase(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    engine: EngineType
    file: str = Field(..., min_length=3, max_length=300)
    sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    origin: Literal["repository-fixture", "authored-golden", "unit-test-payload", "contract-probe"]
    expected_status: str = Field(..., alias="expectedStatus")
    expected_codes: List[str] = Field(..., alias="expectedCodes")
    configuration: Dict[str, Any] = Field(default_factory=dict)
    target_release: Optional[str] = Field(None, alias="targetRelease")


class GoldenManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    manifest_version: str = Field(..., alias="manifestVersion")
    description: str
    default_target_release: str = Field(..., alias="defaultTargetRelease")
    cases: Dict[str, GoldenCase]


class FixtureIntegrityError(RuntimeError):
    """A golden fixture file is missing, too large, outside the golden directory or does not match its hash."""


@lru_cache(maxsize=1)
def load_manifest() -> GoldenManifest:
    return GoldenManifest.model_validate(json.loads(MANIFEST_PATH.read_text(encoding="utf-8")))


def read_case_content(case: GoldenCase) -> str:
    """Reads a fixture file after path-confinement, size and SHA-256 integrity checks."""
    path = (FIXTURE_DIR / case.file).resolve()
    if FIXTURE_DIR.resolve() not in path.parents:
        raise FixtureIntegrityError(f"fixture path escapes the golden directory: {case.file}")
    if not path.is_file():
        raise FixtureIntegrityError(f"fixture file missing: {case.file}")
    data = path.read_bytes()
    if len(data) > MAX_FIXTURE_BYTES:
        raise FixtureIntegrityError(f"fixture file too large: {case.file}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != case.sha256:
        raise FixtureIntegrityError(f"fixture hash mismatch for {case.file}: {digest} != {case.sha256}")
    return data.decode("utf-8")


def rule_index() -> Dict[str, EngineType]:
    """Rule code -> engine for every registered engine (declared + runner-generated input codes)."""
    index: Dict[str, EngineType] = {}
    for et in EngineType:
        if not EngineRegistry.is_registered(et):
            continue
        for code in EngineRegistry.get(et).get_rule_catalog():
            index[code] = et
    return index


@dataclass(frozen=True)
class RuleCases:
    rule_code: str
    engine_type: EngineType
    positive: Tuple[str, ...]
    negative: Tuple[str, ...]

    @property
    def gap(self) -> Optional[str]:
        if not self.positive and not self.negative:
            return "NO_FIXTURES"
        if not self.positive:
            return "NO_POSITIVE_FIXTURE"
        if not self.negative:
            return "NO_NEGATIVE_FIXTURE"
        return None


def cases_for_rule(rule_code: str, engine_type: EngineType, manifest: Optional[GoldenManifest] = None) -> RuleCases:
    manifest = manifest or load_manifest()
    positive: List[str] = []
    negative: List[str] = []
    for case_id in sorted(manifest.cases):
        case = manifest.cases[case_id]
        if case.engine != engine_type:
            continue
        if rule_code in case.expected_codes:
            positive.append(case_id)
        elif case.expected_status in VERDICT_STATUSES:
            negative.append(case_id)
    return RuleCases(rule_code, engine_type, tuple(positive), tuple(negative))


def coverage_report(manifest: Optional[GoldenManifest] = None) -> Dict[str, Any]:
    """Per-rule golden coverage for every registered engine (Admin Trust Center / Rule Admin)."""
    manifest = manifest or load_manifest()
    rules: List[Dict[str, Any]] = []
    for code, et in sorted(rule_index().items(), key=lambda kv: (kv[1].value, kv[0])):
        rc = cases_for_rule(code, et, manifest)
        engine = EngineRegistry.get(et)
        rules.append({
            "ruleCode": code,
            "engineType": et.value,
            "ruleVersion": engine.rule_version(code),
            "inputValidationRule": code not in engine.finding_codes,
            "positiveCases": list(rc.positive),
            "negativeCases": list(rc.negative),
            "covered": rc.gap is None,
            "gap": rc.gap,
        })
    covered = sum(1 for r in rules if r["covered"])
    return {
        "manifestVersion": manifest.manifest_version,
        "totalCases": len(manifest.cases),
        "summary": {
            "rules": len(rules),
            "covered": covered,
            "gaps": len(rules) - covered,
            "findingRules": sum(1 for r in rules if not r["inputValidationRule"]),
            "findingRulesCovered": sum(1 for r in rules if r["covered"] and not r["inputValidationRule"]),
        },
        "rules": rules,
    }


def _findings_digest(findings: List[Any]) -> str:
    items = sorted((f.rule_id, f.fingerprint or "") for f in findings)
    return hashlib.sha256(json.dumps(items, separators=(",", ":")).encode("utf-8")).hexdigest()


@dataclass
class CaseOutcome:
    case_id: str
    kind: str
    fixture: str
    fixture_sha256: str
    status: str
    emitted_codes: List[str]
    findings_digest: str
    passed: bool
    detail: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "caseId": self.case_id,
            "kind": self.kind,
            "fixture": self.fixture,
            "fixtureSha256": self.fixture_sha256,
            "status": self.status,
            "emittedCodes": self.emitted_codes,
            "findingsDigest": self.findings_digest,
            "passed": self.passed,
            "detail": self.detail,
        }


async def _run_case(manifest: GoldenManifest, case_id: str, kind: str, rule_code: str) -> CaseOutcome:
    case = manifest.cases[case_id]
    try:
        content = read_case_content(case)
    except FixtureIntegrityError as exc:
        return CaseOutcome(case_id, kind, case.file, case.sha256, "ERROR", [], "", False, str(exc))
    request = AnalysisRequest(
        job_id=SELF_TEST_JOB_ID,
        tenant_id=SELF_TEST_TENANT_ID,
        project_id=SELF_TEST_PROJECT_ID,
        engine_type=case.engine,
        target_release=case.target_release or manifest.default_target_release,
        raw_content=content,
        configuration=dict(case.configuration),
    )
    response = await EngineRunner.execute(request)
    emitted = sorted({f.rule_id for f in response.findings})
    fired = rule_code in emitted
    passed = fired if kind == "POSITIVE" else not fired
    if kind == "POSITIVE":
        detail = "rule emitted as expected" if passed else "rule was NOT emitted on its positive fixture"
    else:
        detail = "rule correctly silent" if passed else "rule fired on a negative fixture"
    return CaseOutcome(
        case_id, kind, case.file, case.sha256, response.status.value, emitted,
        _findings_digest(response.findings), passed, detail,
    )


class UnknownRuleError(KeyError):
    pass


async def run_rule_self_test(rule_code: str, manifest: Optional[GoldenManifest] = None) -> Dict[str, Any]:
    """Runs one rule's positive and negative golden cases. Deterministic; never persists anything."""
    manifest = manifest or load_manifest()
    engine_type = rule_index().get(rule_code)
    if engine_type is None:
        raise UnknownRuleError(rule_code)
    engine = EngineRegistry.get(engine_type)
    rc = cases_for_rule(rule_code, engine_type, manifest)
    started = time.perf_counter()
    outcomes: List[CaseOutcome] = []
    if rc.gap is None:
        for case_id in rc.positive:
            outcomes.append(await _run_case(manifest, case_id, "POSITIVE", rule_code))
        for case_id in rc.negative:
            outcomes.append(await _run_case(manifest, case_id, "NEGATIVE", rule_code))

    if rc.gap is not None:
        status = "NO_FIXTURES"
    elif any(o.status == "ERROR" for o in outcomes):
        status = "ERROR"
    elif all(o.passed for o in outcomes):
        status = "PASSED"
    else:
        status = "FAILED"

    result: Dict[str, Any] = {
        "ruleCode": rule_code,
        "engineType": engine_type.value,
        "engineVersion": engine.version,
        "ruleVersion": engine.rule_version(rule_code),
        "manifestVersion": manifest.manifest_version,
        "status": status,
        "passed": status == "PASSED",
        "coverageGap": rc.gap,
        "positiveCount": len(rc.positive),
        "negativeCount": len(rc.negative),
        "cases": [o.as_dict() for o in outcomes],
    }
    canonical = json.dumps(result, sort_keys=True, separators=(",", ":"))
    result["resultDigest"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    # Timing is reported but deliberately excluded from the digest (not part of the verdict).
    result["durationMs"] = int((time.perf_counter() - started) * 1000)
    return result
