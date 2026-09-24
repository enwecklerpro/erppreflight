import asyncio
from src.engines.transport_dependency import TransportDependencyEngine
from src.models.request import AnalysisRequest
from src.models.enums import EngineType, ArtifactType

def test_cts_parsing():
    eng = TransportDependencyEngine()

    # 1. Custom CSV with semicolon delimiter, mixed E070, E071, E071K
    csv_content = """TRKORR;RECORD_TYPE;TRFUNCTION;TRSTATUS;AS4USER;AS4DATE;AS4TIME;OBJECT;OBJ_NAME;TABLENAME;TABKEY
TR_WB_01;E070;K;R;DEV_ALICE;20260901;120000;;;;
TR_WB_01;E071;;;;;;TABL;ZMY_CUSTOM_TABLE;;
TR_CUST_02;E070;W;R;CONS_BOB;20260902;150000;;;;
TR_CUST_02;E071K;;;;;;TABU;;ZMY_CUSTOM_TABLE;1000*
"""
    req_csv = AnalysisRequest(
        job_id="job-cts-csv",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
        raw_content=csv_content,
        artifact_type=ArtifactType.CSV,
    )
    res_csv = asyncio.run(eng.analyze(req_csv))
    print("CSV Metrics:", res_csv.metrics.additional_metrics)
    assert res_csv.metrics.additional_metrics["total_transports"] == 2
    assert res_csv.metrics.additional_metrics["customizing_ahead_count"] == 1
    customizing_findings = [f for f in res_csv.findings if f.rule_id == "TR_CUSTOMIZING_AHEAD_OF_STRUCTURE"]
    assert len(customizing_findings) == 1
    assert "ZMY_CUSTOM_TABLE" in customizing_findings[0].description
    print("CSV Parsing passed!")

    # 2. Custom XML with E070, E071, E071K
    xml_content = """<?xml version="1.0" encoding="utf-8"?>
    <CTS_EXPORT>
      <E070>
        <RECORD TRKORR="TR_XML_01" TRFUNCTION="K" TRSTATUS="R" AS4DATE="20260901" AS4TIME="100000"/>
        <RECORD TRKORR="TR_XML_02" TRFUNCTION="K" TRSTATUS="R" AS4DATE="20260905" AS4TIME="140000"/>
      </E070>
      <E071>
        <RECORD TRKORR="TR_XML_01" OBJECT="CLAS" OBJ_NAME="ZCL_COLLISION"/>
        <RECORD TRKORR="TR_XML_02" OBJECT="CLAS" OBJ_NAME="ZCL_COLLISION"/>
      </E071>
    </CTS_EXPORT>
    """
    req_xml = AnalysisRequest(
        job_id="job-cts-xml",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
        raw_content=xml_content,
        artifact_type=ArtifactType.XML,
    )
    res_xml = asyncio.run(eng.analyze(req_xml))
    print("XML Metrics:", res_xml.metrics.additional_metrics)
    assert res_xml.metrics.additional_metrics["collisions_count"] == 1
    collision_findings = [f for f in res_xml.findings if f.rule_id == "TR_OBJECT_COLLISION"]
    assert len(collision_findings) == 1
    assert "ZCL_COLLISION" in collision_findings[0].description
    print("XML Parsing passed!")

if __name__ == "__main__":
    test_cts_parsing()
