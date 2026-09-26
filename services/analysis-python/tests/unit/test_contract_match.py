"""POST /api/v1/contracts/match — engine input-contract matching (routing aid, no findings)."""
import base64
import json
from pathlib import Path

from hypothesis import given, settings, strategies as st

from src.api.contracts import ContractMatchRequest, match_contracts

FIXTURES = Path(__file__).resolve().parents[4] / "tests" / "e2e" / "fixtures"


def _accepted(content: str, **kw) -> set:
    res = match_contracts(ContractMatchRequest(raw_content=content, **kw))
    return {m.engine_type for m in res.matches if m.accepted}


def test_opd_decision_tables_accepted_only_by_opd():
    text = (FIXTURES / "opd" / "opd_po_missing_recipient.json").read_text()
    assert _accepted(text) == {"OPD_GUARD"}


def test_transport_export_accepted_by_transport_analyzer():
    text = (FIXTURES / "transport" / "tr_collision.json").read_text()
    assert "TRANSPORT_DEPENDENCY_ANALYZER" in _accepted(text)
    assert "OPD_GUARD" not in _accepted(text)


def test_abap_source_accepted_by_clean_core():
    text = (FIXTURES / "clean_core" / "clean_core_legacy.abap").read_text()
    assert "CLEAN_CORE_OBJECT_GUARD" in _accepted(text)


def test_unrelated_json_is_rejected_everywhere():
    assert _accepted(json.dumps({"hello": "world"})) == set()


def test_response_shape_and_rejection_codes(client):
    res = client.post("/api/v1/contracts/match", json={"raw_content": '{"hello": 1}', "file_name": "x.json"})
    assert res.status_code == 200
    body = res.json()
    assert body["sniffed_format"] == "JSON"
    opd = next(m for m in body["matches"] if m["engine_type"] == "OPD_GUARD")
    assert opd["accepted"] is False
    assert opd["code"].startswith("OPD_")


def test_engine_filter_restricts_result():
    res = match_contracts(ContractMatchRequest(raw_content="{}", engine_types=["OPD_GUARD", "MFS_BLACKBOX"]))
    assert [m.engine_type for m in res.matches] == ["OPD_GUARD", "MFS_BLACKBOX"]


def test_binary_base64_payload_does_not_crash():
    payload = base64.b64encode(b"PK\x03\x04garbage").decode()
    res = match_contracts(ContractMatchRequest(raw_content=payload, raw_content_encoding="base64"))
    assert len(res.matches) >= 19


def test_extra_fields_rejected(client):
    res = client.post("/api/v1/contracts/match", json={"raw_content": "{}", "evil": True})
    assert res.status_code == 422


def test_matching_is_deterministic():
    text = (FIXTURES / "opd" / "opd_shadowed_rule.json").read_text()
    a = match_contracts(ContractMatchRequest(raw_content=text)).model_dump()
    b = match_contracts(ContractMatchRequest(raw_content=text)).model_dump()
    assert a == b


@settings(max_examples=60, deadline=None)
@given(st.text(max_size=400))
def test_hostile_text_never_raises(text):
    res = match_contracts(ContractMatchRequest(raw_content=text))
    assert all(isinstance(m.accepted, bool) for m in res.matches)
