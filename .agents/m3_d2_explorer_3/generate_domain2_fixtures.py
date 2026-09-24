"""
ERP Preflight — Domain 2 Golden Fixtures Provisioner
Generates all 12 curated test fixtures under services/analysis-python/tests/fixtures/domain2/
Engines Covered:
1. SPRO2Cloud (SPRO2CLOUD)
2. ECC2Cloud Navigator (ECC2CLOUD_NAVIGATOR)
3. SAP Gap Radar (SAP_GAP_RADAR)
4. Clean Core Object Guard (CLEAN_CORE_OBJECT_GUARD)
"""

import hashlib
import sys
from pathlib import Path

# Resolve destination directory
FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "services" / "analysis-python" / "tests" / "fixtures" / "domain2"

FIXTURE_DATA = {
    # -------------------------------------------------------------------------
    # 1. SPRO2Cloud Fixtures
    # -------------------------------------------------------------------------
    "spro_standard_valid.csv": (
        "ActivityID,ActivityName,Module,TargetTable,CountryCode\n"
        "SIMG_CFMENUOLSDVOFA,Define Billing Types,SD,TVFK,DE\n"
        "SIMG_CFMENUOLSDVOV8,Define Sales Document Types,SD,TVAK,DE\n"
        "SIMG_CFMENUOLMEOMH5,Define Purchasing Document Types,MM,T161,DE\n"
        "SIMG_CFMENUORKSOKP3,Define Settlement Profiles,CO,TKO08,DE\n"
    ),
    "spro_negative_unsupported.csv": (
        "ActivityID,ActivityName,Module,TargetTable,CountryCode\n"
        "SIMG_CFMENUORFBFISL,Special Ledger (FI-SL),FI,GLT0,DE\n"
        "SIMG_CFMENUOLSDVOFM,Define Formulas and Requirements (VOFM),SD,TFRM,DE\n"
        "SIMG_CFMENUORFBOB08,Define Posting Keys,FI,TBSL,DE\n"
    ),
    "spro_custom_z_activity.json": '''{
  "target_release": "S4HC_2408",
  "target_country": "US",
  "activities": [
    {
      "activity_id": "ZIMG_CUSTOM_TAX_OVERRIDE",
      "activity_name": "Custom Dynamic Tax Jurisdiction Engine",
      "module": "FI",
      "target_table": "ZTTAX_RULES",
      "country_code": "US"
    },
    {
      "activity_id": "SIMG_IT_ASSET_DEPRECIATION_CALC",
      "activity_name": "Italian Local Statutory Depreciation Method",
      "module": "FI",
      "target_table": "T090NA",
      "country_code": "IT"
    }
  ]
}''',

    # -------------------------------------------------------------------------
    # 2. ECC2Cloud Navigator Fixtures
    # -------------------------------------------------------------------------
    "ecc_st03n_clean.csv": (
        "TCode,ExecutionCount,AvgResponseTimeMs,UserCount,Module\n"
        "ME21N,142050,420,128,MM\n"
        "VA01,98400,380,95,SD\n"
        "FB01,85200,310,64,FI\n"
        "MM01,210000,180,310,MM\n"
    ),
    "ecc_obsolete_blockers.csv": (
        "TCode,ExecutionCount,AvgResponseTimeMs,UserCount,Module\n"
        "ZVA01_OBSOLETE,450000,850,210,SD\n"
        "SE38,32000,120,14,BC\n"
        "SM30,48000,190,22,BC\n"
        "XD01,75000,410,48,SD\n"
    ),
    "ecc_interface_inventory.json": '''{
  "system_id": "PRD_ECC60",
  "target_release": "S4HC_2408",
  "objects": [
    {
      "name": "BAPI_MATERIAL_SAVEDATA",
      "type": "BAPI",
      "executions": 85000,
      "caller_systems": ["MES_FACTORY_1", "PLM_TEAMCENTER"]
    },
    {
      "name": "ORDERS05",
      "type": "IDOC",
      "executions": 120000,
      "direction": "INBOUND"
    },
    {
      "name": "RFC_READ_TABLE",
      "type": "RFC",
      "executions": 14000,
      "is_custom": false
    }
  ]
}''',

    # -------------------------------------------------------------------------
    # 3. SAP Gap Radar Fixtures
    # -------------------------------------------------------------------------
    "gap_radar_event_mesh.json": '''{
  "requirement_id": "REQ-LOG-001",
  "title": "Real-time High Value PO External Notification",
  "requirement": "Trigger external webhook event mesh on purchase order release when total value exceeds 100,000 EUR",
  "description": "Trigger external webhook event mesh on purchase order release when total value exceeds 100,000 EUR",
  "target_edition": "Public",
  "target_release": "2408",
  "module": "MM"
}''',
    "gap_radar_direct_db_write.json": '''{
  "requirement_id": "REQ-FIN-666",
  "title": "Direct Accounting Ledger Status Override",
  "requirement": "Directly update BSEG database table and line items in ACDOCA via custom SQL trigger",
  "description": "Directly update BSEG database table and line items in ACDOCA via custom SQL trigger",
  "target_edition": "Public",
  "target_release": "2408",
  "module": "FI"
}''',
    "gap_radar_known_gap.json": '''{
  "requirement_id": "REQ-TRM-789",
  "title": "Physical Commodity Hedging Multi-Currency Settlement",
  "requirement": "Automated physical commodity futures settlement known product gap on public cloud roadmap",
  "description": "Automated physical commodity futures settlement known product gap on public cloud roadmap",
  "target_edition": "Public",
  "target_release": "2408",
  "module": "TRM"
}''',

    # -------------------------------------------------------------------------
    # 4. Clean Core Object Guard Fixtures
    # -------------------------------------------------------------------------
    "clean_core_compliant.abap": (
        "CLASS zcl_product_processor DEFINITION\n"
        "  PUBLIC\n"
        "  FINAL\n"
        "  CREATE PUBLIC.\n"
        "\n"
        "  PUBLIC SECTION.\n"
        "    INTERFACES if_oo_adt_classrun.\n"
        "    TYPES: tt_product TYPE STANDARD TABLE OF I_Product WITH EMPTY KEY.\n"
        "    METHODS get_active_products\n"
        "      IMPORTING\n"
        "        iv_type TYPE I_Product-ProductType\n"
        "      RETURNING\n"
        "        VALUE(rt_products) TYPE tt_product.\n"
        "ENDCLASS.\n"
        "\n"
        "CLASS zcl_product_processor IMPLEMENTATION.\n"
        "  METHOD get_active_products.\n"
        "    SELECT Product, ProductType, BaseUnit, CreationDateTime\n"
        "      FROM I_Product\n"
        "      WHERE ProductType = @iv_type\n"
        "      INTO CORRESPONDING FIELDS OF TABLE @rt_products.\n"
        "  ENDMETHOD.\n"
        "\n"
        "  METHOD if_oo_adt_classrun~main.\n"
        "    DATA(lt_prod) = get_active_products( 'FERT' ).\n"
        "    out->write( |Fetched { lines( lt_prod ) } active products| ).\n"
        "  ENDMETHOD.\n"
        "ENDCLASS.\n"
    ),
    "clean_core_legacy.abap": (
        "REPORT zr_legacy_stock_export.\n"
        "\n"
        "TABLES: mara, vbak.\n"
        "\n"
        "DATA: lt_mara TYPE TABLE OF mara,\n"
        "      ls_mara TYPE mara,\n"
        "      lv_file TYPE string VALUE '/usr/sap/trans/data/stock.txt',\n"
        "      lv_cmd  TYPE string VALUE 'rm -rf /tmp/scratch'.\n"
        "\n"
        "START-OF-SELECTION.\n"
        "  PERFORM fetch_materials.\n"
        "  PERFORM export_to_file.\n"
        "\n"
        "FORM fetch_materials.\n"
        "  SELECT * FROM mara INTO TABLE lt_mara WHERE mtart = 'FERT'.\n"
        "  SELECT vbeln, erdat FROM vbak INTO (mara-matnr, mara-ersda).\n"
        "  ENDSELECT.\n"
        "ENDFORM.\n"
        "\n"
        "FORM export_to_file.\n"
        "  OPEN DATASET lv_file FOR OUTPUT IN TEXT MODE ENCODING DEFAULT.\n"
        "  LOOP AT lt_mara INTO ls_mara.\n"
        "    TRANSFER ls_mara-matnr TO lv_file.\n"
        "  ENDLOOP.\n"
        "  CLOSE DATASET lv_file.\n"
        "  CALL 'SYSTEM' ID 'COMMAND' FIELD lv_cmd.\n"
        "ENDFORM.\n"
    ),
    "clean_core_dynamic.abap": (
        "CLASS zcl_dynamic_reader DEFINITION PUBLIC FINAL CREATE PUBLIC.\n"
        "  PUBLIC SECTION.\n"
        "    METHODS execute_dynamic_query\n"
        "      IMPORTING\n"
        "        iv_table TYPE tabname\n"
        "        iv_fields TYPE string\n"
        "      RETURNING\n"
        "        VALUE(rv_count) TYPE i.\n"
        "ENDCLASS.\n"
        "\n"
        "CLASS zcl_dynamic_reader IMPLEMENTATION.\n"
        "  METHOD execute_dynamic_query.\n"
        "    FIELD-SYMBOLS: <lt_table> TYPE ANY TABLE.\n"
        "    SELECT (iv_fields) FROM (iv_table) INTO TABLE @<lt_table>.\n"
        "\n"
        "    EXEC SQL.\n"
        "      COMMIT WORK;\n"
        "    ENDEXEC.\n"
        "\n"
        "    CALL FUNCTION 'RFC_READ_TABLE'\n"
        "      EXPORTING\n"
        "        query_table = iv_table.\n"
        "  ENDMETHOD.\n"
        "ENDCLASS.\n"
    ),
}


def provision_fixtures(target_dir: Path = FIXTURES_DIR) -> int:
    """Writes all 12 Domain 2 golden test fixtures to the target directory."""
    target_dir.mkdir(parents=True, exist_ok=True)
    print(f"[Domain 2 Provisioner] Target Directory: {target_dir}")
    print(f"[Domain 2 Provisioner] Generating {len(FIXTURE_DATA)} curated golden fixtures...")

    for filename, content in FIXTURE_DATA.items():
        file_path = target_dir / filename
        file_path.write_text(content, encoding="utf-8")
        sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
        print(f"  + Created: {filename} ({len(content)} bytes, sha256: {sha256[:12]}...)")

    print("[Domain 2 Provisioner] Successfully provisioned all Domain 2 fixtures.")
    return 0


if __name__ == "__main__":
    sys.exit(provision_fixtures())
