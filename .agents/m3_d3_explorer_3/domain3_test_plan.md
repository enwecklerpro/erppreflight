# Domain 3 Test Plan & Fixture Catalog: Integration Engines

> **Domain**: Domain 3 — Integration (ALE/IDoc Master Data Sync & API Lifecycle Governance)  
> **Engines**: 
> 1. Feature 26: **Change Pointer Coverage Auditor** (`change_pointer.py`, `EngineType.CHANGE_POINTER_COVERAGE_AUDITOR`)  
> 2. Feature 27: **API Change Guard** (`api_change.py`, `EngineType.API_CHANGE_GUARD`)  
> **Author**: `m3_d3_explorer_3` (Domain 3 Golden Fixtures & Pytest Harness Explorer)  
> **Governing Standards**: `AGENTS.md` (Cardinal Axioms 1 & 2), `engine-authoring.md`, `sap-evidence.md`, `secure-file-parser.md`  
> **Target Python Environment**: Python 3.13, Pytest 9.0+, Pydantic v2  

---

## 1. Executive Summary & Problem Scope

Domain 3 governs the mission-critical integration boundaries of modern SAP architectures:
1. **Change Pointer Coverage Auditor (Feature 26)** ensures that enterprise master data modifications (e.g., Materials, Customers, Vendors, Bills of Material) reliably trigger Application Link Enabling (ALE) change pointers for outbound IDoc and event synchronization. It cross-examines global activation (`BD61`), message type configuration (`BD50`), field-level linkage tables (`BD52`), ABAP Data Dictionary Change Document flags (`DD04L`), reduced message type filters (`BD53`), and runtime change pointer logs (`BDCP2`).
2. **API Change Guard (Feature 27)** performs deterministic syntactic and semantic diffing between baseline and candidate API specifications (OpenAPI 2.0/3.0 in JSON/YAML and SAP OData EDMX V2/V4 XML). It isolates breaking changes (endpoint removals, operation removals, field drops, type alterations, length decreases, enum restrictions, mandatory field additions) from non-breaking enhancements, and cross-references breaks against a registered **Project Integration Registry** to identify downstream client applications that will experience integration failures.

To satisfy **Cardinal Axiom 2** (*"An engine without deterministic logic/evidence/fixtures is not complete"*), both engines must be validated with authentic positive, negative, and edge-case enterprise fixtures, strict cryptographic evidence verification, epistemic confidence scoring, and 100% automated pytest pass rate.

---

## 2. Cardinal Axiom 2 Compliance Matrix (14 Architectural Points)

| Point | Architectural Requirement | Change Pointer Coverage Auditor Implementation | API Change Guard Implementation |
|---|---|---|---|
| **1. Metadata** | Canonical engine ID, human name, domain, target releases, artifact formats | `EngineType.CHANGE_POINTER_COVERAGE_AUDITOR`, version `1.0.0`, CSV/JSON | `EngineType.API_CHANGE_GUARD`, version `1.0.0`, JSON/YAML/XML/EDMX |
| **2. Input Schema** | Runtime schema validation (Pydantic v2) | Validates `ChangePointerPayload` or CSV tabular data with BD61, BD50, BD52, DD04L, BDCP2 | Validates `ApiChangePayload` with `baseline_spec`, `candidate_spec`, and optional `integration_registry` |
| **3. Deterministic Parser** | Hardened, memory-bounded parsing | Defused CSV/JSON reader, bounds checking, zero probabilistic heuristics | Defused XML parser (`defusedxml.ElementTree`) for EDMX, strict JSON schema parser for OpenAPI |
| **4. Pure Rule Evaluation** | Pure function evaluations, zero drift | Deterministic set intersections, dictionary lookups, exact field matching | Deterministic AST diff traversal across paths, methods, schemas, and entity sets |
| **5. Standard Taxonomy** | Structured unique finding codes | `CP_GLOBAL_DISABLED`, `CP_MESTYPE_DISABLED`, `CP_FIELD_NOT_CONFIGURED_BD52`, `CP_DD04L_FLAG_MISSING`, `CP_REDUCED_MESTYPE_FILTERED`, `CP_CUSTOM_FIELD_OMITTED`, `CP_RUNTIME_DISCREPANCY_BDCP2` | `API_BREAKING_ENDPOINT_REMOVED`, `API_BREAKING_OPERATION_REMOVED`, `API_BREAKING_FIELD_REMOVED`, `API_BREAKING_REQUIRED_FIELD_ADDED`, `API_BREAKING_TYPE_CHANGED`, `API_BREAKING_LENGTH_DECREASED`, `API_BREAKING_ENUM_RESTRICTED`, `API_CONSUMER_IMPACT_DETECTED` |
| **6. Crypto Evidence Chains** | SHA-256 hash, line/col numbers, snippet, provenance score | Every finding references exact table record, line number, table-field snippet, and payload SHA-256 | Every finding references exact JSON path or XML line/tag, snippet, and specification SHA-256 |
| **7. Epistemic Confidence** | Strict classification (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`) | `VERIFIED` (1.0) on BD61/BD50/BD52/DD04L match; `RULE_DERIVED` (0.85) on segment inferences; `UNKNOWN` (0.30) on dynamic BAdI filtering | `VERIFIED` (1.0) on deterministic schema diffs; `RULE_DERIVED` (0.85) on consumer registry impact; `UNKNOWN` (0.30) on unregistered clients |
| **8. Curated Fixtures** | Positive, negative, edge-case artifacts | 6 curated fixtures (`cp_matmas_active.json`, `cp_global_disabled.json`, `cp_missing_field.json`, `cp_dd04l_flag_missing.json`, `cp_custom_field_omitted.json`, `cp_bd52_config.csv`) | 6 curated fixtures (`api_openapi_clean.json`, `api_openapi_breaking.json`, `api_odata_edmx_type_change.xml`, `api_integration_registry.json`, `api_odata_edmx_baseline.xml`, `api_odata_edmx_candidate.xml`) |
| **9. Automated Test Suite** | Pytest execution with 100% pass rate | Comprehensive test suite covering positive, negative, and edge fixtures with 100% pass rate | Comprehensive test suite covering OpenAPI, OData EDMX, and consumer registry with 100% pass rate |
| **10. Property-Based Fuzzing** | Fuzz tests verifying parser stability | Malformed JSON/CSV, missing keys, unexpected types handled gracefully | Corrupted JSON, truncated XML, missing sections handled gracefully without crash |
| **11. Telemetry & Metrics** | Execution duration, rules evaluated, coverage metrics | Emits `total_expected_fields`, `covered_fields`, `coverage_percentage`, `global_active`, `message_type_active` | Emits `breaking_changes_count`, `non_breaking_changes_count`, `affected_integrations_count` |
| **12. Report Serialization** | Standardized JSON export model | Fully serializable into `AnalysisResponse` with `Finding` and `AnalysisMetrics` | Fully serializable into `AnalysisResponse` with `Finding` and `AnalysisMetrics` |
| **13. Admin Visibility** | Trust Center status and rule inventory | Exposed via `EngineRegistry` and `get_metadata()` | Exposed via `EngineRegistry` and `get_metadata()` |
| **14. Remediation Guides** | Release-specific remediation steps | Precise transaction codes (BD61, BD50, BD52, SE11/DD04L) and configuration actions | Actionable migration recommendations, API versioning strategies, backward compatibility shims |

---

## 3. Engine 1: Change Pointer Coverage Auditor Specification

### 3.1 Domain & Purpose
In SAP ERP (ECC & S/4HANA), master data replication via ALE/IDoc relies on the Change Pointer subsystem. When a user or background job modifies an application document, change documents are generated if the data element has the Change Document flag active in `DD04L`. If change pointers are enabled globally (`BD61`), active for the message type (`BD50`), and configured for the specific table and field in `BD52`, an entry is written into `BDCP2`. Background jobs running program `RBDMIDOC` (transaction `BD21`) then read `BDCP2` and dispatch IDocs.

A silent failure at any layer of this chain results in unsynchronized master data across the enterprise landscape without any operational error message. The Change Pointer Coverage Auditor performs an end-to-end configuration audit to prevent master data divergence.

### 3.2 Rule Taxonomy & Finding Catalog

| Rule ID | Finding Code | Severity | Confidence | Trigger Condition | Technical Remediation |
|---|---|---|---|---|---|
| `CP_RULE_001` | `CP_GLOBAL_DISABLED` | `CRITICAL` / `BLOCKER` | `VERIFIED` (1.0) | BD61 global change pointer activation is disabled (`active: false` or `' '`). | Execute transaction `BD61`, check the "Change pointers activated - generally" checkbox, and save. |
| `CP_RULE_002` | `CP_MESTYPE_DISABLED` | `CRITICAL` | `VERIFIED` (1.0) | BD50 entry for requested message type (e.g. `MATMAS`) is inactive (`active: false`). | Execute transaction `BD50`, locate message type, set checkbox to active (`X`), and save. |
| `CP_RULE_003` | `CP_FIELD_NOT_CONFIGURED_BD52` | `CRITICAL` / `MAJOR` | `VERIFIED` (1.0) | Expected business-critical field (e.g. `MARA-GROES`) is missing from `BD52` field linkage. | Execute transaction `BD52`, select message type and change document object (`MATERIAL`), and add missing table/field entry. |
| `CP_RULE_004` | `CP_DD04L_FLAG_MISSING` | `MAJOR` | `VERIFIED` (1.0) | Field is configured in `BD52`, but underlying data element in `DD04L` lacks the Change Document flag (`chdat: false`). | In transaction `SE11`, edit data element, check "Change document" attribute under Further Characteristics, and activate. |
| `CP_RULE_005` | `CP_REDUCED_MESTYPE_FILTERED` | `MAJOR` | `RULE_DERIVED` (0.85) | Message type uses reduced IDoc definition (`BD53`), but a configured field is suppressed in the filter. | In transaction `BD53`, verify the reduced message type field tree and uncheck suppression for the required field. |
| `CP_RULE_006` | `CP_CUSTOM_FIELD_OMITTED` | `MAJOR` | `RULE_DERIVED` (0.85) | Custom table extension (`YY1_` or `ZZ_`) exists in table but is omitted from `BD52`. | Add custom field to `BD52` under change document object and ensure append structure data element has Change Document flag set. |
| `CP_RULE_007` | `CP_RUNTIME_DISCREPANCY_BDCP2` | `MAJOR` / `MINOR` | `RULE_DERIVED` (0.85) | Expected field modifications not reflected in `BDCP2` sample export or stale backlog detected. | Check transaction `SM37` for periodic execution of `RBDMIDOC`, inspect `BD87` for failed IDocs, and verify update task execution. |
| `CP_RULE_999` | `CP_FILE_PARSE_ERROR` | `BLOCKER` | `VERIFIED` (1.0) | Payload missing required structure, corrupted JSON/CSV, or unparseable content. | Verify export format matches SAP Preflight Change Pointer extraction template. |

### 3.3 Fixture Catalog for Change Pointer Coverage Auditor

#### Fixture 1: `cp_matmas_active.json` (Golden Positive)
- **Role**: Happy-path baseline.
- **Content**: 
  - `bd61`: `{"active": true}`
  - `bd50`: `[{"mestype": "MATMAS", "active": true}]`
  - `bd52`: 35 material fields configured under `MATERIAL` (including `MARA-MATKL`, `MARA-GROES`, `MARA-MEINS`, `MARC-WERKS`, `MBEW-STPRS`, etc.)
  - `dd04l`: All data elements have `chdat: true`
  - `expected_fields`: 35 fields
  - `bdcp2_samples`: Active runtime records
- **Expected Result**: 0 critical/blocker findings, coverage = 100.0%, status `COMPLETED`.

#### Fixture 2: `cp_global_disabled.json` (Golden Negative — Global Blocker)
- **Role**: Verifies detection of unactivated global change pointer flag.
- **Content**:
  - `bd61`: `{"active": false}`
  - `bd50`: `[{"mestype": "MATMAS", "active": true}]`
  - `bd52`: Complete field list
- **Expected Result**: Emits `CP_GLOBAL_DISABLED` with severity `CRITICAL` or `BLOCKER`, confidence `VERIFIED`, cryptographic evidence pointing to BD61.

#### Fixture 3: `cp_missing_field.json` (Golden Negative — BD52 Gap)
- **Role**: Verifies detection of missing field in BD52.
- **Content**:
  - `bd61`: `{"active": true}`
  - `bd50`: `[{"mestype": "MATMAS", "active": true}]`
  - `bd52`: Missing `MARA-GROES` (Size/Dimensions) and `MARA-BRGEW` (Gross Weight)
  - `expected_fields`: Includes `MARA-GROES` and `MARA-BRGEW`
- **Expected Result**: Emits `CP_FIELD_NOT_CONFIGURED_BD52` findings for each missing field with exact table and field details.

#### Fixture 4: `cp_dd04l_flag_missing.json` (Edge Case — Dictionary Flag Missing)
- **Role**: Verifies detection of configuration illusion where BD52 has the field, but SAP data element will not trigger change documents.
- **Content**:
  - `bd61`: `{"active": true}`
  - `bd50`: `[{"mestype": "MATMAS", "active": true}]`
  - `bd52`: Includes `MARA-FERTH` (Production/inspection memo)
  - `dd04l`: `MARA-FERTH` / rollname `FERTH` has `chdat: false`
- **Expected Result**: Emits `CP_DD04L_FLAG_MISSING` with severity `MAJOR`, pointing to data element `FERTH`.

#### Fixture 5: `cp_custom_field_omitted.json` (Edge Case — Custom Extension Gap)
- **Role**: Verifies detection of custom clean core extension fields omitted from change pointers.
- **Content**:
  - `bd61`: `{"active": true}`
  - `bd50`: `[{"mestype": "MATMAS", "active": true}]`
  - `custom_fields`: `[{"table": "MARA", "field": "YY1_SUSTAINABILITY_SCORE", "rollname": "YY1_SUSTAINABILITY"}]`
  - `bd52`: Standard fields present, but `YY1_SUSTAINABILITY_SCORE` omitted
- **Expected Result**: Emits `CP_CUSTOM_FIELD_OMITTED` with severity `MAJOR`, confidence `RULE_DERIVED`.

#### Fixture 6: `cp_bd52_config.csv` (Tabular CSV Format)
- **Role**: Verifies deterministic parsing of legacy SAP spool / SE16 CSV table dumps.
- **Content**: Tabular CSV with headers `MESTYPE,CDOBJECT,TABNAME,FIELDNAME,ACTIVE`.
- **Expected Result**: Correctly parsed into engine internal structures and evaluated identically to JSON.

---

## 4. Engine 2: API Change Guard Specification

### 4.1 Domain & Purpose
Modern SAP architectures connect S/4HANA Cloud and on-premise systems with external cloud applications (Salesforce, Shopify, Coupa, ServiceNow, third-party MES/WMS) via REST/OpenAPI and OData (EDMX V2/V4) services. When SAP upgrades releases (e.g. S/4HANA Cloud 2402 $\rightarrow$ 2408, or ECC $\rightarrow$ S/4HANA 2023), API specifications change. 

The API Change Guard executes an automated AST diff between baseline and candidate specifications to detect:
1. **Breaking Contract Modifications**: Deletions, type alterations, length decreases, mandatory property additions, and enum restrictions.
2. **Non-Breaking Enhancements**: New endpoints, optional properties, enum additions.
3. **Consumer Impact Analysis**: Cross-referencing detected breaks against registered client applications in the **Project Integration Registry** to flag specific downstream consumers facing production outages.

### 4.2 Rule Taxonomy & Finding Catalog

| Rule ID | Finding Code | Severity | Confidence | Trigger Condition | Technical Remediation |
|---|---|---|---|---|---|
| `API_RULE_001` | `API_BREAKING_ENDPOINT_REMOVED` | `CRITICAL` / `BLOCKER` | `VERIFIED` (1.0) | An endpoint path (OpenAPI) or EntitySet (OData EDMX) was removed in candidate specification. | Retain legacy endpoint via API gateway facade or transition clients to replacement endpoint before deprecation. |
| `API_RULE_002` | `API_BREAKING_OPERATION_REMOVED` | `CRITICAL` | `VERIFIED` (1.0) | An HTTP operation (e.g. `DELETE`, `PUT`, `POST`) on an existing endpoint was removed. | Restore HTTP verb support or update client applications to use alternative operations. |
| `API_RULE_003` | `API_BREAKING_FIELD_REMOVED` | `CRITICAL` / `BLOCKER` | `VERIFIED` (1.0) | A property/field was removed from a request/response payload schema or OData EntityType. | Maintain deprecated field with mock/fallback values until all consumers migrate. |
| `API_RULE_004` | `API_BREAKING_REQUIRED_FIELD_ADDED`| `CRITICAL` | `VERIFIED` (1.0) | A newly required property was added to a request payload without a default value. | Make property optional or define server-side default value to maintain backward compatibility. |
| `API_RULE_005` | `API_BREAKING_TYPE_CHANGED` | `CRITICAL` | `VERIFIED` (1.0) | Data type of a property was modified (e.g. `string` $\rightarrow$ `integer`, `Edm.String` $\rightarrow$ `Edm.Int32`). | Revert type alteration or introduce a new property name for the typed representation. |
| `API_RULE_006` | `API_BREAKING_LENGTH_DECREASED` | `MAJOR` | `VERIFIED` (1.0) | `maxLength` of a string property was decreased (e.g. 40 $\rightarrow$ 20). | Maintain original length or verify no consumer submits payloads exceeding new boundary. |
| `API_RULE_007` | `API_BREAKING_ENUM_RESTRICTED` | `CRITICAL` | `VERIFIED` (1.0) | Allowed enum values were restricted/removed (e.g. `PENDING` removed from status enum). | Restore removed enum value or map to canonical status before deprecation. |
| `API_RULE_008` | `API_NON_BREAKING_FIELD_ADDED` | `INFO` | `VERIFIED` (1.0) | An optional property was added to request or response schema. | Inform API consumers of new optional capabilities. |
| `API_RULE_009` | `API_NON_BREAKING_ENDPOINT_ADDED` | `INFO` | `VERIFIED` (1.0) | A new endpoint, operation, or EntitySet was introduced. | Document new API capabilities in developer portal. |
| `API_RULE_010` | `API_NON_BREAKING_ENUM_EXPANDED` | `INFO` | `VERIFIED` (1.0) | New permitted values added to an existing enum. | Ensure client parsers handle unknown enum values gracefully. |
| `API_RULE_011` | `API_CONSUMER_IMPACT_DETECTED` | `CRITICAL` / `BLOCKER` | `RULE_DERIVED` (0.85) | A breaking change directly impacts a field/endpoint registered in `integration_registry`. | Notify impacted integration team (`affectedIntegrations`) immediately and schedule coordinated client update. |
| `API_RULE_999` | `API_SPEC_PARSE_ERROR` | `BLOCKER` | `VERIFIED` (1.0) | Invalid JSON, corrupted OpenAPI document, or unparseable EDMX XML. | Re-export API specification using standard OpenAPI v3 or OData EDMX v4 tools. |

### 4.3 Fixture Catalog for API Change Guard

#### Fixture 7: `api_openapi_clean.json` (Golden Positive)
- **Role**: Verifies backward-compatible updates with zero breaking changes.
- **Content**: 
  - `baseline_spec`: OpenAPI 3.0 with `/purchase-orders` (`GET`, `POST`) and schemas.
  - `candidate_spec`: Added new endpoint `/purchase-orders/{id}/tracking`, added optional property `deliveryInstructions` to `PurchaseOrder`, expanded `status` enum with `EXPRESS_HOLD`.
- **Expected Result**: 0 breaking changes, 3 non-breaking changes (`API_NON_BREAKING_ENDPOINT_ADDED`, `API_NON_BREAKING_FIELD_ADDED`, `API_NON_BREAKING_ENUM_EXPANDED`), status `COMPLETED`.

#### Fixture 8: `api_openapi_breaking.json` (Golden Negative — Multi-Break with Consumers)
- **Role**: Verifies multi-point breaking change detection and integration impact cross-checking.
- **Content**:
  - `baseline_spec`: OpenAPI 3.0 with `PurchaseOrder` schema containing `TaxJurisdictionCode`, operation `DELETE /orders/{id}`, status enum `["OPEN", "PENDING", "APPROVED", "REJECTED"]`.
  - `candidate_spec`: Removed `TaxJurisdictionCode`, removed `DELETE /orders/{id}`, added mandatory `taxCalculationMethod` (no default), restricted status enum to `["OPEN", "APPROVED", "REJECTED"]`.
  - `integration_registry`: `SALESFORCE_INTEGRATION_01` (consumes `PurchaseOrder.TaxJurisdictionCode`) and `B2B_PORTAL_WEB` (calls `DELETE /orders/{id}`).
- **Expected Result**: 
  - Emits `API_BREAKING_FIELD_REMOVED`, `API_BREAKING_OPERATION_REMOVED`, `API_BREAKING_REQUIRED_FIELD_ADDED`, `API_BREAKING_ENUM_RESTRICTED`.
  - Emits `API_CONSUMER_IMPACT_DETECTED` with `affectedIntegrations: ["SALESFORCE_INTEGRATION_01", "B2B_PORTAL_WEB"]`.

#### Fixture 9: `api_odata_edmx_type_change.xml` (OData Multi-Break XML)
- **Role**: Verifies OData EDMX V2/V4 schema parsing and breaking type modification detection.
- **Content**: Dual-spec XML document or candidate EDMX where:
  - Property `PostalCode` changed from `Edm.String` to `Edm.Int32`.
  - Property `LegacyTaxNumber` removed from `A_BusinessPartner` entity.
  - Navigation property `to_Supplier` set to `Nullable="false"` without default.
- **Expected Result**: Emits `API_BREAKING_TYPE_CHANGED`, `API_BREAKING_FIELD_REMOVED`.

#### Fixture 10: `api_integration_registry.json` (Integration Consumer Registry)
- **Role**: Enterprise registry fixture defining external consumers, system tiers, and consumed entities/fields.
- **Content**: JSON array of client registrations (`SALESFORCE_INTEGRATION_01`, `SHOPIFY_SYNC_APP`, `WMS_MANHATTAN_GATEWAY`).

#### Fixture 11: `api_odata_edmx_baseline.xml` (Authentic SAP OData Baseline)
- **Role**: Standalone authentic SAP S/4HANA OData V2 EDMX specification for Business Partner API (`API_BUSINESS_PARTNER`).

#### Fixture 12: `api_odata_edmx_candidate.xml` (Authentic SAP OData Candidate)
- **Role**: Standalone upgraded SAP S/4HANA Cloud OData V4 EDMX candidate specification with breaking and non-breaking changes.

---

## 5. Automated Test Matrix & Pytest Harness Architecture

The test harness in `proposed_test_domain3_engines.py` (deployable directly to `services/analysis-python/tests/unit/test_domain3_engines.py`) implements 24 comprehensive automated tests:

### 5.1 Test Suite Breakdown

| Category | Test Function | Target Engine | Assertion Focus |
|---|---|---|---|
| **Registration & Meta** | `test_change_pointer_metadata` | Change Pointer | Engine type, name, version, supported formats (`JSON`, `CSV`). |
| **Registration & Meta** | `test_api_change_metadata` | API Change | Engine type, name, version, supported formats (`JSON`, `EDMX`, `XML`). |
| **Golden Positive** | `test_cp_golden_clean_execution` | Change Pointer | `cp_matmas_active.json` returns 0 blocker/critical, coverage = 100.0%. |
| **Golden Positive** | `test_api_golden_clean_execution` | API Change | `api_openapi_clean.json` returns 0 breaking changes, non-breaking count > 0. |
| **Golden Negative** | `test_cp_global_disabled_trigger` | Change Pointer | `cp_global_disabled.json` triggers `CP_GLOBAL_DISABLED` with `CRITICAL`/`BLOCKER`. |
| **Golden Negative** | `test_cp_missing_field_trigger` | Change Pointer | `cp_missing_field.json` triggers `CP_FIELD_NOT_CONFIGURED_BD52` for `GROES`. |
| **Golden Negative** | `test_api_breaking_field_removed` | API Change | `api_openapi_breaking.json` triggers `API_BREAKING_FIELD_REMOVED`. |
| **Golden Negative** | `test_api_breaking_operation_removed`| API Change | `api_openapi_breaking.json` triggers `API_BREAKING_OPERATION_REMOVED`. |
| **Golden Negative** | `test_api_breaking_required_field` | API Change | `api_openapi_breaking.json` triggers `API_BREAKING_REQUIRED_FIELD_ADDED`. |
| **Golden Negative** | `test_api_breaking_enum_restricted` | API Change | `api_openapi_breaking.json` triggers `API_BREAKING_ENUM_RESTRICTED`. |
| **Consumer Impact** | `test_api_consumer_impact_detected` | API Change | `affectedIntegrations` correctly identifies `SALESFORCE_INTEGRATION_01`. |
| **Edge Cases** | `test_cp_dd04l_flag_missing` | Change Pointer | `cp_dd04l_flag_missing.json` triggers `CP_DD04L_FLAG_MISSING`. |
| **Edge Cases** | `test_cp_custom_field_omitted` | Change Pointer | `cp_custom_field_omitted.json` triggers `CP_CUSTOM_FIELD_OMITTED`. |
| **Edge Cases** | `test_cp_csv_format_parsing` | Change Pointer | `cp_bd52_config.csv` parses successfully and detects missing linkages. |
| **Edge Cases** | `test_api_edmx_type_change` | API Change | `api_odata_edmx_type_change.xml` triggers `API_BREAKING_TYPE_CHANGED`. |
| **Crypto Evidence** | `test_cp_evidence_sha256_integrity` | Change Pointer | Every finding has valid 64-char hex SHA-256 hash matching payload or snippet. |
| **Crypto Evidence** | `test_api_evidence_sha256_integrity` | API Change | Every finding has valid 64-char hex SHA-256 hash matching payload or snippet. |
| **Epistemic Invariant**| `test_cp_epistemic_confidence` | Change Pointer | Verified rules are `VERIFIED` (1.0); inferences are `RULE_DERIVED` (0.85). |
| **Epistemic Invariant**| `test_api_epistemic_confidence` | API Change | Diffs are `VERIFIED` (1.0); registry impacts are `RULE_DERIVED` (0.85). |
| **Confidence Demotion**| `test_confidence_llm_ceiling` | Both Engines | AI-flagged requests capped at `INFERRED` (0.60). |
| **Confidence Demotion**| `test_confidence_missing_evidence`| Both Engines | Findings stripped of evidence demoted to `UNKNOWN` (0.30). |
| **Determinism** | `test_cp_determinism_assertion` | Change Pointer | Running identical input twice produces byte-for-byte identical output. |
| **Determinism** | `test_api_determinism_assertion` | API Change | Running identical input twice produces byte-for-byte identical output. |
| **Property Fuzzing** | `test_fuzz_malformed_inputs` | Both Engines | Corrupted payloads, truncated XML, null values handled without crashing. |

---

## 6. Implementation & Provisioning Flow

```
[generate_domain3_fixtures.py]
      │
      ▼ (creates)
[services/analysis-python/tests/fixtures/domain3/]
      ├── cp_matmas_active.json
      ├── cp_global_disabled.json
      ├── cp_missing_field.json
      ├── cp_dd04l_flag_missing.json
      ├── cp_custom_field_omitted.json
      ├── cp_bd52_config.csv
      ├── api_openapi_clean.json
      ├── api_openapi_breaking.json
      ├── api_odata_edmx_type_change.xml
      ├── api_integration_registry.json
      ├── api_odata_edmx_baseline.xml
      └── api_odata_edmx_candidate.xml
      │
      ▼ (evaluated by)
[proposed_test_domain3_engines.py] ◄─── Pytest Test Harness
      │
      ▼ (validates)
100% Pass Rate across 24 tests
```
