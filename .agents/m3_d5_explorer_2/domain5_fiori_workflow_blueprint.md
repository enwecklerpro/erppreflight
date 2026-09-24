# Domain 5 Technical Architecture Blueprint: Fiori 403 & Workflow Stuck

> **Document Identifier**: `domain5_fiori_workflow_blueprint.md`  
> **Author**: `m3_d5_explorer_2`  
> **Target Scope**: Domain 5 (Operations) — Feature 31 (`FIORI_403_ROOT_CAUSE_DOCTOR`) and Feature 32 (`WORKFLOW_STUCK_EXPLAINER`)  
> **Governing Standards**: `AGENTS.md` (Cardinal Axioms 1 & 2), `engine-authoring.md`, `sap-evidence.md`, `secure-file-parser.md`  
> **Target Releases**: SAP S/4HANA (On-Premise 2020–2023, Private Cloud, Cloud Public Edition 2402/2408), SAP ECC 6.0 EhP 7/8  

---

## 1. Executive Summary & Domain Scope

In enterprise SAP environments, operational diagnostic troubleshooting is plagued by fragmentation across decoupled architectural tiers. When business users encounter runtime barriers, two primary failure modes represent the vast majority of urgent tickets:
1. **Fiori / Gateway HTTP 403 Forbidden & Unauthorized Access (Feature 31)**:
   A user attempting to load a Fiori Launchpad tile, execute an analytical query, or save a business document encounters a generic `403 Forbidden` error. Because HTTP 403 can be triggered by missing PFCG authorization objects (`S_SERVICE`, `S_START`, `S_RFC`, functional authorization objects), deactivated ICF service nodes (`SICF`), unassigned Gateway system aliases (`/IWFND/MAINT_SERVICE`), CSRF token invalidation, Unified Connectivity (`UCON`) runtime filters, or SAP Cloud Connector (`SCC`) resource path blocks, security teams frequently spend hours guessing and escalating roles arbitrarily without finding the technical root cause.
2. **SAP Business Workflow & S/4HANA Flexible Workflow Blockages (Feature 32)**:
   Critical operational workflows (purchase orders, payment approvals, journal entries, maintenance orders) halt unexpectedly, stalling financial postings and procurement. Workflows become stuck in `READY` with zero resolved agents due to vacant HR positions, fail silently in background steps due to uncaught runtime exceptions (`CX_*` dumps), dead-end because event linkages (`SWETYPV`) were automatically deactivated after errors, or suffer deadlock awaiting missing terminating events.

This blueprint establishes the authoritative design and deterministic evaluation logic for both engines:
- **Feature 31: Fiori 403 & Authorization Diagnostic Guard (`Fiori403Engine`)**
- **Feature 32: Workflow Stuck & Deadlock Predictor (`WorkflowStuckEngine`)**

Both engines are engineered to satisfy **Cardinal Axiom 2** (the 14 architectural points for preflight engines): pure deterministic rule execution, strictly typed schemas, cryptographic evidence chains, four-tier epistemic confidence classification, and release-aware remediation runbooks.

---

## 2. Cardinal Axiom 2 Compliance Matrix

Every engine implementation must implement all 14 architectural points defined in `AGENTS.md`:

| Point | Architectural Component | Feature 31: Fiori 403 Diagnostic Guard | Feature 32: Workflow Stuck & Deadlock Predictor |
|---|---|---|---|
| **1** | **Metadata** | `engine_type = EngineType.FIORI_403_ROOT_CAUSE_DOCTOR`<br>Version: `2.0.0`<br>Artifacts: `JSON`, `TXT`, `CSV` | `engine_type = EngineType.WORKFLOW_STUCK_EXPLAINER`<br>Version: `2.0.0`<br>Artifacts: `CSV`, `JSON` |
| **2** | **Input Schema** | `Fiori403InputSchema` (Pydantic model) validating HTTP headers, `/IWFND/ERROR_LOG`, SU53, SICF, UCON, Cloud Connector logs. | `WorkflowStuckInputSchema` validating `SWWWIHEAD`, `SWWLOGHIST`, agent resolution traces, `SWETYPV`, and container dumps. |
| **3** | **Deterministic Parser** | Multi-source normalizer handling JSON structures, raw HTTP header dumps, CSV table dumps, and SU53 text exports with line mapping. | Tabular and object normalizer converting `SWWWIHEAD` / `SWWLOGHIST` / `SWETYPV` records into typed domain objects. |
| **4** | **Pure Rule Evaluation** | Pure, deterministic 7-step diagnostic decision tree. Zero network calls, zero RNG, bitwise identical findings for identical inputs. | Deterministic work item state machine, dependency graph traversal, empty agent audit, and deadline computation. |
| **5** | **Standard Taxonomy** | `FIORI_ICF_INACTIVE`, `FIORI_AUTH_OBJECT_MISSING`, `FIORI_CSRF_TOKEN_INVALID`, `FIORI_UCON_DENIED`, etc. | `WF_STUCK_NO_AGENT`, `WF_BACKGROUND_TASK_FAILED`, `WF_EVENT_LINKAGE_DEACTIVATED`, `WF_DEADLOCK_DETECTED`, etc. |
| **6** | **Cryptographic Evidence** | `Evidence` records with artifact path, line/column coordinates, exact snippet, and SHA-256 hash. | `Evidence` records with table source (`SWWWIHEAD#WI_ID`), line numbers, state snippet, and SHA-256 hash. |
| **7** | **Epistemic Confidence** | `VERIFIED` (1.0) on exact SU53/SICF matches; `RULE_DERIVED` (0.85) on Gateway error text; `UNKNOWN` (0.30) on missing traces. | `VERIFIED` (1.0) on explicit `SWWWIHEAD` status & `SWZAI` empty lists; `RULE_DERIVED` (0.85) on deadlocks. |
| **8** | **Curated Test Fixtures** | Positive (clean access), negative (SU53 fail, inactive SICF, CSRF invalid, UCON denied), edge (missing logs). | Positive (completed wf), negative (no agent, background dump, inactive linkage, deadlock), edge (corrupt log). |
| **9** | **Automated Test Suite** | Comprehensive pytest suite verifying all 7 steps, error paths, and telemetry metrics with 100% pass rate. | Comprehensive pytest suite verifying state transitions, dump extraction, agent counts, and SLA breaches. |
| **10** | **Property-Based Testing** | Fuzz input validation proving graceful fail-closed behavior on corrupted headers and invalid JSON. | Property tests verifying stability under malformed work item IDs, negative timestamps, and cyclic dependencies. |
| **11** | **Telemetry & Metrics** | Tracks steps evaluated, root-cause area, duration ms, rules checked, and missing telemetry flags. | Tracks total work items, stuck count, hours stuck, restart candidate flag, and manual forward candidate flag. |
| **12** | **Report Serialization** | Serializes to canonical `AnalysisResponse` / `Finding` wire schema for SaaS UI and PDF audit export. | Serializes to canonical `AnalysisResponse` / `Finding` wire schema with detailed technical debugging metadata. |
| **13** | **Admin Trust Center** | Operational status, rule inventory, and quality score exposed for Admin Trust Center diagnostics. | Operational status, diagnostic rule metrics, and restart safety flags exposed for Admin Trust Center. |
| **14** | **Remediation Runbook** | Release-specific remediation steps referencing SAP transactions (`PFCG`, `SICF`, `/IWFND/MAINT_SERVICE`, `UCONHTTP`, `CERTRULE`). | Specific remediation steps referencing SAP transactions (`SWIA`, `SWI1`, `SWETYPV`, `PPOME`, `PFAC`, `SWWDHEX`). |

---

## 3. Feature 31: Fiori 403 & Authorization Diagnostic Guard

### 3.1 Problem Definition & Failure Topology
When an HTTP 403 occurs in a Fiori landscape, the failure can originate in any of six distinct architectural layers:
```
+-----------------------------------------------------------------------------------+
| 1. Client Browser / Network Layer (Reverse Proxy, Cloud Connector, CSRF Token)    |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| 2. Internet Communication Framework (ICF / SICF Service Tree)                     |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| 3. Unified Connectivity (UCON Ingress Rules & Allowlist)                         |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| 4. SAP Gateway Foundation (/IWFND/ Registry, System Alias & OData Routing)        |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| 5. Technical Authorizations (S_SERVICE, S_START, S_RFC, I_AUTH)                  |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| 6. Functional Business Authorizations (Company Code, Sales Org, Plant, Cost Ctr)  |
+-----------------------------------------------------------------------------------+
```

### 3.2 Deterministic 7-Step Diagnostic Decision Tree

The diagnosis proceeds in strict order of dependency. Higher-level infrastructure checks precede fine-grained functional role audits:

```
[Start Analysis: HTTP Status 403/401]
               │
               ▼
┌────────────────────────────────────────────────────────┐
│ Step 1: Protocol & Status Code Verification            │
│ Check status == 403/401; extract sap-error headers     │
└────────────────────────────────────────────────────────┘
               │
               ├───────────────────────────────────────────────┐
               ▼                                               ▼
┌──────────────────────────────────────────────┐ ┌───────────────────────────────────┐
│ Step 2: CSRF Token Integrity Check           │ │ Method: POST/PUT/DELETE/PATCH     │
│ Is x-csrf-token missing/invalid/expired?     │─│ sap-error-code: CSRF_TOKEN_INVALID│
└──────────────────────────────────────────────┘ └───────────────────────────────────┘
               │ NO                                            │ YES -> FIORI_CSRF_TOKEN_INVALID
               ▼
┌──────────────────────────────────────────────┐
│ Step 3: SICF Service Status Check            │
│ Is ICF node inactive (active: false / 0)?   │─► YES -> FIORI_ICF_INACTIVE
└──────────────────────────────────────────────┘
               │ NO
               ▼
┌──────────────────────────────────────────────┐
│ Step 4: Gateway Service Registration Check   │
│ Is service registered in /IWFND/MAINT_SERVICE│─► YES -> FIORI_GATEWAY_SERVICE_NOT_ACTIVATED
│ and has valid active System Alias?           │
└──────────────────────────────────────────────┘
               │ NO (Service is registered)
               ▼
┌──────────────────────────────────────────────┐
│ Step 5: SU53 / Authorization Trace Check     │
│ Any failed checks (RC=4/12) in SU53 log?     │
│ - Technical: S_SERVICE, S_START, S_RFC       │─► YES -> FIORI_AUTH_OBJECT_MISSING
│ - Functional: V_VBAK_AAT, M_BEST_EKO, etc.   │
└──────────────────────────────────────────────┘
               │ NO (Auth trace clean)
               ▼
┌──────────────────────────────────────────────┐
│ Step 6: UCON Deny Policy Check               │
│ Is service/RFC blocked by UCON allowlist?    │─► YES -> FIORI_UCON_DENIED
└──────────────────────────────────────────────┘
               │ NO
               ▼
┌──────────────────────────────────────────────┐
│ Step 7: Cloud Connector / Principal Prop     │
│ SCC log shows resource path rejected or      │─► YES -> FIORI_CLOUD_CONNECTOR_DENIED
│ certificate mapping failure?                 │
└──────────────────────────────────────────────┘
               │ NO
               ▼
┌──────────────────────────────────────────────┐
│ Gaps / Incomplete Telemetry Check            │
│ If no SU53 or /IWFND logs provided, flag:   │─► FIORI_403_INSUFFICIENT_TELEMETRY
│ missing data checklist (Confidence: UNKNOWN) │
└──────────────────────────────────────────────┘
```

### 3.3 Finding Taxonomy for Feature 31

| Finding Code | Severity | Confidence | Trigger Condition | Primary Remediation Action |
|---|---|---|---|---|
| `FIORI_CSRF_TOKEN_INVALID` | `CRITICAL` | `VERIFIED` | State-modifying request lacking valid `x-csrf-token` or rejected with `CSRF token validation failed`. | Fetch token via `GET` request with `X-CSRF-Token: Fetch` and propagate token + session cookies. |
| `FIORI_ICF_INACTIVE` | `BLOCKER` | `VERIFIED` | Target ICF service path marked inactive in SICF export or HTTP header shows `ICF_INACTIVE`. | Activate ICF node in transaction `SICF` (or report `RSICF_SERVICE_ACTIVATE`). |
| `FIORI_GATEWAY_SERVICE_NOT_ACTIVATED` | `CRITICAL` | `VERIFIED` | OData service missing from `/IWFND/MAINT_SERVICE` or unassigned system alias. | Register service in `/IWFND/MAINT_SERVICE` and assign active backend system alias. |
| `FIORI_AUTH_OBJECT_MISSING` | `CRITICAL` | `VERIFIED` | SU53 trace records `RC=4` or `12` on `S_SERVICE`, `S_START`, `S_RFC`, `I_AUTH`, or business object. | In transaction `PFCG`, add missing auth object and fields to user's assigned role. |
| `FIORI_UCON_DENIED` | `CRITICAL` | `VERIFIED` | Log confirms Unified Connectivity (UCON) runtime policy blocked ingress. | In `UCONHTTP` / `UCONCOCKPIT`, add service to active communication scenario allowlist. |
| `FIORI_CLOUD_CONNECTOR_DENIED` | `CRITICAL` | `VERIFIED` | SAP Cloud Connector rejected resource path or principal propagation failed. | In Cloud Connector console, add resource path with sub-path permission or fix CERTRULE mapping. |
| `FIORI_CATALOG_ROLE_MISSING` | `MAJOR` | `RULE_DERIVED` | User assigned catalog but lacks required backend authorization default. | Synchronize Fiori Catalog authorization defaults in PFCG using transaction `SU24`. |
| `FIORI_403_INSUFFICIENT_TELEMETRY` | `MINOR` | `UNKNOWN` | HTTP 403 reported without SU53 trace or Gateway error log. | Request user export SU53 trace immediately after error and attach `/IWFND/ERROR_LOG`. |

---

## 4. Feature 32: Workflow Stuck & Deadlock Predictor

### 4.1 Problem Definition & Workflow Execution Lifecycle
SAP Business Workflow and S/4HANA Flexible Workflow execute across a hierarchy of work item types:
- `W`: Top-level Workflow instance
- `F`: Dialog work item (approval task waiting for user action in My Inbox / SBWP)
- `B`: Background step (automatic method execution, CDS view evaluation, BAPI call)
- `E`: Event wait step (waits for external business event like `RELEASED` or `CHANGED`)
- `D`: Dialog step with screen processing
- `A`: Sub-workflow branch

State transitions:
```
[CREATING] ──► [READY] ──► [SELECTED] ──► [STARTED] ──► [COMPLETED]
                 │                          │
                 ├─► (0 Agents)             ├─► (Exception / Dump)
                 │     WF_STUCK_NO_AGENT    │     WF_BACKGROUND_TASK_FAILED
                 │                          ▼
                 │                       [ERROR]
                 ▼                          │
             [WAITING]                      ▼
                 │                  [Deadlock / Timeout]
                 ├─► Missing Event ──► WF_DEADLOCK_DETECTED
                 └─► Missed SLA    ──► WF_DEADLINE_BREACHED
```

### 4.2 Deterministic Diagnostic Checks

1. **Check 1: Work Item State Hierarchy & Top-Level Reconstruction**:
   - Parse `SWWWIHEAD` records to build the workflow tree: link child work items (`WI_CHCKWI`) to root workflow headers (`WI_TYPE = 'W'`).
   - Determine overall status: if child item is in `ERROR` or stuck in `READY`, mark the root workflow instance as impacted.
2. **Check 2: Empty Agent Resolution Audit (`WF_STUCK_NO_AGENT`)**:
   - For all dialog work items (`WI_TYPE in ('F', 'D')`) in status `READY` or `CHECKED`:
   - Inspect agent resolution data (`SWZAI` / rule evaluation logs).
   - If resolved agent count == 0 (`agents: []` or count == 0), flag `WF_STUCK_NO_AGENT` (`CRITICAL`, `VERIFIED`).
   - Extract the failing Responsibility Rule ID (e.g., `00000168`, `70000014`), HR Org unit, or BAdI name.
3. **Check 3: Background Task Failure & ABAP Runtime Dumps (`WF_BACKGROUND_TASK_FAILED`)**:
   - For all background work items (`WI_TYPE = 'B'`) or work items in status `ERROR`:
   - Extract exception details from `SWWLOGHIST`: exception class (e.g. `CX_SY_REF_IS_INITIAL`, `CX_FLEX_WORKFLOW_ERROR`), return code (`SY-SUBRC`), message ID (`MSGID`), and message number (`MSGNO`).
   - Flag `WF_BACKGROUND_TASK_FAILED` (`BLOCKER` if workflow blocked, `VERIFIED`).
4. **Check 4: Event Linkage Inactivity Audit (`WF_EVENT_LINKAGE_DEACTIVATED`)**:
   - Inspect event linkage table `SWETYPV` / `SWE2`:
   - If linkage between Business Object (`OBJTYPE`) and Workflow Template (`RECTYPE`) has `ACTIVE == ' '` (false) or was deactivated by error feedback (`FEEDBACK_FLAG = 'DEACT_ON_ERROR'`), flag `WF_EVENT_LINKAGE_DEACTIVATED` (`CRITICAL`, `VERIFIED`).
5. **Check 5: Deadlock & Mutual Event Wait Detection (`WF_DEADLOCK_DETECTED`)**:
   - Detect work items stuck in `WAITING` status awaiting terminating events that cannot occur, or cyclic event dependencies between concurrent parallel branches.
   - Flag `WF_DEADLOCK_DETECTED` (`BLOCKER`, `RULE_DERIVED`).
6. **Check 6: Container Data Binding Verification (`WF_CONTAINER_BINDING_ERROR`)**:
   - Audit container transfer errors between workflow and task containers (missing required container elements, type casting errors).
   - Flag `WF_CONTAINER_BINDING_ERROR` (`CRITICAL`, `VERIFIED`).
7. **Check 7: SLA Deadline Breach & Overdue Analysis (`WF_DEADLINE_BREACHED`)**:
   - Evaluate `SWWDEADL` table and work item duration:
   - If work item creation date/time exceeds configured SLA or remains in `READY` > 48 hours without action, flag `WF_DEADLINE_BREACHED` (`MAJOR`, `VERIFIED`).
8. **Actionability & Safe Recommendations**:
   - Determine whether work item is a candidate for safe restart (`restart_candidate: bool`) or manual forwarding (`manual_forward_candidate: bool`).
   - Strictly uphold safety rule: output diagnostic recommendations; do not auto-modify system state without explicit confirmation.

### 4.3 Finding Taxonomy for Feature 32

| Finding Code | Severity | Confidence | Trigger Condition | Primary Remediation Action |
|---|---|---|---|---|
| `WF_STUCK_NO_AGENT` | `CRITICAL` | `VERIFIED` | Dialog step in `READY` status with zero eligible agents resolved by rule. | Manually forward work item in `SWIA`; update HR position holders in `PPOME` or rule in `PFAC`. |
| `WF_BACKGROUND_TASK_FAILED` | `BLOCKER` | `VERIFIED` | Background step in `ERROR` status with ABAP exception or non-zero return code. | Inspect dump in `ST22`, resolve code or locking issue, restart background step in `SWI1` or `SWIA`. |
| `WF_EVENT_LINKAGE_DEACTIVATED` | `CRITICAL` | `VERIFIED` | Event linkage in `SWETYPV` is deactivated (`ACTIVE = ' '`), blocking workflow starts. | Reactivate linkage in `SWETYPV`; set error behavior to prevent auto-deactivation. |
| `WF_DEADLOCK_DETECTED` | `BLOCKER` | `RULE_DERIVED` | Workflow stuck in `WAITING` awaiting un-fireable event or cyclic dependency. | Trigger terminating event manually in `SWUE` or cancel stuck branch in `SWIA`. |
| `WF_CONTAINER_BINDING_ERROR` | `CRITICAL` | `VERIFIED` | Data binding between workflow container and task container failed or missing variable. | Fix container binding in Workflow Builder (`SWDD`) and verify parameter types. |
| `WF_DEADLINE_BREACHED` | `MAJOR` | `VERIFIED` | Work item exceeded SLA deadline or remained inactive > 48 hours. | Escalate via deadline notification; verify `SWWDHEX` job frequency in `SM37`. |

---

## 5. Input Artifact Formats & Normalization Contracts

### 5.1 Fiori 403 Input Contract (`Fiori403InputSchema`)
Supported inputs:
- Inline JSON payload in `request.raw_content`
- Structured dictionary in `request.configuration`
- File attachments in `request.artifacts`:
  - `http_response.json` or `.txt`: Status code, method, URL, headers, error body.
  - `iwfnd_error_log.json` or `.csv`: Gateway error log records (`CX_IWFND_*`, error texts).
  - `su53_trace.json` or `.txt`: Authorization trace items (user, object, fields, RC).
  - `sicf_export.json` or `.csv`: ICF service paths, active status flag (`ICF_ACTIVE`).
  - `ucon_config.json`: UCON rules and blocked services.
  - `cloud_connector.json`: SCC logs, allowlisted resource paths.

### 5.2 Workflow Stuck Input Contract (`WorkflowStuckInputSchema`)
Supported inputs:
- Inline JSON payload in `request.raw_content`
- Structured dictionary in `request.configuration`
- File attachments in `request.artifacts`:
  - `swwwihead.json` or `.csv`: Work item headers (`WI_ID`, `WI_TYPE`, `WI_STAT`, `WI_CD`, `WI_CT`, `WI_TEXT`, `WI_RH_TASK`, `WI_CHCKWI`).
  - `swwloghist.json` or `.csv`: Step execution log (`WI_ID`, `METHOD`, `RETCODE`, `EXCEPTION`, `MSGID`, `MSGNO`).
  - `agent_trace.json` or `.csv`: Agent resolution records (`WI_ID`, `RULE_ID`, `AGENTS`, `RESOLVED_COUNT`).
  - `swetypv.json` or `.csv`: Event linkage table (`OBJTYPE`, `EVENT`, `RECTYPE`, `ACTIVE`, `FEEDBACK_FLAG`).
  - `container_data.json`: Workflow and task container key-values.
  - `deadlines.json`: Deadline monitoring entries from `SWWDEADL`.

---

## 6. Verification and Fixtures Architecture

To validate both engines under pytest with 100% pass rate:
1. **Curated Golden Fixtures**:
   - `fiori_403_su53_s_service.json`: SU53 failure on `S_SERVICE` with `SRV_NAME='C_SALESORDER_CDS'` and `SRV_TYPE='HT'`.
   - `fiori_403_icf_inactive.json`: ICF path `/sap/opu/odata/sap/C_PURCHASEORDER_CDS` with `ICF_ACTIVE='0'`.
   - `fiori_403_csrf_invalid.json`: POST request with `x-csrf-token: Required` and body `CSRF token validation failed`.
   - `fiori_403_ucon_denied.json`: HTTP 403 with `UCON_HTTP_DENIED` header and log entry.
   - `fiori_403_cloud_connector_denied.json`: Cloud Connector response `Resource not accessible on Cloud Connector`.
   - `fiori_403_gateway_not_registered.json`: Error log with `CX_IWFND_MED_MDL_NOT_FOUND` and missing system alias.
   - `fiori_403_telemetry_gap.json`: Generic 403 HTML page without SU53 or Gateway log (triggers `UNKNOWN`).
   - `wf_stuck_empty_agents.json`: Work item in status `READY` with `AGENTS=[]` from rule `00000168`.
   - `wf_background_dump.json`: Background work item in status `ERROR` with `CX_SY_REF_IS_INITIAL` dump.
   - `wf_event_linkage_inactive.json`: SWETYPV entry for `BUS2012` `CREATED` with `ACTIVE=' '`.
   - `wf_deadlock_detected.json`: Work items in status `WAITING` with mutually dependent unfulfilled event waits.
   - `wf_deadline_breached.json`: Dialog work item in status `READY` created > 72 hours ago without pickup.
   - `wf_container_binding_error.json`: Container binding exception `CX_SWF_EXP_BINDING_ERROR`.
   - `wf_healthy_completed.json`: Fully completed workflow instance with 0 errors.
2. **Quality Gates**:
   - 100% test pass rate under `pytest`.
   - Exact evidence verification: all findings contain non-empty evidence items with valid SHA-256 hashes and line/column numbers.
   - Strict confidence ceiling enforcement: no finding with missing evidence exceeds `UNKNOWN` (0.30).
