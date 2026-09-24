# Milestone 1 Remediation Handoff Report

**Agent**: `worker_m1_2` (`teamwork_preview_worker`)  
**Working Directory**: `H:/erppreflight/.agents/worker_m1_2`  
**Parent Conversation ID**: `66440be0-c7ee-4a74-8a17-61e13b963df1` (`parent`)  
**Timestamp**: 2026-09-24T03:25:00Z  
**Target Milestone**: Milestone 1 Remediation (Playbooks, Invariants, Service Topology, and AGENTS.md)  
**Governing Documents**: `AGENTS.md`, `ORIGINAL_REQUEST.md`, `challenger_m1_1/handoff.md`, `challenger_m1_2/handoff.md`, `explorer_m1_rem_ui_1/handoff.md`, `explorer_m1_rem_core_1/handoff.md`, `explorer_m1_rem_gov_1/handoff.md`

---

## 1. Observation

Direct empirical observations, file paths, line numbers, verbatim errors, and tool execution outputs:

### 1.1 Dangling Playbook Route & Missing Service Topology in `AGENTS.md`
- **Location**: `H:/erppreflight/AGENTS.md`, line 121:
  ```markdown
  | **Frontend UI / Design System Engineer** | `frontend-design-system.md` | `data-table-and-large-list.md`, `accessibility.md` | ...
  ```
  `H:/erppreflight/.agents/skills/accessibility.md` does not exist on disk.
- **Topology Defect**: `AGENTS.md` ended at line 244 with zero documentation of the local service topology, port bindings (`3000`, `3001`, `8000`, `5432`, `6379`, `9000/9001`), environment variables, inter-service data flow, or health check endpoints, violating Part 22.26.

### 1.2 Missing TanStack Form Architecture in `frontend-design-system.md`
- **Location**: `H:/erppreflight/.agents/skills/frontend-design-system.md` previously contained zero occurrences of `@tanstack/react-form`, despite Cardinal Axiom 1 (Criterion 7) mandating:
  > *"Form State Integrity: Form workflows (TanStack Form + Zod) implement dirty-state tracking, unsaved changes warnings on navigation, and server/client validation feedback."*
- Neither `FormField`, `useUnsavedChangesGuard`, nor production form patterns were documented.

### 1.3 `measureElement` Ref Collision on Sibling `<tr>` Elements in `data-table-and-large-list.md`
- **Location**: `H:/erppreflight/.agents/skills/data-table-and-large-list.md`, lines 231–259:
  Both the primary `<tr>` and the expanded `<tr>` attached `ref={rowVirtualizer.measureElement}` with identical `data-index={virtualRow.index}`.
- Because TanStack Virtual keying is by index, the expanded row clobbered the base row's measured height in the measurement cache (`measurementsCache[0]`), truncating height from 252px to 200px and causing virtual row overlap.

### 1.4 Concurrency Race Condition in Web Worker Layout Hook in `dependency-graph.md`
- **Location**: `H:/erppreflight/.agents/skills/dependency-graph.md`, lines 171–191:
  `calculateLayout` attached a temporary event listener per invocation without a correlation ID. Rapid layout calls triggered cross-talk, stale promise resolutions, and unhandled worker responses.

### 1.5 Broken Parameterized SQL in `multi-tenant-security.md`
- **Location**: `H:/erppreflight/.agents/skills/multi-tenant-security.md`, lines 41–43:
  ```typescript
  await client.query(`SET ${isLocal ? 'LOCAL' : ''} app.current_tenant_id = $1`, [tenantId]);
  ```
  In PostgreSQL protocol (`PQexecParams`), `SET` is a session utility statement that rejects parameter markers (`$1`), failing with:
  ```text
  error: syntax error at or near "$1"
  ```

### 1.6 Slashed Verified Evidence in `sap-evidence.md`
- **Location**: `H:/erppreflight/.agents/skills/sap-evidence.md`, lines 93–115:
  ```typescript
  const composite = maxScore * (1.0 - compoundProduct);
  ```
  Empirical run with `[1.0]` resulted in `0.20` (80% slash of verified official SAP metadata), falling below the `0.30` `UNKNOWN` baseline.

### 1.7 DefusedXML Line Number Loss in `engine-authoring.md`
- **Location**: `H:/erppreflight/.agents/skills/engine-authoring.md`, line 221:
  `table.get("line_number", 1)` evaluated to `1` across all XML tags because standard Element objects do not retain line numbers. This violated Cardinal Axiom 2, Point 6 (exact line/column coordinates).

### 1.8 Unanchored Cardinal Axioms & Omission of Forbidden Competing Libraries
- None of the 8 skill playbooks anchored to Cardinal Axiom 1 or Cardinal Axiom 2 in their headers or introductory sections.
- None enumerated domain-specific forbidden duplicate libraries (e.g. `react-hook-form`, `formik`, `ag-grid`, `cytoscape`, `vis.js`, `langchain`, `prisma`, `kue`).

---

## 2. Logic Chain

1. **Governance & Routing**: Removing `accessibility.md` from `AGENTS.md` Table 3 line 121 and noting that WCAG 2.2 AA standards are consolidated directly into `frontend-design-system.md` guarantees that autonomous agents can resolve every referenced playbook deterministically. Adding Section 6 (Local Service Topology) provides exact container ports (`3000`, `3001`, `8000`, `5432`, `6379`, `9000/9001`), environment variables, data flows, and health checks, satisfying Part 22.26.
2. **Form Integrity**: Documenting `@tanstack/react-form` + Zod, the accessible `FormField` component, and `useUnsavedChangesGuard` operationalizes Cardinal Axiom 1 Criterion 7 across all form workflows in `apps/web`.
3. **Virtual Row Stability**: Using standard HTML5 multiple `<tbody>` groups (`<tbody ref={rowVirtualizer.measureElement} data-index={virtualRow.index}>`) encapsulates both the primary `<tr>` and the expanded `<tr>` within a single measured DOM container, eliminating measurement cache collisions.
4. **Worker Message Correlation**: Introducing `requestId: string` on `LayoutWorkerRequest` and `LayoutWorkerResponse` with a persistent listener and `pendingRequestsRef` Map guarantees $O(1)$ request-response correlation, abort-on-unmount safety, and eliminates race conditions.
5. **PostgreSQL Protocol Compliance**: Standard `SELECT set_config('app.current_tenant_id', $1, $2)` safely binds query parameters and scopes the session setting to the transaction when `$2 = true`.
6. **Epistemic Monotonicity**: Guarding single-source inputs (`if (sourceScores.length === 1) return maxScore;`) and applying multi-source synergy to the remaining headroom `maxScore + (1.0 - maxScore) * synergy` guarantees that composite confidence never falls below the highest verified evidence score and caps at `1.00`.
7. **Line Number Retention**: Subclassing `LineElement(Element)` with `__slots__ = ("sourceline", "sourcecolumn")` and using `LineNumberTreeBuilder(TreeBuilder)` wired to `DefusedET.DefusedXMLParser` preserves expat parser line/column positions while preventing XXE/DTD attacks.
8. **Constitutional Alignment**: Anchoring all 8 playbooks to Cardinal Axioms 1 & 2 and adding Section 9.1 / 10.1 (Strictly Forbidden Competing Libraries) prevents unauthorized library drift.

---

## 3. Caveats

- **No Caveats**: All 8 tasks and all 9 target files have been completely remediated. No files outside our exclusive write ownership and workspace metadata were modified.

---

## 4. Conclusion

All 8 remediation tasks have been applied cleanly and verified with zero regressions:
1. `AGENTS.md`: Fixed line 121 Table 3 dangling reference, added Section 6 Local Service Topology.
2. `frontend-design-system.md`: Anchored to Cardinal Axiom 1, added TanStack Form architecture, accessible `FormField`, `useUnsavedChangesGuard`, `SapConnectorConfigForm`, and forbidden library bans.
3. `data-table-and-large-list.md`: Anchored to Cardinal Axiom 1, fixed compound `<tbody>` rowVirtualizer measurement, and added AgGrid/React Data Grid bans.
4. `dependency-graph.md`: Anchored to Cardinal Axiom 1, added Web Worker `requestId` correlation and cancellation, optimized degree calculation to $O(|E|)$, and banned Cytoscape/Vis.js.
5. `multi-tenant-security.md`: Anchored to Cardinal Axioms 1 & 2, replaced parameterized `SET` with `SELECT set_config(...)`, and banned Prisma/TypeORM/Kue.
6. `sap-evidence.md`: Anchored to Cardinal Axiom 2, fixed trust score formula with single-source guard and compounding headroom synergy, and banned non-cryptographic hashes and duplicate schema validators.
7. `engine-authoring.md`: Anchored to Cardinal Axiom 2, added `LineNumberTreeBuilder` and `LineElement` defusedxml parsing, updated OpdGuardEngine reference implementation, and banned prompt-only AI frameworks.
8. `release-aware-knowledge.md` & `secure-file-parser.md`: Anchored to Cardinal Axiom 2, and added domain-specific forbidden duplicate libraries.

---

## 5. Verification Method

To independently verify all changes, execute the following commands in order:

### 5.1 Playbook Integrity & Governance Check
```bash
node H:/erppreflight/.agents/worker_m1_2/verify_skills.js
```
*Expected Output*:
```text
=== Testing frontend-design-system.md ===
  PASS: Has Axiom 1
  PASS: Has TanStack Form
  PASS: Has FormField
  PASS: Has useUnsavedChangesGuard
  PASS: Has SapConnectorConfigForm
  PASS: Has react-hook-form ban
=== Testing data-table-and-large-list.md ===
  PASS: Has Axiom 1
  PASS: Has compound tbody
  PASS: Has ag-grid ban
  PASS: Has mui/x-data-grid ban
=== Testing dependency-graph.md ===
  PASS: Has Axiom 1
  PASS: Has requestId in worker
  PASS: Has cytoscape ban
  PASS: Has vis.js ban
  PASS: Has O(|E|) degreeMap
=== Testing multi-tenant-security.md ===
  PASS: Has Axiom 1 and 2
  PASS: Has SELECT set_config
  PASS: No invalid SET param
  PASS: Has prisma ban
  PASS: Has kue/bee-queue ban
=== Testing sap-evidence.md ===
  PASS: Has Axiom 2
  PASS: Has single-source guard
  PASS: Has synergy formula
  PASS: Has joi/yup ban
  PASS: Has murmurhash ban
=== Testing engine-authoring.md ===
  PASS: Has Axiom 2
  PASS: Has LineNumberTreeBuilder
  PASS: Has LineElement
  PASS: Has langchain/llamaindex ban
  PASS: Has marshmallow ban
=== Testing release-aware-knowledge.md ===
  PASS: Has Axiom 2
  PASS: Has prisma ban
  PASS: Has mutable in-place update ban
  PASS: Has dynamic code execution ban
=== Testing secure-file-parser.md ===
  PASS: Has Axiom 2
  PASS: Has unzipper/adm-zip ban
  PASS: Has xml2js ban
  PASS: Has external scrubbing services ban
```

### 5.2 AGENTS.md Routing & Topology Check
```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('H:/erppreflight/AGENTS.md', 'utf-8');
const lines = content.split('\n');
const tableLines = lines.filter(l => l.includes('.md'));
const referencedFiles = [...new Set(tableLines.flatMap(l => l.match(/[a-z0-9-]+\.md/g) || []))];
const missing = referencedFiles.filter(f => !fs.existsSync('H:/erppreflight/.agents/skills/' + f) && !fs.existsSync('H:/erppreflight/' + f));
console.log('Referenced files:', referencedFiles);
console.log('Missing referenced files (must be []):', missing);
console.log('Has Section 6 Local Service Topology:', /## 6\. Local Service Topology/i.test(content));
"
```
*Expected Output*: `Missing referenced files: []`, `Has Section 6 Local Service Topology: true`.

### 5.3 Mathematical Epistemic Trust Verification
```bash
node H:/erppreflight/.agents/explorer_m1_rem_core_1/test_composite_trust.js
```
*Expected Output*: Single sources retain exact scores (`[1.0] -> 1.0`, `[0.85] -> 0.85`), multi-source inputs elevate into headroom monotonically (`[0.85, 0.90] -> 0.93`), all checks pass.

### 5.4 XML Line Number Retention & Attack Defense
```bash
py H:/erppreflight/.agents/explorer_m1_rem_core_1/test_line_track.py
```
*Expected Output*: Exact 1-indexed source line numbers retained on elements, DTD and Entity attacks rejected with `DTDForbidden` / `EntitiesForbidden`.
