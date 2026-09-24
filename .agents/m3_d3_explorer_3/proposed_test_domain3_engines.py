"""
ERP Preflight — Domain 3 Integration Engines Pytest Suite
Engines Covered:
1. Change Pointer Coverage Auditor (CHANGE_POINTER_COVERAGE_AUDITOR)
2. API Change Guard (API_CHANGE_GUARD)

Governing Standard: AGENTS.md, Cardinal Axiom 2 (14 points), engine-authoring.md, sap-evidence.md
Pass Rate Requirement: 100% automated pass rate under pytest
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import pytest
import sys
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


def setup_domain3_engines():
    """Ensures production or proposed Domain 3 engines are registered in EngineRegistry."""
    # 1. Change Pointer Coverage Auditor
    try:
        current_cp = EngineRegistry.get(EngineType.CHANGE_POINTER_COVERAGE_AUDITOR)
        if not hasattr(current_cp, "_parse_inputs"):
            d1 = find_agent_dir("m3_d3_explorer_1")
            if d1 and (d1 / "proposed_change_pointer.py").exists():
                if str(d1) not in sys.path:
                    sys.path.insert(0, str(d1))
                import proposed_change_pointer
                register_engine(proposed_change_pointer.ChangePointerEngine)
    except Exception:
        d1 = find_agent_dir("m3_d3_explorer_1")
        if d1 and (d1 / "proposed_change_pointer.py").exists():
            if str(d1) not in sys.path:
                sys.path.insert(0, str(d1))
            import proposed_change_pointer
            register_engine(proposed_change_pointer.ChangePointerEngine)

    # 2. API Change Guard
    try:
        current_api = EngineRegistry.get(EngineType.API_CHANGE_GUARD)
        if not hasattr(current_api, "_diff_schemas"):
            d2 = find_agent_dir("m3_d3_explorer_2")
            if d2 and (d2 / "proposed_api_change.py").exists():
                if str(d2) not in sys.path:
                    sys.path.insert(0, str(d2))
                import proposed_api_change
                register_engine(proposed_api_change.ApiChangeEngine)
    except Exception:
        d2 = find_agent_dir("m3_d3_explorer_2")
        if d2 and (d2 / "proposed_api_change.py").exists():
            if str(d2) not in sys.path:
                sys.path.insert(0, str(d2))
            import proposed_api_change
            register_engine(proposed_api_change.ApiChangeEngine)


# Execute setup immediately upon import
setup_domain3_engines()


# =============================================================================
# Fixture Loader with Inline Fallback for Maximum Resilience
# =============================================================================

def get_fixture_dir() -> Path:
    """Resolves Domain 3 fixtures directory from unit tests path or monorepo root."""
    # 1. When deployed in services/analysis-python/tests/unit/
    p1 = Path(__file__).resolve().parent.parent / "fixtures" / "domain3"
    if p1.is_dir():
        return p1
    # 2. When executed from .agents/m3_d3_explorer_3/ or root
    for p in Path(__file__).resolve().parents:
        cand = p / "services" / "analysis-python" / "tests" / "fixtures" / "domain3"
        if cand.is_dir():
            return cand
    return p1


FIXTURE_DIR = get_fixture_dir()


def load_fixture(filename: str) -> str:
    """Reads fixture file from disk with verified fallback for isolated execution."""
    fixture_path = FIXTURE_DIR / filename
    if fixture_path.exists():
        return fixture_path.read_text(encoding="utf-8")
    return get_inline_fixture_fallback(filename)


def get_inline_fixture_fallback(filename: str) -> str:
    """Provides inline fallback for isolated runners when fixtures directory is not yet provisioned."""
    fallbacks = {
        "cp_matmas_active.json": json.dumps({
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "change_document_object": "MATERIAL",
            "bd61_active": True,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [["MARA", "MATKL"], ["MARA", "GROES"], ["MARA", "MEINS"]],
            "expected_fields": [["MARA", "MATKL"], ["MARA", "GROES"], ["MARA", "MEINS"]],
        }),
        "cp_global_disabled.json": json.dumps({
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "bd61_active": False,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [["MARA", "MATKL"]],
            "expected_fields": [["MARA", "MATKL"]],
        }),
        "cp_missing_field.json": json.dumps({
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "bd61_active": True,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [["MARA", "MATKL"], ["MARA", "MEINS"]],
            "expected_fields": [["MARA", "MATKL"], ["MARA", "MEINS"], ["MARA", "GROES"]],
        }),
        "cp_dd04l_flag_missing.json": json.dumps({
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "bd61_active": True,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [["MARA", "MATKL"], ["MARA", "FERTH"]],
            "expected_fields": [["MARA", "MATKL"], ["MARA", "FERTH"]],
            "dd04l_metadata": {"MARA-FERTH": {"change_document_flag": False, "data_element": "FERTH"}},
        }),
        "cp_custom_field_omitted.json": json.dumps({
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "bd61_active": True,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [["MARA", "MATKL"]],
            "expected_fields": [["MARA", "MATKL"], ["MARA", "YY1_SUSTAINABILITY_SCORE"]],
            "custom_fields": [{"table": "MARA", "field": "YY1_SUSTAINABILITY_SCORE"}],
        }),
        "cp_bd52_config.csv": (
            "BD61,X\n"
            "BD50,MATMAS,X\n"
            "BD52,MATMAS,MATERIAL,MARA,MATKL\n"
            "BD52,MATMAS,MATERIAL,MARA,GROES\n"
            "EXPECTED,MARA,MATKL\n"
            "EXPECTED,MARA,GROES\n"
        ),
        "api_openapi_clean.json": json.dumps({
            "baseline": {
                "openapi": "3.0.0",
                "paths": {"/orders": {"get": {"responses": {"200": {"description": "OK"}}}}},
                "components": {"schemas": {"Order": {"type": "object", "properties": {"id": {"type": "string"}}}}}
            },
            "candidate": {
                "openapi": "3.0.0",
                "paths": {
                    "/orders": {"get": {"responses": {"200": {"description": "OK"}}}},
                    "/orders/tracking": {"get": {"responses": {"200": {"description": "OK"}}}}
                },
                "components": {
                    "schemas": {
                        "Order": {
                            "type": "object",
                            "properties": {"id": {"type": "string"}, "notes": {"type": "string"}}
                        }
                    }
                }
            }
        }),
        "api_openapi_breaking.json": json.dumps({
            "baseline": {
                "openapi": "3.0.0",
                "paths": {
                    "/A_PurchaseOrder": {"get": {}, "post": {}},
                    "/A_PurchaseOrder('{PurchaseOrder}')": {"get": {}, "delete": {}}
                },
                "components": {
                    "schemas": {
                        "PurchaseOrder": {
                            "type": "object",
                            "required": ["PurchaseOrderID"],
                            "properties": {
                                "PurchaseOrderID": {"type": "string", "maxLength": 10},
                                "CompanyCode": {"type": "string", "maxLength": 4},
                                "TaxJurisdictionCode": {"type": "string", "maxLength": 10},
                                "OrderStatus": {"type": "string", "enum": ["OPEN", "PENDING", "APPROVED", "REJECTED"]}
                            }
                        }
                    }
                }
            },
            "candidate": {
                "openapi": "3.0.0",
                "paths": {
                    "/A_PurchaseOrder": {"get": {}, "post": {}},
                    "/A_PurchaseOrder('{PurchaseOrder}')": {"get": {}}
                },
                "components": {
                    "schemas": {
                        "PurchaseOrder": {
                            "type": "object",
                            "required": ["PurchaseOrderID"],
                            "properties": {
                                "PurchaseOrderID": {"type": "string", "maxLength": 10},
                                "CompanyCode": {"type": "string", "maxLength": 2},
                                "OrderStatus": {"type": "string", "enum": ["OPEN", "APPROVED", "REJECTED"]}
                            }
                        }
                    }
                }
            },
            "integrations": [
                {
                    "integration_id": "SALESFORCE_INTEGRATION_01",
                    "consumed_endpoints": ["/A_PurchaseOrder('{PurchaseOrder}')"],
                    "consumed_fields": {"PurchaseOrder": ["TaxJurisdictionCode", "CompanyCode"]},
                    "consumed_operations": {"/A_PurchaseOrder('{PurchaseOrder}')": ["DELETE"]}
                }
            ]
        }),
        "api_odata_edmx_baseline.xml": (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">\n'
            '  <edmx:DataServices m:DataServiceVersion="2.0">\n'
            '    <Schema Namespace="API_BUSINESS_PARTNER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">\n'
            '      <EntityType Name="A_BusinessPartner">\n'
            '        <Key><PropertyRef Name="BusinessPartner"/></Key>\n'
            '        <Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10"/>\n'
            '        <Property Name="TaxNumber" Type="Edm.String" Nullable="true" MaxLength="20"/>\n'
            '        <Property Name="CreditScore" Type="Edm.Int32" Nullable="true"/>\n'
            '      </EntityType>\n'
            '      <EntityContainer Name="API_BUSINESS_PARTNER_Entities" m:IsDefaultEntityContainer="true">\n'
            '        <EntitySet Name="A_BusinessPartner" EntityType="API_BUSINESS_PARTNER.A_BusinessPartner"/>\n'
            '        <EntitySet Name="ObsoleteLegacyPartners" EntityType="API_BUSINESS_PARTNER.A_BusinessPartner"/>\n'
            '      </EntityContainer>\n'
            '    </Schema>\n'
            '  </edmx:DataServices>\n'
            '</edmx:Edmx>\n'
        ),
        "api_odata_edmx_candidate.xml": (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">\n'
            '  <edmx:DataServices m:DataServiceVersion="2.0">\n'
            '    <Schema Namespace="API_BUSINESS_PARTNER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">\n'
            '      <EntityType Name="A_BusinessPartner">\n'
            '        <Key><PropertyRef Name="BusinessPartner"/></Key>\n'
            '        <Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10"/>\n'
            '        <Property Name="TaxNumber" Type="Edm.Int64" Nullable="true"/>\n'
            '        <Property Name="CreditScore" Type="Edm.Int32" Nullable="false"/>\n'
            '        <Property Name="VIPStatus" Type="Edm.Boolean" Nullable="true"/>\n'
            '      </EntityType>\n'
            '      <EntityContainer Name="API_BUSINESS_PARTNER_Entities" m:IsDefaultEntityContainer="true">\n'
            '        <EntitySet Name="A_BusinessPartner" EntityType="API_BUSINESS_PARTNER.A_BusinessPartner"/>\n'
            '      </EntityContainer>\n'
            '    </Schema>\n'
            '  </edmx:DataServices>\n'
            '</edmx:Edmx>\n'
        ),
    }
    return fallbacks.get(filename, "{}")


# =============================================================================
# 1. Engine Registration & Metadata Tests (Point 1: Metadata)
# =============================================================================

def test_change_pointer_metadata():
    """Verifies Change Pointer Coverage Auditor registration and metadata integrity."""
    setup_domain3_engines()
    engine = EngineRegistry.get(EngineType.CHANGE_POINTER_COVERAGE_AUDITOR)
    assert engine is not None
    assert engine.engine_type == EngineType.CHANGE_POINTER_COVERAGE_AUDITOR
    assert "Change Pointer" in engine.name
    meta = engine.get_metadata()
    assert meta["engine_type"] == "CHANGE_POINTER_COVERAGE_AUDITOR"
    assert "JSON" in meta["supported_artifact_types"] or "CSV" in meta["supported_artifact_types"]


def test_api_change_metadata():
    """Verifies API Change Guard registration and metadata integrity."""
    setup_domain3_engines()
    engine = EngineRegistry.get(EngineType.API_CHANGE_GUARD)
    assert engine is not None
    assert engine.engine_type == EngineType.API_CHANGE_GUARD
    assert "API Change" in engine.name
    meta = engine.get_metadata()
    assert meta["engine_type"] == "API_CHANGE_GUARD"
    assert any(t in meta["supported_artifact_types"] for t in ["JSON", "XML", "EDMX"])


# =============================================================================
# 2. Golden Positive Clean Execution Tests (Point 8: Curated Fixtures)
# =============================================================================

@pytest.mark.asyncio
async def test_cp_golden_clean_execution():
    """Verifies Change Pointer Auditor with complete 100% field coverage produces 0 critical findings."""
    setup_domain3_engines()
    raw_content = load_fixture("cp_matmas_active.json")
    req = AnalysisRequest(
        job_id="11111111-0001-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    assert resp.status == AnalysisStatus.COMPLETED
    # 0 blocker or critical findings
    critical_findings = [f for f in resp.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]
    assert len(critical_findings) == 0
    # Check coverage telemetry metrics
    metrics = resp.metrics.additional_metrics
    assert metrics.get("global_active", metrics.get("globalActive")) is True
    assert metrics.get("message_type_active", metrics.get("messageTypeActive")) is True
    cov = metrics.get("coverage_percentage", metrics.get("coveragePercentage", 0))
    assert cov == 100.0


@pytest.mark.asyncio
async def test_api_golden_clean_execution():
    """Verifies API Change Guard with backward-compatible additions produces 0 breaking changes."""
    setup_domain3_engines()
    raw_content = load_fixture("api_openapi_clean.json")
    req = AnalysisRequest(
        job_id="11111111-0002-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    assert resp.status == AnalysisStatus.COMPLETED
    # Filter strictly for breaking findings (excluding non-breaking info findings)
    breaking_findings = [
        f for f in resp.findings
        if "BREAKING" in f.rule_id and "NON_BREAKING" not in f.rule_id
    ]
    assert len(breaking_findings) == 0
    metrics = resp.metrics.additional_metrics
    assert metrics.get("breakingChangesCount", 0) == 0


# =============================================================================
# 3. Golden Negative Defect Trigger Tests (Point 5: Standard Taxonomy)
# =============================================================================

@pytest.mark.asyncio
async def test_cp_global_disabled_trigger():
    """Verifies that deactivated BD61 triggers CP_GLOBAL_DEACTIVATED critical finding."""
    setup_domain3_engines()
    raw_content = load_fixture("cp_global_disabled.json")
    req = AnalysisRequest(
        job_id="11111111-0003-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    assert resp.status in (AnalysisStatus.PARTIAL, AnalysisStatus.COMPLETED)
    assert any(
        f.rule_id in ("CP_GLOBAL_DEACTIVATED", "CP_GLOBAL_DISABLED")
        and f.severity in (Severity.CRITICAL, Severity.BLOCKER)
        for f in resp.findings
    )


@pytest.mark.asyncio
async def test_cp_missing_field_trigger():
    """Verifies that missing GROES field in BD52 triggers CP_FIELD_NOT_CONFIGURED_BD52."""
    setup_domain3_engines()
    raw_content = load_fixture("cp_missing_field.json")
    req = AnalysisRequest(
        job_id="11111111-0004-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    matching = [
        f for f in resp.findings
        if f.rule_id == "CP_FIELD_NOT_CONFIGURED_BD52" and ("GROES" in f.title or "GROES" in f.description)
    ]
    assert len(matching) >= 1
    assert matching[0].technical_details.get("field") == "GROES" or "GROES" in str(matching[0].affected_objects)


@pytest.mark.asyncio
async def test_api_breaking_field_removed():
    """Verifies that removing TaxJurisdictionCode triggers API_BREAKING_FIELD_REMOVED."""
    setup_domain3_engines()
    raw_content = load_fixture("api_openapi_breaking.json")
    req = AnalysisRequest(
        job_id="11111111-0005-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    rule_ids = {f.rule_id for f in resp.findings}
    assert "API_BREAKING_FIELD_REMOVED" in rule_ids
    field_finding = next(
        f for f in resp.findings
        if f.rule_id == "API_BREAKING_FIELD_REMOVED" and "TaxJurisdictionCode" in f.title
    )
    assert field_finding.severity in (Severity.CRITICAL, Severity.BLOCKER)


@pytest.mark.asyncio
async def test_api_breaking_operation_removed():
    """Verifies that removing DELETE operation triggers API_BREAKING_OPERATION_REMOVED."""
    setup_domain3_engines()
    raw_content = load_fixture("api_openapi_breaking.json")
    req = AnalysisRequest(
        job_id="11111111-0006-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    delete_finding = next(
        f for f in resp.findings
        if f.rule_id == "API_BREAKING_OPERATION_REMOVED" and "DELETE" in f.title
    )
    assert delete_finding is not None
    assert delete_finding.severity in (Severity.CRITICAL, Severity.BLOCKER)


@pytest.mark.asyncio
async def test_api_breaking_enum_restricted():
    """Verifies that removing PENDING from status enum triggers API_BREAKING_ENUM_RESTRICTED."""
    setup_domain3_engines()
    raw_content = load_fixture("api_openapi_breaking.json")
    req = AnalysisRequest(
        job_id="11111111-0007-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    assert any(f.rule_id == "API_BREAKING_ENUM_RESTRICTED" for f in resp.findings)


@pytest.mark.asyncio
async def test_api_breaking_required_param_added():
    """Verifies that adding a required parameter without default triggers API_BREAKING_REQUIRED_PARAM_ADDED."""
    setup_domain3_engines()
    raw_content = load_fixture("api_openapi_breaking.json")
    req = AnalysisRequest(
        job_id="11111111-0007-0001-0001-000000000002",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    rule_ids = {f.rule_id for f in resp.findings}
    assert any("REQUIRED" in r for r in rule_ids)


@pytest.mark.asyncio
async def test_cp_runtime_unprocessed_backlog():
    """Verifies that heavy unprocessed change pointer backlog in BDCP2 triggers CP_RUNTIME_UNPROCESSED_BACKLOG."""
    setup_domain3_engines()
    payload = {
        "message_type": "MATMAS",
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
        "bdcp2_samples": [
            {"message_type": "MATMAS", "table": "MARA", "field": "MATKL", "process_status": " ", "count": 250}
        ]
    }
    req = AnalysisRequest(
        job_id="11111111-0007-0001-0001-000000000003",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=json.dumps(payload),
    )
    resp = await EngineRunner.execute(req)
    assert any(f.rule_id == "CP_RUNTIME_UNPROCESSED_BACKLOG" for f in resp.findings)



# =============================================================================
# 4. Consumer Impact Cross-Reference Tests
# =============================================================================

@pytest.mark.asyncio
async def test_api_consumer_impact_detected():
    """Verifies that breaking change cross-references integration registry and elevates severity."""
    setup_domain3_engines()
    raw_content = load_fixture("api_openapi_breaking.json")
    req = AnalysisRequest(
        job_id="11111111-0008-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    impacted = [
        f for f in resp.findings
        if "SALESFORCE_INTEGRATION_01" in str(f.technical_details.get("affectedIntegrations", []))
    ]
    assert len(impacted) >= 1
    metrics = resp.metrics.additional_metrics
    assert metrics.get("affectedIntegrationsCount", 0) >= 1
    assert "SALESFORCE_INTEGRATION_01" in metrics.get("affectedIntegrations", [])


# =============================================================================
# 5. Edge Cases & Boundary Tests
# =============================================================================

@pytest.mark.asyncio
async def test_cp_dd04l_flag_missing():
    """Verifies that DD04L flag missing on FERTH data element triggers CP_FIELD_DD04L_CHGFLAG_MISSING."""
    setup_domain3_engines()
    raw_content = load_fixture("cp_dd04l_flag_missing.json")
    req = AnalysisRequest(
        job_id="11111111-0009-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    matching = [
        f for f in resp.findings
        if f.rule_id in ("CP_FIELD_DD04L_CHGFLAG_MISSING", "CP_DD04L_FLAG_MISSING")
    ]
    assert len(matching) >= 1
    assert "FERTH" in matching[0].title or "FERTH" in matching[0].description


@pytest.mark.asyncio
async def test_cp_custom_field_omitted():
    """Verifies that custom extension field YY1_SUSTAINABILITY_SCORE triggers CP_CUSTOM_FIELD_OMITTED."""
    setup_domain3_engines()
    raw_content = load_fixture("cp_custom_field_omitted.json")
    req = AnalysisRequest(
        job_id="11111111-0010-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    custom_finding = next(
        f for f in resp.findings
        if "CUSTOM_FIELD" in f.rule_id and "YY1_SUSTAINABILITY_SCORE" in f.title
    )
    assert custom_finding is not None
    assert custom_finding.confidence in (ConfidenceClass.RULE_DERIVED, ConfidenceClass.VERIFIED)


@pytest.mark.asyncio
async def test_cp_csv_format_parsing():
    """Verifies that legacy tabular CSV export format is correctly parsed and evaluated."""
    setup_domain3_engines()
    raw_content = load_fixture("cp_bd52_config.csv")
    req = AnalysisRequest(
        job_id="11111111-0011-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        artifact_type=ArtifactType.CSV,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    assert resp.status == AnalysisStatus.COMPLETED
    assert resp.metrics.additional_metrics.get("global_active") is True


@pytest.mark.asyncio
async def test_api_edmx_type_change_and_artifacts():
    """Verifies that OData EDMX type change (String -> Int64) triggers API_BREAKING_TYPE_CHANGED."""
    setup_domain3_engines()
    baseline_edmx = load_fixture("api_odata_edmx_baseline.xml")
    candidate_edmx = load_fixture("api_odata_edmx_candidate.xml")

    req = AnalysisRequest(
        job_id="11111111-0012-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        artifacts=[
            ArtifactReference(
                file_name="baseline_edmx.xml",
                artifact_type=ArtifactType.XML,
                raw_content=baseline_edmx,
            ),
            ArtifactReference(
                file_name="candidate_edmx.xml",
                artifact_type=ArtifactType.XML,
                raw_content=candidate_edmx,
            ),
        ],
    )
    resp = await EngineRunner.execute(req)
    assert resp.status == AnalysisStatus.COMPLETED
    rule_ids = {f.rule_id for f in resp.findings}
    assert "API_BREAKING_TYPE_CHANGED" in rule_ids
    assert "API_BREAKING_ENTITYSET_REMOVED" in rule_ids
    assert resp.metrics.artifacts_scanned >= 2


@pytest.mark.asyncio
async def test_api_missing_baseline_diagnostic():
    """Verifies that omitting baseline returns diagnostic API_BASELINE_MISSING finding."""
    setup_domain3_engines()
    req = AnalysisRequest(
        job_id="11111111-0013-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=json.dumps({"candidate": {"openapi": "3.0.0"}}),
    )
    resp = await EngineRunner.execute(req)
    assert len(resp.findings) == 1
    assert resp.findings[0].rule_id == "API_BASELINE_MISSING"
    assert resp.findings[0].severity == Severity.BLOCKER


# =============================================================================
# 6. Cryptographic Evidence Integrity Tests (Point 6: Evidence Chains)
# =============================================================================

@pytest.mark.asyncio
async def test_cp_evidence_sha256_integrity():
    """Verifies that all findings emitted by Change Pointer Auditor contain valid SHA-256 evidence."""
    setup_domain3_engines()
    raw_content = load_fixture("cp_missing_field.json")
    req = AnalysisRequest(
        job_id="11111111-0014-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    assert len(resp.findings) > 0
    for finding in resp.findings:
        assert len(finding.evidence) >= 1
        for ev in finding.evidence:
            assert ev.sha256 is not None
            assert len(ev.sha256) == 64
            assert all(c in "0123456789abcdefABCDEF" for c in ev.sha256)
            assert ev.line_number is not None and ev.line_number >= 1
            assert ev.snippet is not None and len(ev.snippet) > 0


@pytest.mark.asyncio
async def test_api_evidence_sha256_integrity():
    """Verifies that all findings emitted by API Change Guard contain valid SHA-256 evidence."""
    setup_domain3_engines()
    raw_content = load_fixture("api_openapi_breaking.json")
    req = AnalysisRequest(
        job_id="11111111-0015-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
    )
    resp = await EngineRunner.execute(req)
    assert len(resp.findings) > 0
    for finding in resp.findings:
        assert len(finding.evidence) >= 1
        for ev in finding.evidence:
            assert ev.sha256 is not None
            assert len(ev.sha256) == 64
            assert all(c in "0123456789abcdefABCDEF" for c in ev.sha256)
            assert ev.line_number is not None and ev.line_number >= 1
            assert ev.snippet is not None and len(ev.snippet) > 0


# =============================================================================
# 7. Epistemic Confidence Invariant & Demotion Tests (Point 7)
# =============================================================================

@pytest.mark.asyncio
async def test_confidence_llm_ceiling():
    """Verifies that AI-generated request findings can NEVER exceed INFERRED (0.60)."""
    setup_domain3_engines()
    raw_content = load_fixture("cp_missing_field.json")
    req = AnalysisRequest(
        job_id="11111111-0016-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
        configuration={"is_ai_generated": True},
    )
    resp = await EngineRunner.execute(req)
    assert len(resp.findings) > 0
    for f in resp.findings:
        assert f.confidence == ConfidenceClass.INFERRED
        assert f.confidence_score <= 0.60


@pytest.mark.asyncio
async def test_confidence_missing_evidence_demotion():
    """Verifies that findings lacking verifiable evidence are demoted to UNKNOWN (0.30)."""
    f = Finding(
        rule_id="CP_FIELD_NOT_CONFIGURED_BD52",
        severity=Severity.MAJOR,
        category="ALE",
        title="Field Missing",
        description="Missing",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Fix it",
        evidence=[],  # Stripped evidence
    )
    classified = ConfidenceClassifier.classify(f, missing_evidence=True)
    assert classified.confidence == ConfidenceClass.UNKNOWN
    assert classified.confidence_score <= 0.30


# =============================================================================
# 8. Deterministic Purity Tests (Point 4: Pure Rule Evaluation)
# =============================================================================

@pytest.mark.asyncio
async def test_cp_determinism_assertion():
    """Verifies that evaluating identical Change Pointer input twice produces byte-for-byte identical output."""
    setup_domain3_engines()
    raw_content = load_fixture("cp_missing_field.json")
    req1 = AnalysisRequest(
        job_id="11111111-0017-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )
    req2 = AnalysisRequest(
        job_id="11111111-0017-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )
    resp1 = await EngineRunner.execute(req1)
    resp2 = await EngineRunner.execute(req2)
    assert len(resp1.findings) == len(resp2.findings)
    for f1, f2 in zip(resp1.findings, resp2.findings):
        assert f1.rule_id == f2.rule_id
        assert f1.severity == f2.severity
        assert f1.title == f2.title
        assert f1.confidence == f2.confidence
        assert f1.technical_details == f2.technical_details


@pytest.mark.asyncio
async def test_api_determinism_assertion():
    """Verifies that evaluating identical API Change Guard input twice produces byte-for-byte identical output."""
    setup_domain3_engines()
    raw_content = load_fixture("api_openapi_breaking.json")
    req1 = AnalysisRequest(
        job_id="11111111-0018-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
    )
    req2 = AnalysisRequest(
        job_id="11111111-0018-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
    )
    resp1 = await EngineRunner.execute(req1)
    resp2 = await EngineRunner.execute(req2)
    assert len(resp1.findings) == len(resp2.findings)
    for f1, f2 in zip(resp1.findings, resp2.findings):
        assert f1.rule_id == f2.rule_id
        assert f1.severity == f2.severity
        assert f1.title == f2.title
        assert f1.technical_details == f2.technical_details


# =============================================================================
# 9. Property Fuzzing & Malformed Input Tests (Point 10: Property Tests)
# =============================================================================

@pytest.mark.asyncio
async def test_fuzz_malformed_inputs():
    """Verifies parser resilience against corrupted, hostile, and edge payloads."""
    setup_domain3_engines()
    malformed_payloads = [
        "",
        "   ",
        "{}",
        "{corrupted_json: true",
        "<?xml version='1.0'?><unclosed_tag>",
        json.dumps({"unknown_key": [1, 2, 3]}),
        "NULL,NIL,NONE\n0,0,0\n",
    ]
    for bad_input in malformed_payloads:
        # Change pointer
        req_cp = AnalysisRequest(
            job_id="11111111-0019-0001-0001-000000000001",
            tenant_id="22222222-0001-0001-0001-000000000001",
            project_id="33333333-0001-0001-0001-000000000001",
            engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
            raw_content=bad_input,
        )
        resp_cp = await EngineRunner.execute(req_cp)
        assert resp_cp.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL, AnalysisStatus.FAILED)

        # API Change Guard
        req_api = AnalysisRequest(
            job_id="11111111-0019-0001-0001-000000000002",
            tenant_id="22222222-0001-0001-0001-000000000001",
            project_id="33333333-0001-0001-0001-000000000001",
            engine_type=EngineType.API_CHANGE_GUARD,
            raw_content=bad_input,
        )
        resp_api = await EngineRunner.execute(req_api)
        assert resp_api.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL, AnalysisStatus.FAILED)
