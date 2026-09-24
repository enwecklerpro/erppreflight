"""ERP Preflight - Authentic SAP Fixtures Generator.

Generates realistic SAP artifacts across all preflight domains:
BRFplus OPD decision tables, Adobe Forms XDP/XML, ABAP source code,
SPRO IMG mappings, Transports, Change Pointers, Fiori traces, Workflows,
Account Determination matrices, and boundary/adversarial files.
"""

from __future__ import annotations
import json
import os
from pathlib import Path


FIXTURES_DIR = Path("H:/erppreflight/tests/e2e/fixtures")


def generate_all_fixtures():
    # 1. OPD Guard
    opd_dir = FIXTURES_DIR / "opd"
    opd_dir.mkdir(parents=True, exist_ok=True)

    opd_po_valid = {
        "scenario": {
            "DocumentType": "NB",
            "CompanyCode": "1000",
            "PurchasingOrg": "DE01",
            "Supplier": "100045",
        },
        "tables": {
            "Output Type": [{"COND_DocumentType": "NB", "RESULT": "PURCHASE_ORDER"}],
            "Receiver": [{"COND_DocumentType": "NB", "RESULT": "SUPPLIER_100045"}],
            "Channel": [{"COND_DocumentType": "NB", "RESULT": "EMAIL"}],
            "Printer": [{"COND_DocumentType": "NB", "RESULT": "LP01"}],
            "Email Recipient": [{"COND_PurchasingOrg": "DE01", "RESULT": "orders@supplier45.de"}],
            "Email Sender": [{"COND_CompanyCode": "1000", "RESULT": "procurement@acme.corp"}],
            "Form Template": [{"COND_DocumentType": "NB", "RESULT": "MM_PURCHASE_ORDER_DEFAULT"}],
            "Output Relevance": [{"COND_DocumentType": "NB", "RESULT": "TRUE"}],
        },
    }
    (opd_dir / "opd_po_valid.json").write_text(json.dumps(opd_po_valid, indent=2), encoding="utf-8")

    opd_po_missing_recipient = {
        "scenario": {
            "DocumentType": "NB",
            "CompanyCode": "1000",
            "PurchasingOrg": "US01",
            "Supplier": "999999",
        },
        "tables": {
            "Output Type": [{"COND_DocumentType": "NB", "RESULT": "PURCHASE_ORDER"}],
            "Receiver": [{"COND_DocumentType": "NB", "RESULT": "SUPPLIER_999999"}],
            "Channel": [{"COND_DocumentType": "NB", "RESULT": "EMAIL"}],
            "Printer": [{"COND_DocumentType": "NB", "RESULT": "LP01"}],
            "Email Recipient": [{"COND_PurchasingOrg": "DE01", "RESULT": "orders@supplier45.de"}],
            "Email Sender": [{"COND_CompanyCode": "1000", "RESULT": "procurement@acme.corp"}],
            "Form Template": [{"COND_DocumentType": "NB", "RESULT": "MM_PURCHASE_ORDER_DEFAULT"}],
            "Output Relevance": [{"COND_DocumentType": "NB", "RESULT": "TRUE"}],
        },
    }
    (opd_dir / "opd_po_missing_recipient.json").write_text(json.dumps(opd_po_missing_recipient, indent=2), encoding="utf-8")

    opd_shadowed = {
        "tables": {
            "Channel": [
                {"COND_DocumentType": "*", "RESULT": "PRINT"},
                {"COND_DocumentType": "NB", "RESULT": "EMAIL"},
                {"COND_DocumentType": "FO", "RESULT": "EDI"},
            ]
        }
    }
    (opd_dir / "opd_shadowed_rule.json").write_text(json.dumps(opd_shadowed, indent=2), encoding="utf-8")

    # 2. FormDoctor
    forms_dir = FIXTURES_DIR / "forms"
    forms_dir.mkdir(parents=True, exist_ok=True)

    invoice_xml = """<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
    <Header>
        <InvoiceID>90001234</InvoiceID>
        <Supplier>
            <ID>100045</ID>
            <Name>Bosch Rexroth AG</Name>
            <TaxNumber>DE123456789</TaxNumber>
        </Supplier>
        <TotalAmount Currency="EUR">14250.00</TotalAmount>
    </Header>
    <Items>
        <Item>
            <LineNumber>10</LineNumber>
            <ProductDescription>Hydraulic Valve</ProductDescription>
            <Quantity>5</Quantity>
            <NetPrice>2850.00</NetPrice>
        </Item>
    </Items>
</Invoice>"""
    (forms_dir / "invoice_payload.xml").write_text(invoice_xml, encoding="utf-8")

    invoice_xdp = """<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
    <template>
        <subform name="InvoiceForm" dataRef="$.Invoice">
            <field name="InvoiceNum">
                <bind match="dataRef" ref="$.Header.InvoiceID"/>
            </field>
            <field name="SupplierTax">
                <bind match="dataRef" ref="$.Header.Supplier.TaxNumber"/>
            </field>
        </subform>
    </template>
</xdp:xdp>"""
    (forms_dir / "invoice_template.xdp").write_text(invoice_xdp, encoding="utf-8")

    # 3. Custom Field Flow Doctor
    cf_dir = FIXTURES_DIR / "custom_fields"
    cf_dir.mkdir(parents=True, exist_ok=True)

    cf_data = {
        "field_name": "YY1_PROJECT_CODE",
        "hops": [
            ["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"],
            ["MM_SUPPLIER_INVOICE_ITEM", "FI_JOURNAL_ENTRY_ITEM"],
        ],
        "field_definitions": {
            "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 20},
            "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 20},
            "FI_JOURNAL_ENTRY_ITEM": {"type": "CHAR", "length": 20},
        },
    }
    (cf_dir / "custom_field_flow_po_to_gl.json").write_text(json.dumps(cf_data, indent=2), encoding="utf-8")

    cf_trunc = {
        "field_name": "YY1_LONG_DESC",
        "hops": [["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"]],
        "field_definitions": {
            "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 50},
            "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 20},
        },
    }
    (cf_dir / "custom_field_truncation.json").write_text(json.dumps(cf_trunc, indent=2), encoding="utf-8")

    # 4. Extension Impact Guard
    ext_dir = FIXTURES_DIR / "extension_impact"
    ext_dir.mkdir(parents=True, exist_ok=True)

    ext_graph = {
        "YY1_PROJECT_CODE": ["CDS_PURCHASE_ORDERS", "FORM_PURCHASE_ORDER"],
        "CDS_PURCHASE_ORDERS": ["API_PURCHASING_ANALYTICS"],
        "FORM_PURCHASE_ORDER": [],
        "API_PURCHASING_ANALYTICS": [],
    }
    (ext_dir / "extension_graph.json").write_text(json.dumps(ext_graph, indent=2), encoding="utf-8")

    # 5. Clean Core Object Guard
    cc_dir = FIXTURES_DIR / "clean_core"
    cc_dir.mkdir(parents=True, exist_ok=True)

    clean_abap = """CLASS zcl_clean_order DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_clean_order IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    SELECT product, producttype
      FROM i_product
      WHERE product = 'MAT01'
      INTO TABLE @DATA(lt_products).
    out->write( lt_products ).
  ENDMETHOD.
ENDCLASS."""
    (cc_dir / "clean_core_compliant.abap").write_text(clean_abap, encoding="utf-8")

    legacy_abap = """REPORT zlegacy_order_report.

TABLES: mara, vbak.

DATA: lt_mara TYPE TABLE OF mara.

START-OF-SELECTION.
  PERFORM get_materials.

FORM get_materials.
  SELECT * FROM mara INTO TABLE lt_mara WHERE mtart = 'ROH'.
  CALL 'SYSTEM' ID 'COMMAND' FIELD 'ls -la'.
ENDFORM."""
    (cc_dir / "clean_core_legacy.abap").write_text(legacy_abap, encoding="utf-8")

    # 6. Change Pointer Coverage Auditor
    cp_dir = FIXTURES_DIR / "change_pointer"
    cp_dir.mkdir(parents=True, exist_ok=True)

    cp_valid = {
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"], ["MARA", "GROES"], ["MARA", "MEINS"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "GROES"], ["MARA", "MEINS"]],
    }
    (cp_dir / "cp_valid.json").write_text(json.dumps(cp_valid, indent=2), encoding="utf-8")

    cp_missing = {
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"], ["MARA", "MEINS"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "GROES"], ["MARA", "MEINS"]],
    }
    (cp_dir / "cp_missing_groes.json").write_text(json.dumps(cp_missing, indent=2), encoding="utf-8")

    cp_glob_off = {
        "bd61_active": False,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
    }
    (cp_dir / "cp_global_disabled.json").write_text(json.dumps(cp_glob_off, indent=2), encoding="utf-8")

    # 7. API Change Guard
    api_dir = FIXTURES_DIR / "api_change"
    api_dir.mkdir(parents=True, exist_ok=True)

    base_api = {
        "paths": {
            "/api/v1/purchase-orders": ["get", "post"],
            "/api/v1/purchase-orders/{id}": ["get", "delete"],
        },
        "components": {
            "schemas": {
                "PurchaseOrder": {
                    "properties": {
                        "id": {"type": "string"},
                        "supplier": {"type": "string"},
                        "taxJurisdiction": {"type": "string"},
                    }
                }
            }
        },
    }
    (api_dir / "api_baseline.json").write_text(json.dumps(base_api, indent=2), encoding="utf-8")

    breaking_api = {
        "paths": {
            "/api/v1/purchase-orders": ["get", "post"],
        },
        "components": {
            "schemas": {
                "PurchaseOrder": {
                    "properties": {
                        "id": {"type": "string"},
                        "supplier": {"type": "string"},
                    }
                }
            }
        },
    }
    (api_dir / "api_breaking.json").write_text(json.dumps(breaking_api, indent=2), encoding="utf-8")

    # 8. Software Collection Guard
    sc_dir = FIXTURES_DIR / "software_collection"
    sc_dir.mkdir(parents=True, exist_ok=True)

    sc_circ = {
        "collections": ["SC_FINANCE", "SC_SALES"],
        "dependencies": {
            "SC_FINANCE": ["SC_SALES"],
            "SC_SALES": ["SC_FINANCE"],
        },
    }
    (sc_dir / "sc_circular.json").write_text(json.dumps(sc_circ, indent=2), encoding="utf-8")

    # 9. Transport Dependency Analyzer
    tr_dir = FIXTURES_DIR / "transport"
    tr_dir.mkdir(parents=True, exist_ok=True)

    tr_coll = {
        "transports": {
            "DEVK900101": ["CLAS ZCL_ORDER_HANDLER", "TABL ZORDERS"],
            "DEVK900105": ["CLAS ZCL_ORDER_HANDLER", "PROG ZREPORT"],
            "DEVK900090": ["TABL ZCONFIG"],
        }
    }
    (tr_dir / "tr_collision.json").write_text(json.dumps(tr_coll, indent=2), encoding="utf-8")

    # 10. Safe Decommission
    decom_dir = FIXTURES_DIR / "decommission"
    decom_dir.mkdir(parents=True, exist_ok=True)

    decom_user = {
        "target_user": "BATCH_ADMIN",
        "batch_jobs": [
            {"job_name": "SAP_BILLING_NIGHTLY", "auth_user": "BATCH_ADMIN", "status": "SCHEDULED"},
            {"job_name": "SAP_INDEX_CLEANUP", "auth_user": "SYSTEM", "status": "SCHEDULED"},
        ],
        "rfc_destinations": [
            {"destination": "SAP_B2B_GATEWAY", "logon_user": "BATCH_ADMIN", "active": True},
        ],
    }
    (decom_dir / "decom_user_dependencies.json").write_text(json.dumps(decom_user, indent=2), encoding="utf-8")

    # 11. Fiori 403 Doctor
    fiori_dir = FIXTURES_DIR / "fiori403"
    fiori_dir.mkdir(parents=True, exist_ok=True)

    fiori_auth = {
        "status_code": 403,
        "su53_failed_objects": ["S_SERVICE", "S_START"],
        "icf_inactive_paths": [],
        "is_post_without_csrf": False,
    }
    (fiori_dir / "fiori_su53_missing.json").write_text(json.dumps(fiori_auth, indent=2), encoding="utf-8")

    fiori_icf = {
        "status_code": 403,
        "su53_failed_objects": [],
        "icf_inactive_paths": ["/sap/opu/odata/sap/C_SALESORDER_CDS/"],
        "is_post_without_csrf": False,
    }
    (fiori_dir / "fiori_icf_inactive.json").write_text(json.dumps(fiori_icf, indent=2), encoding="utf-8")

    # 12. Workflow Stuck Explainer
    wf_dir = FIXTURES_DIR / "workflow"
    wf_dir.mkdir(parents=True, exist_ok=True)

    wf_data = {
        "work_items": [
            {"id": "0000045012", "task": "TS00008267", "status": "READY", "agents": []},
            {"id": "0000045015", "task": "TS00008268", "status": "COMPLETED", "agents": ["USER01"]},
            {"id": "0000045020", "task": "TS00008270", "status": "ERROR", "dump": True, "exception_class": "CX_SY_REF_IS_INITIAL"},
        ]
    }
    (wf_dir / "wf_stuck_sample.json").write_text(json.dumps(wf_data, indent=2), encoding="utf-8")

    # 13. Account Determination Preflight
    acct_dir = FIXTURES_DIR / "account_det"
    acct_dir.mkdir(parents=True, exist_ok=True)

    acct_data = {
        "rules": [
            {"transaction_key": "BSX", "valuation_class": "3000", "gl_account": "140000"},
            {"transaction_key": "WRX", "valuation_class": "3000", "gl_account": "211000"},
            {"transaction_key": "PRD", "valuation_class": "3000", "gl_account": ""},  # Missing
            {"transaction_key": "GBB", "valuation_class": "3000", "gl_account": "999999"},  # Blocked
        ],
        "chart_of_accounts": {
            "140000": {"name": "Inventory Raw Materials", "blocked_for_posting": False},
            "211000": {"name": "GR/IR Clearing Account", "blocked_for_posting": False},
            "999999": {"name": "Obsolete Suspense", "blocked_for_posting": True},
        },
    }
    (acct_dir / "obyc_rules_sample.json").write_text(json.dumps(acct_data, indent=2), encoding="utf-8")

    # 14. System Refresh Delta Guard
    sr_dir = FIXTURES_DIR / "system_refresh"
    sr_dir.mkdir(parents=True, exist_ok=True)

    sr_data = {
        "pre_refresh_rfcs": {
            "SAP_PAYMENT_GW": "prod-bank.corp.internal",
            "SAP_ARIBA_B2B": "prod-ariba.corp.internal",
        },
        "post_refresh_rfcs": {
            "SAP_PAYMENT_GW": "prod-bank.corp.internal",  # Leaked PRD host!
            "SAP_ARIBA_B2B": "qa-ariba.corp.internal",
        },
        "scot_outbound_active": True,
    }
    (sr_dir / "system_refresh_sample.json").write_text(json.dumps(sr_data, indent=2), encoding="utf-8")

    # 15. MFS BlackBox
    mfs_dir = FIXTURES_DIR / "mfs"
    mfs_dir.mkdir(parents=True, exist_ok=True)

    mfs_data = {
        "telegrams": [
            {"type": "MOVE", "hu_id": "HU_8811", "cp": "CP01", "time_sec": 10.0},
            {"type": "ACK", "hu_id": "HU_8811", "cp": "CP01", "time_sec": 10.2},
            {"type": "MOVE", "hu_id": "HU_8811", "cp": "CP05", "time_sec": 12.5},  # Jump!
        ],
        "conveyor_edges": [["CP01", "CP02"], ["CP02", "CP03"], ["CP03", "CP04"], ["CP04", "CP05"]],
    }
    (mfs_dir / "mfs_jump_stream.json").write_text(json.dumps(mfs_data, indent=2), encoding="utf-8")

    # 16. Boundary & Adversarial
    bnd_dir = FIXTURES_DIR / "boundary"
    bnd_dir.mkdir(parents=True, exist_ok=True)

    adversarial_xxe = """<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [  
  <!ELEMENT foo ANY >
  <!ENTITY xxe SYSTEM "file:///etc/passwd" >]>
<foo>&xxe;</foo>"""
    (bnd_dir / "malicious_xxe.xml").write_text(adversarial_xxe, encoding="utf-8")

    secrets_log = """2026-09-24 03:00:01 INFO [RFC_CONNECT] User authenticated:
RFC_USER=SAP_RFC_ADMIN; RFC_PASS='SecretP@ssw0rd99!'; HOST=sap-prd.corp
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.xxxx
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0wM8h...PRIVATE_KEY_DATA...
-----END RSA PRIVATE KEY-----
api_key = "sk-live-0987654321fedcba0987654321"
"""
    (bnd_dir / "transport_secret_injection.log").write_text(secrets_log, encoding="utf-8")

    print(f"Successfully generated all authentic SAP and boundary fixtures in {FIXTURES_DIR}")


if __name__ == "__main__":
    generate_all_fixtures()
