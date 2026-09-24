# ERP Preflight — Software Collection Dependency Guard Blueprint
## Feature 28 Architecture, Data Models, Deterministic Algorithms & Implementation Specification

> **Engine Identifier**: `software_collection_guard`  
> **Engine Type**: `EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD`  
> **Domain**: Release & Transport / Key-User Cloud Extensibility Release Governance  
> **Target SAP Releases**: SAP S/4HANA Cloud Public Edition (`S4HC_2308`, `S4HC_2402`, `S4HC_2408`, `S4HC_2502`), SAP S/4HANA Cloud Private Edition, SAP S/4HANA On-Premise (`S4H_2022`, `S4H_2023`), SAP BTP ABAP Environment  
> **Governing Standards**: `AGENTS.md` (Cardinal Axioms 1 & 2), `engine-authoring.md`, `sap-evidence.md`, `secure-file-parser.md`

---

## 1. Executive Summary & Operational Scope

In SAP S/4HANA Cloud, the **Adaptation Transport Organizer (ATO)** orchestrates the lifecycle and transport of **Key-User Extensibility** objects through **Software Collections**. Unlike classic ABAP CTS transports that bundle raw repository objects with manual transport sequencing, Software Collections encapsulate tightly coupled functional units (Custom Fields, Custom CDS Views, Custom Logic / Cloud BAdIs, Form Templates, and Fiori App Variants).

Exporting and importing software collections between Cloud development, test, and production tenants introduces high-severity failure modes:
1. **Circular Cross-Collection Dependencies**: Collection $A$ contains a Custom CDS View referencing a Custom Field in Collection $B$, while Collection $B$ contains an App Variant referencing a Custom Field in Collection $A$. In SAP S/4HANA Cloud, the import transaction executes sequentially per collection; circular references result in catastrophic deployment deadlocks or partial activation failures.
2. **Missing Prerequisite Collections**: A collection references extensibility items housed in another software collection that has neither been included in the export batch nor previously imported into the target tenant.
3. **Draft-Status Artifact Leakage**: Key-user extensions left in `DRAFT` / `IN_WORK` status are exported prematurely, deploying incomplete, broken, or uncompiled code into target systems.
4. **Dangling & Broken Field References**: App variants or CDS views referencing deleted, deprecated, or unresolved UUIDs/hashes.

The **Software Collection Dependency Guard (`software_collection_guard`)** is a deterministic, preflight validation engine that verifies software collection exports before transmission. It extracts object-level and collection-level dependency graphs, detects cycles with Tarjan's SCC and DFS algorithms, verifies prerequisite availability, flags draft items and broken references, and outputs an optimal, deterministic topological import sequence.

---

## 2. Cardinal Axiom 2: 14-Point Engine Anatomy Compliance

In accordance with `AGENTS.md` Section 1, `software_collection_guard` implements all 14 points of the mandated engine architecture:

| Point | Component | Production Implementation in `software_collection.py` |
|---|---|---|
| **1** | **Metadata** | `engine_type = EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD`, `name = "Software Collection Dependency Guard"`, `version = "1.0.0"`, supported artifacts: `[ArtifactType.JSON, ArtifactType.XML, ArtifactType.ZIP]`. |
| **2** | **Input Schema** | Strict Pydantic v2 schemas: `SoftwareCollectionItemSchema`, `SoftwareCollectionSchema`, `SoftwareCollectionManifestSchema`, and raw dependency map normalizers rejecting invalid payloads. |
| **3** | **Deterministic Parsers** | Multi-format parser handling: (1) Simplified dependency map JSON (for E2E harness compatibility), (2) Enterprise ATO Export Manifest JSON, (3) Key-User XML parsed via defused `SafeXmlParser` (`LineNumberTreeBuilder`), and (4) In-memory ZIP archives with bounds validation. |
| **4** | **Deterministic Logic** | Pure, mathematical graph analysis. Cycles detected via deterministic DFS 3-color and Tarjan's algorithms. Import sequencing calculated via Kahn's topological sort with lexicographical tie-breaking. Zero network I/O, zero random seed drift. |
| **5** | **Taxonomy & Finding Codes** | Namespaced `SC_` codes: `SC_CIRCULAR_DEPENDENCY`, `SC_MISSING_PREREQUISITE`, `SC_DRAFT_ITEM_INCLUDED`, `SC_DANGLING_FIELD_REFERENCE`, `SC_SCHEMA_VALIDATION_FAILED`. |
| **6** | **Cryptographic Evidence** | Every finding encapsulates an `Evidence` object with relative artifact path, 1-indexed line/column coordinates, code/attribute snippet, and SHA-256 hash computed via `EvidenceEngine.compute_sha256()`. |
| **7** | **Confidence Classifier** | Enforces epistemic confidence classes: `VERIFIED` (1.0) for explicit manifest declarations, `RULE_DERIVED` (0.85) for standard naming conventions, `UNKNOWN` (0.30) for dangling UUIDs or missing evidence. |
| **8** | **Test Fixtures** | Golden positive (`sc_valid_sequence.json`, `sc_linear_manifest.xml`), negative (`sc_circular.json`, `sc_missing_prereq.json`, `sc_draft_item.json`, `sc_dangling_field.json`), and edge-case fixtures (empty, single collection, independent nodes). |
| **9** | **Automated Test Suite** | 100% automated pass rate under `pytest` with Python 3.13, verifying all rule conditions, line extractions, and edge cases. |
| **10** | **Property-Based Testing** | Automated cycle detection and topological ordering property tests verifying invariant preservation across arbitrary Directed Acyclic Graphs (DAGs) and cyclic graphs. |
| **11** | **Telemetry & Metrics** | Tracks execution time (`execution_time_ms`), rules evaluated (`rules_evaluated`), artifacts scanned, total collections, total items, circular dependency count, and recommended import sequence. |
| **12** | **Report Serialization** | Serializes findings into standardized Pydantic `Finding` models fully wire-compatible with NestJS core API and database report exports. |
| **13** | **Admin Trust Center** | Exposes engine capabilities, operational status, rule inventory (9 rules), and quality metrics. |
| **14** | **Remediation Runbook** | Provides release-specific, actionable SAP remediation steps (e.g. using SAP Fiori apps "Export Software Collections" [F1433] and "Import Software Collections" [F1434]). |

---

## 3. Data Models & Input Formats

### 3.1 Key-User Extensibility Object Types
```python
class KeyUserItemType(str, Enum):
    CUSTOM_FIELD = "CUSTOM_FIELD"           # YY1_/ZZ1_ Business Context Field
    CDS_VIEW = "CDS_VIEW"                   # Custom CDS View / Analytical Query
    CUSTOM_LOGIC = "CUSTOM_LOGIC"           # Cloud BAdI implementation
    FORM_TEMPLATE = "FORM_TEMPLATE"         # Custom Adobe Print / Email Template
    APP_VARIANT = "APP_VARIANT"             # Fiori UI Adaptation App Variant
    CUSTOM_BUSINESS_OBJECT = "CUSTOM_BUSINESS_OBJECT" # Custom Business Object (CBO)
    CUSTOM_CODE_LIST = "CUSTOM_CODE_LIST"   # Reusable code list
    COMMUNICATION_SCENARIO = "COMMUNICATION_SCENARIO" # Custom communication scenario
    UNKNOWN = "UNKNOWN"
```

### 3.2 Key-User Item Lifecycle Statuses
```python
class ItemLifecycleStatus(str, Enum):
    PUBLISHED = "PUBLISHED"   # Active, compiled, released for export
    EXPORTED = "EXPORTED"     # Packaged in exported collection
    ACTIVE = "ACTIVE"         # Equivalent to published
    DRAFT = "DRAFT"           # In work; uncommitted changes (VIOLATION)
    IN_WORK = "IN_WORK"       # Draft synonym (VIOLATION)
    DELETED = "DELETED"       # Marked for deletion / obsolete (VIOLATION if referenced)
    OBSOLETE = "OBSOLETE"     # Deprecated / deleted
```

### 3.3 Input Ingestion Schema

The engine supports three input paradigms:

#### A. Simplified Dependency Map (E2E Evaluator Wire Format)
```json
{
  "collections": ["SC_FINANCE", "SC_SALES"],
  "dependencies": {
    "SC_FINANCE": ["SC_SALES"],
    "SC_SALES": ["SC_FINANCE"]
  }
}
```

#### B. Enterprise ATO Export Manifest JSON
```json
{
  "export_id": "EXP_2026_09_001",
  "source_system": "S4H_DEV_100",
  "target_release": "S4HC_2408",
  "target_system_collections": ["SC_FOUNDATION"],
  "target_system_items": ["I_JOURNALENTRY", "YY1_BASE_CUSTOMER_ID"],
  "collections": [
    {
      "collection_id": "SC_FINANCE",
      "name": "Finance Key User Extensions",
      "version": "1.0",
      "items": [
        {
          "item_id": "YY1_FIN_FIELD",
          "item_type": "CUSTOM_FIELD",
          "status": "PUBLISHED",
          "dependencies": []
        },
        {
          "item_id": "YY1_CDS_JOURNAL",
          "item_type": "CDS_VIEW",
          "status": "PUBLISHED",
          "dependencies": ["YY1_FIN_FIELD", "SC_SALES:YY1_SALES_FIELD"]
        }
      ]
    },
    {
      "collection_id": "SC_SALES",
      "name": "Sales Key User Extensions",
      "version": "1.0",
      "items": [
        {
          "item_id": "YY1_SALES_FIELD",
          "item_type": "CUSTOM_FIELD",
          "status": "DRAFT",
          "dependencies": []
        },
        {
          "item_id": "APP_VAR_SO_CREATE",
          "item_type": "APP_VARIANT",
          "status": "PUBLISHED",
          "dependencies": ["YY1_SALES_FIELD", "SC_FINANCE:YY1_FIN_FIELD", "YY1_MISSING_FIELD"]
        }
      ]
    }
  ]
}
```

#### C. SAP ATO Export XML Format (`manifest.xml`)
```xml
<?xml version="1.0" encoding="utf-8"?>
<software_collections export_id="EXP_2026_09_001" target_release="S4HC_2408">
  <target_system>
    <collection id="SC_FOUNDATION" />
    <item id="I_JOURNALENTRY" />
  </target_system>
  <collection id="SC_FINANCE" name="Finance Key User Extensions" version="1.0">
    <item id="YY1_FIN_FIELD" type="CUSTOM_FIELD" status="PUBLISHED" />
    <item id="YY1_CDS_JOURNAL" type="CDS_VIEW" status="PUBLISHED">
      <dependency id="YY1_FIN_FIELD" />
      <dependency id="YY1_SALES_FIELD" collection="SC_SALES" />
    </item>
  </collection>
  <collection id="SC_SALES" name="Sales Key User Extensions" version="1.0">
    <item id="YY1_SALES_FIELD" type="CUSTOM_FIELD" status="DRAFT" />
    <item id="APP_VAR_SO_CREATE" type="APP_VARIANT" status="PUBLISHED">
      <dependency id="YY1_SALES_FIELD" />
      <dependency id="YY1_FIN_FIELD" collection="SC_FINANCE" />
      <dependency id="YY1_MISSING_FIELD" />
    </item>
  </collection>
</software_collections>
```

#### D. Secure In-Memory ZIP Handling
When a `.zip` archive is uploaded:
- Verified against Zip Bomb exploits (maximum ratio 100:1, maximum total uncompressed size 500 MB).
- Verified against Zip Slip attacks (rejecting entries with `..`, absolute paths `/`, `\`, or null bytes).
- Automatically discovers and processes JSON or XML manifests contained in the archive.

---

## 4. Graph Formulations & Deterministic Algorithms

### 4.1 Dependency Semantics & Directionality
Let $C$ be the set of Software Collections.
If Collection $A$ contains an item that requires an item in Collection $B$, then:
$$A \xrightarrow{\text{depends on}} B$$
This implies that **$B$ is a prerequisite of $A$**. Therefore, in the import sequence:
$$\text{Import}(B) \prec \text{Import}(A)$$

### 4.2 Directed Cycle Detection (Tarjan's SCC & DFS 3-Coloring)
A cycle occurs when a sequence of collections $C_1, C_2, \dots, C_k, C_1$ exists such that:
$$C_1 \to C_2 \to \dots \to C_k \to C_1$$
In this state, no collection in the cycle can be imported without its prerequisites being satisfied.

**Algorithm**:
1. Build directed graph $G = (V, E)$ where $V = C$ and $E = \{(u, v) \mid u \text{ depends on } v\}$.
2. Initialize 3-color states: `WHITE` (0: unvisited), `GRAY` (1: in current recursion stack), `BLACK` (2: fully processed).
3. To guarantee bitwise determinism, visit nodes in alphabetical order: `sorted(V)`.
4. When an edge $(u, v)$ points to a `GRAY` node $v$, a directed cycle is identified. The exact cyclic path is reconstructed:
   $$\text{path}[ \text{index}(v) : ] + [v]$$
5. Canonical finding `SC_CIRCULAR_DEPENDENCY` is emitted with the exact cycle list.

### 4.3 Deterministic Topological Import Sequence (Kahn's Algorithm)
If the graph is an acyclic DAG, we compute the execution order:
1. For every collection $u \in V$, calculate its prerequisite in-degree:
   $$\text{in\_degree}(u) = |\{ v \in V \mid u \text{ depends on } v \}|$$
2. Identify initial roots (collections with 0 prerequisites in the export batch):
   $$Q = \{ u \in V \mid \text{in\_degree}(u) = 0 \}$$
3. Store $Q$ as a min-heap or sorted list to guarantee deterministic tie-breaking (lexicographical sorting).
4. Pop $u$, append to `recommended_sequence`.
5. For each consumer $w$ that depends on $u$, decrement $\text{in\_degree}(w)$. If $\text{in\_degree}(w) == 0$, insert $w$ into $Q$ (maintaining sort order).
6. If the length of `recommended_sequence` equals $|V|$, the optimal import sequence is complete.
7. If $| \text{recommended\_sequence} | < |V|$, unresolved cycles remain; `recommended_sequence` is set to `[]`.

---

## 5. Standardized Finding Taxonomy & Rule Catalog

The engine evaluates 5 core rule families:

### Rule 1: `SC_CIRCULAR_DEPENDENCY`
- **Severity**: `CRITICAL`
- **Confidence**: `VERIFIED` (1.0)
- **Condition**: A directed cycle of software collections is detected ($C_1 \to C_2 \to C_1$ or multi-node).
- **Remediation**: "Circular dependency detected between collections {cycle}. Break the cycle by: (1) Merging mutually dependent items into a single software collection, or (2) Extracting foundational dependencies (e.g. underlying custom fields or CDS views) into a separate prerequisite collection imported first."

### Rule 2: `SC_MISSING_PREREQUISITE`
- **Severity**: `BLOCKER`
- **Confidence**: `VERIFIED` (1.0) or `RULE_DERIVED` (0.85)
- **Condition**: Collection $A$ depends on Collection $B$, but $B$ is neither present in the export manifest nor listed in `target_system_collections`. Or an item in $A$ depends on an object not found in any exported collection or `target_system_items`.
- **Remediation**: "Collection '{src_collection}' requires missing prerequisite '{missing_prereq}'. Add the prerequisite collection to the export package, or verify and import it into the target tenant prior to importing '{src_collection}'."

### Rule 3: `SC_DRAFT_ITEM_INCLUDED`
- **Severity**: `MAJOR`
- **Confidence**: `VERIFIED` (1.0)
- **Condition**: An item within an exported software collection has status `DRAFT` or `IN_WORK`.
- **Remediation**: "Extensibility item '{item_id}' in collection '{collection_id}' is in DRAFT status. Open the SAP Fiori app 'Custom Fields' or 'Custom Logic', verify the syntax, and click 'Publish' before re-exporting the software collection."

### Rule 4: `SC_DANGLING_FIELD_REFERENCE`
- **Severity**: `CRITICAL`
- **Confidence**: `VERIFIED` (1.0) if referencing a deleted item; `UNKNOWN` (0.30) if referencing an unresolved UUID.
- **Condition**: An App Variant, CDS View, or Form Template references a custom field (`YY1_*`, `ZZ1_*`) or object that has status `DELETED`/`OBSOLETE`, or an unresolvable UUID identifier.
- **Remediation**: "Item '{item_id}' references broken or deleted field '{referenced_field}'. Restore or recreate the custom field in the development tenant, or adjust the App Variant / CDS View layout to remove the invalid reference."

### Rule 5: `SC_SCHEMA_VALIDATION_FAILED`
- **Severity**: `BLOCKER`
- **Confidence**: `UNKNOWN` (0.30)
- **Condition**: The uploaded artifact is malformed JSON, unparseable XML, or invalid archive data that fails closed.
- **Remediation**: "Correct the manifest format to comply with SAP Key-User Software Collection export schema."

---

## 6. Epistemic Confidence & Cryptographic Grounding

Each finding includes verifiable evidence:
- **`artifact_path`**: Relative storage or upload filename.
- **`line_number` & `column_number`**: 1-indexed coordinate resolved via `SafeXmlParser` (`sourceline`) or `_locate_line_in_text()`.
- **`snippet`**: Verbatim code or configuration attribute.
- **`sha256`**: Cryptographic digest of the raw artifact buffer.
- **`ConfidenceClassifier.classify(finding)`**:
  - Missing evidence triggers immediate demotion to `UNKNOWN` (0.30).
  - Unresolved UUIDs trigger `UNKNOWN` (0.30).
  - Explicit manifest entries trigger `VERIFIED` (1.0).

---

## 7. Metrics & Output Wire Schema

In compliance with `engines_spec.md` §11.7:
```json
{
  "job_id": "...",
  "engine_type": "SOFTWARE_COLLECTION_DEPENDENCY_GUARD",
  "status": "COMPLETED",
  "findings": [...],
  "metrics": {
    "execution_time_ms": 12,
    "rules_evaluated": 9,
    "artifacts_scanned": 1,
    "additional_metrics": {
      "totalCollections": 2,
      "totalItems": 4,
      "circularDependenciesCount": 1,
      "recommendedSequence": [],
      "total_collections": 2,
      "total_items": 4,
      "circular_dependencies_count": 1,
      "recommended_sequence": [],
      "draft_items_count": 1,
      "missing_prerequisites_count": 0,
      "dangling_references_count": 0,
      "engine": "software_collection_guard"
    }
  }
}
```

---

## 8. Verification Strategy & Acceptance Criteria

1. **Evaluator Compatibility**: `SoftwareCollectionGuardEngine.evaluate(collections, dependencies)` seamlessly matches `tests/e2e/evaluators.py` and passes all existing E2E tests (`test_linear_dependencies_pass`, `test_circular_dependency_detected`, `test_three_node_cycle_detected`, `test_independent_collections_pass`, `test_single_collection_no_deps`).
2. **Multi-Format Parsing**: Tested against JSON simple maps, JSON rich enterprise manifests, XML defused safe parsing, and in-memory ZIP archives.
3. **100% Pass Rate**: Verified under Python 3.13 via `pytest`.
