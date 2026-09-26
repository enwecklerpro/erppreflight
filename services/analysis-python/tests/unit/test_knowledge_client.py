"""Knowledge-graph snapshot integration for Clean Core Object Guard (configuration.released_objects)."""

from __future__ import annotations

import pytest

import src.engines  # noqa: F401
from src.core.runner import EngineRunner
from src.engines.clean_core import load_release_knowledge, overlay_snapshot
from src.models.enums import AnalysisStatus, ConfidenceClass, EngineType
from src.models.request import AnalysisRequest
from src.platform.knowledge_client import build_snapshot_index, parse_released_objects

SNAPSHOT_ID = "0b9c7c1e-8d0a-4c7e-9a41-4f0f7f0d2a11"


def snapshot(objects):
    return {
        "schemaVersion": 1,
        "snapshotId": SNAPSHOT_ID,
        "snapshotSeq": 7,
        "contentSha256": "a" * 64,
        "source": "SAP_CLOUDIFICATION_REPOSITORY",
        "release": {"productCode": "SAP_S4HANA", "editionCode": "CLOUD_PRIVATE", "releaseCode": "2023 FPS03",
                    "label": "SAP S/4HANA 2023 FPS03", "exactMatch": True},
        "objects": objects,
    }


# Real facts from the Cloudification Repository (objectReleaseInfo_PCE2023_3.json / Latest, 2026-09).
MARA = {"objectType": "TABL", "objectName": "MARA", "state": "notToBeReleased",
        "successors": [{"objectType": "CDS_STOB", "objectName": "I_PRODUCT"},
                       {"objectType": "CDS_STOB", "objectName": "I_PRODUCTSALES"}]}
I_PRODUCT = {"objectType": "CDS_STOB", "objectName": "I_PRODUCT", "state": "released", "successors": []}
BAPI = {"objectType": "FUNC", "objectName": "BAPI_MATERIAL_SAVEDATA", "state": "notToBeReleased",
        "classicApiState": "classicAPI",
        "successors": [{"objectType": "BDEF", "objectName": "I_PRODUCTTP_2"}]}
TYPEDESCR = {"objectType": "CLAS", "objectName": "CL_ABAP_TYPEDESCR", "state": "released"}


async def run(raw, configuration=None):
    req = AnalysisRequest(job_id="kg", tenant_id="t", project_id="p",
                          engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD, raw_content=raw,
                          configuration=configuration or {})
    return await EngineRunner.execute(req)


def test_parse_accepts_both_keys_and_rejects_invalid_payload():
    assert parse_released_objects({"released_objects": snapshot([MARA])}).snapshotId == SNAPSHOT_ID
    assert parse_released_objects({"releasedObjects": snapshot([MARA])}).objects[0].objectName == "MARA"
    assert parse_released_objects({"released_objects": {"objects": "nope"}}) is None
    assert parse_released_objects({}) is None
    assert parse_released_objects(None) is None


def test_index_classifies_families_and_successors():
    idx = build_snapshot_index(parse_released_objects({"released_objects": snapshot([MARA, I_PRODUCT, BAPI, TYPEDESCR])}))
    assert idx.not_released_tables == {"MARA": "I_PRODUCT, I_PRODUCTSALES"}
    assert "I_PRODUCT" in idx.released_cds
    assert idx.not_released_fms == {"BAPI_MATERIAL_SAVEDATA": "I_PRODUCTTP_2"}
    assert "CL_ABAP_TYPEDESCR" in idx.released_classes
    assert idx.names == {"MARA", "I_PRODUCT", "BAPI_MATERIAL_SAVEDATA", "CL_ABAP_TYPEDESCR"}


def test_snapshot_takes_precedence_and_static_list_is_fallback():
    base = load_release_knowledge()
    fm = "ZZ_NOT_A_REAL_FM"
    snap = snapshot([{"objectType": "FUNC", "objectName": "RFC_READ_TABLE", "state": "released"}])
    k = overlay_snapshot(base, build_snapshot_index(parse_released_objects({"released_objects": snap})))
    assert "RFC_READ_TABLE" in k.released_fms and "RFC_READ_TABLE" not in k.not_released_fms
    # Objects the snapshot does not cover keep their static classification.
    assert k.not_released_tables == base.not_released_tables
    assert fm not in k.released_fms
    assert k.external_snapshot_id == SNAPSHOT_ID and k.static_snapshot_id == base.snapshot_id


@pytest.mark.asyncio
async def test_findings_record_snapshot_and_use_official_successors():
    source = (
        "REPORT zkg.\n"
        "SELECT * FROM mara INTO TABLE @DATA(lt).\n"
        "CALL FUNCTION 'BAPI_MATERIAL_SAVEDATA'.\n"
        "DATA(lo) = cl_abap_typedescr=>describe_by_name( 'X' ).\n"
    )
    resp = await run(source, {"released_objects": snapshot([MARA, BAPI, TYPEDESCR])})
    assert resp.status == AnalysisStatus.COMPLETED
    by_rule = {f.rule_id: f for f in resp.findings}
    mara = by_rule["CLEAN_CORE_DIRECT_DB_ACCESS"]
    assert mara.confidence == ConfidenceClass.VERIFIED
    assert "I_PRODUCT" in mara.remediation
    assert mara.technical_details["knowledgeGraphSnapshotId"] == SNAPSHOT_ID
    assert mara.technical_details["verdictSource"] == "KNOWLEDGE_GRAPH_SNAPSHOT"
    assert mara.technical_details["knowledgeSource"] == "SAP_CLOUDIFICATION_REPOSITORY"
    bapi = by_rule["CLEAN_CORE_UNRELEASED_API"]
    assert bapi.confidence == ConfidenceClass.VERIFIED and "I_PRODUCTTP_2" in bapi.remediation
    # Released class from the snapshot: no finding.
    assert not any("CL_ABAP_TYPEDESCR" in f.affected_objects for f in resp.findings)
    assert resp.metrics.additional_metrics["knowledgeGraphSnapshotId"] == SNAPSHOT_ID


@pytest.mark.asyncio
async def test_snapshot_released_fm_suppresses_noisy_rule_derived_finding():
    source = "REPORT zkg2.\nCALL FUNCTION 'BAPI_USER_GET_DETAIL'.\n"
    without = await run(source)
    assert any(f.rule_id == "CLEAN_CORE_UNRELEASED_API" and f.confidence == ConfidenceClass.RULE_DERIVED
               for f in without.findings)
    released = snapshot([{"objectType": "FUNC", "objectName": "BAPI_USER_GET_DETAIL", "state": "released"}])
    with_snapshot = await run(source, {"released_objects": released})
    assert not any(f.rule_id == "CLEAN_CORE_UNRELEASED_API" for f in with_snapshot.findings)


@pytest.mark.asyncio
async def test_invalid_snapshot_falls_back_to_static_knowledge_deterministically():
    source = "REPORT zkg3.\nSELECT * FROM mara INTO TABLE @DATA(lt).\n"
    a = await run(source, {"released_objects": {"snapshotId": "", "objects": []}})
    b = await run(source)
    assert [f.model_dump(mode="json") for f in a.findings] == [f.model_dump(mode="json") for f in b.findings]
    assert "knowledgeGraphSnapshotId" not in a.findings[0].technical_details


@pytest.mark.asyncio
async def test_object_list_with_snapshot_is_verified():
    resp = await run('{"objects": [{"name": "I_PRODUCT", "type": "DDLS"}, {"name": "MARA", "type": "TABL"}]}',
                     {"released_objects": snapshot([MARA, I_PRODUCT])})
    by_obj = {f.affected_objects[0]: f for f in resp.findings}
    assert by_obj["I_PRODUCT"].rule_id == "CLEAN_CORE_OBJECT_RELEASED"
    assert by_obj["MARA"].confidence == ConfidenceClass.VERIFIED
    assert by_obj["MARA"].technical_details["knowledgeGraphSnapshotId"] == SNAPSHOT_ID
