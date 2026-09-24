# Production Blueprint: Transport Dependency Analyzer (Feature 29)

> **Engine Canonical ID**: `transport_dependency_analyzer`  
> **Operational Domain**: Release & Transport / Classic ABAP Transport Governance  
> **Service Layer**: `services/analysis-python/src/engines/transport_dependency.py`  
> **Authoring Standard**: Monorepo `AGENTS.md`, Cardinal Axioms 1 & 2 (14-Point Engine Anatomy), `engine-authoring.md`, `sap-evidence.md`

---

## 1. Executive Summary & Business Context

SAP Change and Transport System (CTS) is the mission-critical backbone for propagating ABAP workbench and customizing developments across system landscapes (DEV → QAS → PRD). However, in complex multi-track landscapes or parallel project deliveries, transports frequently suffer from:
1. **Object Collisions**: Multiple active, modifiable, or concurrently imported transports modifying identical ABAP repository objects (classes, tables, reports, function groups), causing merge overwrites and severe functional regressions.
2. **Cross-Transport Call Dependencies & Sequence Inversions**: Transport A contains code (e.g. an ABAP report or business service) that calls, invokes, or references a method, function module, or table created or modified in Transport B. If Transport A is imported into QA or Production ahead of Transport B, the ABAP kernel throws `SYNTAX_ERROR`, `LOAD_PROGRAM_NOT_FOUND`, or `CALL_FUNCTION_NOT_FOUND` short dumps, causing production outage.
3. **Overtaker / Downgrade Risks**: An older version of an object in Transport A is released or imported *after* a newer version in Transport B has already been imported, causing catastrophic code rollback (regression).
4. **Customizing Ahead of Structure**: Customizing table records (`E071K` table keys) are transported ahead of or without the underlying ABAP Dictionary structural table definition (`E071 TABL`), causing transport import termination with return code `RC 8` or `RC 12` (`table does not exist in target database`).
5. **Missing Prerequisite Transports**: Objects reference target elements present only in transports never queued for import.

The **Transport Dependency Analyzer** provides deterministic, mathematically verifiable preflight auditing of transport requests before import queues are triggered in `STMS` (SAP Transport Management System) or orchestrated via SAP Cloud ALM / SAP Solution Manager ChaRM.

---

## 2. Cardinal Axiom 2: 14-Point Architectural Anatomy

| # | Architectural Point | Production Implementation in Transport Dependency Analyzer |
|---|---|---|
| **1** | **Metadata** | `engine_type = EngineType.TRANSPORT_DEPENDENCY_ANALYZER`, canonical ID `transport_dependency_analyzer`, Version `2.0.0`, Domain `RELEASE_AND_TRANSPORT`, Target Releases `S4H_2020` through `S4H_2023`, `ECC_608`, supported artifacts: `JSON`, `CSV`, `XML`, `TXT`. |
| **2** | **Input Schema** | Strict runtime Pydantic v2 schemas validating CTS tables: `E070Record`, `E071Record`, `E071KRecord`, `CallReference`, and `TransportDependencyPayload`. Rejects malformed types with actionable validation errors. |
| **3** | **Deterministic Parser** | Multi-format parsers handling: (a) CTS JSON exports (table lists or shorthand maps), (b) CTS CSV exports (with dialect/delimiter auto-sniffing), (c) CTS Defused XML (`SafeXmlParser` preventing XXE/Billion Laughs with exact line/column retention). |
| **4** | **Pure Rule Evaluation** | 100% deterministic, side-effect free rule evaluations. Zero probabilistic drift. Two identical artifact inputs yield byte-for-byte identical findings, metrics, and import sequences. |
| **5** | **Standard Finding Taxonomy** | Structured unique codes: `TR_OBJECT_COLLISION`, `TR_CALL_DEPENDENCY_SEQUENCE_RISK`, `TR_OVERTAKER_DOWNGRADE_RISK`, `TR_CUSTOMIZING_AHEAD_OF_STRUCTURE`, `TR_CIRCULAR_DEPENDENCY_DETECTED`, `TR_MISSING_PREREQUISITE_TRANSPORT`. |
| **6** | **Cryptographic Evidence Chains** | Every finding references exact 1-indexed line and column coordinates, verbatim artifact snippets, and cryptographic SHA-256 hashes of snippets and artifacts. |
| **7** | **Epistemic Confidence Classification** | Strict classification: `VERIFIED` (1.0) for explicit table collisions in E070/E071 and E071K customizing linkage; `RULE_DERIVED` (0.85) for call tree syntax inferences; demoted to `UNKNOWN` (0.30) if evidence missing. AI ceiling capped at `INFERRED` (0.60). |
| **8** | **Curated Test Fixtures** | Positive, negative, and edge fixtures covering clean sequences, collisions, overtaking downgrades, customizing order violations, circular loops, CSV, and XML payloads. |
| **9** | **Automated Test Suite** | Comprehensive unit test suite executing under `pytest` with a mandatory 100% pass rate. |
| **10** | **Property-Based Testing** | Fuzz testing against random inputs, malformed CSV headers, corrupt JSON, hostile XML, and cycle permutations. |
| **11** | **Telemetry & Metrics** | Execution duration (`execution_time_ms`), `rules_evaluated`, `total_transports`, `total_objects`, `collisions_count`, `dependency_risks_count`, `overtaker_risks_count`, `customizing_ahead_count`, `recommended_import_sequence`. |
| **12** | **Report Serialization** | Serializes to standardized `AnalysisResponse` matching spec §12.7 with both snake_case and camelCase metric representations. |
| **13** | **Admin Visibility** | Rule catalogue, supported artifact matrix, and operational status exposed via engine class metadata and `src/core/registry.py`. |
| **14** | **Remediation Documentation** | Explicit, actionable SAP remediation instructions referencing transaction codes (`STMS`, `SE01`, `SE09`, `SE10`), CSOL, ChaRM, and release train merging. |

---

## 3. CTS Data Model & Input Formats

### 3.1 SAP CTS Tables & Fields

1. **`E070` (Transport Request Header)**:
   - `TRKORR` (char 20): Transport Request number (e.g. `DEVK900101`).
   - `TRFUNCTION` (char 1): Type of transport request:
     - `'K'`: Workbench Request (cross-client DDIC, ABAP classes, programs)
     - `'W'`: Customizing Request (client-dependent configuration, table rows)
     - `'T'`: Transport of Copies (test import)
     - `'C'`: Relocation
     - `'S'`: Development/Correction Task
     - `'X'`: Unclassified Task
   - `TRSTATUS` (char 1): Status:
     - `'D'`: Modifiable (open development)
     - `'L'`: Modifiable, protected
     - `'O'`: Release started
     - `'R'`: Released
     - `'N'`: Imported
   - `AS4USER` (char 12): Owner / Author.
   - `AS4DATE` (char 8) & `AS4TIME` (char 6): Last modification / release timestamp.
   - `TARSYSTEM` (char 10): Target system (e.g., `QAS`, `PRD`).
   - `STRKORR` (char 20): Parent transport request for sub-tasks.

2. **`E071` (Transport Request Object List)**:
   - `TRKORR` (char 20): Transport Request number.
   - `PGMID` (char 4): Program ID (`'R3TR'`, `'LIMU'`, `'CORR'`).
   - `OBJECT` (char 4): Object Type (`'CLAS'`, `'TABL'`, `'VIEW'`, `'PROG'`, `'FUGR'`, `'DOMA'`, `'DTEL'`, `'INTF'`, `'ENHO'`, `'TTYP'`, `'MSAG'`, `'TABU'`).
   - `OBJ_NAME` (char 120): Repository object name (e.g., `'ZCL_ORDER_HANDLER'`, `'ZORDERS'`).
   - `OBJFUNC` (char 1): Object function (`' '` Standard, `'K'` Key entries, `'D'` Delete).

3. **`E071K` (Transport Request Table Keys)**:
   - `TRKORR` (char 20): Transport Request number.
   - `PGMID` (char 4): Program ID (`'R3TR'`).
   - `OBJECT` (char 4): Object Type (`'TABU'`).
   - `OBJ_NAME` (char 120): Table/View name.
   - `TABLENAME` (char 30): Target transparent/cluster table name (e.g. `'ZCONFIG'`).
   - `TABKEY` (char 120): Transported key representation (e.g. `'100*'`, `'00100025'`).

4. **Call References / Syntax Links**:
   - `CALLER_TR`: Originating transport containing caller object.
   - `CALLER_OBJECT`: Full object name of caller (e.g., `PROG ZREPORT`, `CLAS ZCL_A`).
   - `CALLEE_TR`: Target transport containing callee object.
   - `CALLEE_OBJECT`: Full object name of callee (e.g., `CLAS ZCL_B`, `TABL ZTABLE`).
   - `REFERENCE_TYPE`: `CALL_METHOD`, `CALL_FUNCTION`, `SELECT_TABLE`, `INHERITS_FROM`, `USES_TYPE`.

---

## 4. Deterministic Rule Definitions

### Rule 1: Object Collision (`TR_OBJECT_COLLISION`)
- **Severity**: `CRITICAL`
- **Condition**: Given $T = \{t_1, t_2, \dots, t_n\}$ transports, if an object $O$ appears in $E071(t_i)$ and $E071(t_j)$ with $i \neq j$.
- **Impact**: Importing without awareness causes code overwrite.
- **Evidence**: Line coordinates from both transport entries in source artifact.
- **Confidence**: `VERIFIED` (1.0).

### Rule 2: Cross-Transport Call Dependency & Sequence Inversion (`TR_CALL_DEPENDENCY_SEQUENCE_RISK`)
- **Severity**: `CRITICAL` (or `BLOCKER` if missing prerequisite)
- **Condition**: Object $O_A \in t_A$ references object $O_B \in t_B$. If planned import sequence has $t_A$ before $t_B$, or $t_A$ is scheduled while $t_B$ is missing.
- **Impact**: ABAP runtime short dumps (`SYNTAX_ERROR`, `LOAD_PROGRAM_NOT_FOUND`).
- **Evidence**: Call reference entry line pointer.
- **Confidence**: `RULE_DERIVED` (0.85) for call references / `VERIFIED` (1.0) for explicit declarations.

### Rule 3: Overtaker / Downgrade Risk (`TR_OVERTAKER_DOWNGRADE_RISK`)
- **Severity**: `BLOCKER`
- **Condition**: Transports $t_1$ and $t_2$ both contain object $O$. If $t_1$ was created/released earlier than $t_2$ ($Timestamp(t_1) < Timestamp(t_2)$), but in the import sequence $t_1$ is positioned *after* $t_2$ (or $t_2$ is already imported while $t_1$ is queued).
- **Impact**: Newer development is overwritten with older code (software regression).
- **Evidence**: Timestamp and collision lines from both transports.
- **Confidence**: `RULE_DERIVED` (0.85) when based on release timestamps / `VERIFIED` (1.0) when based on CTS version history.

### Rule 4: Customizing Ahead of Structure (`TR_CUSTOMIZING_AHEAD_OF_STRUCTURE`)
- **Severity**: `BLOCKER`
- **Condition**: Transport $t_C$ contains $E071K$ entries for table $T$, while transport $t_W$ contains $E071$ definition for $TABL\ T$. If $t_C$ is scheduled before $t_W$, or $t_W$ is absent from the import queue.
- **Impact**: Database insert failure during customizing import (`SQL table does not exist`), import aborts with `RC 8` / `RC 12`.
- **Evidence**: E071K line pointer in $t_C$ and E071 line pointer in $t_W$.
- **Confidence**: `VERIFIED` (1.0).

### Rule 5: Topological Import Sequencing (`recommendedImportSequence`)
- **Engine**: Builds a directed graph $G = (V, E)$ where vertices are transports and directed edges $(u, v)$ represent prerequisite requirements: transport $u$ must precede transport $v$ ($u \prec v$).
- **Edge Sources**:
  1. Call dependencies: $callee\_tr \prec caller\_tr$.
  2. Customizing/DDIC structural dependencies: $tr_{workbench} \prec tr_{customizing}$.
  3. Collision ordering: $older\_tr \prec newer\_tr$.
- **Algorithm**: Kahn's topological sort with deterministic alphabetical tie-breaking.
- **Cycle Handling**: Tarjan / DFS cycle detection; if a cycle occurs (e.g. mutually dependent transports), emits finding `TR_CIRCULAR_DEPENDENCY_DETECTED` with exact cycle path, and safely falls back to a deterministic resolution.

---

## 5. Artifact Ingestion & Multi-Format Parsing

The engine dynamically detects and accepts three standard artifact structures:
1. **JSON Format**:
   - Standard CTS table dictionary: `{"e070": [...], "e071": [...], "e071k": [...], "call_references": [...]}`.
   - Or fixture mapping: `{"transports": {"TR1": ["CLAS ZCL_A", ...]}, "planned_sequence": [...]}`.
2. **CSV Format**:
   - Accepts E071 object list CSV: `TRKORR,PGMID,OBJECT,OBJ_NAME,OBJFUNC`.
   - Accepts combined CTS CSV with record type tagging or multiple CSV files via `request.artifacts`.
3. **XML Format**:
   - Defused XML parsing with `SafeXmlParser` preserving 1-indexed line and column numbers.
   - Extracts `<E070>`, `<E071>`, `<E071K>`, and `<DEPENDENCY>` elements while protecting against XXE, entity expansion, and remote DTD loading.

---

## 6. Verification and Acceptance Criteria

1. **Deterministic Execution**: Identical inputs yield identical findings, metrics, and sequences across 1,000 runs.
2. **Backward Compatibility**: Fully compatible with `TransportAnalyzerEvaluator.evaluate(trs)` in `tests/e2e/test_tier1_features.py`, `test_tier3_combinations.py`, and `test_tier4_scenarios.py`.
3. **Cryptographic Integrity**: 100% of emitted findings include valid evidence pointers, SHA-256 hashes, and valid confidence classifications.
4. **Pytest Verification**: 100% test pass rate with Python 3.13 on `test_proposed_engine.py`.
