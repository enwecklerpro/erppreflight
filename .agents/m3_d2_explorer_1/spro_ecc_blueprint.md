# Production Blueprint: SPRO2Cloud & ECC2Cloud Navigator Preflight Engines

> **Domain**: Domain 2: Migration & Clean Core  
> **Engine 1**: SPRO2Cloud (`services/analysis-python/src/engines/spro2cloud.py` — Feature 22)  
> **Engine 2**: ECC2Cloud Navigator (`services/analysis-python/src/engines/ecc2cloud.py` — Feature 23)  
> **Author**: `m3_d2_explorer_1`  
> **Governing Standards**: Cardinal Axiom 2 (14-Point Engine Anatomy), Part 22.4 Engine Authoring, Part 22.5 SAP Evidence, Part 17 Epistemic Confidence  
> **Target Releases**: SAP S/4HANA Cloud Public Edition (e.g. `S4HC_2408`, `S4HC_2502`), Private Edition, S/4HANA On-Premise (`S4H_2023`)

---

## 1. Executive Architecture Summary

The SPRO2Cloud and ECC2Cloud Navigator engines provide enterprise-grade, defensible preflight analysis for organizations modernizing from classic SAP ECC 6.0 and S/4HANA On-Premise landscapes to SAP S/4HANA Cloud (Public and Private Editions).

In compliance with **Cardinal Axiom 2**, neither engine uses loose LLM prompts or heuristic guesses for primary analysis. Both engines operate as pure deterministic evaluation engines backed by:
1. Hardened, memory-bounded, line-preserving artifact parsers (CSV, JSON, TSV, text).
2. Authoritative knowledge bases linking legacy IMG nodes, configuration tables, T-Codes, RFC/BAPIs, and IDocs to Cloud successors (CBC/SSCUIs, Scope Items, Fiori apps, released Contract C1 APIs, and Event Mesh CloudEvents).
3. Cryptographic evidence chains linking every finding to exact 1-indexed source line numbers, verbatim text snippets, and SHA-256 hashes.
4. Rigorous epistemic confidence classification (`VERIFIED` = 1.0, `RULE_DERIVED` = 0.85, `INFERRED` = 0.60, `UNKNOWN` = 0.30) with automatic demotion to `UNKNOWN` when evidence or verified metadata is absent.
5. Mathematical usage-weighted blocker ranking combining ST03N dialog steps and transaction volumes with architectural risk weights.

---

## 2. Cardinal Axiom 2 Compliance Matrix (14-Point Engine Anatomy)

| # | 14-Point Anatomy Requirement | SPRO2Cloud Implementation | ECC2Cloud Navigator Implementation |
|---|---|---|---|
| **1** | **Metadata** | `engine_type = EngineType.SPRO2CLOUD`, domain="Migration & Clean Core", version="2.0.0", supported formats=[CSV, JSON, TSV, XLSX]. | `engine_type = EngineType.ECC2CLOUD_NAVIGATOR`, domain="Migration & Clean Core", version="2.0.0", supported formats=[CSV, JSON, TSV]. |
| **2** | **Input Schema** | Strict Pydantic models: `SproAnalysisRequest`, `SproConfigItem`, validating activity IDs, table names, target releases, and country codes. | Strict Pydantic models: `EccNavigatorRequest`, `St03nUsageRecord`, `EccInterfaceRecord`, validating T-codes, execution counts, response times. |
| **3** | **Deterministic Parser** | Streaming CSV/JSON parser with 1-indexed line tracking, Unicode normalization, whitespace trimming, and byte-offset extraction. | Streaming CSV/JSON parser with header auto-detection (ST03N, TADIR, Interface), line tracking, and numeric parsing. |
| **4** | **Pure Rule Evaluation** | Pure function mapping $(A, R, K) \to [F_1, \dots, F_n]$ with zero random seeds, zero clocks, and zero network calls. | Deterministic scoring and ranking: $\text{Impact} = \text{executions} \times W$, sorted deterministically by impact, severity, and object ID. |
| **5** | **Finding Codes** | Namespaced codes: `SPRO_MAPPING_EXACT`, `SPRO_MAPPING_PARTIAL`, `SPRO_MAPPING_SCOPE_DEPENDENT`, `SPRO_MAPPING_PROCESS_REDESIGN`, `SPRO_MAPPING_NOT_AVAILABLE`, `SPRO_MAPPING_NEEDS_REVIEW`. | Namespaced codes: `ECC_TCODE_SUCCESSOR_FOUND`, `ECC_TCODE_OBSOLETE_REDESIGN`, `ECC_TCODE_NO_EQUIVALENT_BLOCKER`, `ECC_TCODE_CUSTOM_CODE_REVIEW`, `ECC_BAPI_RFC_MODERNIZATION_FOUND`, `ECC_BAPI_RFC_UNRELEASED_BLOCKER`, `ECC_IDOC_MODERNIZATION_EVENT_MESH`, `ECC_IDOC_UNSUPPORTED_BLOCKER`, `ECC_USAGE_HIGH_RISK_BLOCKER`. |
| **6** | **Cryptographic Evidence** | Every finding attaches `Evidence` with artifact path, line number, column number, verbatim snippet, and SHA-256 hash. | Every finding attaches `Evidence` with artifact path, line number, column number, verbatim snippet, and SHA-256 hash. |
| **7** | **Confidence Classifier** | Enforces `ConfidenceClass.VERIFIED` (1.0), `RULE_DERIVED` (0.85), `UNKNOWN` (0.30). Uncataloged Z-activities demote to `UNKNOWN` (0.30). | Standard catalog matches = `VERIFIED` (1.0), derived rules = `RULE_DERIVED` (0.85), uncataloged Z-objects = `UNKNOWN` (0.30). |
| **8** | **Curated Fixtures** | Positive (`clean_sd_billing.csv`), Negative (`defect_unsupported_special_ledger.csv`), Edge-case (`edge_malformed_empty.csv`, `custom_z_activity.csv`). | Positive (`clean_ecc_standard_usage.csv`), Negative (`defect_ecc_high_risk_blockers.csv`), Edge-case (`edge_ecc_corrupt_headers.csv`, `custom_z_tcodes.csv`). |
| **9** | **Automated Tests** | 100% pytest pass rate covering all classifications, line offsets, hashes, and missing-evidence demotion. | 100% pytest pass rate covering T-code resolution, BAPI/RFC mapping, IDoc migration, and blocker sorting. |
| **10** | **Property-Based Tests** | Fuzzing arbitrary string inputs, special characters, and boundary lengths using Hypothesis / randomized generative tests. | Fuzzing usage counts, negative integers, overflow numbers, and truncated CSV rows. |
| **11** | **Telemetry & Metrics** | Tracks `execution_time_ms`, `rules_evaluated`, `artifacts_scanned`, `exact_mappings`, `partial_mappings`, `readiness_percentage`. | Tracks `total_objects_analyzed`, `tcodes_analyzed`, `interfaces_analyzed`, `total_st03n_executions`, `cloud_ready_percentage`, `clean_core_tiers`. |
| **12** | **Report Serialization** | Serializes seamlessly into `AnalysisResponse` matching OpenAPI contract and NestJS backend wire schema. | Serializes seamlessly into `AnalysisResponse` matching OpenAPI contract and NestJS backend wire schema. |
| **13** | **Admin Visibility** | Exposes catalog versions, supported activity count, and operational readiness for Admin Trust Center diagnostics. | Exposes Fiori mapping catalog version, supported C1 API count, and Event Mesh mappings for Admin Trust Center. |
| **14** | **Remediation Runbook** | Provides release-specific technical remediation actions including exact SSCUI ID, CBC activity name, and required Fiori catalogs. | Provides step-by-step remediation instructions, replacement Fiori App IDs, released OData API contracts, and Clean Core guidance. |

---

## 3. SPRO2Cloud Engine Specification & Knowledge Catalog

### 3.1 Domain & Purpose
Legacy ECC and On-Premise systems configure business logic through the SAP Implementation Guide (IMG / `SPRO`), storing settings in thousands of configuration tables (e.g., `T001`, `TVKO`, `T161`, `T042`). In SAP S/4HANA Cloud Public Edition:
- Classic `SPRO` transactions are inaccessible.
- Configuration is executed via **SAP Central Business Configuration (CBC)** or **Self-Service Configuration UIs (SSCUIs)**.
- Each configuration step is linked to specific **SAP Best Practice Scope Items** (e.g., `BD9`, `1MD`, `J58`) and governed by **Fiori Business Catalogs**.

### 3.2 Classification Taxonomy & Severity Mapping
Each evaluated SPRO node or configuration table is mapped into one of six canonical classifications:

1. **`EXACT`** (`SPRO_MAPPING_EXACT` — Severity: `INFO`, Confidence: `VERIFIED` 1.0):
   - Direct 1:1 functional equivalent exists in S/4HANA Cloud SSCUI / CBC.
   - Example: SPRO `Define Billing Types` (`SIMG_CFMENUOLSDVOFA` / Table `TVFK`) $\to$ SSCUI `101230` ("Configure Billing Document Types"), Scope Item `BD9`.
2. **`PARTIAL`** (`SPRO_MAPPING_PARTIAL` — Severity: `MINOR`, Confidence: `VERIFIED` 1.0):
   - Feature exists in Cloud, but sub-parameters, user exits, or free-form keys are restricted.
   - Example: SPRO `Define Posting Keys` (`SIMG_CFMENUORFBOB08` / Table `TBSL`) $\to$ SSCUI `101523` (Standard posting keys supported; custom posting key definition restricted in Public Cloud).
3. **`SCOPE_DEPENDENT`** (`SPRO_MAPPING_SCOPE_DEPENDENT` — Severity: `MINOR`, Confidence: `VERIFIED` 1.0):
   - Configuration is fully supported, but hidden until a non-baseline Scope Item is explicitly activated in CBC.
   - Example: SPRO `Define Subcontracting Special Stock Settings` $\to$ Requires Best Practice Scope Item `BMD` (Subcontracting).
4. **`PROCESS_REDESIGN`** (`SPRO_MAPPING_PROCESS_REDESIGN` — Severity: `MAJOR`, Confidence: `RULE_DERIVED` 0.85):
   - Legacy IMG configuration paradigm is obsolete and replaced by cloud-native design (e.g., BRFplus OPD, Flexible Workflow, FSCM Credit Management).
   - Example: SPRO `NACE` Output Determination $\to$ Replaced by S/4HANA Output Parameter Determination (OPD).
   - Example: SPRO `Define Release Strategies for Purchase Orders` (`OMSK`) $\to$ Replaced by Flexible Workflow for Purchase Orders (`SSCUI 101948`).
5. **`NOT_AVAILABLE`** (`SPRO_MAPPING_NOT_AVAILABLE` — Severity: `CRITICAL` or `BLOCKER`, Confidence: `VERIFIED` 1.0):
   - Feature deliberately excluded or prohibited in Public Cloud.
   - Example: SPRO `Special Ledger FI-SL` (`SIMG_CFMENUORFBFISL` / Table `GLT0`) $\to$ Excluded; replaced by Universal Journal `ACDOCA`.
6. **`NEEDS_REVIEW`** (`SPRO_MAPPING_NEEDS_REVIEW` — Severity: `MAJOR`, Confidence: `UNKNOWN` 0.30):
   - Custom customer configuration table (`Z*`, `Y*`) or unindexed IMG activity. Requires manual Clean Core architectural review.

### 3.3 Authoritative Reference Catalog (Sample Extract)

| Legacy SPRO / Table | Module | Classification | SSCUI ID | CBC Activity Name | Scope Item | Fiori Business Catalog | Country |
|---|---|---|---|---|---|---|---|
| `SIMG_CFMENUOLSDVOFA` (`TVFK`) | SD | EXACT | `101230` | Configure Billing Document Types | `BD9` | `SAP_CA_BC_IC_LND_SD_PC` | All |
| `SIMG_CFMENUOLSDVOV8` (`TVAK`) | SD | EXACT | `102434` | Configure Sales Document Types | `BD9` | `SAP_CA_BC_IC_LND_SD_PC` | All |
| `SIMG_CFMENUOLSDOVZ0` (`TVPT`) | SD | EXACT | `102435` | Define Item Categories | `BD9` | `SAP_CA_BC_IC_LND_SD_PC` | All |
| `SIMG_CFMENUOLSDVKOA` (`T685A`) | SD | SCOPE_DEPENDENT | `100297` | Automatic Account Determination | `BD9`, `1MD` | `SAP_CA_BC_IC_LND_FIN_PC` | All |
| `SIMG_CFMENUOLSDVOFM` | SD | PROCESS_REDESIGN | N/A | Cloud BAdI Pricing & Requirements | `BD9` | `SAP_CORE_BC_EXT` | All |
| `SIMG_CFMENUOLSDNACE` | SD | PROCESS_REDESIGN | `102261` | Output Parameter Determination (OPD) | `1LQ` | `SAP_CA_BC_OC_PC` | All |
| `SIMG_CFMENUOLSDCRED` | SD | PROCESS_REDESIGN | `102144` | Define Credit Control Areas (FSCM) | `BD6` | `SAP_CA_BC_IC_LND_FIN_PC` | All |
| `SIMG_CFMENUOLMEOMH5` (`T161`) | MM | EXACT | `101097` | Define Document Types for Purchase Orders | `1MD` | `SAP_CA_BC_IC_LND_MM_PC` | All |
| `SIMG_CFMENUOLMEOME9` (`T163K`) | MM | EXACT | `102636` | Define Account Assignment Categories | `1MD` | `SAP_CA_BC_IC_LND_MM_PC` | All |
| `SIMG_CFMENUOLMEOMBA` (`T161B`) | MM | EXACT | `101096` | Define Document Types for Requisitions | `1MD` | `SAP_CA_BC_IC_LND_MM_PC` | All |
| `SIMG_CFMENUOLMEOMSK` | MM | PROCESS_REDESIGN | `101948` | Manage Workflows for Purchase Orders | `1MD` | `SAP_CA_BC_IC_LND_MM_PC` | All |
| `SIMG_CFMENUOLMEOBYC` (`T030`) | MM | EXACT | `100297` | Configure Automatic Postings (MM) | `1MD` | `SAP_CA_BC_IC_LND_FIN_PC` | All |
| `SIMG_CFMENUORFBOBA7` (`T003`) | FI | EXACT | `101522` | Define Document Types (FI) | `J58` | `SAP_CA_BC_IC_LND_FIN_PC` | All |
| `SIMG_CFMENUORFBOB08` (`TBSL`) | FI | PARTIAL | `101523` | Define Posting Keys | `J58` | `SAP_CA_BC_IC_LND_FIN_PC` | All |
| `SIMG_CFMENUORFBOB41` (`T004F`) | FI | EXACT | `101524` | Maintain Field Status Variants | `J58` | `SAP_CA_BC_IC_LND_FIN_PC` | All |
| `SIMG_CFMENUORFBOB52` (`T001B`) | FI | EXACT | `101526` | Manage Posting Periods (`F2012`) | `J58` | `SAP_CA_BC_IC_LND_FIN_PC` | All |
| `SIMG_CFMENUORFBFISL` (`GLT0`) | FI | NOT_AVAILABLE | N/A | Excluded: Universal Journal `ACDOCA` | N/A | N/A | None |
| `V_T001W` (`T001W`) | MM | EXACT | `100067` | Define Plant | `1MD` | `SAP_CA_BC_IC_LND_ORG_PC` | All |
| `TVKO` (`TVKO`) | SD | EXACT | `100068` | Define Sales Organization | `BD9` | `SAP_CA_BC_IC_LND_ORG_PC` | All |
| `T001` (`T001`) | FI | EXACT | `100066` | Define Company Code | `J58` | `SAP_CA_BC_IC_LND_ORG_PC` | All |

---

## 4. ECC2Cloud Navigator Engine Specification & Roadmap Methodology

### 4.1 Domain & Purpose
The ECC2Cloud Navigator processes comprehensive legacy usage statistics (ST03N / workload monitor), custom object catalogs (TADIR), and interface inventories to establish an actionable, usage-weighted transition roadmap to S/4HANA Cloud.

### 4.2 Tri-Pillar Modernization Scope
1. **Transaction Codes (T-Codes)**:
   - Resolves legacy SAP GUI transactions to successor SAP Fiori applications from the official Fiori Apps Reference Library.
   - Detects obsolete dynpro transactions requiring process redesign (e.g. `XD01`/`XK01` $\to$ Business Partner `F0850A`).
   - Flags prohibited developer/admin transactions (`SE38`, `SM30`, `SE16N`, `SE80`).
   - Analyzes custom `Z*`/`Y*` transactions under Clean Core principles (`TIER_3_CLASSIC` vs `TIER_2_DEVELOPER`).
2. **Interface Modernization (RFC / BAPI)**:
   - Maps classic BAPIs and RFCs to released Contract C1 APIs (OData / SOAP).
   - Flags unreleased classic RFCs and prohibited direct table read utilities (e.g. `RFC_READ_TABLE`, `ABAP4_CALL_TRANSACTION`).
3. **IDocs & Messaging Modernization**:
   - Maps standard IDocs (`ORDERS05`, `INVOIC02`, `DEBMAS06`, `MATMAS05`) to SAP Event Mesh CloudEvents and modern asynchronous SOAP APIs.
   - Flags custom IDoc extensions requiring SAP Cloud Integration (CI/CPI) pipelines.

### 4.3 Mathematical Usage-Weighted Blocker Ranking
In enterprise migrations, prioritizing hundreds of migration gaps by technical severity alone results in wasted effort on dead, rarely used legacy programs. ECC2Cloud Navigator weights blockers by actual historical usage extracted from ST03N dialog logs:

$$\text{CriticalityWeight}(C) = \begin{cases}
1.00 & \text{if } C = \text{NO\_EQUIVALENT} \text{ (Prohibited / Hard Blocker)} \\
0.70 & \text{if } C = \text{PROCESS\_REDESIGN} \text{ (Workflow Transformation Needed)} \\
0.50 & \text{if } C = \text{EXTENSION\_REQUIRED} \text{ (Clean Core Custom Code)} \\
0.20 & \text{if } C = \text{SUCCESSOR\_AVAILABLE} \text{ (Standard Fiori / C1 API Ready)} \\
0.05 & \text{if } C = \text{DIRECTLY\_SUPPORTED} \text{ (Zero Effort)}
\end{cases}$$

$$\text{UsageImpactScore} = \text{ST03N\_Executions} \times \text{CriticalityWeight}(C)$$

#### Dynamic Severity Assignment Based on Usage Impact
- If $C = \text{NO\_EQUIVALENT}$:
  - If $\text{ST03N\_Executions} \ge 10,000 \implies \text{Severity} = \text{BLOCKER}$
  - Else $\implies \text{Severity} = \text{CRITICAL}$
- If $C = \text{PROCESS\_REDESIGN}$:
  - If $\text{ST03N\_Executions} \ge 50,000 \implies \text{Severity} = \text{CRITICAL}$
  - Else $\implies \text{Severity} = \text{MAJOR}$
- If $C = \text{EXTENSION\_REQUIRED}$:
  - If $\text{ST03N\_Executions} \ge 25,000 \implies \text{Severity} = \text{MAJOR}$
  - Else $\implies \text{Severity} = \text{MINOR}$
- If $C \in \{\text{SUCCESSOR\_AVAILABLE}, \text{DIRECTLY\_SUPPORTED}\} \implies \text{Severity} = \text{INFO}$

Findings are sorted deterministically:
1. `UsageImpactScore` descending.
2. `Severity` rank (`BLOCKER` > `CRITICAL` > `MAJOR` > `MINOR` > `INFO`).
3. Object name alphabetically.

### 4.4 Authoritative T-Code, BAPI & IDoc Successor Matrix

#### A. Transaction Codes (T-Codes)
| ECC T-Code | Successor Fiori App / Concept | Fiori App ID | Modernization Status | Clean Core Tier | Description |
|---|---|---|---|---|---|
| `VA01` | Create Sales Orders | `F1814` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Standard Fiori app for sales order creation |
| `VA02` | Manage Sales Orders | `F3893` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Standard Fiori app for sales order modification |
| `VA03` | Manage Sales Orders | `F3893` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Standard Fiori app for sales order display |
| `ME21N` | Manage Purchase Orders | `F0842A` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Standard Fiori app for purchase orders |
| `ME22N` | Manage Purchase Orders | `F0842A` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Standard Fiori app for PO change |
| `FB01` / `FB50` | Manage G/L Account Documents | `F0718` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Fiori G/L journal entry processing |
| `FB60` | Create Supplier Invoices | `F0859` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Fiori invoice entry |
| `FB70` | Create Customer Invoices | `F0717` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Fiori customer billing entry |
| `XD01` / `XK01` | Manage Business Partner | `F0850A` | PROCESS_REDESIGN | TIER_1_CLOUD | Obsolete customer/vendor transactions replaced by BP |
| `MM01` / `MM02` | Manage Product Master Data | `F1602` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Fiori material master management |
| `VL01N` / `VL02N` | Manage Outbound Deliveries | `F2587` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Fiori outbound delivery execution |
| `MIGO` | Post Goods Receipt / Manage Stock | `F1077` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Fiori inventory management |
| `MIRO` | Create Supplier Invoices | `F0859` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD | Fiori invoice verification |
| `SE38` / `SE80` | Prohibited in Public Cloud | N/A | NO_EQUIVALENT | TIER_3_CLASSIC | Classic ABAP workbench prohibited; use ADT |
| `SE16` / `SE16N` | Prohibited in Public Cloud | N/A | NO_EQUIVALENT | TIER_3_CLASSIC | Direct DB browser prohibited; use CDS Views |
| `SM30` | Prohibited in Public Cloud | N/A | NO_EQUIVALENT | TIER_3_CLASSIC | Direct table maintenance prohibited; use Custom BOs |
| `NACE` | Output Parameter Determination | `F1481` | PROCESS_REDESIGN | TIER_1_CLOUD | Classic NAST replaced by BRFplus OPD |

#### B. Interfaces: RFC / BAPI Modernization
| Legacy BAPI / RFC | Successor Interface | Type | Released C1 Contract | Clean Core Tier | Remediation Note |
|---|---|---|---|---|---|
| `BAPI_SALESORDER_CREATEFROMDAT2` | `API_SALES_ORDER_SRV` (`A_SalesOrder`) | OData v2/v4 | Yes (C1) | TIER_1_CLOUD | Direct drop-in OData service |
| `BAPI_PO_CREATE1` | `API_PURCHASEORDER_PROCESS_SRV` | OData v2/v4 | Yes (C1) | TIER_1_CLOUD | Released procurement service |
| `BAPI_MATERIAL_SAVEDATA` | `API_PRODUCT_SRV` (`A_Product`) | OData v2/v4 | Yes (C1) | TIER_1_CLOUD | Released product master service |
| `BAPI_INCOMINGINVOICE_CREATE` | `API_SUPPLIERINVOICE_PROCESS_SRV` | OData v2/v4 | Yes (C1) | TIER_1_CLOUD | Released supplier invoice service |
| `BAPI_OUTBOUNDDELIVERY_CREATENOREF`| `API_OUTBOUND_DELIVERY_SRV` | OData v2/v4 | Yes (C1) | TIER_1_CLOUD | Released delivery service |
| `RFC_READ_TABLE` | CDS Views via OData / SQL Service | Prohibited | No | TIER_3_CLASSIC | Hard migration blocker; direct DB reads blocked |
| `ABAP4_CALL_TRANSACTION` | Cloud OData / Business APIs | Prohibited | No | TIER_3_CLASSIC | Dynpro batch input blocked in Public Cloud |

#### C. Interfaces: IDoc Modernization
| Legacy IDoc Type | Event Mesh CloudEvent Topic | Cloud SOAP Service | Modernization Status | Clean Core Tier |
|---|---|---|---|---|
| `ORDERS05` | `sap.s4.beh.salesorder.v1.SalesOrder.Created.v1` | `OrderRequest_In` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD |
| `INVOIC02` | `sap.s4.beh.billingdocument.v1.BillingDocument.Created.v1` | `InvoiceRequest_In` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD |
| `DESADV01` | `sap.s4.beh.outbounddelivery.v1.OutboundDelivery.Created.v1`| `DeliveryRequest_In` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD |
| `DEBMAS06` | `sap.s4.beh.businesspartner.v1.BusinessPartner.Created.v1` | `BusinessPartnerSUITEBulkReplicationRequest_In` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD |
| `CREMAS05` | `sap.s4.beh.businesspartner.v1.BusinessPartner.Created.v1` | `BusinessPartnerSUITEBulkReplicationRequest_In` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD |
| `MATMAS05` | `sap.s4.beh.product.v1.Product.Created.v1` | `ProductMasterBulkReplicationRequest_In` | SUCCESSOR_AVAILABLE | TIER_1_CLOUD |

---

## 5. Epistemic Confidence & Cryptographic Grounding

Both engines adhere to strict provenance rules:
1. **`VERIFIED` (1.00)**: Assigned when an IMG activity, table, T-Code, BAPI, or IDoc matches an official published SAP catalog mapping. Evidence snippet is cryptographically verified against input bytes.
2. **`RULE_DERIVED` (0.85)**: Assigned when a finding is produced by deterministic logic rules (e.g. usage-weighted prioritization thresholds, architectural redesign recommendations).
3. **`INFERRED` (0.60)**: Assigned only if heuristic correlation or AI assistance was utilized. Capped at 0.60.
4. **`UNKNOWN` (0.30)**:
   - **Mandatory Demotion Invariant**: If input evidence is missing, snippet is empty, or SHA-256 cannot be generated, finding confidence MUST be unconditionally demoted to `UNKNOWN` with confidence score `0.30`.
   - **Uncataloged Custom Objects**: Custom Z-activities or custom Z-transactions without customer-provided documentation are classified as `UNKNOWN` (score `0.30`).

---

## 6. Implementation Architecture

The production implementation consists of:
- `services/analysis-python/src/engines/spro2cloud.py`: The drop-in SPRO2Cloud engine implementing `BaseEngine`.
- `services/analysis-python/src/engines/ecc2cloud.py`: The drop-in ECC2Cloud Navigator engine implementing `BaseEngine`.
- Dedicated parsers with 1-indexed line coordinate capture.
- Embedded knowledge dictionaries indexed for $O(1)$ lookups.
- Deterministic finding builders with exact SHA-256 evidence generation.
