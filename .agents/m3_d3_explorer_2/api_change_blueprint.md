# Production Blueprint: API Change Guard (Feature 27)

> **Module**: `services/analysis-python/src/engines/api_change.py`  
> **Domain**: Integration & API Lifecycle Governance  
> **Authority**: Binding architectural specification under ERP Preflight Master Standards (`AGENTS.md`, `engine-authoring.md`, `sap-evidence.md`, `secure-file-parser.md`).  
> **Cardinal Invariant**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."***  

---

## 1. Executive Summary & Purpose

In enterprise SAP ecosystems (S/4HANA Cloud, S/4HANA On-Premise, SAP BTP, and ECC 6.0), external integrations rely on OData services (EDMX V2 / V4), REST APIs (OpenAPI 2.0 / 3.0), and SOAP / RFC services. During system upgrades or release transitions (e.g. S/4HANA 2022 to 2023, or Cloud 2402 to 2408), upstream SAP API specifications evolve.

Unnoticed breaking API changes cause severe production outages:
- Middleware workflows (SAP Integration Suite, Boomi, MuleSoft) fail with deserialization or HTTP 400/404 errors.
- Third-party SaaS consumers (Salesforce, Workday, ServiceNow) fail data synchronization jobs.
- BTP extension apps encounter schema mismatches on CDS-exposed OData entity sets.

**API Change Guard** performs deterministic, pure AST and DOM comparison between a **Baseline API specification** and a **Candidate API specification**. It detects all breaking and non-breaking changes down to property attributes, and cross-references breaking changes against the **Project Integration Registry** to identify specifically impacted client applications (`affectedIntegrations`).

---

## 2. 14-Point Engine Anatomy Specification

To satisfy Cardinal Axiom 2, the `ApiChangeEngine` implements the complete 14-point architecture:

| Point | Anatomy Component | Technical Implementation in `ApiChangeEngine` |
|---|---|---|
| **1** | **Metadata** | `engine_type = EngineType.API_CHANGE_GUARD`, name: `"API Change Guard"`, version: `"2.0.0"`, supported formats: `[JSON, YAML, XML, EDMX, WSDL]`. |
| **2** | **Input Schema** | Pydantic v2 domain models (`ApiChangeInputPayload`, `ClientIntegrationConfig`, `ApiChangeOptions`) validating inputs before analysis. Rejects invalid payloads cleanly. |
| **3** | **Deterministic Parsers** | Memory-bounded, hardened parsers: `SafeXmlParser` (`LineNumberTreeBuilder`) for OData EDMX V2/V4, and `OpenApiNormalizer` with token line indexing for OpenAPI 2.0/3.0 (JSON/YAML). |
| **4** | **Deterministic Diffing** | Pure, idempotent diff engine. Zero randomness, zero network I/O, zero clock calls. Bitwise identical output for identical input pairs. |
| **5** | **Standard Finding Taxonomy** | Namespaced codes: `API_BREAKING_*`, `API_NON_BREAKING_*`, `API_DEPRECATION_*`, `API_BASELINE_MISSING`, `API_SYNTAX_ERROR`. |
| **6** | **Cryptographic Evidence** | Every finding attaches an `Evidence` record containing artifact path, 1-indexed `line_number`, `column_number`, excerpt `snippet`, SHA-256 hash, and trust score. |
| **7** | **Confidence Classifier** | Schema diffs are classified as `VERIFIED` (1.0). Consumer impact derivations from registry are `RULE_DERIVED` (0.85). Demotes to `UNKNOWN` (0.30) if evidence missing. |
| **8** | **Curated Test Fixtures** | Positive fixture (compatible changes only), negative fixtures (OpenAPI breaking field removed, OData type change, required param added), edge cases (V2 to V4, empty registry). |
| **9** | **Automated Test Suite** | Comprehensive pytest suite verifying all rule triggers, line coordinates, SHA-256 hashes, and consumer cross-referencing with 100% pass rate. |
| **10** | **Property-Based Hardening** | Fuzz and malformed input resilience: corrupted JSON/XML, extreme payload sizes, circular references fail closed without unhandled exceptions. |
| **11** | **Metrics & Telemetry** | Execution duration, rules evaluated, breaking changes count, non-breaking changes count, affected integrations count, entity sets analyzed, endpoints analyzed. |
| **12** | **Report Serialization** | Structured output compatible with `AnalysisResponse` and JSON audit export for preflight reports. |
| **13** | **Admin Trust Center** | Engine diagnostics, rule catalog exposure, and operational health status accessible to admin dashboard. |
| **14** | **Remediation Runbook** | Release-specific technical remediation instructions and SAP Note references embedded in each finding. |

---

## 3. Supported Schema Standards & Normalized Model

### 3.1 OpenAPI 2.0 (Swagger) vs OpenAPI 3.0 / 3.1
The engine extracts and normalizes both standards into a unified intermediate representation (`NormalizedApiSchema`):
- **Endpoints & Paths**: Normalized URI templates (e.g. `/A_PurchaseOrder('{PurchaseOrder}')`).
- **Operations**: HTTP verbs (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`).
- **Operation Parameters**:
  - Path parameters, Query parameters, Header parameters.
  - Required flag (`required: true/false`).
  - Data type (`type`, `format`, `items`).
- **Request Bodies**:
  - OpenAPI 2.0: `in: "body"` parameter with `schema`.
  - OpenAPI 3.0: `requestBody.content["application/json"].schema`.
  - Required flag.
- **Response Schemas**:
  - Response status codes (`200`, `201`, `204`, `default`).
  - Response payload schemas.
- **Definitions / Components**:
  - Properties, required properties list, data types, formats, max lengths, enums, deprecation markers.

### 3.2 OData EDMX V2 vs OData EDMX V4
OData metadata documents are parsed using defused XML with exact line preservation:
- **Namespaces**: Schema namespaces (e.g. `API_PURCHASEORDER_PROCESS_SRV`).
- **Entity Sets**: Exposed collection endpoints (e.g. `A_PurchaseOrder`, `PurchaseOrderSet`).
- **Entity Types**:
  - Keys (`PropertyRef Name="..."`).
  - Properties (`Name`, `Type`, `Nullable`, `MaxLength`, `Precision`, `Scale`).
  - Navigation Properties (Relationships and target entities).
- **Enum Types**: Named enums with member values.
- **Function Imports & Action Imports**:
  - V2: `FunctionImport Name="..." HttpMethod="..." ReturnType="..."`.
  - V4: `ActionImport Name="..." Action="..."` and `FunctionImport Name="..." Function="..."`.
- **Annotations**:
  - Deprecation markers: `sap:label="deprecated"`, `@Common.Label`, `Core.ReplicationStatus`.
  - Field mutability: `sap:creatable="false"`, `sap:updatable="false"`.

---

## 4. Deterministic Diffing Rules & Taxonomy

### 4.1 Breaking Changes (`API_BREAKING_*`)

| Rule ID | Severity (Unconsumed) | Severity (Consumed) | Description & Trigger Condition |
|---|---|---|---|
| `API_BREAKING_ENDPOINT_REMOVED` | `CRITICAL` | `BLOCKER` | An API path or endpoint present in Baseline is absent in Candidate. |
| `API_BREAKING_ENTITYSET_REMOVED` | `CRITICAL` | `BLOCKER` | An OData EntitySet present in Baseline is absent in Candidate. |
| `API_BREAKING_OPERATION_REMOVED` | `CRITICAL` | `BLOCKER` | An HTTP method (e.g. `DELETE`) or OData Function/Action Import is removed from an existing endpoint. |
| `API_BREAKING_FIELD_REMOVED` | `MAJOR` | `CRITICAL` | A property/field was removed from an EntityType, request body, or response schema. |
| `API_BREAKING_REQUIRED_PARAM_ADDED` | `MAJOR` | `CRITICAL` | A new parameter with `required: true` was added to an existing endpoint operation. |
| `API_BREAKING_REQUIRED_PROPERTY_ADDED` | `MAJOR` | `CRITICAL` | A property was made required (`required: true` in schema or `Nullable="false"` in OData) that was previously optional, or a new required property was added to a request entity. |
| `API_BREAKING_TYPE_CHANGED` | `MAJOR` | `CRITICAL` | A property's primitive data type was changed incompatibly (e.g. `string` $\to$ `integer`, `boolean` $\to$ `string`, or narrowing e.g. `int64` $\to$ `int32`). |
| `API_BREAKING_MAX_LENGTH_DECREASED` | `MAJOR` | `CRITICAL` | A string or binary property's `maxLength` was reduced (e.g. 50 $\to$ 20). |
| `API_BREAKING_ENUM_RESTRICTED` | `MAJOR` | `CRITICAL` | One or more previously allowed enum members were removed from an enum definition. |

### 4.2 Non-Breaking Changes (`API_NON_BREAKING_*`)

| Rule ID | Severity | Description & Trigger Condition |
|---|---|---|
| `API_NON_BREAKING_ENDPOINT_ADDED` | `INFO` | A new endpoint path or EntitySet was added in Candidate. |
| `API_NON_BREAKING_OPERATION_ADDED` | `INFO` | A new HTTP method or Action/Function Import was added to an existing endpoint. |
| `API_NON_BREAKING_OPTIONAL_PROPERTY_ADDED` | `INFO` | An optional property (`required: false` or `Nullable="true"`) was added to an entity or response schema. |
| `API_NON_BREAKING_ENUM_EXPANDED` | `INFO` | New allowed values were added to an enum. |
| `API_NON_BREAKING_MAX_LENGTH_INCREASED` | `INFO` | A property's `maxLength` was increased (e.g. 20 $\to$ 50). |

### 4.3 Deprecation & Diagnostic Findings

| Rule ID | Severity | Description & Trigger Condition |
|---|---|---|
| `API_DEPRECATION_WARNING` | `MINOR` / `INFO` | An endpoint, operation, or property has been marked deprecated in Candidate (`deprecated: true` or SAP annotation). Elevated to `MINOR` if consumed by registered integrations. |
| `API_BASELINE_MISSING` | `BLOCKER` | Analysis requested diffing without a baseline specification. |
| `API_SPEC_SYNTAX_ERROR` | `BLOCKER` | Input artifact contains malformed JSON, YAML, or XML. |

---

## 5. Consumer Impact Cross-Referencing

The engine cross-references all breaking changes against the **Project Integration Registry**.

### Registry Schema
```json
{
  "integrations": [
    {
      "integration_id": "SALESFORCE_INTEGRATION_01",
      "name": "Salesforce S/4HANA Order Sync",
      "system_type": "SALESFORCE_CRM",
      "consumed_endpoints": ["/A_PurchaseOrder", "/A_PurchaseOrderItem"],
      "consumed_entity_sets": ["A_PurchaseOrder", "PurchaseOrderSet"],
      "consumed_fields": {
        "A_PurchaseOrder": ["PurchaseOrder", "Supplier", "TaxJurisdictionCode"],
        "PurchaseOrder": ["TaxJurisdictionCode", "GrossAmount"]
      },
      "consumed_operations": {
        "/A_PurchaseOrder": ["GET", "POST"]
      }
    }
  ]
}
```

### Evaluation Algorithm
1. For each detected breaking change:
   - Identify target object: `(endpoint, operation, entity_name, property_name)`.
   - Iterate over registered client integrations.
   - Check if integration consumes:
     - The removed endpoint or entity set $\implies$ MATCH.
     - The removed operation on the endpoint $\implies$ MATCH.
     - The removed or modified property on the entity $\implies$ MATCH.
2. If matched:
   - Append `integration_id` to finding's `technical_details["affectedIntegrations"]`.
   - Append `integration_id` to finding's `affected_objects`.
   - Elevate finding severity (`CRITICAL` or `BLOCKER`).
   - Track unique affected integrations in `metrics.additional_metrics["affectedIntegrations"]`.

---

## 6. Input Payload Flexibility

The engine accepts payloads in 3 standard enterprise formats:

1. **Direct Bundle Payload (`request.raw_content` or `request.configuration`)**:
   ```json
   {
     "baseline": "{ ...openapi or edmx... }",
     "candidate": "{ ...openapi or edmx... }",
     "integrations": [ ... ]
   }
   ```
2. **Multi-Artifact Analysis (`request.artifacts`)**:
   - `artifacts[0]`: Baseline artifact (e.g. `baseline_spec.json`, `baseline.edmx`).
   - `artifacts[1]`: Candidate artifact (e.g. `candidate_spec.json`, `candidate.edmx`).
   - Optional `artifacts[2]`: `integrations.json`.
3. **Configuration References**:
   - Baseline and candidate supplied via S3 keys or raw configuration strings.

---

## 7. Evidence Engine & Confidence Protocol

1. **Exact Coordinate Extraction**:
   - For XML/EDMX: `SafeXmlParser` provides `elem.sourceline` and `elem.sourcecolumn`.
   - For JSON/YAML: `_locate_token_line()` performs line-index lookups for property keys, endpoints, and operations.
2. **Cryptographic Integrity**:
   - Snippet excerpt created with $\pm 2$ lines context preview.
   - SHA-256 calculated over the exact snippet or artifact content.
3. **Epistemic Classification**:
   - Pure AST diff findings: `ConfidenceClass.VERIFIED` (score: 1.0).
   - Findings enriched with integration registry impacts: `ConfidenceClass.RULE_DERIVED` (score: 0.85).
   - Findings where external consumer usage is unregistered: flagged with UNKNOWN external consumer note.
   - Strict adherence to `ConfidenceClassifier`: missing evidence unconditionally demotes to `UNKNOWN` (0.30).

---

## 8. Verification Strategy

1. **Unit Testing**:
   - OpenAPI 2.0 breaking field removal, required parameter addition, type mutation.
   - OpenAPI 3.0 operation removal, enum restriction, non-breaking additions.
   - OData EDMX V2 property removal, entity set removal, max length decrease.
   - OData EDMX V4 type change, deprecation annotation, enum member expansion.
   - Integration registry matching with severity elevation.
2. **Edge Cases**:
   - Malformed XML / XXE defense (handled by `SafeXmlParser`).
   - Invalid JSON / YAML syntax error handling.
   - Missing baseline specification handling.
   - Identical baseline and candidate producing 0 breaking findings.
3. **Deterministic Output**:
   - Two runs on identical inputs yield bitwise identical findings.
