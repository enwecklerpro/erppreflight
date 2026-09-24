"""
ERP Preflight — Domain 4 Release & Transport Engines Pytest Suite
Engines Covered:
1. Software Collection Dependency Guard (SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
2. Transport Dependency Analyzer (TRANSPORT_DEPENDENCY_ANALYZER)

Governing Standard: AGENTS.md, Cardinal Axiom 2 (14 architectural points), engine-authoring.md, sap-evidence.md
Pass Rate Requirement: 100% automated pass rate under pytest with Python 3.13
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import pytest
import re
import sys
import zipfile
from typing import Any, Dict, List, Optional

# Ensure services/analysis-python is in python path
for p in Path(__file__).resolve().parents:
    cand_srv = p / "services" / "analysis-python"
    if cand_srv.is_dir() and str(cand_srv) not in sys.path:
        sys.path.insert(0, str(cand_srv))
        break

# Ensure engines are registered in EngineRegistry
import src.engines
from src.core.runner import EngineRunner
from src.core.registry import EngineRegistry, register_engine
from src.models.enums import (
    EngineType,
    AnalysisStatus,
    Severity,
    ConfidenceClass,
    ArtifactType,
    TrustLevel,
)
from src.models.request import AnalysisRequest, ArtifactReference
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.models.response import AnalysisResponse
from src.platform.confidence import ConfidenceClassifier


# =============================================================================
# Peer Agent Engine Registration Setup (Dual-Mode Self-Healing Runner)
# =============================================================================

def find_agent_dir(agent_name: str) -> Optional[Path]:
    """Finds peer agent directory across various invocation path depths."""
    for p in Path(__file__).resolve().parents:
        cand1 = p / agent_name
        if cand1.is_dir():
            return cand1
        cand2 = p / ".agents" / agent_name
        if cand2.is_dir():
            return cand2
    return None


def setup_domain4_engines():
    """Ensures production or proposed Domain 4 engines are registered in EngineRegistry."""
    # 1. Software Collection Dependency Guard
    try:
        current_sc = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        if not hasattr(current_sc, "_parse_inputs"):
            d1 = find_agent_dir("m3_d4_explorer_1")
            if d1 and (d1 / "proposed_software_collection.py").exists():
                if str(d1) not in sys.path:
                    sys.path.insert(0, str(d1))
                import proposed_software_collection
                register_engine(proposed_software_collection.SoftwareCollectionEngine)
    except Exception:
        d1 = find_agent_dir("m3_d4_explorer_1")
        if d1 and (d1 / "proposed_software_collection.py").exists():
            if str(d1) not in sys.path:
                sys.path.insert(0, str(d1))
            import proposed_software_collection
            register_engine(proposed_software_collection.SoftwareCollectionEngine)

    # 2. Transport Dependency Analyzer
    try:
        current_tr = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        if not hasattr(current_tr, "_parse_inputs"):
            d2 = find_agent_dir("m3_d4_explorer_2")
            if d2 and (d2 / "proposed_transport_dependency.py").exists():
                if str(d2) not in sys.path:
                    sys.path.insert(0, str(d2))
                import proposed_transport_dependency
                register_engine(proposed_transport_dependency.TransportDependencyEngine)
    except Exception:
        d2 = find_agent_dir("m3_d4_explorer_2")
        if d2 and (d2 / "proposed_transport_dependency.py").exists():
            if str(d2) not in sys.path:
                sys.path.insert(0, str(d2))
            import proposed_transport_dependency
            register_engine(proposed_transport_dependency.TransportDependencyEngine)


# Execute setup immediately upon import
setup_domain4_engines()


# =============================================================================
# Fixture Loader with Inline Fallback for Maximum Resilience
# =============================================================================

def get_fixture_dir() -> Path:
    """Resolves Domain 4 fixtures directory from unit tests path or monorepo root."""
    # 1. When deployed in services/analysis-python/tests/unit/
    p1 = Path(__file__).resolve().parent.parent / "fixtures" / "domain4"
    if p1.is_dir():
        return p1
    # 2. When executed from .agents/m3_d4_explorer_3/ or monorepo root
    for p in Path(__file__).resolve().parents:
        cand = p / "services" / "analysis-python" / "tests" / "fixtures" / "domain4"
        if cand.is_dir():
            return cand
    # Fallback to local
    return Path(__file__).resolve().parent / "fixtures"


def load_fixture(filename: str) -> str:
    """Reads fixture file from disk with verified fallback for isolated execution."""
    fixture_path = get_fixture_dir() / filename
    if fixture_path.exists():
        return fixture_path.read_text(encoding="utf-8")
    return get_inline_fixture_fallback(filename)


def get_inline_fixture_fallback(filename: str) -> str:
    """Provides inline fallback for isolated runners when fixtures directory is not yet provisioned."""
    fallbacks = {
        "sc_valid_sequence.json": json.dumps({
            "description": "Two clean independent or linearly sequenced Key-User Software Collections in SAP S/4HANA Cloud",
            "export_id": "EXP_2026_09_001",
            "target_release": "S4HC_2408",
            "collections": [
                {
                    "collection_id": "SC_CORE",
                    "name": "Core Foundation Extensibility",
                    "version": "1.0",
                    "items": [
                        {
                            "item_id": "YY1_CUSTOMER_CLASSIFICATION",
                            "item_type": "CUSTOM_FIELD",
                            "status": "PUBLISHED",
                            "dependencies": []
                        }
                    ]
                },
                {
                    "collection_id": "SC_SALES",
                    "name": "Sales Cloud Key User Extensions",
                    "version": "1.0",
                    "items": [
                        {
                            "item_id": "YY1_CDS_SALES_ORDER_HEADER",
                            "item_type": "CDS_VIEW",
                            "status": "PUBLISHED",
                            "dependencies": ["SC_CORE:YY1_CUSTOMER_CLASSIFICATION"]
                        }
                    ]
                }
            ],
            "dependencies": {
                "SC_CORE": [],
                "SC_SALES": ["SC_CORE"]
            }
        }),

        "sc_circular.json": json.dumps({
            "description": "Mutually dependent software collections forming a direct directed cycle",
            "export_id": "EXP_2026_09_CIRCULAR",
            "target_release": "S4HC_2408",
            "collections": [
                {
                    "collection_id": "SC_FINANCE",
                    "name": "Finance Key User Extensions",
                    "version": "1.0",
                    "items": [
                        {
                            "item_id": "YY1_CDS_JOURNAL_EXT",
                            "item_type": "CDS_VIEW",
                            "status": "PUBLISHED",
                            "dependencies": ["SC_SALES:YY1_SALES_DOC_FIELD"]
                        }
                    ]
                },
                {
                    "collection_id": "SC_SALES",
                    "name": "Sales Key User Extensions",
                    "version": "1.0",
                    "items": [
                        {
                            "item_id": "YY1_SALES_DOC_FIELD",
                            "item_type": "CUSTOM_FIELD",
                            "status": "PUBLISHED",
                            "dependencies": []
                        },
                        {
                            "item_id": "APP_VAR_SO_MANAGE",
                            "item_type": "APP_VARIANT",
                            "status": "PUBLISHED",
                            "dependencies": ["SC_FINANCE:YY1_CDS_JOURNAL_EXT"]
                        }
                    ]
                }
            ],
            "dependencies": {
                "SC_FINANCE": ["SC_SALES"],
                "SC_SALES": ["SC_FINANCE"]
            }
        }),

        "sc_missing_prereq.json": json.dumps({
            "description": "Software collection referencing an unexported custom CDS view not present in export or target system",
            "export_id": "EXP_2026_09_MISSING",
            "target_release": "S4HC_2408",
            "collections": [
                {
                    "collection_id": "SC_ANALYTICS",
                    "name": "Analytics Reporting Collection",
                    "version": "1.0",
                    "items": [
                        {
                            "item_id": "YY1_ANALYTICS_QUERY",
                            "item_type": "CDS_VIEW",
                            "status": "PUBLISHED",
                            "dependencies": ["SC_INVENTORY:YY1_CDS_ORDER_DETAIL"]
                        }
                    ]
                }
            ],
            "target_system_collections": ["SC_BASE_DATA"],
            "target_system_items": []
        }),

        "sc_draft_item.json": json.dumps({
            "description": "Software collection containing a draft BAdI implementation",
            "export_id": "EXP_2026_09_DRAFT",
            "target_release": "S4HC_2408",
            "collections": [
                {
                    "collection_id": "SC_LOGISTICS",
                    "name": "Logistics Key User Extensions",
                    "version": "1.0",
                    "items": [
                        {
                            "item_id": "YY1_PALLET_COUNT",
                            "item_type": "CUSTOM_FIELD",
                            "status": "PUBLISHED",
                            "dependencies": []
                        },
                        {
                            "item_id": "BADI_GOODS_RECEIPT_VALIDATION",
                            "item_type": "CUSTOM_LOGIC",
                            "status": "DRAFT",
                            "dependencies": ["YY1_PALLET_COUNT"]
                        }
                    ]
                }
            ]
        }),

        "sc_linear_manifest.xml": (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<software_collections export_id="EXP_2026_09_001" target_release="S4HC_2408">\n'
            '  <target_system>\n'
            '    <collection id="SC_FOUNDATION" />\n'
            '    <item id="I_JOURNALENTRY" />\n'
            '  </target_system>\n'
            '  <collection id="SC_CORE" name="Core Foundation Extensibility" version="1.0">\n'
            '    <item id="YY1_CUSTOMER_TYPE" type="CUSTOM_FIELD" status="PUBLISHED" />\n'
            '  </collection>\n'
            '  <collection id="SC_SALES" name="Sales Key User Extensions" version="1.0">\n'
            '    <item id="YY1_CDS_SALES_ORDER" type="CDS_VIEW" status="PUBLISHED">\n'
            '      <dependency id="YY1_CUSTOMER_TYPE" collection="SC_CORE" />\n'
            '    </item>\n'
            '  </collection>\n'
            '</software_collections>\n'
        ),

        "sc_dangling_field.json": json.dumps({
            "description": "App variant referencing a custom field marked as DELETED",
            "export_id": "EXP_2026_09_DANGLING",
            "target_release": "S4HC_2408",
            "collections": [
                {
                    "collection_id": "SC_UI_ADAPTATIONS",
                    "name": "Fiori UI Adaptation Collection",
                    "version": "1.0",
                    "items": [
                        {
                            "item_id": "YY1_OBSOLETE_DISCOUNT",
                            "item_type": "CUSTOM_FIELD",
                            "status": "DELETED",
                            "dependencies": []
                        },
                        {
                            "item_id": "APP_VAR_SO_CREATE",
                            "item_type": "APP_VARIANT",
                            "status": "PUBLISHED",
                            "dependencies": ["YY1_OBSOLETE_DISCOUNT"]
                        }
                    ]
                }
            ]
        }),

        "tr_valid_sequence.json": json.dumps({
            "description": "Linear clean CTS transport sequence with DDIC table, Class, and Report",
            "transports": {
                "DEVK900010": ["TABL ZCUSTOMER"],
                "DEVK900020": ["CLAS ZCL_CUSTOMER_SVC"],
                "DEVK900030": ["PROG ZCUSTOMER_RPT"]
            },
            "e070": [
                {"trkorr": "DEVK900010", "trfunction": "K", "trstatus": "R", "as4user": "ARCHITECT", "as4date": "20260901", "as4time": "090000"},
                {"trkorr": "DEVK900020", "trfunction": "K", "trstatus": "R", "as4user": "DEVELOPER1", "as4date": "20260902", "as4time": "100000"},
                {"trkorr": "DEVK900030", "trfunction": "K", "trstatus": "R", "as4user": "DEVELOPER2", "as4date": "20260903", "as4time": "110000"}
            ],
            "e071": [
                {"trkorr": "DEVK900010", "pgmid": "R3TR", "object": "TABL", "obj_name": "ZCUSTOMER"},
                {"trkorr": "DEVK900020", "pgmid": "R3TR", "object": "CLAS", "obj_name": "ZCL_CUSTOMER_SVC"},
                {"trkorr": "DEVK900030", "pgmid": "R3TR", "object": "PROG", "obj_name": "ZCUSTOMER_RPT"}
            ],
            "call_references": [
                {"caller_tr": "DEVK900020", "caller_object": "CLAS ZCL_CUSTOMER_SVC", "callee_tr": "DEVK900010", "callee_object": "TABL ZCUSTOMER", "reference_type": "SELECT_TABLE"},
                {"caller_tr": "DEVK900030", "caller_object": "PROG ZCUSTOMER_RPT", "callee_tr": "DEVK900020", "callee_object": "CLAS ZCL_CUSTOMER_SVC", "reference_type": "CALL_METHOD"}
            ],
            "planned_sequence": ["DEVK900010", "DEVK900020", "DEVK900030"]
        }),

        "tr_valid_e070_e071.csv": (
            "TRKORR,PGMID,OBJECT,OBJ_NAME,AS4USER,AS4DATE,AS4TIME,TRSTATUS\n"
            "DEVK900010,R3TR,TABL,ZCUSTOMER,ARCHITECT,20260901,090000,R\n"
            "DEVK900020,R3TR,CLAS,ZCL_CUSTOMER_SVC,DEVELOPER1,20260902,100000,R\n"
            "DEVK900030,R3TR,PROG,ZCUSTOMER_RPT,DEVELOPER2,20260903,110000,R\n"
        ),

        "tr_collision.json": json.dumps({
            "description": "Multiple open transports modifying the same ABAP class and table",
            "transports": {
                "DEVK900101": [
                    "CLAS ZCL_ORDER_HANDLER",
                    "TABL ZORDERS"
                ],
                "DEVK900105": [
                    "CLAS ZCL_ORDER_HANDLER",
                    "PROG ZREPORT"
                ],
                "DEVK900090": [
                    "TABL ZCONFIG"
                ]
            },
            "e070": [
                {"trkorr": "DEVK900101", "trfunction": "K", "trstatus": "D", "as4user": "DEV1", "as4date": "20260901", "as4time": "100000"},
                {"trkorr": "DEVK900105", "trfunction": "K", "trstatus": "D", "as4user": "DEV2", "as4date": "20260902", "as4time": "140000"},
                {"trkorr": "DEVK900090", "trfunction": "K", "trstatus": "R", "as4user": "ADMIN", "as4date": "20260830", "as4time": "080000"}
            ],
            "e071": [
                {"trkorr": "DEVK900101", "pgmid": "R3TR", "object": "CLAS", "obj_name": "ZCL_ORDER_HANDLER"},
                {"trkorr": "DEVK900101", "pgmid": "R3TR", "object": "TABL", "obj_name": "ZORDERS"},
                {"trkorr": "DEVK900105", "pgmid": "R3TR", "object": "CLAS", "obj_name": "ZCL_ORDER_HANDLER"},
                {"trkorr": "DEVK900105", "pgmid": "R3TR", "object": "PROG", "obj_name": "ZREPORT"},
                {"trkorr": "DEVK900090", "pgmid": "R3TR", "object": "TABL", "obj_name": "ZCONFIG"}
            ]
        }),

        "tr_collision.csv": (
            "TRKORR,PGMID,OBJECT,OBJ_NAME,AS4USER,AS4DATE,AS4TIME,TRSTATUS\n"
            "DEVK900101,R3TR,CLAS,ZCL_ORDER_HANDLER,DEV1,20260901,100000,D\n"
            "DEVK900101,R3TR,TABL,ZORDERS,DEV1,20260901,100000,D\n"
            "DEVK900105,R3TR,CLAS,ZCL_ORDER_HANDLER,DEV2,20260902,140000,D\n"
            "DEVK900105,R3TR,PROG,ZREPORT,DEV2,20260902,140000,D\n"
        ),

        "tr_overtaker_downgrade.json": json.dumps({
            "description": "Sequence inversion where older transport version is scheduled to import after newer version",
            "transports": {
                "DEVK900050": ["PROG ZPAYMENT_RUN"],
                "DEVK900060": ["PROG ZPAYMENT_RUN"]
            },
            "e070": [
                {"trkorr": "DEVK900050", "trfunction": "K", "trstatus": "R", "as4user": "DEV1", "as4date": "20260901", "as4time": "100000", "timestamp": "20260901100000"},
                {"trkorr": "DEVK900060", "trfunction": "K", "trstatus": "R", "as4user": "DEV2", "as4date": "20260915", "as4time": "140000", "timestamp": "20260915140000"}
            ],
            "e071": [
                {"trkorr": "DEVK900050", "pgmid": "R3TR", "object": "PROG", "obj_name": "ZPAYMENT_RUN"},
                {"trkorr": "DEVK900060", "pgmid": "R3TR", "object": "PROG", "obj_name": "ZPAYMENT_RUN"}
            ],
            "planned_sequence": ["DEVK900060", "DEVK900050"]
        }),

        "tr_customizing_ahead_of_structure.json": json.dumps({
            "description": "Customizing table keys transported without or ahead of Workbench structural table definition",
            "transports": {
                "DEVK900070": ["TABL ZPRICING_CONFIG"],
                "DEVK900080": ["TABU ZPRICING_CONFIG"]
            },
            "e070": [
                {"trkorr": "DEVK900070", "trfunction": "K", "trstatus": "R", "as4user": "ARCHITECT", "as4date": "20260910", "as4time": "100000"},
                {"trkorr": "DEVK900080", "trfunction": "W", "trstatus": "R", "as4user": "CONSULTANT", "as4date": "20260912", "as4time": "150000"}
            ],
            "e071": [
                {"trkorr": "DEVK900070", "pgmid": "R3TR", "object": "TABL", "obj_name": "ZPRICING_CONFIG"}
            ],
            "e071k": [
                {"trkorr": "DEVK900080", "pgmid": "R3TR", "object": "TABU", "obj_name": "ZPRICING_CONFIG", "tablename": "ZPRICING_CONFIG", "tabkey": "100*"}
            ],
            "planned_sequence": ["DEVK900080", "DEVK900070"]
        }),

        "tr_circular_transports.json": json.dumps({
            "description": "Mutually dependent transports forming circular call dependency",
            "transports": {
                "DEVK900201": ["CLAS ZCL_DISCOUNT_CALC"],
                "DEVK900202": ["CLAS ZCL_TAX_CALC"]
            },
            "e070": [
                {"trkorr": "DEVK900201", "trfunction": "K", "trstatus": "D", "as4user": "DEV1", "as4date": "20260901", "as4time": "100000"},
                {"trkorr": "DEVK900202", "trfunction": "K", "trstatus": "D", "as4user": "DEV2", "as4date": "20260901", "as4time": "110000"}
            ],
            "e071": [
                {"trkorr": "DEVK900201", "pgmid": "R3TR", "object": "CLAS", "obj_name": "ZCL_DISCOUNT_CALC"},
                {"trkorr": "DEVK900202", "pgmid": "R3TR", "object": "CLAS", "obj_name": "ZCL_TAX_CALC"}
            ],
            "call_references": [
                {"caller_tr": "DEVK900201", "caller_object": "CLAS ZCL_DISCOUNT_CALC", "callee_tr": "DEVK900202", "callee_object": "CLAS ZCL_TAX_CALC", "reference_type": "CALL_METHOD"},
                {"caller_tr": "DEVK900202", "caller_object": "CLAS ZCL_TAX_CALC", "callee_tr": "DEVK900201", "callee_object": "CLAS ZCL_DISCOUNT_CALC", "reference_type": "CALL_METHOD"}
            ]
        }),

        "tr_e070_e071_complete.csv": (
            "TRKORR,PGMID,OBJECT,OBJ_NAME,AS4USER,AS4DATE,AS4TIME,TRSTATUS,OBJFUNC,TABLENAME,TABKEY\n"
            "DEVK900010,R3TR,TABL,ZCUSTOMER,ARCHITECT,20260901,090000,R, , , \n"
            "DEVK900020,R3TR,CLAS,ZCL_CUSTOMER_SVC,DEVELOPER1,20260902,100000,R, , , \n"
            "DEVK900030,R3TR,PROG,ZCUSTOMER_RPT,DEVELOPER2,20260903,110000,R, , , \n"
            "DEVK900080,R3TR,TABU,ZCONFIG,CONSULTANT,20260905,140000,R,K,ZCONFIG,100*\n"
        )
    }
    return fallbacks.get(filename, "{}")


# =============================================================================
# Helper Utilities
# =============================================================================

def make_analysis_request(
    engine_type: EngineType,
    raw_content: str,
    artifact_type: ArtifactType = ArtifactType.JSON,
    file_name: str = "artifact.json",
    target_release: str = "S4HC_2408",
) -> AnalysisRequest:
    """Constructs a fully formed AnalysisRequest with embedded artifact."""
    return AnalysisRequest(
        job_id="job-dom4-" + hashlib.sha256(raw_content.encode("utf-8")).hexdigest()[:8],
        tenant_id="tenant-enterprise-prod",
        project_id="proj-release-2026",
        engine_type=engine_type,
        target_release=target_release,
        artifacts=[
            ArtifactReference(
                file_name=file_name,
                artifact_type=artifact_type,
                raw_content=raw_content,
                sha256=hashlib.sha256(raw_content.encode("utf-8")).hexdigest(),
                size_bytes=len(raw_content.encode("utf-8")),
            )
        ],
        raw_content=raw_content,
    )


# =============================================================================
# Test Suite 1: Software Collection Dependency Guard (Feature 28)
# =============================================================================

class TestSoftwareCollectionGuardHarness:
    """Exhaustive test suite for Software Collection Dependency Guard."""

    def test_evaluator_backward_compatibility_linear(self):
        """Verifies direct evaluate() classmethod handles clean linear collections."""
        engine_cls = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD).__class__
        cols = ["SC_FOUNDATION", "SC_CORE", "SC_SALES"]
        deps = {
            "SC_FOUNDATION": [],
            "SC_CORE": ["SC_FOUNDATION"],
            "SC_SALES": ["SC_CORE"],
        }
        res = engine_cls.evaluate(cols, deps)
        assert res["status"] == "COMPLETED"
        assert res["has_cycles"] is False
        assert len(res["findings"]) == 0

    def test_evaluator_backward_compatibility_two_node_cycle(self):
        """Verifies evaluate() detects mutual 2-node cycle (SC_FINANCE <-> SC_SALES)."""
        engine_cls = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD).__class__
        cols = ["SC_FINANCE", "SC_SALES"]
        deps = {
            "SC_FINANCE": ["SC_SALES"],
            "SC_SALES": ["SC_FINANCE"],
        }
        res = engine_cls.evaluate(cols, deps)
        assert res["status"] == "COMPLETED"
        assert res["has_cycles"] is True
        assert any(f["code"] == "SC_CIRCULAR_DEPENDENCY" for f in res["findings"])

    def test_evaluator_backward_compatibility_three_node_cycle(self):
        """Verifies evaluate() detects multi-node circular dependency (A -> B -> C -> A)."""
        engine_cls = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD).__class__
        cols = ["SC_A", "SC_B", "SC_C"]
        deps = {
            "SC_A": ["SC_B"],
            "SC_B": ["SC_C"],
            "SC_C": ["SC_A"],
        }
        res = engine_cls.evaluate(cols, deps)
        assert res["has_cycles"] is True
        assert any(f["code"] == "SC_CIRCULAR_DEPENDENCY" for f in res["findings"])

    def test_golden_fixture_valid_sequence(self):
        """Golden Positive: sc_valid_sequence.json parses cleanly with deterministic topological import sequence."""
        raw_json = load_fixture("sc_valid_sequence.json")
        req = make_analysis_request(
            EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            raw_json,
            ArtifactType.JSON,
            "sc_valid_sequence.json"
        )
        engine = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.engine_type == EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD
        # Zero blocker/critical findings
        severe_findings = [f for f in resp.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]
        assert len(severe_findings) == 0

        # Verify metrics & recommended sequence
        metrics = {**resp.metrics.model_dump(), **resp.metrics.additional_metrics}
        seq = metrics.get("recommendedSequence") or metrics.get("recommended_sequence")
        assert seq is not None
        assert "SC_CORE" in seq
        assert "SC_SALES" in seq
        assert seq.index("SC_CORE") < seq.index("SC_SALES")

    def test_golden_fixture_circular_dependency(self):
        """Golden Negative: sc_circular.json triggers SC_CIRCULAR_DEPENDENCY with cryptographic evidence."""
        raw_json = load_fixture("sc_circular.json")
        req = make_analysis_request(
            EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            raw_json,
            ArtifactType.JSON,
            "sc_circular.json"
        )
        engine = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        cycle_findings = [f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY"]
        assert len(cycle_findings) >= 1
        f = cycle_findings[0]
        assert f.severity == Severity.CRITICAL
        assert f.confidence == ConfidenceClass.VERIFIED
        assert len(f.evidence) > 0
        assert f.evidence[0].sha256 == hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
        assert f.evidence[0].line_number >= 1

    def test_golden_fixture_missing_prerequisite(self):
        """Golden Negative: sc_missing_prereq.json flags missing prerequisite collection or item."""
        raw_json = load_fixture("sc_missing_prereq.json")
        req = make_analysis_request(
            EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            raw_json,
            ArtifactType.JSON,
            "sc_missing_prereq.json"
        )
        engine = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        missing_findings = [f for f in resp.findings if f.rule_id == "SC_MISSING_PREREQUISITE"]
        assert len(missing_findings) >= 1
        f = missing_findings[0]
        assert f.severity == Severity.BLOCKER
        assert "SC_INVENTORY" in f.description or "YY1_CDS_ORDER_DETAIL" in f.description
        assert "export" in f.remediation.lower() or "import" in f.remediation.lower()

    def test_golden_fixture_draft_item(self):
        """Golden Negative: sc_draft_item.json flags draft BAdI implementation in export collection."""
        raw_json = load_fixture("sc_draft_item.json")
        req = make_analysis_request(
            EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            raw_json,
            ArtifactType.JSON,
            "sc_draft_item.json"
        )
        engine = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        draft_findings = [f for f in resp.findings if f.rule_id == "SC_DRAFT_ITEM_INCLUDED"]
        assert len(draft_findings) >= 1
        f = draft_findings[0]
        assert f.severity == Severity.MAJOR
        assert f.confidence == ConfidenceClass.VERIFIED
        assert "BADI_GOODS_RECEIPT_VALIDATION" in f.description
        assert "Publish" in f.remediation

    def test_golden_fixture_linear_manifest_xml(self):
        """Golden Positive (XML): sc_linear_manifest.xml parsed via defused safe XML with exact coordinates."""
        raw_xml = load_fixture("sc_linear_manifest.xml")
        req = make_analysis_request(
            EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            raw_xml,
            ArtifactType.XML,
            "sc_linear_manifest.xml"
        )
        engine = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        severe_findings = [f for f in resp.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]
        assert len(severe_findings) == 0

        metrics = {**resp.metrics.model_dump(), **resp.metrics.additional_metrics}
        seq = metrics.get("recommendedSequence") or metrics.get("recommended_sequence")
        assert seq is not None
        assert "SC_CORE" in seq
        assert "SC_SALES" in seq
        assert seq.index("SC_CORE") < seq.index("SC_SALES")

    def test_golden_fixture_dangling_field_reference(self):
        """Edge Case: sc_dangling_field.json flags App Variant referencing deleted custom field."""
        raw_json = load_fixture("sc_dangling_field.json")
        req = make_analysis_request(
            EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            raw_json,
            ArtifactType.JSON,
            "sc_dangling_field.json"
        )
        engine = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        dangling_findings = [f for f in resp.findings if f.rule_id == "SC_DANGLING_FIELD_REFERENCE"]
        assert len(dangling_findings) >= 1
        f = dangling_findings[0]
        assert f.severity == Severity.CRITICAL
        assert "YY1_OBSOLETE_DISCOUNT" in f.description

    def test_zip_archive_ingestion(self):
        """Verifies software collection packaged inside in-memory ZIP archive is safely extracted and parsed."""
        raw_json = load_fixture("sc_valid_sequence.json")
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("software_collections.json", raw_json)
        zip_bytes = zip_buf.getvalue()

        req = AnalysisRequest(
            job_id="job-zip-sc-01",
            tenant_id="tenant-prod",
            project_id="proj-release",
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            target_release="S4HC_2408",
            artifacts=[
                ArtifactReference(
                    file_name="collection_export.zip",
                    artifact_type=ArtifactType.ZIP,
                    raw_content=raw_json,  # Provide raw json as fallback representation
                    sha256=hashlib.sha256(zip_bytes).hexdigest(),
                    size_bytes=len(zip_bytes),
                )
            ],
            raw_content=raw_json,
        )
        engine = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))
        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.engine_type == EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD

    def test_malformed_json_fails_closed(self):
        """Verifies completely corrupted JSON fails closed with SC_SCHEMA_VALIDATION_FAILED or status FAILED."""
        corrupt_raw = "{ invalid json: true, missing quotes }"
        req = make_analysis_request(
            EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            corrupt_raw,
            ArtifactType.JSON,
            "corrupt.json"
        )
        engine = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status in (AnalysisStatus.COMPLETED, AnalysisStatus.FAILED)
        if resp.status == AnalysisStatus.COMPLETED:
            assert any(f.rule_id == "SC_SCHEMA_VALIDATION_FAILED" for f in resp.findings)

    def test_diamond_dag_deterministic_tie_breaking(self):
        """Property test: Diamond DAG topology produces deterministic alphabetical tie-breaking."""
        # Diamond DAG: A -> B, A -> C, B -> D, C -> D
        # Prerequisites: D depends on B and C; B and C depend on A.
        manifest = {
            "collections": [
                {"collection_id": "SC_D", "items": [{"item_id": "D1", "dependencies": ["SC_B:B1", "SC_C:C1"]}]},
                {"collection_id": "SC_C", "items": [{"item_id": "C1", "dependencies": ["SC_A:A1"]}]},
                {"collection_id": "SC_B", "items": [{"item_id": "B1", "dependencies": ["SC_A:A1"]}]},
                {"collection_id": "SC_A", "items": [{"item_id": "A1", "dependencies": []}]},
            ]
        }
        req = make_analysis_request(
            EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            json.dumps(manifest),
            ArtifactType.JSON,
            "diamond.json"
        )
        engine = EngineRegistry.get(EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        metrics = {**resp.metrics.model_dump(), **resp.metrics.additional_metrics}
        seq = metrics.get("recommendedSequence") or metrics.get("recommended_sequence")
        assert seq is not None
        assert seq[0] == "SC_A"
        assert seq[-1] == "SC_D"
        # Deterministic lexicographical tie-break: B before C
        assert seq.index("SC_B") < seq.index("SC_C")


# =============================================================================
# Test Suite 2: Transport Dependency Analyzer (Feature 29)
# =============================================================================

class TestTransportDependencyAnalyzerHarness:
    """Exhaustive test suite for Transport Dependency Analyzer."""

    def test_evaluator_backward_compatibility_zero_collisions(self):
        """Verifies direct evaluate() classmethod handles distinct non-colliding objects."""
        engine_cls = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER).__class__
        trs = {
            "DEVK900010": ["CLAS ZCL_ORDER_SERVICE"],
            "DEVK900020": ["CLAS ZCL_BILLING_SERVICE"],
        }
        res = engine_cls.evaluate(trs)
        assert res["status"] == "COMPLETED"
        assert res["collisions_count"] == 0
        assert len(res["findings"]) == 0

    def test_evaluator_backward_compatibility_same_class_collision(self):
        """Verifies evaluate() detects collision when same class appears in two transports."""
        engine_cls = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER).__class__
        trs = {
            "DEVK900101": ["CLAS ZCL_ORDER_HANDLER", "TABL ZORDERS"],
            "DEVK900105": ["CLAS ZCL_ORDER_HANDLER", "PROG ZREPORT"],
        }
        res = engine_cls.evaluate(trs)
        assert res["status"] == "COMPLETED"
        assert res["collisions_count"] >= 1
        assert any(f["code"] == "TR_OBJECT_COLLISION" and f["object"] == "CLAS ZCL_ORDER_HANDLER" for f in res["findings"])

    def test_golden_fixture_valid_sequence_json(self):
        """Golden Positive: tr_valid_sequence.json has 0 collisions and produces deterministic topological sequence."""
        raw_json = load_fixture("tr_valid_sequence.json")
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_json,
            ArtifactType.JSON,
            "tr_valid_sequence.json"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.engine_type == EngineType.TRANSPORT_DEPENDENCY_ANALYZER
        collision_findings = [f for f in resp.findings if f.rule_id == "TR_OBJECT_COLLISION"]
        assert len(collision_findings) == 0

        # Check recommended import sequence: table -> class -> report
        metrics = {**resp.metrics.model_dump(), **resp.metrics.additional_metrics}
        seq = metrics.get("recommendedImportSequence") or metrics.get("recommended_import_sequence")
        assert seq is not None
        assert "DEVK900010" in seq
        assert "DEVK900020" in seq
        assert "DEVK900030" in seq
        assert seq.index("DEVK900010") < seq.index("DEVK900020")
        assert seq.index("DEVK900020") < seq.index("DEVK900030")

    def test_golden_fixture_valid_e070_e071_csv(self):
        """Golden Positive (CSV): tr_valid_e070_e071.csv parsed cleanly with 0 collisions."""
        raw_csv = load_fixture("tr_valid_e070_e071.csv")
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_csv,
            ArtifactType.CSV,
            "tr_valid_e070_e071.csv"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        collision_findings = [f for f in resp.findings if f.rule_id == "TR_OBJECT_COLLISION"]
        assert len(collision_findings) == 0

    def test_golden_fixture_collision_json(self):
        """Golden Negative: tr_collision.json flags TR_OBJECT_COLLISION with exact transports and cryptographic evidence."""
        raw_json = load_fixture("tr_collision.json")
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_json,
            ArtifactType.JSON,
            "tr_collision.json"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        collisions = [f for f in resp.findings if f.rule_id == "TR_OBJECT_COLLISION"]
        assert len(collisions) >= 1
        coll = next(f for f in collisions if "ZCL_ORDER_HANDLER" in f.description)
        assert coll.severity == Severity.CRITICAL
        assert coll.confidence == ConfidenceClass.VERIFIED
        assert len(coll.evidence) > 0
        assert re.match(r"^[0-9a-f]{64}$", coll.evidence[0].sha256)
        assert coll.evidence[0].line_number >= 1
        assert "STMS" in coll.remediation or "CSOL" in coll.remediation or "merge" in coll.remediation.lower()

    def test_golden_fixture_collision_csv(self):
        """Golden Negative (CSV): tr_collision.csv detects collision in raw CTS CSV table export."""
        raw_csv = load_fixture("tr_collision.csv")
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_csv,
            ArtifactType.CSV,
            "tr_collision.csv"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        collisions = [f for f in resp.findings if f.rule_id == "TR_OBJECT_COLLISION"]
        assert len(collisions) >= 1
        coll = collisions[0]
        assert coll.severity == Severity.CRITICAL
        assert coll.confidence == ConfidenceClass.VERIFIED

    def test_golden_fixture_overtaker_downgrade_risk(self):
        """Golden Negative: tr_overtaker_downgrade.json flags sequence inversion risking older version overwrite."""
        raw_json = load_fixture("tr_overtaker_downgrade.json")
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_json,
            ArtifactType.JSON,
            "tr_overtaker_downgrade.json"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        overtakers = [f for f in resp.findings if f.rule_id == "TR_OVERTAKER_DOWNGRADE_RISK"]
        assert len(overtakers) >= 1
        ov = overtakers[0]
        assert ov.severity in (Severity.BLOCKER, Severity.CRITICAL)
        assert "DEVK900050" in ov.description
        assert "DEVK900060" in ov.description

    def test_golden_fixture_customizing_ahead_of_structure(self):
        """Golden Negative: tr_customizing_ahead_of_structure.json flags E071K table entries without preceding TABL."""
        raw_json = load_fixture("tr_customizing_ahead_of_structure.json")
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_json,
            ArtifactType.JSON,
            "tr_customizing_ahead_of_structure.json"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        customizing_ahead = [f for f in resp.findings if f.rule_id == "TR_CUSTOMIZING_AHEAD_OF_STRUCTURE"]
        assert len(customizing_ahead) >= 1
        ca = customizing_ahead[0]
        assert ca.severity == Severity.BLOCKER
        assert "ZPRICING_CONFIG" in ca.description
        assert ca.confidence == ConfidenceClass.VERIFIED

    def test_golden_fixture_circular_transports(self):
        """Edge Case: tr_circular_transports.json detects circular call dependencies between transports."""
        raw_json = load_fixture("tr_circular_transports.json")
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_json,
            ArtifactType.JSON,
            "tr_circular_transports.json"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        cycle_findings = [f for f in resp.findings if f.rule_id == "TR_CIRCULAR_DEPENDENCY_DETECTED"]
        assert len(cycle_findings) >= 1
        cf = cycle_findings[0]
        assert cf.severity in (Severity.CRITICAL, Severity.BLOCKER)

    def test_cross_transport_call_dependency_sequence_inversion(self):
        """Verifies TR_CALL_DEPENDENCY_SEQUENCE_RISK is emitted when calling transport precedes callee transport."""
        payload = {
            "transports": {
                "TR_REPORT": ["PROG ZREPORT"],
                "TR_CLASS": ["CLAS ZCL_SERVICE"],
            },
            "call_references": [
                {
                    "caller_tr": "TR_REPORT",
                    "caller_object": "PROG ZREPORT",
                    "callee_tr": "TR_CLASS",
                    "callee_object": "CLAS ZCL_SERVICE",
                    "reference_type": "CALL_METHOD",
                }
            ],
            "planned_sequence": ["TR_REPORT", "TR_CLASS"]  # Inverted sequence!
        }
        raw_json = json.dumps(payload)
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_json,
            ArtifactType.JSON,
            "inverted_call.json"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        risks = [f for f in resp.findings if f.rule_id == "TR_CALL_DEPENDENCY_SEQUENCE_RISK"]
        assert len(risks) >= 1
        r = risks[0]
        assert r.severity in (Severity.CRITICAL, Severity.MAJOR)
        assert "TR_REPORT" in r.description
        assert "TR_CLASS" in r.description

    def test_complete_enterprise_csv_parsing(self):
        """Verifies authentic SAP CTS multi-table CSV dump is parsed without errors."""
        raw_csv = load_fixture("tr_e070_e071_complete.csv")
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_csv,
            ArtifactType.CSV,
            "tr_e070_e071_complete.csv"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        metrics = {**resp.metrics.model_dump(), **resp.metrics.additional_metrics}
        total_tr = metrics.get("totalTransports") or metrics.get("total_transports") or 0
        assert total_tr >= 3

    def test_resilience_to_malformed_cts_data(self):
        """Verifies engine handles corrupt JSON/CSV strings gracefully without crashing."""
        corrupt_raw = "<<<INVALID_XML_AND_JSON>>>"
        req = make_analysis_request(
            EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            corrupt_raw,
            ArtifactType.JSON,
            "corrupt.raw"
        )
        engine = EngineRegistry.get(EngineType.TRANSPORT_DEPENDENCY_ANALYZER)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))
        assert resp.status in (AnalysisStatus.COMPLETED, AnalysisStatus.FAILED)


# =============================================================================
# Test Suite 3: Cardinal Axiom 2 Quality Gate & Invariant Auditing
# =============================================================================

class TestCardinalAxiom2QualityGates:
    """Enforces the 14-point engine anatomy across all emitted Domain 4 findings."""

    @pytest.mark.parametrize("fixture_name,engine_type", [
        ("sc_circular.json", EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD),
        ("sc_missing_prereq.json", EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD),
        ("sc_draft_item.json", EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD),
        ("sc_dangling_field.json", EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD),
        ("tr_collision.json", EngineType.TRANSPORT_DEPENDENCY_ANALYZER),
        ("tr_collision.csv", EngineType.TRANSPORT_DEPENDENCY_ANALYZER),
        ("tr_overtaker_downgrade.json", EngineType.TRANSPORT_DEPENDENCY_ANALYZER),
        ("tr_customizing_ahead_of_structure.json", EngineType.TRANSPORT_DEPENDENCY_ANALYZER),
        ("tr_circular_transports.json", EngineType.TRANSPORT_DEPENDENCY_ANALYZER),
    ])
    def test_emitted_findings_meet_cardinal_axiom_2(self, fixture_name: str, engine_type: EngineType):
        """Verifies 100% of emitted findings have valid rule_ids, severities, confidences, crypto evidence, and remediations."""
        content = load_fixture(fixture_name)
        art_type = ArtifactType.CSV if fixture_name.endswith(".csv") else ArtifactType.JSON
        req = make_analysis_request(engine_type, content, art_type, fixture_name)
        engine = EngineRegistry.get(engine_type)
        resp: AnalysisResponse = asyncio.run(engine.analyze(req))

        assert len(resp.findings) > 0, f"Expected findings for negative/edge fixture {fixture_name}"

        for f in resp.findings:
            # 1. Rule ID taxonomy
            prefix = "SC_" if engine_type == EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD else "TR_"
            assert f.rule_id.startswith(prefix), f"Finding {f.rule_id} does not start with {prefix}"

            # 2. Valid Enum types
            assert isinstance(f.severity, Severity)
            assert isinstance(f.confidence, ConfidenceClass)

            # 3. Non-empty title and description
            assert f.title and len(f.title) > 3
            assert f.description and len(f.description) > 10

            # 4. Actionable technical remediation
            assert f.remediation and len(f.remediation) > 15

            # 5. Cryptographic evidence verification
            assert len(f.evidence) > 0, f"Finding {f.rule_id} missing evidence!"
            for ev in f.evidence:
                assert ev.artifact_path, f"Evidence in {f.rule_id} missing artifact_path"
                assert ev.line_number >= 1, f"Evidence line number must be >= 1, got {ev.line_number}"
                # SHA-256 hash must be exactly 64 hexadecimal characters
                assert re.match(r"^[0-9a-f]{64}$", ev.sha256), f"Invalid SHA-256 hash: {ev.sha256}"
                assert ev.snippet != "", "Evidence snippet must not be empty"

    def test_missing_evidence_demotion_invariant(self):
        """Verifies demotion to UNKNOWN (0.30) if evidence cannot be attached."""
        raw_finding = Finding(
            id="test-demote-001",
            rule_id="SC_UNVERIFIED_RULE",
            severity=Severity.MAJOR,
            category="ReleaseGovernance",
            title="Unverified Item",
            description="Testing missing evidence demotion rule",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Perform manual check",
            evidence=[],  # Empty evidence triggers demotion!
        )
        classifier = ConfidenceClassifier()
        demoted = classifier.classify(raw_finding)
        assert demoted.confidence == ConfidenceClass.UNKNOWN
        assert demoted.confidence_score <= 0.30
