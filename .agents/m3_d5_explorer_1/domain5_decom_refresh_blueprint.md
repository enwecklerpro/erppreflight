# Domain 5 Blueprint: Safe Decommission & System Refresh Engines

> **Document Identifier**: `domain5_decom_refresh_blueprint.md`  
> **Author**: `m3_d5_explorer_1` (Teamwork Explorer — Domain 5 Operations)  
> **Scope**: Feature 30 (`Safe Decommission & Archiving Readiness Engine`) & Feature 35 (`System Refresh & Data Masking Sanity Guard`)  
> **Applicable Engines**: `SAFE_DECOMMISSION_PREFLIGHT`, `SYSTEM_REFRESH_DELTA_GUARD`  
> **Authority**: Binding architectural specification under `AGENTS.md` and Cardinal Axioms 1 & 2.

---

## 1. Executive Summary & Monorepo Architectural Context

Domain 5 of the ERP Preflight analysis platform addresses **Operations, Governance, and Landscape Integrity**. Within Domain 5, two mission-critical preflight engines safeguard enterprise SAP landscapes from catastrophic operational outages and security breaches:

1. **Feature 30: Safe Decommission & Archiving Readiness Engine (`SAFE_DECOMMISSION_PREFLIGHT`)**:
   - Eliminates unplanned production downtime when offboarding employees, technical users, batch runners, RFC service accounts, and obsolete integration endpoints.
   - Cross-correlates multi-table SAP artifacts (`USR02`, `TBTCO/TBTCP`, `RFCDES`, `SWWWIHEAD`, and `SM20/ST03N`) to compute an objective **Decommission Risk Score (0.0–10.0)**, isolate blocking dependencies, and generate an automated **Reassignment Action Checklist**.

2. **Feature 35: System Refresh & Data Masking Sanity Guard (`SYSTEM_REFRESH_DELTA_GUARD`)**:
   - Compares system-specific configurations before and after an SAP system refresh/homogeneous system copy (e.g., `PRD` $\rightarrow$ `QAS` or `PRD` $\rightarrow$ `DEV`).
   - Detects hazardous production target leakage: RFC destinations pointing to production IPs/hostnames, active `SCOT` outbound email routing sending test emails to real customers/vendors, unconverted logical systems (`T000`/`BD54`), uncancelled production payment/EDI batch jobs (`TBTCO`), and active physical production network printers (`SPAD`).
   - Computes an objective **Isolation Risk Score (0.0–10.0)** and generates an automated **Remediation Action Checklist** prior to un-freezing the refreshed system.

Both engines strictly adhere to **Cardinal Axiom 2 (14-Point Engine Anatomy)**, produce bitwise-reproducible findings, attach cryptographic SHA-256 evidence items, and enforce epistemic confidence classifications (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`).

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               ERP Preflight Domain 5 Operations                         │
└────────────────────────────────────┬────────────────────────────────────────────────────┘
                                     │
          ┌──────────────────────────┴──────────────────────────┐
          ▼                                                     ▼
┌───────────────────────────────────┐                 ┌───────────────────────────────────┐
│ Feature 30: Safe Decommission     │                 │ Feature 35: System Refresh Guard  │
│ Engine: SAFE_DECOMMISSION_PREFLIGHT│                 │ Engine: SYSTEM_REFRESH_DELTA_GUARD│
├───────────────────────────────────┤                 ├───────────────────────────────────┤
│ Artifacts:                        │                 │ Artifacts:                        │
│ • USR02 (User Master & Locks)     │                 │ • Pre-Refresh Baseline Snapshot   │
│ • TBTCO/TBTCP (Background Jobs)   │                 │ • Post-Refresh Target Snapshot    │
│ • RFCDES (RFC Logon Credentials)  │                 │ • Isolation Policy Rules          │
│ • SWWWIHEAD (Pending Work Items)  │                 │ Components Compared:              │
│ • SM20/ST03N (Usage & Logs)       │                 │ • RFCDES (Hosts/IPs/Gateways)     │
├───────────────────────────────────┤                 │ • SCOT (SMTP & Domain Routing)    │
│ Analysis:                         │                 │ • BD54 / T000 (Logical Systems)   │
│ • Job & Step Ownership Tracing    │                 │ • TBTCO (Sensitive Batch Jobs)    │
│ • RFC Logon Integration Impact    │                 │ • SPAD (Production Spool Routing) │
│ • Workflow Approver Deadlocks     │                 ├───────────────────────────────────┤
│ • Lock-vs-Call Traffic Floods     │                 │ Analysis:                         │
├───────────────────────────────────┤                 │ • Prod RFC Target Detection       │
│ Output:                           │                 │ • Email Outbound Leakage Check    │
│ • Decommission Risk Score (0-10)  │                 │ • Unadjusted Logical System Check │
│ • Blocking Finding Taxonomy       │                 │ • Production Payment Job Defense  │
│ • Reassignment Action Checklist   │                 ├───────────────────────────────────┤
└───────────────────────────────────┘                 │ Output:                           │
                                                      │ • Isolation Risk Score (0-10)     │
                                                      │ • Landscape Hazard Finding Matrix │
                                                      │ • Post-Refresh Remediation Runbook│
                                                      └───────────────────────────────────┘
```

---

## 2. 14-Point Engine Anatomy Compliance Matrix

Every engine implemented under Domain 5 satisfies all 14 points defined in `AGENTS.md` and `.agents/skills/engine-authoring.md`:

| Point | Anatomy Component | Feature 30: Safe Decommission Engine | Feature 35: System Refresh Guard |
|---|---|---|---|
| **1** | **Metadata** | `EngineType.SAFE_DECOMMISSION_PREFLIGHT`, name, version `2.0.0`, supported releases `S4H_2023`, `S4HC_2402`, etc., JSON/CSV/TXT artifacts. | `EngineType.SYSTEM_REFRESH_DELTA_GUARD`, name, version `2.0.0`, supported releases `S4H_2023`, `ECC_600`, etc., JSON/CSV/TXT artifacts. |
| **2** | **Input Schema** | Strict Pydantic models (`USR02Entry`, `TBTCOEntry`, `RFCDESEntry`, `SWWWIHEADEntry`, `AuditLogEntry`, `DecommissionNormalizedData`). | Strict Pydantic models (`RFCDestConfig`, `SCOTConfig`, `LogicalSystemConfig`, `JobSanitizationConfig`, `PrinterConfig`, `IsolationPolicy`). |
| **3** | **Parser / Normalizer** | Ingests JSON (consolidated or multi-file), multi-artifact payloads (`request.artifacts`), and tagged CSV formats with line/column offset resolution. | Ingests pre/post refresh configuration exports in JSON, CSV diffs, and isolation policies with line/column offset resolution. |
| **4** | **Deterministic Analysis** | Pure set-theoretic and relational evaluations. Zero network I/O, zero random seed drift. Identical inputs yield bitwise identical findings. | Pure differential comparison against isolation policy patterns and baseline targets. Zero network calls, 100% deterministic. |
| **5** | **Finding Taxonomy** | Namespaced codes: `DECOM_SCHEDULED_JOB_DEPENDENCY`, `DECOM_ACTIVE_RFC_DEPENDENCY`, `DECOM_WORKFLOW_AGENT_DEPENDENCY`, `DECOM_RECENT_ACTIVITY_DETECTED`, `DECOM_LOCKED_USER_CALL_FLOOD`, `DECOM_USER_NOT_FOUND`, `DECOM_SAFE_FOR_ARCHIVING`. | Namespaced codes: `REFRESH_RFC_TARGETS_PRODUCTION`, `REFRESH_SCOT_OUTBOUND_ACTIVE`, `REFRESH_LOGICAL_SYSTEM_UNADJUSTED`, `REFRESH_CRITICAL_JOB_SCHEDULED`, `REFRESH_PRODUCTION_PRINTER_ACTIVE`, `REFRESH_INPUT_SID_MISMATCH`, `REFRESH_ISOLATION_VERIFIED`. |
| **6** | **Evidence Items** | Concrete `Evidence` objects with artifact path, line/column coordinates, exact snippet, and cryptographic SHA-256 hash. | Concrete `Evidence` objects with artifact path, line/column coordinates, exact configuration snippet, and SHA-256 hash. |
| **7** | **Confidence Classifier** | Enforces 4 classes (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`). Absence of evidence demotes to `UNKNOWN` (0.30). | Enforces 4 classes (`VERIFIED` for exact config comparison, `RULE_DERIVED` for pattern matching, `UNKNOWN` on missing data). |
| **8** | **Fixtures** | Triple: `decom_job_owner.json` (negative), `decom_safe.json` (positive), `decom_malformed.json` (edge-case). | Triple: `refresh_rfc_pointing_to_prod.json` (negative), `refresh_clean_isolated.json` (positive), `refresh_malformed.json` (edge-case). |
| **9** | **Automated Tests** | Pytest unit suite testing all rule triggers, score boundaries, line extraction, and checklist generation (100% pass rate). | Pytest unit suite testing RFC target detection, SCOT email hazard, BDLS unadjusted, and isolation verification. |
| **10** | **Property-Based Tests** | Fuzzing of user names, job names, and RFC names via parameterized/Hypothesis boundary checks proving fail-closed safety. | Fuzzing of IP addresses, hostnames, and domain patterns verifying regex evaluation stability. |
| **11** | **Metrics & Telemetry** | Execution duration, rules evaluated, active jobs count, active RFC count, pending work items count, days since last active, Decommission Risk Score. | Execution duration, rules evaluated, total settings compared, identical count, safe deltas count, hazardous deltas count, Isolation Risk Score. |
| **12** | **Report Integration** | Findings serializable to `AnalysisResponse` / `Finding` models for storage in PostgreSQL and presentation in Next.js web UI. | Findings serializable to `AnalysisResponse` / `Finding` models for storage in PostgreSQL and presentation in Next.js web UI. |
| **13** | **Admin Trust Center** | Operational status, rules evaluated, and quality scores exposed via standard engine registry endpoints. | Operational status, rules evaluated, and quality scores exposed via standard engine registry endpoints. |
| **14** | **Remediation Runbook** | Detailed technical remediation steps for SM36/SM37, SM59, SWIA/SBWP, and SU01. | Detailed technical remediation steps for BDLS, SM59, SCOT, and BTCTRNS1. |

---

## 3. Feature 30: Safe Decommission & Archiving Readiness Engine

### 3.1 Problem Space & Operational Hazards
When an employee departs or a technical system account is targeted for retirement, administrators in SAP landscapes face severe operational uncertainty:
- **Batch Outages**: If the user is the execution user (`AUTHNAME`) or scheduler (`SDLUNAME`) of periodic billing or payroll jobs, locking the account results in `JOB_NOT_AUTHORIZED` failures.
- **Integration Collapse**: If external middleware (e.g., SAP PI/PO, CPI, MuleSoft, Boomi) uses the technical account for RFC or BAPI execution, locking the user cuts off data exchange.
- **Workflow Deadlock**: If the user is the sole assigned agent or current approver for active purchase orders or travel requests, business approvals freeze indefinitely.
- **Syslog Flood**: If an external system repeatedly attempts to authenticate with a locked user account every 30 seconds, security audit logs and system logs flood, degrading performance.

### 3.2 Ingestion Architecture & Artifact Normalization
The engine accepts either a consolidated JSON payload, a multi-artifact list (`request.artifacts`), or CSV table exports.

#### 1. Table `USR02` (User Master Record)
- **Primary Fields**: `MANDT`, `BNAME` (Username), `GLTGV` (Valid From), `GLTGB` (Valid To), `USTYP` (User Type: `A` Dialog, `B` System, `C` Communication, `S` Service, `X` Reference), `CLASS` (User Group), `UFLAG` (Lock Status: `0` unlocked, `64` admin locked, `128` password lock), `TRDAT` (Last Logon Date), `LTIME` (Last Logon Time).

#### 2. Table `TBTCO` / `TBTCP` (Background Job Header & Step)
- **Primary Fields**: `JOBNAME`, `JOBCOUNT`, `SDLUNAME` (Scheduled By), `AUTHNAME` (Execution User), `STATUS` (`P` Scheduled, `S` Released, `R` Running, `Y` Ready, `F` Finished, `A` Aborted), `PERIODIC` (`X` Periodic), `PRDMINS`, `PRDHOURS`, `PRDDAYS`, `PROGNAME` (ABAP Program).

#### 3. Table `RFCDES` (RFC Destinations)
- **Primary Fields**: `RFCDEST` (Destination Name), `RFCTYPE` (`3` ABAP, `T` TCP/IP, `H` HTTP, `G` External HTTP), `RFCUSER` / `USERNAME` (Logon User), `RFCHOST` (Target Host), `RFCSYSID` (Target System ID), `RFCCLIENT` (Target Client).

#### 4. Table `SWWWIHEAD` (Workflow Work Items)
- **Primary Fields**: `WI_ID` (Work Item ID), `WI_TYPE` (`W` Dialog Task, `F` Workflow, `B` Background Step), `WI_STAT` (`READY`, `SELECTED`, `STARTED`, `COMMITTED`, `COMPLETED`, `ERROR`, `CANCELLED`), `WI_AAGENT` (Actual Agent), `WI_CD` (Creation Date), `WI_TEXT` (Work Item Description).

#### 5. Logs `SM20` / `ST03N` (Security Audit Log & Usage Statistics)
- **Primary Fields**: `BNAME`, `TCODE` (Transaction Code), `REPORT` (Report Name), `TIMESTAMP`, `ENTRY_DATE`, `CALL_COUNT`.

### 3.3 Rule Engine & Standard Finding Codes

```
                    ┌────────────────────────────┐
                    │    Target User Provided    │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │ Check USR02 Master Record  │
                    └─────────────┬──────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         │ Found                                           │ Not Found
         ▼                                                 ▼
┌──────────────────┐                              ┌─────────────────────────────┐
│ Evaluate Active  │                              │ DECOM_USER_NOT_FOUND        │
│ Dependencies     │                              │ Severity: CRITICAL          │
└────────┬─────────┘                              └─────────────────────────────┘
         │
         ├───► TBTCO (Jobs where user is AUTHNAME/SDLUNAME and status in ('P','S','R','Y'))
         │     └─► Emit DECOM_SCHEDULED_JOB_DEPENDENCY (Severity: CRITICAL / BLOCKER)
         │
         ├───► RFCDES (RFC destinations where logon user == target user)
         │     └─► Emit DECOM_ACTIVE_RFC_DEPENDENCY (Severity: CRITICAL)
         │
         ├───► SWWWIHEAD (Work items in READY/SELECTED/STARTED assigned to user)
         │     └─► Emit DECOM_WORKFLOW_AGENT_DEPENDENCY (Severity: MAJOR / CRITICAL)
         │
         ├───► SM20 / ST03N / USR02.TRDAT (Logon or activity within last 90 days)
         │     └─► Emit DECOM_RECENT_ACTIVITY_DETECTED (Severity: MAJOR)
         │
         ├───► USR02.UFLAG != 0 & SM20 Activity (Locked user still receiving calls)
         │     └─► Emit DECOM_LOCKED_USER_CALL_FLOOD (Severity: CRITICAL)
         │
         └───► All Dependency Counts == 0 & Days Inactive >= 90
               └─► Emit DECOM_SAFE_FOR_ARCHIVING (Severity: INFO)
```

1. **`DECOM_SCHEDULED_JOB_DEPENDENCY`** (Severity: `CRITICAL` or `BLOCKER`):
   - Trigger: Target user is `AUTHNAME` or `SDLUNAME` for any batch job in `TBTCO` with `STATUS` $\in$ `['P', 'S', 'R', 'Y']` or with `PERIODIC == True`.
   - Rationale: Deactivation halts automated business cycles (e.g., billing, invoicing, shipping).

2. **`DECOM_ACTIVE_RFC_DEPENDENCY`** (Severity: `CRITICAL`):
   - Trigger: Target user is stored as logon credential (`RFCUSER` / `USERNAME`) in active RFC destinations in `RFCDES`.
   - Rationale: Deactivation terminates interface connectivity, resulting in remote authentication failures.

3. **`DECOM_WORKFLOW_AGENT_DEPENDENCY`** (Severity: `MAJOR` or `CRITICAL`):
   - Trigger: Target user is the assigned or actual agent for work items in `SWWWIHEAD` with `WI_STAT` $\in$ `['READY', 'SELECTED', 'STARTED']`.
   - Rationale: In-flight business approvals are left orphaned.

4. **`DECOM_RECENT_ACTIVITY_DETECTED`** (Severity: `MAJOR`):
   - Trigger: Target user has logon timestamp (`USR02.TRDAT`) or audit log executions within the past 90 days.
   - Rationale: Confirms the account is still actively in use.

5. **`DECOM_LOCKED_USER_CALL_FLOOD`** (Severity: `CRITICAL`):
   - Trigger: User is marked locked in `USR02` (`UFLAG != 0`), but recent activity/audit records show repeated failed logon attempts or remote calls within the past 30 days.
   - Rationale: External middleware is flooding system logs with invalid credential retries.

6. **`DECOM_USER_NOT_FOUND`** (Severity: `CRITICAL`):
   - Trigger: USR02 data is provided, but the specified `target_user` does not exist in the master record.

7. **`DECOM_SAFE_FOR_ARCHIVING`** (Severity: `INFO`):
   - Trigger: Target user has zero active jobs, zero RFC destinations, zero pending workflow items, and no activity for $\ge 90$ days. Decommission is verified safe.

### 3.4 Mathematical Decommission Risk Score Algorithm
The Decommission Risk Score $S_{\text{decom}} \in [0.0, 10.0]$ is computed deterministically as:

$$S_{\text{decom}} = \min\left(10.0, \sum w_i \cdot C_i\right)$$

Where:
- **Active Periodic / Running Jobs**: $+3.0$ base + $+0.5$ per additional job (cap: $+4.0$).
- **Active RFC Destinations**: $+3.5$ base + $+0.5$ per additional RFC destination (cap: $+4.5$).
- **Pending Workflow Work Items**: $+1.5$ base + $+0.3$ per additional work item (cap: $+3.0$).
- **Recent Activity Decay**:
  - Last active $\le 7$ days: $+2.0$
  - Last active $8–30$ days: $+1.5$
  - Last active $31–90$ days: $+1.0$
  - Last active $> 90$ days: $+0.0$
- **Locked User Call Flood**: $+2.5$ if user is locked but actively being queried.
- **Risk Tiers**:
  - `0.0 – 1.0`: `SAFE` (Safe to deactivate and archive immediately).
  - `1.1 – 4.0`: `LOW_RISK` (Minor historical dependencies; low blast radius).
  - `4.1 – 7.0`: `MODERATE_RISK` (Workflows or non-critical jobs require re-assignment).
  - `7.1 – 10.0`: `CRITICAL_BLOCKER` (Active periodic jobs or production RFC integrations present).

### 3.5 Automated Reassignment Action Checklist
The engine dynamically compiles an operational checklist serialized into `technical_details`:
1. **Background Job Reassignment**:
   - Transaction: `SM36` / `SM37`
   - Action: Change execution user (`AUTHNAME`) of identified jobs to dedicated system service account (e.g., `BATCH_SVC`).
2. **RFC Destination Credentials**:
   - Transaction: `SM59`
   - Action: Update logon security credentials of affected RFC destinations to appropriate technical communication user.
3. **Workflow Forwarding**:
   - Transaction: `SWIA` (Workflow Administration) or `SBWP`
   - Action: Execute mass forward on pending work item IDs to designated deputy or functional group.
4. **Account Locking & Grace Period**:
   - Transaction: `SU01` / `EWZ5`
   - Action: Lock dialog logons (`UFLAG = 64`), maintain valid-to date (`GLTGB = TODAY`), monitor for 14 days before table archiving (`SARA` / `US_USER`).

---

## 4. Feature 35: System Refresh & Data Masking Sanity Guard

### 4.1 Problem Space & Operational Hazards
SAP system refreshes (copying production database to QA or development systems) represent one of the highest risk events in enterprise operations:
- **Disastrous RFC Leakage**: If `RFCDES` destinations are not properly sanitized, test orders executed in QA will trigger real financial postings in production banks or external cloud applications (e.g., Ariba, Concur, Salesforce).
- **Email Storms to Customers**: If `SCOT` outbound email routing is enabled without a domain whitelist or redirection address, QA batch runs or billing tests will email real invoices to actual customers and vendors.
- **Logical System Corruption**: If `BDLS` (Logical System Conversion) is incomplete, the client logical system in `T000` remains pointing to `PRDCLNT100`, corrupting ALE/IDoc distribution and BW extractors.
- **Active Production Payment Jobs**: If `TBTCO` is not sanitized via `BTCTRNS1`, automated payment runs (`F110`), EDI dispatches, and interface jobs execute automatically when background work processes start.
- **Physical Warehouse Printer Routing**: If `SPAD` printer destinations are not re-routed, test print runs in QA physically print onto warehouse packing lines.

### 4.2 Differential Configuration Comparison Model
The engine parses two comprehensive configuration snapshots and applies an Isolation Policy:

1. **Pre-Refresh Baseline Snapshot** ($C_{\text{pre}}$): Configuration state of the source system (or previous baseline).
2. **Post-Refresh Target Snapshot** ($C_{\text{post}}$): Configuration state of the refreshed target system before users are permitted to log on.
3. **Isolation Policy Rules** ($P_{\text{iso}}$):
   - `target_sid`: Expected SID of the refreshed environment (e.g., `QAS`, `DEV`).
   - `target_client`: Expected client (e.g., `100`, `200`).
   - `environment_type`: `QAS`, `DEV`, `SANDBOX`, `TRAINING`.
   - `production_sids`: List of forbidden production SIDs (default: `["PRD", "PROD"]`).
   - `production_host_patterns`: Regex list of production hostnames/IPs (e.g., `[r".*prd.*", r".*prod.*", r"^10\.100\..*"]`).
   - `allowed_email_domains`: Whitelisted domains for email routing (e.g., `["test.corp", "dummy.local"]`).

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│  Pre-Refresh Baseline Snapshot  │       │  Post-Refresh Target Snapshot   │
│  (PRD Export / Golden QA Config)│       │  (Refreshed System State)       │
└────────────────┬────────────────┘       └────────────────┬────────────────┘
                 │                                         │
                 └───────────────────┬─────────────────────┘
                                     │
                                     ▼
                     ┌───────────────────────────────┐
                     │   Differential Engine Core    │
                     │   + Isolation Policy Engine   │
                     └───────────────┬───────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
┌──────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│ Check 1: RFC     │       │ Check 2: SCOT     │       │ Check 3: BDLS /   │
│ Destinations     │       │ Email Routing     │       │ Logical Systems   │
├──────────────────┤       ├───────────────────┤       ├───────────────────┤
│ Target points to │       │ SMTP active &     │       │ T000/BD54 has     │
│ prod host or SID │       │ no redirect/white-│       │ production name   │
│ ──► CRITICAL     │       │ list ──► CRITICAL │       │ ──► CRITICAL      │
└──────────────────┘       └───────────────────┘       └───────────────────┘
         │                           │                           │
         ▼                           ▼                           ▼
┌──────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│ Check 4: Jobs    │       │ Check 5: SPAD     │       │ Check 6: Isolation│
│ Sanitization     │       │ Physical Printers │       │ Verification      │
├──────────────────┤       ├───────────────────┤       ├───────────────────┤
│ F110 / EDI jobs  │       │ Real warehouse IP │       │ Zero hazards      │
│ scheduled in QA  │       │ printers active   │       │ detected          │
│ ──► CRITICAL     │       │ ──► MAJOR         │       │ ──► INFO (CLEAN)  │
└──────────────────┘       └───────────────────┘       └───────────────────┘
```

### 4.3 Rule Engine & Standard Finding Codes

1. **`REFRESH_RFC_TARGETS_PRODUCTION`** (Severity: `CRITICAL` or `BLOCKER`):
   - Trigger: In a refreshed non-prod environment, an RFC destination in `RFCDES` has `target_host`, `target_ip`, `gateway_host`, or `sysid` matching production patterns or identical to pre-refresh production targets without redirection.
   - Evidence: Destination name, host, expected non-prod target.

2. **`REFRESH_SCOT_OUTBOUND_ACTIVE`** (Severity: `CRITICAL`):
   - Trigger: In post-refresh environment, `SCOT` (SAPconnect SMTP node) has outbound email routing active (`smtp_active = True`) without a global redirect address (`redirect_all_to`) and without domain whitelist restrictions.
   - Evidence: SMTP node configuration, active state, routing domain.

3. **`REFRESH_LOGICAL_SYSTEM_UNADJUSTED`** (Severity: `CRITICAL`):
   - Trigger: The logical system assigned to the current client in `T000` or defined in `BD54` still matches the production logical system name (e.g., `PRDCLNT100`), or `bdls_executed` is false.
   - Evidence: Client number, current `LOGSYS`, expected `LOGSYS`.

4. **`REFRESH_CRITICAL_JOB_SCHEDULED`** (Severity: `CRITICAL`):
   - Trigger: Sensitive production batch jobs (matching patterns `*F110*`, `*PAYMENT*`, `*BILLING*`, `*EDI*`, `*IDOC*`, `*BANK*`) are found in `STATUS = 'P'` (Scheduled) or `'S'` (Released) in the refreshed system.
   - Evidence: Job name, job count, scheduled user.

5. **`REFRESH_PRODUCTION_PRINTER_ACTIVE`** (Severity: `MAJOR`):
   - Trigger: Physical production network printers in `SPAD` remain configured with active network communication instead of dummy `LP01` or PDF archive spoolers.
   - Evidence: Printer device name, host spool destination.

6. **`REFRESH_INPUT_SID_MISMATCH`** (Severity: `BLOCKER`):
   - Trigger: Target snapshot SID does not match the target SID configured in the isolation policy.

7. **`REFRESH_ISOLATION_VERIFIED`** (Severity: `INFO`):
   - Trigger: Zero hazardous deltas detected across RFC, SCOT, BDLS, batch jobs, and spool printers. Refreshed system isolation is cryptographically verified.

### 4.4 Mathematical Isolation Risk Score Algorithm
The Isolation Risk Score $S_{\text{iso}} \in [0.0, 10.0]$ is computed deterministically as:

$$S_{\text{iso}} = \min\left(10.0, \sum w_j \cdot H_j\right)$$

Where:
- **Production RFC Targets**: $+3.5$ base + $+1.0$ per additional destination (cap: $+5.0$).
- **Active SCOT Outbound Email**: $+4.0$ (unrestricted outbound email).
- **Unadjusted Logical System (BDLS Incomplete)**: $+3.0$.
- **Sensitive Production Batch Jobs Scheduled**: $+2.0$ base + $+0.5$ per additional job (cap: $+4.0$).
- **Active Physical Production Printers**: $+1.0$ base + $+0.5$ per additional printer (cap: $+2.0$).
- **Risk Tiers**:
  - `0.0 – 1.0`: `ISOLATED` (Safe to unlock system for QA/testing).
  - `1.1 – 4.0`: `LOW_RISK` (Minor non-critical deltas detected).
  - `4.1 – 7.0`: `MODERATE_RISK` (Unsanitized non-critical interfaces or printers).
  - `7.1 – 10.0`: `CRITICAL_HAZARD` (Production RFCs, active SCOT, or BDLS incomplete — system logon MUST remain blocked).

### 4.5 Automated Post-Refresh Remediation Action Checklist
1. **RFC Destination Redirection**:
   - Transaction: `SM59`
   - Action: Execute mass RFC update script or redirect destinations to QA mock endpoints (`qa-*.corp`).
2. **SCOT Email Redirection / Hold**:
   - Transaction: `SCOT`
   - Action: Set outbound parameter `Routing` $\rightarrow$ Redirect all outbound messages to central test mailbox (e.g., `qa-catchall@test.corp`), or place all outbound queues on HOLD.
3. **Logical System Conversion (BDLS)**:
   - Transaction: `BDLS`
   - Action: Run logical system conversion from `PRDCLNT100` to `QASCLNT100` across all client tables.
4. **Batch Job Suspension**:
   - Program: `BTCTRNS1`
   - Action: Execute `BTCTRNS1` to suspend all background jobs before starting SAP application servers. Use `BTCTRNS2` to resume only approved sanitized jobs.

---

## 5. Multi-Artifact Ingestion & Resilient Normalization

Both engines support multiple input formats through a unified normalizer pipeline:

```
                          ┌───────────────────────────┐
                          │ AnalysisRequest Ingestion │
                          └─────────────┬─────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
┌─────────────────────┐      ┌─────────────────────┐      ┌─────────────────────┐
│ 1. Consolidated     │      │ 2. Multi-Artifact   │      │ 3. Tagged / Tabular │
│    JSON Payload     │      │    ArtifactReference│      │    CSV Exports      │
├─────────────────────┤      ├─────────────────────┤      ├─────────────────────┤
│ {                   │      │ request.artifacts = │      │ [USR02]             │
│   "target_user": "",│      │ [                   │      │ BNAME,USTYP,UFLAG   │
│   "usr02": [...],   │      │   {file: "usr02"},  │      │ BATCH_ADMIN,A,0     │
│   "tbtco": [...]    │      │   {file: "tbtco"}   │      │ [TBTCO]             │
│ }                   │      │ ]                   │      │ JOBNAME,STATUS...   │
└──────────┬──────────┘      └──────────┬──────────┘      └──────────┬──────────┘
           │                            │                            │
           └────────────────────────────┼────────────────────────────┘
                                        │
                                        ▼
                      ┌───────────────────────────────────┐
                      │ Typed Normalized Pydantic Models  │
                      │ (DecommissionNormalizedData /     │
                      │  SystemRefreshNormalizedData)     │
                      └─────────────────┬─────────────────┘
                                        │
                                        ▼
                      ┌───────────────────────────────────┐
                      │ Pure Deterministic Rule Evaluation│
                      └───────────────────────────────────┘
```

### Line and Column Coordinate Resolution
To maintain **Cardinal Axiom 2, Point 6** (concrete cryptographic evidence with exact line and column numbers), each normalizer preserves the source text line numbers during scanning:
- For JSON payloads: Scans source string lines to pinpoint the exact line and column where a specific field, job name, or destination appears.
- For CSV exports: Tracks row numbers and comma offsets directly.
- Evidence hashing: `EvidenceEngine.create_evidence()` hashes the normalized snippet and source text, binding the finding cryptographically to the artifact.

---

## 6. Synergy & Inter-Engine Integration across Domain 5

The Domain 5 Operations Suite works as an integrated defense mesh:
- **Feature 30 (Safe Decommission)** $\leftrightarrow$ **Feature 32 (Workflow Stuck Explainer)**: When Feature 30 identifies workflow work items owned by a decommission candidate, it cross-references the agent resolution logic analyzed by Feature 32 to determine if the user is the sole approver in an escalation chain.
- **Feature 30 (Safe Decommission)** $\leftrightarrow$ **Feature 33 (IAM Cost Optimizer)**: Feature 33 identifies inactive users driving expensive license tiers; Feature 30 verifies that those users have zero operational batch/RFC dependencies before the account is revoked.
- **Feature 35 (System Refresh Guard)** $\leftrightarrow$ **Feature 31 (Fiori 403 Doctor)**: After system refresh, ICF node paths or Gateway aliases can be misaligned; Feature 35 verifies RFC/ICF configuration while Feature 31 diagnoses authorization and service activation errors.
- **Feature 35 (System Refresh Guard)** $\leftrightarrow$ **Feature 34 (Account Determination Verifier)**: A system refresh that brings incomplete customizing to QA can break account determination; Feature 35 validates customizing/logical system integrity while Feature 34 checks account mapping.

---

## 7. Golden Fixtures & Testing Matrix

Both engines will be verified against the mandatory fixture triple:

### 7.1 Safe Decommission Fixtures (`services/analysis-python/tests/fixtures/domain5/`)
1. **`decom_job_owner.json` (Negative)**:
   - User `BATCH_ADMIN` has 4 scheduled billing background jobs in `TBTCO` and 1 active RFC destination in `RFCDES`.
   - Triggers: `DECOM_SCHEDULED_JOB_DEPENDENCY` (CRITICAL), `DECOM_ACTIVE_RFC_DEPENDENCY` (CRITICAL).
   - Expected Risk Score: $\ge 8.5$.
2. **`decom_safe.json` (Positive)**:
   - User `OLD_CONTRACTOR` has zero active jobs, zero RFC destinations, zero pending workflows, and last logon was 240 days ago.
   - Triggers: `DECOM_SAFE_FOR_ARCHIVING` (INFO).
   - Expected Risk Score: $\le 0.5$.
3. **`decom_malformed.json` (Edge-case / Boundary)**:
   - Missing tables, empty strings, corrupt date formats, unknown user types. Engine fails closed without uncaught exceptions.

### 7.2 System Refresh Fixtures (`services/analysis-python/tests/fixtures/domain5/`)
1. **`refresh_rfc_pointing_to_prod.json` (Negative)**:
   - Post-refresh QA system has RFC destination `SAP_BANK_GATEWAY` pointing to `prod-bank.acme.corp`, `SCOT` email routing active with no redirection, and client `100` logical system remaining `PRDCLNT100`.
   - Triggers: `REFRESH_RFC_TARGETS_PRODUCTION` (CRITICAL), `REFRESH_SCOT_OUTBOUND_ACTIVE` (CRITICAL), `REFRESH_LOGICAL_SYSTEM_UNADJUSTED` (CRITICAL).
   - Expected Risk Score: $\ge 9.5$.
2. **`refresh_clean_isolated.json` (Positive)**:
   - All RFC destinations point to `qa-*.acme.corp` or `dummy.local`, SCOT redirects all email to `qa-test@acme.corp`, `BDLS` converted to `QASCLNT100`, sensitive jobs suspended.
   - Triggers: `REFRESH_ISOLATION_VERIFIED` (INFO).
   - Expected Risk Score: $0.0$.
3. **`refresh_malformed.json` (Edge-case / Boundary)**:
   - Mismatched SIDs, missing sections, corrupted RFC strings. Engine emits `REFRESH_INPUT_SID_MISMATCH` and fails closed safely.

---

*Authored by `m3_d5_explorer_1` | ERP Preflight Engineering Operations*
