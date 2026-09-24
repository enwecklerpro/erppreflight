import sys
from pathlib import Path
import asyncio

srv_path = Path("H:/erppreflight/services/analysis-python")
if str(srv_path) not in sys.path:
    sys.path.insert(0, str(srv_path))

import src.engines
from src.core.runner import EngineRunner
from src.models.request import AnalysisRequest
from src.models.enums import EngineType, Severity, AnalysisStatus, ConfidenceClass

async def run_stress_tests():
    print("=== Running Adversarial Stress Tests for API Change Guard ===")

    # Test 1: XXE attack injection in baseline EDMX XML
    xxe_payload = (
        '<?xml version="1.0"?>'
        '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
        '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">'
        '  &xxe;'
        '</edmx:Edmx>'
    )
    req1 = AnalysisRequest(
        job_id="11111111-9999-0001-0001-000000000001",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        configuration={"baseline": xxe_payload, "candidate": "<edmx:Edmx Version=\"1.0\"/>"},
    )
    resp1 = await EngineRunner.execute(req1)
    assert resp1.status == AnalysisStatus.FAILED
    assert len(resp1.findings) == 1
    assert resp1.findings[0].rule_id == "API_SPEC_SYNTAX_ERROR"
    assert "Malicious XML detected" in resp1.findings[0].description
    print("Test 1 Passed: XXE attack injection safely caught and returned API_SPEC_SYNTAX_ERROR (BLOCKER).")

    # Test 2: Huge OpenAPI spec (5,000 endpoints) performance & memory stability
    huge_paths = {}
    for i in range(2000):
        huge_paths[f"/api/v1/resource_{i}"] = {
            "get": {
                "responses": {"200": {"description": "OK"}},
                "parameters": [{"name": f"param_{j}", "in": "query", "type": "string"} for j in range(3)]
            },
            "post": {
                "responses": {"201": {"description": "Created"}},
                "parameters": [{"name": "body", "in": "body", "required": True}]
            }
        }
    
    # Candidate with 10 removed endpoints and 10 added endpoints
    cand_paths = dict(huge_paths)
    for i in range(10):
        del cand_paths[f"/api/v1/resource_{i}"]
    for i in range(2000, 2010):
        cand_paths[f"/api/v1/resource_{i}"] = {"get": {"responses": {"200": {"description": "OK"}}}}

    import time
    t0 = time.perf_counter()
    req2 = AnalysisRequest(
        job_id="11111111-9999-0001-0001-000000000002",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        configuration={
            "baseline": {"swagger": "2.0", "info": {"title": "Huge", "version": "1.0"}, "paths": huge_paths},
            "candidate": {"swagger": "2.0", "info": {"title": "Huge", "version": "1.1"}, "paths": cand_paths},
        }
    )
    resp2 = await EngineRunner.execute(req2)
    elapsed = time.perf_counter() - t0
    assert resp2.status == AnalysisStatus.COMPLETED
    assert resp2.metrics.additional_metrics["breakingChangesCount"] == 10
    assert resp2.metrics.additional_metrics["nonBreakingChangesCount"] == 10
    print(f"Test 2 Passed: 2,000 endpoint schema diff completed in {elapsed:.3f}s with exact change count.")

    # Test 3: Deeply nested types & edge cases (empty entity, null fields, unknown types)
    req3 = AnalysisRequest(
        job_id="11111111-9999-0001-0001-000000000003",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        configuration={
            "baseline": {
                "openapi": "3.0.0",
                "paths": {},
                "components": {
                    "schemas": {
                        "Empty": {},
                        "NullProps": {"type": "object", "properties": {"propA": None}},
                        "Normal": {"type": "object", "properties": {"score": {"type": "integer"}}}
                    }
                }
            },
            "candidate": {
                "openapi": "3.0.0",
                "paths": {},
                "components": {
                    "schemas": {
                        "Empty": {"type": "object"},
                        "NullProps": {"type": "object", "properties": {}},
                        "Normal": {"type": "object", "properties": {"score": {"type": "string"}}}
                    }
                }
            }
        }
    )
    resp3 = await EngineRunner.execute(req3)
    assert resp3.status == AnalysisStatus.COMPLETED
    assert any(f.rule_id == "API_BREAKING_TYPE_CHANGED" for f in resp3.findings)
    print("Test 3 Passed: Null properties, empty schemas, and type mutation evaluated cleanly.")

    # Test 4: Registry matching with URL path parameters and wildcard fields
    req4 = AnalysisRequest(
        job_id="11111111-9999-0001-0001-000000000004",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        configuration={
            "baseline": {
                "openapi": "3.0.0",
                "paths": {
                    "/customers/{customerId}/orders": {
                        "delete": {"responses": {"204": {"description": "Deleted"}}}
                    }
                },
                "components": {
                    "schemas": {
                        "Customer": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "secretKey": {"type": "string"}
                            }
                        }
                    }
                }
            },
            "candidate": {
                "openapi": "3.0.0",
                "paths": {
                    "/customers/{customerId}/orders": {
                        "get": {"responses": {"200": {"description": "List"}}}
                    }
                },
                "components": {
                    "schemas": {
                        "Customer": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"}
                            }
                        }
                    }
                }
            },
            "integrations": [
                {
                    "integration_id": "CLIENT_WILDCARD_CONSUMER",
                    "consumed_endpoints": ["/customers/{customerId}/orders"],
                    "consumed_fields": {"Customer": ["*"]},
                    "consumed_operations": {"/customers/{customerId}/orders": ["DELETE"]}
                }
            ]
        }
    )
    resp4 = await EngineRunner.execute(req4)
    assert resp4.status == AnalysisStatus.COMPLETED
    impacted_rules = {f.rule_id: f for f in resp4.findings}
    assert "API_BREAKING_OPERATION_REMOVED" in impacted_rules
    assert "API_BREAKING_FIELD_REMOVED" in impacted_rules
    assert "CLIENT_WILDCARD_CONSUMER" in impacted_rules["API_BREAKING_OPERATION_REMOVED"].technical_details["affectedIntegrations"]
    assert "CLIENT_WILDCARD_CONSUMER" in impacted_rules["API_BREAKING_FIELD_REMOVED"].technical_details["affectedIntegrations"]
    print("Test 4 Passed: Client integration wildcard fields and operations correctly matched.")

    # Test 5: EDMX V4 parsing with EnumType and FunctionImport
    edmx_v4_baseline = """<?xml version="1.0" encoding="utf-8"?>
    <edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
      <edmx:DataServices>
        <Schema Namespace="DemoService" xmlns="http://docs.oasis-open.org/odata/ns/edm">
          <EnumType Name="ShippingStatus">
            <Member Name="Draft"/>
            <Member Name="Processing"/>
            <Member Name="Shipped"/>
            <Member Name="Delivered"/>
          </EnumType>
          <EntityType Name="Shipment">
            <Key><PropertyRef Name="ID"/></Key>
            <Property Name="ID" Type="Edm.Guid" Nullable="false"/>
            <Property Name="Status" Type="DemoService.ShippingStatus" Nullable="false"/>
          </EntityType>
          <EntityContainer Name="Container">
            <EntitySet Name="Shipments" EntityType="DemoService.Shipment"/>
            <FunctionImport Name="GetDeliveryEstimate"/>
          </EntityContainer>
        </Schema>
      </edmx:DataServices>
    </edmx:Edmx>"""

    edmx_v4_candidate = """<?xml version="1.0" encoding="utf-8"?>
    <edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
      <edmx:DataServices>
        <Schema Namespace="DemoService" xmlns="http://docs.oasis-open.org/odata/ns/edm">
          <EnumType Name="ShippingStatus">
            <Member Name="Draft"/>
            <Member Name="Shipped"/>
            <Member Name="Delivered"/>
          </EnumType>
          <EntityType Name="Shipment">
            <Key><PropertyRef Name="ID"/></Key>
            <Property Name="ID" Type="Edm.Guid" Nullable="false"/>
            <Property Name="Status" Type="DemoService.ShippingStatus" Nullable="false"/>
          </EntityType>
          <EntityContainer Name="Container">
            <EntitySet Name="Shipments" EntityType="DemoService.Shipment"/>
          </EntityContainer>
        </Schema>
      </edmx:DataServices>
    </edmx:Edmx>"""

    req5 = AnalysisRequest(
        job_id="11111111-9999-0001-0001-000000000005",
        tenant_id="22222222-0001-0001-0001-000000000001",
        project_id="33333333-0001-0001-0001-000000000001",
        engine_type=EngineType.API_CHANGE_GUARD,
        configuration={"baseline": edmx_v4_baseline, "candidate": edmx_v4_candidate}
    )
    resp5 = await EngineRunner.execute(req5)
    assert resp5.status == AnalysisStatus.COMPLETED
    assert any(f.rule_id == "API_BREAKING_ENUM_RESTRICTED" for f in resp5.findings)
    enum_finding = next(f for f in resp5.findings if f.rule_id == "API_BREAKING_ENUM_RESTRICTED")
    assert "Processing" in enum_finding.technical_details["removedMembers"]
    print("Test 5 Passed: OData EDMX V4 enum restriction ('Processing' removed) successfully flagged.")

    print("\nALL 5 ADVERSARIAL STRESS TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(run_stress_tests())
