"""
Adversarial Empirical Stress Test Suite: API Change Guard Engine (api_change.py)
Agent: m3_d3_challenger_2
Mission: Empirically stress-test API Change Guard against OpenAPI 2.0/3.0 breaking/non-breaking changes,
         OData EDMX V2/V4 breaking entity/property changes, consumer registry field impacts,
         malformed specs / XXE resilience, large schemas, bitwise determinism and SHA-256 evidence.

Governing Standards:
- AGENTS.md: Cardinal Axiom 2 (14-Point Engine Anatomy, Epistemic Confidence, Evidence Chains)
- .agents/skills/sap-evidence.md: Confidence hierarchy (VERIFIED=1.0, RULE_DERIVED=0.85, INFERRED=0.60, UNKNOWN=0.30)
- .agents/skills/engine-authoring.md: Deterministic rules, pure engine logic, boundary assertions
- .agents/skills/secure-file-parser.md: XXE defense, safe parsing, fail-closed handling

Test Execution:
  py -3.13 -m pytest .agents/m3_d3_challenger_2/test_adversarial_api_change.py -v
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import pytest

# Ensure repository analysis-python service is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ANALYSIS_PYTHON_DIR = REPO_ROOT / "services" / "analysis-python"
if str(ANALYSIS_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(ANALYSIS_PYTHON_DIR))

# Ensure all engines are loaded and registered
import src.engines  # noqa: F401, E402
from src.engines.api_change import (  # noqa: E402
    ApiChangeEngine,
    ClientIntegration,
)
from src.core.runner import EngineRunner  # noqa: E402
from src.models.enums import (  # noqa: E402
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
    TrustLevel,
)
from src.models.finding import Finding  # noqa: E402
from src.models.request import AnalysisRequest, ArtifactReference  # noqa: E402
from src.models.response import AnalysisResponse  # noqa: E402
from src.parsers.safe_xml import SafeXmlParser  # noqa: E402
from src.platform.confidence import ConfidenceClassifier  # noqa: E402


# ==============================================================================
# Helper Factories for Test Artifacts
# ==============================================================================

def make_request(
    raw_content: str | None = None,
    configuration: Dict[str, Any] | None = None,
    artifacts: List[ArtifactReference] | None = None,
    job_id: str = "11111111-d302-0001-0001-000000000001",
) -> AnalysisRequest:
    return AnalysisRequest(
        job_id=job_id,
        tenant_id="22222222-d302-0001-0001-000000000001",
        project_id="33333333-d302-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        raw_content=raw_content,
        configuration=configuration or {},
        artifacts=artifacts or [],
    )


# ==============================================================================
# 1. Dimension 1: OpenAPI 2.0 & 3.0 Breaking vs Non-Breaking Changes
# ==============================================================================

class TestOpenApiBreakingVsNonBreaking:
    """Adversarial challenge for OpenAPI 2.0 (Swagger) and 3.0 lifecycle mutations."""

    @pytest.mark.asyncio
    async def test_openapi_endpoint_removed_triggers_breaking(self):
        """Verifies removing an API route triggers API_BREAKING_ENDPOINT_REMOVED (CRITICAL)."""
        baseline = {
            "openapi": "3.0.0",
            "info": {"title": "Billing API", "version": "1.0"},
            "paths": {
                "/invoices": {"get": {"summary": "List invoices"}},
                "/invoices/{id}/void": {"post": {"summary": "Void invoice"}},
            },
        }
        candidate = {
            "openapi": "3.0.0",
            "info": {"title": "Billing API", "version": "2.0"},
            "paths": {
                "/invoices": {"get": {"summary": "List invoices"}},
                # /invoices/{id}/void was removed
            },
        }
        bundle = {"baseline": baseline, "candidate": candidate}
        req = make_request(raw_content=json.dumps(bundle))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        findings = [f for f in resp.findings if f.rule_id == "API_BREAKING_ENDPOINT_REMOVED"]
        assert len(findings) == 1
        f = findings[0]
        assert f.severity == Severity.CRITICAL
        assert "/invoices/{id}/void" in f.title
        assert f.confidence == ConfidenceClass.VERIFIED
        assert f.confidence_score == 1.0

    @pytest.mark.asyncio
    async def test_openapi_operation_removed_from_existing_endpoint(self):
        """Verifies removing DELETE while keeping GET triggers API_BREAKING_OPERATION_REMOVED."""
        baseline = {
            "openapi": "3.0.0",
            "info": {"title": "Customer API", "version": "1.0"},
            "paths": {
                "/customers/{id}": {
                    "get": {"summary": "Read customer"},
                    "delete": {"summary": "Delete customer"},
                }
            },
        }
        candidate = {
            "openapi": "3.0.0",
            "info": {"title": "Customer API", "version": "2.0"},
            "paths": {
                "/customers/{id}": {
                    "get": {"summary": "Read customer"}
                    # delete removed
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": baseline, "candidate": candidate}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        op_removed = [f for f in resp.findings if f.rule_id == "API_BREAKING_OPERATION_REMOVED"]
        assert len(op_removed) == 1
        assert "DELETE" in op_removed[0].title
        assert op_removed[0].severity == Severity.CRITICAL

    @pytest.mark.asyncio
    async def test_openapi_operation_deprecated_warning(self):
        """Verifies deprecating an operation in OpenAPI triggers API_DEPRECATION_WARNING (INFO)."""
        baseline = {
            "openapi": "3.0.0",
            "info": {"title": "Legacy API", "version": "1.0"},
            "paths": {"/orders": {"get": {"deprecated": False}}},
        }
        candidate = {
            "openapi": "3.0.0",
            "info": {"title": "Legacy API", "version": "1.1"},
            "paths": {"/orders": {"get": {"deprecated": True}}},
        }
        req = make_request(raw_content=json.dumps({"baseline": baseline, "candidate": candidate}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        dep_findings = [f for f in resp.findings if f.rule_id == "API_DEPRECATION_WARNING"]
        assert len(dep_findings) == 1
        assert "GET /orders" in dep_findings[0].title
        assert dep_findings[0].severity == Severity.INFO

    @pytest.mark.asyncio
    async def test_openapi_required_param_added_is_breaking_but_optional_is_not(self):
        """Verifies adding a REQUIRED query param triggers breaking finding, whereas OPTIONAL param does not."""
        baseline = {
            "openapi": "3.0.0",
            "info": {"title": "Search API", "version": "1.0"},
            "paths": {
                "/items": {
                    "get": {
                        "parameters": [
                            {"name": "query", "in": "query", "required": False, "type": "string"}
                        ]
                    }
                }
            },
        }
        # Candidate A: Adds REQUIRED header param 'X-Tenant-Auth'
        candidate_breaking = {
            "openapi": "3.0.0",
            "info": {"title": "Search API", "version": "1.1"},
            "paths": {
                "/items": {
                    "get": {
                        "parameters": [
                            {"name": "query", "in": "query", "required": False, "type": "string"},
                            {"name": "X-Tenant-Auth", "in": "header", "required": True, "type": "string"},
                        ]
                    }
                }
            },
        }
        req_break = make_request(raw_content=json.dumps({"baseline": baseline, "candidate": candidate_breaking}))
        resp_break = await EngineRunner.execute(req_break)
        assert resp_break.status == AnalysisStatus.COMPLETED
        param_break = [f for f in resp_break.findings if f.rule_id == "API_BREAKING_REQUIRED_PARAM_ADDED"]
        assert len(param_break) == 1
        assert param_break[0].technical_details.get("parameter") == "X-Tenant-Auth"
        assert "X-Tenant-Auth" in param_break[0].description
        assert "GET /items:X-Tenant-Auth" in param_break[0].affected_objects
        assert param_break[0].severity == Severity.MAJOR

        # Candidate B: Adds OPTIONAL header param 'X-Trace-ID'
        candidate_clean = {
            "openapi": "3.0.0",
            "info": {"title": "Search API", "version": "1.1"},
            "paths": {
                "/items": {
                    "get": {
                        "parameters": [
                            {"name": "query", "in": "query", "required": False, "type": "string"},
                            {"name": "X-Trace-ID", "in": "header", "required": False, "type": "string"},
                        ]
                    }
                }
            },
        }
        req_clean = make_request(raw_content=json.dumps({"baseline": baseline, "candidate": candidate_clean}))
        resp_clean = await EngineRunner.execute(req_clean)
        assert resp_clean.status == AnalysisStatus.COMPLETED
        breaking_ids = [f.rule_id for f in resp_clean.findings if "BREAKING" in f.rule_id]
        assert len(breaking_ids) == 0

    @pytest.mark.asyncio
    async def test_openapi_swagger2_definitions_schema_breaking(self):
        """Verifies OpenAPI 2.0 (Swagger) 'definitions' section property removals and type changes."""
        swagger2_base = {
            "swagger": "2.0",
            "info": {"title": "Legacy Partner API", "version": "1.0"},
            "paths": {"/partners": {"get": {}}},
            "definitions": {
                "Partner": {
                    "type": "object",
                    "properties": {
                        "partnerId": {"type": "string", "maxLength": 10},
                        "rating": {"type": "integer"},
                        "isBlocked": {"type": "boolean"},
                    },
                }
            },
        }
        swagger2_cand = {
            "swagger": "2.0",
            "info": {"title": "Legacy Partner API", "version": "2.0"},
            "paths": {"/partners": {"get": {}}},
            "definitions": {
                "Partner": {
                    "type": "object",
                    "properties": {
                        # partnerId removed!
                        # rating type mutated to boolean!
                        "rating": {"type": "boolean"},
                        "isBlocked": {"type": "boolean"},
                    },
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": swagger2_base, "candidate": swagger2_cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        rule_ids = {f.rule_id for f in resp.findings}
        assert "API_BREAKING_FIELD_REMOVED" in rule_ids
        assert "API_BREAKING_TYPE_CHANGED" in rule_ids

    @pytest.mark.asyncio
    async def test_openapi_max_length_decreased_vs_increased(self):
        """Verifies decreasing MaxLength is BREAKING (MAJOR), but increasing MaxLength is NON-BREAKING (INFO)."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "Doc API", "version": "1.0"},
            "paths": {},
            "components": {
                "schemas": {
                    "Doc": {
                        "type": "object",
                        "properties": {
                            "shortDesc": {"type": "string", "maxLength": 100},
                            "longDesc": {"type": "string", "maxLength": 500},
                        },
                    }
                }
            },
        }
        # shortDesc decreased to 50 (breaking); longDesc increased to 1000 (non-breaking)
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "Doc API", "version": "1.1"},
            "paths": {},
            "components": {
                "schemas": {
                    "Doc": {
                        "type": "object",
                        "properties": {
                            "shortDesc": {"type": "string", "maxLength": 50},
                            "longDesc": {"type": "string", "maxLength": 1000},
                        },
                    }
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        decreased = next(f for f in resp.findings if f.rule_id == "API_BREAKING_MAX_LENGTH_DECREASED")
        assert decreased.severity == Severity.MAJOR
        assert "shortDesc" in decreased.title

        increased = next(f for f in resp.findings if f.rule_id == "API_NON_BREAKING_MAX_LENGTH_INCREASED")
        assert increased.severity == Severity.INFO
        assert "longDesc" in increased.title

    @pytest.mark.asyncio
    async def test_openapi_new_mandatory_property_added_is_breaking(self):
        """Verifies adding a required (non-nullable) property to an existing entity is BREAKING."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "Order API", "version": "1.0"},
            "paths": {},
            "components": {
                "schemas": {
                    "Order": {
                        "type": "object",
                        "properties": {
                            "orderId": {"type": "string"},
                        },
                    }
                }
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "Order API", "version": "1.1"},
            "paths": {},
            "components": {
                "schemas": {
                    "Order": {
                        "type": "object",
                        "required": ["mandatoryTaxCode"],
                        "properties": {
                            "orderId": {"type": "string"},
                            "mandatoryTaxCode": {"type": "string", "nullable": False},
                        },
                    }
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        added_mand = next(f for f in resp.findings if f.rule_id == "API_BREAKING_REQUIRED_PROPERTY_ADDED")
        assert added_mand.severity == Severity.MAJOR
        assert "mandatoryTaxCode" in added_mand.title


# ==============================================================================
# 2. Dimension 2: OData EDMX V2 & V4 Breaking Changes
# ==============================================================================

class TestODataEdmxV2V4Breaking:
    """Adversarial challenge for OData EDMX V2 & V4 metadata parsing and diffing."""

    @pytest.mark.asyncio
    async def test_odata_edmx_v2_entityset_and_property_removal(self):
        """Verifies removing EntitySet and Property in EDMX V2 triggers appropriate breaking findings."""
        baseline_xml = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="API_SALES_ORDER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="A_SalesOrder">
        <Key><PropertyRef Name="SalesOrder"/></Key>
        <Property Name="SalesOrder" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="TotalNetAmount" Type="Edm.Decimal" Nullable="true" Precision="15" Scale="2"/>
        <Property Name="ObsoleteField" Type="Edm.String" Nullable="true"/>
      </EntityType>
      <EntityContainer Name="Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="A_SalesOrder" EntityType="API_SALES_ORDER.A_SalesOrder"/>
        <EntitySet Name="LegacySalesOrderSet" EntityType="API_SALES_ORDER.A_SalesOrder"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        candidate_xml = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="API_SALES_ORDER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="A_SalesOrder">
        <Key><PropertyRef Name="SalesOrder"/></Key>
        <Property Name="SalesOrder" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="TotalNetAmount" Type="Edm.Decimal" Nullable="true" Precision="15" Scale="2"/>
        <!-- ObsoleteField removed -->
      </EntityType>
      <EntityContainer Name="Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="A_SalesOrder" EntityType="API_SALES_ORDER.A_SalesOrder"/>
        <!-- LegacySalesOrderSet removed -->
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        req = make_request(
            artifacts=[
                ArtifactReference(file_name="baseline.edmx", artifact_type=ArtifactType.EDMX, raw_content=baseline_xml),
                ArtifactReference(file_name="candidate.edmx", artifact_type=ArtifactType.EDMX, raw_content=candidate_xml),
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        rule_ids = {f.rule_id for f in resp.findings}
        assert "API_BREAKING_ENTITYSET_REMOVED" in rule_ids
        assert "API_BREAKING_FIELD_REMOVED" in rule_ids

        es_finding = next(f for f in resp.findings if f.rule_id == "API_BREAKING_ENTITYSET_REMOVED")
        assert "LegacySalesOrderSet" in es_finding.title
        assert es_finding.severity == Severity.CRITICAL

        f_finding = next(f for f in resp.findings if f.rule_id == "API_BREAKING_FIELD_REMOVED")
        assert "ObsoleteField" in f_finding.title
        assert f_finding.severity == Severity.MAJOR

    @pytest.mark.asyncio
    async def test_odata_edmx_v4_enum_restriction_and_type_narrowing(self):
        """Verifies OData V4 EnumType member removal and Edm.Int64 -> Edm.Int32 narrowing."""
        base_v4 = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="com.sap.gateway.zsample" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="WarehouseItem">
        <Key><PropertyRef Name="ItemKey"/></Key>
        <Property Name="ItemKey" Type="Edm.String" Nullable="false"/>
        <Property Name="StockQuantity" Type="Edm.Int64" Nullable="false"/>
      </EntityType>
      <EnumType Name="HandlingUnitStatus">
        <Member Name="PLANNED"/>
        <Member Name="STAGED"/>
        <Member Name="LOADED"/>
      </EnumType>
      <EntityContainer Name="Container">
        <EntitySet Name="WarehouseItems" EntityType="com.sap.gateway.zsample.WarehouseItem"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        # In candidate: StockQuantity narrowed to Edm.Int32, and HandlingUnitStatus drops 'PLANNED'
        cand_v4 = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="com.sap.gateway.zsample" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="WarehouseItem">
        <Key><PropertyRef Name="ItemKey"/></Key>
        <Property Name="ItemKey" Type="Edm.String" Nullable="false"/>
        <Property Name="StockQuantity" Type="Edm.Int32" Nullable="false"/>
      </EntityType>
      <EnumType Name="HandlingUnitStatus">
        <Member Name="STAGED"/>
        <Member Name="LOADED"/>
      </EnumType>
      <EntityContainer Name="Container">
        <EntitySet Name="WarehouseItems" EntityType="com.sap.gateway.zsample.WarehouseItem"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        req = make_request(
            artifacts=[
                ArtifactReference(file_name="baseline_v4.xml", artifact_type=ArtifactType.XML, raw_content=base_v4),
                ArtifactReference(file_name="candidate_v4.xml", artifact_type=ArtifactType.XML, raw_content=cand_v4),
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        rule_ids = {f.rule_id for f in resp.findings}
        assert "API_BREAKING_TYPE_CHANGED" in rule_ids
        assert "API_BREAKING_ENUM_RESTRICTED" in rule_ids

        enum_f = next(f for f in resp.findings if f.rule_id == "API_BREAKING_ENUM_RESTRICTED")
        assert "HandlingUnitStatus" in enum_f.title
        assert enum_f.severity == Severity.CRITICAL

        type_f = next(f for f in resp.findings if f.rule_id == "API_BREAKING_TYPE_CHANGED")
        assert "StockQuantity" in type_f.title
        assert type_f.technical_details.get("baselineType") == "Edm.Int64"
        assert type_f.technical_details.get("candidateType") == "Edm.Int32"


# ==============================================================================
# 3. Dimension 3: Consumer Integration Registry Impact & Epistemic Escalation
# ==============================================================================

class TestConsumerRegistryImpact:
    """Adversarial stress testing of ClientIntegration cross-referencing and severity escalation."""

    @pytest.mark.asyncio
    async def test_consumer_impact_escalates_severity_and_assigns_rule_derived(self):
        """Verifies that registered consumer matches escalate severity to BLOCKER/CRITICAL and set RULE_DERIVED (0.85)."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "PO API", "version": "1.0"},
            "paths": {
                "/A_PurchaseOrder": {
                    "get": {},
                    "delete": {},
                }
            },
            "components": {
                "schemas": {
                    "PurchaseOrder": {
                        "type": "object",
                        "properties": {
                            "PurchaseOrderID": {"type": "string"},
                            "TaxJurisdictionCode": {"type": "string"},
                            "CompanyCode": {"type": "string"},
                        },
                    }
                }
            },
        }
        # In candidate: /A_PurchaseOrder DELETE is removed, TaxJurisdictionCode is removed
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "PO API", "version": "2.0"},
            "paths": {
                "/A_PurchaseOrder": {
                    "get": {},
                }
            },
            "components": {
                "schemas": {
                    "PurchaseOrder": {
                        "type": "object",
                        "properties": {
                            "PurchaseOrderID": {"type": "string"},
                            "CompanyCode": {"type": "string"},
                        },
                    }
                }
            },
        }
        integrations = [
            {
                "integration_id": "MULESOFT_ESB_GLOBAL",
                "name": "MuleSoft ESB Enterprise Bus",
                "system_type": "MULESOFT",
                "consumed_endpoints": ["/A_PurchaseOrder"],
                "consumed_fields": {"PurchaseOrder": ["TaxJurisdictionCode"]},
                "consumed_operations": {"/A_PurchaseOrder": ["DELETE"]},
            }
        ]

        payload = {"baseline": base, "candidate": cand, "integrations": integrations}
        req = make_request(raw_content=json.dumps(payload))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        # 1. Operation Removed: escalated from CRITICAL to BLOCKER
        op_finding = next(f for f in resp.findings if f.rule_id == "API_BREAKING_OPERATION_REMOVED")
        assert op_finding.severity == Severity.BLOCKER
        assert "MULESOFT_ESB_GLOBAL" in op_finding.affected_objects
        assert op_finding.confidence == ConfidenceClass.RULE_DERIVED
        assert op_finding.confidence_score == 0.85

        # 2. Field Removed: escalated from MAJOR to CRITICAL
        field_finding = next(f for f in resp.findings if f.rule_id == "API_BREAKING_FIELD_REMOVED")
        assert field_finding.severity == Severity.CRITICAL
        assert "MULESOFT_ESB_GLOBAL" in field_finding.affected_objects
        assert field_finding.confidence == ConfidenceClass.RULE_DERIVED
        assert field_finding.confidence_score == 0.85

        # 3. Metrics verification
        metrics = resp.metrics.additional_metrics
        assert metrics["affectedIntegrationsCount"] == 1
        assert "MULESOFT_ESB_GLOBAL" in metrics["affectedIntegrations"]

    @pytest.mark.asyncio
    async def test_unregistered_consumers_retain_verified_confidence(self):
        """Verifies that changes on unconsumed endpoints retain VERIFIED (1.0) confidence."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "Internal API", "version": "1.0"},
            "paths": {"/internal/metrics": {"get": {}}},
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "Internal API", "version": "2.0"},
            "paths": {},
        }
        # Integration only consumes /external/orders, NOT /internal/metrics
        integrations = [
            {
                "integration_id": "PARTNER_PORTAL",
                "consumed_endpoints": ["/external/orders"],
            }
        ]
        payload = {"baseline": base, "candidate": cand, "integrations": integrations}
        req = make_request(raw_content=json.dumps(payload))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        finding = resp.findings[0]
        assert finding.rule_id == "API_BREAKING_ENDPOINT_REMOVED"
        assert finding.severity == Severity.CRITICAL  # Not escalated to BLOCKER
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert finding.confidence_score == 1.0
        assert len(finding.technical_details.get("affectedIntegrations", [])) == 0

    @pytest.mark.asyncio
    async def test_wildcard_field_consumption_impact(self):
        """Verifies that '*' in consumed_fields matches any removed field on that entity."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "Material API", "version": "1.0"},
            "paths": {},
            "components": {
                "schemas": {
                    "Material": {
                        "type": "object",
                        "properties": {
                            "MaterialNumber": {"type": "string"},
                            "GrossWeight": {"type": "number"},
                        },
                    }
                }
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "Material API", "version": "2.0"},
            "paths": {},
            "components": {
                "schemas": {
                    "Material": {
                        "type": "object",
                        "properties": {
                            "MaterialNumber": {"type": "string"}
                            # GrossWeight removed
                        },
                    }
                }
            },
        }
        integrations = [
            {
                "integration_id": "WMS_BLUEYONDER",
                "consumed_fields": {"Material": ["*"]},
            }
        ]
        payload = {"baseline": base, "candidate": cand, "integrations": integrations}
        req = make_request(raw_content=json.dumps(payload))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        f = next(f for f in resp.findings if f.rule_id == "API_BREAKING_FIELD_REMOVED")
        assert f.severity == Severity.CRITICAL
        assert "WMS_BLUEYONDER" in f.technical_details.get("affectedIntegrations", [])


# ==============================================================================
# 4. Dimension 4: Boundary & Non-Breaking Precision
# ==============================================================================

class TestBoundaryAndNonBreakingPrecision:
    """Stress tests verifying that valid API evolution is not falsely flagged as breaking."""

    @pytest.mark.asyncio
    async def test_pure_non_breaking_additions_produce_zero_breaking_findings(self):
        """Verifies adding optional fields, new endpoints, and new operations produces 0 breaking changes."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "Catalog API", "version": "1.0"},
            "paths": {
                "/products": {
                    "get": {
                        "parameters": [
                            {"name": "category", "in": "query", "required": False, "type": "string"}
                        ]
                    }
                }
            },
            "components": {
                "schemas": {
                    "Product": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "name": {"type": "string"},
                        },
                    }
                }
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "Catalog API", "version": "1.1"},
            "paths": {
                "/products": {
                    "get": {
                        "parameters": [
                            {"name": "category", "in": "query", "required": False, "type": "string"}
                        ]
                    },
                    "post": {"summary": "New create product operation"},  # Non-breaking
                },
                "/categories": {"get": {"summary": "New categories endpoint"}},  # Non-breaking
            },
            "components": {
                "schemas": {
                    "Product": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "name": {"type": "string"},
                            "description": {"type": "string", "nullable": True},  # Non-breaking optional
                        },
                    }
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        breaking = [f for f in resp.findings if "BREAKING" in f.rule_id and "NON_BREAKING" not in f.rule_id]
        assert len(breaking) == 0

        # Non-breaking should be marked INFO
        non_breaking = [f for f in resp.findings if "NON_BREAKING" in f.rule_id]
        assert len(non_breaking) >= 3
        for nb in non_breaking:
            assert nb.severity == Severity.INFO

        assert resp.metrics.additional_metrics["breakingChangesCount"] == 0

    @pytest.mark.asyncio
    async def test_identical_specifications_produce_zero_findings(self):
        """Verifies comparing an API specification against itself produces 0 findings."""
        spec = {
            "openapi": "3.0.0",
            "info": {"title": "Identical API", "version": "1.0"},
            "paths": {"/health": {"get": {}}},
            "components": {
                "schemas": {"Health": {"type": "object", "properties": {"status": {"type": "string"}}}}
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": spec, "candidate": spec}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert len(resp.findings) == 0
        assert resp.metrics.additional_metrics["breakingChangesCount"] == 0
        assert resp.metrics.additional_metrics["nonBreakingChangesCount"] == 0

    @pytest.mark.asyncio
    async def test_yaml_specification_parsing(self):
        """Verifies API specifications formatted in YAML parse accurately."""
        yaml_base = """
openapi: 3.0.0
info:
  title: YAML Customer API
  version: 1.0.0
paths:
  /customers:
    get:
      summary: List customers
components:
  schemas:
    Customer:
      type: object
      properties:
        customerId:
          type: string
        creditLimit:
          type: integer
"""
        yaml_cand = """
openapi: 3.0.0
info:
  title: YAML Customer API
  version: 2.0.0
paths:
  /customers:
    get:
      summary: List customers
components:
  schemas:
    Customer:
      type: object
      properties:
        customerId:
          type: string
        # creditLimit removed!
"""
        req = make_request(
            artifacts=[
                ArtifactReference(file_name="baseline.yaml", artifact_type=ArtifactType.TXT, raw_content=yaml_base),
                ArtifactReference(file_name="candidate.yaml", artifact_type=ArtifactType.TXT, raw_content=yaml_cand),
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert any(f.rule_id == "API_BREAKING_FIELD_REMOVED" and "creditLimit" in f.title for f in resp.findings)


# ==============================================================================
# 5. Dimension 5: Malformed Payloads & Security / XXE Resilience
# ==============================================================================

class TestMalformedAndSecurityResilience:
    """Adversarial challenge for hostile XML (XXE), corrupt JSON, and missing inputs."""

    @pytest.mark.asyncio
    async def test_xxe_payload_is_rejected_safely(self):
        """Verifies that an XXE injection attempt in EDMX XML is blocked without exception leak."""
        xxe_malicious_xml = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE edmx [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices>
    <Schema Namespace="API_ATTACK" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="Exploit">
        <Property Name="Secret" Type="Edm.String" DefaultValue="&xxe;"/>
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        clean_xml = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices>
    <Schema Namespace="API_ATTACK" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="Exploit"/>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        req = make_request(
            artifacts=[
                ArtifactReference(file_name="baseline_xxe.xml", artifact_type=ArtifactType.XML, raw_content=xxe_malicious_xml),
                ArtifactReference(file_name="candidate.xml", artifact_type=ArtifactType.XML, raw_content=clean_xml),
            ]
        )
        resp = await EngineRunner.execute(req)
        # Engine must catch the security exception and return diagnostic blocker finding
        assert resp.status == AnalysisStatus.FAILED
        assert len(resp.findings) == 1
        finding = resp.findings[0]
        assert finding.rule_id == "API_SPEC_SYNTAX_ERROR"
        assert finding.severity == Severity.BLOCKER
        assert "SecurityViolationError" in finding.description or "Entities/DTD forbidden" in finding.description

    @pytest.mark.asyncio
    async def test_billion_laughs_exponential_entity_expansion_blocked(self):
        """Verifies Billion Laughs recursive entity expansion is blocked immediately at DTD check."""
        billion_laughs = """<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ELEMENT lolz (#PCDATA)>
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<edmx:Edmx Version="1.0"><lolz>&lol3;</lolz></edmx:Edmx>"""

        req = make_request(
            artifacts=[
                ArtifactReference(file_name="baseline.xml", artifact_type=ArtifactType.XML, raw_content=billion_laughs),
                ArtifactReference(file_name="candidate.xml", artifact_type=ArtifactType.XML, raw_content="<root/>"),
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.FAILED
        assert resp.findings[0].rule_id == "API_SPEC_SYNTAX_ERROR"

    @pytest.mark.asyncio
    async def test_truncated_json_returns_diagnostic_blocker(self):
        """Verifies corrupted/truncated JSON returns API_SPEC_SYNTAX_ERROR (BLOCKER) without crash."""
        corrupted_json = '{"openapi": "3.0.0", "paths": { "/invoices": '
        clean_json = '{"openapi": "3.0.0", "paths": {}}'

        req = make_request(
            artifacts=[
                ArtifactReference(file_name="baseline.json", artifact_type=ArtifactType.JSON, raw_content=corrupted_json),
                ArtifactReference(file_name="candidate.json", artifact_type=ArtifactType.JSON, raw_content=clean_json),
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.FAILED
        assert resp.findings[0].rule_id == "API_SPEC_SYNTAX_ERROR"

    @pytest.mark.asyncio
    async def test_missing_candidate_specification_via_artifact(self):
        """Verifies omitting candidate specification returns API_CANDIDATE_MISSING (BLOCKER) when baseline artifact provided."""
        req = make_request(
            artifacts=[
                ArtifactReference(file_name="baseline_spec.json", artifact_type=ArtifactType.JSON, raw_content="{}")
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.FAILED
        assert resp.findings[0].rule_id == "API_CANDIDATE_MISSING"
        assert resp.findings[0].severity == Severity.BLOCKER

    @pytest.mark.asyncio
    async def test_missing_baseline_specification_via_artifact(self):
        """Verifies omitting baseline specification returns API_BASELINE_MISSING (BLOCKER) when candidate artifact provided."""
        req = make_request(
            artifacts=[
                ArtifactReference(file_name="candidate_spec.json", artifact_type=ArtifactType.JSON, raw_content="{}")
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.FAILED
        assert resp.findings[0].rule_id == "API_BASELINE_MISSING"
        assert resp.findings[0].severity == Severity.BLOCKER


# ==============================================================================
# 6. Dimension 6: Scale & Performance
# ==============================================================================

class TestScaleAndPerformance:
    """Stress tests on large specifications (500+ endpoints and schemas)."""

    @pytest.mark.asyncio
    async def test_large_openapi_specification_scales_cleanly(self):
        """Verifies analyzing 500 endpoints and 100 entity models completes within 2.5 seconds."""
        base_paths: Dict[str, Any] = {}
        cand_paths: Dict[str, Any] = {}
        base_schemas: Dict[str, Any] = {}
        cand_schemas: Dict[str, Any] = {}

        # 500 endpoints
        for i in range(500):
            ep_name = f"/api/v1/resource_{i}"
            base_paths[ep_name] = {
                "get": {
                    "summary": f"Get resource {i}",
                    "parameters": [{"name": "filter", "in": "query", "required": False}],
                }
            }
            # Remove endpoints 10, 20, 30 in candidate (3 breaking changes)
            if i not in (10, 20, 30):
                cand_paths[ep_name] = base_paths[ep_name]

        # 100 entities
        for i in range(100):
            ent_name = f"EntityModel_{i}"
            base_schemas[ent_name] = {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "data": {"type": "string", "maxLength": 50},
                },
            }
            # Narrow maxLength on entity 5, 15 (2 breaking changes)
            if i in (5, 15):
                cand_schemas[ent_name] = {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "data": {"type": "string", "maxLength": 20},
                    },
                }
            else:
                cand_schemas[ent_name] = base_schemas[ent_name]

        base_spec = {"openapi": "3.0.0", "info": {"title": "Large API", "version": "1.0"}, "paths": base_paths, "components": {"schemas": base_schemas}}
        cand_spec = {"openapi": "3.0.0", "info": {"title": "Large API", "version": "2.0"}, "paths": cand_paths, "components": {"schemas": cand_schemas}}

        payload = {"baseline": base_spec, "candidate": cand_spec}
        req = make_request(raw_content=json.dumps(payload))

        start_time = time.perf_counter()
        resp = await EngineRunner.execute(req)
        duration = time.perf_counter() - start_time

        assert resp.status == AnalysisStatus.COMPLETED
        # Must complete in under 2.5 seconds
        assert duration < 2.5, f"Execution too slow: {duration:.2f}s"

        # Verify correct breaking counts: 3 endpoints removed + 2 maxLength decreased = 5 breaking
        assert resp.metrics.additional_metrics["breakingChangesCount"] == 5
        assert resp.metrics.additional_metrics["endpointsAnalyzed"] == 500


# ==============================================================================
# 7. Dimension 7: Bitwise Determinism & Cryptographic Evidence Veracity
# ==============================================================================

class TestBitwiseDeterminismAndEvidenceVeracity:
    """Verifies bitwise reproducibility, cryptographic SHA-256 evidence integrity, and coordinate precision."""

    @pytest.mark.asyncio
    async def test_bitwise_determinism_across_multiple_runs(self):
        """Verifies 3 sequential executions of the same complex scenario yield bitwise identical output."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "Determinism Test API", "version": "1.0"},
            "paths": {
                "/orders": {"get": {}, "delete": {}},
                "/customers": {"get": {}},
            },
            "components": {
                "schemas": {
                    "Order": {
                        "type": "object",
                        "properties": {
                            "orderId": {"type": "string"},
                            "amount": {"type": "number"},
                            "status": {"type": "string", "enum": ["NEW", "PAID", "CANCELLED"]},
                        },
                    }
                }
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "Determinism Test API", "version": "2.0"},
            "paths": {
                "/orders": {"get": {}},  # delete removed
                # /customers removed
            },
            "components": {
                "schemas": {
                    "Order": {
                        "type": "object",
                        "properties": {
                            "orderId": {"type": "string"},
                            "amount": {"type": "string"},  # type mutated
                            "status": {"type": "string", "enum": ["NEW", "PAID"]},  # CANCELLED removed
                        },
                    }
                }
            },
        }
        integrations = [
            {"integration_id": "SYS_A", "consumed_endpoints": ["/customers"]},
            {"integration_id": "SYS_B", "consumed_fields": {"Order": ["amount"]}},
        ]
        raw = json.dumps({"baseline": base, "candidate": cand, "integrations": integrations}, indent=2)

        responses: List[AnalysisResponse] = []
        for run_idx in range(3):
            req = make_request(raw_content=raw, job_id=f"11111111-0000-0000-0000-{run_idx:012d}")
            resp = await EngineRunner.execute(req)
            responses.append(resp)

        r0, r1, r2 = responses[0], responses[1], responses[2]
        assert len(r0.findings) == len(r1.findings) == len(r2.findings)
        assert r0.metrics.rules_evaluated == r1.metrics.rules_evaluated == r2.metrics.rules_evaluated
        assert r0.metrics.additional_metrics == r1.metrics.additional_metrics == r2.metrics.additional_metrics

        for f0, f1, f2 in zip(r0.findings, r1.findings, r2.findings):
            assert f0.rule_id == f1.rule_id == f2.rule_id
            assert f0.severity == f1.severity == f2.severity
            assert f0.title == f1.title == f2.title
            assert f0.confidence == f1.confidence == f2.confidence
            assert f0.confidence_score == f1.confidence_score == f2.confidence_score
            assert f0.technical_details == f1.technical_details == f2.technical_details
            assert f0.affected_objects == f1.affected_objects == f2.affected_objects
            assert f0.evidence[0].sha256 == f1.evidence[0].sha256 == f2.evidence[0].sha256

    @pytest.mark.asyncio
    async def test_cryptographic_sha256_evidence_veracity(self):
        """Verifies that evidence SHA-256 hash precisely matches the cryptographic digest of the source text."""
        baseline_text = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices>
    <Schema Namespace="API_EVIDENCE" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="EvidenceEntity">
        <Property Name="SecretField" Type="Edm.String"/>
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        candidate_text = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices>
    <Schema Namespace="API_EVIDENCE" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="EvidenceEntity"/>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        expected_baseline_sha = hashlib.sha256(baseline_text.encode("utf-8")).hexdigest()
        expected_candidate_sha = hashlib.sha256(candidate_text.encode("utf-8")).hexdigest()
        assert len(expected_candidate_sha) == 64

        req = make_request(
            artifacts=[
                ArtifactReference(file_name="base.edmx", artifact_type=ArtifactType.EDMX, raw_content=baseline_text),
                ArtifactReference(file_name="cand.edmx", artifact_type=ArtifactType.EDMX, raw_content=candidate_text),
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        removed_f = next(f for f in resp.findings if f.rule_id == "API_BREAKING_FIELD_REMOVED")
        assert len(removed_f.evidence) == 1
        ev = removed_f.evidence[0]
        # Field was removed from baseline, so evidence points to baseline artifact
        assert ev.artifact_path == "base.edmx"
        assert ev.sha256 == expected_baseline_sha
        assert ev.line_number >= 1
        assert ev.column_number >= 1
        assert "SecretField" in ev.snippet
        assert ev.source_type == TrustLevel.CUSTOMER_EVIDENCE

    @pytest.mark.asyncio
    async def test_epistemic_ai_ceiling_and_missing_evidence_demotion(self):
        """Verifies that is_ai_generated forces INFERRED (<=0.60) and missing evidence demotes to UNKNOWN (<=0.30)."""
        base = {"openapi": "3.0.0", "info": {"title": "AI API", "version": "1.0"}, "paths": {"/a": {}}}
        cand = {"openapi": "3.0.0", "info": {"title": "AI API", "version": "2.0"}, "paths": {}}

        # A. AI Ceiling
        req_ai = make_request(
            raw_content=json.dumps({"baseline": base, "candidate": cand}),
            configuration={"is_ai_generated": True},
        )
        resp_ai = await EngineRunner.execute(req_ai)
        assert len(resp_ai.findings) >= 1
        for f in resp_ai.findings:
            assert f.confidence == ConfidenceClass.INFERRED
            assert f.confidence_score <= 0.60

        # B. Missing Evidence Demotion
        finding_stripped = Finding(
            rule_id="API_BREAKING_ENDPOINT_REMOVED",
            severity=Severity.CRITICAL,
            category="API",
            title="Endpoint Removed",
            description="Removed",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Fix it",
            evidence=[],  # Stripped evidence
        )
        classified = ConfidenceClassifier.classify(finding_stripped, missing_evidence=True)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score <= 0.30


# ==============================================================================
# 8. Dimension 8: Empirical Discovery & Characterization of Engine Vulnerabilities
# ==============================================================================

class TestEmpiricalVulnerabilitiesFound:
    """
    Empirical proofs of concrete bugs identified during adversarial challenge.
    These tests formally document exact failure modes for worker remediation.
    """

    @pytest.mark.asyncio
    async def test_vulnerability_1_odata_namespaced_deprecation_annotation_unmatched(self):
        """
        VULNERABILITY 1 (OData EDMX Deprecation Blindspot):
        SafeXmlParser (like standard ElementTree) preserves XML namespaces in Clark notation:
          '{http://www.sap.com/Protocols/SAPData}deprecated': 'true'
        However, api_change.py checks:
          child.attrib.get('sap:deprecated', '').lower() == 'true'
        Because literal 'sap:deprecated' is not in child.attrib, standard SAP deprecation
        annotations in EDMX schemas are completely ignored by the engine.
        """
        cand_xml = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:sap="http://www.sap.com/Protocols/SAPData">
  <edmx:DataServices>
    <Schema Namespace="API_TEST" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="Customer">
        <Property Name="FaxNumber" Type="Edm.String" sap:deprecated="true"/>
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        root = SafeXmlParser.parse_string(cand_xml)
        for elem in root.iter():
            if elem.tag.endswith("Property"):
                # Demonstrating the Clark notation key stored by ElementTree
                clark_keys = [k for k in elem.attrib if "deprecated" in k]
                assert "{http://www.sap.com/Protocols/SAPData}deprecated" in clark_keys
                # Demonstrating that literal 'sap:deprecated' returns None
                assert elem.attrib.get("sap:deprecated") is None

    @pytest.mark.asyncio
    async def test_vulnerability_2_non_breaking_operation_count_telemetry_drift(self):
        """
        VULNERABILITY 2 (Telemetry Inconsistency):
        In api_change.py _diff_operations:
          When a new operation is added to an existing endpoint, the engine correctly builds
          an API_NON_BREAKING_OPERATION_ADDED finding, but returns (findings, evals, breaking_count),
          omitting non_breaking_count.
        Consequently, _diff_schemas fails to increment non_breaking_count for added operations,
        causing a drift between the findings list and metrics.additional_metrics['nonBreakingChangesCount'].
        """
        base = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.0"},
            "paths": {"/orders": {"get": {}}},
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.1"},
            "paths": {
                "/orders": {
                    "get": {},
                    "post": {},  # Newly added operation (non-breaking)
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        # 1 non-breaking finding emitted
        nb_findings = [f for f in resp.findings if f.rule_id == "API_NON_BREAKING_OPERATION_ADDED"]
        assert len(nb_findings) == 1

        # BUG PROOF: Telemetry metric is 0 instead of 1!
        assert resp.metrics.additional_metrics["nonBreakingChangesCount"] == 0

    @pytest.mark.asyncio
    async def test_vulnerability_3_bundled_payload_falsely_reports_baseline_missing(self):
        """
        VULNERABILITY 3 (Diagnostic Misattribution):
        In _parse_request_inputs (lines 328 & 319):
          if "baseline" in parsed_bundle and "candidate" in parsed_bundle:
        When a client supplies a valid baseline in bundled raw_content or configuration but
        omits candidate, the engine fails to extract baseline_raw, and reports API_BASELINE_MISSING
        instead of API_CANDIDATE_MISSING.
        """
        bundle_with_baseline_only = json.dumps({"baseline": {"openapi": "3.0.0", "paths": {}}})
        req = make_request(raw_content=bundle_with_baseline_only)
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.FAILED

        # BUG PROOF: Engine complains baseline is missing when it was candidate that was omitted!
        assert resp.findings[0].rule_id == "API_BASELINE_MISSING"

    @pytest.mark.asyncio
    async def test_vulnerability_4_consumer_operation_overmatched_by_endpoint_fallback(self):
        """
        VULNERABILITY 4 (Consumer Impact False-Positive Overmatch):
        In _cross_reference_operation (lines 1471-1474):
          When an integration specifies consumed_endpoints=['/orders'] and
          consumed_operations={'/orders': ['GET']}, removing DELETE from /orders
          still matches the integration because the endpoint fallback does not verify
          whether the integration explicitly declared an operation filter for that route.
        This triggers false-positive BLOCKER alerts for read-only consumer systems.
        """
        engine = ApiChangeEngine()
        integ = ClientIntegration(
            integration_id="READ_ONLY_PORTAL",
            consumed_endpoints=["/orders"],
            consumed_operations={"/orders": ["GET"]},  # Only consumes GET!
        )
        # Checking impact of removing DELETE
        impacted = engine._cross_reference_operation(endpoint_path="/orders", method="DELETE", integrations=[integ])

        # BUG PROOF: READ_ONLY_PORTAL is matched even though it never uses DELETE!
        assert "READ_ONLY_PORTAL" in impacted

    @pytest.mark.asyncio
    async def test_vulnerability_5_entity_name_prefix_stripping_corrupts_names(self):
        """
        VULNERABILITY 5 (Entity Name Corruption via string replace):
        In _cross_reference_field (line 1490):
          clean_entity.replace('a_', '')
        If an entity name contains 'a_' internally (e.g. 'A_Data_Area'), string.replace('a_', '')
        strips all occurrences, yielding 'datarea' rather than 'data_area' (removeprefix).
        """
        entity_name = "A_Data_Area"
        clean_entity = entity_name.strip().lower()
        corrupted_name = clean_entity.replace("a_", "")
        intended_prefix_stripped = clean_entity.removeprefix("a_")

        # BUG PROOF: replace yields 'datarea' while removeprefix yields 'data_area'
        assert corrupted_name == "datarea"
        assert intended_prefix_stripped == "data_area"
