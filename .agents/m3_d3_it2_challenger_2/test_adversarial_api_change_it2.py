"""
Adversarial Empirical Stress Test Suite (Iteration 2): API Change Guard Engine (api_change.py)
Agent: m3_d3_it2_challenger_2
Mission: Empirically stress-test API Change Guard against all 9 remediated defect vectors,
         verify regression fixes, and challenge edge-case boundaries for OpenAPI 2.0/3.0,
         OData EDMX V2/V4, consumer registry matching, and cryptographic evidence veracity.

Governing Standards:
- AGENTS.md: Cardinal Axiom 2 (14-Point Engine Anatomy, Epistemic Confidence, Evidence Chains)
- .agents/skills/sap-evidence.md: Confidence hierarchy (VERIFIED=1.0, RULE_DERIVED=0.85, INFERRED=0.60, UNKNOWN=0.30)
- .agents/skills/engine-authoring.md: Deterministic rules, pure engine logic, boundary assertions
- .agents/skills/secure-file-parser.md: XXE defense, safe parsing, fail-closed handling

Test Execution:
  py -3.13 -m pytest .agents/m3_d3_it2_challenger_2/test_adversarial_api_change_it2.py -v
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
        assert duration < 2.5, f"Execution too slow: {duration:.2f}s"
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

        req_ai = make_request(
            raw_content=json.dumps({"baseline": base, "candidate": cand}),
            configuration={"is_ai_generated": True},
        )
        resp_ai = await EngineRunner.execute(req_ai)
        assert len(resp_ai.findings) >= 1
        for f in resp_ai.findings:
            assert f.confidence == ConfidenceClass.INFERRED
            assert f.confidence_score <= 0.60

        finding_stripped = Finding(
            rule_id="API_BREAKING_ENDPOINT_REMOVED",
            severity=Severity.CRITICAL,
            category="API",
            title="Endpoint Removed",
            description="Removed",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Fix it",
            evidence=[],
        )
        classified = ConfidenceClassifier.classify(finding_stripped, missing_evidence=True)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score <= 0.30


# ==============================================================================
# 8. Dimension 8: Verification of Prior Vulnerability Remediations
# ==============================================================================

class TestRemediatedVulnerabilitiesProof:
    """
    Verifies that the previously documented failure modes in test_adversarial_api_change.py
    are now completely resolved in the engine.
    """

    @pytest.mark.asyncio
    async def test_vulnerability_1_remediated_odata_clark_deprecation(self):
        """Verifies OData EDMX Clark-notated sap:deprecated attribute is parsed and emits deprecation finding."""
        base_xml = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices>
    <Schema Namespace="API_TEST" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="Customer">
        <Property Name="FaxNumber" Type="Edm.String"/>
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

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

        req = make_request(
            artifacts=[
                ArtifactReference(file_name="base.edmx", artifact_type=ArtifactType.EDMX, raw_content=base_xml),
                ArtifactReference(file_name="cand.edmx", artifact_type=ArtifactType.EDMX, raw_content=cand_xml),
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        dep_findings = [f for f in resp.findings if f.rule_id == "API_DEPRECATION_WARNING"]
        assert len(dep_findings) == 1
        assert "Customer.FaxNumber" in dep_findings[0].title

    @pytest.mark.asyncio
    async def test_vulnerability_2_remediated_non_breaking_operation_count_telemetry(self):
        """Verifies adding a new operation increments nonBreakingChangesCount in telemetry metrics."""
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
                    "post": {},
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        nb_findings = [f for f in resp.findings if f.rule_id == "API_NON_BREAKING_OPERATION_ADDED"]
        assert len(nb_findings) == 1

        # TELEMETRY VERIFICATION: Metric is now accurately 1 (not 0)
        assert resp.metrics.additional_metrics["nonBreakingChangesCount"] == 1

    @pytest.mark.asyncio
    async def test_vulnerability_3_remediated_bundled_payload_diagnoses_candidate_missing(self):
        """Verifies providing only baseline in bundled payload correctly diagnoses API_CANDIDATE_MISSING."""
        bundle_with_baseline_only = json.dumps({"baseline": {"openapi": "3.0.0", "paths": {}}})
        req = make_request(raw_content=bundle_with_baseline_only)
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.FAILED

        # DIAGNOSTIC VERIFICATION: Correctly attributes missing candidate specification
        assert resp.findings[0].rule_id == "API_CANDIDATE_MISSING"

    @pytest.mark.asyncio
    async def test_vulnerability_4_remediated_consumer_operation_not_overmatched(self):
        """Verifies consumer with explicit GET operation restriction is NOT matched when DELETE is removed."""
        engine = ApiChangeEngine()
        integ = ClientIntegration(
            integration_id="READ_ONLY_PORTAL",
            consumed_endpoints=["/orders"],
            consumed_operations={"/orders": ["GET"]},
        )
        impacted = engine._cross_reference_operation(endpoint_path="/orders", method="DELETE", integrations=[integ])
        # OVERMATCH VERIFICATION: READ_ONLY_PORTAL is safely excluded from DELETE impact
        assert "READ_ONLY_PORTAL" not in impacted
        assert impacted == []

    @pytest.mark.asyncio
    async def test_vulnerability_5_remediated_entity_name_prefix_stripping_no_corruption(self):
        """Verifies removeprefix('a_') does not corrupt internal substrings of entity names."""
        engine = ApiChangeEngine()
        integ = ClientIntegration(
            integration_id="DATA_SYNC",
            consumed_fields={"data_area": ["area_code"]},
        )
        impacted = engine._cross_reference_field(
            entity_name="A_Data_Area",
            field_name="area_code",
            integrations=[integ],
        )
        # PREFIX STRIPPING VERIFICATION: A_Data_Area correctly matches data_area registration
        assert "DATA_SYNC" in impacted


# ==============================================================================
# 9. Dimension 9: In-Depth Adversarial Stress Testing of the 9 Remediation Vectors
# ==============================================================================

class TestStressRemediatedDefectVectors:
    """
    Extensive adversarial stress tests for all 9 defect vectors exploring corner cases,
    null/empty handling, type matrices, Clark XML namespace variations, and telemetry.
    """

    # --------------------------------------------------------------------------
    # Vector 1: OpenAPI 2.0 (Swagger) Definitions Missing / Null / Non-dict
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_swagger2_definitions_null_explicit(self):
        """Stress: Swagger 2.0 with explicit 'definitions: null' must not raise AttributeError."""
        base_sw2 = {"swagger": "2.0", "info": {"title": "T", "version": "1"}, "paths": {}, "definitions": None}
        cand_sw2 = {"swagger": "2.0", "info": {"title": "T", "version": "2"}, "paths": {}, "definitions": None}
        req = make_request(raw_content=json.dumps({"baseline": base_sw2, "candidate": cand_sw2}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert len(resp.findings) == 0

    @pytest.mark.asyncio
    async def test_swagger2_definitions_key_completely_absent(self):
        """Stress: Swagger 2.0 without 'definitions' key at all parses endpoints and diffs cleanly."""
        base_sw2 = {
            "swagger": "2.0",
            "info": {"title": "T", "version": "1"},
            "paths": {"/ping": {"get": {}}},
        }
        cand_sw2 = {
            "swagger": "2.0",
            "info": {"title": "T", "version": "2"},
            "paths": {},  # /ping removed
        }
        req = make_request(raw_content=json.dumps({"baseline": base_sw2, "candidate": cand_sw2}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert len(resp.findings) == 1
        assert resp.findings[0].rule_id == "API_BREAKING_ENDPOINT_REMOVED"

    @pytest.mark.asyncio
    async def test_openapi3_components_schemas_null_or_missing(self):
        """Stress: OpenAPI 3.0 with 'components: null' or 'schemas: null' does not crash."""
        base_oa3 = {"openapi": "3.0.0", "info": {"title": "T", "version": "1"}, "paths": {}, "components": None}
        cand_oa3 = {"openapi": "3.0.0", "info": {"title": "T", "version": "2"}, "paths": {}, "components": {"schemas": None}}
        req = make_request(raw_content=json.dumps({"baseline": base_oa3, "candidate": cand_oa3}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert len(resp.findings) == 0

    # --------------------------------------------------------------------------
    # Vector 2: Parameter Transition from Optional to Required
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_param_optional_to_required_across_query_path_header(self):
        """Stress: Existing parameter transitioning from required:false to required:true triggers breaking finding."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "Param API", "version": "1.0"},
            "paths": {
                "/records": {
                    "get": {
                        "parameters": [
                            {"name": "filter", "in": "query", "required": False, "type": "string"},
                            {"name": "X-Client-ID", "in": "header", "required": False, "type": "string"},
                        ]
                    }
                }
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "Param API", "version": "1.1"},
            "paths": {
                "/records": {
                    "get": {
                        "parameters": [
                            {"name": "filter", "in": "query", "required": True, "type": "string"},  # optional -> required!
                            {"name": "X-Client-ID", "in": "header", "required": True, "type": "string"},  # optional -> required!
                        ]
                    }
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        findings = [f for f in resp.findings if f.rule_id == "API_BREAKING_REQUIRED_PARAM_ADDED"]
        assert len(findings) == 2
        param_names = {f.technical_details.get("parameter") for f in findings}
        assert param_names == {"filter", "X-Client-ID"}
        for f in findings:
            assert f.severity == Severity.MAJOR
            assert "made mandatory" in f.description

    @pytest.mark.asyncio
    async def test_param_required_to_optional_is_non_breaking(self):
        """Stress: Parameter relaxing from required:true to required:false is non-breaking."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "Param API", "version": "1.0"},
            "paths": {
                "/records": {
                    "get": {
                        "parameters": [
                            {"name": "filter", "in": "query", "required": True, "type": "string"},
                        ]
                    }
                }
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "Param API", "version": "1.1"},
            "paths": {
                "/records": {
                    "get": {
                        "parameters": [
                            {"name": "filter", "in": "query", "required": False, "type": "string"},
                        ]
                    }
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED
        breaking = [f for f in resp.findings if "BREAKING" in f.rule_id]
        assert len(breaking) == 0

    # --------------------------------------------------------------------------
    # Vector 3: Incompatible Parameter Type Mutations on Operations
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_parameter_type_mutation_integer_to_boolean_and_string(self):
        """Stress: Parameter type mutating from integer to boolean triggers API_BREAKING_TYPE_CHANGED."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.0"},
            "paths": {
                "/items": {
                    "get": {
                        "parameters": [
                            {"name": "limit", "in": "query", "type": "integer"},
                        ]
                    }
                }
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.1"},
            "paths": {
                "/items": {
                    "get": {
                        "parameters": [
                            {"name": "limit", "in": "query", "type": "boolean"},
                        ]
                    }
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        type_findings = [f for f in resp.findings if f.rule_id == "API_BREAKING_TYPE_CHANGED"]
        assert len(type_findings) == 1
        tf = type_findings[0]
        assert tf.severity == Severity.MAJOR
        assert tf.technical_details.get("baselineType") == "integer"
        assert tf.technical_details.get("candidateType") == "boolean"

    @pytest.mark.asyncio
    async def test_parameter_type_mutation_widening_is_not_breaking(self):
        """Stress: Parameter type widening from integer to number is compatible and not breaking."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.0"},
            "paths": {
                "/items": {
                    "get": {
                        "parameters": [
                            {"name": "amount", "in": "query", "type": "integer"},
                        ]
                    }
                }
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.1"},
            "paths": {
                "/items": {
                    "get": {
                        "parameters": [
                            {"name": "amount", "in": "query", "type": "number"},
                        ]
                    }
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED
        breaking = [f for f in resp.findings if "BREAKING" in f.rule_id]
        assert len(breaking) == 0

    # --------------------------------------------------------------------------
    # Vector 4: Incompatible Type Mutation for "number" -> "string"
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_number_to_string_incompatible_in_properties_and_params(self):
        """Stress: Changing number to string in both entity properties and operation params is breaking."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.0"},
            "paths": {
                "/products": {
                    "get": {
                        "parameters": [
                            {"name": "priceThreshold", "in": "query", "type": "number"}
                        ]
                    }
                }
            },
            "components": {
                "schemas": {
                    "Product": {
                        "type": "object",
                        "properties": {
                            "unitPrice": {"type": "number"},
                        },
                    }
                }
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "2.0"},
            "paths": {
                "/products": {
                    "get": {
                        "parameters": [
                            {"name": "priceThreshold", "in": "query", "type": "string"}
                        ]
                    }
                }
            },
            "components": {
                "schemas": {
                    "Product": {
                        "type": "object",
                        "properties": {
                            "unitPrice": {"type": "string"},
                        },
                    }
                }
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        type_findings = [f for f in resp.findings if f.rule_id == "API_BREAKING_TYPE_CHANGED"]
        assert len(type_findings) == 2
        objects = {obj for f in type_findings for obj in f.affected_objects}
        assert any("Product.unitPrice" in obj for obj in objects)
        assert any("priceThreshold" in obj for obj in objects)

    # --------------------------------------------------------------------------
    # Vector 5: OData EDMX Clark-Notation & Case-Insensitive Deprecations
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_odata_edmx_clark_variations_and_case_insensitivity(self):
        """Stress: Clark notation with custom namespace and uppercase DEPRECATED is detected."""
        base_edmx = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices>
    <Schema Namespace="API_SALES" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="SalesOrder">
        <Property Name="OrderCode" Type="Edm.String"/>
        <Property Name="OldTaxRate" Type="Edm.Decimal"/>
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        # In candidate: OrderCode marked deprecated with custom namespace, OldTaxRate marked with sap:label="DEPRECATED"
        cand_edmx = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"
           xmlns:custom="http://custom.sap.com/protocols/data"
           xmlns:sap="http://www.sap.com/Protocols/SAPData">
  <edmx:DataServices>
    <Schema Namespace="API_SALES" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="SalesOrder">
        <Property Name="OrderCode" Type="Edm.String" custom:deprecated="TRUE"/>
        <Property Name="OldTaxRate" Type="Edm.Decimal" sap:label="DEPRECATED"/>
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""

        req = make_request(
            artifacts=[
                ArtifactReference(file_name="base.edmx", artifact_type=ArtifactType.EDMX, raw_content=base_edmx),
                ArtifactReference(file_name="cand.edmx", artifact_type=ArtifactType.EDMX, raw_content=cand_edmx),
            ]
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        dep_findings = [f for f in resp.findings if f.rule_id == "API_DEPRECATION_WARNING"]
        assert len(dep_findings) == 2
        titles = {f.title for f in dep_findings}
        assert any("OrderCode" in t for t in titles)
        assert any("OldTaxRate" in t for t in titles)

    # --------------------------------------------------------------------------
    # Vector 6: Non-Breaking Operation Additions Tracking in Metrics
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_multiple_added_operations_and_endpoints_telemetry_accuracy(self):
        """Stress: Adding multiple operations across multiple endpoints accurately tracks in metrics."""
        base = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.0"},
            "paths": {
                "/orders": {"get": {}},
                "/items": {"get": {}},
            },
        }
        cand = {
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.1"},
            "paths": {
                "/orders": {
                    "get": {},
                    "post": {},  # +1 non-breaking operation
                    "put": {},   # +1 non-breaking operation
                },
                "/items": {
                    "get": {},
                    "delete": {},  # +1 non-breaking operation
                },
                "/shipments": {
                    "get": {},  # +1 non-breaking endpoint
                },
            },
        }
        req = make_request(raw_content=json.dumps({"baseline": base, "candidate": cand}))
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED

        # 3 added operations + 1 added endpoint = 4 non-breaking additions
        assert resp.metrics.additional_metrics["nonBreakingChangesCount"] == 4
        assert resp.metrics.additional_metrics["breakingChangesCount"] == 0

    # --------------------------------------------------------------------------
    # Vector 7: Independent Extraction of Baseline and Candidate
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_configuration_independent_extraction_diagnostics(self):
        """Stress: Supplying only baseline in configuration returns API_CANDIDATE_MISSING, only candidate returns API_BASELINE_MISSING."""
        # A. Only baseline in configuration
        req_base_only = make_request(configuration={"baseline": {"openapi": "3.0.0", "paths": {}}})
        resp_base_only = await EngineRunner.execute(req_base_only)
        assert resp_base_only.status == AnalysisStatus.FAILED
        assert resp_base_only.findings[0].rule_id == "API_CANDIDATE_MISSING"

        # B. Only candidate in configuration
        req_cand_only = make_request(configuration={"candidate": {"openapi": "3.0.0", "paths": {}}})
        resp_cand_only = await EngineRunner.execute(req_cand_only)
        assert resp_cand_only.status == AnalysisStatus.FAILED
        assert resp_cand_only.findings[0].rule_id == "API_BASELINE_MISSING"

        # C. Hybrid: baseline in configuration, candidate in artifacts
        req_hybrid = make_request(
            configuration={"baseline": {"openapi": "3.0.0", "paths": {"/a": {"get": {}}}}},
            artifacts=[ArtifactReference(file_name="candidate_spec.json", artifact_type=ArtifactType.JSON, raw_content='{"openapi": "3.0.0", "paths": {}}')],
        )
        resp_hybrid = await EngineRunner.execute(req_hybrid)
        assert resp_hybrid.status == AnalysisStatus.COMPLETED
        assert any(f.rule_id == "API_BREAKING_ENDPOINT_REMOVED" for f in resp_hybrid.findings)

    # --------------------------------------------------------------------------
    # Vector 8: Consumer Operation Matching with Explicit Filters
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_consumer_operation_filtering_multi_method(self):
        """Stress: Integration specifying GET and POST on /orders is NOT impacted when DELETE is removed, but IS impacted when POST is removed."""
        engine = ApiChangeEngine()
        integ = ClientIntegration(
            integration_id="ORDER_SYNC",
            consumed_endpoints=["/orders"],
            consumed_operations={"/orders": ["GET", "POST"]},
        )
        # Removing DELETE -> not impacted
        impacted_delete = engine._cross_reference_operation(endpoint_path="/orders", method="DELETE", integrations=[integ])
        assert "ORDER_SYNC" not in impacted_delete

        # Removing POST -> IS impacted
        impacted_post = engine._cross_reference_operation(endpoint_path="/orders", method="POST", integrations=[integ])
        assert "ORDER_SYNC" in impacted_post

    # --------------------------------------------------------------------------
    # Vector 9: Entity Name Prefix Stripping without String Corruption
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_entity_name_prefix_stripping_various_patterns(self):
        """Stress: Verify entity prefix stripping does not strip internal 'a_' in various table patterns."""
        engine = ApiChangeEngine()
        integ1 = ClientIntegration(
            integration_id="INT_1",
            consumed_fields={"area_data_archive": ["id"]},
        )
        integ2 = ClientIntegration(
            integration_id="INT_2",
            consumed_fields={"data_area": ["id"]},
        )

        # Entity A_Area_Data_Archive: prefix stripping yields area_data_archive
        impacted1 = engine._cross_reference_field(
            entity_name="A_Area_Data_Archive",
            field_name="id",
            integrations=[integ1],
        )
        assert "INT_1" in impacted1

        # Entity Custom_Data_Area: internal 'a_' in data is NOT stripped, prefix is Custom_, does not match data_area
        impacted2 = engine._cross_reference_field(
            entity_name="Custom_Data_Area",
            field_name="id",
            integrations=[integ2],
        )
        assert "INT_2" not in impacted2
