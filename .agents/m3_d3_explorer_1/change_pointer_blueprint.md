# Production Blueprint: Change Pointer Coverage Auditor Engine (Feature 26)

**Engine Identifier**: `CHANGE_POINTER_COVERAGE_AUDITOR`  
**Target Module**: `services/analysis-python/src/engines/change_pointer.py`  
**Operational Domain**: Integration / ALE & IDoc Master Data Synchronization  
**SAP Transactions Audited**: `BD61`, `BD50`, `BD52`, `SE11`/`DD04L`, `BD53`, `BDCP2`  
**Governing Standards**: Cardinal Axiom 2 (14-Point Engine Anatomy), Part 21/22 Standards, `AGENTS.md`

---

## 1. Executive Summary & Problem Space

In SAP ERP and S/4HANA systems, **Application Link Enabling (ALE)** and **IDoc technology** rely on the **Change Pointer mechanism** to asynchronously capture business data modifications (e.g. Material Master, Customer, Vendor, Bill of Materials) and replicate them to satellite systems, cloud platforms (e.g. SAP Ariba, Salesforce, Kafka, S/4HANA Cloud), and data lakes.

A failure in the change pointer chain results in **silent data synchronization drops**—transactions update master data in SAP, but changes are never replicated to consumer systems. Detecting these issues manually requires cross-checking multiple obscure configuration tables and ABAP dictionary flags:
1. **Global Deactivation**: `BD61` global switch disabled (`TBDA1-AKTIV != 'X'`). If disabled, the entire SAP change pointer engine is shut down globally across the client.
2. **Message Type Deactivation**: `BD50` message type switch disabled (`TBDA2-AKTIV != 'X'`).
3. **Missing Field Linkage**: `BD52` (`TBD62`) missing table/field mappings for change document objects (e.g. `MATERIAL` -> `MARA-GROES`).
4. **Missing Change Document Flag in Data Element**: In ABAP Dictionary (`DD04L`), data element `CHGFLAG != 'X'`. When this flag is missing, SAP update function modules (e.g. `MATERIAL_WRITE_DOCUMENT`) omit the field from `CDPOS` change records, meaning `BDCP2` pointers can never be generated regardless of `BD52` configuration!
5. **Reduced Message Type Suppression**: `BD53` filters out fields configured in `BD52`.
6. **Custom Field Omission**: In-app or classic custom fields (`YY1_`, `ZZ_`) added to tables but omitted from `BD52`.
7. **Runtime Pointer Stagnation / Silent Drops**: Change pointers generated in `BDCP2` remain unprocessed (`PROCESS == ' '`), indicating failing or unscheduled `RBDMIDOC` batch jobs.

The **Change Pointer Coverage Auditor Engine** provides a 100% deterministic, cryptographic audit of this entire multi-tier stack.

---

## 2. Cardinal Axiom 2: 14-Point Engine Anatomy

| Point | Specification Requirement | Engine Implementation Strategy |
|---|---|---|
| **1. Metadata** | Canonical engine ID, human-readable name, domain, target releases, supported formats | `EngineType.CHANGE_POINTER_COVERAGE_AUDITOR`, Name: "Change Pointer Coverage Auditor", version `2.0.0`, formats: `JSON`, `CSV`, `TXT`. |
| **2. Input Schema** | Strict runtime schema validation (Pydantic v2) | Strict Pydantic models: `ChangePointerInputPayload`, `BD52FieldEntry`, `BD50MsgTypeEntry`, `DD04LEntry`, `BDCP2SampleEntry`, `BD53FieldEntry`. |
| **3. Deterministic Parser** | Hardened parsing rejecting malformed inputs, zip bombs, XXE | Multi-mode parser handling unified JSON, tabular CSV, and multi-artifact files with strict bounds and line tracking. |
| **4. Pure Rule Evaluation** | Pure function evaluations, zero probabilistic drift, byte-for-byte identical output | Deterministic set and table comparisons sorted lexicographically; no system clocks or network calls in evaluation. |
| **5. Standard Taxonomy** | Unique finding codes | `CP_GLOBAL_DEACTIVATED`, `CP_MSG_TYPE_DEACTIVATED`, `CP_FIELD_NOT_CONFIGURED_BD52`, `CP_FIELD_DD04L_CHGFLAG_MISSING`, `CP_CUSTOM_FIELD_OMITTED_BD52`, `CP_FIELD_FILTERED_BD53`, `CP_RUNTIME_POINTER_SILENT_DROP`, `CP_RUNTIME_UNPROCESSED_BACKLOG`. |
| **6. Cryptographic Evidence** | Verifiable line/col coordinate evidence with SHA-256 hashes | `EvidenceEngine.create_evidence` with 1-indexed line and column coordinates, exact configuration snippet, and artifact SHA-256 hash. |
| **7. Epistemic Confidence** | Strict classification: `VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN` | Direct metadata and config findings classified as `VERIFIED` (1.0). Inferred rules classified as `RULE_DERIVED` (0.85). Missing evidence demoted to `UNKNOWN` (0.30). |
| **8. Test Fixtures** | Golden positive, negative, and edge-case fixtures | `cp_valid.json`, `cp_global_disabled.json`, `cp_missing_groes.json`, `cp_missing_dd04l.json`, `cp_custom_field.json`, `cp_runtime_backlog.json`. |
| **9. Automated Test Suite** | 100% pass rate under `pytest` | Comprehensive unit and integration test suite verifying all 7 finding codes, edge cases, and E2E evaluators. |
| **10. Property-Based Testing** | Fuzzing & boundary resistance | Property-like edge testing (empty lists, None values, whitespace, malformed JSON, corrupted CSV rows). |
| **11. Telemetry & Metrics** | Duration, rules evaluated, coverage % | `execution_time_ms`, `rules_evaluated`, `artifacts_scanned`, `coveragePercentage`, `totalExpectedFields`, `coveredFields`, `globalActive`, `messageTypeActive`. |
| **12. Report Serialization** | Standardized JSON export matching API contracts | Pydantic `AnalysisResponse` with `AnalysisMetrics` and `Finding` models. |
| **13. Admin Visibility** | Operational status, rule inventory, and quality metrics | Metrics include coverage percentage, active flags, and breakdown of missing fields. |
| **14. Remediation Guide** | Step-by-step release-specific SAP transaction guides | Concrete instructions referencing `BD61`, `BD50`, `BD52`, `SE11`, `BD53`, and `RBDMIDOC`. |

---

## 3. Data Model & Input Formats

### 3.1 Supported Input Modes
The engine supports three ingestion modes:
1. **Unified JSON Object** (E2E Test & Primary API format):
   ```json
   {
     "bd61_active": true,
     "bd50_msg_types": ["MATMAS"],
     "bd52_fields": [["MARA", "MATKL"], ["MARA", "GROES"]],
     "expected_fields": [["MARA", "MATKL"], ["MARA", "GROES"]],
     "change_document_object": "MATERIAL",
     "dd04l_metadata": {
       "MARA-MATKL": {"change_document_flag": true, "data_element": "MATKL"},
       "MARA-GROES": {"change_document_flag": false, "data_element": "GROES"}
     },
     "bdcp2_samples": [
       {"mestype": "MATMAS", "tabname": "MARA", "fldname": "MATKL", "process": "X", "count": 140}
     ],
     "bd53_reduced_fields": ["MARA-BISMT"]
   }
   ```
2. **Structured Table Records** (SAP Database / SE16 Extract format):
   Accepts objects with explicit keys (`{"table": "MARA", "field": "MATKL"}`).
3. **Tabular CSV Extract**:
   CSV with headers `Type,Param1,Param2,Param3,Value` (e.g. `BD61,,,,,X` / `BD52,MATMAS,MATERIAL,MARA,MATKL`).

### 3.2 Canonical Expected Fields Catalog
When `expected_fields` is not explicitly provided in the payload, the engine draws upon standard SAP ALE Master Data profiles:
- **`MATMAS`** (Material Master / Change Document Object `MATERIAL`):
  `MARA-MATKL`, `MARA-MEINS`, `MARA-BRGEW`, `MARA-NTGEW`, `MARA-GEWEI`, `MARA-VOLUM`, `MARA-VOLEH`, `MARA-GROES`, `MARA-BISMT`, `MAKT-MAKTX`, `MARC-WERKS`, `MARC-EKGRP`, `MARC-DISPO`, `MVKE-VKORG`, `MVKE-VTWEG`, `MVKE-PRODH`.
- **`DEBMAS`** (Customer Master / Change Document Object `DEBI`):
  `KNA1-NAME1`, `KNA1-ORT01`, `KNA1-PSTLZ`, `KNA1-LAND1`, `KNA1-STRAS`, `KNA1-TELF1`, `KNB1-BUKRS`, `KNB1-AKONT`, `KNVV-VKORG`, `KNVV-VTWEG`, `KNVV-SPART`, `KNVV-KDGRP`.
- **`CREMAS`** (Vendor Master / Change Document Object `KRED`):
  `LFA1-NAME1`, `LFA1-ORT01`, `LFA1-PSTLZ`, `LFA1-LAND1`, `LFA1-STRAS`, `LFB1-BUKRS`, `LFB1-AKONT`, `LFM1-EKORG`, `LFM1-WAERS`.

---

## 4. Deterministic Rule Pipeline & Finding Specifications

### Rule 1: Global Change Pointer Activation (`BD61`)
- **Evaluation**: Check `bd61_active`. Must be `True` (or string `'X'`).
- **Trigger**: `bd61_active is False` or empty.
- **Rule ID**: `CP_GLOBAL_DEACTIVATED`
- **Severity**: `CRITICAL`
- **Confidence**: `VERIFIED` (1.0)
- **Title**: "Global Change Pointers Deactivated (BD61)"
- **Description**: Global change pointer generation is deactivated in client configuration table TBDA1. No change pointers will be written for any message type across the entire SAP system.
- **Remediation**: Execute transaction `BD61` (or IMG path SAP NetWeaver -> Application Server -> IDoc Interface / ALE -> Modelling and Implementing Business Processes -> Master Data Distribution -> Replication of Modified Data -> Activate Change Pointers - Generally) and check the "Change pointers activated - generally" checkbox.

### Rule 2: Message Type Activation (`BD50`)
- **Evaluation**: For the target message type (e.g. `MATMAS`), check presence in `bd50_msg_types` (or `TBDA2-AKTIV == 'X'`).
- **Trigger**: Message type is not active in BD50.
- **Rule ID**: `CP_MSG_TYPE_DEACTIVATED`
- **Severity**: `CRITICAL`
- **Confidence**: `VERIFIED` (1.0)
- **Title**: "Message Type Inactive for Change Pointers (BD50): {msg_type}"
- **Description**: Message type '{msg_type}' is deactivated in table TBDA2. Changes to related business objects will not trigger change pointers.
- **Remediation**: Execute transaction `BD50`, locate message type '{msg_type}', check the 'Active' checkbox, and save the customizing transport.

### Rule 3: Field-Level Linkage Audit (`BD52`)
- **Evaluation**: For each expected field `(table, field)`, check membership in `bd52_fields`.
- **Trigger**: Expected field not present in `bd52_fields`.
- **Rule ID**: `CP_FIELD_NOT_CONFIGURED_BD52`
- **Severity**: `MAJOR`
- **Confidence**: `VERIFIED` (1.0)
- **Title**: "Trigger Field Missing in BD52: {table}-{field}"
- **Description**: Field '{table}-{field}' is expected to trigger '{msg_type}' change pointers for change document object '{cd_object}', but is missing in BD52 configuration (table TBD62). Modifications to this field will not generate change pointers.
- **Remediation**: Execute transaction `BD52`, enter message type '{msg_type}', and add an entry with Object '{cd_object}', Table '{table}', and Field '{field}'.

### Rule 4: ABAP Dictionary Change Document Flag (`DD04L`)
- **Evaluation**: For each field configured in `bd52_fields`, verify whether `dd04l_metadata` indicates `change_document_flag` is `True` (`CHGFLAG == 'X'`).
- **Trigger**: Field exists in BD52, but data element lacks change document flag.
- **Rule ID**: `CP_FIELD_DD04L_CHGFLAG_MISSING`
- **Severity**: `MAJOR`
- **Confidence**: `VERIFIED` (1.0)
- **Title**: "Data Element Lacks Change Document Flag in DD04L: {table}-{field}"
- **Description**: Field '{table}-{field}' is configured in BD52, but its underlying data element does not have the 'Change document' flag enabled in DD04L. As a result, SAP change document update function modules will skip logging changes to CDPOS, and BDCP2 change pointers will silently fail to generate.
- **Remediation**: Open transaction `SE11` for data element, navigate to the 'Further Characteristics' tab, select the 'Change Document' checkbox, activate the data element, and regenerate the change document object via transaction `SCDO` if applicable.

### Rule 5: Custom Field Omission in BD52 (`YY1_` / `ZZ_`)
- **Evaluation**: Detect custom fields with prefix `YY1_` or `ZZ` present in table definitions or expected fields.
- **Trigger**: Custom field exists on business table but is omitted from BD52.
- **Rule ID**: `CP_CUSTOM_FIELD_OMITTED_BD52`
- **Severity**: `MAJOR`
- **Confidence**: `RULE_DERIVED` (0.85)
- **Title**: "Custom Extension Field Omitted from BD52: {table}-{field}"
- **Description**: Custom field '{table}-{field}' was detected on business table '{table}' but is missing from BD52 change pointer configuration. Custom field modifications will not trigger outbound master data replication.
- **Remediation**: Maintain BD52 for message type '{msg_type}' adding table '{table}' and custom field '{field}'.

### Rule 6: Reduced Message Type Suppression (`BD53`)
- **Evaluation**: Check if the field is marked as filtered/deactivated in reduced message type definitions (`bd53_reduced_fields`).
- **Trigger**: Field configured in BD52 is suppressed in BD53.
- **Rule ID**: `CP_FIELD_FILTERED_BD53`
- **Severity**: `MINOR`
- **Confidence**: `VERIFIED` (1.0)
- **Title**: "Field Suppressed by Reduced Message Type (BD53): {table}-{field}"
- **Description**: Field '{table}-{field}' is configured in BD52 to trigger change pointers, but is filtered out in the reduced message type definition. Change pointers will be created but the field value will not be transmitted in the resulting IDoc.
- **Remediation**: Review transaction `BD53` for the reduced message type and enable field '{field}' under segment if synchronization is required.

### Rule 7: Runtime Pointer Stagnation / Silent Drops (`BDCP2`)
- **Evaluation**: Inspect `bdcp2_samples` for unprocessed backlog or zero pointers.
- **Trigger**:
  - `unprocessed_count > 100` -> `CP_RUNTIME_UNPROCESSED_BACKLOG` (`MAJOR`)
  - Expected field active in BD52 but has 0 change pointers while other fields have pointers -> `CP_RUNTIME_POINTER_SILENT_DROP` (`MAJOR`).
- **Remediation**: Verify background job scheduling for report `RBDMIDOC` (transaction `SM36` / `SM37`) for message type '{msg_type}'.

---

## 5. Evidence & Provenance Pipeline

Every finding emits an `Evidence` item constructed via:
```python
EvidenceEngine.create_evidence(
    artifact_path=artifact_path,
    content=raw_text or line_content,
    line_number=line_number,
    column_number=column_number,
    snippet=snippet,
    provenance=ConfidenceClass.VERIFIED,
    source_type=TrustLevel.CUSTOMER_EVIDENCE,
)
```
- Line numbers are 1-indexed, located via token search in `raw_content`.
- Cryptographic SHA-256 hash calculated over the content or source artifact.
- Findings processed through `ConfidenceClassifier.classify(finding)`.

---

## 6. Backward Compatibility & E2E Alignment

The proposed engine is 100% compatible with:
1. `ChangePointerAuditorEvaluator` in `tests/e2e/evaluators.py`.
2. Existing E2E test suite in `tests/e2e/test_tier1_features.py` (`TestFeature16_ChangePointerAuditor`).
3. Existing fixtures `cp_valid.json`, `cp_missing_groes.json`, `cp_global_disabled.json`.
4. Monorepo schemas and response contracts.
