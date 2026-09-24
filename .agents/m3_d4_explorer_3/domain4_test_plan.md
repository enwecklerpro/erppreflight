# Domain 4 Test Plan & Fixture Catalog: Release & Transport Preflight Engines

> **Domain**: Domain 4 — Release & Transport (Key-User Cloud Extensibility & Classic ABAP Transport Governance)  
> **Engines**:  
> 1. Feature 28: **Software Collection Dependency Guard** (`software_collection.py`, `EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD`)  
> 2. Feature 29: **Transport Dependency Analyzer** (`transport_dependency.py`, `EngineType.TRANSPORT_DEPENDENCY_ANALYZER`)  
> **Author**: `m3_d4_explorer_3` (Domain 4 Golden Fixtures & Pytest Harness Explorer)  
> **Governing Standards**: `AGENTS.md` (Cardinal Axioms 1 & 2), `engine-authoring.md`, `sap-evidence.md`, `secure-file-parser.md`  
> **Target Python Environment**: Python 3.13, Pytest 9.0+, Pydantic v2  

---

## 1. Executive Summary & Problem Scope

Domain 4 governs the software delivery lifecycle and release pipelines for both SAP Cloud and classic On-Premise/Private Cloud landscapes:

1. **Software Collection Dependency Guard (Feature 28)**:
   In SAP S/4HANA Cloud (Public & Private Editions), key-user extensibility assets (Custom Fields, Custom CDS Views, Cloud BAdIs, Custom Business Objects, Form Templates, and Fiori App Variants) are bundled into **Software Collections** using the Adaptation Transport Organizer (ATO).
   Because import jobs execute collection-by-collection in a sequential pipeline, cross-collection circularities ($A \to B \to A$), unexported prerequisite dependencies, draft items published into production exports, or dangling references to deleted fields cause catastrophic import freezes, unhandled runtime dumps, or silent tenant divergence.
   The engine performs deterministic dependency extraction, cycle detection via Tarjan's SCC and DFS 3-coloring, prerequisite boundary verification, and Kahn's topological sort for optimal import sequencing.

2. **Transport Dependency Analyzer (Feature 29)**:
   In classic ABAP environments (SAP ECC 6.0 and SAP S/4HANA On-Premise/Private Cloud), development and configuration are packaged into CTS Transport Requests (Workbench `K` and Customizing `W`).
   In concurrent development environments, transports frequently encounter **object collisions** (the same class or table edited in parallel open requests), **cross-transport call dependencies** (an ABAP report in TR1 calling a method in TR2 where TR1 is imported first), **overtaker / downgrade regressions** (an older transport version overtaking a newer one in the import queue), and **customizing ahead of structure** (`E071K` table entries imported into a target system before the underlying `E071 TABL` table is created or modified).
   The engine analyzes CTS header (`E070`), object list (`E071`), table key (`E071K`), and call-tree artifacts to prevent production downtime and software regressions.

To satisfy **Cardinal Axiom 2** (*"An engine without deterministic logic/evidence/fixtures is not complete"*), both engines are evaluated against authentic positive, negative, and edge-case enterprise fixtures, strict cryptographic evidence verification, epistemic confidence scoring, and an automated pytest test harness achieving a 100% pass rate.

---

## 2. Cardinal Axiom 2 Compliance Matrix (14 Architectural Points)

| # | Architectural Point | Software Collection Dependency Guard | Transport Dependency Analyzer |
|---|---|---|---|
| **1** | **Metadata** | `engine_type = EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD`, ID `software_collection_guard`, v1.0.0, Domain `Release & Transport`, Artifacts: `JSON`, `XML`, `ZIP`. | `engine_type = EngineType.TRANSPORT_DEPENDENCY_ANALYZER`, ID `transport_dependency_analyzer`, v1.0.0, Domain `Release & Transport`, Artifacts: `JSON`, `CSV`, `XML`. |
| **2** | **Input Schema** | Strict Pydantic v2 schemas: `SoftwareCollectionItem`, `SoftwareCollection`, `SoftwareCollectionManifest`, plus normalized dependency map dictionaries. | Strict Pydantic v2 schemas: `E070Record`, `E071Record`, `E071KRecord`, `CallReference`, plus transport mapping dictionaries. |
| **3** | **Deterministic Parser** | Line-preserving JSON parser, defused XML parser (`defusedxml.ElementTree`), memory-bounded ZIP parser enforcing 100:1 ratio and 500 MB max uncompressed volume. | Dialect-sniffing CSV parser, line-preserving JSON parser, and defused XML parser. Zero probabilistic guessing. |
| **4** | **Pure Rule Evaluation** | Pure graph algorithms: Tarjan's SCC, DFS 3-coloring, Kahn's topological sort with lexicographical tie-breaking. Zero side effects or non-deterministic drift. | Deterministic collision matrix indexing, chronological timestamp comparison, dictionary prerequisite checks, and topological sequence calculation. |
| **5** | **Standard Taxonomy** | Structured unique codes: `SC_CIRCULAR_DEPENDENCY`, `SC_MISSING_PREREQUISITE`, `SC_DRAFT_ITEM_INCLUDED`, `SC_DANGLING_FIELD_REFERENCE`, `SC_SCHEMA_VALIDATION_FAILED`. | Structured unique codes: `TR_OBJECT_COLLISION`, `TR_CALL_DEPENDENCY_SEQUENCE_RISK`, `TR_OVERTAKER_DOWNGRADE_RISK`, `TR_CUSTOMIZING_AHEAD_OF_STRUCTURE`, `TR_CIRCULAR_DEPENDENCY_DETECTED`. |
| **6** | **Crypto Evidence Chains** | Every finding encapsulates an `Evidence` object with artifact relative path, 1-indexed line/column coordinates, verbatim snippet, and SHA-256 hash. | Every finding references exact line/row numbers, verbatim artifact snippets, and cryptographic SHA-256 hashes of snippets and artifacts. |
| **7** | **Epistemic Confidence** | Strict classification: `VERIFIED` (1.0) for explicit manifest declarations; `RULE_DERIVED` (0.85) for standard naming conventions; `UNKNOWN` (0.30) for dangling UUIDs. | Strict classification: `VERIFIED` (1.0) for explicit table entries; `RULE_DERIVED` (0.85) for call tree syntax inferences and timestamps; `UNKNOWN` (0.30) if evidence missing. |
| **8** | **Curated Fixtures** | 6 golden fixtures: `sc_valid_sequence.json`, `sc_circular.json`, `sc_missing_prereq.json`, `sc_draft_item.json`, `sc_linear_manifest.xml`, `sc_dangling_field.json`. | 6 golden fixtures: `tr_valid_sequence.json`, `tr_valid_e070_e071.csv`, `tr_collision.json`, `tr_collision.csv`, `tr_overtaker_downgrade.json`, `tr_customizing_ahead_of_structure.json`. |
| **9** | **Automated Test Suite** | Comprehensive unit & integration pytest suite executing under Python 3.13 with 100% pass rate. | Comprehensive unit & integration pytest suite executing under Python 3.13 with 100% pass rate. |
| **10** | **Property-Based Testing** | Graph property verification across DAG topologies, multi-cycle graphs, empty graphs, and single-node self-loops. | Collision property verification across independent sets, multi-transport collisions, and sequence stability checks. |
| **11** | **Telemetry & Metrics** | Emits `execution_time_ms`, `rules_evaluated`, `artifacts_scanned`, `totalCollections`, `totalItems`, `circularDependenciesCount`, `recommendedSequence`. | Emits `execution_time_ms`, `rules_evaluated`, `totalTransports`, `totalObjects`, `collisionsCount`, `overtakerRisksCount`, `recommendedImportSequence`. |
| **12** | **Report Serialization** | Serializes to standard `AnalysisResponse` matching spec §11.7 and project wire contracts with findings list and metrics. | Serializes to standard `AnalysisResponse` matching spec §12.7 and project wire contracts with findings list and metrics. |
| **13** | **Admin Visibility** | Operational status, rule catalog, and engine metadata exposed via `EngineRegistry`. | Operational status, rule catalog, and engine metadata exposed via `EngineRegistry`. |
| **14** | **Remediation Guides** | Release-specific remediation instructions referencing SAP Fiori apps "Export Software Collections" (`F1433`) and "Import Software Collections" (`F1434`). | Release-specific remediation instructions referencing SAP transactions `STMS`, `SE01`, `SE09`, `SE10`, ChaRM, and CSOL. |

---

## 3. Engine 1: Software Collection Dependency Guard Specification

### 3.1 Rule Taxonomy & Finding Catalog

| Rule ID | Finding Code | Severity | Confidence | Trigger Condition | Technical Remediation |
|---|---|---|---|---|---|
| `SC_RULE_001` | `SC_CIRCULAR_DEPENDENCY` | `CRITICAL` | `VERIFIED` (1.0) | Directed cycle detected in software collection dependency graph ($A \to B \to A$ or multi-collection chain). | Merge mutually dependent extensibility items into a single unified Software Collection in Fiori app F1433, or extract foundational items into a separate prerequisite collection. |
| `SC_RULE_002` | `SC_MISSING_PREREQUISITE` | `BLOCKER` | `VERIFIED` (1.0) | A collection references an item or collection that is neither present in the export manifest nor in `target_system_collections` / `target_system_items`. | Include the missing prerequisite collection in the export batch, or verify and import it into the target tenant prior to importing the dependent collection. |
| `SC_RULE_003` | `SC_DRAFT_ITEM_INCLUDED` | `MAJOR` | `VERIFIED` (1.0) | An extensibility item within an exported software collection has status `DRAFT` or `IN_WORK`. | Open the SAP Fiori app "Custom Fields" or "Custom Logic", verify the implementation, and click "Publish" before re-exporting the software collection. |
| `SC_RULE_004` | `SC_DANGLING_FIELD_REFERENCE` | `CRITICAL` | `VERIFIED` (1.0) / `UNKNOWN` (0.30) | An App Variant, CDS View, or Form Template references a field/item that is `DELETED`/`OBSOLETE`, or an unresolvable UUID. | Restore or recreate the custom field in the development tenant, or adjust the App Variant / CDS View layout to remove the invalid reference. |
| `SC_RULE_999` | `SC_SCHEMA_VALIDATION_FAILED` | `BLOCKER` | `UNKNOWN` (0.30) | Malformed JSON, corrupted XML, zip slip, or invalid archive data failing closed. | Correct the manifest format to comply with SAP Key-User Software Collection export schema. |

### 3.2 Curated Golden Fixture Catalog for Software Collection Guard

#### Fixture 1: `sc_valid_sequence.json` (Golden Positive)
- **File**: `services/analysis-python/tests/fixtures/domain4/sc_valid_sequence.json`
- **Role**: Happy-path baseline with two independent or linearly ordered collections.
- **Content**:
  - `SC_CORE`: Contains `YY1_CUSTOMER_TYPE` (`CUSTOM_FIELD`, `PUBLISHED`), 0 dependencies.
  - `SC_SALES`: Contains `YY1_CDS_SALES_ORDER` (`CDS_VIEW`, `PUBLISHED`), depends on `SC_CORE:YY1_CUSTOMER_TYPE`.
- **Expected Assertions**:
  - `status == AnalysisStatus.COMPLETED`
  - `findings == []`
  - `recommendedSequence == ["SC_CORE", "SC_SALES"]`
  - `circularDependenciesCount == 0`

#### Fixture 2: `sc_circular.json` (Golden Negative — 2-Node Circularity)
- **File**: `services/analysis-python/tests/fixtures/domain4/sc_circular.json`
- **Role**: Classic mutual dependency between collections.
- **Content**:
  - `SC_FINANCE` depends on `SC_SALES` (e.g. Journal Entry CDS references Sales Order Field).
  - `SC_SALES` depends on `SC_FINANCE` (e.g. Sales Invoice Form references Finance Field).
- **Expected Assertions**:
  - Emits `SC_CIRCULAR_DEPENDENCY` with severity `CRITICAL` and confidence `VERIFIED`.
  - Evidence coordinates point to dependency declarations.
  - `recommendedSequence == []` (cannot sequence circular graphs).
  - Also wire-compatible with `SoftwareCollectionGuardEvaluator.evaluate()` in `tests/e2e/evaluators.py`.

#### Fixture 3: `sc_missing_prereq.json` (Golden Negative — Missing Prerequisite)
- **File**: `services/analysis-python/tests/fixtures/domain4/sc_missing_prereq.json`
- **Role**: Verifies detection of external dependencies absent from both export batch and target system.
- **Content**:
  - `SC_ANALYTICS`: Contains CDS View `YY1_ANALYTICS_QUERY` depending on `YY1_CDS_ORDER_DETAIL` located in `SC_INVENTORY`.
  - `SC_INVENTORY` is NOT present in the export manifest, and NOT listed in `target_system_collections`.
- **Expected Assertions**:
  - Emits `SC_MISSING_PREREQUISITE` with severity `BLOCKER` and confidence `VERIFIED`.
  - Evidence points to the unresolved prerequisite item.

#### Fixture 4: `sc_draft_item.json` (Golden Negative — Draft Item Published)
- **File**: `services/analysis-python/tests/fixtures/domain4/sc_draft_item.json`
- **Role**: Verifies detection of draft-state key-user items packaged prematurely.
- **Content**:
  - `SC_LOGISTICS`: Contains Custom Logic / BAdI `BADI_GOODS_RECEIPT_VALIDATION` with `status: "DRAFT"`.
- **Expected Assertions**:
  - Emits `SC_DRAFT_ITEM_INCLUDED` with severity `MAJOR` and confidence `VERIFIED`.
  - Evidence identifies the line number and item ID of the draft artifact.

#### Fixture 5: `sc_linear_manifest.xml` (Golden Positive — Defused XML Format)
- **File**: `services/analysis-python/tests/fixtures/domain4/sc_linear_manifest.xml`
- **Role**: Verifies parsing of authentic SAP ATO XML export format.
- **Content**:
  - XML format with `<software_collections>`, `<collection>`, and `<item>` nodes.
  - Line numbers preserved; XXE prevented by `SafeXmlParser`.
- **Expected Assertions**:
  - Clean parsing with 0 findings, valid sequence produced.

#### Fixture 6: `sc_dangling_field.json` (Edge Case — Dangling Reference)
- **File**: `services/analysis-python/tests/fixtures/domain4/sc_dangling_field.json`
- **Role**: Verifies detection of App Variants referencing deleted fields or unresolvable UUIDs.
- **Content**:
  - `SC_UI_ADAPTATIONS`: Contains App Variant `CUST_SO_CREATE` referencing field `YY1_OBSOLETE_DISCOUNT` marked `DELETED`.
- **Expected Assertions**:
  - Emits `SC_DANGLING_FIELD_REFERENCE` with severity `CRITICAL`.

---

## 4. Engine 2: Transport Dependency Analyzer Specification

### 4.1 Rule Taxonomy & Finding Catalog

| Rule ID | Finding Code | Severity | Confidence | Trigger Condition | Technical Remediation |
|---|---|---|---|---|---|
| `TR_RULE_001` | `TR_OBJECT_COLLISION` | `CRITICAL` | `VERIFIED` (1.0) | Same repository object (`PGMID`, `OBJECT`, `OBJ_NAME`, e.g. `CLAS ZCL_ORDER_HANDLER`) appears in multiple open, unreleased, or concurrently scheduled transports. | Coordinate between development tracks using Cross-System Object Locking (CSOL). Merge changes into a single transport request, or release and import in coordinated sequence. |
| `TR_RULE_002` | `TR_CALL_DEPENDENCY_SEQUENCE_RISK` | `CRITICAL` / `MAJOR` | `VERIFIED` (1.0) / `RULE_DERIVED` (0.85) | Object in TR1 calls/references an object created or altered in TR2, but TR1 is imported before TR2 or TR2 is omitted. | Adjust import sequence in STMS to import prerequisite transport TR2 before dependent transport TR1, or bundle into a transport collection. |
| `TR_RULE_003` | `TR_OVERTAKER_DOWNGRADE_RISK` | `BLOCKER` / `CRITICAL` | `RULE_DERIVED` (0.85) / `VERIFIED` (1.0) | Sequence inversion where an older transport version of an object is scheduled for import after a newer version. | Lock import queue in STMS. Remove overtaking transport or re-export latest consolidated version to prevent code regression in target environment. |
| `TR_RULE_004` | `TR_CUSTOMIZING_AHEAD_OF_STRUCTURE` | `BLOCKER` | `VERIFIED` (1.0) | Customizing table entry (`E071K` / `TABU`) is scheduled for import without or ahead of the structural table definition (`E071 TABL`). | Resequence transports so the Workbench request defining the table imports before the Customizing request containing table entries. |
| `TR_RULE_005` | `TR_CIRCULAR_DEPENDENCY_DETECTED` | `CRITICAL` | `VERIFIED` (1.0) | Transports contain mutually dependent objects ($TR_A \to TR_B \to TR_A$). | Merge colliding objects or refactor cross-transport dependencies to break the circular invocation chain. |

### 4.2 Curated Golden Fixture Catalog for Transport Dependency Analyzer

#### Fixture 1: `tr_valid_sequence.json` (Golden Positive)
- **File**: `services/analysis-python/tests/fixtures/domain4/tr_valid_sequence.json`
- **Role**: Happy-path baseline with 3 clean, linearly dependent or independent transports.
- **Content**:
  - `DEVK900010`: Contains `TABL ZCUSTOMER` (DDIC structure).
  - `DEVK900020`: Contains `CLAS ZCL_CUSTOMER_SVC` (references `TABL ZCUSTOMER`).
  - `DEVK900030`: Contains `PROG ZCUSTOMER_RPT` (calls `ZCL_CUSTOMER_SVC`).
- **Expected Assertions**:
  - `status == AnalysisStatus.COMPLETED`
  - `collisionsCount == 0`
  - `recommendedImportSequence == ["DEVK900010", "DEVK900020", "DEVK900030"]`
  - 0 critical findings.

#### Fixture 2: `tr_valid_e070_e071.csv` (Golden Positive — CSV Dialect)
- **File**: `services/analysis-python/tests/fixtures/domain4/tr_valid_e070_e071.csv`
- **Role**: Authentic CSV export from SAP tables `E070` and `E071`.
- **Content**:
  - Columns: `TRKORR,PGMID,OBJECT,OBJ_NAME,AS4USER,AS4DATE,AS4TIME,TRSTATUS`
  - Distinct objects across distinct transports.
- **Expected Assertions**:
  - Zero collisions detected, status `COMPLETED`.

#### Fixture 3: `tr_collision.json` (Golden Negative — Object Collision)
- **File**: `services/analysis-python/tests/fixtures/domain4/tr_collision.json`
- **Role**: Multiple concurrent transports modifying `CLAS ZCL_ORDER_HANDLER` and `TABL ZORDERS`.
- **Content**:
  - `DEVK900101` and `DEVK900105` both modify `CLAS ZCL_ORDER_HANDLER`.
- **Expected Assertions**:
  - Emits `TR_OBJECT_COLLISION` with severity `CRITICAL` and confidence `VERIFIED`.
  - Evidence identifies both transports and exact lines in the payload.
  - Wire-compatible with `TransportAnalyzerEvaluator.evaluate()` in `tests/e2e/evaluators.py`.

#### Fixture 4: `tr_collision.csv` (Golden Negative — Collision in CSV)
- **File**: `services/analysis-python/tests/fixtures/domain4/tr_collision.csv`
- **Role**: Verifies collision detection on raw CSV table dumps.
- **Content**:
  - Duplicate `R3TR,CLAS,ZCL_ORDER_HANDLER` lines under different `TRKORR`.
- **Expected Assertions**:
  - Emits `TR_OBJECT_COLLISION` with CSV line numbers.

#### Fixture 5: `tr_overtaker_downgrade.json` (Golden Negative — Overtaker Downgrade)
- **File**: `services/analysis-python/tests/fixtures/domain4/tr_overtaker_downgrade.json`
- **Role**: Sequence inversion risking overwriting new code with an older version.
- **Content**:
  - `DEVK900050` (timestamp 2026-09-01 10:00) contains `PROG ZPAYMENT_RUN` (v1).
  - `DEVK900060` (timestamp 2026-09-15 14:00) contains `PROG ZPAYMENT_RUN` (v2).
  - Planned import sequence places `DEVK900060` *before* `DEVK900050`.
- **Expected Assertions**:
  - Emits `TR_OVERTAKER_DOWNGRADE_RISK` with severity `BLOCKER` / `CRITICAL`.
  - Identifies regression risk where `DEVK900050` overwrites newer changes from `DEVK900060`.

#### Fixture 6: `tr_customizing_ahead_of_structure.json` (Golden Negative — Customizing Before Table)
- **File**: `services/analysis-python/tests/fixtures/domain4/tr_customizing_ahead_of_structure.json`
- **Role**: Customizing transport contains table keys for a table whose structural definition is in a Workbench transport imported later.
- **Content**:
  - `DEVK900080` (Customizing `W`): Contains `E071K` key entries for table `ZPRICING_CONFIG`.
  - `DEVK900070` (Workbench `K`): Contains `E071` definition for `TABL ZPRICING_CONFIG`.
  - Planned sequence: `DEVK900080` before `DEVK900070`.
- **Expected Assertions**:
  - Emits `TR_CUSTOMIZING_AHEAD_OF_STRUCTURE` with severity `BLOCKER`.
  - Evidence points to the E071K entry and the missing/delayed structural table definition.

---

## 5. Automated Test Harness Architecture

The test harness in `proposed_test_domain4_engines.py` enforces:

1. **Self-Healing Dual-Mode Runner**:
   - Resolves peer explorer implementations from `.agents/m3_d4_explorer_1/proposed_software_collection.py` and `.agents/m3_d4_explorer_2/proposed_transport_dependency.py` when running in explorer preview mode.
   - Automatically falls back to standard installed engines in `src.engines` when running in deployed production mode.
2. **Cardinal Axiom 2 Auditing**:
   - Every finding emitted across all 24+ test cases is validated for:
     - Valid `rule_id` matching canonical prefixes (`SC_` or `TR_`).
     - Valid `Severity` enum (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `INFO`).
     - Valid `ConfidenceClass` enum (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`).
     - Non-empty cryptographic evidence containing relative artifact path, 1-indexed line/column numbers, code snippet, and valid 64-character SHA-256 hash.
     - Release-specific actionable remediation guide.
3. **Graph Property & Fuzz Testing**:
   - Graph invariants tested on arbitrary DAGs, multi-cycle graphs, and self-loops.
   - Fault tolerance tested against malformed JSON, corrupted CSV, and unparseable XML payloads.
4. **100% Pass Rate Requirement**:
   - Pytest execution under Python 3.13 must achieve 100% pass rate with zero warnings or collection errors.
