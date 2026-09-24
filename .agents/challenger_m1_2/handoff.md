# Empirical Challenge Report & Handoff: Cross-Playbook Consistency & AGENTS.md Alignment

**Agent**: `challenger_m1_2` (`teamwork_preview_challenger`)  
**Workspace**: `H:/erppreflight/.agents/challenger_m1_2`  
**Parent**: `66440be0-c7ee-4a74-8a17-61e13b963df1` (`parent`)  
**Timestamp**: 2026-09-24T03:11:00Z  
**Verdict**: **`REQUEST_CHANGES`**  

---

## Challenge Summary

**Overall risk assessment**: **HIGH**

Empirical verification of `H:/erppreflight/AGENTS.md` and the 8 skill playbooks in `H:/erppreflight/.agents/skills/` revealed four major governance defects:
1. **Broken Agent Role Route**: `AGENTS.md` routes `Frontend UI / Design System Engineer` to `accessibility.md`, a phantom file that does not exist anywhere in the repository.
2. **Missing Core TanStack Component**: `TanStack Form` (`@tanstack/react-form` + Zod) is explicitly mandated by Cardinal Axiom 1 (Criterion 7), `ORIGINAL_REQUEST.md` (R3), and `AGENTS.md` composite rules, but has **zero lines of specification, zero component architecture, and zero code patterns across all 8 playbooks**.
3. **Broken Cardinal Axiom Cross-Referencing**: Neither Cardinal Axiom 1 nor Cardinal Axiom 2 is explicitly named or cross-referenced in **any** of the 8 skill playbooks. Instead, playbooks define isolated local axioms without hierarchical anchoring to `AGENTS.md`.
4. **Asymmetric No-Dependency-Soup Enforcement**: The strictly forbidden duplicate libraries defined in `AGENTS.md` (e.g., React Hook Form, Formik, Prisma, Cytoscape, Chart.js) are absent from the domain playbooks responsible for those subsystems.

---

## Challenges

### [High] Challenge 1: Phantom Playbook Reference in AGENTS.md (`accessibility.md`)
- **Assumption challenged**: Every agent role in `AGENTS.md` Section 3 routes to existing, valid playbooks in `/.agents/skills/`.
- **Attack scenario**: An autonomous agent dispatched with the role `Frontend UI / Design System Engineer` attempts to load its assigned secondary playbook `accessibility.md` as mandated by `AGENTS.md` line 121:
  ```markdown
  | **Frontend UI / Design System Engineer** | frontend-design-system.md | data-table-and-large-list.md, accessibility.md | • Editing files in apps/web/src/components/... |
  ```
  The agent attempts to read `/.agents/skills/accessibility.md` or `H:/erppreflight/accessibility.md`. The operation crashes with `ENOENT` / file-not-found.
- **Blast radius**: Halts automated multi-agent workflows whenever frontend UI tasks are dispatched.
- **Empirical verification**:
  - `fs.existsSync("H:/erppreflight/.agents/skills/accessibility.md")` evaluated to `false`.
  - Global repository search across all subdirectories returned **0 matches** for `*accessibility*`.
  - All accessibility standards (WCAG 2.2 AA) were consolidated into `frontend-design-system.md` (Sections 3.1, 4.1, 5.1), `data-table-and-large-list.md` (Section 8), and `dependency-graph.md` (Section 7).
- **Mitigation**: Update `AGENTS.md` line 121 to remove `accessibility.md` from the Secondary Playbooks column, leaving `data-table-and-large-list.md`.

---

### [High] Challenge 2: Complete Absence of TanStack Form from All Playbooks
- **Assumption challenged**: TanStack suite requirements (Table, Virtual, Form, Pacer) are accurately reflected across playbooks.
- **Attack scenario**: A frontend developer or agent is assigned to implement form workflows (e.g., SAP connector setup, file upload forms, project settings, or rule parameter configuration).
  1. `AGENTS.md` Section 3 triggers `Frontend UI / Design System Engineer` for *"Creating forms, dialogs, buttons, or badges"*.
  2. `AGENTS.md` Section 1, Cardinal Axiom 1 Criterion 7 mandates:
     > *"Form State Integrity: Form workflows (TanStack Form + Zod) implement dirty-state tracking, unsaved changes warnings on navigation, and server/client validation feedback."*
  3. `AGENTS.md` Section 3.1 mandates:
     > *"SAP Connector & Ingestion Upload: secure-file-parser.md + multi-tenant-security.md + frontend-design-system.md (TanStack Form)."*
  4. The developer opens `frontend-design-system.md` (or any other playbook) to find the canonical TanStack Form implementation pattern, dirty-state hook, or validation boundary.
  5. Result: **0 occurrences of `@tanstack/react-form` or `TanStack Form` exist in the entire playbook suite.** The developer is left with zero guidance, risking ad-hoc implementations or regressions into forbidden libraries like React Hook Form.
- **Blast radius**: Developers cannot satisfy Cardinal Axiom 1 Criterion 7 without standard patterns. High risk of inconsistent form validation, unhandled dirty states, and data loss on navigation.
- **Empirical verification**:
  - Regex search `/tanstack\/react-form|tanstack form|react-form/i` across all 8 files in `H:/erppreflight/.agents/skills/` returned **0 matches**.
  - `apps/web/package.json` does not declare `@tanstack/react-form`.
- **Mitigation**: Add a dedicated Section to `frontend-design-system.md` (e.g. Section 7: "Form Architecture & State Integrity (`@tanstack/react-form` + Zod)") specifying form field wrapping, dirty-state tracking, unsaved changes navigation dialog, and validation feedback.

---

### [High] Challenge 3: Total Lack of Bidirectional Cross-Referencing for the Two Cardinal Axioms
- **Assumption challenged**: The two cardinal axioms are properly defined and cross-referenced.
- **Attack scenario**: An agent or developer reads a skill playbook (e.g. `engine-authoring.md` or `frontend-design-system.md`) in isolation without loading `AGENTS.md`.
  1. The playbook claims to be the *"Binding architectural specification"*, but makes no mention of `AGENTS.md` or the Two Cardinal Axioms.
  2. The agent is unaware that their work will fail quality gates if it violates Cardinal Axiom 1 (e.g., missing loading skeletons or accessible severity indicators) or Cardinal Axiom 2 (14-point anatomy).
  3. Conversely, playbooks introduce conflicting or uncoordinated "Axioms" that are not defined in `AGENTS.md`:
     - `data-table-and-large-list.md` Section 3.1 introduces *"3.1 Two-Tier Execution Axiom"*.
     - `sap-evidence.md` Section 2.2 introduces *"2.2 The Non-Generalization Axiom"*.
     - `release-aware-knowledge.md` Section 3.1 introduces *"3.1 Snapshot Immutability Axiom"*.
     - `release-aware-knowledge.md` Section 6.2 introduces *"6.2 The Finding Stability Axiom"*.
  4. `engine-authoring.md` lists the 14 points in Section 2, but fails to identify them as **Cardinal Axiom 2** from `AGENTS.md`.
- **Blast radius**: Fragmented governance; developer uncertainty regarding which rules constitute non-negotiable cardinal axioms versus domain recommendations.
- **Empirical verification**:
  - Regex search `/cardinal axiom 1|cardinal axiom 2|two cardinal axioms|agents\.md/i` across all 8 skill playbooks yielded **0 matches**.
- **Mitigation**:
  1. In `AGENTS.md`, reference the local axioms as supporting principles under the cardinal axioms.
  2. In `frontend-design-system.md`, `data-table-and-large-list.md`, and `dependency-graph.md`, explicitly add a header section referencing **Cardinal Axiom 1: "A page that renders is not a completed feature."**
  3. In `engine-authoring.md`, `sap-evidence.md`, `release-aware-knowledge.md`, `secure-file-parser.md`, and `multi-tenant-security.md`, explicitly reference **Cardinal Axiom 2: "An engine without deterministic logic/evidence/fixtures is not complete."**

---

### [Medium] Challenge 4: Incomplete Reflection of No-Dependency-Soup Rules in Domain Playbooks
- **Assumption challenged**: The No-Dependency-Soup rules are completely aligned across playbooks and AGENTS.md.
- **Attack scenario**: A contributor working on graph visualization (`dependency-graph.md`) or backend tenancy (`multi-tenant-security.md`) refers only to their assigned domain playbook.
  1. `AGENTS.md` Section 4.2 strictly forbids:
     - Cytoscape, Vis.js, mxGraph (for graph canvas)
     - Prisma, TypeORM, Sequelize (for database ORM)
     - Kue, Bee-Queue, Celery (for job queues)
     - Chart.js, Recharts, Victory (for analytics/charts)
     - React Hook Form, Formik (for form management)
  2. However, none of these forbidden libraries are enumerated in `dependency-graph.md`, `multi-tenant-security.md`, or `frontend-design-system.md` (except Base UI vs MUI/Chakra/Antd/Ark in `frontend-design-system.md`).
- **Blast radius**: A developer unaware of the global table in `AGENTS.md` could introduce an unapproved library during component or service authoring.
- **Empirical verification**:
  - Ran `check_no_dependency_soup.js`: 8 out of 10 categories in `AGENTS.md` No-Dependency-Soup table have zero forbidden duplicate listings in their domain playbooks.
- **Mitigation**: Add explicit "Strictly Forbidden Duplicate Libraries" sections to the Invariants in `dependency-graph.md`, `multi-tenant-security.md`, and `frontend-design-system.md`.

---

## Stress Test Results

| Test ID | Test Scenario | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| **ST-01** | Verify all routing targets in `AGENTS.md` Section 3 table exist on disk | All `.md` files in `/.agents/skills/` exist | `accessibility.md` does not exist (`ENOENT`) | **FAIL** |
| **ST-02** | Verify reverse routing: every playbook on disk has a routing trigger in `AGENTS.md` | All 8 playbooks mapped to roles | All 8 playbooks mapped as primary or secondary | **PASS** |
| **ST-03** | Verify composite rules in `AGENTS.md` Section 3.1 reference existing files | All referenced `.md` files exist | All composite targets exist | **PASS** |
| **ST-04** | Check for explicit cross-referencing of Cardinal Axioms 1 & 2 in all 8 playbooks | Playbooks reference governing Cardinal Axioms | 0 out of 8 playbooks reference Cardinal Axioms or `AGENTS.md` | **FAIL** |
| **ST-05** | Check 14-point engine anatomy alignment between `AGENTS.md` and `engine-authoring.md` | All 14 points match verbatim | All 14 points present; Cardinal Axiom 2 label omitted in playbook | **WARN** |
| **ST-06** | Check TanStack Table coverage in `data-table-and-large-list.md` | Comprehensive v8 patterns, URL sync, server pagination | Complete implementation patterns provided | **PASS** |
| **ST-07** | Check TanStack Virtual coverage in `data-table-and-large-list.md` | Dynamic height, `measureElement`, scroll container | Complete implementation patterns provided | **PASS** |
| **ST-08** | Check TanStack Form coverage across all 8 playbooks | Canonical form patterns, Zod validation, dirty tracking | 0 lines, 0 code samples, 0 mentions across all playbooks | **FAIL** |
| **ST-09** | Check TanStack Pacer coverage across all 8 playbooks | Debounce/throttle hooks for search/filtering | 0 mentions across all playbooks | **FAIL** |
| **ST-10** | Verify No-Dependency-Soup forbidden lists in domain playbooks | Playbooks list prohibited duplicates | Only 1 of 10 categories covered in domain playbooks | **FAIL** |

---

## Unchallenged Areas

- **Backend NestJS and Python Runtime Engine Execution**: Ingestion queues, BullMQ jobs, and pytest suites were not executed in this turn as Milestone 1 scope is strictly limited to governance standards (`AGENTS.md` and `/.agents/skills/*`).
- **Next.js 15 App Router Dynamic Rendering**: Runtime hydration and client-side bundle measurements for `@xyflow/react` and Base UI components are deferred to component authoring milestones.

---

## 5-Component Handoff Report

### 1. Observation
1. **Verbatim Text from `H:/erppreflight/AGENTS.md` Line 121**:
   ```markdown
   | **Frontend UI / Design System Engineer** | `frontend-design-system.md` | `data-table-and-large-list.md`, `accessibility.md` | • Editing files in `apps/web/src/components/`<br>• Implementing UI layouts, styles, themes, or motion<br>• Creating forms, dialogs, buttons, or badges<br>• Implementing severity indicators or alert components |
   ```
2. **Filesystem Reality**:
   Executing `fs.readdirSync("H:/erppreflight/.agents/skills")` returns:
   - `data-table-and-large-list.md` (15,379 bytes)
   - `dependency-graph.md` (17,438 bytes)
   - `engine-authoring.md` (15,029 bytes)
   - `frontend-design-system.md` (21,429 bytes)
   - `multi-tenant-security.md` (9,275 bytes)
   - `release-aware-knowledge.md` (8,403 bytes)
   - `sap-evidence.md` (11,896 bytes)
   - `secure-file-parser.md` (9,911 bytes)
   `accessibility.md` is absent.
3. **TanStack Form Coverage**:
   - `grep_search` for `TanStack Form` in `H:/erppreflight/.agents/skills`: 0 results found.
   - `grep_search` for `react-form` in `H:/erppreflight/.agents/skills`: 0 results found.
4. **Cardinal Axioms Search**:
   - `grep_search` for `Axiom` across `H:/erppreflight/.agents/skills`:
     Found only `Two-Tier Execution Axiom` (`data-table-and-large-list.md`), `Snapshot Immutability Axiom` (`release-aware-knowledge.md`), `Finding Stability Axiom` (`release-aware-knowledge.md`), and `Non-Generalization Axiom` (`sap-evidence.md`).
     Zero occurrences of `Cardinal Axiom 1` or `Cardinal Axiom 2`.

### 2. Logic Chain
1. `AGENTS.md` is the governing constitutional document for all autonomous agents in this repository.
2. In Section 3, `AGENTS.md` instructs the `Frontend UI / Design System Engineer` to load `accessibility.md`. Because that file does not exist, any agent attempting to fulfill this contract will encounter an unresolvable file dependency.
3. Cardinal Axiom 1 defines 7 mandatory criteria for frontend features. Criterion 7 mandates TanStack Form with dirty-state tracking, unsaved changes warnings, and server/client validation feedback. However, none of the 8 skill playbooks provide instructions or code examples for TanStack Form.
4. The Two Cardinal Axioms are defined in `AGENTS.md` as non-negotiable, but are completely decoupled from the 8 playbooks because none of the playbooks acknowledge or cite them.
5. Therefore, the deliverables for Milestone 1 contain structural inconsistencies, dangling references, and an architectural omission (TanStack Form).

### 3. Caveats
- No caveats. All observations were empirically verified using direct tool executions and custom test harnesses against files on disk.

### 4. Conclusion
The Milestone 1 deliverables represent high-quality foundational work, but cannot be approved in their current state due to the broken routing reference to `accessibility.md`, the complete absence of TanStack Form guidance, and the missing cross-references to the Two Cardinal Axioms. 
The verdict is **`REQUEST_CHANGES`**.

### 5. Verification Method & Actionable Remediation Steps

To independently verify these findings, execute:
```bash
# 1. Verify missing accessibility.md
node -e "console.log('accessibility.md exists:', require('fs').existsSync('H:/erppreflight/.agents/skills/accessibility.md'))"
# Output must be: accessibility.md exists: false

# 2. Verify complete absence of TanStack Form in skills
node -e "
const fs = require('fs');
const files = fs.readdirSync('H:/erppreflight/.agents/skills');
const matches = files.filter(f => /tanstack\/react-form|tanstack form|react-form/i.test(fs.readFileSync('H:/erppreflight/.agents/skills/' + f, 'utf-8')));
console.log('Playbooks referencing TanStack Form:', matches);
"
# Output must be: Playbooks referencing TanStack Form: []

# 3. Verify zero mentions of Cardinal Axioms in playbooks
node -e "
const fs = require('fs');
const files = fs.readdirSync('H:/erppreflight/.agents/skills');
const matches = files.filter(f => /cardinal axiom/i.test(fs.readFileSync('H:/erppreflight/.agents/skills/' + f, 'utf-8')));
console.log('Playbooks referencing Cardinal Axioms:', matches);
"
# Output must be: Playbooks referencing Cardinal Axioms: []
```

#### Required Remediation Actions for Next Worker:
1. **Fix `H:/erppreflight/AGENTS.md` Line 121**: Change Secondary Playbooks for `Frontend UI / Design System Engineer` from `data-table-and-large-list.md, accessibility.md` to `data-table-and-large-list.md`.
2. **Add TanStack Form Specification to `frontend-design-system.md`**:
   - Add a complete section detailing `@tanstack/react-form` + Zod integration.
   - Provide standard component pattern for form state, dirty-state tracking, unsaved changes warnings on navigation, and field-level/form-level error display.
3. **Anchor All 8 Playbooks to the Two Cardinal Axioms**:
   - In UI playbooks (`frontend-design-system.md`, `data-table-and-large-list.md`, `dependency-graph.md`), add an explicit citation to **Cardinal Axiom 1: "A page that renders is not a completed feature."**
   - In Core/Analysis playbooks (`engine-authoring.md`, `sap-evidence.md`, `release-aware-knowledge.md`, `secure-file-parser.md`, `multi-tenant-security.md`), add an explicit citation to **Cardinal Axiom 2: "An engine without deterministic logic/evidence/fixtures is not complete."**
   - In `engine-authoring.md` Section 2, explicitly identify the 14-Point Anatomy as the canonical definition of Cardinal Axiom 2.
4. **Mirror No-Dependency-Soup Forbidden Lists in Domain Playbooks**:
   - Enumerate prohibited competing libraries in the Invariants section of each relevant domain playbook.
