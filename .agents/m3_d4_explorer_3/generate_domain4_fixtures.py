"""
ERP Preflight — Domain 4 Golden Fixtures Provisioner
Generates all curated test fixtures under services/analysis-python/tests/fixtures/domain4/
Engines Covered:
1. Software Collection Dependency Guard (SOFTWARE_COLLECTION_DEPENDENCY_GUARD)
2. Transport Dependency Analyzer (TRANSPORT_DEPENDENCY_ANALYZER)

Governing Standard: AGENTS.md, Cardinal Axioms 1 & 2, engine-authoring.md, sap-evidence.md
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

# Resolve destination directory
FIXTURES_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "services"
    / "analysis-python"
    / "tests"
    / "fixtures"
    / "domain4"
)


FIXTURE_DATA = {
    # -------------------------------------------------------------------------
    # 1. Software Collection Dependency Guard Fixtures
    # -------------------------------------------------------------------------
    "sc_valid_sequence.json": json.dumps(
        {
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
        },
        indent=2
    ),

    "sc_circular.json": json.dumps(
        {
            "description": "Mutually dependent software collections forming a direct directed cycle (SC_FINANCE <-> SC_SALES)",
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
        },
        indent=2
    ),

    "sc_missing_prereq.json": json.dumps(
        {
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
        },
        indent=2
    ),

    "sc_draft_item.json": json.dumps(
        {
            "description": "Software collection containing a draft BAdI implementation (SC_DRAFT_ITEM_INCLUDED)",
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
        },
        indent=2
    ),

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

    "sc_dangling_field.json": json.dumps(
        {
            "description": "App variant referencing a custom field marked as DELETED or unresolvable",
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
        },
        indent=2
    ),

    # -------------------------------------------------------------------------
    # 2. Transport Dependency Analyzer Fixtures
    # -------------------------------------------------------------------------
    "tr_valid_sequence.json": json.dumps(
        {
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
        },
        indent=2
    ),

    "tr_valid_e070_e071.csv": (
        "TRKORR,PGMID,OBJECT,OBJ_NAME,AS4USER,AS4DATE,AS4TIME,TRSTATUS\n"
        "DEVK900010,R3TR,TABL,ZCUSTOMER,ARCHITECT,20260901,090000,R\n"
        "DEVK900020,R3TR,CLAS,ZCL_CUSTOMER_SVC,DEVELOPER1,20260902,100000,R\n"
        "DEVK900030,R3TR,PROG,ZCUSTOMER_RPT,DEVELOPER2,20260903,110000,R\n"
    ),

    "tr_collision.json": json.dumps(
        {
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
        },
        indent=2
    ),

    "tr_collision.csv": (
        "TRKORR,PGMID,OBJECT,OBJ_NAME,AS4USER,AS4DATE,AS4TIME,TRSTATUS\n"
        "DEVK900101,R3TR,CLAS,ZCL_ORDER_HANDLER,DEV1,20260901,100000,D\n"
        "DEVK900101,R3TR,TABL,ZORDERS,DEV1,20260901,100000,D\n"
        "DEVK900105,R3TR,CLAS,ZCL_ORDER_HANDLER,DEV2,20260902,140000,D\n"
        "DEVK900105,R3TR,PROG,ZREPORT,DEV2,20260902,140000,D\n"
    ),

    "tr_overtaker_downgrade.json": json.dumps(
        {
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
        },
        indent=2
    ),

    "tr_customizing_ahead_of_structure.json": json.dumps(
        {
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
        },
        indent=2
    ),

    "tr_circular_transports.json": json.dumps(
        {
            "description": "Mutually dependent transports forming circular call dependency (DEVK900201 <-> DEVK900202)",
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
        },
        indent=2
    ),

    "tr_e070_e071_complete.csv": (
        "TRKORR,PGMID,OBJECT,OBJ_NAME,AS4USER,AS4DATE,AS4TIME,TRSTATUS,OBJFUNC,TABLENAME,TABKEY\n"
        "DEVK900010,R3TR,TABL,ZCUSTOMER,ARCHITECT,20260901,090000,R, , , \n"
        "DEVK900020,R3TR,CLAS,ZCL_CUSTOMER_SVC,DEVELOPER1,20260902,100000,R, , , \n"
        "DEVK900030,R3TR,PROG,ZCUSTOMER_RPT,DEVELOPER2,20260903,110000,R, , , \n"
        "DEVK900080,R3TR,TABU,ZCONFIG,CONSULTANT,20260905,140000,R,K,ZCONFIG,100*\n"
    )
}


def provision_fixtures(target_dir: Path | None = None) -> list[tuple[str, int, str]]:
    """Provisions all Domain 4 fixtures to the target directory."""
    out_dir = target_dir or FIXTURES_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    print(f"=== Provisioning Domain 4 Golden Fixtures to {out_dir} ===")

    for filename, content in sorted(FIXTURE_DATA.items()):
        file_path = out_dir / filename
        file_path.write_text(content, encoding="utf-8")
        size = len(content.encode("utf-8"))
        sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
        manifest.append((filename, size, sha256))
        print(f"  [+] {filename:<38} {size:>6} B  sha256:{sha256[:12]}...")

    print(f"Successfully provisioned {len(manifest)} Domain 4 fixtures.\n")
    return manifest


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else FIXTURES_DIR
    provision_fixtures(target)
