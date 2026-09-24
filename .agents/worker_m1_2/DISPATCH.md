## 2026-09-24T03:15:00Z
You are worker_m1_2, a teamwork_preview_worker.
Your working directory is H:/erppreflight/.agents/worker_m1_2.
You MUST follow the File Workspace Convention: write metadata only in your working directory. For target files, see Exclusive Write Ownership below.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You own exclusively:
1. H:/erppreflight/AGENTS.md
2. H:/erppreflight/.agents/skills/frontend-design-system.md
3. H:/erppreflight/.agents/skills/data-table-and-large-list.md
4. H:/erppreflight/.agents/skills/dependency-graph.md
5. H:/erppreflight/.agents/skills/engine-authoring.md
6. H:/erppreflight/.agents/skills/sap-evidence.md
7. H:/erppreflight/.agents/skills/release-aware-knowledge.md
8. H:/erppreflight/.agents/skills/secure-file-parser.md
9. H:/erppreflight/.agents/skills/multi-tenant-security.md

INPUT BLUEPRINTS:
Read and apply the exact drop-in replacements and architectural additions from:
- H:/erppreflight/.agents/explorer_m1_rem_ui_1/handoff.md
- H:/erppreflight/.agents/explorer_m1_rem_core_1/handoff.md
- H:/erppreflight/.agents/explorer_m1_rem_gov_1/handoff.md

REMEDIATION TASKS:
1. AGENTS.md:
   - Fix line 121 / Table 3: replace dangling reference accessibility.md with data-table-and-large-list.md and frontend-design-system.md.
   - Add Section 6: Local Service Topology (PostgreSQL 5432, Redis 6379, MinIO 9000/9001, analysis-python 8000, API 3001, Web 3000), local environment variables, data flow, and healthchecks.
2. frontend-design-system.md:
   - Add complete TanStack Form (@tanstack/react-form + Zod) architecture section, FormField primitive, useUnsavedChangesGuard, and explicit ban on React Hook Form/Formik.
   - Explicitly anchor header and Section 1 to Cardinal Axiom 1: "A page that renders is not a completed feature."
3. data-table-and-large-list.md:
   - Fix compound <tbody> rowVirtualizer.measureElement layout conflict on expanded detail rows.
   - Anchor to Cardinal Axiom 1. Ban AgGrid, React Data Grid.
4. dependency-graph.md:
   - Add Web Worker requestId correlation and cancel logic.
   - Anchor to Cardinal Axiom 1. Ban Cytoscape, Vis.js.
5. multi-tenant-security.md:
   - Replace parameterized SET app.current_tenant_id = $1 with SELECT set_config('app.current_tenant_id', $1, true).
   - Anchor to Cardinal Axiom 2: "An engine without deterministic logic/evidence/fixtures is not complete."
6. sap-evidence.md:
   - Fix trust score formula with single-source guard `if (sourceScores.length === 1) return maxScore;` and compounding synergy calculation.
   - Anchor to Cardinal Axiom 2.
7. engine-authoring.md:
   - Add LineNumberTreeBuilder and LineElement for defusedxml line number tracking.
   - Anchor to Cardinal Axiom 2.
8. release-aware-knowledge.md and secure-file-parser.md:
   - Anchor to Cardinal Axiom 2 and enumerate domain-specific forbidden duplicate libraries.

VERIFICATION:
Verify all edits are applied cleanly, no broken markdown syntax, no dangling references, and write handoff report to H:/erppreflight/.agents/worker_m1_2/handoff.md. Send a message to parent when done.
