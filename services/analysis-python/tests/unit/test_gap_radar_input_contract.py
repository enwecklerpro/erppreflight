"""SAP Gap Radar — input contract: non-SAP prose is rejected, legitimate requirement formats keep working.

Closes KNOWN_LIMITATIONS E2: plain English text used to be answered with GAP_RADAR_UNKNOWN_REQUIREMENT
(a verdict on input the engine did not understand). The declared input contract now rejects it with
GAP_RADAR_INVALID_INPUT (UNKNOWN confidence, status FAILED, no verdict) — the same mechanism every other
engine uses. Fixtures: tests/fixtures/domain2/gap_radar_*.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

import src.engines  # noqa: F401
from src.core.runner import EngineRunner
from src.engines.gap_radar import (
    GapRadarEngine,
    sap_requirement_anchors,
    sap_requirement_problem,
    split_plain_requirements,
)
from src.models.enums import AnalysisStatus, ArtifactType, ConfidenceClass, EngineType
from src.models.request import AnalysisRequest

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "domain2"


def _run(raw: str | None = None, configuration: dict | None = None, artifact_type=ArtifactType.TXT):
    req = AnalysisRequest(
        job_id="gap-contract", tenant_id="t", project_id="p", engine_type=EngineType.SAP_GAP_RADAR,
        raw_content=raw, configuration=configuration or {}, artifact_type=artifact_type,
    )
    return asyncio.run(EngineRunner.execute(req))


def _codes(resp):
    return [f.rule_id for f in resp.findings]


NON_SAP_PROSE = [
    "The quick brown fox jumps over the lazy dog",
    "this is not an SAP artifact\nlorem ipsum 42\n",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit",
    "I would like to order a pizza with fast delivery tonight",
    "Meet at 5 pm with the whole team on Tuesday morning",
    "Our ERP project needs to be great and successful this year",
    "Need a report on YAML files for the developers",
]

SAP_REQUIREMENTS = [
    "Standard purchase order approval for plant 1010",
    "Configure payment terms via SSCUI",
    "Add custom field ZZ1_PRIORITY to the sales order header",
    "Subscribe to the business event when a billing document is created",
    "Customers must receive the invoice by e-mail after billing",
    "Automated physical commodity futures settlement known product gap on public cloud roadmap",
    "Read journal entries through the released CDS view I_JOURNALENTRY",
    "Replace the classic user exit in transaction VA01 with a released BAdI",
]


@pytest.mark.parametrize("text", NON_SAP_PROSE)
def test_plain_prose_is_rejected_not_classified(text):
    resp = _run(text)
    assert resp.status == AnalysisStatus.FAILED
    assert _codes(resp) == ["GAP_RADAR_INVALID_INPUT"]
    assert resp.findings[0].confidence == ConfidenceClass.UNKNOWN
    assert "GAP_RADAR_UNKNOWN_REQUIREMENT" not in _codes(resp)
    assert "not an SAP business or technical requirement" in (resp.error_message or "")


@pytest.mark.parametrize("text", SAP_REQUIREMENTS)
def test_sap_requirements_are_still_classified(text):
    assert sap_requirement_problem(text) is None, sap_requirement_anchors(text)
    resp = _run(text)
    assert resp.status == AnalysisStatus.COMPLETED
    assert len(resp.findings) == 1
    assert resp.findings[0].rule_id.startswith("GAP_RADAR_")
    assert resp.findings[0].rule_id != "GAP_RADAR_INVALID_INPUT"


def test_unclassifiable_sap_requirement_keeps_unknown_verdict():
    """UNKNOWN_REQUIREMENT remains for statements that ARE SAP requirements but match no tier keyword."""
    resp = _run("Customers must receive the invoice by e-mail after billing")
    assert _codes(resp) == ["GAP_RADAR_UNKNOWN_REQUIREMENT"]
    assert resp.findings[0].confidence == ConfidenceClass.UNKNOWN


def test_vendor_name_alone_is_not_an_anchor():
    assert sap_requirement_problem("We are an SAP customer and like ERP software") is not None
    assert sap_requirement_problem("Use SAP for everything in the company") is not None


def test_statement_must_have_three_words():
    assert "three words" in (sap_requirement_problem("BSEG") or "")


# ---------------------------------------------------------------------------------------- golden fixtures
def test_fixture_requirement_list_positive():
    resp = _run((FIXTURES / "gap_radar_requirement_list.txt").read_text(encoding="utf-8"))
    assert resp.status == AnalysisStatus.COMPLETED
    assert _codes(resp) == [
        "GAP_RADAR_SUPPORTED_CONFIGURATION",
        "GAP_RADAR_SUPPORTED_KEY_USER",
        "GAP_RADAR_SUPPORTED_BUSINESS_EVENT",
        "GAP_RADAR_BLOCKED_CLEAN_CORE_VIOLATION",
    ]
    assert resp.metrics.additional_metrics["total_requirements"] == 4
    # Evidence points at the exact line of each list item.
    assert [f.evidence[0].line_number for f in resp.findings] == [1, 2, 3, 4]
    for f in resp.findings:
        assert len(f.evidence[0].sha256) == 64


def test_fixture_non_sap_prose_negative():
    resp = _run((FIXTURES / "gap_radar_non_sap_prose.txt").read_text(encoding="utf-8"))
    assert resp.status == AnalysisStatus.FAILED
    assert _codes(resp) == ["GAP_RADAR_INVALID_INPUT"]


def test_fixture_mixed_batch_edge_names_the_offending_item():
    resp = _run((FIXTURES / "gap_radar_mixed_batch.json").read_text(encoding="utf-8"), artifact_type=ArtifactType.JSON)
    assert resp.status == AnalysisStatus.FAILED
    assert _codes(resp) == ["GAP_RADAR_INVALID_INPUT"]
    assert "requirements[1]" in resp.error_message
    assert "requirements[0]" not in resp.error_message


def test_existing_json_fixtures_still_classified():
    for name, code in (
        ("gap_radar_event_mesh.json", "GAP_RADAR_SUPPORTED_BUSINESS_EVENT"),
        ("gap_radar_direct_db_write.json", "GAP_RADAR_BLOCKED_CLEAN_CORE_VIOLATION"),
        ("gap_radar_known_gap.json", "GAP_RADAR_KNOWN_PRODUCT_GAP"),
    ):
        resp = _run((FIXTURES / name).read_text(encoding="utf-8"), artifact_type=ArtifactType.JSON)
        assert resp.status == AnalysisStatus.COMPLETED, name
        assert code in _codes(resp), name


def test_configuration_payload_uses_the_same_contract():
    rejected = _run(configuration={"requirement": "The quick brown fox jumps over the lazy dog"})
    assert _codes(rejected) == ["GAP_RADAR_INVALID_INPUT"]
    accepted = _run(configuration={"requirement": "Configure payment terms via SSCUI"})
    assert accepted.status == AnalysisStatus.COMPLETED


def test_structured_context_counts_as_anchor():
    payload = {"requirements": [{"requirement": "Approvals above 10k need a second approver", "module": "MM",
                                 "scope_items": ["J45"]}]}
    resp = _run(json.dumps(payload), artifact_type=ArtifactType.JSON)
    assert resp.status == AnalysisStatus.COMPLETED


def test_split_plain_requirements():
    assert split_plain_requirements("single statement about purchase orders") == [
        "single statement about purchase orders"
    ]
    assert split_plain_requirements("- a b c\n  continued\n- d e f") == ["a b c continued", "d e f"]
    assert split_plain_requirements("1. first item here\n2) second item here") == ["first item here", "second item here"]
    assert split_plain_requirements("   \n") == []


def test_determinism_of_rejection():
    a = _run("The quick brown fox jumps over the lazy dog")
    b = _run("The quick brown fox jumps over the lazy dog")
    assert a.model_dump(exclude={"metrics"}) == b.model_dump(exclude={"metrics"})


# ---------------------------------------------------------------------------------------- properties
PROSE_WORDS = ["river", "mountain", "happy", "blue", "walk", "dinner", "music", "garden", "friend", "window",
               "yesterday", "quickly", "coffee", "morning", "holiday", "picture", "summer", "story", "green"]


@settings(max_examples=60, deadline=3000, suppress_health_check=[HealthCheck.too_slow])
@given(st.lists(st.sampled_from(PROSE_WORDS), min_size=3, max_size=25))
def test_property_generic_prose_never_gets_a_verdict(words):
    resp = _run(" ".join(words))
    assert resp.status == AnalysisStatus.FAILED
    assert _codes(resp) == ["GAP_RADAR_INVALID_INPUT"]


@settings(max_examples=40, deadline=3000, suppress_health_check=[HealthCheck.too_slow])
@given(st.sampled_from(SAP_REQUIREMENTS), st.lists(st.sampled_from(PROSE_WORDS), max_size=8))
def test_property_sap_statement_with_noise_is_accepted(statement, noise):
    resp = _run(statement + " " + " ".join(noise))
    assert resp.status == AnalysisStatus.COMPLETED
    assert all(f.rule_id != "GAP_RADAR_INVALID_INPUT" for f in resp.findings)


@settings(max_examples=60, deadline=3000, suppress_health_check=[HealthCheck.too_slow])
@given(st.text(max_size=300))
def test_property_arbitrary_text_is_total(text):
    # Never raises; FAILED responses carry only UNKNOWN input findings.
    assert sap_requirement_problem(text) is None or isinstance(sap_requirement_problem(text), str)
    resp = _run(text)
    if resp.status == AnalysisStatus.FAILED:
        assert all(f.confidence == ConfidenceClass.UNKNOWN for f in resp.findings)
        assert all(not f.rule_id.startswith("GAP_RADAR_SUPPORTED") for f in resp.findings)


def test_engine_metadata_documents_the_contract():
    contract = GapRadarEngine.input_contract.describe()
    assert any("SAP business or technical requirement" in r for r in contract["required"])
