"""Part 04 §4.10: every analysis response reports the engine version and the version of each emitted rule."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

for p in Path(__file__).resolve().parents:
    cand_srv = p / "services" / "analysis-python"
    if cand_srv.is_dir() and str(cand_srv) not in sys.path:
        sys.path.insert(0, str(cand_srv))
        break

import src.engines  # noqa: F401,E402
from src.core.registry import EngineRegistry  # noqa: E402
from src.core.runner import EngineRunner  # noqa: E402
from src.models.enums import ArtifactType, EngineType  # noqa: E402
from src.models.request import AnalysisRequest  # noqa: E402

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "tests" / "fixtures").is_dir() and (p / "services").is_dir())
BAD_OPD = (REPO_ROOT / "tests" / "fixtures" / "known_bad_billing_opd.xml").read_text(encoding="utf-8")


def _run(content: str):
    req = AnalysisRequest(
        job_id="00000000-0000-4000-8000-000000000001",
        tenant_id="tenant-rule-version",
        project_id="project-rule-version",
        engine_type=EngineType.OPD_GUARD,
        raw_content=content,
        artifact_type=ArtifactType.XML,
    )
    return asyncio.run(EngineRunner.execute(req))


def test_response_carries_engine_and_rule_versions():
    resp = _run(BAD_OPD)
    engine = EngineRegistry.get(EngineType.OPD_GUARD)
    metrics = resp.metrics.additional_metrics
    assert metrics["engineVersion"] == engine.version
    emitted = sorted({f.rule_id for f in resp.findings})
    assert emitted, "fixture must trigger at least one rule"
    assert sorted(metrics["ruleVersions"]) == emitted
    for code in emitted:
        version = metrics["ruleVersions"][code]
        assert version.startswith(f"{engine.version}#")
        assert len(version.split("#", 1)[1]) == 16


def test_rule_versions_are_deterministic_and_definition_sensitive():
    engine = EngineRegistry.get(EngineType.OPD_GUARD)
    code = sorted(engine.finding_codes)[0]
    assert engine.rule_version(code) == engine.rule_version(code)
    other = sorted(engine.finding_codes)[1]
    assert engine.rule_version(code) != engine.rule_version(other)
    assert engine.rule_version("NOT_A_DECLARED_RULE") is None
    assert _run(BAD_OPD).metrics.additional_metrics["ruleVersions"] == _run(BAD_OPD).metrics.additional_metrics["ruleVersions"]


def test_catalog_entry_lists_rule_versions():
    entry = EngineRegistry.get(EngineType.OPD_GUARD).get_catalog_entry()
    assert all(r["version"] and r["version"].startswith(entry["version"] + "#") for r in entry["rules"])
