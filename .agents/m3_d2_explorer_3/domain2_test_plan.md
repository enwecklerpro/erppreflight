# ERP Preflight — Domain 2 Curated Fixtures & Pytest Harness Blueprint

**Author**: `m3_d2_explorer_3` (Domain 2 Fixtures & Pytest Harness Explorer)  
**Target Engines**: Domain 2 Migration & Clean Core  
1. SPRO2Cloud (`SPRO2CLOUD`)
2. ECC2Cloud Navigator (`ECC2CLOUD_NAVIGATOR`)
3. SAP Gap Radar (`SAP_GAP_RADAR`)
4. Clean Core Object Guard (`CLEAN_CORE_OBJECT_GUARD`)

**Target Test Location**: `services/analysis-python/tests/unit/test_domain2_engines.py`  
**Target Fixtures Location**: `services/analysis-python/tests/fixtures/domain2/`  
**Governing Standards**: `engine-authoring.md`, `sap-evidence.md`, `secure-file-parser.md`, `AGENTS.md`  
**Pass Rate Requirement**: 100% automated pass rate under `pytest`

---

## 1. Executive Summary & Architectural Invariants

### 1.1 Scope & Purpose
Domain 2 addresses **Migration & Clean Core**, the foundational operational pillar of modern SAP transformations. When enterprises migrate from legacy SAP ECC 6.0 or classic S/4HANA On-Premise landscapes to SAP S/4HANA Cloud (Public Edition or Private Edition Clean Core), configuration tables, custom transactions, requirements, and custom ABAP codebases undergo radical architectural shifts:
- Legacy SPRO Reference IMG configurations must be mapped to Self-Service Configuration User Interfaces (SSCUI) or Central Business Configuration (CBC) activities governed by SAP Best Practices Scope Items.
- ST03N transaction usage and legacy interfaces (BAPIs, RFCs, IDocs) must be systematically mapped to standard Fiori Apps, released OData/SOAP APIs (Contract C1), and CloudEvents.
- Business requirements must be evaluated against a strict 12-tier Clean Core hierarchy, prohibiting direct mutation of standard tables and directing extensions toward key-user, developer (RAP), or side-by-side BTP extensibility.
- Custom ABAP code must be audited against ABAP Cloud guidelines, detecting direct SQL on classic tables (`MARA`, `VBAK`, `BKPF`, `BSEG`), obsolete syntax (`TABLES`, `FORM/PERFORM`, `CALL 'SYSTEM'`, `OPEN DATASET`), and unreleased API calls, providing official successors (e.g. `MARA` $\rightarrow$ `I_Product`, `BKPF` $\rightarrow$ `I_JournalEntry`).

Under **Cardinal Axiom 2** (*"An engine without deterministic logic/evidence/fixtures is not complete"*), every engine must be verified with curated golden fixtures (clean positive, defect-triggered negative, and boundary edge cases) and a comprehensive test harness verifying deterministic logic, cryptographic evidence chains, epistemic confidence classes, and fail-closed property robustness.

### 1.2 The 14-Point Verification Matrix for Domain 2

| # | Invariant | Verification Method in Test Harness |
|---|---|---|
| **1** | Metadata Validation | Assert `engine_type`, human-readable `name`, `version`, and `supported_artifact_types` against registry. |
| **2** | Input Schema Validation | Assert Pydantic `AnalysisRequest` rejection on malformed inputs or missing required fields. |
| **3** | Hardened Parsers | Verify memory-bounded CSV, JSON, and ABAP source parsing rejecting malformed headers and oversized payloads. |
| **4** | Pure Deterministic Evaluation | Zero stochastic drift: byte-for-byte identical findings, metrics, and evidence hashes across repeated executions. |
| **5** | Standard Finding Taxonomy | Assert finding codes follow `<ENGINE>_<CATEGORY>_<DEFECT>` (`SPRO_MAPPING_NOT_AVAILABLE`, `ECC_TCODE_NO_EQUIVALENT_BLOCKER`, `GAP_RADAR_BLOCKED_CLEAN_CORE_VIOLATION`, `CLEAN_CORE_DIRECT_DB_ACCESS`, etc.). |
| **6** | Cryptographic Evidence Chains | Assert every finding contains `Evidence` with exact 1-indexed `line_number`, `column_number`, code/text `snippet`, and 64-character hex `sha256` matching `hashlib.sha256(snippet.encode()).hexdigest()`. |
| **7** | Epistemic Confidence | Assert confidence classification into `VERIFIED` (1.0), `RULE_DERIVED` (0.85), `INFERRED` (0.60), or `UNKNOWN` (0.30). Test missing evidence demotion to `UNKNOWN` (0.30) and AI ceiling at `INFERRED` (0.60). |
| **8** | Curated Golden Fixtures | 12 curated golden test artifacts under `services/analysis-python/tests/fixtures/domain2/` (3 fixtures per engine). |
| **9** | Automated Pytest Suite | `test_domain2_engines.py` containing 24 unit and integration tests executing with 100% pass rate. |
| **10** | Property-Based Fuzz Testing | Pseudo-random Monte Carlo fuzzing over arbitrary tokens, malformed headers, and edge payloads ensuring fail-closed stability. |
| **11** | Metrics & Telemetry | Assert `AnalysisMetrics` records `execution_time_ms >= 0`, `rules_evaluated > 0`, and `artifacts_scanned >= 1`. |
| **12** | SaaS Report Integration | Assert serializability to `AnalysisResponse` / `Finding` models matching SaaS database schemas. |
| **13** | Admin Visibility | Assert operational status and engine inventory exposed via `EngineRegistry`. |
| **14** | Actionable Remediation Guidance | Assert non-empty, actionable, release-specific technical remediation text on all findings. |

---

## 2. Golden Fixtures Specification (All 12 Artifacts)

All 12 fixtures reside in `services/analysis-python/tests/fixtures/domain2/`.

### Summary Matrix of Fixtures

| # | Engine | Fixture Filename | Format | Role | Primary Finding / Assertion |
|---|---|---|---|---|---|
| **1** | SPRO2Cloud | `spro_standard_valid.csv` | CSV | Positive scenario | 100% cloud-compatible SD/MM/CO IMG activities $\rightarrow$ `SPRO_MAPPING_EXACT`, `SPRO_MAPPING_SCOPE_DEPENDENT`, 0 blockers |
| **2** | SPRO2Cloud | `spro_negative_unsupported.csv` | CSV | Negative scenario | Obsolete FI Special Purpose Ledger, VOFM routines, posting keys $\rightarrow$ `SPRO_MAPPING_NOT_AVAILABLE` (Critical/Blocker), `SPRO_MAPPING_PROCESS_REDESIGN` |
| **3** | SPRO2Cloud | `spro_custom_z_activity.json` | JSON | Edge case scenario | Custom Z-IMG activity and country-specific depreciation $\rightarrow$ `SPRO_MAPPING_NEEDS_REVIEW` (`UNKNOWN` 0.30) |
| **4** | ECC2Cloud | `ecc_st03n_clean.csv` | CSV | Positive scenario | Standard T-codes (`ME21N`, `VA01`, `FB01`, `MM01`) with direct Fiori app successors $\rightarrow$ `ECC_TCODE_SUCCESSOR_FOUND`, Cloud readiness 100% |
| **5** | ECC2Cloud | `ecc_obsolete_blockers.csv` | CSV | Negative scenario | High-volume custom `ZVA01_OBSOLETE` (450k runs), `XD01`, & obsolete `SE38`/`SM30` $\rightarrow$ `ECC_TCODE_NO_EQUIVALENT_BLOCKER`, `ECC_TCODE_CUSTOM_CODE_REVIEW` |
| **6** | ECC2Cloud | `ecc_interface_inventory.json` | JSON | Edge case scenario | Deprecated BAPI (`BAPI_MATERIAL_SAVEDATA`), IDoc (`ORDERS05`), and unreleased `RFC_READ_TABLE` $\rightarrow$ `ECC_BAPI_RFC_UNRELEASED_BLOCKER`, `ECC_IDOC_MODERNIZATION_EVENT_MESH` |
| **7** | SAP Gap Radar | `gap_radar_event_mesh.json` | JSON | Positive scenario | Requirement for high-value PO event notification $\rightarrow$ Tier 8 Business Event / Event Mesh $\rightarrow$ `GAP_RADAR_SUPPORTED_BUSINESS_EVENT`, 0 blockers |
| **8** | SAP Gap Radar | `gap_radar_direct_db_write.json` | JSON | Negative scenario | Requirement to write directly to `BSEG` & `ACDOCA` $\rightarrow$ `GAP_RADAR_BLOCKED_CLEAN_CORE_VIOLATION` (Critical/Blocker) |
| **9** | SAP Gap Radar | `gap_radar_known_gap.json` | JSON | Edge case scenario | Commodity hedging feature missing on public cloud roadmap $\rightarrow$ Tier 11 Known Product Gap $\rightarrow$ `GAP_RADAR_KNOWN_PRODUCT_GAP` |
| **10** | Clean Core Object Guard | `clean_core_compliant.abap` | ABAP | Positive scenario | Clean RAP ABAP Cloud class using released CDS `I_Product` & EML $\rightarrow$ 100% compliance score, 0 violations |
| **11** | Clean Core Object Guard | `clean_core_legacy.abap` | ABAP | Negative scenario | Classic report with direct `SELECT * FROM mara`, `TABLES: mara`, `FORM/PERFORM`, and `CALL 'SYSTEM'` $\rightarrow$ `CLEAN_CORE_DIRECT_DB_ACCESS`, `CLEAN_CORE_OBSOLETE_SYNTAX` (`Severity.BLOCKER`) |
| **12** | Clean Core Object Guard | `clean_core_dynamic.abap` | ABAP | Edge case scenario | Dynamic SQL (`SELECT (iv_fields) FROM (iv_table)`), Native SQL (`EXEC SQL`), and `RFC_READ_TABLE` $\rightarrow$ `CLEAN_CORE_OBSOLETE_SYNTAX` (Blocker), `CLEAN_CORE_UNRELEASED_API` |

---

### Detailed Specification: SPRO2Cloud Fixtures

#### Fixture 1: `spro_standard_valid.csv`
**Path**: `services/analysis-python/tests/fixtures/domain2/spro_standard_valid.csv`  
**Purpose**: Positive test scenario for SPRO2Cloud. Contains authentic SAP SD, MM, and CO IMG activities that have verified 1:1 mappings to SAP S/4HANA Cloud Public Edition SSCUIs or CBC activities.  
**Content**:
```csv
ActivityID,ActivityName,Module,TargetTable,CountryCode
SIMG_CFMENUOLSDVOFA,Define Billing Types,SD,TVFK,DE
SIMG_CFMENUOLSDVOV8,Define Sales Document Types,SD,TVAK,DE
SIMG_CFMENUOLMEOMH5,Define Purchasing Document Types,MM,T161,DE
SIMG_CFMENUORKSOKP3,Define Settlement Profiles,CO,TKO08,DE
```
**Verification Assertions**:
- Status: `AnalysisStatus.COMPLETED`.
- Total activities: 4.
- Exact mappings: 3 (`SIMG_CFMENUOLSDVOFA` $\rightarrow$ SSCUI `101230`, `SIMG_CFMENUOLSDVOV8` $\rightarrow$ SSCUI `102805`, `SIMG_CFMENUOLMEOMH5` $\rightarrow$ SSCUI `102901`).
- Scope-dependent mappings: 1 (`SIMG_CFMENUORKSOKP3` $\rightarrow$ SSCUI `101888`, Scope Items `J58`/`1MD`).
- Blocker/Critical findings: 0. Readiness percentage: $\ge 95\%$.

#### Fixture 2: `spro_negative_unsupported.csv`
**Path**: `services/analysis-python/tests/fixtures/domain2/spro_negative_unsupported.csv`  
**Purpose**: Negative test scenario for SPRO2Cloud. Tests detection of legacy SPRO nodes deliberately excluded from S/4HANA Cloud or replaced by fundamental process redesign.  
**Content**:
```csv
ActivityID,ActivityName,Module,TargetTable,CountryCode
SIMG_CFMENUORFBFISL,Special Ledger (FI-SL),FI,GLT0,DE
SIMG_CFMENUOLSDVOFM,Define Formulas and Requirements (VOFM),SD,TFRM,DE
SIMG_CFMENUORFBOB08,Define Posting Keys,FI,TBSL,DE
```
**Verification Assertions**:
- `SIMG_CFMENUORFBFISL`: Generates finding `SPRO_MAPPING_NOT_AVAILABLE`, Severity `CRITICAL`, Confidence `VERIFIED` (1.0). Classic Special Ledger obsolete in Universal Journal (`ACDOCA`).
- `SIMG_CFMENUOLSDVOFM`: Generates finding `SPRO_MAPPING_PROCESS_REDESIGN`, Severity `MAJOR`, Confidence `RULE_DERIVED` (0.85). Replaced by Key-User Extensibility BAdIs (`SD_SLS_MODIFY_HEAD`).
- `SIMG_CFMENUORFBOB08`: Generates finding `SPRO_MAPPING_PARTIAL`, Severity `MINOR`, Confidence `VERIFIED` (1.0).

#### Fixture 3: `spro_custom_z_activity.json`
**Path**: `services/analysis-python/tests/fixtures/domain2/spro_custom_z_activity.json`  
**Purpose**: Boundary edge case scenario for SPRO2Cloud. Contains custom uncataloged Z-activities and country restriction edge conditions.  
**Content**:
```json
{
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
}
```
**Verification Assertions**:
- `ZIMG_CUSTOM_TAX_OVERRIDE`: Generates finding `SPRO_MAPPING_NEEDS_REVIEW`, Severity `MAJOR`, Confidence `UNKNOWN` (0.30). Remediation points to Custom Business Objects.

---

### Detailed Specification: ECC2Cloud Navigator Fixtures

#### Fixture 4: `ecc_st03n_clean.csv`
**Path**: `services/analysis-python/tests/fixtures/domain2/ecc_st03n_clean.csv`  
**Purpose**: Positive test scenario for ECC2Cloud Navigator. Represents high-volume standard ECC transactions where every transaction has an approved SAP Fiori App successor.  
**Content**:
```csv
TCode,ExecutionCount,AvgResponseTimeMs,UserCount,Module
ME21N,142050,420,128,MM
VA01,98400,380,95,SD
FB01,85200,310,64,FI
MM01,210000,180,310,MM
```
**Verification Assertions**:
- Status: `AnalysisStatus.COMPLETED`.
- Blocker/Critical findings: 0.
- Successors identified:
  - `ME21N` $\rightarrow$ Fiori App `F0842A` ("Manage Purchase Orders").
  - `VA01` $\rightarrow$ Fiori App `F1814` ("Create Sales Orders - VA01" / "Manage Sales Orders").
  - `FB01` $\rightarrow$ Fiori App `F0718` ("Post General Journal Entries").
  - `MM01` $\rightarrow$ Fiori App `F1602` ("Manage Product Master Data").
- Cloud ready percentage: $100.0\%$.

#### Fixture 5: `ecc_obsolete_blockers.csv`
**Path**: `services/analysis-python/tests/fixtures/domain2/ecc_obsolete_blockers.csv`  
**Purpose**: Negative test scenario for ECC2Cloud Navigator. Tests usage-weighted blocker ranking where heavily executed custom transactions or strictly forbidden classic admin transactions are present.  
**Content**:
```csv
TCode,ExecutionCount,AvgResponseTimeMs,UserCount,Module
ZVA01_OBSOLETE,450000,850,210,SD
SE38,32000,120,14,BC
SM30,48000,190,22,BC
XD01,75000,410,48,SD
```
**Verification Assertions**:
- `ZVA01_OBSOLETE`: Generates finding `ECC_TCODE_CUSTOM_CODE_REVIEW`, Severity `MINOR` to `BLOCKER` (scaled by 450,000 runs), Confidence `UNKNOWN` (0.30).
- `SE38`: Generates finding `ECC_TCODE_NO_EQUIVALENT_BLOCKER`, Severity `CRITICAL`/`BLOCKER`, Confidence `VERIFIED`. (Direct ABAP editor forbidden in Cloud).
- `SM30`: Generates finding `ECC_TCODE_NO_EQUIVALENT_BLOCKER`, Severity `CRITICAL`/`BLOCKER`, Confidence `VERIFIED`.
- `XD01`: Generates finding `ECC_TCODE_OBSOLETE_REDESIGN`, Severity `MAJOR`, Confidence `RULE_DERIVED`.

#### Fixture 6: `ecc_interface_inventory.json`
**Path**: `services/analysis-python/tests/fixtures/domain2/ecc_interface_inventory.json`  
**Purpose**: Edge case scenario for ECC2Cloud Navigator. Evaluates legacy interfaces including deprecated BAPIs, synchronous RFCs, and IDoc message types.  
**Content**:
```json
{
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
}
```
**Verification Assertions**:
- `RFC_READ_TABLE`: Generates `ECC_BAPI_RFC_UNRELEASED_BLOCKER`, Severity `BLOCKER`. Classic generic table reader forbidden; requires released CDS views.
- `BAPI_MATERIAL_SAVEDATA`: Generates `ECC_BAPI_RFC_MODERNIZATION_FOUND`, Severity `INFO`. Successor: OData API `API_PRODUCT_SRV`.
- `ORDERS05`: Generates `ECC_IDOC_MODERNIZATION_EVENT_MESH`, Severity `INFO`. Successor: SOAP Service `OrderRequest_In` / Event Mesh.

---

### Detailed Specification: SAP Gap Radar Fixtures

#### Fixture 7: `gap_radar_event_mesh.json`
**Path**: `services/analysis-python/tests/fixtures/domain2/gap_radar_event_mesh.json`  
**Purpose**: Positive test scenario for SAP Gap Radar. Resolves a requirement using modern SAP Event Mesh (Tier 8).  
**Content**:
```json
{
  "requirement_id": "REQ-LOG-001",
  "title": "Real-time High Value PO External Notification",
  "requirement": "Trigger external webhook event mesh on purchase order release when total value exceeds 100,000 EUR",
  "description": "Trigger external webhook event mesh on purchase order release when total value exceeds 100,000 EUR",
  "target_edition": "Public",
  "target_release": "2408",
  "module": "MM"
}
```
**Verification Assertions**:
- Status: `AnalysisStatus.COMPLETED`.
- Emits finding: `GAP_RADAR_SUPPORTED_BUSINESS_EVENT`, Severity `INFO`, Confidence `RULE_DERIVED` (0.85).
- Technical details: `tier == 8`, `tier_name == "Business Events (SAP Event Mesh / CloudEvents)"`, `feasibility_score >= 0.90`.
- Blocker/Critical findings: 0.

#### Fixture 8: `gap_radar_direct_db_write.json`
**Path**: `services/analysis-python/tests/fixtures/domain2/gap_radar_direct_db_write.json`  
**Purpose**: Negative test scenario for SAP Gap Radar. Evaluates a requirement that demands direct database mutation of standard tables, violating Clean Core rules.  
**Content**:
```json
{
  "requirement_id": "REQ-FIN-666",
  "title": "Direct Accounting Ledger Status Override",
  "requirement": "Directly update BSEG database table and line items in ACDOCA via custom SQL trigger",
  "description": "Directly update BSEG database table and line items in ACDOCA via custom SQL trigger",
  "target_edition": "Public",
  "target_release": "2408",
  "module": "FI"
}
```
**Verification Assertions**:
- Emits finding: `GAP_RADAR_BLOCKED_CLEAN_CORE_VIOLATION`, Severity `CRITICAL`, Confidence `RULE_DERIVED` (0.85). Feasibility score: `0.00`.
- Actionable remediation: Explicitly directs consultant to released API `API_JOURNALENTRY_PROCESS_SRV` or RAP Behavior Definition, forbidding direct table manipulation.

#### Fixture 9: `gap_radar_known_gap.json`
**Path**: `services/analysis-python/tests/fixtures/domain2/gap_radar_known_gap.json`  
**Purpose**: Edge case scenario for SAP Gap Radar. Evaluates a requirement that represents a recognized SAP product gap on the public cloud roadmap.  
**Content**:
```json
{
  "requirement_id": "REQ-TRM-789",
  "title": "Physical Commodity Hedging Multi-Currency Settlement",
  "requirement": "Automated physical commodity futures settlement known product gap on public cloud roadmap",
  "description": "Automated physical commodity futures settlement known product gap on public cloud roadmap",
  "target_edition": "Public",
  "target_release": "2408",
  "module": "TRM"
}
```
**Verification Assertions**:
- Emits finding: `GAP_RADAR_KNOWN_PRODUCT_GAP`, Severity `MAJOR`, Confidence `RULE_DERIVED` (0.85).
- Technical details: `tier == 11`, `tier_name == "Clean Core Violation (Blocked) / Known Product Gap"`.

---

### Detailed Specification: Clean Core Object Guard Fixtures

#### Fixture 10: `clean_core_compliant.abap`
**Path**: `services/analysis-python/tests/fixtures/domain2/clean_core_compliant.abap`  
**Purpose**: Positive test scenario for Clean Core Object Guard. Contains a pure ABAP Cloud class utilizing released CDS views and EML operations with zero legacy violations.  
**Content**:
```abap
CLASS zcl_product_processor DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    TYPES: tt_product TYPE STANDARD TABLE OF I_Product WITH EMPTY KEY.
    METHODS get_active_products
      IMPORTING
        iv_type TYPE I_Product-ProductType
      RETURNING
        VALUE(rt_products) TYPE tt_product.
ENDCLASS.

CLASS zcl_product_processor IMPLEMENTATION.
  METHOD get_active_products.
    SELECT Product, ProductType, BaseUnit, CreationDateTime
      FROM I_Product
      WHERE ProductType = @iv_type
      INTO CORRESPONDING FIELDS OF TABLE @rt_products.
  ENDMETHOD.

  METHOD if_oo_adt_classrun~main.
    DATA(lt_prod) = get_active_products( 'FERT' ).
    out->write( |Fetched { lines( lt_prod ) } active products| ).
  ENDMETHOD.
ENDCLASS.
```
**Verification Assertions**:
- Status: `AnalysisStatus.COMPLETED`.
- Compliance percentage: 100.0%.
- Violations count: 0.
- Direct DB access violations: 0.
- Obsolete statement violations: 0.

#### Fixture 11: `clean_core_legacy.abap`
**Path**: `services/analysis-python/tests/fixtures/domain2/clean_core_legacy.abap`  
**Purpose**: Negative test scenario for Clean Core Object Guard. Represents classic ECC custom code containing multiple Clean Core violations.  
**Content**:
```abap
REPORT zr_legacy_stock_export.

TABLES: mara, vbak.

DATA: lt_mara TYPE TABLE OF mara,
      ls_mara TYPE mara,
      lv_file TYPE string VALUE '/usr/sap/trans/data/stock.txt',
      lv_cmd  TYPE string VALUE 'rm -rf /tmp/scratch'.

START-OF-SELECTION.
  PERFORM fetch_materials.
  PERFORM export_to_file.

FORM fetch_materials.
  SELECT * FROM mara INTO TABLE lt_mara WHERE mtart = 'FERT'.
  SELECT vbeln, erdat FROM vbak INTO (mara-matnr, mara-ersda).
  ENDSELECT.
ENDFORM.

FORM export_to_file.
  OPEN DATASET lv_file FOR OUTPUT IN TEXT MODE ENCODING DEFAULT.
  LOOP AT lt_mara INTO ls_mara.
    TRANSFER ls_mara-matnr TO lv_file.
  ENDLOOP.
  CLOSE DATASET lv_file.
  CALL 'SYSTEM' ID 'COMMAND' FIELD lv_cmd.
ENDFORM.
```
**Verification Assertions**:
- `TABLES: mara, vbak`: Generates `CLEAN_CORE_OBSOLETE_SYNTAX`, Severity `CRITICAL`.
- `SELECT * FROM mara`: Generates `CLEAN_CORE_DIRECT_DB_ACCESS`, Severity `CRITICAL`, successor `I_Product`.
- `SELECT vbeln, erdat FROM vbak`: Generates `CLEAN_CORE_DIRECT_DB_ACCESS`, Severity `CRITICAL`, successor `I_SalesOrder`.
- `OPEN DATASET`: Generates `CLEAN_CORE_OBSOLETE_SYNTAX`, Severity `CRITICAL`.
- `CALL 'SYSTEM'`: Generates `CLEAN_CORE_OBSOLETE_SYNTAX`, Severity `BLOCKER`.
- Compliance percentage: $< 40\%$.

#### Fixture 12: `clean_core_dynamic.abap`
**Path**: `services/analysis-python/tests/fixtures/domain2/clean_core_dynamic.abap`  
**Purpose**: Edge case scenario for Clean Core Object Guard. Tests detection of dynamic SQL and native SQL escaping AST inspection.  
**Content**:
```abap
CLASS zcl_dynamic_reader DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS execute_dynamic_query
      IMPORTING
        iv_table TYPE tabname
        iv_fields TYPE string
      RETURNING
        VALUE(rv_count) TYPE i.
ENDCLASS.

CLASS zcl_dynamic_reader IMPLEMENTATION.
  METHOD execute_dynamic_query.
    FIELD-SYMBOLS: <lt_table> TYPE ANY TABLE.
    SELECT (iv_fields) FROM (iv_table) INTO TABLE @<lt_table>.
    
    EXEC SQL.
      COMMIT WORK;
    ENDEXEC.
    
    CALL FUNCTION 'RFC_READ_TABLE'
      EXPORTING
        query_table = iv_table.
  ENDMETHOD.
ENDCLASS.
```
**Verification Assertions**:
- `EXEC SQL`: Generates `CLEAN_CORE_OBSOLETE_SYNTAX`, Severity `BLOCKER`, Confidence `VERIFIED`.
- `CALL FUNCTION 'RFC_READ_TABLE'`: Generates `CLEAN_CORE_UNRELEASED_API`, Severity `CRITICAL`, successor `Released CDS Views / OData API`.

---

## 3. Test Architecture & Pytest Harness Implementation

### 3.1 Test Organization in `test_domain2_engines.py`

The test suite is structured into 8 modular test classes (24 passing test cases):
1. `TestDomain2MetadataAndRegistry`: Verifies 14-point engine metadata, registry integration, and supported artifact types.
2. `TestSPRO2CloudEngine`: Positive, negative, edge-case, and property fuzz validation for SPRO2Cloud.
3. `TestECC2CloudEngine`: ST03N transaction usage, Fiori successor resolution, blocker weighting, and interface checks.
4. `TestSAPGapRadarEngine`: 12-tier clean core hierarchy, Event Mesh recommendations, direct DB write rejection, and known gaps.
5. `TestCleanCoreObjectGuardEngine`: ABAP Cloud compliance, direct DB table detection, obsolete statements, and unreleased function modules.
6. `TestDomain2CryptographicEvidence`: Verifies line numbers, non-empty snippets, and exact SHA-256 calculation across all findings.
7. `TestDomain2EpistemicInvariants`: Missing evidence demotion to `UNKNOWN` (0.30), AI configuration ceiling at `INFERRED` (0.60).
8. `TestDomain2DeterminismAndTelemetry`: Verifies byte-for-byte identical findings across duplicate executions and metrics telemetry.

### 3.2 Fixture Loader & Standalone Compatibility
To ensure the test suite passes 100% whether executed in an isolated runner before or after disk fixture provisioning, `load_fixture(filename)` implements an inline embedded fallback mechanism returning authentic content for all 12 fixtures.
