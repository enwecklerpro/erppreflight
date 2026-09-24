"""Golden Fixture Generator for Domain 5 (Operations) Preflight Engines.

Provisions curated positive, negative, and edge-case test fixtures for all 6 Domain 5 engines:
- Feature 30: Safe Decommission Preflight (SAFE_DECOMMISSION_PREFLIGHT)
- Feature 31: Fiori 403 Root-Cause Doctor (FIORI_403_ROOT_CAUSE_DOCTOR)
- Feature 32: Workflow Stuck Explainer (WORKFLOW_STUCK_EXPLAINER)
- Feature 33: IAM Cost Optimizer (IAM_COST_OPTIMIZER)
- Feature 34: Account Determination Preflight (ACCOUNT_DETERMINATION_PREFLIGHT)
- Feature 35: System Refresh Delta Guard (SYSTEM_REFRESH_DELTA_GUARD)

Target Output Directory:
`services/analysis-python/tests/fixtures/domain5/`
"""

import json
import os
from pathlib import Path


def generate_all_fixtures():
    # Resolve project root and domain5 fixture directory
    current_file = Path(__file__).resolve()
    repo_root = None
    for parent in current_file.parents:
        if (parent / "services" / "analysis-python").is_dir():
            repo_root = parent
            break
    if not repo_root:
        repo_root = Path("H:/erppreflight")

    fixture_dir = repo_root / "services" / "analysis-python" / "tests" / "fixtures" / "domain5"
    fixture_dir.mkdir(parents=True, exist_ok=True)

    fixtures = {}

    # =========================================================================
    # Feature 30: Safe Decommission Preflight Fixtures
    # =========================================================================
    fixtures["decom_job_dependency.json"] = {
        "target_user": "BATCH_FIN_01",
        "users": [
            {"bname": "BATCH_FIN_01", "user_type": "B", "lock_status": 0}
        ],
        "jobs": [
            {
                "job_name": "SAP_FI_MONTH_END_CLOSE",
                "job_count": "00000001",
                "scheduler": "BATCH_FIN_01",
                "exec_user": "BATCH_FIN_01",
                "status": "SCHEDULED",
                "periodic": True
            }
        ],
        "rfc_destinations": [],
        "work_items": []
    }

    fixtures["decom_rfc_dependency.json"] = {
        "target_user": "RFC_B2B_GW",
        "users": [
            {"bname": "RFC_B2B_GW", "user_type": "C", "lock_status": 0}
        ],
        "jobs": [],
        "rfc_destinations": [
            {
                "destination": "SAP_ARIBA_B2B",
                "dest_type": "3",
                "username": "RFC_B2B_GW",
                "target_host": "ariba-integration.corp.local"
            }
        ],
        "work_items": []
    }

    fixtures["decom_clean_user.json"] = {
        "target_user": "TEST_RETIRED_USER",
        "users": [
            {"bname": "TEST_RETIRED_USER", "user_type": "A", "lock_status": 128}
        ],
        "jobs": [],
        "rfc_destinations": [],
        "work_items": []
    }

    # =========================================================================
    # Feature 31: Fiori 403 Root-Cause Doctor Fixtures
    # =========================================================================
    fixtures["fiori_icf_inactive.json"] = {
        "http_response": {
            "status_code": 403,
            "method": "GET",
            "url": "/sap/opu/odata/sap/C_SALESORDER_CDS/$metadata"
        },
        "icf_services": [
            {
                "service_path": "/sap/opu/odata/sap/C_SALESORDER_CDS",
                "is_active": False
            }
        ],
        "su53_traces": [],
        "ucon_rules": []
    }

    fixtures["fiori_auth_missing.json"] = {
        "http_response": {
            "status_code": 403,
            "method": "GET",
            "url": "/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/"
        },
        "icf_services": [
            {
                "service_path": "/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV",
                "is_active": True
            }
        ],
        "su53_traces": [
            {
                "auth_object": "S_SERVICE",
                "return_code": 4,
                "field_values": {"SRV_NAME": "API_PURCHASEORDER_PROCESS_SRV"}
            }
        ]
    }

    fixtures["fiori_clean_pass.json"] = {
        "http_response": {
            "status_code": 200,
            "method": "GET",
            "url": "/sap/opu/odata/sap/C_CUSTOMER_CDS/$metadata"
        },
        "icf_services": [
            {
                "service_path": "/sap/opu/odata/sap/C_CUSTOMER_CDS",
                "is_active": True
            }
        ],
        "su53_traces": []
    }

    # =========================================================================
    # Feature 32: Workflow Stuck Explainer Fixtures
    # =========================================================================
    fixtures["wf_stuck_no_agent.json"] = {
        "headers": [
            {
                "wi_id": "0000045012",
                "wi_type": "D",
                "wi_stat": "READY",
                "wi_rh_task": "TS00008267",
                "wi_cd": "20260101"
            }
        ],
        "agent_traces": [
            {
                "wi_id": "0000045012",
                "rule_id": "00000168",
                "resolved_agents": [],
                "resolved_count": 0
            }
        ],
        "logs": []
    }

    fixtures["wf_background_failed.json"] = {
        "headers": [
            {
                "wi_id": "0000098231",
                "wi_type": "B",
                "wi_stat": "ERROR",
                "wi_rh_task": "TS00007988"
            }
        ],
        "logs": [
            {
                "wi_id": "0000098231",
                "retcode": 4,
                "exception": "CX_SY_OPEN_SQL_DB: Duplicate key insert into VBKOK"
            }
        ],
        "agent_traces": []
    }

    fixtures["wf_clean_running.json"] = {
        "headers": [
            {
                "wi_id": "0000012345",
                "wi_type": "W",
                "wi_stat": "READY",
                "wi_rh_task": "TS00008001"
            }
        ],
        "agent_traces": [
            {
                "wi_id": "0000012345",
                "resolved_agents": ["USER_MGR_01"],
                "resolved_count": 1
            }
        ],
        "logs": []
    }

    # =========================================================================
    # Feature 33: IAM Cost Optimizer Fixtures
    # =========================================================================
    fixtures["iam_redundant_catalog.json"] = {
        "roles": [
            {
                "role_name": "Z_SD_ORDER_CLERK",
                "description": "Sales Order Entry Clerk",
                "catalogs": ["SAP_SD_BC_SO_DISPLAY", "SAP_SD_BC_SO_FULL"],
                "assigned_users": ["CLERK_01", "CLERK_02"],
                "authorizations": []
            }
        ],
        "catalogs": [
            {
                "catalog_id": "SAP_SD_BC_SO_DISPLAY",
                "catalog_name": "Sales Order Display Catalog",
                "apps": ["VA03", "F1813"]
            },
            {
                "catalog_id": "SAP_SD_BC_SO_FULL",
                "catalog_name": "Sales Order Full Processing Catalog",
                "apps": ["VA01", "VA02", "VA03", "F1813"]
            }
        ],
        "users": [
            {"user_id": "CLERK_01", "assigned_roles": ["Z_SD_ORDER_CLERK"]},
            {"user_id": "CLERK_02", "assigned_roles": ["Z_SD_ORDER_CLERK"]}
        ],
        "price_categories": {
            "VA01": "ADVANCED",
            "VA02": "ADVANCED",
            "VA03": "CORE",
            "F1813": "SELF_SERVICE"
        },
        "usage_records": []
    }

    fixtures["iam_license_escalation.json"] = {
        "roles": [
            {
                "role_name": "Z_FI_INVOICE_PROCESSOR",
                "description": "Invoice Entry and Display Clerks",
                "catalogs": ["Z_CAT_FI_CLERK"],
                "assigned_users": [f"FI_USER_{i:02d}" for i in range(1, 51)],
                "authorizations": []
            }
        ],
        "catalogs": [
            {
                "catalog_id": "Z_CAT_FI_CLERK",
                "catalog_name": "Accounts Payable Operations",
                "apps": ["FB03", "F0842", "CATS", "FB08"]
            }
        ],
        "users": [
            {"user_id": f"FI_USER_{i:02d}", "assigned_roles": ["Z_FI_INVOICE_PROCESSOR"]}
            for i in range(1, 51)
        ],
        "price_categories": {
            "FB08": "ADVANCED",
            "FB03": "CORE",
            "F0842": "CORE",
            "CATS": "SELF_SERVICE"
        },
        "usage_records": []
    }

    fixtures["iam_unused_privilege.json"] = {
        "roles": [
            {
                "role_name": "Z_MM_BUYER_RESTRICTED",
                "description": "Standard Operational Purchasing Role",
                "catalogs": ["SAP_MM_BC_PO_PROC"],
                "assigned_users": ["BUYER_01", "BUYER_02"],
                "authorizations": [
                    {"object": "S_TABU_DIS", "field": "ACTVT", "value": "02"}
                ]
            }
        ],
        "catalogs": [
            {
                "catalog_id": "SAP_MM_BC_PO_PROC",
                "catalog_name": "Purchasing Operational Processing",
                "apps": ["ME51N", "ME21N"]
            }
        ],
        "users": [
            {"user_id": "BUYER_01", "assigned_roles": ["Z_MM_BUYER_RESTRICTED"]},
            {"user_id": "BUYER_02", "assigned_roles": ["Z_MM_BUYER_RESTRICTED"]}
        ],
        "price_categories": {},
        "usage_records": [
            {"user_id": "BUYER_01", "app_id": "ME21N", "execution_count": 140},
            {"user_id": "BUYER_02", "app_id": "ME51N", "execution_count": 85}
        ]
    }

    fixtures["iam_clean_role.json"] = {
        "roles": [
            {
                "role_name": "Z_EMPLOYEE_SELF_SERVICE",
                "description": "Pure Employee Self-Service",
                "catalogs": ["SAP_BC_ESS_STANDARD"],
                "assigned_users": ["EMP_001", "EMP_002"],
                "authorizations": []
            }
        ],
        "catalogs": [
            {
                "catalog_id": "SAP_BC_ESS_STANDARD",
                "catalog_name": "Standard ESS Services",
                "apps": ["CATS", "F1234", "F1311"]
            }
        ],
        "users": [
            {"user_id": "EMP_001", "assigned_roles": ["Z_EMPLOYEE_SELF_SERVICE"]},
            {"user_id": "EMP_002", "assigned_roles": ["Z_EMPLOYEE_SELF_SERVICE"]}
        ],
        "price_categories": {
            "CATS": "SELF_SERVICE",
            "F1234": "SELF_SERVICE",
            "F1311": "SELF_SERVICE"
        },
        "usage_records": []
    }

    # CSV Fixture for IAM
    iam_csv_content = """AGR_NAME,UNAME,FROM_DAT,TO_DAT
Z_SD_ROLE,USER_SD_01,20260101,99991231
Z_SD_ROLE,USER_SD_02,20260101,99991231
Z_EMERGENCY_FIRECUT,SUPER_ADMIN,20260101,99991231
"""
    fixtures["iam_role_matrix.csv"] = iam_csv_content

    # =========================================================================
    # Feature 34: Account Determination Preflight Fixtures
    # =========================================================================
    fixtures["acct_det_missing_bsx.json"] = {
        "chart_of_accounts": "CA01",
        "company_code": "1000",
        "obyc_rules": [
            {
                "chart_of_accounts": "CA01",
                "transaction_key": "BSX",
                "valuation_class": "3000",
                "gl_account": None
            },
            {
                "chart_of_accounts": "CA01",
                "transaction_key": "WRX",
                "valuation_class": "3000",
                "gl_account": "211000"
            }
        ],
        "vkoa_rules": [],
        "ska1_accounts": [
            {"chart_of_accounts": "CA01", "gl_account": "211000", "xsperr": False}
        ],
        "skb1_accounts": [
            {"company_code": "1000", "gl_account": "211000", "xsperr": False}
        ],
        "valuation_classes": []
    }

    fixtures["acct_det_blocked_posting.json"] = {
        "chart_of_accounts": "CA01",
        "company_code": "1000",
        "obyc_rules": [
            {
                "chart_of_accounts": "CA01",
                "transaction_key": "BSX",
                "valuation_class": "3000",
                "gl_account": "140000"
            }
        ],
        "vkoa_rules": [],
        "ska1_accounts": [
            {"chart_of_accounts": "CA01", "gl_account": "140000", "xsperr": True, "name": "Raw Materials Stock (Blocked)"}
        ],
        "skb1_accounts": [
            {"company_code": "1000", "gl_account": "140000", "xsperr": False}
        ],
        "valuation_classes": []
    }

    fixtures["acct_det_conflicting_rules.json"] = {
        "chart_of_accounts": "CA01",
        "company_code": "1000",
        "obyc_rules": [
            {
                "chart_of_accounts": "CA01",
                "transaction_key": "BSX",
                "valuation_class": "3000",
                "gl_account": "140000"
            },
            {
                "chart_of_accounts": "CA01",
                "transaction_key": "BSX",
                "valuation_class": "3000",
                "gl_account": "140999"
            }
        ],
        "vkoa_rules": [],
        "ska1_accounts": [
            {"chart_of_accounts": "CA01", "gl_account": "140000", "xsperr": False},
            {"chart_of_accounts": "CA01", "gl_account": "140999", "xsperr": False}
        ],
        "skb1_accounts": [],
        "valuation_classes": []
    }

    fixtures["acct_det_clean_vkoa.json"] = {
        "chart_of_accounts": "CA01",
        "company_code": "1000",
        "obyc_rules": [
            {
                "chart_of_accounts": "CA01",
                "transaction_key": "BSX",
                "valuation_class": "3000",
                "gl_account": "140000"
            },
            {
                "chart_of_accounts": "CA01",
                "transaction_key": "WRX",
                "valuation_class": "3000",
                "gl_account": "211000"
            }
        ],
        "vkoa_rules": [
            {
                "chart_of_accounts": "CA01",
                "sales_org": "1010",
                "customer_aag": "01",
                "material_aag": "01",
                "account_key": "ERL",
                "gl_account": "800000"
            }
        ],
        "ska1_accounts": [
            {"chart_of_accounts": "CA01", "gl_account": "140000", "xsperr": False},
            {"chart_of_accounts": "CA01", "gl_account": "211000", "xsperr": False},
            {"chart_of_accounts": "CA01", "gl_account": "800000", "xsperr": False}
        ],
        "skb1_accounts": [
            {"company_code": "1000", "gl_account": "140000", "xsperr": False},
            {"company_code": "1000", "gl_account": "211000", "xsperr": False},
            {"company_code": "1000", "gl_account": "800000", "xsperr": False}
        ],
        "valuation_classes": []
    }

    # CSV Fixture for Account Determination
    acct_csv_content = """KTOPL,KTOSL,BKLAS,GL_ACCOUNT
CA01,BSX,3000,140000
CA01,WRX,3000,211000
CA01,PRD,3000,
"""
    fixtures["acct_det_matrix.csv"] = acct_csv_content

    # =========================================================================
    # Feature 35: System Refresh Delta Guard Fixtures
    # =========================================================================
    fixtures["refresh_rfc_production.json"] = {
        "sid": "QAS",
        "client": "100",
        "rfc_destinations": [
            {
                "destination": "SAP_PROD_CENTRAL",
                "target_host": "prd-app01.erp.corp.internal"
            }
        ],
        "scot": {
            "smtp_active": False,
            "redirect_all_to": "test@corp.internal"
        }
    }

    fixtures["refresh_scot_active.json"] = {
        "sid": "QAS",
        "client": "100",
        "rfc_destinations": [
            {
                "destination": "SAP_QA_CENTRAL",
                "target_host": "qas-app01.erp.corp.internal"
            }
        ],
        "scot": {
            "smtp_active": True,
            "routing_domain": "*",
            "redirect_all_to": None
        }
    }

    fixtures["refresh_clean_isolated.json"] = {
        "sid": "QAS",
        "client": "100",
        "rfc_destinations": [
            {
                "destination": "SAP_QA_CENTRAL",
                "target_host": "qas-app01.erp.corp.internal"
            }
        ],
        "scot": {
            "smtp_active": True,
            "redirect_all_to": "qa-catchall@test.corp"
        },
        "logical_systems": [
            {
                "client": "100",
                "logical_system": "QASCLNT100",
                "expected_logical_system": "QASCLNT100",
                "bdls_executed": True
            }
        ]
    }

    # Write all fixtures
    written_count = 0
    for filename, content in fixtures.items():
        file_path = fixture_dir / filename
        if isinstance(content, dict):
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(content, f, indent=2)
        else:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)
        written_count += 1

    print(f"Successfully provisioned {written_count} golden fixtures into {fixture_dir}")
    return written_count


if __name__ == "__main__":
    generate_all_fixtures()
