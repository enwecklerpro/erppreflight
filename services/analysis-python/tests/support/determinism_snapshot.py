"""Runs every golden fixture through its engine and prints a canonical JSON snapshot.

Used by tests/unit/test_determinism.py in subprocesses with different PYTHONHASHSEED values:
identical inputs must produce byte-identical findings regardless of hash randomisation, process,
or wall clock (AGENTS.md Axiom 2 #4). Timing / memory telemetry is excluded (it is not a finding).
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import src.engines  # noqa: E402,F401
from src.core.runner import EngineRunner  # noqa: E402
from src.models.enums import EngineType  # noqa: E402
from src.models.request import AnalysisRequest  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"

PREFIX_ENGINE = [
    ("opd_", EngineType.OPD_GUARD),
    ("form_", EngineType.FORM_DOCTOR),
    ("custom_field_", EngineType.CUSTOM_FIELD_FLOW_DOCTOR),
    ("extension_", EngineType.EXTENSION_IMPACT_GUARD),
    ("spro_", EngineType.SPRO2CLOUD),
    ("ecc_", EngineType.ECC2CLOUD_NAVIGATOR),
    ("gap_radar_", EngineType.SAP_GAP_RADAR),
    ("clean_core_", EngineType.CLEAN_CORE_OBJECT_GUARD),
    ("cp_", EngineType.CHANGE_POINTER_COVERAGE_AUDITOR),
    ("api_", EngineType.API_CHANGE_GUARD),
    ("sc_", EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD),
    ("tr_", EngineType.TRANSPORT_DEPENDENCY_ANALYZER),
    ("decom_", EngineType.SAFE_DECOMMISSION_PREFLIGHT),
    ("fiori_", EngineType.FIORI_403_ROOT_CAUSE_DOCTOR),
    ("wf_", EngineType.WORKFLOW_STUCK_EXPLAINER),
    ("iam_", EngineType.IAM_COST_OPTIMIZER),
    ("acct_det_", EngineType.ACCOUNT_DETERMINATION_PREFLIGHT),
    ("refresh_", EngineType.SYSTEM_REFRESH_DELTA_GUARD),
    ("mfs_", EngineType.MFS_BLACKBOX),
]

VOLATILE_METRICS = {"execution_time_ms", "peak_memory_bytes"}
VOLATILE_TELEMETRY = {"durationMs", "peakMemoryBytes"}


def engine_for(name: str):
    for prefix, et in PREFIX_ENGINE:
        if name.startswith(prefix):
            return et
    return None


def canonical(resp) -> dict:
    data = resp.model_dump(mode="json")
    metrics = data.get("metrics") or {}
    for k in VOLATILE_METRICS:
        metrics.pop(k, None)
    add = metrics.get("additional_metrics") or {}
    tel = add.get("telemetry") or {}
    for k in VOLATILE_TELEMETRY:
        tel.pop(k, None)
    add.pop("execution_time_ms", None)
    return data


async def main() -> None:
    out = {}
    for path in sorted(FIXTURES.rglob("*")):
        if not path.is_file():
            continue
        et = engine_for(path.name)
        if et is None:
            continue
        req = AnalysisRequest(
            job_id="determinism-job",
            tenant_id="determinism-tenant",
            project_id="determinism-project",
            engine_type=et,
            raw_content=path.read_text(encoding="utf-8"),
            configuration={"evaluation_date": "2026-09-15"} if et == EngineType.SAFE_DECOMMISSION_PREFLIGHT else {},
        )
        resp = await EngineRunner.execute(req)
        out[str(path.relative_to(FIXTURES))] = canonical(resp)
    sys.stdout.write(json.dumps(out, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(main())
