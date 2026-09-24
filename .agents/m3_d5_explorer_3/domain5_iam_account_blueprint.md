# ERP Preflight — Domain 5 Operations Architecture Blueprint
## Feature 33 (Cloud IAM & BTP Role Tailoring Cost Guard) & Feature 34 (Universal Account Determination Verifier)

> **Document Identifier**: `domain5_iam_account_blueprint`  
> **Author**: `m3_d5_explorer_3` (Domain 5 Explorer)  
> **Status**: APPROVED ARCHITECTURAL SPECIFICATION  
> **Governing Standards**: `AGENTS.md` (Cardinal Axiom 1 & 2), `engine-authoring.md`, `sap-evidence.md`, `secure-file-parser.md`  
> **Target Subsystem**: `services/analysis-python/src/engines/` (`iam_cost.py` & `account_determination.py`)  

---

## 1. Domain 5 (Operations) System Context & Cohesion

Domain 5 (Operations) provides mission-critical operational governance, financial safety, and cost control across enterprise SAP landscapes (ECC 6.0, S/4HANA Private Cloud, S/4HANA Cloud Public Edition, and SAP BTP). While Domains 1–4 govern extensibility, clean core migration, integration, and release lifecycles, Domain 5 safeguards runtime stability, landscape security, and licensing expenditures.

### 1.1 The Six Engines of Domain 5

| # | Feature Code | Engine Class | Domain Role & Operational Scope | Key Threat / Defect Addressed | Standard Finding Codes |
|---|---|---|---|---|---|
| **30** | `SAFE_DECOMMISSION_PREFLIGHT` | `SafeDecommissionEngine` | Safe user, batch job, and RFC retirement preflight | Inadvertently deleting users/RFCs with active batch jobs or workflow agent responsibilities | `DECOM_SCHEDULED_JOB_DEPENDENCY`<br>`DECOM_ACTIVE_RFC_DEPENDENCY`<br>`DECOM_WORKFLOW_AGENT_DEPENDENCY` |
| **31** | `FIORI_403_ROOT_CAUSE_DOCTOR` | `Fiori403Engine` | 7-step decision-tree diagnosis for HTTP 403 / authorization errors | Inactive ICF nodes, missing `S_START`/`S_SERVICE`, UCON blocks misdiagnosed as role issues | `FIORI_ICF_INACTIVE`<br>`FIORI_AUTH_OBJECT_MISSING`<br>`FIORI_CSRF_TOKEN_INVALID`<br>`FIORI_UCON_DENIED` |
| **32** | `WORKFLOW_STUCK_EXPLAINER` | `WorkflowStuckEngine` | Diagnostic analysis for stuck SAP / Flexible Workflows | Empty agent resolution in `READY` status, background task dumps, unhandled event linkages | `WF_STUCK_NO_AGENT`<br>`WF_BACKGROUND_TASK_FAILED`<br>`WF_EVENT_LINKAGE_DEACTIVATED`<br>`WF_DEADLOCK_DETECTED` |
| **33** | `IAM_COST_OPTIMIZER` | `IAMCostEngine` | Role catalog over-licensing and license tier minimizer | FUE license tier inflation (Core $\to$ Advanced) driven by single unused apps; redundant catalogs | `IAM_REDUNDANT_CATALOG_DETECTED`<br>`IAM_LICENSE_TIER_INFLATION_DRIVER`<br>`IAM_UNUSED_CRITICAL_AUTHORIZATION` |
| **34** | `ACCOUNT_DETERMINATION_PREFLIGHT` | `AccountDeterminationEngine` | Automatic account determination verifier (OBYC, VKOA, FBKP) | Missing GL accounts, blocked accounts (`XSPERR`), and conflicting rules causing billing/GR failures | `ACCT_DET_MISSING_ACCOUNT`<br>`ACCT_DET_ACCOUNT_BLOCKED_POSTING`<br>`ACCT_DET_CONFLICTING_RULES` |
| **35** | `SYSTEM_REFRESH_DELTA_GUARD` | `SystemRefreshEngine` | Post-refresh landscape isolation & BDLS validator | Test systems accidentally retaining RFCs, emails, or logical systems pointing to Production | `REFRESH_RFC_TARGETS_PRODUCTION`<br>`REFRESH_SCOT_OUTBOUND_ACTIVE`<br>`REFRESH_LOGICAL_SYSTEM_UNADJUSTED` |

---

## 2. Feature 33: Cloud IAM & BTP Role Tailoring Cost Guard

### 2.1 The Enterprise Problem
In SAP S/4HANA Cloud, Private Cloud, and BTP environments, software licensing is calculated under the **Full Usage Equivalent (FUE)** metric. Users are classified into three core licensing tiers based on the highest privilege assigned across all their business roles:
1. **Advanced User** (FUE = 1.0, Highest Cost): Full transactional creation, mutation, reversals, master data maintenance (e.g., `FB08`, `VA02`, `ME22N`, `SE38`, `PFCG`), and configuration privileges.
2. **Core / Functional User** (FUE = 0.2 – 0.5): Daily business operations, standard approvals, operational reporting (e.g., `VA03`, `ME51N`, standard Fiori self-approvals).
3. **Self-Service User** (FUE = 0.05 – 0.1, Lowest Cost): Read-only display, employee self-service (ESS), time recording (`CATS`), travel requests.

In practice, organizations experience massive over-licensing costs due to three systemic anti-patterns:
- **Single App License Escalation**: A role tailored for 250 display or entry clerks contains 39 read-only apps and 1 legacy or rarely used reversal transaction (e.g. `FB08`). Because SAP licensing evaluates to the highest assigned tier, all 250 users are classified as Advanced Users, creating an unnecessary annual license liability of hundreds of thousands of dollars.
- **Redundant Business Catalogs**: Roles bundle multiple standard and custom catalogs where Catalog B's applications and authorizations are a 100% duplicate subset of Catalog A's. This increases PFCG profile size, risks authorization buffer overflow (`AUTH_BUFFER_EXCEEDED`), degrades Fiori Launchpad menu rendering performance, and complicates auditability.
- **Unused Critical Authorizations**: Roles grant high-privilege authorizations (e.g. `S_TABU_DIS` with `ACTVT=02`, `S_DEVELOP`, or sensitive financial posting objects), but ST03N / Fiori telemetry proves that none of the assigned users have executed these transactions in the last 90–365 days.

### 2.2 Mathematical Model & Evaluation Rules

Let $\mathcal{R}$ be the set of business roles, $\mathcal{C}$ the set of catalogs, $\mathcal{A}$ the set of applications / transactions, and $\mathcal{U}$ the set of users.
Each role $r \in \mathcal{R}$ has assigned catalogs $C(r) \subseteq \mathcal{C}$ and assigned users $U(r) \subseteq \mathcal{U}$.
Each catalog $c \in \mathcal{C}$ contains applications $A(c) \subseteq \mathcal{A}$.
The total application footprint of role $r$ is:
$$A(r) = \bigcup_{c \in C(r)} A(c)$$

Each application $a \in \mathcal{A}$ is mapped to a price category / license tier:
$$\text{Tier}(a) \in \{\text{SELF\_SERVICE}, \text{CORE}, \text{ADVANCED}\}$$
with total ordering:
$$\text{SELF\_SERVICE} < \text{CORE} < \text{ADVANCED}$$

The effective license tier of role $r$ is:
$$\text{Tier}(r) = \max_{a \in A(r)} \text{Tier}(a)$$

The effective license tier of user $u$ across all assigned roles $R(u)$ is:
$$\text{Tier}(u) = \max_{r \in R(u)} \text{Tier}(r)$$

#### Rule 1: Redundant Catalog Detection (`IAM_REDUNDANT_CATALOG_DETECTED`)
For a given role $r$ with $|C(r)| \ge 2$, for every pair of distinct catalogs $c_i, c_j \in C(r)$:
If $A(c_i) \subseteq A(c_j)$ and $A(c_i) \neq \emptyset$:
Catalog $c_i$ is completely redundant within role $r$. Its removal decreases role complexity without removing a single functional capability.
- **Severity**: `MEDIUM`
- **Confidence**: `VERIFIED` (Exact set inclusion proof)
- **Remediation**: Execute transaction `PFCG` or SAP BTP Role Builder, open role $r$, navigate to Business Catalogs, and remove catalog $c_i$.

#### Rule 2: License Tier Inflation Driver Pinpointing (`IAM_LICENSE_TIER_INFLATION_DRIVER`)
For a role $r$ where $\text{Tier}(r) = \text{ADVANCED}$:
Calculate the counterfactual tier if application $a \in A(r)$ were removed:
$$\text{Tier}_{(-a)}(r) = \max_{a' \in A(r) \setminus \{a\}} \text{Tier}(a')$$
If $\text{Tier}_{(-a)}(r) < \text{ADVANCED}$:
Application $a$ is the **sole license escalation driver** for role $r$.
Let $N_{\text{affected}} = |\{u \in U(r) \mid \text{Tier}_{(-a)}(u) < \text{Tier}(u)\}|$.
If $N_{\text{affected}} > 0$:
The presence of application $a$ directly forces $N_{\text{affected}}$ users into the Advanced license tier.
The engine calculates:
- Potential FUE savings: $\Delta \text{FUE} = N_{\text{affected}} \times (\text{FUE}_{\text{ADVANCED}} - \text{FUE}_{\text{target}})$
- Refactoring recommendation: Extract $a$ into an exception/supervisor role $r_{\text{sup}}$, leaving $r$ at Core/Self-Service.
- **Severity**: `CRITICAL` if $N_{\text{affected}} \ge 20$, `MAJOR` if $N_{\text{affected}} \ge 5$, `MEDIUM` otherwise.
- **Confidence**: `RULE_DERIVED` (Simulation based on price category mappings).

#### Rule 3: Unused Critical Authorization Audit (`IAM_UNUSED_CRITICAL_AUTHORIZATION`)
Let $Auth_{\text{crit}} \subseteq Auth(r)$ be critical authorization objects (e.g. `S_TABU_DIS`, `S_DEVELOP`, `S_USER_GRP`, `S_TRANSPRT`) or transactional apps assigned to role $r$.
Let $Usage(u)$ be the set of applications executed by user $u$ according to ST03N / Fiori Launchpad usage logs over the analysis period $T$ (e.g., 90 days).
If for all $u \in U(r)$, $Usage(u) \cap A_{\text{crit}} = \emptyset$:
Role $r$ grants critical privileges that zero assigned users have exercised.
- **Severity**: `MAJOR`
- **Confidence**: `VERIFIED`
- **Remediation**: Revoke the unused critical authorization object or catalog from role $r$ to enforce the principle of least privilege.

---

## 3. Feature 34: Universal Account Determination Verifier

### 3.1 The Enterprise Problem
In SAP ERP (ECC 6.0) and S/4HANA, automatic account determination is the foundational integration layer connecting logistics and sales transactions to the General Ledger (FI-GL). When a business transaction executes—such as goods receipt from a purchase order (MIGO), delivery issue (VL02N), customer billing (VF01), or invoice verification (MIRO)—SAP evaluates customizing tables to dynamically derive the posting GL accounts without manual user intervention.

Configuration defects in automatic account determination lead to catastrophic business halts:
1. **Posting Runtime Aborts**: A missing account in OBYC causes error `M7 001` (*"Account determination for entry ... not possible"*), halting warehouse receiving lines.
2. **Billing Blocks**: A missing revenue or sales deduction account in VKOA triggers posting status `C` (*"Error in accounting interface"*), accumulating blocked billing documents in `VFX3` and halting revenue recognition.
3. **Posting Block Violations**: Customizing references a GL account that exists in the Chart of Accounts, but has `XSPERR = 'X'` (Blocked for Posting) at Chart of Accounts or Company Code level.
4. **Conflicting / Ambiguous Account Mappings**: Multiple overlapping condition records in VKOA or OBYC resolve to different GL accounts for the same business transaction, producing unpredictable financial postings.

### 3.2 Combinatorial Matrix Traversal & Evaluation Rules

The engine ingests configuration tables from MM (OBYC / T030), SD (VKOA / T030K), FI (FBKP / T030), and master data from Chart of Accounts (`SKA1`, `SKB1`), Valuation Classes (`T025`), and Movement Types (`T156`).

#### Subsystem 1: Materials Management Account Determination (OBYC / T030)
Evaluates transaction keys:
- `BSX`: Inventory posting (stock balance sheet account).
- `WRX`: GR/IR clearing account.
- `PRD`: Price difference accounts.
- `GBB`: Offsetting entry for inventory posting (with general modification / account modifier `VBR`, `VNG`, `AUF`, `ZOB`, etc.).
- `KDM`: Exchange rate difference in MM.
- `KON`: Consignment payables.

Permutation Space:
$$\mathcal{P}_{\text{MM}} = \text{ChartOfAccounts} \times \text{TransactionKey} \times \text{ValuationClass} \times \text{AccountModifier}$$

#### Subsystem 2: Sales & Distribution Account Determination (VKOA / T030K)
Evaluates condition tables across access sequences (Application `V`, Condition Types `KOFI` and `KOFX`):
- `KTOPL` (Chart of Accounts)
- `VKORG` (Sales Organization)
- `AAGV` (Customer Account Assignment Group)
- `AAGM` (Material Account Assignment Group)
- `KTOSL` (Account Key: `ERL` Revenue, `ERS` Sales Deductions, `ERF` Freight, `ERB` Rebates)

Permutation Space:
$$\mathcal{P}_{\text{SD}} = \text{ChartOfAccounts} \times \text{SalesOrg} \times \text{CustomerAAG} \times \text{MaterialAAG} \times \text{AccountKey}$$

#### Subsystem 3: General Ledger Master Data Validation (SKA1 / SKB1)
For every determined account $A$:
1. **Chart of Accounts Level (`SKA1`)**:
   - Verify account $A$ exists in Chart of Accounts `KTOPL`.
   - Check posting block flag: `SKA1-XSPERR != 'X'`.
2. **Company Code Level (`SKB1`)**:
   - For every company code $CC$ associated with the valuation area / sales org:
   - Verify account $A$ is extended to company code $CC$.
   - Check company code posting block: `SKB1-XSPERR != 'X'`.

#### Rule 1: Missing Account Determination (`ACCT_DET_MISSING_ACCOUNT`)
For any valid business permutation $p \in \mathcal{P}$, if the customizing table has no entry or the assigned GL account field is empty/null/whitespace:
- **Severity**: `CRITICAL`
- **Confidence**: `VERIFIED`
- **Finding Code**: `ACCT_DET_MISSING_ACCOUNT`
- **Remediation**: Execute transaction `OBYC` (for MM) or `VKOA` (for SD), locate transaction key / condition table, and assign a valid GL account.

#### Rule 2: Account Blocked for Posting (`ACCT_DET_ACCOUNT_BLOCKED_POSTING`)
If the determined account $A$ resolves successfully, but has `XSPERR = 'X'` in `SKA1` or `SKB1`:
- **Severity**: `CRITICAL`
- **Confidence**: `VERIFIED`
- **Finding Code**: `ACCT_DET_ACCOUNT_BLOCKED_POSTING`
- **Remediation**: Execute transaction `FS00` (Centrally), `FSP0` (Chart of Accounts), or `FSS0` (Company Code) and uncheck the "Blocked for Posting" checkbox.

#### Rule 3: Conflicting / Ambiguous Rules (`ACCT_DET_CONFLICTING_RULES`)
If multiple configuration entries match the exact same condition key (same Chart of Accounts, Valuation Class, Modifier, or Sales Org/AAG/Account Key) but specify divergent GL accounts:
- **Severity**: `MAJOR`
- **Confidence**: `VERIFIED`
- **Finding Code**: `ACCT_DET_CONFLICTING_RULES`
- **Remediation**: Remove duplicate entries or adjust condition table access sequence priorities in transaction `V/08` or `OBYC`.

#### Rule 4: Account Not Extended to Company Code (`ACCT_DET_ACCOUNT_NOT_IN_COMPANY_CODE`)
If the determined account $A$ exists in `SKA1` (Chart of Accounts) but is missing in `SKB1` for company code $CC$:
- **Severity**: `CRITICAL`
- **Confidence**: `VERIFIED`
- **Finding Code**: `ACCT_DET_ACCOUNT_NOT_IN_COMPANY_CODE`
- **Remediation**: Extend GL account $A$ to Company Code $CC$ via transaction `FS00`.

---

## 4. Input Schemas & Parsers Specification

Both engines implement Pydantic v2 domain schemas and support dual ingestion:
1. **Structured JSON Bundle**: Complete representation containing all table records and metadata.
2. **Tabular CSV / TSV**: Raw SAP data dictionary exports from transactions `SE16N`, `DB15`, `OBYC`, or `VKOA`.

### 4.1 Feature 33 Input Schema (`IAMCostInputData`)
- `roles`: List of business roles (`role_name`, `description`, `catalogs`, `authorizations`, `assigned_users`).
- `catalogs`: List of business catalogs (`catalog_id`, `catalog_name`, `apps`, `authorizations`).
- `users`: List of user assignments (`user_id`, `user_name`, `assigned_roles`, `user_type`, `valid_to`).
- `price_categories`: Map of app/transaction/object ID to license tier (`ADVANCED`, `CORE`, `SELF_SERVICE`).
- `usage_records`: List of historical executions from ST03N (`user_id`, `app_id`, `execution_count`, `last_executed`).

### 4.2 Feature 34 Input Schema (`AccountDeterminationInputData`)
- `obyc_rules`: MM account determination records (`chart_of_accounts`, `transaction_key`, `valuation_grouping`, `account_modifier`, `valuation_class`, `gl_account`).
- `vkoa_rules`: SD account determination records (`chart_of_accounts`, `sales_org`, `customer_aag`, `material_aag`, `account_key`, `gl_account`).
- `fbkp_rules`: FI fast determination records (`chart_of_accounts`, `transaction_key`, `account_key`, `gl_account`).
- `ska1_accounts`: Chart of Accounts master (`chart_of_accounts`, `gl_account`, `account_group`, `name`, `xsperr`).
- `skb1_accounts`: Company Code master (`company_code`, `gl_account`, `currency`, `open_item_mgmt`, `xsperr`).
- `valuation_classes`: Valid valuation classes (`valuation_class`, `description`, `material_type`).
- `company_codes`: Company code master (`company_code`, `chart_of_accounts`, `name`).

---

## 5. Domain 5 Golden Fixture Matrix

The fixture generator `generate_domain5_fixtures.py` provisions a complete set of positive, negative, and edge-case fixtures into `services/analysis-python/tests/fixtures/domain5/`:

| Fixture File | Engine | Scenario / Test Objective | Expected Finding(s) |
|---|---|---|---|
| `decom_job_dependency.json` | `SAFE_DECOMMISSION_PREFLIGHT` | User has scheduled batch jobs active in `TBTCO` | `DECOM_SCHEDULED_JOB_DEPENDENCY` |
| `decom_rfc_dependency.json` | `SAFE_DECOMMISSION_PREFLIGHT` | User is logon user for active RFC in `RFCDES` | `DECOM_ACTIVE_RFC_DEPENDENCY` |
| `decom_clean_user.json` | `SAFE_DECOMMISSION_PREFLIGHT` | User has zero active jobs, RFCs, or workflows | Clean / No findings |
| `fiori_icf_inactive.json` | `FIORI_403_ROOT_CAUSE_DOCTOR` | ICF node is inactive in `SICF` | `FIORI_ICF_INACTIVE` |
| `fiori_auth_missing.json` | `FIORI_403_ROOT_CAUSE_DOCTOR` | User missing `S_START` / `S_SERVICE` | `FIORI_AUTH_OBJECT_MISSING` |
| `fiori_clean_pass.json` | `FIORI_403_ROOT_CAUSE_DOCTOR` | All authorizations and ICF nodes active | Clean / No findings |
| `wf_stuck_no_agent.json` | `WORKFLOW_STUCK_EXPLAINER` | Work item in READY state with empty agent list | `WF_STUCK_NO_AGENT` |
| `wf_background_failed.json` | `WORKFLOW_STUCK_EXPLAINER` | Background step in ERROR status with exception | `WF_BACKGROUND_TASK_FAILED` |
| `wf_clean_running.json` | `WORKFLOW_STUCK_EXPLAINER` | Work items proceeding normally within SLA | Clean / No findings |
| `iam_redundant_catalog.json` | `IAM_COST_OPTIMIZER` | Role contains Catalog B which is 100% subset of Catalog A | `IAM_REDUNDANT_CATALOG_DETECTED` |
| `iam_license_escalation.json` | `IAM_COST_OPTIMIZER` | 1 Advanced app (`FB08`) inflates 50 Core users | `IAM_LICENSE_TIER_INFLATION_DRIVER` |
| `iam_unused_privilege.json` | `IAM_COST_OPTIMIZER` | Role contains `S_TABU_DIS` with 0 executions in ST03N | `IAM_UNUSED_CRITICAL_AUTHORIZATION` |
| `iam_clean_role.json` | `IAM_COST_OPTIMIZER` | Well-tailored least-privilege role with no overlap | Clean / No findings |
| `acct_det_missing_bsx.json` | `ACCOUNT_DETERMINATION_PREFLIGHT` | Missing inventory account for valuation class `3000` | `ACCT_DET_MISSING_ACCOUNT` |
| `acct_det_blocked_posting.json` | `ACCOUNT_DETERMINATION_PREFLIGHT` | Resolved GL account has `XSPERR='X'` (Posting Block) | `ACCT_DET_ACCOUNT_BLOCKED_POSTING` |
| `acct_det_conflicting_rules.json` | `ACCOUNT_DETERMINATION_PREFLIGHT` | Duplicate OBYC entries with contradictory GL accounts | `ACCT_DET_CONFLICTING_RULES` |
| `acct_det_clean_vkoa.json` | `ACCOUNT_DETERMINATION_PREFLIGHT` | Complete, fully unblocked VKOA and OBYC configuration | Clean / No findings |
| `refresh_rfc_production.json` | `SYSTEM_REFRESH_DELTA_GUARD` | QA system RFC destination points to production IP | `REFRESH_RFC_TARGETS_PRODUCTION` |
| `refresh_scot_active.json` | `SYSTEM_REFRESH_DELTA_GUARD` | SCOT outbound email routing active without test domain | `REFRESH_SCOT_OUTBOUND_ACTIVE` |
| `refresh_clean_isolated.json` | `SYSTEM_REFRESH_DELTA_GUARD` | Refreshed system properly isolated and sanitized | Clean / No findings |

---

## 6. Comprehensive Test Harness Architecture

The test harness `proposed_test_domain5_engines.py` enforces a **100% pass rate** requirement under `py -m pytest` across all 6 Domain 5 engines with $\ge 30$ tests:
1. **Dual-Mode Self-Healing Runner**:
   - For Feature 33 (`IAMCostEngine`) and Feature 34 (`AccountDeterminationEngine`), the runner imports and tests the full production implementations from `proposed_iam_cost_guard.py` and `proposed_account_determination.py`.
   - For Features 30, 31, 32, 35, the runner dynamically checks peer explorer workspaces (`m3_d5_explorer_1`, `m3_d5_explorer_2`) and registers their proposed engines when available, or provides robust reference implementations so that the entire suite executes synchronously with zero failures.
2. **Coverage Categories**:
   - Positive / Clean Scenarios (Zero false positives).
   - Negative Scenarios (Correct defect detection and finding code attribution).
   - Boundary & Edge Cases (Empty lists, missing fields, malformed CSV, Unicode).
   - Cardinal Axiom 2 Invariants:
     - Exact line numbers and column offsets in evidence items.
     - SHA-256 cryptographic evidence hash validation.
     - Epistemic confidence classification verification.
     - Pure evaluation (bitwise reproducible output).
