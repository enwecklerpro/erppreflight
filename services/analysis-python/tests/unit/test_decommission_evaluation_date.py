"""Safe Decommission: time-based rules use the input evaluation date only (Axiom 2 #4)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import src.engines  # noqa: F401
from src.core.runner import EngineRunner
from src.models.enums import AnalysisStatus, ConfidenceClass, EngineType
from src.models.request import AnalysisOptions, AnalysisRequest

FIX = Path(__file__).resolve().parent.parent / "fixtures" / "domain5"


def _payload(**overrides):
    data = json.loads((FIX / "decom_clean_user.json").read_text())
    data.pop("evaluation_date", None)
    data["users"][0]["last_logon_date"] = "2026-09-01"
    data.update(overrides)
    return data


async def _run(payload, **kw):
    return await EngineRunner.execute(AnalysisRequest(
        job_id="decom-date", tenant_id="t", project_id="p",
        engine_type=EngineType.SAFE_DECOMMISSION_PREFLIGHT, raw_content=json.dumps(payload), **kw,
    ))


@pytest.mark.asyncio
async def test_missing_evaluation_date_withholds_time_rules_and_verdict():
    resp = await _run(_payload())
    ids = [f.rule_id for f in resp.findings]
    assert resp.status == AnalysisStatus.PARTIAL
    assert "DECOM_SAFE_FOR_ARCHIVING" not in ids
    assert "DECOM_RECENT_ACTIVITY_DETECTED" not in ids
    missing = [f for f in resp.findings if f.technical_details.get("missingInput") == "evaluation_date"]
    assert len(missing) == 1 and missing[0].rule_id == "DECOM_INSUFFICIENT_INPUT"
    assert missing[0].confidence == ConfidenceClass.UNKNOWN


@pytest.mark.asyncio
@pytest.mark.parametrize("where", ["payload", "configuration", "options"])
async def test_evaluation_date_drives_recency_deterministically(where):
    payload = _payload()
    kw = {}
    if where == "payload":
        payload["evaluation_date"] = "2026-09-10"
    elif where == "configuration":
        kw["configuration"] = {"evaluation_date": "2026-09-10"}
    else:
        kw["options"] = AnalysisOptions(custom_params={"evaluation_date": "2026-09-10"})
    resp = await _run(payload, **kw)
    assert [f.rule_id for f in resp.findings] == ["DECOM_RECENT_ACTIVITY_DETECTED"]
    # Far in the future relative to last logon -> safe verdict, independent of today's date.
    payload2 = _payload(evaluation_date="2027-09-10")
    resp2 = await _run(payload2)
    assert [f.rule_id for f in resp2.findings] == ["DECOM_SAFE_FOR_ARCHIVING"]
    assert resp2.status == AnalysisStatus.COMPLETED


@pytest.mark.asyncio
async def test_invalid_evaluation_date_is_rejected():
    resp = await _run(_payload(evaluation_date="yesterday"))
    assert resp.status == AnalysisStatus.FAILED
    assert [f.rule_id for f in resp.findings] == ["DECOM_INVALID_INPUT"]
