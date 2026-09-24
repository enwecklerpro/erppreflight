"""
ERP Preflight — Domain 3 Golden Fixtures Provisioner
Generates all 12 curated test fixtures under services/analysis-python/tests/fixtures/domain3/
Engines Covered:
1. Change Pointer Coverage Auditor (CHANGE_POINTER_COVERAGE_AUDITOR)
2. API Change Guard (API_CHANGE_GUARD)

Governing Standard: AGENTS.md, Cardinal Axiom 2, engine-authoring.md, sap-evidence.md
"""

import hashlib
import json
import sys
from pathlib import Path

# Resolve destination directory
FIXTURES_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "services"
    / "analysis-python"
    / "tests"
    / "fixtures"
    / "domain3"
)


FIXTURE_DATA = {
    # -------------------------------------------------------------------------
    # 1. Change Pointer Coverage Auditor Fixtures
    # -------------------------------------------------------------------------
    "cp_matmas_active.json": json.dumps(
        {
            "description": "Golden positive MATMAS change pointer configuration with 100% field coverage",
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "change_document_object": "MATERIAL",
            "bd61_active": True,
            "bd61": True,
            "bd50_msg_types": ["MATMAS", "DEBMAS"],
            "bd50": [
                {"mestype": "MATMAS", "active": True, "description": "Material Master active"},
                {"mestype": "DEBMAS", "active": True, "description": "Customer Master active"}
            ],
            "bd52_fields": [
                ["MARA", "MATKL"], ["MARA", "GROES"], ["MARA", "MEINS"],
                ["MARA", "BRGEW"], ["MARA", "NTGEW"], ["MARA", "GEWEI"],
                ["MARA", "VOLUM"], ["MARA", "VOLEH"], ["MARA", "MTART"],
                ["MARA", "MBRSH"], ["MARA", "BISMT"], ["MARA", "SPART"],
                ["MARA", "PRDHA"], ["MARA", "MSTAE"], ["MARA", "MSTAV"],
                ["MARC", "WERKS"], ["MARC", "EKGRP"], ["MARC", "DISPO"],
                ["MARC", "DISMM"], ["MARC", "PLIFZ"], ["MARC", "PERKZ"],
                ["MARC", "MTVFP"], ["MARC", "PRCTR"], ["MVKE", "VKORG"],
                ["MVKE", "VTWEG"], ["MVKE", "DWERK"], ["MVKE", "KONDM"],
                ["MVKE", "KTGRM"], ["MVKE", "SKTOF"], ["MBEW", "BWKEY"],
                ["MBEW", "BKLAS"], ["MBEW", "VPRSV"], ["MBEW", "VERPR"],
                ["MBEW", "STPRS"], ["MBEW", "PEINH"]
            ],
            "expected_fields": [
                ["MARA", "MATKL"], ["MARA", "GROES"], ["MARA", "MEINS"],
                ["MARA", "BRGEW"], ["MARA", "NTGEW"], ["MARA", "GEWEI"],
                ["MARA", "VOLUM"], ["MARA", "VOLEH"], ["MARA", "MTART"],
                ["MARA", "MBRSH"], ["MARA", "BISMT"], ["MARA", "SPART"],
                ["MARA", "PRDHA"], ["MARA", "MSTAE"], ["MARA", "MSTAV"],
                ["MARC", "WERKS"], ["MARC", "EKGRP"], ["MARC", "DISPO"],
                ["MARC", "DISMM"], ["MARC", "PLIFZ"], ["MARC", "PERKZ"],
                ["MARC", "MTVFP"], ["MARC", "PRCTR"], ["MVKE", "VKORG"],
                ["MVKE", "VTWEG"], ["MVKE", "DWERK"], ["MVKE", "KONDM"],
                ["MVKE", "KTGRM"], ["MVKE", "SKTOF"], ["MBEW", "BWKEY"],
                ["MBEW", "BKLAS"], ["MBEW", "VPRSV"], ["MBEW", "VERPR"],
                ["MBEW", "STPRS"], ["MBEW", "PEINH"]
            ],
            "dd04l_metadata": {
                "MARA-MATKL": {"change_document_flag": True, "data_element": "MATKL"},
                "MARA-GROES": {"change_document_flag": True, "data_element": "GROES"},
                "MARA-MEINS": {"change_document_flag": True, "data_element": "MEINS"},
                "MARA-BRGEW": {"change_document_flag": True, "data_element": "BRGEW"},
                "MARA-NTGEW": {"change_document_flag": True, "data_element": "NTGEW"},
                "MARC-WERKS": {"change_document_flag": True, "data_element": "WERKS"},
                "MBEW-STPRS": {"change_document_flag": True, "data_element": "STPRS"}
            },
            "bdcp2_samples": [
                {"message_type": "MATMAS", "table": "MARA", "field": "MATKL", "process_status": "X", "count": 50},
                {"message_type": "MATMAS", "table": "MARA", "field": "GROES", "process_status": "X", "count": 30}
            ]
        },
        indent=2
    ),

    "cp_global_disabled.json": json.dumps(
        {
            "description": "Negative test: Inactive BD61 global change pointer activation with active BD50",
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "change_document_object": "MATERIAL",
            "bd61_active": False,
            "bd61": False,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [
                ["MARA", "MATKL"],
                ["MARA", "GROES"],
                ["MARA", "MEINS"]
            ],
            "expected_fields": [
                ["MARA", "MATKL"],
                ["MARA", "GROES"],
                ["MARA", "MEINS"]
            ]
        },
        indent=2
    ),

    "cp_missing_field.json": json.dumps(
        {
            "description": "Negative test: Expected business-critical fields omitted from BD52 table linkage",
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "change_document_object": "MATERIAL",
            "bd61_active": True,
            "bd61": True,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [
                ["MARA", "MATKL"],
                ["MARA", "MEINS"],
                ["MARA", "MTART"]
            ],
            "expected_fields": [
                ["MARA", "MATKL"],
                ["MARA", "MEINS"],
                ["MARA", "MTART"],
                ["MARA", "GROES"],
                ["MARA", "BRGEW"]
            ],
            "dd04l_metadata": {
                "MARA-MATKL": {"change_document_flag": True, "data_element": "MATKL"},
                "MARA-MEINS": {"change_document_flag": True, "data_element": "MEINS"},
                "MARA-MTART": {"change_document_flag": True, "data_element": "MTART"},
                "MARA-GROES": {"change_document_flag": True, "data_element": "GROES"},
                "MARA-BRGEW": {"change_document_flag": True, "data_element": "BRGEW"}
            }
        },
        indent=2
    ),

    "cp_dd04l_flag_missing.json": json.dumps(
        {
            "description": "Edge case: Field configured in BD52 but Data Element in DD04L lacks Change Document flag",
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "change_document_object": "MATERIAL",
            "bd61_active": True,
            "bd61": True,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [
                ["MARA", "MATKL"],
                ["MARA", "FERTH"]
            ],
            "expected_fields": [
                ["MARA", "MATKL"],
                ["MARA", "FERTH"]
            ],
            "dd04l_metadata": {
                "MARA-MATKL": {"change_document_flag": True, "data_element": "MATKL"},
                "MARA-FERTH": {"change_document_flag": False, "data_element": "FERTH"}
            }
        },
        indent=2
    ),

    "cp_custom_field_omitted.json": json.dumps(
        {
            "description": "Edge case: Custom table extension (YY1_) added to MARA but omitted from BD52 linkage",
            "message_type": "MATMAS",
            "target_message_type": "MATMAS",
            "change_document_object": "MATERIAL",
            "bd61_active": True,
            "bd61": True,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [
                ["MARA", "MATKL"],
                ["MARA", "GROES"]
            ],
            "expected_fields": [
                ["MARA", "MATKL"],
                ["MARA", "GROES"],
                ["MARA", "YY1_SUSTAINABILITY_SCORE"]
            ],
            "custom_fields": [
                {"table": "MARA", "field": "YY1_SUSTAINABILITY_SCORE", "rollname": "YY1_SUSTAINABILITY"}
            ]
        },
        indent=2
    ),

    "cp_bd52_config.csv": (
        "BD61,X\n"
        "BD50,MATMAS,X\n"
        "BD52,MATMAS,MATERIAL,MARA,MATKL\n"
        "BD52,MATMAS,MATERIAL,MARA,GROES\n"
        "BD52,MATMAS,MATERIAL,MARA,MEINS\n"
        "BD52,MATMAS,MATERIAL,MARC,WERKS\n"
        "BD52,MATMAS,MATERIAL,MBEW,STPRS\n"
        "EXPECTED,MARA,MATKL\n"
        "EXPECTED,MARA,GROES\n"
        "EXPECTED,MARA,MEINS\n"
        "EXPECTED,MARC,WERKS\n"
        "EXPECTED,MBEW,STPRS\n"
    ),

    # -------------------------------------------------------------------------
    # 2. API Change Guard Fixtures
    # -------------------------------------------------------------------------
    "api_openapi_clean.json": json.dumps(
        {
            "baseline": {
                "openapi": "3.0.0",
                "info": {"title": "SAP S/4HANA Purchase Order API", "version": "1.0.0"},
                "paths": {
                    "/purchase-orders": {
                        "get": {
                            "summary": "List Purchase Orders",
                            "parameters": [
                                {"name": "$top", "in": "query", "required": False, "schema": {"type": "integer"}}
                            ],
                            "responses": {
                                "200": {
                                    "description": "Success",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "array",
                                                "items": {"$ref": "#/components/schemas/PurchaseOrder"}
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "post": {
                            "summary": "Create Purchase Order",
                            "requestBody": {
                                "required": False,
                                "content": {
                                    "application/json": {
                                        "schema": {"$ref": "#/components/schemas/PurchaseOrderInput"}
                                    }
                                }
                            },
                            "responses": {"201": {"description": "Created"}}
                        }
                    }
                },
                "components": {
                    "schemas": {
                        "PurchaseOrder": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "companyCode": {"type": "string", "maxLength": 4},
                                "supplier": {"type": "string"},
                                "totalAmount": {"type": "number"},
                                "status": {"type": "string", "enum": ["OPEN", "PENDING", "APPROVED", "REJECTED"]}
                            },
                            "required": ["id", "companyCode", "supplier"]
                        },
                        "PurchaseOrderInput": {
                            "type": "object",
                            "properties": {
                                "companyCode": {"type": "string", "maxLength": 4},
                                "supplier": {"type": "string"},
                                "totalAmount": {"type": "number"}
                            },
                            "required": ["companyCode", "supplier"]
                        }
                    }
                }
            },
            "candidate": {
                "openapi": "3.0.0",
                "info": {"title": "SAP S/4HANA Purchase Order API", "version": "1.1.0"},
                "paths": {
                    "/purchase-orders": {
                        "get": {
                            "summary": "List Purchase Orders",
                            "parameters": [
                                {"name": "$top", "in": "query", "required": False, "schema": {"type": "integer"}}
                            ],
                            "responses": {
                                "200": {
                                    "description": "Success",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "array",
                                                "items": {"$ref": "#/components/schemas/PurchaseOrder"}
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "post": {
                            "summary": "Create Purchase Order",
                            "requestBody": {
                                "required": False,
                                "content": {
                                    "application/json": {
                                        "schema": {"$ref": "#/components/schemas/PurchaseOrderInput"}
                                    }
                                }
                            },
                            "responses": {"201": {"description": "Created"}}
                        }
                    },
                    "/purchase-orders/{id}/tracking": {
                        "get": {
                            "summary": "Track Purchase Order Delivery",
                            "responses": {"200": {"description": "Tracking details"}}
                        }
                    }
                },
                "components": {
                    "schemas": {
                        "PurchaseOrder": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "companyCode": {"type": "string", "maxLength": 4},
                                "supplier": {"type": "string"},
                                "totalAmount": {"type": "number"},
                                "status": {"type": "string", "enum": ["OPEN", "PENDING", "APPROVED", "REJECTED", "EXPRESS_HOLD"]},
                                "deliveryInstructions": {"type": "string"}
                            },
                            "required": ["id", "companyCode", "supplier"]
                        },
                        "PurchaseOrderInput": {
                            "type": "object",
                            "properties": {
                                "companyCode": {"type": "string", "maxLength": 4},
                                "supplier": {"type": "string"},
                                "totalAmount": {"type": "number"},
                                "deliveryInstructions": {"type": "string"}
                            },
                            "required": ["companyCode", "supplier"]
                        }
                    }
                }
            },
            "integrations": [
                {
                    "integration_id": "SALESFORCE_INTEGRATION_01",
                    "name": "Salesforce SCM Connector",
                    "consumed_endpoints": ["/purchase-orders"],
                    "consumed_fields": {
                        "PurchaseOrder": ["id", "supplier", "totalAmount"]
                    }
                }
            ]
        },
        indent=2
    ),

    "api_openapi_breaking.json": json.dumps(
        {
            "baseline": {
                "openapi": "3.0.0",
                "info": {"title": "SAP S/4HANA Purchase Order API", "version": "1.0.0"},
                "paths": {
                    "/A_PurchaseOrder": {
                        "get": {
                            "summary": "Retrieve purchase orders",
                            "parameters": [
                                {"name": "$top", "in": "query", "required": False, "schema": {"type": "integer"}}
                            ],
                            "responses": {"200": {"description": "Success"}}
                        },
                        "post": {
                            "summary": "Create purchase order",
                            "requestBody": {"required": False},
                            "responses": {"201": {"description": "Created"}}
                        }
                    },
                    "/A_PurchaseOrder('{PurchaseOrder}')": {
                        "get": {"summary": "Get specific purchase order"},
                        "delete": {"summary": "Cancel purchase order"}
                    }
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
                "info": {"title": "SAP S/4HANA Purchase Order API", "version": "2.0.0"},
                "paths": {
                    "/A_PurchaseOrder": {
                        "get": {
                            "summary": "Retrieve purchase orders",
                            "parameters": [
                                {"name": "$top", "in": "query", "required": False, "schema": {"type": "integer"}},
                                {"name": "X-Audit-Token", "in": "query", "required": True, "schema": {"type": "string"}}
                            ],
                            "responses": {"200": {"description": "Success"}}
                        },
                        "post": {
                            "summary": "Create purchase order",
                            "requestBody": {"required": True},
                            "responses": {"201": {"description": "Created"}}
                        }
                    },
                    "/A_PurchaseOrder('{PurchaseOrder}')": {
                        "get": {"summary": "Get specific purchase order"}
                        # BREAK: DELETE removed
                    }
                },
                "components": {
                    "schemas": {
                        "PurchaseOrder": {
                            "type": "object",
                            "required": ["PurchaseOrderID"],
                            "properties": {
                                "PurchaseOrderID": {"type": "string", "maxLength": 10},
                                "CompanyCode": {"type": "string", "maxLength": 2},
                                # BREAK: TaxJurisdictionCode removed
                                "OrderStatus": {"type": "string", "enum": ["OPEN", "APPROVED", "REJECTED"]}
                                # BREAK: PENDING removed
                            }
                        }
                    }
                }
            },
            "integrations": [
                {
                    "integration_id": "SALESFORCE_INTEGRATION_01",
                    "name": "Salesforce CRM Procurement Sync",
                    "system_type": "SALESFORCE",
                    "consumed_endpoints": ["/A_PurchaseOrder", "/A_PurchaseOrder('{PurchaseOrder}')"],
                    "consumed_fields": {
                        "PurchaseOrder": ["PurchaseOrderID", "TaxJurisdictionCode", "CompanyCode"]
                    },
                    "consumed_operations": {
                        "/A_PurchaseOrder('{PurchaseOrder}')": ["DELETE", "GET"]
                    }
                }
            ]
        },
        indent=2
    ),

    "api_odata_edmx_type_change.xml": (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:sap="http://www.sap.com/Protocols/SAPData">\n'
        '  <edmx:DataServices m:DataServiceVersion="2.0">\n'
        '    <Schema Namespace="API_BUSINESS_PARTNER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">\n'
        '      <EntityType Name="A_BusinessPartner">\n'
        '        <Key>\n'
        '          <PropertyRef Name="BusinessPartner"/>\n'
        '        </Key>\n'
        '        <Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10"/>\n'
        '        <!-- Type changed from Edm.String to Edm.Int64 -->\n'
        '        <Property Name="TaxNumber" Type="Edm.Int64" Nullable="true"/>\n'
        '        <!-- Nullable changed from true to false -->\n'
        '        <Property Name="CreditScore" Type="Edm.Int32" Nullable="false"/>\n'
        '        <!-- Non-breaking: Added optional property VIPStatus -->\n'
        '        <Property Name="VIPStatus" Type="Edm.Boolean" Nullable="true"/>\n'
        '      </EntityType>\n'
        '      <EntityContainer Name="API_BUSINESS_PARTNER_Entities" m:IsDefaultEntityContainer="true">\n'
        '        <EntitySet Name="A_BusinessPartner" EntityType="API_BUSINESS_PARTNER.A_BusinessPartner"/>\n'
        '      </EntityContainer>\n'
        '    </Schema>\n'
        '  </edmx:DataServices>\n'
        '</edmx:Edmx>\n'
    ),

    "api_integration_registry.json": json.dumps(
        {
            "version": "1.0.0",
            "environment": "PRODUCTION",
            "integrations": [
                {
                    "integration_id": "SALESFORCE_INTEGRATION_01",
                    "name": "Salesforce Sales & Service Cloud",
                    "system_type": "SALESFORCE",
                    "consumed_endpoints": ["/A_PurchaseOrder", "/A_PurchaseOrder('{PurchaseOrder}')"],
                    "consumed_entity_sets": ["A_PurchaseOrder", "A_BusinessPartnerAddress"],
                    "consumed_fields": {
                        "PurchaseOrder": ["PurchaseOrderID", "TaxJurisdictionCode", "CompanyCode"],
                        "A_BusinessPartnerAddressType": ["PostalCode", "Country"]
                    },
                    "consumed_operations": {
                        "/A_PurchaseOrder('{PurchaseOrder}')": ["DELETE", "GET"]
                    }
                },
                {
                    "integration_id": "SHOPIFY_SYNC_APP",
                    "name": "Shopify B2C Global Webstore",
                    "system_type": "SHOPIFY",
                    "consumed_endpoints": ["/orders"],
                    "consumed_fields": {
                        "SalesOrder": ["orderId", "orderStatus"]
                    }
                },
                {
                    "integration_id": "WMS_MANHATTAN_GATEWAY",
                    "name": "Manhattan Warehouse Management System",
                    "system_type": "WMS",
                    "consumed_endpoints": ["/orders/{id}"],
                    "consumed_operations": {
                        "/orders/{id}": ["DELETE"]
                    },
                    "consumed_fields": {
                        "SalesOrder": ["orderId"]
                    }
                }
            ]
        },
        indent=2
    ),

    "api_odata_edmx_baseline.xml": (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:sap="http://www.sap.com/Protocols/SAPData">\n'
        '  <edmx:DataServices m:DataServiceVersion="2.0">\n'
        '    <Schema Namespace="API_BUSINESS_PARTNER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">\n'
        '      <EntityType Name="A_BusinessPartner">\n'
        '        <Key>\n'
        '          <PropertyRef Name="BusinessPartner"/>\n'
        '        </Key>\n'
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
        '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:sap="http://www.sap.com/Protocols/SAPData">\n'
        '  <edmx:DataServices m:DataServiceVersion="2.0">\n'
        '    <Schema Namespace="API_BUSINESS_PARTNER" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">\n'
        '      <EntityType Name="A_BusinessPartner">\n'
        '        <Key>\n'
        '          <PropertyRef Name="BusinessPartner"/>\n'
        '        </Key>\n'
        '        <Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10"/>\n'
        '        <!-- BREAK: TaxNumber changed from Edm.String to Edm.Int64 -->\n'
        '        <Property Name="TaxNumber" Type="Edm.Int64" Nullable="true"/>\n'
        '        <!-- BREAK: CreditScore made mandatory (Nullable=false) -->\n'
        '        <Property Name="CreditScore" Type="Edm.Int32" Nullable="false"/>\n'
        '        <!-- NON-BREAK: Added optional property VIPStatus -->\n'
        '        <Property Name="VIPStatus" Type="Edm.Boolean" Nullable="true"/>\n'
        '      </EntityType>\n'
        '      <EntityContainer Name="API_BUSINESS_PARTNER_Entities" m:IsDefaultEntityContainer="true">\n'
        '        <EntitySet Name="A_BusinessPartner" EntityType="API_BUSINESS_PARTNER.A_BusinessPartner"/>\n'
        '        <!-- BREAK: ObsoleteLegacyPartners EntitySet REMOVED -->\n'
        '      </EntityContainer>\n'
        '    </Schema>\n'
        '  </edmx:DataServices>\n'
        '</edmx:Edmx>\n'
    ),
}


def provision_fixtures(target_dir: Path = FIXTURES_DIR) -> int:
    """Writes all 12 curated Domain 3 golden test fixtures to the target directory."""
    target_dir.mkdir(parents=True, exist_ok=True)
    print(f"[Domain 3 Provisioner] Target Directory: {target_dir}")
    print(f"[Domain 3 Provisioner] Generating {len(FIXTURE_DATA)} curated golden fixtures...")

    for filename, content in FIXTURE_DATA.items():
        file_path = target_dir / filename
        file_path.write_text(content, encoding="utf-8")
        sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
        print(f"  + Created: {filename} ({len(content)} bytes, sha256: {sha256[:12]}...)")

    print("[Domain 3 Provisioner] Successfully provisioned all Domain 3 fixtures.")
    return 0


if __name__ == "__main__":
    dest = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else FIXTURES_DIR
    sys.exit(provision_fixtures(dest))
