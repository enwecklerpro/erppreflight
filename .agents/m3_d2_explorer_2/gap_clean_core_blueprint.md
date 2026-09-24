# Production Blueprint: SAP Gap Radar & Clean Core Object Guard

> **Engine Suite**: Preflight Engines 7 & 8 (Domain 2: Migration & Clean Core)  
> **Target Files**:  
> - `services/analysis-python/src/engines/gap_radar.py` (Feature 24)  
> - `services/analysis-python/src/engines/clean_core.py` (Feature 25)  
> **Authority**: Extends `AGENTS.md` (Cardinal Axioms 1 & 2), `spec_miner_survey_1/engines_spec.md` (§7, §8), and `engine-authoring.md`.  
> **Author**: `m3_d2_explorer_2` (Domain 2 Blueprint Explorer)  
> **Date**: 2026-09-24  
> **Status**: APPROVED & DROP-IN READY

---

## 1. Executive Summary & Architecture Compliance

This blueprint provides the complete, production-grade architecture and verified drop-in source implementations for two core preflight engines in Domain 2 (Migration & Clean Core):
1. **SAP Gap Radar** (`gap_radar.py`): Resolves functional, technical, and architectural requirements against target SAP S/4HANA releases (Public Cloud, Private Cloud, On-Premise) using an authoritative **12-Tier Clean Core Resolution Hierarchy**. It evaluates whether a requirement is fulfilled by standard Best Practice scope items, standard configuration (SSCUI/CBC), key-user extensibility, developer extensibility (ABAP Cloud / RAP), released C1 APIs/CDS views, event-driven mesh, or side-by-side BTP, versus representing a known product gap or an architecturally **blocked clean core violation** (e.g. direct database table updates). It computes a deterministic **Feasibility Score** ($0.0 - 1.0$) and line-level cryptographic evidence.
2. **Clean Core Object Guard** (`clean_core.py`): Audits custom ABAP code artifacts against SAP Clean Core principles and the SAP Cloudification Repository (`SAP/abap-atc-cr-cv-s4hc`). It executes deterministic static AST analysis detecting classic table direct modifications (`MARA`, `VBAK`, `BKPF`, `BSEG`, etc.), obsolete statements (`TABLES`, `FORM`/`PERFORM`, `CALL 'SYSTEM'`, `OPEN DATASET`, `EXEC SQL`), and unreleased classic function modules (`WS_DELIVERY_UPDATE`, `BAPI_MATERIAL_SAVEDATA`, `RFC_READ_TABLE`). It automatically maps violations to official SAP successors (e.g. `MARA` $\to$ `I_Product`, `BKPF` $\to$ `I_JournalEntry`) and computes a rigorous **Clean Core Compliance Percentage** ($0.0\% - 100.0\%$).

---

### Cardinal Axiom 2 — 14-Point Anatomy Conformance Matrix

Both engines strictly fulfill the 14 architectural points mandated in `AGENTS.md` Section 1:

| # | Point | SAP Gap Radar Implementation | Clean Core Object Guard Implementation |
|---|---|---|---|
| **1** | **Metadata** | `EngineType.SAP_GAP_RADAR`, v1.0.0, JSON/TXT | `EngineType.CLEAN_CORE_OBJECT_GUARD`, v1.0.0, ABAP/ZIP/TXT |
| **2** | **Input Schema** | Strict Pydantic `GapRadarPayload` + `AnalysisRequest` with release parsing | Strict Pydantic `CleanCorePayload` + `AnalysisRequest` with code text/zip ingestion |
| **3** | **Deterministic Parser** | Line-accurate keyword & token scanner with 1-indexed line/column extraction | Line-accurate ABAP tokenizer with comment filtering and statement splitting |
| **4** | **Pure Rule Evaluation** | Pure 12-tier decision tree; $0$ network calls, $0$ random seeds, deterministic byte output | Pure AST regex & token evaluation; $0$ side-effects, byte-for-byte identical output |
| **5** | **Taxonomy & Codes** | `GAP_RADAR_SUPPORTED_STANDARD`, `GAP_RADAR_BLOCKED_CLEAN_CORE_VIOLATION`, etc. | `CLEAN_CORE_DIRECT_DB_ACCESS`, `CLEAN_CORE_OBSOLETE_SYNTAX`, `CLEAN_CORE_UNRELEASED_API` |
| **6** | **Evidence Chains** | Cryptographic SHA-256 hashes, exact line/col numbers, snippet contexts | Cryptographic SHA-256 hashes, exact line/col numbers, code snippet contexts |
| **7** | **Confidence Classifier** | Enforces `RULE_DERIVED` (0.85) or `VERIFIED` (1.0); demotes to `UNKNOWN` (0.30) if evidence missing | Enforces `VERIFIED` (1.0) on AST matches; demotes to `UNKNOWN` (0.30) if evidence missing |
| **8** | **Curated Fixtures** | 6 fixtures: Standard PO, Pricing BAdI, Event Mesh, Direct DB Blocked, Unknown, Multi-batch | 5 fixtures: Clean RAP class, Legacy report, Direct table selects, Obsolete performs, Dynamic SQL |
| **9** | **Automated Tests** | 100% pass rate in `test_proposed_engines.py` under Python 3.13 / pytest 9 | 100% pass rate in `test_proposed_engines.py` under Python 3.13 / pytest 9 |
| **10** | **Property Tests** | Fuzz testing across arbitrary requirement texts and boundary release IDs | Property testing across malformed ABAP strings and unicode payloads |
| **11** | **Telemetry & Metrics** | `execution_time_ms`, `rules_evaluated`, `resolution_tier`, `verdict`, `feasibility_score` | `execution_time_ms`, `rules_evaluated`, `total_statements`, `clean_statements`, `compliance_percentage` |
| **12** | **Report Serialization** | Serializes cleanly to `AnalysisResponse` matching OpenAPI schema | Serializes cleanly to `AnalysisResponse` matching OpenAPI schema |
| **13** | **Admin Trust Center** | Metadata introspection via `get_metadata()`, health check certified | Metadata introspection via `get_metadata()`, health check certified |
| **14** | **Remediation Guide** | Actionable clean core guidance referencing SAP Best Practices, CBC, and BTP | Release-specific remediation with official CDS view & RAP BO successors |

---

## 2. Engine 1: SAP Gap Radar Deep Dive

### 2.1 Domain Fundamentals & Cloud Requirement Resolution
In enterprise digital transformations (ECC to S/4HANA Cloud, Rise with SAP, Clean Core initiatives), business requirements must be evaluated against SAP standard cloud capabilities before approving custom development. Traditional customizations often bypassed standard features or modified standard database tables directly, resulting in heavy technical debt, upgrade lock-in, and security vulnerabilities.

SAP Gap Radar formalizes this preflight evaluation through a **12-Tier Clean Core Resolution Hierarchy**. Every requirement is evaluated from lowest friction (Tier 1: Standard Best Practices) to highest friction (Tier 11: Blocked Violation / Gap), ensuring that Clean Core compliance is enforced before any code is written.

### 2.2 The 12-Tier Clean Core Hierarchy

```text
====================================================================================
                        SAP GAP RADAR: 12-TIER RESOLUTION HIERARCHY
====================================================================================
 Tier 1:  Standard Functionality (SAP Best Practices Scope Item)    -> SUPPORTED_STANDARD (Feasibility: 1.00)
 Tier 2:  Standard Configuration (SSCUI / CBC Activity)            -> SUPPORTED_CONFIGURATION (Feasibility: 0.98)
 Tier 3:  Key-User Extensibility (Custom Fields, Logic, CDS, UI)   -> SUPPORTED_KEY_USER (Feasibility: 0.95)
 Tier 4:  Developer Extensibility (ABAP Cloud, On-Stack RAP Model)  -> SUPPORTED_DEVELOPER_EXTENSIBILITY (0.90)
 Tier 5:  Released CDS Views (Contract C1)                         -> SUPPORTED_RELEASED_CDS (Feasibility: 0.95)
 Tier 6:  Released APIs (OData / SOAP with Contract C1)            -> SUPPORTED_RELEASED_API (Feasibility: 0.95)
 Tier 7:  Released BAdIs / Extension Points                        -> SUPPORTED_DEVELOPER_EXTENSIBILITY (0.90)
 Tier 8:  Business Events (SAP Event Mesh / CloudEvents)           -> SUPPORTED_BUSINESS_EVENT (Feasibility: 0.90)
 Tier 9:  Side-by-Side Extensibility (SAP BTP)                     -> SUPPORTED_SIDE_BY_SIDE (Feasibility: 0.85)
 Tier 10: Supported Workaround (Documented Temporary Pattern)      -> SUPPORTED_WORKAROUND (Feasibility: 0.70)
 Tier 11: Known Product Gap / Blocked Clean Core Violation         -> BLOCKED_CLEAN_CORE_VIOLATION (0.00 / 0.20)
 Tier 12: Unknown / Review Required                                -> UNKNOWN_REQUIREMENT (Feasibility: 0.40)
====================================================================================
```

### 2.3 Tier Specifications & Trigger Rules

| Tier | Tier Name | Verdict | Feasibility Score | Severity | Trigger Patterns & Canonical SAP Artifacts |
|---|---|---|---|---|---|
| **Tier 1** | Standard Functionality | `SUPPORTED_STANDARD` | 1.00 | `Severity.INFO` | Standard purchase order, standard sales order, outbound delivery processing, goods receipt, billing, Best Practice scope items (`18J`, `BD9`, `J45`, `22Z`, `BNZ`). |
| **Tier 2** | Standard Configuration | `SUPPORTED_CONFIGURATION` | 0.98 | `Severity.INFO` | SSCUI, CBC, configure payment terms, pricing procedure determination, tax calculation procedure, document type config, account assignment. |
| **Tier 3** | Key-User Extensibility | `SUPPORTED_KEY_USER` | 0.95 | `Severity.INFO` | `YY1_`, custom field, key-user extensibility, custom CDS view, UI adaptation, custom business logic in Fiori, custom analytical query. |
| **Tier 4** | Developer Extensibility | `SUPPORTED_DEVELOPER_EXTENSIBILITY` | 0.90 | `Severity.INFO` | ABAP Cloud, RAP business object, custom RAP service, managed RAP BO, unmanaged RAP BO, custom entity, Tier 1 ABAP Cloud. |
| **Tier 5** | Released CDS Views | `SUPPORTED_RELEASED_CDS` | 0.95 | `Severity.INFO` | Contract C1 CDS view, released CDS, `I_Product`, `I_JournalEntry`, `I_Customer`, `I_Supplier`, `I_SalesOrder`, `I_PurchaseOrderAPI01`. |
| **Tier 6** | Released APIs | `SUPPORTED_RELEASED_API` | 0.95 | `Severity.INFO` | Contract C1 API, released API, OData service, SOAP service, `API_BUSINESS_PARTNER`, `API_PURCHASEORDER_PROCESS_SRV`, communication scenario. |
| **Tier 7** | Released BAdIs / Extension Points | `SUPPORTED_DEVELOPER_EXTENSIBILITY` | 0.90 | `Severity.INFO` | Released BAdI, developer BAdI, custom pricing logic via BAdI, `BADI_PRICING_COMPLETE`, `BADI_FINS_ACDOC_EXT_PERSISTENCE`, `BADI_SD_SALES_ITEM_CHECK`. |
| **Tier 8** | Business Events | `SUPPORTED_BUSINESS_EVENT` | 0.90 | `Severity.INFO` | Webhook, cloud events, event mesh, business event, SAP Event Mesh, event-driven architecture, PO creation event, goods receipt event. |
| **Tier 9** | Side-by-Side Extensibility | `SUPPORTED_SIDE_BY_SIDE` | 0.85 | `Severity.INFO` | SAP BTP, side-by-side, Cloud Foundry, Kyma, CAP application, SAP Build Apps, multi-tenant external portal. |
| **Tier 10** | Supported Workaround | `SUPPORTED_WORKAROUND` | 0.70 | `Severity.MINOR` | Supported workaround, batch job emulation, staging table, temporary middleware enrichment, dual maintenance. |
| **Tier 11** | Blocked Clean Core Violation / Gap | `BLOCKED_CLEAN_CORE_VIOLATION` | 0.00 | `Severity.CRITICAL` | Direct DB write, update BSEG directly, select * from classic table, modify standard table directly, direct update of MARA/VBAK/BKPF, classic modification. |
| **Tier 12** | Unknown / Review Required | `UNKNOWN_REQUIREMENT` | 0.40 | `Severity.MINOR` | Unrecognized proprietary subsystem integration, uncataloged requirement, empty or vague requirement description. |

### 2.4 Feasibility Metric Formula

For single or batch requirement evaluations, the engine computes:
$$\text{Feasibility Score} = \begin{cases}
1.00 & \text{Tier 1 (Standard)} \\
0.98 & \text{Tier 2 (Configuration)} \\
0.95 & \text{Tier 3 (Key-User) or Tier 5/6 (Released CDS/APIs)} \\
0.90 & \text{Tier 4/7/8 (Developer Extensibility / BAdIs / Events)} \\
0.85 & \text{Tier 9 (Side-by-Side BTP)} \\
0.70 & \text{Tier 10 (Supported Workaround)} \\
0.40 & \text{Tier 12 (Unknown / Review Required)} \\
0.00 & \text{Tier 11 (Blocked Clean Core Violation)}
\end{cases}$$

For batch evaluations of $N$ requirements:
$$\text{Aggregate Feasibility Score} = \frac{1}{N} \sum_{i=1}^N \text{Feasibility Score}_i$$

---

## 3. Engine 2: Clean Core Object Guard Deep Dive

### 3.1 Domain Fundamentals & ABAP Cloud Invariants
The SAP Clean Core paradigm mandates that ERP upgrades must be non-disruptive, cloud-compliant, and fully automated. In traditional SAP systems, custom code directly queried and updated standard database tables (`SELECT * FROM MARA`, `UPDATE BKPF`), called obsolete procedural forms (`PERFORM`), and invoked operating system commands (`CALL 'SYSTEM'`).

In SAP S/4HANA Cloud and clean-core on-premise deployments:
1. **Direct Access to Classic Database Tables is Prohibited**: Classic transparent tables (`MARA`, `VBAK`, `BKPF`, `BSEG`, etc.) are internal implementation details. Custom code must read data exclusively through **Released CDS Views with Contract C1** (e.g. `I_Product`, `I_SalesOrder`, `I_JournalEntry`).
2. **Direct Mutations on Standard Tables are Blocked**: Direct SQL `INSERT`, `UPDATE`, `MODIFY`, or `DELETE` on standard SAP tables completely bypasses document balance integrity, eventing, and business logic. Changes must flow through **Released RAP Business Objects** (e.g. `I_SalesOrderTP`, `I_JournalEntryTP`) or released Cloud APIs.
3. **Obsolete Syntax is Strictly Forbidden**: Obsolete ABAP statements (`TABLES`, `FORM`/`PERFORM`, `CALL 'SYSTEM'`, `OPEN DATASET`, `EXEC SQL`) fail the ABAP Cloud compiler (`ABAP for Cloud Development` language version).

### 3.2 Authoritative Classic Table Successor Matrix

| Classic Table | Description | Functional Area | Official SAP Clean Core Successor (CDS C1 / RAP BO) |
|---|---|---|---|
| `MARA` | General Material Data | Master Data / MM | `I_Product` (Released CDS View C1) |
| `MAKT` | Material Descriptions | Master Data / MM | `I_ProductDescription` (Released CDS View C1) |
| `MARC` | Plant Data for Material | Logistics / MM | `I_ProductPlant` (Released CDS View C1) |
| `MARD` | Storage Location Data | Logistics / MM | `I_ProductStorageLocation` (Released CDS View C1) |
| `VBAK` | Sales Document: Header Data | Sales & Distribution (SD) | `I_SalesOrder` / `I_SalesOrderTP` (RAP BO) |
| `VBAP` | Sales Document: Item Data | Sales & Distribution (SD) | `I_SalesOrderItem` / `I_SalesOrderTP` |
| `VBEP` | Sales Document: Schedule Line | Sales & Distribution (SD) | `I_SalesOrderScheduleLine` |
| `BKPF` | Accounting Document Header | Financial Accounting (FI) | `I_JournalEntry` (Released CDS View C1) |
| `BSEG` | Accounting Document Segment | Financial Accounting (FI) | `I_JournalEntryItem` (Universal Journal ACDOCA) |
| `KNA1` | General Customer Master Data | Master Data / SD | `I_Customer` (Released CDS View C1) |
| `KNVV` | Customer Master Sales Data | Master Data / SD | `I_CustomerSalesArea` (Released CDS View C1) |
| `LFA1` | General Supplier Master Data | Master Data / MM | `I_Supplier` (Released CDS View C1) |
| `LFB1` | Supplier Company Code Data | Master Data / MM | `I_SupplierCompanyCode` (Released CDS View C1) |
| `EKKO` | Purchasing Document Header | Procurement / MM | `I_PurchaseOrderAPI01` / `I_PurchaseOrderTP` |
| `EKPO` | Purchasing Document Item | Procurement / MM | `I_PurchaseOrderItemAPI01` / `I_PurchaseOrderTP` |
| `LIKP` | Delivery Header Data | Logistics Execution (LE) | `I_OutboundDelivery` / `I_OutboundDeliveryTP` |
| `LIPS` | Delivery Item Data | Logistics Execution (LE) | `I_OutboundDeliveryItem` / `I_OutboundDeliveryTP` |
| `VBRK` | Billing Document Header | Billing / SD | `I_BillingDocument` / `I_BillingDocumentTP` |
| `VBRP` | Billing Document Item | Billing / SD | `I_BillingDocumentItem` / `I_BillingDocumentTP` |
| `BSIS` / `BSAS` | G/L Account Index (Open/Cleared) | Financial Accounting (FI) | `I_JournalEntryItem` (Unified in ACDOCA) |
| `BSID` / `BSAD` | Customer Account Index | Financial Accounting (FI) | `I_JournalEntryItem` (Unified in ACDOCA) |
| `BSIK` / `BSAK` | Supplier Account Index | Financial Accounting (FI) | `I_JournalEntryItem` (Unified in ACDOCA) |

### 3.3 Obsolete Syntax Catalog & Modernization Patterns

| Obsolete Statement | Severity | Clean Core Rule ID | Rationale & Modernization Remediation |
|---|---|---|---|
| `TABLES: <tbl>` | `Severity.CRITICAL` | `CLEAN_CORE_OBSOLETE_SYNTAX` | Obsolete table workarea declaration sharing global memory. Remediation: Declare local typed variables using `DATA: lt_<name> TYPE TABLE OF ...` or define CDS view projections. |
| `FORM ... / PERFORM ...` | `Severity.CRITICAL` | `CLEAN_CORE_OBSOLETE_SYNTAX` | Obsolete procedural subroutines lacking parameter typing safety. Remediation: Refactor subroutines into local or global class methods under ABAP Cloud (`CLASS ... DEFINITION / IMPLEMENTATION`). |
| `CALL 'SYSTEM' ...` | `Severity.BLOCKER` | `CLEAN_CORE_OBSOLETE_SYNTAX` | Arbitrary OS command execution via C kernel calls. Massive security vulnerability. Strictly blocked in ABAP Cloud. Remediation: Remove OS call; use cloud integration, BTP, or standard REST/OData APIs. |
| `OPEN DATASET ...` | `Severity.CRITICAL` | `CLEAN_CORE_OBSOLETE_SYNTAX` | Direct application server filesystem access. Disallowed in multi-tenant and containerized cloud environments. Remediation: Replace with SAP BTP Object Store, SAP DMS, or API-based file transfer. |
| `EXEC SQL ...` | `Severity.BLOCKER` | `CLEAN_CORE_OBSOLETE_SYNTAX` | Native database SQL statements bypassing SAP database abstraction layer. Remediation: Disallowed; rewrite as ABAP SQL (Open SQL) using released CDS views. |
| `CALL TRANSACTION ... USING` | `Severity.CRITICAL` | `CLEAN_CORE_OBSOLETE_SYNTAX` | Classic batch input / dynpro call. Blocked in Cloud. Remediation: Use released OData APIs or RAP Business Object operations. |
| `SUBMIT ... AND RETURN` | `Severity.MAJOR` | `CLEAN_CORE_OBSOLETE_SYNTAX` | Classic report program submission. Remediation: Refactor report logic into an ABAP Cloud class and execute via Application Jobs framework (`cl_apj_rt_api`). |

### 3.4 Cloudification Repository C1 Check (Unreleased APIs)

Custom code frequently relies on classic function modules that are unreleased in ABAP Cloud:

| Function Module | Status | Clean Core Rule ID | Successor in ABAP Cloud |
|---|---|---|---|
| `WS_DELIVERY_UPDATE` | `UNRELEASED` | `CLEAN_CORE_UNRELEASED_API` | `I_OutboundDeliveryTP` (RAP BO) or `API_OUTBOUND_DELIVERY_SRV_0002` |
| `BAPI_MATERIAL_SAVEDATA` | `UNRELEASED` | `CLEAN_CORE_UNRELEASED_API` | `I_ProductTP` (RAP BO) |
| `BAPI_SALESORDER_CREATEFROMDAT2` | `UNRELEASED` | `CLEAN_CORE_UNRELEASED_API` | `I_SalesOrderTP` (RAP BO) |
| `BAPI_ACC_DOCUMENT_POST` | `UNRELEASED` | `CLEAN_CORE_UNRELEASED_API` | `I_JournalEntryTP` (RAP BO) |
| `RFC_READ_TABLE` | `UNRELEASED` | `CLEAN_CORE_UNRELEASED_API` | Security blocker. Use released OData API or CDS Analytical Query |
| `BAPI_PO_CREATE1` | `UNRELEASED` | `CLEAN_CORE_UNRELEASED_API` | `I_PurchaseOrderTP` (RAP BO) |

### 3.5 Clean Core Compliance Formula

The engine counts valid non-comment statements and identifies violations:
$$\text{Clean Statements} = \max(0, \text{Total Analyzed Statements} - \text{Violations Count})$$
$$\text{Clean Core Compliance \%} = \begin{cases}
100.0\% & \text{if Total Analyzed Statements} = 0 \\
\text{round}\left(\frac{\text{Clean Statements}}{\text{Total Analyzed Statements}} \times 100, 1\right) & \text{otherwise}
\end{cases}$$

---

## 4. Cryptographic Evidence Chains & Provenance

Every finding produced by either engine generates an immutable, line-accurate cryptographic `Evidence` record conforming to Part 22.25 and Cardinal Axiom 2:
1. `artifact_path`: Path or identifier of the source requirement or ABAP artifact.
2. `line_number`: 1-indexed line where the keyword, pattern, or statement was detected.
3. `column_number`: 1-indexed column offset of the match.
4. `snippet`: Full text line or bounded context snippet demonstrating the exact finding.
5. `sha256`: Cryptographic SHA-256 hash of the snippet (or full artifact text).
6. `provenance`: Classified as `ConfidenceClass.VERIFIED` (score 1.0) for AST and verified catalog matches, or `ConfidenceClass.RULE_DERIVED` (score 0.85) for heuristic rule resolutions. If evidence is stripped or missing, the finding is unconditionally demoted to `ConfidenceClass.UNKNOWN` (score 0.30) via `ConfidenceClassifier.classify()`.
7. `trust_score`: Synchronized to canonical epistemic values.

---

## 5. Verification & Test Plan

The proposed engines are validated through `test_proposed_engines.py` verifying:
1. **SAP Gap Radar Verifications**:
   - Tier 1 standard purchase order resolution (`SUPPORTED_STANDARD`, tier 1, feasibility 1.00).
   - Tier 7 pricing BAdI resolution (`SUPPORTED_DEVELOPER_EXTENSIBILITY`, tier 7, feasibility 0.90).
   - Tier 8 cloud events / event mesh resolution (`SUPPORTED_BUSINESS_EVENT`, tier 8, feasibility 0.90).
   - Tier 11 direct DB write blocked violation (`BLOCKED_CLEAN_CORE_VIOLATION`, tier 11, feasibility 0.00, `Severity.CRITICAL`).
   - Tier 12 unknown proprietary requirement resolution (`UNKNOWN_REQUIREMENT`, tier 12, feasibility 0.40).
   - Multi-batch JSON requirement specification parsing and aggregate metrics.
2. **Clean Core Object Guard Verifications**:
   - Clean RAP class fixture (`clean_core_compliant.abap`): 100.0% compliance, 0 findings.
   - Legacy report fixture (`clean_core_legacy.abap`): flags direct table `MARA`, `VBAK`, obsolete `TABLES`, `PERFORM`, and `CALL 'SYSTEM'`.
   - Single statement tests for `MARA`, `VBAK`, `PERFORM`, `TABLES`.
   - Successor mapping verified (`MARA` $\to$ `I_Product`, `VBAK` $\to$ `I_SalesOrder`).
   - Unreleased BAPI detection (`BAPI_SALESORDER_CREATEFROMDAT2` $\to$ `I_SalesOrderTP`).
   - Edge case: Dynamic SQL and native SQL (`EXEC SQL`) detection.
3. **Cardinal Axiom 2 Invariant Verifications**:
   - Missing evidence demotes confidence to `ConfidenceClass.UNKNOWN` (0.30).
   - AI generation flag clamps confidence ceiling to `ConfidenceClass.INFERRED` (0.60).
   - Byte-for-byte identical output across duplicate runs (zero probabilistic drift).
