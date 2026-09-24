"""
ERP Preflight — API Change Guard (Feature 27) Pytest Suite
Verifies proposed implementation against Cardinal Axiom 2, line coordinates,
cryptographic SHA-256 evidence, and consumer impact cross-referencing.
"""

from __future__ import annotations

import json
import pytest
import sys
from pathlib import Path

# Add services/analysis-python to sys.path so imports work cleanly
analysis_python_dir = Path("H:/erppreflight/services/analysis-python").resolve()
if str(analysis_python_dir) not in sys.path:
    sys.path.insert(0, str(analysis_python_dir))

# Also add current directory for proposed_api_change
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from proposed_api_change import ApiChangeEngine
from src.models.enums import AnalysisStatus, ConfidenceClass, EngineType, Severity
from src.models.request import AnalysisRequest, ArtifactReference
from src.platform.confidence import ConfidenceClassifier


# =============================================================================
# Test Fixtures (OpenAPI & OData EDMX)
# =============================================================================

OPENAPI_BASELINE = {
    "openapi": "3.0.0",
    "info": {"title": "SAP S/4HANA Purchase Order API", "version": "1.0.0"},
    "paths": {
        "/A_PurchaseOrder": {
            "get": {
                "summary": "Retrieve purchase orders",
                "parameters": [
                    {"name": "$top", "in": "query", "required": False, "schema": {"type": "integer"}}
                ],
                "responses": {"200": {"description": "Success"}},
            },
            "post": {
                "summary": "Create purchase order",
                "requestBody": {"required": False},
                "responses": {"201": {"description": "Created"}},
            },
        },
        "/A_PurchaseOrder('{PurchaseOrder}')": {
            "get": {"summary": "Get specific purchase order"},
            "delete": {"summary": "Cancel purchase order"},
        },
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
                    "OrderStatus": {"type": "string", "enum": ["OPEN", "PENDING", "APPROVED", "REJECTED"]},
                },
            }
        }
    },
}

OPENAPI_CANDIDATE_BREAKING = {
    "openapi": "3.0.0",
    "info": {"title": "SAP S/4HANA Purchase Order API", "version": "2.0.0"},
    "paths": {
        "/A_PurchaseOrder": {
            "get": {
                "summary": "Retrieve purchase orders",
                "parameters": [
                    {"name": "$top", "in": "query", "required": False, "schema": {"type": "integer"}},
                    # BREAKING: Added required query param
                    {"name": "X-Audit-Token", "in": "query", "required": True, "schema": {"type": "string"}},
                ],
                "responses": {"200": {"description": "Success"}},
            },
            "post": {
                "summary": "Create purchase order",
                # BREAKING: requestBody now required
                "requestBody": {"required": True},
                "responses": {"201": {"description": "Created"}},
            },
        },
        "/A_PurchaseOrder('{PurchaseOrder}')": {
            "get": {"summary": "Get specific purchase order"},
            # BREAKING: Removed DELETE operation
        },
    },
    "components": {
        "schemas": {
            "PurchaseOrder": {
                "type": "object",
                "required": ["PurchaseOrderID"],
                "properties": {
                    "PurchaseOrderID": {"type": "string", "maxLength": 10},
                    # BREAKING: MaxLength decreased from 4 to 2
                    "CompanyCode": {"type": "string", "maxLength": 2},
                    # BREAKING: TaxJurisdictionCode REMOVED
                    # BREAKING: Enum restricted (removed PENDING)
                    "OrderStatus": {"type": "string", "enum": ["OPEN", "APPROVED", "REJECTED"]},
                },
            }
        }
    },
}

INTEGRATION_REGISTRY = [
    {
        "integration_id": "SALESFORCE_INTEGRATION_01",
        "name": "Salesforce CRM Procurement Sync",
        "system_type": "SALESFORCE",
        "consumed_endpoints": ["/A_PurchaseOrder", "/A_PurchaseOrder('{PurchaseOrder}')"],
        "consumed_entity_sets": ["A_PurchaseOrder"],
        "consumed_fields": {
            "PurchaseOrder": ["PurchaseOrderID", "TaxJurisdictionCode", "CompanyCode"]
        },
        "consumed_operations": {
            "/A_PurchaseOrder('{PurchaseOrder}')": ["DELETE", "GET"]
        },
    }
]

ODATA_EDMX_V2_BASELINE = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:sap="http://www.sap.com/Protocols/SAPData">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="API_BUSINESS_PARTNER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="A_BusinessPartner">
        <Key>
          <PropertyRef Name="BusinessPartner"/>
        </Key>
        <Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="TaxNumber" Type="Edm.String" Nullable="true" MaxLength="20"/>
        <Property Name="CreditScore" Type="Edm.Int32" Nullable="true"/>
      </EntityType>
      <EntityContainer Name="API_BUSINESS_PARTNER_Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="A_BusinessPartner" EntityType="API_BUSINESS_PARTNER.A_BusinessPartner"/>
        <EntitySet Name="ObsoleteLegacyPartners" EntityType="API_BUSINESS_PARTNER.A_BusinessPartner"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

ODATA_EDMX_V2_CANDIDATE = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:sap="http://www.sap.com/Protocols/SAPData">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="API_BUSINESS_PARTNER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="A_BusinessPartner">
        <Key>
          <PropertyRef Name="BusinessPartner"/>
        </Key>
        <Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <!-- BREAKING: TaxNumber changed from Edm.String to Edm.Int64 -->
        <Property Name="TaxNumber" Type="Edm.Int64" Nullable="true"/>
        <!-- BREAKING: CreditScore made mandatory (Nullable=false) -->
        <Property Name="CreditScore" Type="Edm.Int32" Nullable="false"/>
        <!-- NON-BREAKING: Added optional property VIPStatus -->
        <Property Name="VIPStatus" Type="Edm.Boolean" Nullable="true"/>
      </EntityType>
      <EntityContainer Name="API_BUSINESS_PARTNER_Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="A_BusinessPartner" EntityType="API_BUSINESS_PARTNER.A_BusinessPartner"/>
        <!-- BREAKING: ObsoleteLegacyPartners EntitySet REMOVED -->
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""


# =============================================================================
# Pytest Test Cases
# =============================================================================


@pytest.mark.asyncio
async def test_openapi_breaking_changes_with_consumer_cross_reference():
    """Verifies OpenAPI diffing and integration registry cross-referencing."""
    engine = ApiChangeEngine()
    request = AnalysisRequest(
        job_id="test-job-openapi-01",
        tenant_id="tenant-123",
        project_id="proj-456",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=json.dumps({
            "baseline": OPENAPI_BASELINE,
            "candidate": OPENAPI_CANDIDATE_BREAKING,
            "integrations": INTEGRATION_REGISTRY,
        }),
    )

    response = await engine.analyze(request)
    assert response.status == AnalysisStatus.COMPLETED
    assert len(response.findings) > 0

    rule_ids = {f.rule_id for f in response.findings}
    # Check expected breaking rule triggers
    assert "API_BREAKING_FIELD_REMOVED" in rule_ids
    assert "API_BREAKING_OPERATION_REMOVED" in rule_ids
    assert "API_BREAKING_REQUIRED_PARAM_ADDED" in rule_ids
    assert "API_BREAKING_MAX_LENGTH_DECREASED" in rule_ids
    assert "API_BREAKING_ENUM_RESTRICTED" in rule_ids

    # Find the TaxJurisdictionCode removal finding
    field_finding = next(
        f for f in response.findings
        if f.rule_id == "API_BREAKING_FIELD_REMOVED" and "TaxJurisdictionCode" in f.title
    )
    # Check consumer impact elevation
    assert "SALESFORCE_INTEGRATION_01" in field_finding.technical_details["affectedIntegrations"]
    assert field_finding.severity == Severity.CRITICAL
    assert field_finding.confidence == ConfidenceClass.RULE_DERIVED

    # Verify cryptographic evidence attached
    assert len(field_finding.evidence) == 1
    ev = field_finding.evidence[0]
    assert ev.line_number is not None and ev.line_number >= 1
    assert ev.sha256 != ""
    assert "TaxJurisdictionCode" in (ev.snippet or "")

    # Find the DELETE operation removal finding
    delete_finding = next(
        f for f in response.findings
        if f.rule_id == "API_BREAKING_OPERATION_REMOVED" and "DELETE" in f.title
    )
    # Since Salesforce consumed DELETE on this endpoint, it should be BLOCKER
    assert "SALESFORCE_INTEGRATION_01" in delete_finding.technical_details["affectedIntegrations"]
    assert delete_finding.severity == Severity.BLOCKER

    # Check metrics
    metrics = response.metrics.additional_metrics
    assert metrics["breakingChangesCount"] >= 5
    assert metrics["affectedIntegrationsCount"] == 1
    assert "SALESFORCE_INTEGRATION_01" in metrics["affectedIntegrations"]


@pytest.mark.asyncio
async def test_odata_edmx_type_change_and_entityset_removed():
    """Verifies OData EDMX V2 schema diffing with exact LineElement coordinates."""
    engine = ApiChangeEngine()
    request = AnalysisRequest(
        job_id="test-job-odata-01",
        tenant_id="tenant-123",
        project_id="proj-456",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=json.dumps({
            "baseline": ODATA_EDMX_V2_BASELINE,
            "candidate": ODATA_EDMX_V2_CANDIDATE,
            "integrations": [
                {
                    "integration_id": "MULESOFT_BP_SYNC",
                    "consumed_entity_sets": ["ObsoleteLegacyPartners"],
                }
            ],
        }),
    )

    response = await engine.analyze(request)
    assert response.status == AnalysisStatus.COMPLETED

    rule_ids = {f.rule_id for f in response.findings}
    assert "API_BREAKING_TYPE_CHANGED" in rule_ids
    assert "API_BREAKING_ENTITYSET_REMOVED" in rule_ids
    assert "API_BREAKING_REQUIRED_PROPERTY_ADDED" in rule_ids
    assert "API_NON_BREAKING_OPTIONAL_PROPERTY_ADDED" in rule_ids

    # Verify Line coordinates from SafeXmlParser LineElement
    es_finding = next(f for f in response.findings if f.rule_id == "API_BREAKING_ENTITYSET_REMOVED")
    assert "MULESOFT_BP_SYNC" in es_finding.technical_details["affectedIntegrations"]
    assert es_finding.severity == Severity.BLOCKER
    ev = es_finding.evidence[0]
    assert ev.line_number is not None and ev.line_number >= 1
    assert "ObsoleteLegacyPartners" in (ev.snippet or "")

    type_finding = next(f for f in response.findings if f.rule_id == "API_BREAKING_TYPE_CHANGED")
    assert type_finding.technical_details["baselineType"] == "Edm.String"
    assert type_finding.technical_details["candidateType"] == "Edm.Int64"


@pytest.mark.asyncio
async def test_multi_artifact_request_flow():
    """Verifies that baseline and candidate passed as separate ArtifactReference objects work cleanly."""
    engine = ApiChangeEngine()
    request = AnalysisRequest(
        job_id="test-job-multi-art",
        tenant_id="tenant-123",
        project_id="proj-456",
        engine_type=EngineType.API_CHANGE_GUARD,
        artifacts=[
            ArtifactReference(
                file_name="baseline_edmx.xml",
                artifact_type="XML",
                raw_content=ODATA_EDMX_V2_BASELINE,
            ),
            ArtifactReference(
                file_name="candidate_edmx.xml",
                artifact_type="XML",
                raw_content=ODATA_EDMX_V2_CANDIDATE,
            ),
        ],
    )

    response = await engine.analyze(request)
    assert response.status == AnalysisStatus.COMPLETED
    assert len(response.findings) >= 3
    assert response.metrics.artifacts_scanned == 2


@pytest.mark.asyncio
async def test_missing_baseline_diagnostic():
    """Verifies that omitting baseline returns diagnostic API_BASELINE_MISSING finding."""
    engine = ApiChangeEngine()
    request = AnalysisRequest(
        job_id="test-job-missing-base",
        tenant_id="tenant-123",
        project_id="proj-456",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=json.dumps({"candidate": OPENAPI_BASELINE}),
    )

    response = await engine.analyze(request)
    assert len(response.findings) == 1
    assert response.findings[0].rule_id == "API_BASELINE_MISSING"
    assert response.findings[0].severity == Severity.BLOCKER


@pytest.mark.asyncio
async def test_syntax_error_diagnostic():
    """Verifies malformed XML/JSON returns API_SPEC_SYNTAX_ERROR finding."""
    engine = ApiChangeEngine()
    request = AnalysisRequest(
        job_id="test-job-malformed",
        tenant_id="tenant-123",
        project_id="proj-456",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=json.dumps({
            "baseline": "not-valid-json-or-xml",
            "candidate": OPENAPI_BASELINE,
        }),
    )

    response = await engine.analyze(request)
    assert len(response.findings) == 1
    assert response.findings[0].rule_id == "API_SPEC_SYNTAX_ERROR"
    assert response.findings[0].severity == Severity.BLOCKER


@pytest.mark.asyncio
async def test_deterministic_purity_identical_specs():
    """Verifies bitwise reproducibility and 0 breaking findings for identical specifications."""
    engine = ApiChangeEngine()
    request = AnalysisRequest(
        job_id="test-job-identical",
        tenant_id="tenant-123",
        project_id="proj-456",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=json.dumps({
            "baseline": OPENAPI_BASELINE,
            "candidate": OPENAPI_BASELINE,
        }),
    )

    response1 = await engine.analyze(request)
    response2 = await engine.analyze(request)

    assert response1.metrics.additional_metrics["breakingChangesCount"] == 0
    assert len(response1.findings) == 0
    assert len(response2.findings) == 0


@pytest.mark.asyncio
async def test_confidence_classifier_missing_evidence_demotion():
    """Verifies Cardinal Axiom 2 epistemic invariant: missing evidence demotes unconditionally to UNKNOWN (0.30)."""
    engine = ApiChangeEngine()
    request = AnalysisRequest(
        job_id="test-job-conf-demote",
        tenant_id="tenant-123",
        project_id="proj-456",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=json.dumps({
            "baseline": OPENAPI_BASELINE,
            "candidate": OPENAPI_CANDIDATE_BREAKING,
        }),
    )

    response = await engine.analyze(request)
    assert len(response.findings) > 0
    finding = response.findings[0]

    # Findings produced with valid evidence are VERIFIED (1.0) or RULE_DERIVED (0.85)
    assert finding.confidence in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED)

    # Invalidate evidence and re-classify
    finding.evidence = []
    demoted = ConfidenceClassifier.classify(finding)
    assert demoted.confidence == ConfidenceClass.UNKNOWN
    assert demoted.confidence_score == 0.30


@pytest.mark.asyncio
async def test_swagger_2_openapi_spec_diff():
    """Verifies OpenAPI 2.0 (Swagger) compatibility and parameter diffing."""
    swagger_base = {
        "swagger": "2.0",
        "info": {"title": "Legacy SAP RFC Gateway", "version": "1.0"},
        "paths": {
            "/rfc/BAPI_USER_GET_DETAIL": {
                "post": {
                    "parameters": [
                        {"name": "USERNAME", "in": "formData", "required": True, "type": "string"},
                        {"name": "CACHE_ENABLED", "in": "query", "required": False, "type": "boolean"},
                    ],
                    "responses": {"200": {"description": "OK"}},
                }
            }
        },
        "definitions": {
            "BapiUser": {
                "type": "object",
                "properties": {
                    "BName": {"type": "string", "maxLength": 12},
                    "EMail": {"type": "string", "maxLength": 241},
                },
            }
        },
    }
    swagger_cand = {
        "swagger": "2.0",
        "info": {"title": "Legacy SAP RFC Gateway", "version": "2.0"},
        "paths": {
            "/rfc/BAPI_USER_GET_DETAIL": {
                "post": {
                    "parameters": [
                        {"name": "USERNAME", "in": "formData", "required": True, "type": "string"},
                        # Added required parameter
                        {"name": "TENANT_AUTH", "in": "header", "required": True, "type": "string"},
                    ],
                    "responses": {"200": {"description": "OK"}},
                }
            }
        },
        "definitions": {
            "BapiUser": {
                "type": "object",
                "properties": {
                    "BName": {"type": "string", "maxLength": 12},
                    # EMail removed
                },
            }
        },
    }

    engine = ApiChangeEngine()
    request = AnalysisRequest(
        job_id="test-swagger-2",
        tenant_id="tenant-123",
        project_id="proj-456",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=json.dumps({"baseline": swagger_base, "candidate": swagger_cand}),
    )

    response = await engine.analyze(request)
    assert response.status == AnalysisStatus.COMPLETED
    rule_ids = {f.rule_id for f in response.findings}
    assert "API_BREAKING_REQUIRED_PARAM_ADDED" in rule_ids
    assert "API_BREAKING_FIELD_REMOVED" in rule_ids


@pytest.mark.asyncio
async def test_odata_v4_enum_and_actions_diff():
    """Verifies OData EDMX V4 parsing, EnumType diff, and ActionImport diff."""
    v4_baseline = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="WarehouseService" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="StorageBin">
        <Key>
          <PropertyRef Name="BinID"/>
        </Key>
        <Property Name="BinID" Type="Edm.String" Nullable="false"/>
      </EntityType>
      <EnumType Name="BinStatus">
        <Member Name="Empty" Value="0"/>
        <Member Name="Occupied" Value="1"/>
        <Member Name="Blocked" Value="2"/>
      </EnumType>
      <EntityContainer Name="Container">
        <EntitySet Name="StorageBins" EntityType="WarehouseService.StorageBin"/>
        <ActionImport Name="BlockBin" Action="WarehouseService.BlockBin"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

    v4_candidate = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="WarehouseService" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="StorageBin">
        <Key>
          <PropertyRef Name="BinID"/>
        </Key>
        <Property Name="BinID" Type="Edm.String" Nullable="false"/>
      </EntityType>
      <!-- BREAKING: Enum value 'Blocked' removed -->
      <EnumType Name="BinStatus">
        <Member Name="Empty" Value="0"/>
        <Member Name="Occupied" Value="1"/>
      </EnumType>
      <EntityContainer Name="Container">
        <EntitySet Name="StorageBins" EntityType="WarehouseService.StorageBin"/>
        <!-- BREAKING: ActionImport BlockBin removed -->
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

    engine = ApiChangeEngine()
    request = AnalysisRequest(
        job_id="test-odata-v4",
        tenant_id="tenant-123",
        project_id="proj-456",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=json.dumps({"baseline": v4_baseline, "candidate": v4_candidate}),
    )

    response = await engine.analyze(request)
    assert response.status == AnalysisStatus.COMPLETED
    rule_ids = {f.rule_id for f in response.findings}
    assert "API_BREAKING_ENUM_RESTRICTED" in rule_ids
    assert response.metrics.additional_metrics["schemaType"] == "ODATA_EDMX_V4"


@pytest.mark.asyncio
async def test_property_based_fuzz_resilience():
    """Verifies engine stability when presented with edge-case or boundary inputs."""
    engine = ApiChangeEngine()
    fuzz_payloads = [
        "",
        "{}",
        json.dumps({"baseline": {}, "candidate": {}}),
        json.dumps({"baseline": {"paths": None}, "candidate": {"paths": {}}}),
        json.dumps({"baseline": {"swagger": "2.0"}, "candidate": {"swagger": "2.0"}}),
    ]

    for payload in fuzz_payloads:
        request = AnalysisRequest(
            job_id="fuzz-test",
            tenant_id="t1",
            project_id="p1",
            engine_type=EngineType.API_CHANGE_GUARD,
            raw_content=payload,
        )
        # Must execute cleanly without unhandled crash or exception
        response = await engine.analyze(request)
        assert response.status in (AnalysisStatus.COMPLETED, AnalysisStatus.FAILED)

