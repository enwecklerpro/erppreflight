"""
Empirical Stress Test Harness for Domain 2 Engines (ecc2cloud and spro2cloud).
Executed by m3_d2_it3_challenger_1.
"""

import asyncio
import io
import sys
from pathlib import Path

# Add services/analysis-python to path
sys.path.insert(0, str(Path("H:/erppreflight/services/analysis-python")))
import src.engines
from src.core.runner import EngineRunner
from src.engines.ecc2cloud import ECC2CloudEngine, EccArtifactParser
from src.engines.spro2cloud import SPRO2CloudEngine, SproArtifactParser
from src.models.enums import EngineType, ArtifactType, Severity, ConfidenceClass
from src.models.request import AnalysisRequest


def test_ecc_middle_comment():
    """Verify ecc2cloud skips comments placed in the middle of CSV data."""
    csv_data = (
        "TCode,Executions,AvgResponseTimeMs,Users,Module\n"
        "VA01,50000,300,20,SD\n"
        "# Middle comment explaining next batch\n"
        "VL01N,20000,200,10,SD\n"
    )
    items = EccArtifactParser.parse(csv_data, "test.csv")
    names = [i.object_name for i in items]
    assert "VA01" in names, "VA01 missing"
    assert "VL01N" in names, "VL01N missing"
    assert len(items) == 2, f"Expected 2 items, got {len(items)}"
    print("PASS: test_ecc_middle_comment")


def test_ecc_zero_and_negative_executions():
    """Verify ecc2cloud handles zero and negative executions."""
    csv_data = (
        "TCode,Executions,AvgResponseTimeMs,Users,Module\n"
        "VA01,0,300,20,SD\n"
        "VL01N,-100,200,10,SD\n"
    )
    items = EccArtifactParser.parse(csv_data, "test.csv")
    assert items[0].executions == 0, f"Expected 0, got {items[0].executions}"
    # Note: EccArtifactParser cleans non-digits, so -100 becomes 100
    assert items[1].executions == 100, f"Expected 100, got {items[1].executions}"
    print("PASS: test_ecc_zero_and_negative_executions")


def test_ecc_only_comments_and_empty():
    """Verify ecc2cloud on empty file or only comments returns empty list."""
    items1 = EccArtifactParser.parse("", "empty.csv")
    assert len(items1) == 0, f"Expected 0 items, got {len(items1)}"
    items2 = EccArtifactParser.parse("# Only comment\n# Another comment\n\n", "comments.csv")
    assert len(items2) == 0, f"Expected 0 items, got {len(items2)}"
    print("PASS: test_ecc_only_comments_and_empty")


def test_ecc_custom_prefixes_batch():
    """Verify various custom Z_ and Y_ transaction names are not dropped."""
    test_cases = [
        "Z_OBJECT_REPORT,25000,200,10",
        "Z_EXEC_BATCH,15000,120,4",
        "Z_INTERFACE_DISPATCH,18000,100,2",
        "Z_STEPS_CALC,12000,90,1",
        "Y_OBJECT_SYNC,30000,150,5",
        "Y_EXEC_JOB,40000,250,8",
    ]
    csv_content = "\n".join(test_cases) + "\n"
    items = EccArtifactParser.parse(csv_content, "custom_tcodes.csv")
    assert len(items) == len(test_cases), f"Expected {len(test_cases)}, got {len(items)}"
    parsed_names = [i.object_name for i in items]
    for case in test_cases:
        expected_name = case.split(",")[0]
        assert expected_name in parsed_names, f"Expected {expected_name} in parsed items"
    print("PASS: test_ecc_custom_prefixes_batch")


def test_spro_middle_comment():
    """Verify spro2cloud skips comments placed in the middle of CSV data."""
    csv_data = (
        "ActivityID,ActivityName,Module,TargetTable,CountryCode\n"
        "SIMG_CFMENUOLSDVOFA,Define Billing Types,SD,TVFK,DE\n"
        "# Comment between data lines\n"
        "SIMG_CFMENUOLSDVOV8,Define Sales Order Types,SD,TVAK,DE\n"
    )
    items = SproArtifactParser.parse(csv_data, "test.csv")
    names = [i.activity_id for i in items]
    print("SPRO middle comment items:", [(i.activity_id, i.table_name) for i in items])
    if "# Comment between data lines" in names or len(items) != 2:
        print("FAIL: test_spro_middle_comment - SproArtifactParser failed to skip comment row!")
        return False
    print("PASS: test_spro_middle_comment")
    return True


def test_spro_initial_comment():
    """Verify spro2cloud skips initial comments in CSV data."""
    csv_data = (
        "# Initial export comment\n"
        "ActivityID,ActivityName,Module,TargetTable,CountryCode\n"
        "SIMG_CFMENUOLSDVOFA,Define Billing Types,SD,TVFK,DE\n"
    )
    items = SproArtifactParser.parse(csv_data, "test.csv")
    names = [i.activity_id for i in items]
    print("SPRO initial comment items:", [(i.activity_id, i.table_name) for i in items])
    if "# Initial export comment" in names or len(items) != 1:
        print("FAIL: test_spro_initial_comment - SproArtifactParser failed to skip initial comment!")
        return False
    print("PASS: test_spro_initial_comment")
    return True


async def test_spro_findings_on_comments():
    """Verify spro2cloud analysis does not produce findings for comment lines."""
    csv_data = (
        "# SPRO System Export Header\n"
        "ActivityID,ActivityName,Module,TargetTable,CountryCode\n"
        "SIMG_CFMENUOLSDVOFA,Define Billing Types,SD,TVFK,DE\n"
    )
    req = AnalysisRequest(
        job_id="99999999-0000-0000-0000-000000000001",
        tenant_id="22222222-2222-2222-2222-222222222222",
        project_id="33333333-3333-3333-3333-333333333333",
        engine_type=EngineType.SPRO2CLOUD,
        raw_content=csv_data,
        artifact_type=ArtifactType.CSV,
    )
    res = await EngineRunner.execute(req)
    affected = [f.affected_objects for f in res.findings]
    print("SPRO findings affected objects:", affected)
    for obj_list in affected:
        if any("#" in obj for obj in obj_list):
            print(f"FAIL: test_spro_findings_on_comments - Finding produced for comment line: {obj_list}")
            return False
    print("PASS: test_spro_findings_on_comments")
    return True


async def main():
    print("=== RUNNING EMPIRICAL STRESS HARNESS ===")
    test_ecc_middle_comment()
    test_ecc_zero_and_negative_executions()
    test_ecc_only_comments_and_empty()
    test_ecc_custom_prefixes_batch()

    spro_mid = test_spro_middle_comment()
    spro_init = test_spro_initial_comment()
    spro_findings = await test_spro_findings_on_comments()

    print("\n=== SUMMARY ===")
    print("ECC2Cloud Tests: ALL PASSED")
    print(f"SPRO2Cloud Middle Comment: {'PASSED' if spro_mid else 'FAILED'}")
    print(f"SPRO2Cloud Initial Comment: {'PASSED' if spro_init else 'FAILED'}")
    print(f"SPRO2Cloud Clean Findings on Comments: {'PASSED' if spro_findings else 'FAILED'}")


if __name__ == "__main__":
    asyncio.run(main())
