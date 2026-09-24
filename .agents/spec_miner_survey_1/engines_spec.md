# ERP Preflight — Exhaustive Engine & Shared Platform Services Specification

Authoritative Source: `H:/erppreflight/ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md`  
Target System: ERP Preflight Multi-Tenant SaaS Platform  
Classification: Technical Specification & Engine Architecture Contract

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Output & Extensibility | OPD Guard (Output Determination Doctor) | Deterministic evaluation of BRFplus/OPD output parameter decision tables to explain why an expected output is or is not determined. | CSV/XLSX/JSON BRFplus decision tables, business document scenario payload | Matched rules, first failed step, rule trace, generated regression matrix | Return `OPD_STEP_FAILED` or `OPD_NO_RULE_MATCH`; flag invalid CSV | Part 06 §6.1, Part 12 §12.2 |
| 2 | Output & Extensibility | FormDoctor (OutputPath) | Tracing business fields from data source through XML/XSD payload to Adobe form template (XDP) bindings to identify missing or misbound fields. | Form XML payload, XSD schema, XDP template, CDS data source metadata | Data path visualization, exact breakpoint, action checklist, contract tests | Returns `FORM_FIELD_MISSING_IN_XML` or `FORM_BINDING_PATH_MISMATCH`; safely reject XXE | Part 06 §6.2, Part 12 §12.2 |
| 3 | Output & Extensibility | Custom Field Flow Doctor | Verification of end-to-end custom field propagation across standard business document chains (e.g. PO Item -> Supplier Invoice -> Journal Entry). | Custom field metadata (YY1_), source/target business contexts, extension scenario catalog | Hop status (SUPPORTED, PARTIAL, CUSTOM_LOGIC, BLOCKED, UNKNOWN), required BAdIs | Returns `FIELD_PROPAGATION_BLOCKED` or `FIELD_TYPE_MISMATCH` | Part 06 §6.3, Part 01 §1.4 |
| 4 | Output & Extensibility | Extension Impact Guard | Blast radius and dependency traversal before altering or deleting SAP custom extensions (fields, CDS views, BAdIs, app variants). | Extension repository export (abapGit/JSON), CDS/API/Form manifests | Direct and transitive consumers, blast radius score, safe-to-delete verdict, test suite | Rejects deletion if active consumers exist (`EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS`) | Part 06 §6.4, Part 08 §8.5 |
| 5 | Migration & Clean Core | SPRO2Cloud | Mapping legacy ECC/S/4HANA IMG (SPRO) configuration activities to S/4HANA Cloud Public Edition SSCUI / CBC activities and Scope Items. | SPRO path / IMG activity ID, IMG inventory CSV/XLSX, target release, country, module | Status (EXACT, PARTIAL, SCOPE_DEPENDENT, PROCESS_REDESIGN, NOT_AVAILABLE), SSCUI ID, Scope Item | Returns `SPRO_NOT_AVAILABLE_IN_CLOUD` or `NEEDS_REVIEW` for uncataloged nodes | Part 07 §7.1, Part 12 §12.2 |
| 6 | Migration & Clean Core | ECC2Cloud Navigator | Broad legacy landscape assessment covering T-Codes, IMG, ABAP custom objects, BAPIs, IDocs, and interfaces for cloud modernization. | ST03N usage log, TADIR inventory, IDoc types, BAPI/RFC list, business requirements | Modernization status, successor Fiori apps/APIs, prioritized blocker count by module | Flags unmapped custom code as `PROCESS_REDESIGN` or `NEEDS_REVIEW` | Part 07 §7.2, Part 15 §15.11 |
| 7 | Migration & Clean Core | SAP Gap Radar | 12-tier clean core resolution pipeline evaluating whether and how a business requirement can be met in target SAP cloud releases. | Natural language or structured requirement text, target release, project context | Resolution tier, verdict (SUPPORTED_STANDARD, WORKAROUND, BLOCKED, etc.), evidence, release watch | Returns `UNKNOWN` with required missing artifact details rather than hallucinating | Part 07 §7.3, Part 16 §16.37 |
| 8 | Migration & Clean Core | Clean Core Object Guard | Static AST and dependency analysis of ABAP code against SAP Clean Core guidelines, C1 release contracts, and Cloudification repositories. | ABAP code (.abap), abapGit repo ZIP, ATC results, Cloudification & ROSA datasets | Compliance percentage, unreleased dependencies, obsolete syntax, successor APIs | AST syntax errors quarantined; dynamic calls flagged as uncertain | Part 07 §7.4, Part 11 §11.1-11.3 |
| 9 | Integration | Change Pointer Coverage Auditor | Auditing ALE/IDoc change pointer configuration and runtime generation for expected business field changes. | BD61/BD50/BD52 exports, change document object metadata, BDCP2 runtime samples | Coverage matrix (VERIFIED, AT_RISK, NOT_COVERED), missing trigger fields, regression tests | Flags `CP_GLOBAL_DEACTIVATED` if BD61 is inactive despite active message type | Part 08 §8.1, Part 12 §12.2 |
| 10 | Integration | API Change Guard | Contract diffing and breaking change detection across OpenAPI 2.0/3.0 and OData EDMX metadata against registered integrations. | Baseline API spec, candidate API spec, project integration registry | Breaking vs non-breaking changes, affected integrations count, migration readiness % | Rejects invalid schemas; outputs `API_BREAKING_FIELD_REMOVED` on breaking changes | Part 08 §8.2, Part 11 §11.7-11.8 |
| 11 | Release & Transport | Software Collection Dependency Guard | Preflighting key-user extensibility software collections before export/import to detect missing dependencies, circularities, and order. | Software Collection export manifests / JSON metadata, extensibility item definitions | Graph validation, missing dependencies, circular dependency errors, recommended import order | Returns `SC_CIRCULAR_DEPENDENCY` or `SC_MISSING_DEPENDENCY`; blocks release gate | Part 08 §8.3, Part 16 §16.1 |
| 12 | Release & Transport | Transport Dependency Analyzer | Cross-transport conflict and dependency analysis for classic ABAP Workbench and Customizing Transport Requests (TRs). | E070/E071/E071K transport headers and object lists, syntax call trees | Object collisions, prerequisite dependencies, overtaking risk, recommended release sequence | Returns `TR_OBJECT_COLLISION` when same object is modified across concurrent TRs | Part 08 §8.4, Part 11 §11.6 |
| 13 | Operations | Safe Decommission Preflight | Impact assessment before locking or deleting users, technical users, RFC destinations, or service accounts. | USR02, TBTCO/TBTCP (jobs), RFCDES (RFCs), SWWWIHEAD (workflows), SM20/ST03N (audit logs) | Risk score, active dependencies list, last observed usage, reassignment checklist | Returns `DECOM_SCHEDULED_JOB_DEPENDENCY` if active batch jobs are owned by user | Part 09 §9.1, Part 14 §14.4 |
| 14 | Operations | Fiori 403 Root-Cause Doctor | Deterministic decision tree diagnosis of HTTP 403 / unauthorized errors across Fiori Launchpad, Gateway, ICF, UCON, and Cloud Connector. | HTTP headers/body, /IWFND/ERROR_LOG export, SU53 trace, SICF service status, UCON state | Root-cause category, failed auth object/field, inactive ICF path, remediation steps | Returns `FIORI_ICF_INACTIVE` or `FIORI_AUTH_OBJECT_MISSING`; flags missing SU53 data | Part 09 §9.2, Part 15 §15.20 |
| 15 | Operations | Workflow Stuck Explainer | Diagnostic analysis of stuck, failed, or overdue SAP Business Workflows and Flexible Workflows. | SWWWIHEAD, SWWLOGHIST, agent resolution trace, SWETYPV event linkages, container dumps | Stuck work item ID, error reason (no agent, dump, unhandled event), restart recommendation | Flags `WF_STUCK_NO_AGENT` or `WF_BACKGROUND_TASK_FAILED` with dump trace | Part 09 §9.3, Part 15 §15.6 |
| 16 | Operations | IAM Cost Optimizer | Business role and catalog composition modeling to enforce least-privilege access and minimize licensing tier costs. | AGR_1251, AGR_AGRS, user assignments (AGR_USERS), price category catalog, ST03N usage | Redundant catalogs, license tier escalation driver app, alternative role composition | Flags `IAM_REDUNDANT_CATALOG_DETECTED` and warns of price tier inflation | Part 09 §9.4, Part 14 §14.47 |
| 17 | Operations | Account Determination Preflight | Combinatorial matrix audit of automatic account determination (VKOA, OBYC, FBKP) to catch missing GL accounts before transactions execute. | T030, T030K, OBYC/VKOA exports, Chart of Accounts (SKA1/SKB1), Valuation classes, Movement types | Uncovered combinations, missing/blocked GL accounts, conflicting rules, coverage % | Returns `ACCT_DET_MISSING_ACCOUNT` or `ACCT_DET_ACCOUNT_BLOCKED_POSTING` | Part 09 §9.5, Part 13 §13.1 |
| 18 | Operations | System Refresh Delta Guard | Comparison of system-specific configuration before and after system refresh to prevent production target leakage in test systems. | Pre-refresh baseline export, post-refresh config export, isolation rules | Hazardous delta list (RFCs pointing to prod, active SMTP, unadjusted logical systems) | Returns `REFRESH_RFC_TARGETS_PRODUCTION` or `REFRESH_SCOT_OUTBOUND_ACTIVE` | Part 09 §9.6, Part 14 §14.10 |
| 19 | Warehouse Automation | MFS BlackBox | Telegram sequence reconstruction and state-machine verification for SAP EWM Material Flow Systems to identify the first causal divergence. | MFS telegram log (CSV/XLSX/TXT), telegram specification model, communication point route topology | First causal divergence event, root cause telegram, timeline of cascading failures, simulation fixture | Detects `MFS_FIRST_CAUSAL_DIVERGENCE`, `MFS_MISSING_ACK_TIMEOUT`, `MFS_IMPOSSIBLE_JUMP` | Part 09 §9.7-9.8, Part 11 §11.12 |
| 20 | Shared Platform | Evidence Engine | Attaching cryptographic, release-aligned provenance to all technical verdicts with trust level ranking and conflict detection. | Finding records, SAP metadata, official documentation excerpts, parser AST proofs | Provenance records, trust score (0.0-1.0), release alignment status, SHA-256 excerpt hashes | Detects `EVIDENCE_RELEASE_MISALIGNED` or `EVIDENCE_CONFLICT_DETECTED` | Part 05 §5.2, Part 04 §4.7 |
| 21 | Shared Platform | Confidence Classifier | Strict reliability hierarchy enforcement categorizing findings into VERIFIED, RULE_DERIVED, INFERRED, UNKNOWN. | Finding candidate, generation method metadata, underlying evidence items | Final confidence class, explanation boundary badge | Strict demotion: LLM-generated facts can never exceed `INFERRED`; missing evidence -> `UNKNOWN` | Part 00 §0.4, Part 16 §16.37 |
| 22 | Shared Platform | AI Problem Router | Intent classification mapping natural language problem statements and uploaded artifacts to recommended preflight engines. | Natural language problem text, uploaded artifact metadata, project context | Recommended engines list, confidence, rationale, missing required artifacts | Enforces non-fabrication rule: Router never decides business findings, only suggests engines | Part 05 §5.1, Part 01 §1.4 |
| 23 | Shared Platform | Audit Trail | Tamper-evident, immutable audit event ledger with SHA-256 hash chaining, user/agent attribution, and SIEM export capabilities. | Platform events, API requests, analysis triggers, finding suppressions, admin actions | Immutable audit records, cryptographic hash chain, compliance export logs | Append-only enforcement; tampering detected if hash chain fails verification | Part 04 §4.2, Part 10 §10.15, Part 20 §20.28 |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | OPD Guard | BRFplus decision table row contains empty string or blank cell in conditional column. | Evaluator interprets blank as Wildcard (`*`) matching all values, unless configured as explicit empty string condition in table metadata. |
| 2 | OPD Guard | Catch-all wildcard rule placed at Row 2, while specific business rule placed at Row 5. | Engine identifies Row 5 as `OPD_UNREACHABLE_RULE` / shadowed rule because Row 2 evaluates first and consumes all matching criteria. |
| 3 | FormDoctor | Form data XML contains field `<SupplierVAT>DE123456789</SupplierVAT>`, but XDP binds to `$.Header.Supplier.TaxNumber`. | Engine reports `FORM_BINDING_PATH_MISMATCH`, locating data present in XML at alternate path and proposing exact path correction. |
| 4 | FormDoctor | XML contains namespace prefix `n0:` while XDP dataRef expects un-prefixed elements or default namespace. | Namespace resolver normalizes qualified element names and checks whether namespace mapping resolves to identical URI. |
| 5 | Custom Field Flow Doctor | Custom field `YY1_COST_CENTER` exists in Purchase Order Item (type CHAR 10), but target Supplier Invoice Item field is CHAR 8. | Engine flags `FIELD_TYPE_MISMATCH` and blocks automatic propagation to prevent runtime truncation. |
| 6 | Extension Impact Guard | Custom CDS View `ZCDS_ITEM` depends on `ZCDS_HEADER`, which in turn references `ZCDS_ITEM` via an association. | Traversal engine detects directed cycle and raises `EXT_CYCLIC_DEPENDENCY_DETECTED`, blocking single-collection deployment. |
| 7 | SPRO2Cloud | Legacy IMG activity maps to an SSCUI that is only valid when Scope Item `1MD` (Central Master Data) is activated. | Status assigned as `SCOPE_DEPENDENT` with finding detailing missing prerequisite Scope Item `1MD`. |
| 8 | ECC2Cloud Navigator | ST03N profile contains high-frequency execution of custom transaction `ZVA01` containing direct updates to `VBAK`. | Engine flags `ECC_CUSTOM_CODE_HIGH_USAGE_BLOCKER`, recommends decomposing into standard Fiori app `Manage Sales Orders` + RAP Developer Extensibility. |
| 9 | SAP Gap Radar | Requirement: "Trigger webhook to external logistics portal upon Goods Receipt creation". | Resolution pipeline matches Tier 8 (SAP Business Event) via SAP Event Mesh / SAP CloudEvents; verdict: `SUPPORTED_EXTENSION`. |
| 10 | Clean Core Object Guard | ABAP method contains dynamic function call `CALL FUNCTION lv_func_name EXPORTING ...`. | Engine marks finding as `CLEAN_CORE_DYNAMIC_CALL_WARNING` with confidence `RULE_DERIVED` and caveats that static analysis cannot guarantee runtime target. |
| 11 | Change Pointer Auditor | Global change pointer flag BD61 is disabled (' '), while message type `MATMAS` is enabled in BD50 and BD52 has 50 fields. | Engine flags CRITICAL finding `CP_GLOBAL_DEACTIVATED`: entire ALE change pointer distribution is completely dead at the system level. |
| 12 | API Change Guard | Target OpenAPI specification changes property `taxAmount` from optional (`required: []`) to mandatory (`required: ['taxAmount']`). | Engine flags BREAKING change `API_BREAKING_REQUIRED_FIELD_ADDED` because existing client integration payloads omitting this field will fail validation. |
| 13 | Software Collection Guard | Collection A contains Custom CDS View referencing Custom Field in Collection B; Collection B contains Form referencing Custom CDS in Collection A. | Engine detects inter-collection circular dependency and recommends merging items into a unified Software Collection. |
| 14 | Transport Analyzer | Transport Request TR1 contains `TABL ZINVOICE_T` and TR2 contains `PROG ZREPORT` referencing `ZINVOICE_T`. TR2 is queued before TR1. | Engine reports `TR_WRONG_SEQUENCE`, warning that importing TR2 first will cause syntax compilation errors in target system. |
| 15 | Safe Decommission | Target technical user `RFC_PI_USER` has had no interactive logons for 90 days, but is configured as logon user in active RFC destination `RFC_B2B_GW`. | Engine prevents decommission with CRITICAL finding `DECOM_ACTIVE_RFC_DEPENDENCY`, preventing inadvertent interface shutdown. |
| 16 | Fiori 403 Doctor | Fiori app fails with HTTP 403; SU53 trace shows all authorizations pass, but SICF export shows ICF node `/sap/opu/odata/sap/C_SALESORDER_CDS/` inactive. | Engine isolates exact root cause to ICF node inactivity (`FIORI_ICF_INACTIVE`), preventing wasted security role modifications. |
| 17 | Workflow Stuck | Flexible Workflow work item is in status `READY`, but container agent list resolved to empty due to an inactive employee master record. | Engine flags `WF_STUCK_NO_AGENT`, identifies the responsible evaluation rule, and lists candidate users for manual forwarding. |
| 18 | IAM Cost Optimizer | Business role contains 40 display apps (Self-Service tier) and 1 rarely used mass-reversal transaction `FB08` (Advanced tier). | Engine recommends role splitting, demonstrating that separating `FB08` into an emergency role downgrades 45 users to Core/Self-Service licenses. |
| 19 | Account Determination | OBYC rule for transaction key `BSX` valuation class `3000` points to GL Account `140000`, which exists in Chart of Accounts but has `XSPERR='X'` (Posting Block). | Engine flags `ACCT_DET_ACCOUNT_BLOCKED_POSTING`, warning that goods receipt transactions will fail with error `M7 001`. |
| 20 | System Refresh Guard | Refreshed QA system has email routing active in `SCOT` without domain redirection rules, and RFC destination `SAP_Ariba` points to production URL. | Engine flags CRITICAL security hazard `REFRESH_RFC_TARGETS_PRODUCTION` and `REFRESH_SCOT_OUTBOUND_ACTIVE`, stopping QA validation. |
| 21 | MFS BlackBox | Conveyor incident log shows Handling Unit (HU) 998811 reported at Communication Point CP04, but previous telegram reported it at CP01 (skipping CP02 and CP03). | Engine identifies `MFS_IMPOSSIBLE_TOPOLOGY_JUMP` as the first causal divergence, concluding an untracked manual crane removal occurred. |

---

# Detailed Specifications: 19 Preflight Engines

---

## 1. OPD Guard (Output Determination Doctor)

### 1.1 Domain
Output & Extensibility / S/4HANA Output Parameter Determination (BRFplus-based).

### 1.2 Purpose
Preflight and evaluate output parameter determination rules for business documents (Purchase Orders, Billing Documents, Sales Orders, Outbound Deliveries) prior to production execution. OPD Guard verifies why an expected output document (printout, email, EDI, XML) does or does not determine, highlights rule conflicts, detects shadowed/unreachable decision rows, and validates fallback defaults.

### 1.3 Input Artifacts
- **Decision Tables**: CSV or XLSX exports of SAP BRFplus / OPD decision tables covering determination steps:
  1. `Output Type`
  2. `Receiver`
  3. `Channel`
  4. `Printer / Print Queue`
  5. `Email Recipient`
  6. `Email Sender`
  7. `Form Template`
  8. `Output Relevance`
- **Scenario Payload**: JSON document representing business context:
  - Document Type (e.g. `NB`, `F2`)
  - Company Code (e.g. `1000`, `DE01`)
  - Purchasing Org / Sales Org (e.g. `1010`, `DOM1`)
  - Supplier / Customer ID (e.g. `100045`)
  - Transaction Currency, Dispatch Time.

### 1.4 Deterministic Parsing & Evaluation Rules
1. **Multi-Step Execution Pipeline**:
   Evaluate decision steps strictly in SAP determination order:
   `Output Type` $\rightarrow$ `Receiver` $\rightarrow$ `Channel` $\rightarrow$ `Printer/Queue` $\rightarrow$ `Email Recipient/Sender` $\rightarrow$ `Form Template` $\rightarrow$ `Output Relevance`.
2. **Table Condition Matching**:
   For each step, evaluate decision table rows sequentially from Row 1 to Row $N$.
   - **Exact Value**: Match cell value against scenario property.
   - **Wildcard / Blank**: Cell with `*` or empty matches any scenario value.
   - **Range / Set**: Values formatted as `[1000..2000]` or `DE01,DE02` matched via set inclusion.
3. **Conflict & Overlap Detection**:
   Detect rows with identical condition criteria that yield divergent results without a disambiguating priority column.
4. **Shadowed / Unreachable Rule Detection**:
   If Row $i$ has equal or broader conditions than Row $j$ (where $j > i$), flag Row $j$ as unreachable.
5. **Coverage & Missing Default Audit**:
   Verify whether every valid permutation reaches a valid match or terminates in an explicit default rule.
6. **First Failed Step Pinpointing**:
   If determination fails, capture the exact step where matching evaluated to empty and output the required missing condition.

### 1.5 Edge Cases
- Mixed case comparison: Standard SAP organizational keys are uppercase (`DE01`); case-insensitive normalization applied.
- Output Relevance returning False: Channel and Recipient determine successfully, but Relevance step evaluates to False, suppressing output generation.
- Multiple active channels: Decision table configured to output both PRINT and EMAIL simultaneously.

### 1.6 Error Conditions
- Missing prerequisite table: Channel table references an Output Type not defined in the Output Type table.
- Corrupted CSV/XLSX: Missing header row, mismatched column counts, invalid character encoding.

### 1.7 Output Schema
```json
{
  "engine": "opd_guard",
  "status": "completed",
  "findings": [
    {
      "code": "OPD_STEP_FAILED",
      "severity": "HIGH",
      "confidence": "VERIFIED",
      "title": "Email Recipient Determination Failed",
      "message": "Output channel evaluated to EMAIL, but no matching rule was found in Email Recipient table.",
      "technicalDetails": {
        "step": "Email Recipient",
        "scenario": { "companyCode": "1000", "purchasingOrg": "DE01", "supplier": "100045" },
        "missingCondition": "No row for Supplier 100045 in Purchasing Org DE01"
      }
    }
  ],
  "metrics": {
    "totalStepsEvaluated": 8,
    "successfulSteps": 4,
    "firstFailedStep": "Email Recipient",
    "unreachableRulesCount": 1
  }
}
```

### 1.8 Confidence Classification
- `VERIFIED`: Complete decision table set and exact document payload provided.
- `RULE_DERIVED`: Determination evaluated against standard baseline rule templates.
- `UNKNOWN`: Partial decision tables provided (e.g. missing Receiver table).

### 1.9 Fixtures Needed
- `opd_po_valid_email.json`: Full 8-table decision set producing valid EMAIL output.
- `opd_po_missing_recipient.json`: PO scenario failing at Email Recipient determination.
- `opd_shadowed_rule.csv`: Decision table where Row 2 shadows Row 5.

---

## 2. FormDoctor (OutputPath)

### 2.1 Domain
Output & Extensibility / Form Template & Data Binding (Adobe LiveCycle Designer XDP, XSD, XML).

### 2.2 Purpose
Trace business fields end-to-end from the underlying data source through the output XML/XSD payload to Adobe form template (XDP) bindings, isolating exactly where and why a field fails to display or print.

### 2.3 Input Artifacts
- **Form Data XML**: Runtime or test payload generated by SAP print program.
- **XML Schema Definition (XSD)**: Schema governing the form interface.
- **Adobe Form Template (XDP)**: XML Form Architecture (XFA) layout file containing subforms and field bindings.
- **Interface / Custom Field Metadata**: CDS view extension or BAdI metadata.

### 2.4 Deterministic Parsing Rules
1. **XML & XSD Structure Analysis**:
   - Defused XML parser loads payload under strict memory and entity expansion limits (prevention of XXE / billion laughs).
   - Resolve target field XPath in payload DOM.
2. **XFA / XDP Binding Resolution**:
   - Parse XDP XML structure, identifying all `<field>` elements and their `<bind match="dataRef" ref="..."/>` attributes.
   - Resolve relative binding paths against enclosing `<subform dataRef="...">` scopes.
3. **Deterministic Failure Classification**:
   - `FORM_FIELD_MISSING_IN_XML`: Binding path in XDP is syntactically valid, but element is completely absent in runtime XML payload.
   - `FORM_BINDING_PATH_MISMATCH`: Field exists in XML under path $P_1$, but XDP binds to path $P_2$.
   - `FORM_FIELD_HIDDEN_IN_LAYOUT`: Field exists in XML and is bound correctly, but template defines `presence="hidden"` or subform height is zero.
   - `FORM_DATA_SOURCE_EXTENSION_NEEDED`: Desired field exists in standard database tables but is not exposed in the CDS form data source.

### 2.5 Edge Cases
- Dynamic scripting: XFA form contains FormCalc or JavaScript modifying `this.presence` dynamically at runtime.
- Repeating line items: Complex relative bindings inside dynamic table rows (`$record.Item[*]`).
- Multi-namespace payloads: Schema uses `xmlns:n0="http://sap.com/..."` while template omits prefix.

### 2.6 Error Conditions
- Corrupted XDP / malformed XML template.
- External entity declaration in XML payload (flagged as security violation).

### 2.7 Output Schema
```json
{
  "engine": "form_doctor",
  "status": "completed",
  "findings": [
    {
      "code": "FORM_BINDING_PATH_MISMATCH",
      "severity": "HIGH",
      "confidence": "VERIFIED",
      "title": "Mismatched Field Binding Path",
      "message": "Template binds to '$.Header.SupplierTaxNumber', but XML payload provides '$.Header.Supplier.TaxNumber'.",
      "technicalDetails": {
        "xdpLine": 412,
        "currentBinding": "$.Header.SupplierTaxNumber",
        "suggestedBinding": "$.Header.Supplier.TaxNumber"
      }
    }
  ],
  "metrics": {
    "totalBindingsChecked": 142,
    "validBindings": 139,
    "brokenBindings": 3
  }
}
```

### 2.8 Confidence Classification
- `VERIFIED`: Static XML payload and XDP file verified via deterministic XPath/XFA matching.
- `RULE_DERIVED`: Inferred from XSD schema when runtime XML payload is not uploaded.
- `UNKNOWN`: Fields controlled exclusively by dynamic obfuscated FormCalc scripts.

### 2.9 Fixtures Needed
- `form_valid_invoice.xml` + `.xdp`: Fully aligned invoice payload and layout.
- `form_binding_mismatch.xml` + `.xdp`: Invoice with mismatched VAT field path.
- `form_field_hidden.xdp`: Form template with hidden presence on total tax amount.

---

## 3. Custom Field Flow Doctor

### 3.1 Domain
Output & Extensibility / Key-User Extensibility & Business Document Flow.

### 3.2 Purpose
Determine whether a custom field (`YY1_`) can propagate automatically across business document chains (e.g. Purchase Order Item $\rightarrow$ Supplier Invoice Item $\rightarrow$ Journal Entry $\rightarrow$ Output Form), identifying required BAdIs, missing extension scenarios, and target release limitations.

### 3.3 Input Artifacts
- Custom field definition JSON/XML (business context, technical name, data type, length).
- SAP Business Context Catalog (source & target business contexts).
- Business Extension Scenarios definition (e.g., `MM_PO_TO_INVOICE`).
- Target SAP S/4HANA release identifier (e.g., `2608`).

### 3.4 Deterministic Parsing Rules
1. **Context Linkage Graph**:
   Map source business context to target business context using official SAP Key-User extensibility relationships.
2. **Propagation Status Derivation**:
   - `SUPPORTED`: Direct SAP standard business scenario exists and enables automated field copy.
   - `CUSTOM_LOGIC`: Standard business scenario does not exist, but supported SAP BAdI exists to bridge contexts (e.g. `BADI_FINS_ACDOC_EXT_PERSISTENCE`).
   - `BLOCKED`: Contexts cannot be bridged due to architectural separation or Clean Core constraints.
3. **Interface & Form Exposure Audit**:
   Verify whether custom field is enabled for Form Data Source, CDS Views, APIs, and Fiori UI variants.
4. **Data Type & Length Compatibility**:
   Ensure target field has identical data type and length $\ge$ source field.

### 3.5 Edge Cases
- Multi-hop propagation: PO Item $\rightarrow$ Inbound Delivery $\rightarrow$ Material Document $\rightarrow$ Supplier Invoice.
- Custom field defined in target context with shorter length (e.g., CHAR 40 to CHAR 20).
- Standard scenario available in S/4HANA Cloud Public Edition 2608 but unavailable in 2502.

### 3.6 Error Conditions
- Invalid business context identifier.
- Attempting to propagate custom field to an unreleased internal SAP structure.

### 3.7 Output Schema
```json
{
  "engine": "custom_field_flow_doctor",
  "status": "completed",
  "findings": [
    {
      "code": "FIELD_PROPAGATION_REQUIRES_BADI",
      "severity": "MEDIUM",
      "confidence": "VERIFIED",
      "title": "BAdI Required for Journal Entry Propagation",
      "message": "Direct propagation from Supplier Invoice Item to Journal Entry requires custom logic BAdI implementation.",
      "technicalDetails": {
        "sourceContext": "MM_SUPPLIER_INVOICE_ITEM",
        "targetContext": "FI_JOURNAL_ENTRY_ITEM",
        "requiredBadi": "BADI_FINS_ACDOC_EXT_PERSISTENCE"
      }
    }
  ],
  "metrics": {
    "totalHops": 3,
    "supportedStandardHops": 2,
    "customLogicHops": 1,
    "blockedHops": 0
  }
}
```

### 3.8 Confidence Classification
- `VERIFIED`: Documented official Business Extension Scenario or published BAdI interface.
- `RULE_DERIVED`: Derived from context relationship traversal.
- `UNKNOWN`: Custom contexts in private edition without standard metadata.

### 3.9 Fixtures Needed
- `custom_field_po_to_inv.json`: Standard PO to Invoice item flow.
- `custom_field_inv_to_gl.json`: Flow requiring BAdI implementation.
- `custom_field_type_truncation.json`: Field length mismatch fixture.

---

## 4. Extension Impact Guard

### 4.1 Domain
Output & Extensibility / Blast Radius & Dependency Traversal.

### 4.2 Purpose
Calculate the direct and indirect dependency blast radius before modifying or deleting an SAP custom extension (custom field, custom CDS view, custom BAdI, app variant, custom API, form template).

### 4.3 Input Artifacts
- Extension object descriptor (Type: `CUSTOM_FIELD`, `CDS_VIEW`, `BADI`, `FORM_TEMPLATE`, `SOFTWARE_COLLECTION`).
- Project Customer Dependency Graph / abapGit repository export / Key-User collection manifests.

### 4.4 Deterministic Parsing Rules
1. **Graph Traversal & Closure**:
   Traverse all inbound edges (`USED_BY`, `EXTENDS`, `CONSUMED_BY`) starting from target object to build the transitive dependency closure.
2. **Consumer Categorization**:
   Group impacted consumers into:
   - Form Templates
   - CDS Analytical Queries
   - External APIs (OData / SOAP)
   - Fiori App Variants
   - Software Collections / Transport Requests
3. **Action Feasibility Assessment**:
   - `DELETE`: If transitive consumer count $> 0$, deletion is `BLOCKED`.
   - `TYPE/LENGTH_CHANGE`: Identify consumers where narrowing type causes breaking contract changes.
4. **Regression Test Synthesis**:
   Generate test suite requirements covering every impacted consumer.

### 4.5 Edge Cases
- Circular dependencies between custom CDS views.
- Inactive or draft consumers referencing active custom field.
- Indirect consumption via generic OData analytical services.

### 4.6 Error Conditions
- Target object not found in customer dependency graph.
- Corrupted dependency graph manifest.

### 4.7 Output Schema
```json
{
  "engine": "extension_impact_guard",
  "status": "completed",
  "findings": [
    {
      "code": "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "Cannot Delete Custom Field: Active Consumers Exist",
      "message": "Field 'YY1_PROJECT_CODE' is actively consumed by 2 CDS views and 1 Adobe Form.",
      "technicalDetails": {
        "directConsumers": ["YY1_CDS_PROJECT_SUMMARY", "YY1_FORM_PURCHASE_ORDER"],
        "indirectConsumers": ["API_PROJECT_REPORTING_SRV"]
      }
    }
  ],
  "metrics": {
    "directConsumersCount": 2,
    "transitiveConsumersCount": 3,
    "blastRadiusScore": 8.5
  }
}
```

### 4.8 Confidence Classification
- `VERIFIED`: Explicit static references in published metadata or code AST.
- `RULE_DERIVED`: Inferred from naming conventions.
- `UNKNOWN`: Dynamic references where target is resolved at runtime.

### 4.9 Fixtures Needed
- `ext_impact_active_field.json`: Custom field consumed by CDS and Form.
- `ext_impact_isolated_field.json`: Unused custom field safe to delete.
- `ext_impact_circular_views.json`: Mutually referencing CDS views.

---

## 5. SPRO2Cloud

### 5.1 Domain
Migration & Clean Core / Configuration Modernization (ECC IMG to S/4HANA Cloud).

### 5.2 Purpose
Map legacy SAP ECC / S/4HANA On-Premise SPRO IMG activities and underlying configuration tables to S/4HANA Cloud Public Edition configuration concepts (SSCUI / CBC activities and Best Practices Scope Items).

### 5.3 Input Artifacts
- SPRO Activity ID / Path / Table Name (e.g. `SIMG_CFMENUOLSDOVZ0` or `V_T001W`).
- Bulk configuration inventory spreadsheet (CSV / XLSX).
- Target SAP release (e.g. `2608`), Target country code (e.g. `DE`, `US`), Module (`SD`, `MM`, `FI`).

### 5.4 Deterministic Parsing Rules
1. **Direct Activity & Table Mapping**:
   Lookup IMG activity against authoritative SPRO-to-SSCUI mapping table.
2. **Classification Assignment**:
   - `EXACT`: 1:1 mapping to SSCUI / CBC activity.
   - `PARTIAL`: Feature exists in cloud, but specific sub-parameters are restricted.
   - `SCOPE_DEPENDENT`: Feature requires specific SAP Scope Item activation (e.g. `BD9`, `1MD`).
   - `PROCESS_REDESIGN`: Obsolete legacy IMG concept; replaced by Fiori app or cloud-native workflow.
   - `NOT_AVAILABLE`: Feature deliberately excluded from S/4HANA Cloud Public Edition.
   - `NEEDS_REVIEW`: Uncataloged custom Z-activity.
3. **Country & Catalog Enrichment**:
   Attach relevant country restrictions and mandatory SAP Fiori Business Catalogs required to access SSCUI.

### 5.5 Edge Cases
- Custom Z-configuration tables embedded into IMG.
- Country-specific asset depreciation nodes obsolete in universal ledger.
- SPRO activity split into multiple discrete SSCUIs in Cloud.

### 5.6 Error Conditions
- Unrecognized or corrupted SPRO activity identifier.
- Target release does not exist in release catalog.

### 5.7 Output Schema
```json
{
  "engine": "spro2cloud",
  "status": "completed",
  "findings": [
    {
      "code": "SPRO_MAPPING_EXACT",
      "severity": "INFO",
      "confidence": "VERIFIED",
      "title": "Exact Cloud Configuration Found",
      "message": "IMG Activity 'Define Document Types' maps directly to SSCUI 101230.",
      "technicalDetails": {
        "legacyActivity": "SIMG_CFMENUOLSDVOFA",
        "sscuiId": "101230",
        "cbcActivity": "Configure Billing Document Types",
        "scopeItem": "BD9",
        "businessCatalog": "SAP_CA_BC_IC_LND_SD_PC"
      }
    }
  ],
  "metrics": {
    "totalActivities": 45,
    "exactMappings": 32,
    "partialMappings": 8,
    "unsupportedActivities": 5
  }
}
```

### 5.8 Confidence Classification
- `VERIFIED`: Official published SAP SSCUI / Scope Item mapping catalog.
- `RULE_DERIVED`: Derived from underlying database table configuration.
- `UNKNOWN`: Custom or unindexed IMG nodes.

### 5.9 Fixtures Needed
- `spro_sd_billing_types.csv`: Standard SD billing configuration mapping.
- `spro_unsupported_special_ledger.csv`: Classic FI special ledger node with no cloud equivalent.

---

## 6. ECC2Cloud Navigator

### 6.1 Domain
Migration & Clean Core / Legacy Landscape Migration Feasibility.

### 6.2 Purpose
Assess legacy ECC environments across transactions (T-Codes), custom ABAP objects, BAPIs, Function Modules, IDocs, and interfaces to produce a comprehensive migration roadmap to S/4HANA Cloud Public Edition.

### 6.3 Input Artifacts
- ST03N transaction usage statistics (T-Codes, execution counts, response times).
- SAP Readiness Check export / TADIR custom object inventory.
- Interface catalog (IDoc message types, RFC destinations, web services).

### 6.4 Deterministic Parsing Rules
1. **T-Code Successor Resolution**:
   Match legacy T-Codes against SAP Fiori App reference library to identify standard cloud Fiori apps.
2. **Interface Modernization Mapping**:
   - RFC / BAPI $\rightarrow$ Released OData / SOAP APIs (Contract C1).
   - IDocs $\rightarrow$ SAP Graph, Event Mesh CloudEvents, or standard SOAP APIs.
3. **Usage-Weighted Blocker Ranking**:
   Weight migration blockers by ST03N execution volume (high-usage blockers prioritized).
4. **Categorization**:
   Assign status: `DIRECTLY_SUPPORTED`, `SUCCESSOR_AVAILABLE`, `EXTENSION_REQUIRED`, `PROCESS_REDESIGN`, `NO_EQUIVALENT`.

### 6.5 Edge Cases
- Custom transaction `ZVA01` that modifies standard pricing user exits.
- Deprecated BAPI having multiple composable OData services as replacement.
- High-volume transaction with no direct Fiori equivalent (requires composable business workflow).

### 6.6 Error Conditions
- Invalid ST03N format or corrupted CSV headers.
- Unknown ECC release version.

### 6.7 Output Schema
```json
{
  "engine": "ecc2cloud_navigator",
  "status": "completed",
  "findings": [
    {
      "code": "ECC_TCODE_SUCCESSOR_FOUND",
      "severity": "INFO",
      "confidence": "VERIFIED",
      "title": "Fiori Successor Available for ME21N",
      "message": "Transaction ME21N is replaced by Fiori App F0842A (Manage Purchase Orders).",
      "technicalDetails": {
        "tcode": "ME21N",
        "fioriAppId": "F0842A",
        "fioriAppName": "Manage Purchase Orders",
        "st03nUsage": 142050
      }
    }
  ],
  "metrics": {
    "totalObjectsAnalyzed": 1250,
    "cloudReadyPercentage": 74.2,
    "redesignRequiredCount": 85
  }
}
```

### 6.8 Confidence Classification
- `VERIFIED`: Verified match against official SAP Fiori / API catalog.
- `RULE_DERIVED`: Inferred from functional area / module mapping.
- `UNKNOWN`: Uncataloged custom Z-transactions.

### 6.9 Fixtures Needed
- `ecc2cloud_st03n_sample.csv`: Usage log with standard and custom T-codes.
- `ecc2cloud_interface_inventory.json`: List of active IDocs and RFCs.

---

## 7. SAP Gap Radar

### 7.1 Domain
Migration & Clean Core / Cloud Requirement Gap Resolution.

### 7.2 Purpose
Resolve technical and business requirements against the target SAP cloud release using a deterministic 12-tier clean core hierarchy, identifying whether a requirement can be fulfilled by standard features, configuration, extension, or represents a known product gap.

### 7.3 Input Artifacts
- Requirement statement (natural language or structured requirement specification).
- Target SAP product edition (`Public`, `Private`, `BTP`) and release (`2602`, `2608`).
- Activated Scope Items and project context.

### 7.4 Deterministic Resolution Pipeline (12 Tiers)
1. **Tier 1: Standard Functionality** (SAP Best Practices Scope Item)
2. **Tier 2: Standard Configuration** (SSCUI / CBC Activity)
3. **Tier 3: Key-User Extensibility** (Custom Fields, Logic, CDS, UI Variants)
4. **Tier 4: Developer Extensibility** (ABAP Cloud, On-Stack RAP model)
5. **Tier 5: Released CDS Views** (Contract C1)
6. **Tier 6: Released APIs** (OData / SOAP with Contract C1)
7. **Tier 7: Released BAdIs / Extension Points**
8. **Tier 8: Business Events** (SAP Event Mesh / CloudEvents)
9. **Tier 9: Side-by-Side Extensibility** (SAP BTP)
10. **Tier 10: Supported Workaround**
11. **Tier 11: Known Product Gap**
12. **Tier 12: Unknown / Review Required**

### 7.5 Edge Cases
- Requirement requires writing directly to a standard database table (violates Clean Core; classified as `BLOCKED`).
- Requirement unsupported in target release 2508 but scheduled on SAP roadmap for 2608.
- 80% of requirement met by standard, 20% requiring side-by-side BTP app.

### 7.6 Error Conditions
- Empty requirement description.
- Invalid release identifier.

### 7.7 Output Schema
```json
{
  "engine": "gap_radar",
  "status": "completed",
  "findings": [
    {
      "code": "GAP_RADAR_SUPPORTED_EXTENSION",
      "severity": "INFO",
      "confidence": "RULE_DERIVED",
      "title": "Requirement Supported via Developer Extensibility",
      "message": "Custom pricing logic can be implemented via released BAdI BADI_PRICING_COMPLETE in ABAP Cloud.",
      "technicalDetails": {
        "tier": 7,
        "tierName": "Released BAdI / Extension Point",
        "badiName": "BADI_PRICING_COMPLETE",
        "verdict": "SUPPORTED_EXTENSION"
      }
    }
  ],
  "metrics": {
    "resolutionTier": 7,
    "feasibilityScore": 0.95
  }
}
```

### 7.8 Confidence Classification
- `VERIFIED`: Exact match to published SAP feature or released API catalog.
- `RULE_DERIVED`: Matched via standard clean core pattern rules.
- `INFERRED`: Semantic LLM match of requirement text.
- `UNKNOWN`: Insufficient evidence to determine feasibility.

### 7.9 Fixtures Needed
- `gap_radar_event_mesh.json`: Requirement to trigger external webhook on PO creation.
- `gap_radar_direct_db_write.json`: Requirement to update BSEG directly (Blocked).

---

## 8. Clean Core Object Guard

### 8.1 Domain
Migration & Clean Core / ABAP Clean Core & Syntax Governance.

### 8.2 Purpose
Audit custom ABAP source code, objects, and dependencies against SAP Clean Core criteria (ABAP Cloud, C1 release contracts, deprecated statements, direct database table access).

### 8.3 Input Artifacts
- ABAP code files (.abap), abapGit repository export, ATC check results.
- Versioned SAP Cloudification Repository (`SAP/abap-atc-cr-cv-s4hc`) and ROSA dataset (`ClementRingot/ROSA`).

### 8.4 Deterministic Parsing Rules
1. **AST Static Analysis (via abaplint engine)**:
   - Detect direct SELECT / INSERT / UPDATE / DELETE on classic SAP tables (e.g. `MARA`, `VBAK`, `BKPF`).
   - Detect obsolete ABAP statements (`TABLES`, `FORM/PERFORM`, `CALL 'SYSTEM'`, `OPEN DATASET`).
2. **Release Contract C1 Audit**:
   - Check every called function module, class, interface, and CDS view against Cloudification repository.
   - Classify into: `RELEASED_C1`, `DEPRECATED`, `UNRELEASED`.
3. **Successor Mapping**:
   If object is unreleased or deprecated, map to official SAP successor (e.g., `MARA` $\rightarrow$ `I_Product`, `BKPF` $\rightarrow$ `I_JournalEntry`).
4. **Compliance Metric**:
   $$\text{Clean Core Compliance \%} = \frac{\text{Clean Statements}}{\text{Total Analyzed Statements}} \times 100$$

### 8.5 Edge Cases
- Dynamic SQL (`SELECT (lv_fields) FROM (lv_table)`) flagged with uncertainty.
- Native SQL statements (`EXEC SQL`).
- Internal macro expansions (`DEFINE ... END-OF-DEFINITION`).

### 8.6 Error Conditions
- Unparseable ABAP syntax preventing AST generation.
- Corrupted abapGit zip file.

### 8.7 Output Schema
```json
{
  "engine": "clean_core_object_guard",
  "status": "completed",
  "findings": [
    {
      "code": "CLEAN_CORE_DIRECT_DB_ACCESS",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "Direct Database Access to Table MARA",
      "message": "Direct SELECT on classic SAP table MARA violates Clean Core. Use released CDS view I_Product.",
      "technicalDetails": {
        "statement": "SELECT * FROM mara INTO TABLE @lt_mara",
        "lineNumber": 84,
        "table": "MARA",
        "successor": "I_Product"
      }
    }
  ],
  "metrics": {
    "totalStatements": 450,
    "cleanStatements": 412,
    "violationsCount": 38,
    "compliancePercentage": 91.5
  }
}
```

### 8.8 Confidence Classification
- `VERIFIED`: Static AST match verified against official Cloudification repository.
- `RULE_DERIVED`: Syntax modernization heuristics.
- `UNKNOWN`: Dynamic execution patterns.

### 8.9 Fixtures Needed
- `clean_core_compliant.abap`: RAP ABAP Cloud class using released CDS views.
- `clean_core_legacy.abap`: Classic report with direct table selects and obsolete syntax.
- `clean_core_dynamic.abap`: Class containing dynamic function calls.

---

## 9. Change Pointer Coverage Auditor

### 9.1 Domain
Integration / ALE & IDoc Master Data Synchronization.

### 9.2 Purpose
Audit whether business data field changes trigger the expected change pointers in SAP, verifying global activation, message type activation, field-level linkage, change document flag, and runtime pointer generation.

### 9.3 Input Artifacts
- BD61 configuration export (Global change pointer activation).
- BD50 configuration export (Message type activation).
- BD52 configuration export (Field-level table and field linkage).
- ABAP Dictionary DD04L metadata (Change Document flag on data elements).
- BDCP2 runtime change pointer sample export.

### 9.4 Deterministic Parsing Rules
1. **Global Check**: Verify BD61 is active (`X`). If inactive, flag critical failure.
2. **Message Type Check**: Verify BD50 is active for message type (e.g. `MATMAS`, `DEBMAS`).
3. **Field Coverage Audit**: For each business-critical field (e.g. `MARA-MATKL`, `MARA-GROES`), verify presence in BD52 for change document object (`MATERIAL`).
4. **Change Document Flag**: Verify DD04L has change document flag set.
5. **Runtime Reconciliation**: Compare BDCP2 runtime samples against expected fields to detect silent drops.

### 9.5 Edge Cases
- Reduced message type (BD53) filtering out fields configured in BD52.
- Field defined in BD52 but underlying data element lacks change document flag in DD04L.
- Custom field `YY1_` added to table but omitted from BD52.

### 9.6 Error Conditions
- Missing BD52 export.
- Unrecognized message type.

### 9.7 Output Schema
```json
{
  "engine": "change_pointer_auditor",
  "status": "completed",
  "findings": [
    {
      "code": "CP_FIELD_NOT_CONFIGURED_BD52",
      "severity": "HIGH",
      "confidence": "VERIFIED",
      "title": "Trigger Field Missing in BD52",
      "message": "Field 'MARA-GROES' is expected to trigger MATMAS change pointers but is missing in BD52.",
      "technicalDetails": {
        "messageType": "MATMAS",
        "changeDocumentObject": "MATERIAL",
        "table": "MARA",
        "field": "GROES"
      }
    }
  ],
  "metrics": {
    "totalExpectedFields": 35,
    "coveredFields": 32,
    "coveragePercentage": 91.4,
    "globalActive": true,
    "messageTypeActive": true
  }
}
```

### 9.8 Confidence Classification
- `VERIFIED`: Exact match against BD61/BD50/BD52 and DD04L.
- `RULE_DERIVED`: Inferred from standard IDoc segment field lists.
- `UNKNOWN`: Custom BAdI/exit filtering pointers dynamically.

### 9.9 Fixtures Needed
- `cp_matmas_active.json`: Complete active configuration.
- `cp_global_disabled.json`: Inactive BD61 with active BD50.
- `cp_missing_field.json`: BD52 missing `GROES` field.

---

## 10. API Change Guard

### 10.1 Domain
Integration / API Lifecycle & Breaking Change Governance.

### 10.2 Purpose
Compare API specifications (OpenAPI 2.0/3.0, OData EDMX V2/V4) across releases to detect breaking changes and evaluate impact against registered client integrations.

### 10.3 Input Artifacts
- Baseline API specification (OpenAPI JSON/YAML or OData EDMX).
- Candidate API specification.
- Project Integration Registry (registered client apps, consumed endpoints, and fields).

### 10.4 Deterministic Diff Rules
1. **Breaking Schema Changes**:
   - Endpoint or EntitySet removed.
   - HTTP method / operation removed.
   - Property / field removed.
   - Required property added to request body.
   - Property data type altered (e.g. String $\rightarrow$ Integer).
   - Property max length decreased.
   - Allowed enum values restricted.
2. **Non-Breaking Changes**:
   - Optional property added to request or response.
   - New endpoint or operation added.
   - Enum expanded.
3. **Consumer Impact Cross-Check**:
   Cross-reference breaking changes against specific fields registered in project integration registry.

### 10.5 Edge Cases
- OData V2 to V4 structural payload differences (`d/results` wrapper changes).
- Deprecated field remaining operational until next release.
- Type narrowing vs widening.

### 10.6 Error Conditions
- Invalid OpenAPI / EDMX syntax.
- Missing baseline specification.

### 10.7 Output Schema
```json
{
  "engine": "api_change_guard",
  "status": "completed",
  "findings": [
    {
      "code": "API_BREAKING_FIELD_REMOVED",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "Breaking Change: Consumed Field Removed",
      "message": "Property 'TaxJurisdictionCode' was removed from PurchaseOrder entity.",
      "technicalDetails": {
        "entity": "PurchaseOrder",
        "property": "TaxJurisdictionCode",
        "affectedIntegrations": ["SALESFORCE_INTEGRATION_01"]
      }
    }
  ],
  "metrics": {
    "breakingChangesCount": 1,
    "nonBreakingChangesCount": 4,
    "affectedIntegrationsCount": 1
  }
}
```

### 10.8 Confidence Classification
- `VERIFIED`: Deterministic AST diff of API schemas.
- `RULE_DERIVED`: Inferred consumer impact based on registry.
- `UNKNOWN`: Unregistered external consumers.

### 10.9 Fixtures Needed
- `api_openapi_breaking.json`: OpenAPI spec removing consumed field.
- `api_odata_edmx_type_change.xml`: EDMX with property type changed.

---

## 11. Software Collection Dependency Guard

### 11.1 Domain
Release & Transport / Key-User Cloud Extensibility Release Governance.

### 11.2 Purpose
Preflight SAP S/4HANA Cloud Key-User Software Collections prior to export and import, validating dependencies, detecting cycles, and calculating the optimal import order.

### 11.3 Input Artifacts
- Software Collection export manifests / JSON metadata.
- Extensibility item descriptors (Custom Fields, CDS Views, Logic, Forms, App Variants).

### 11.4 Deterministic Parsing Rules
1. **Dependency Extraction**: Parse item metadata to extract object references.
2. **Cross-Collection Linkage**: Verify whether referenced items reside in the same or separate software collection.
3. **Missing Prerequisites**: Flag referenced items that do not exist in target system or in the release scope.
4. **Topological Sort & Cycle Detection**: Run topological sort on collection dependency graph. Detect directed cycles ($A \rightarrow B \rightarrow A$).
5. **Sequence Recommendation**: Generate deterministic import sequence.

### 11.5 Edge Cases
- Multi-collection circular chains ($A \rightarrow B \rightarrow C \rightarrow A$).
- Extension item in "Draft" status included in software collection.
- App variant depending on a deleted custom field.

### 11.6 Error Conditions
- Malformed manifest JSON.
- Dangling UUID reference.

### 11.7 Output Schema
```json
{
  "engine": "software_collection_guard",
  "status": "completed",
  "findings": [
    {
      "code": "SC_CIRCULAR_DEPENDENCY",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "Circular Dependency Between Collections",
      "message": "Collection 'SC_FINANCE' and 'SC_SALES' depend on each other and cannot be imported sequentially.",
      "technicalDetails": {
        "cycle": ["SC_FINANCE", "SC_SALES", "SC_FINANCE"]
      }
    }
  ],
  "metrics": {
    "totalCollections": 5,
    "totalItems": 42,
    "circularDependenciesCount": 1,
    "recommendedSequence": []
  }
}
```

### 11.8 Confidence Classification
- `VERIFIED`: Complete dependency graph from official export manifests.
- `RULE_DERIVED`: Inferred from naming conventions.
- `UNKNOWN`: Unresolved UUIDs.

### 11.9 Fixtures Needed
- `sc_valid_sequence.json`: Two collections with clean order.
- `sc_circular.json`: Mutually dependent collections.

---

## 12. Transport Dependency Analyzer

### 12.1 Domain
Release & Transport / Classic ABAP Transport Governance.

### 12.2 Purpose
Analyze ABAP Transport Requests (TRs) for object conflicts, cross-TR call dependencies, overtaking risks, and sequencing errors before import into target QA or Production environments.

### 12.3 Input Artifacts
- Transport Request header table (E070).
- Transport Request object entries table (E071).
- Transport Request key entries table (E071K).
- ABAP code syntax call trees.

### 12.4 Deterministic Parsing Rules
1. **Object Collision Check**: Detect the same repository object (e.g. `TABL ZTABLE`, `CLAS ZCL_ORDER`) present across multiple unreleased or concurrent transports.
2. **Dependency Call Graph**: Object in TR1 calls or inherits from an object defined in TR2. TR2 must precede TR1.
3. **Overtaker / Downgrade Risk**: An older version of an object transported in TR1 is imported after a newer version in TR2.
4. **Sequencing Engine**: Calculate topological import sequence.

### 12.5 Edge Cases
- Customizing transport (E071K table keys) depending on a table definition in a Workbench transport.
- Multi-level sub-tasks under a main request with conflicting statuses.

### 12.6 Error Conditions
- Corrupted E070/E071 export.
- Missing target system repository baseline.

### 12.7 Output Schema
```json
{
  "engine": "transport_dependency_analyzer",
  "status": "completed",
  "findings": [
    {
      "code": "TR_OBJECT_COLLISION",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "Object Collision Across Transports",
      "message": "Class 'ZCL_ORDER_HANDLER' is modified in both DEVK900101 and DEVK900105.",
      "technicalDetails": {
        "object": "CLAS ZCL_ORDER_HANDLER",
        "conflictingTransports": ["DEVK900101", "DEVK900105"]
      }
    }
  ],
  "metrics": {
    "totalTransports": 8,
    "totalObjects": 64,
    "collisionsCount": 1,
    "recommendedImportSequence": ["DEVK900090", "DEVK900101", "DEVK900105"]
  }
}
```

### 12.8 Confidence Classification
- `VERIFIED`: Exact E070/E071 table collision and AST syntax link.
- `RULE_DERIVED`: Inferred from transport release timestamps.
- `UNKNOWN`: Dynamic program execution.

### 12.9 Fixtures Needed
- `tr_collision.json`: Transports modifying the same class.
- `tr_sequence_dependency.json`: Transport containing report calling table in another transport.

---

## 13. Safe Decommission Preflight

### 13.1 Domain
Operations / IAM & Operational Hardening.

### 13.2 Purpose
Preflight the locking or deletion of user accounts, technical users, RFC destinations, or service accounts by discovering active operational dependencies before outages occur.

### 13.3 Input Artifacts
- User master record table (USR02).
- Scheduled background jobs tables (TBTCO, TBTCP).
- RFC destinations configuration (RFCDES).
- Workflow work items (SWWWIHEAD).
- System audit log / usage stats (SM20 / ST03N).

### 13.4 Deterministic Parsing Rules
1. **Background Job Check**: Identify active or periodic jobs where target user is job creator (`SDLUNAME`) or execution user (`AUTHNAME`).
2. **RFC Logon User Check**: Identify active RFC destinations configured with target user credentials.
3. **Workflow Ownership**: Check if user is the sole assigned agent or current processor of pending work items.
4. **Recent Activity Audit**: Check last logon timestamp and execution history in ST03N/SM20 within 90 days.
5. **Reassignment Checklist**: Output actionable migration list before account deactivation.

### 13.5 Edge Cases
- User owns a recurring periodic job with no end date.
- User is sole member of a critical authorization role or approval group.
- Technical user locked in SAP but external middleware still calls RFC every 60 seconds (log flooding).

### 13.6 Error Conditions
- Incomplete TBTCO or RFCDES export.
- Target user not found in USR02.

### 13.7 Output Schema
```json
{
  "engine": "safe_decommission_preflight",
  "status": "completed",
  "findings": [
    {
      "code": "DECOM_SCHEDULED_JOB_DEPENDENCY",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "Active Background Jobs Owned by User",
      "message": "User 'BATCH_ADMIN' is configured as execution user for 4 active background jobs.",
      "technicalDetails": {
        "jobNames": ["SAP_BILLING_DAILY", "SAP_REVALUATION_NIGHTLY"],
        "status": "SCHEDULED"
      }
    }
  ],
  "metrics": {
    "activeJobsCount": 4,
    "activeRfcCount": 0,
    "pendingWorkItemsCount": 0,
    "daysSinceLastActive": 1,
    "decommissionRiskScore": 9.2
  }
}
```

### 13.8 Confidence Classification
- `VERIFIED`: Exact match in active TBTCO, RFCDES, or SWWWIHEAD tables.
- `RULE_DERIVED`: Inferred from user naming convention.
- `UNKNOWN`: External systems holding cached credentials.

### 13.9 Fixtures Needed
- `decom_job_owner.json`: User owning active daily billing batch jobs.
- `decom_safe.json`: User with zero dependencies, inactive for 180 days.

---

## 14. Fiori 403 Root-Cause Doctor

### 14.1 Domain
Operations / Fiori & Gateway Diagnostic Troubleshooting.

### 14.2 Purpose
Traverse a deterministic diagnostic decision tree to identify the exact technical root cause of HTTP 403 Forbidden / unauthorized errors across Fiori Launchpad, Gateway, ICF, UCON, and Cloud Connector.

### 14.3 Input Artifacts
- HTTP request/response headers & payload.
- SAP Gateway error log (`/IWFND/ERROR_LOG`).
- Authorization trace (SU53 export).
- ICF service status export (SICF).
- UCON configuration and Cloud Connector logs.

### 14.4 Deterministic Diagnostic Decision Tree
1. **Status Code Verification**: Ensure response is HTTP 403.
2. **SU53 Authorization Check**: Check for failed authorization objects (`S_SERVICE`, `S_RFC`, `S_START`, `I_AUTH`). If failed, return `FIORI_AUTH_OBJECT_MISSING`.
3. **SICF Service Status Check**: Verify if OData ICF service path is inactive. If inactive, return `FIORI_ICF_INACTIVE`.
4. **Gateway Registration Check**: Check `/IWFND/MAINT_SERVICE` activation and system alias.
5. **UCON Deny List Check**: Verify if RFC/HTTP endpoint is blocked by UCON rules.
6. **CSRF Token Validation**: Check if request is POST/PUT/DELETE lacking valid `x-csrf-token`. Return `FIORI_CSRF_TOKEN_INVALID`.
7. **Cloud Connector Check**: Check for resource path or principal propagation rejection.

### 14.5 Edge Cases
- Authorization passed for business catalog, but row-level authorization (Company Code / Sales Org) failed.
- Expired CSRF token on long-idle Fiori browser session.
- SSL reverse proxy returning 403 before request reaches SAP Gateway.

### 14.6 Error Conditions
- Missing SU53 or `/IWFND/ERROR_LOG` trace.
- Generic HTML error page without SAP error headers.

### 14.7 Output Schema
```json
{
  "engine": "fiori_403_doctor",
  "status": "completed",
  "findings": [
    {
      "code": "FIORI_AUTH_OBJECT_MISSING",
      "severity": "HIGH",
      "confidence": "VERIFIED",
      "title": "Missing Authorization Object S_SERVICE",
      "message": "User lacks authorization object S_SERVICE for OData V4 service 'C_SALESORDER_CDS'.",
      "technicalDetails": {
        "authObject": "S_SERVICE",
        "fields": { "SRV_NAME": "C_SALESORDER_CDS", "SRV_TYPE": "HT" }
      }
    }
  ],
  "metrics": {
    "diagnosticStepsEvaluated": 7,
    "rootCauseArea": "AUTHORIZATION",
    "confidenceScore": 1.0
  }
}
```

### 14.8 Confidence Classification
- `VERIFIED`: Exact SU53 failure match or confirmed inactive ICF status.
- `RULE_DERIVED`: Inferred from Gateway error message text.
- `UNKNOWN`: Unlogged proxy errors.

### 14.9 Fixtures Needed
- `fiori_403_su53_s_service.json`: SU53 failure for S_SERVICE.
- `fiori_403_icf_inactive.json`: Inactive ICF node in SICF export.

---

## 15. Workflow Stuck Explainer

### 15.1 Domain
Operations / Business Workflow & Flexible Workflow Diagnostics.

### 15.2 Purpose
Diagnose stuck, failed, or overdue SAP Business Workflows and S/4HANA Flexible Workflows, identifying the exact failed task, missing agent, deadline breach, or missing triggering event.

### 15.3 Input Artifacts
- Workflow header & step logs (SWWWIHEAD, SWWLOGHIST).
- Workflow container data (sanitized).
- Agent resolution trace.
- Event linkage table (SWETYPV / SWE2).

### 15.4 Deterministic Parsing Rules
1. **Work Item State Analysis**: Inspect status of all work items under top-level workflow:
   - `ERROR`: Step terminated with exception / runtime dump.
   - `READY`: Step waiting for agent pickup.
   - `WAITING`: Step waiting for event or condition.
2. **Agent Resolution Audit**: If status is `READY` or `ERROR` and agent list is empty, flag `WF_STUCK_NO_AGENT`.
3. **Background Step Failure**: If background task failed with return code $>0$ or dump, extract exception class and error message.
4. **Event Linkage Verification**: Check SWETYPV for inactive event linkage between business object and workflow template.
5. **Deadline Monitoring**: Check SWWDEADL for missed SLA deadlines.

### 15.5 Edge Cases
- Dynamic responsibility rule returning 0 users due to missing HR org assignment.
- Container binding type mismatch causing background execution dump.
- Work item locked in session enqueue.

### 15.6 Error Conditions
- Incomplete SWWWIHEAD table export.
- Corrupted workflow container format.

### 15.7 Output Schema
```json
{
  "engine": "workflow_stuck_explainer",
  "status": "completed",
  "findings": [
    {
      "code": "WF_STUCK_NO_AGENT",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "No Agent Found for Approval Step",
      "message": "Workflow step 0000045012 reached status READY, but rule 00000168 resolved to zero eligible agents.",
      "technicalDetails": {
        "workitemId": "0000045012",
        "task": "TS00008267",
        "agentRule": "00000168",
        "recommendation": "SWIA forward or update HR responsibility rule"
      }
    }
  ],
  "metrics": {
    "totalWorkItems": 12,
    "stuckStepId": "0000045012",
    "hoursStuck": 48.5,
    "restartCandidate": true
  }
}
```

### 15.8 Confidence Classification
- `VERIFIED`: Exact status code and error entry in SWWWIHEAD / SWWLOGHIST.
- `RULE_DERIVED`: Inferred from agent rule configuration.
- `UNKNOWN`: Dynamic container expression failure where payload is redacted.

### 15.9 Fixtures Needed
- `wf_stuck_empty_agents.json`: Work item in READY state with empty agent list.
- `wf_background_dump.json`: Background task in ERROR status with exception dump.

---

## 16. IAM Cost Optimizer

### 16.1 Domain
Operations / SAP Identity & Access Management & License Cost Optimization.

### 16.2 Purpose
Model SAP business role and catalog composition to recommend least-privilege role design, eliminate redundant catalogs, and minimize enterprise license cost impact based on SAP user type price categories (Advanced, Core, Self-Service).

### 16.3 Input Artifacts
- Business role definitions (AGR_1251, AGR_AGRS / Fiori Business Roles).
- User-to-role assignments (AGR_USERS).
- SAP price category / user licensing catalog (Advanced, Core, Self-Service app mappings).
- ST03N / Fiori Launchpad actual usage telemetry.

### 16.4 Deterministic Parsing Rules
1. **Catalog Composition Traversal**: Enumerate all catalogs and underlying apps assigned to each business role.
2. **Redundant Catalog Detection**: Identify catalogs whose apps are 100% covered by another assigned catalog.
3. **License Driver App Pinpointing**: Identify the specific "high-cost" app in a role that escalates a user from Self-Service/Core to Advanced.
4. **Unused Privilege Identification**: Compare role privileges against 90-day ST03N usage logs.
5. **Least-Privilege Role Refactoring**: Propose role splitting (e.g. separating read-only display apps from maintenance/reversal apps).

### 16.5 Edge Cases
- Emergency / firecall role assigned permanently rather than via temporary privileged access.
- Custom business catalog mixing 20 read-only apps with 1 transactional app.
- Multi-role accumulation where 2 separate roles combine to trigger advanced license tier.

### 16.6 Error Conditions
- Missing price category definition catalog.
- Corrupted AGR_USERS export.

### 16.7 Output Schema
```json
{
  "engine": "iam_cost_optimizer",
  "status": "completed",
  "findings": [
    {
      "code": "IAM_LICENSE_TIER_ESCALATED",
      "severity": "MEDIUM",
      "confidence": "RULE_DERIVED",
      "title": "Single App Escalates License Tier to Advanced",
      "message": "Role 'Z_FI_CLERK' contains app 'FB08' (Advanced), escalating 50 users from Core to Advanced license tier.",
      "technicalDetails": {
        "role": "Z_FI_CLERK",
        "escalatingApp": "FB08",
        "affectedUsers": 50,
        "recommendedAction": "Extract FB08 into separate Z_FI_SUPERVISOR role"
      }
    }
  ],
  "metrics": {
    "totalRoles": 24,
    "redundantCatalogsCount": 3,
    "potentialLicenseSavingsPercentage": 22.5
  }
}
```

### 16.8 Confidence Classification
- `VERIFIED`: Exact catalog and app composition match.
- `RULE_DERIVED`: Modeled license tier impact based on price-category rules.
- `UNKNOWN`: Customer-specific custom licensing agreements.

### 16.9 Fixtures Needed
- `iam_role_single_app_escalation.json`: Role with 1 Advanced app inflating license.
- `iam_redundant_catalogs.json`: Overlapping catalogs in role.

---

## 17. Account Determination Preflight

### 17.1 Domain
Operations / FI/CO, MM, SD Automatic Account Determination.

### 17.2 Purpose
Preflight automatic account determination matrices (VKOA for SD, OBYC for MM, FBKP for FI) across all valid business combinations before go-live or configuration changes, detecting missing GL accounts, blocked accounts, and conflicting rules.

### 17.3 Input Artifacts
- Account determination tables (T030, T030K, OBYC, VKOA, FBKP exports).
- Chart of Accounts master data (SKA1, SKB1).
- Valuation classes (T025), Movement types (T156), Account modifiers (KOMOK).
- Organizational units (Company Codes, Valuation Areas, Sales Orgs).

### 17.4 Deterministic Parsing Rules
1. **Combinatorial Matrix Traversal**: Generate all valid permutations of:
   - Transaction Key (`BSX`, `WRX`, `PRD`, `GBB`, `KOFI`)
   - Valuation Class
   - Account Modifier / Movement Type
   - Chart of Accounts / Company Code
2. **Missing GL Account Audit**: Flag any valid combination where GL account is blank or unassigned.
3. **GL Account Existence & Status**: Verify resolved GL account exists in SKA1 (chart of accounts level) and SKB1 (company code level) and check posting block flag (`XSPERR != 'X'`).
4. **Conflicting & Shadowed Rules**: Detect overlapping criteria producing ambiguous account resolution.
5. **Suspicious Catch-All Detection**: Flag wildcard rules routing diverse transactions to a generic suspense account.

### 17.5 Edge Cases
- Account exists in Chart of Accounts (SKA1) but has not been extended to target Company Code (SKB1).
- Split valuation materials where account determination varies by valuation type.
- Tax account determination (OB40) missing valid tax jurisdiction code.

### 17.6 Error Conditions
- Missing Chart of Accounts table export.
- Corrupted table CSV/XLSX.

### 17.7 Output Schema
```json
{
  "engine": "account_determination_preflight",
  "status": "completed",
  "findings": [
    {
      "code": "ACCT_DET_MISSING_ACCOUNT",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "Missing GL Account for Inventory Posting",
      "message": "Transaction Key 'BSX', Valuation Class '3000' has no GL account configured in Chart of Accounts 'CA01'.",
      "technicalDetails": {
        "transactionKey": "BSX",
        "valuationClass": "3000",
        "chartOfAccounts": "CA01",
        "companyCode": "1000"
      }
    }
  ],
  "metrics": {
    "totalCombinationsEvaluated": 1250,
    "missingCombinationsCount": 4,
    "blockedAccountsCount": 1,
    "coveragePercentage": 99.6
  }
}
```

### 17.8 Confidence Classification
- `VERIFIED`: Complete configuration tables and master chart of accounts verified.
- `RULE_DERIVED`: Inferred from standard SAP account determination tables.
- `UNKNOWN`: Custom BAdI/exit dynamically replacing GL account.

### 17.9 Fixtures Needed
- `acct_det_missing_bsx.json`: OBYC missing inventory account for valuation class 3000.
- `acct_det_blocked_gl.json`: Rule pointing to GL account with `XSPERR='X'`.

---

## 18. System Refresh Delta Guard

### 18.1 Domain
Operations / System Refresh & Landscape Isolation Governance.

### 18.2 Purpose
Compare system-specific configuration before and after an SAP system refresh/client copy (e.g. PRD $\rightarrow$ QAS), detecting un-isolated RFC destinations, unconverted logical systems, production email endpoints, and un-sanitized batch jobs before test execution commences.

### 18.3 Input Artifacts
- Pre-refresh baseline configuration export.
- Post-refresh target configuration export.
- Environment isolation policy rules.
- Monitored components: RFCDES (RFCs), BD64/T000 (Logical Systems), SPAD (Printers), TBTCO (Jobs), SICF (Endpoints), SCOT (Email/SMTP), STRUST (Certificates).

### 18.4 Deterministic Parsing Rules
1. **RFC Destination Isolation Check**: Detect RFC destinations in QA/DEV pointing to production IP addresses, hostnames, or production SAProuter strings.
2. **Logical System Misalignment Check**: Check if client logical system (`T000-LOGSYS`) still has production logical system name instead of target QA logical system.
3. **SCOT Email Routing Safety**: Verify SCOT is set to routing test domain or disabled, preventing outbound emails to real suppliers or customers.
4. **Batch Job Sanitization**: Check if production payment or EDI jobs are scheduled in refreshed system.
5. **Allow / Ignore Policy Application**: Filter out approved differences.
6. **Remediation Action Checklist**: Output BDLS, RFC, and SCOT repair checklists.

### 18.5 Edge Cases
- Custom Z-tables storing production endpoint URLs or API tokens.
- Incomplete BDLS conversion leaving orphaned production logical system references.
- External BTP Destination pointing to production subaccount after on-prem refresh.

### 18.6 Error Conditions
- Missing baseline or post-refresh snapshot.
- Mismatched System IDs (SIDs).

### 18.7 Output Schema
```json
{
  "engine": "system_refresh_delta_guard",
  "status": "completed",
  "findings": [
    {
      "code": "REFRESH_RFC_TARGETS_PRODUCTION",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "RFC Destination Points to Production System",
      "message": "RFC Destination 'SAP_BANK_GATEWAY' in refreshed QAS system points to production host 'prod-bank.acme.corp'.",
      "technicalDetails": {
        "rfcDestination": "SAP_BANK_GATEWAY",
        "targetHost": "prod-bank.acme.corp",
        "preRefreshValue": "prod-bank.acme.corp",
        "expectedValue": "qa-bank.acme.corp"
      }
    }
  ],
  "metrics": {
    "totalSettingsCompared": 184,
    "identicalCount": 162,
    "safeDeltasCount": 18,
    "hazardousDeltasCount": 4,
    "isolationRiskScore": 9.8
  }
}
```

### 18.8 Confidence Classification
- `VERIFIED`: Exact string/config comparison between pre and post refresh snapshots.
- `RULE_DERIVED`: Heuristic pattern matching of production hostnames/IPs.
- `UNKNOWN`: Unmonitored custom tables.

### 18.9 Fixtures Needed
- `refresh_rfc_pointing_to_prod.json`: RFCDES export with production hostname.
- `refresh_clean_isolated.json`: Properly sanitized QA configuration.

---

## 19. MFS BlackBox

### 19.1 Domain
Warehouse Automation / SAP EWM Material Flow System (MFS) Causal Diagnostics.

### 19.2 Purpose
Analyze SAP EWM/MFS telegram logs and PLC messages to identify the first causal divergence in warehouse automation incidents (conveyor jams, telegram retry storms, impossible HU jumps, missing confirmations), rather than just the final visible error.

### 19.3 Input Artifacts
- MFS telegram log export (CSV, XLSX, TXT from `/SCWM/MFS_TELEGRAM` or PLC log).
- Telegram specification model (telegram types, sequence numbers, handshake timeouts).
- Communication point route topology model (conveyor segments, resources, sorting lanes).

### 19.4 Deterministic Parsing Rules
1. **Telegram Stream Ingestion**: Parse timestamps, telegram type (`WT`, `ACK`, `SYN`, `LIFE`, `MOVE`), Handling Unit (HU) ID, Telegram Sequence Number, Sender PLC, Receiver, Communication Point (CP), Status.
2. **State Machine Reconstruction**: Maintain state machine tracking physical position, destination, and status for every active HU and Warehouse Task (WT).
3. **Handshake & ACK Timeout Validation**: Verify that every sent telegram receives a matching ACK within configured window (e.g. 500ms). Detect unacknowledged telegrams, duplicate sends, and retry storms.
4. **Sequence & Ordering Invariants**: Detect out-of-order telegrams or sequence number gaps.
5. **Conveyor Topology Validation**: Check if reported CP transitions follow valid conveyor edges. Detect `MFS_IMPOSSIBLE_TOPOLOGY_JUMP` (e.g. HU reported at CP04 without passing CP02 and CP03).
6. **First Causal Divergence Pinpointing**: Identify the exact chronological earliest timestamp and telegram where the state machine violated invariants, tracing downstream cascading consequences.

### 19.5 Edge Cases
- Clock skew between PLC clock and SAP EWM application server timestamp (require relative delta reconciliation).
- Parallel conveyor divert lanes where two alternate paths are physically valid.
- Life telegram heartbeat timeout during network switch failover.

### 19.6 Error Conditions
- Corrupted log rows or missing timestamp.
- Custom PLC telegram format lacking specification descriptor.

### 19.7 Output Schema
```json
{
  "engine": "mfs_blackbox",
  "status": "completed",
  "findings": [
    {
      "code": "MFS_FIRST_CAUSAL_DIVERGENCE",
      "severity": "CRITICAL",
      "confidence": "VERIFIED",
      "title": "First Causal Divergence: Missing ACK Timeout",
      "message": "Earliest failure at 03:14:02.102: PLC01 did not acknowledge MOVE telegram for HU 998811 at CP02, triggering retry storm.",
      "technicalDetails": {
        "timestamp": "2026-09-24T03:14:02.102Z",
        "telegramType": "MOVE",
        "huId": "998811",
        "communicationPoint": "CP02",
        "retryCount": 10,
        "consequence": "PLC buffer overflow resulting in line emergency stop at 03:14:15.000Z"
      }
    }
  ],
  "metrics": {
    "totalTelegramsParsed": 24500,
    "activeHUs": 142,
    "incidentDurationSeconds": 12.898,
    "telegramErrorRate": 0.041
  }
}
```

### 19.8 Confidence Classification
- `VERIFIED`: Invariant violation proven by chronological telegram logs.
- `RULE_DERIVED`: Inferred conveyor progression where intermediate CP logs are sparse.
- `UNKNOWN`: Unlogged internal PLC state changes.

### 19.9 Fixtures Needed
- `mfs_normal_flow.csv`: Normal sequential telegram stream with timely ACKs.
- `mfs_ack_retry_storm.csv`: Telegram failing ACK, triggering 10 retries and conveyor halt.
- `mfs_impossible_jump.csv`: HU jumping directly from CP01 to CP05.

---

# Detailed Specifications: Shared Platform Services

---

## 20. Evidence Engine

### 20.1 Domain
Shared Platform Services / Trust & Verifiability Architecture.

### 20.2 Purpose
Attach immutable provenance to every technical verdict, verify SAP release alignment, calculate trust scores across disparate evidence sources, detect stale or conflicting evidence, and provide an evidence-only audit view.

### 20.3 Input Artifacts
- Technical findings from any preflight engine.
- SAP official metadata releases, SAP Notes, KBAs, SAP Help Portal docs, parser AST tokens.

### 20.4 Deterministic Rules & Hierarchy
1. **Trust Level Hierarchy**:
   - `OFFICIAL_METADATA`: API specs, Cloudification repository, abaplint AST (Trust 1.0)
   - `OFFICIAL_DOCS`: SAP Help Portal, SAP Notes, KBAs (Trust 0.95)
   - `OFFICIAL_SUPPORT`: Support tickets, SAP Support Knowledge (Trust 0.90)
   - `CURATED_INTERNAL_RULE`: Versioned ERP Preflight rule bundle (Trust 0.85)
   - `OFFICIAL_COMMUNITY`: SAP Community verified answers (Trust 0.70)
   - `THIRD_PARTY_REF`: Open source, books, articles (Trust 0.60)
   - `CUSTOMER_EVIDENCE`: Uploaded customer configs, logs (Trust 0.50)
   - `INFERRED`: Heuristic or LLM semantic matching (Trust 0.30)
2. **Release Alignment Verification**:
   Check if evidence `validFromRelease` $\le$ Target Release $\le$ `validToRelease`. Flag `EVIDENCE_RELEASE_MISALIGNED` if invalid.
3. **Conflict Detection**:
   Flag `EVIDENCE_CONFLICT_DETECTED` if two evidence items assert contradictory facts for the same object and release.
4. **Cryptographic Hashes**:
   Compute SHA-256 hash of evidence excerpt text to ensure immutability.

### 20.5 Output Schema
```json
{
  "evidenceId": "ev_01J8R9...",
  "sourceType": "OFFICIAL_METADATA",
  "sourceTitle": "SAP Cloudification Repository S/4HANA 2608",
  "sourceUrl": "https://github.com/SAP/abap-atc-cr-cv-s4hc",
  "targetRelease": "2608",
  "trustLevel": 1.0,
  "excerptHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "alignmentStatus": "RELEASE_ALIGNED"
}
```

---

## 21. Confidence Classifier

### 21.1 Domain
Shared Platform Services / Epistemic Governance & Integrity.

### 21.2 Purpose
Enforce a strict reliability hierarchy across all engine outputs, categorizing findings into four standardized classes and preventing unverified guesses or LLM hallucinations from masquerading as verified facts.

### 21.3 Confidence Classes
1. `VERIFIED`: Proven by exact parser, formal schema, or authoritative config evidence (AST parse, XML schema validation, BD61 active, exact table match).
2. `RULE_DERIVED`: Evaluated by a deterministic rule engine, decision table, or graph traversal over known facts (OPD rule match, SPRO mapping, dependency graph reachability).
3. `INFERRED`: Derived from probabilistic semantic matching, heuristic similarity, or LLM reasoning (Gap Radar semantic match of requirement description).
4. `UNKNOWN`: Insufficient evidence or conflicting facts; a first-class valid outcome.

### 21.4 Deterministic Demotion Rules
- **Non-Negotiable LLM Boundary**: If an LLM is involved in determining the finding, the confidence class can NEVER exceed `INFERRED`.
- **Missing Input Artifacts**: If mandatory input artifacts are absent, the engine must return `UNKNOWN` and state what artifact is required.

---

## 22. AI Problem Router

### 22.1 Domain
Shared Platform Services / Intent Classification & Dispatch.

### 22.2 Purpose
Convert natural-language problem descriptions, uploaded files, or direct SAP object identifiers into recommended preflight engines, explaining the recommendation rationale and identifying missing input artifacts.

### 22.3 Deterministic & Semantic Routing Rules
1. **Deterministic Artifact Routing**:
   - `.xdp` / `.xsd` / Adobe XML $\rightarrow$ `FormDoctor`
   - OPD CSV/XLSX $\rightarrow$ `OPD Guard`
   - MFS telegram log $\rightarrow$ `MFS BlackBox`
   - `.abap` / abapGit ZIP $\rightarrow$ `Clean Core Object Guard`
   - OpenAPI / EDMX $\rightarrow$ `API Change Guard`
   - Software Collection export $\rightarrow$ `Software Collection Dependency Guard`
   - E070/E071 transport $\rightarrow$ `Transport Dependency Analyzer`
   - BD50/BD52 config $\rightarrow$ `Change Pointer Coverage Auditor`
   - ST03N / Readiness Check $\rightarrow$ `ECC2Cloud Navigator`
   - USR02 / TBTCO / RFCDES $\rightarrow$ `Safe Decommission Preflight`
   - SU53 trace / `/IWFND/ERROR_LOG` $\rightarrow$ `Fiori 403 Root-Cause Doctor`
   - SWWWIHEAD log $\rightarrow$ `Workflow Stuck Explainer`
   - OBYC / VKOA tables $\rightarrow$ `Account Determination Preflight`
   - Post-refresh config $\rightarrow$ `System Refresh Delta Guard`
   - AGR_1251 / AGR_USERS $\rightarrow$ `IAM Cost Optimizer`
2. **Semantic Natural Language Routing**:
   Pluggable AI provider maps unstructured user text to primary and secondary candidate engines.
3. **Non-Fabrication Contract**:
   Router only routes and suggests; it never executes business rules or manufactures findings.

### 22.4 Output Schema
```json
{
  "recommendedEngines": [
    {
      "engineId": "opd_guard",
      "engineName": "OPD Guard",
      "confidence": 0.94,
      "rationale": "User describes purchase order created but supplier email not generated.",
      "requiredArtifactsPresent": ["po_scenario.json"],
      "missingArtifactsRequired": ["opd_decision_tables.xlsx"]
    }
  ],
  "suggestedWorkflow": "SINGLE_ENGINE"
}
```

---

## 23. Audit Trail

### 23.1 Domain
Shared Platform Services / Security, Compliance & Enterprise Assurance.

### 23.2 Purpose
Provide an immutable, tamper-evident audit ledger with cryptographic hash chaining, human vs AI attribution, and SIEM export capabilities for all platform actions, meeting SOC 2, ISO 27001, and EU AI Act requirements.

### 23.3 Deterministic Audit Rules
1. **Mandatory Event Schema**:
   `eventId` (UUIDv7), `tenantId`, `userId` / `agentId` (with Human vs AI attribution flag), `action`, `resourceType`, `resourceId`, `timestamp` (UTC ISO 8601 with reliable NTP synchronization), `clientIp`, `userAgent`, `details` (structured diff), `previousEventHash`, `eventHash`.
2. **Cryptographic Hash Chaining**:
   $$\text{eventHash} = \text{SHA-256}(\text{previousEventHash} + \text{eventId} + \text{tenantId} + \text{action} + \text{timestamp} + \text{details})$$
3. **Immutability**:
   Audit table is append-only; updates and deletions are prevented by database triggers and RLS rules.
4. **SIEM Streaming**:
   Export audit events to enterprise SIEM platforms (Splunk, Datadog, AWS CloudWatch).
5. **Legal Hold Support**:
   Support placing tenant audit streams under legal hold, disabling automated data retention purging.

---

# Universal Architectural Contracts

### Analysis Request Contract
```json
{
  "tenantId": "org_01H...",
  "projectId": "proj_01H...",
  "analysisId": "an_01H...",
  "engine": "opd_guard",
  "targetRelease": "2608",
  "artifacts": [
    {
      "artifactId": "art_01H...",
      "fileName": "opd_tables.xlsx",
      "artifactType": "OPD_DECISION_TABLE",
      "storageKey": "tenants/org_01H.../artifacts/art_01H.../opd_tables.xlsx"
    }
  ],
  "options": {
    "deterministicOnly": true,
    "strictValidation": true
  }
}
```

### Analysis Response Contract
```json
{
  "status": "completed",
  "findings": [],
  "metrics": {},
  "evidence": [],
  "artifacts": [],
  "tests": []
}
```

### Canonical Finding Schema
```json
{
  "id": "find_01H...",
  "engine": "opd_guard",
  "code": "OPD_STEP_FAILED",
  "title": "Email Recipient Determination Failed",
  "severity": "HIGH",
  "confidence": "VERIFIED",
  "message": "Output channel evaluated to EMAIL, but no matching rule was found in Email Recipient table.",
  "technicalDetails": {},
  "affectedObjects": ["PURCHASE_ORDER_OUTPUT"],
  "evidence": [],
  "recommendations": ["Add rule for Supplier in Purchasing Org DE01 in Email Recipient decision table"],
  "projectContext": { "projectId": "proj_01H...", "targetRelease": "2608" },
  "release": "2608",
  "firstSeen": "2026-09-24T03:15:00Z",
  "lastEvaluated": "2026-09-24T03:15:00Z",
  "engineVersion": "1.0.0",
  "ruleVersion": "2026.09.1",
  "aiExplanation": null
}
```
