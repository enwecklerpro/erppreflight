"""Clean Core Object Guard — token-based ABAP analysis (spec 07 §7.5) golden fixtures and tricky cases."""

from __future__ import annotations

import base64
import io
import json
import zipfile
from pathlib import Path

import pytest

import src.engines  # noqa: F401
from src.core.runner import EngineRunner
from src.engines.clean_core import load_release_knowledge
from src.models.enums import AnalysisStatus, ConfidenceClass, EngineType, Severity
from src.models.request import AnalysisRequest, ArtifactReference
from src.parsers.abap_tokenizer import LITERAL, TEMPLATE, TEXT_LITERAL, WORD, parse_statements, tokenize
from src.platform.evidence import EvidenceEngine

FIX = Path(__file__).resolve().parent.parent / "fixtures" / "domain2"


async def run(raw: str | None = None, **kw):
    req = AnalysisRequest(job_id="cc", tenant_id="t", project_id="p",
                          engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD, raw_content=raw, **kw)
    return await EngineRunner.execute(req)


def codes_at(resp):
    return [(f.rule_id, f.evidence[0].line_number, f.evidence[0].column_number, f.confidence) for f in resp.findings]


# ---------------------------------------------------------------- tokenizer

def test_tokenizer_strips_literals_comments_and_templates():
    lex = tokenize("* SELECT * FROM mara.\nWRITE 'SELECT FROM MARA'. \" UPDATE bseg\nx = |a { b } c| && `d`.")
    kinds = [(t.kind, t.value) for t in lex.tokens]
    assert (WORD, "SELECT") not in kinds and (WORD, "UPDATE") not in kinds
    assert (LITERAL, "'SELECT FROM MARA'") in kinds
    assert (TEMPLATE, "|a { b } c|") in kinds
    assert (TEXT_LITERAL, "`d`") in kinds


def test_tokenizer_positions_are_exact():
    lex = tokenize("REPORT z.\n  SELECT * FROM mara.")
    mara = next(t for t in lex.tokens if t.value == "mara")
    assert (mara.line, mara.col) == (2, 17)


def test_escaped_quotes_and_periods_inside_literals():
    stmts, _ = parse_statements("WRITE 'it''s. done'. WRITE `a``b.c`.")
    assert [s.keyword for s in stmts] == ["WRITE", "WRITE"]


def test_chained_statements_are_expanded():
    stmts, _ = parse_statements("DATA: a TYPE i, b TYPE string, c TYPE REF TO zcl_x.")
    assert [s.text() for s in stmts] == ["DATA a TYPE i", "DATA b TYPE string", "DATA c TYPE REF TO zcl_x"]
    assert all(s.chained for s in stmts)


def test_commas_inside_parentheses_do_not_split_chains():
    stmts, _ = parse_statements("CALL METHOD: lo->m( a = 1 ), lo->n( ).")
    assert len(stmts) == 2


def test_exec_sql_block_is_opaque():
    stmts, _ = parse_statements("EXEC SQL.\n  DELETE FROM bseg;\nENDEXEC.\nWRITE 'x'.")
    assert stmts[0].keyword == "EXEC" and stmts[1].keyword == "ENDEXEC" and stmts[2].keyword == "WRITE"


def test_unterminated_literal_is_reported_not_crashing():
    lex = tokenize("WRITE 'abc\nWRITE 'ok'.")
    assert lex.errors and lex.errors[0][0] == 1


# ---------------------------------------------------------------- required tricky cases

@pytest.mark.asyncio
async def test_write_literal_select_is_not_flagged():
    resp = await run("REPORT z.\nWRITE 'SELECT FROM MARA'.\n")
    assert resp.status == AnalysisStatus.COMPLETED
    assert resp.findings == []
    assert resp.metrics.additional_metrics["compliance_percentage"] == 100.0


@pytest.mark.asyncio
async def test_insert_into_t001_is_flagged():
    resp = await run("REPORT z.\nINSERT INTO t001 VALUES ls_t001.\n")
    assert codes_at(resp) == [("CLEAN_CORE_DIRECT_DB_MUTATION", 2, 13, ConfidenceClass.VERIFIED)]
    assert resp.findings[0].severity == Severity.BLOCKER
    assert "I_CompanyCode" in resp.findings[0].remediation


@pytest.mark.asyncio
async def test_dynamic_select_is_unknown():
    resp = await run("REPORT z.\nSELECT * FROM (lv_tab) INTO TABLE @DATA(lt).\n")
    assert codes_at(resp) == [("CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE", 2, 16, ConfidenceClass.UNKNOWN)]
    assert resp.findings[0].confidence_score == 0.30
    assert resp.metrics.additional_metrics["compliance_verifiable"] is False


@pytest.mark.asyncio
async def test_so_new_document_is_flagged_unless_released():
    resp = await run("REPORT z.\nCALL FUNCTION 'SO_NEW_DOCUMENT_ATT_SEND_API1' EXPORTING a = b.\n")
    assert codes_at(resp) == [("CLEAN_CORE_UNRELEASED_API", 2, 15, ConfidenceClass.VERIFIED)]
    assert "CL_BCS_MAIL_MESSAGE" in resp.findings[0].remediation
    k = load_release_knowledge()
    assert "SO_NEW_DOCUMENT_ATT_SEND_API1" not in k.released_fms


@pytest.mark.asyncio
async def test_fm_absent_from_released_list_is_rule_derived_and_released_fm_is_clean():
    resp = await run("REPORT z.\nCALL FUNCTION 'SOME_STANDARD_FM'.\nCALL FUNCTION 'BAPI_TRANSACTION_COMMIT'.\n")
    assert codes_at(resp) == [("CLEAN_CORE_UNRELEASED_API", 2, 15, ConfidenceClass.RULE_DERIVED)]
    assert resp.findings[0].technical_details["releaseStatus"] == "NOT_IN_RELEASED_LIST"


# ---------------------------------------------------------------- golden fixtures

@pytest.mark.asyncio
async def test_golden_positive_fixture():
    src = (FIX / "clean_core_tricky_positive.abap").read_text()
    resp = await run(src, artifact_s3_key="tenants/x/projects/y/zr_clean_core_tricky.abap")
    assert resp.status == AnalysisStatus.COMPLETED
    got = [(c, ln, col) for c, ln, col, _ in codes_at(resp)]
    assert got == [
        ("CLEAN_CORE_DIRECT_DB_MUTATION", 5, 13),        # INSERT INTO t001
        ("CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE", 6, 16), # FROM (lv_tab)
        ("CLEAN_CORE_UNRELEASED_API", 7, 15),            # SO_NEW_DOCUMENT_ATT_SEND_API1 (not released)
        ("CLEAN_CORE_UNRELEASED_API", 8, 15),            # not on released list
        ("CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE", 9, 15), # CALL FUNCTION lv_fm_name
        ("CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE", 10, 13),# CALL METHOD (…)=>(…)
        ("CLEAN_CORE_DIRECT_DB_MUTATION", 11, 8),        # UPDATE bseg
        ("CLEAN_CORE_DIRECT_DB_MUTATION", 12, 8),        # MODIFY vbak
        ("CLEAN_CORE_DIRECT_DB_MUTATION", 13, 13),       # DELETE FROM mara
        ("CLEAN_CORE_DIRECT_DB_ACCESS", 15, 8),          # multi-line SELECT … FROM mara
        ("CLEAN_CORE_OBSOLETE_SYNTAX", 17, 1),           # TABLES: kna1, lfa1 (reported once)
        ("CLEAN_CORE_OBSOLETE_SYNTAX", 18, 1),           # CALL 'SYSTEM'
        ("CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE", 19, 27),# CREATE OBJECT … TYPE (lv_type)
        ("CLEAN_CORE_UNRELEASED_CLASS", 20, 25),         # NEW cl_gui_frontend_services
    ]
    by_line = {f.evidence[0].line_number: f for f in resp.findings}
    assert by_line[18].severity == Severity.BLOCKER
    lines = src.splitlines()
    for f in resp.findings:
        ev = f.evidence[0]
        assert ev.artifact_path.endswith("zr_clean_core_tricky.abap")
        assert ev.sha256 == EvidenceEngine.compute_sha256(src)          # artifact-level SHA-256
        assert ev.snippet == lines[ev.line_number - 1].strip()
        assert f.technical_details["knowledgeSnapshot"] == "clean-core-released-objects/2408.1"
    assert resp.metrics.additional_metrics["analysisMethod"] == "abap-token-stream"
    inv = resp.metrics.additional_metrics["inventory"]
    assert "MARA" in inv["tables"] and "SO_NEW_DOCUMENT_ATT_SEND_API1" in inv["function_modules"]


@pytest.mark.asyncio
async def test_golden_negative_fixture_has_no_findings():
    resp = await run((FIX / "clean_core_tricky_negative.abap").read_text())
    assert resp.status == AnalysisStatus.COMPLETED
    assert resp.findings == [], [(f.rule_id, f.evidence[0].line_number) for f in resp.findings]
    m = resp.metrics.additional_metrics
    assert m["compliance_percentage"] == 100.0 and m["compliance_verifiable"] is True
    assert "I_PRODUCT" in m["inventory"]["cds_views"]


# ---------------------------------------------------------------- other inputs

@pytest.mark.asyncio
async def test_non_abap_text_is_invalid_input():
    resp = await run("hello world, this is a meeting note and not ABAP code at all")
    assert resp.status == AnalysisStatus.FAILED
    assert [f.rule_id for f in resp.findings] == ["CLEAN_CORE_INVALID_INPUT"]


@pytest.mark.asyncio
async def test_comments_only_source_is_insufficient():
    resp = await run("* only a comment\n\" another comment\n")
    assert resp.status == AnalysisStatus.FAILED
    assert resp.findings[0].rule_id in ("CLEAN_CORE_INVALID_INPUT", "CLEAN_CORE_INSUFFICIENT_INPUT")


@pytest.mark.asyncio
async def test_abapgit_zip_is_analysed_per_file():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("src/zcl_a.clas.abap", "CLASS zcl_a IMPLEMENTATION.\n  METHOD m.\n    SELECT * FROM bkpf INTO TABLE @DATA(x).\n  ENDMETHOD.\nENDCLASS.\n")
        zf.writestr("src/zcl_a.clas.xml", "<abapGit/>")
        zf.writestr("src/zr_b.prog.abap", "REPORT zr_b.\nWRITE 'ok'.\n")
    resp = await run(base64.b64encode(buf.getvalue()).decode(), raw_content_encoding="base64")
    assert resp.status == AnalysisStatus.COMPLETED
    assert [(f.rule_id, f.evidence[0].artifact_path, f.evidence[0].line_number) for f in resp.findings] == [
        ("CLEAN_CORE_DIRECT_DB_ACCESS", "abap/custom_source.abap!/src/zcl_a.clas.abap", 3)
    ]
    assert resp.metrics.artifacts_scanned == 2


@pytest.mark.asyncio
async def test_object_list_release_lookup():
    payload = json.dumps({"objects": [
        {"name": "I_PRODUCT", "type": "DDLS"},
        {"name": "RFC_READ_TABLE", "type": "FUNC"},
        {"name": "MARA", "type": "TABL"},
        {"name": "ZMY_TABLE", "type": "TABL"},
        {"name": "UNKNOWN_STD_FM", "type": "FUNC"},
    ]}, indent=1)
    resp = await run(payload)
    got = {f.affected_objects[0]: (f.rule_id, f.confidence) for f in resp.findings}
    assert got == {
        "I_PRODUCT": ("CLEAN_CORE_OBJECT_RELEASED", ConfidenceClass.VERIFIED),
        "RFC_READ_TABLE": ("CLEAN_CORE_UNRELEASED_API", ConfidenceClass.VERIFIED),
        "MARA": ("CLEAN_CORE_UNRELEASED_OBJECT", ConfidenceClass.VERIFIED),
        "UNKNOWN_STD_FM": ("CLEAN_CORE_UNRELEASED_OBJECT", ConfidenceClass.RULE_DERIVED),
    }


@pytest.mark.asyncio
async def test_external_ast_references_are_classified_and_capped():
    source = "REPORT z.\nSELECT * FROM mara INTO TABLE @DATA(x).\n"
    refs = [
        {"kind": "TABLE", "name": "MARA", "operation": "READ", "artifact": "z.prog.abap", "line": 2, "column": 15,
         "source": "abaplint"},
        {"kind": "FUNCTION_MODULE", "name": "RFC_READ_TABLE", "operation": "CALL", "artifact": "missing.abap",
         "line": 9, "column": 3, "source": "abaplint"},
    ]
    req = AnalysisRequest(
        job_id="ext", tenant_id="t", project_id="p", engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
        artifacts=[ArtifactReference(file_name="z.prog.abap", artifact_type="ABAP", raw_content=source)],
        configuration={"abap_references": refs},
    )
    resp = await EngineRunner.execute(req)
    ext = [f for f in resp.findings if f.technical_details.get("referenceSource") == "abaplint"]
    assert [(f.rule_id, f.confidence) for f in ext] == [
        ("CLEAN_CORE_UNRELEASED_API", ConfidenceClass.UNKNOWN),        # no source for missing.abap -> unverifiable
        ("CLEAN_CORE_DIRECT_DB_ACCESS", ConfidenceClass.RULE_DERIVED),  # capped below VERIFIED
    ]


@pytest.mark.asyncio
async def test_invalid_external_references_rejected():
    req = AnalysisRequest(job_id="ext2", tenant_id="t", project_id="p",
                          engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
                          configuration={"abap_references": [{"kind": "TABLE", "name": "MARA", "line": 0}]})
    resp = await EngineRunner.execute(req)
    assert resp.status == AnalysisStatus.FAILED
    assert resp.findings[0].rule_id == "CLEAN_CORE_INVALID_INPUT"
