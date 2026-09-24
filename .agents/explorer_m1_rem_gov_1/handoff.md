# Milestone 1 Governance Remediation Blueprint & Technical Handoff Report

**Agent Identifier**: `explorer_m1_rem_gov_1` (`teamwork_preview_explorer`)  
**Workspace**: `H:/erppreflight/.agents/explorer_m1_rem_gov_1`  
**Parent Agent**: `66440be0-c7ee-4a74-8a17-61e13b963df1` (`parent`)  
**Timestamp**: 2026-09-24T03:15:00Z  
**Target Milestone**: Milestone 1 Remediation (Playbooks, Invariants, Service Topology, and AGENTS.md)

---

## 1. Observation

Direct empirical examination of `H:/erppreflight/AGENTS.md` and the 8 skill playbooks in `H:/erppreflight/.agents/skills/` revealed three core structural governance defects:

### 1.1 Complete Absence of Cardinal Axiom Anchoring in Playbooks
- **Inspection of Playbook Headers**: In all 8 files under `H:/erppreflight/.agents/skills/` (`frontend-design-system.md`, `data-table-and-large-list.md`, `dependency-graph.md`, `engine-authoring.md`, `sap-evidence.md`, `release-aware-knowledge.md`, `secure-file-parser.md`, `multi-tenant-security.md`), lines 1–8 declare metadata (`Playbook Identifier`, `Authority`, `Governing Standards`, `Applicable Trigger`), but **none** cite or anchor to **Cardinal Axiom 1** (*"A page that renders is not a completed feature."*) or **Cardinal Axiom 2** (*"An engine without deterministic logic/evidence/fixtures is not complete."*).
- **Grep Confirmation**: Executing regex search `/(cardinal axiom 1|cardinal axiom 2|two cardinal axioms)/i` across `H:/erppreflight/.agents/skills/` returned **0 matches**.
- **Local Pseudo-Axioms**: Playbooks introduce local axioms without linking to root governance (e.g. `data-table-and-large-list.md` line 45: *"Two-Tier Execution Axiom"*; `sap-evidence.md` line 27: *"The Non-Generalization Axiom"*; `release-aware-knowledge.md` line 37: *"Snapshot Immutability Axiom"*). In `engine-authoring.md`, Section 2 details the 14-Point Engine Anatomy verbatim, but omits mentioning that this anatomy is the definition of Cardinal Axiom 2.

### 1.2 Omission of Domain-Specific No-Dependency-Soup Forbidden Libraries
- `AGENTS.md` Section 4.2 defines a centralized 10-row matrix of Approved Standard Libraries vs. Strictly Forbidden Duplicates (e.g., forbidding React Hook Form, Redux, Prisma, Cytoscape, AgGrid, Chart.js, Celery).
- However, inspection of the 8 skill playbooks reveals that their local "Invariants" and "Anti-Patterns" sections fail to enumerate these forbidden competing packages:
  - `data-table-and-large-list.md` (Sections 9 & 10) never mentions `ag-grid-community`, `ag-grid-react`, `@mui/x-data-grid`, or `handsontable`.
  - `dependency-graph.md` (Sections 8 & 9) never mentions `cytoscape`, `vis-network`, `vis.js`, or `mxgraph`.
  - `frontend-design-system.md` (Section 2.1) mentions `@chakra-ui`, `@mui/material`, `antd`, and `ark-ui`, but omits `react-hook-form`, `formik`, `redux`, and `mobx`.
  - `engine-authoring.md` (Sections 9 & 10) omits prohibiting prompt-wrapper frameworks like `langchain`, `llamaindex`, and `crewai` inside analysis loops, and does not explicitly ban direct database ORMs (`sqlalchemy`, `prisma`, `drizzle`) inside pure analysis engines.
  - `multi-tenant-security.md` (Sections 9 & 10) omits explicitly prohibiting competing ORMs (`prisma`, `typeorm`, `sequelize`) and TS queue alternatives (`kue`, `bee-queue`).

### 1.3 Missing Local Service Topology in `AGENTS.md`
- Part 22.26 (`22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md`) explicitly mandates:
  > *"Create AGENTS.md with: product principles, monorepo map, commands, quality gates, skill routing table, forbidden shortcuts, definition of done, test commands, local services."*
- `AGENTS.md` ends at line 244 (Section 5.3 Definition of Done). It references `infra/coolify/docker-compose.coolify.yml` in line 81, but contains **zero documentation of the local service topology**, port bindings, service aliases, health check endpoints, or inter-service network communication flow.

### 1.4 Dangling Route in `AGENTS.md` Table 3
- In `AGENTS.md` line 121 (Section 3 Table):
  ```markdown
  | **Frontend UI / Design System Engineer** | `frontend-design-system.md` | `data-table-and-large-list.md`, `accessibility.md` | ...
  ```
  `H:/erppreflight/.agents/skills/accessibility.md` does not exist on disk (`fs.existsSync` is `false`).

---

## 2. Logic Chain

1. **Constitutional Hierarchy & Context Bounding**: Autonomous agents are dispatched with specific role triggers (e.g. `Data Grid & Large List Engineer`). To conserve token context, agents primarily read their assigned playbook. If a playbook does not state which Cardinal Axiom governs it, an agent cannot determine which architectural quality gates will fail during code review.
2. **Local Anti-Pattern Enforcement**: Banning libraries only in `AGENTS.md` is insufficient because an agent authoring a data table reads `data-table-and-large-list.md`. If that playbook fails to warn against `ag-grid` or `react-window`, the agent is vulnerable to introducing duplicate packages that bloat bundle size and fail automated CI linter checks.
3. **Operational Clarity**: Milestone 2 and subsequent implementation milestones involve parallel execution of backend NestJS APIs, frontend Next.js App Router views, and Python FastAPI analysis engines. Without a clear local service topology documenting exact hostnames, local development ports (`3000`, `3001`, `8000`, `5432`, `6379`, `9000/9001`), database credentials, and health check endpoints, agents will guess connection strings, introduce port collisions, and fail end-to-end integration tests.
4. **Resolution Strategy**:
   - Part A: Inject explicit Cardinal Axiom anchoring headers and contextual subsections into all 8 playbooks.
   - Part B: Inject explicit "Strictly Forbidden Competing Libraries" tables and anti-pattern blocks into all 8 playbooks.
   - Part C: Append Section 6 ("Local Service Topology & Development Environment") to `AGENTS.md` and remove the dangling `accessibility.md` reference from Table 3 line 121.

---

## 3. Caveats

1. **Read-Only Explorer Scope**: As an explorer agent, this report provides exact, copy-paste ready technical fix blueprints and diff specifications. Implementation must be performed by the designated remediation worker.
2. **Coordinated Remediation Scope**: This blueprint covers Mission Items 1, 2, and 3. Additional specific findings from `challenger_m1_1` and `challenger_m1_2` (such as the trust score synergy math in `sap-evidence.md`, PostgreSQL `set_config` in `multi-tenant-security.md`, XML line number extraction in `engine-authoring.md`, and TanStack Form documentation in `frontend-design-system.md`) must be applied in parallel by the remediation worker.

---

## 4. Conclusion & Technical Remediation Blueprints

Below are the complete, actionable before/after technical blueprints for implementation.

```
================================================================================
PART A: CROSS-PLAYBOOK CARDINAL AXIOMS ANCHORING BLUEPRINTS
================================================================================
```

### A.1 Playbook: `/.agents/skills/frontend-design-system.md`
- **Anchoring**: **Cardinal Axiom 1: *"A page that renders is not a completed feature."*** (Criteria 1–7)
- **Header Modification** (Lines 1–7):
  ```markdown
  <<<< BEFORE
  # ERP Preflight Engineering Playbook: Frontend Design System & Component Architecture

  > **Playbook Identifier**: `frontend-design-system`  
  > **Authority**: Binding architectural playbook for `apps/web` and all UI package authoring.  
  > **Governing Standards**: WCAG 2.2 AA, Next.js 15+ App Router, React 19, Tailwind CSS, shadcn/ui on Base UI primitives.  
  > **Applicable Trigger**: Any frontend task, page implementation, component authoring, theme modification, CSS/styling change, or accessibility enhancement in `apps/web`.
  ====
  # ERP Preflight Engineering Playbook: Frontend Design System & Component Architecture

  > **Playbook Identifier**: `frontend-design-system`  
  > **Authority**: Binding architectural playbook for `apps/web` and all UI package authoring.  
  > **Governing Standards**: WCAG 2.2 AA, Next.js 15+ App Router, React 19, Tailwind CSS, shadcn/ui on Base UI primitives.  
  > **Anchored Cardinal Axiom**: **Cardinal Axiom 1: *"A page that renders is not a completed feature."*** (Defined in `AGENTS.md` Section 1)  
  > **Applicable Trigger**: Any frontend task, page implementation, component authoring, theme modification, CSS/styling change, or accessibility enhancement in `apps/web`.
  >>>>
  ```
- **Section 1 Addition** (Insert after Line 20):
  ```markdown
  ### 1.1 Cardinal Axiom 1 Anchoring: UI & Feature Completeness
  This playbook directly enforces **Cardinal Axiom 1** from `AGENTS.md` Section 1. A user interface that renders visual elements is an incomplete prototype. A frontend feature is considered complete **only** when all 7 criteria are met:
  1. **Real Data & Server State**: Integrated with TanStack Query fetching from backend endpoints or typed mock contracts (via Orval). No hardcoded client-side dummy arrays.
  2. **Runtime Schema Validation**: All external inputs, form submissions, and API payloads validated via Zod 4 schemas.
  3. **Error Boundaries & Resilience**: Comprehensive contextual error states, query retry policies, and user-actionable retry triggers.
  4. **Loading & Empty States**: Polished loading skeletons (matching exact content layout without layout shifts) and informative empty states with clear CTAs.
  5. **Accessible Severity Representation**: Severity indicators (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `LOW`, `INFO`) must **never** rely on color alone; they must pair color with textual badges and icons.
  6. **Interaction & Motion Discipline**: WCAG 2.2 AA keyboard accessible, fully responsive across desktop/mobile, and compliant with `prefers-reduced-motion`.
  7. **Form State Integrity**: Form workflows (TanStack Form + Zod) implement dirty-state tracking, unsaved changes warnings on navigation, and server/client validation feedback.
  ```

---

### A.2 Playbook: `/.agents/skills/data-table-and-large-list.md`
- **Anchoring**: **Cardinal Axiom 1: *"A page that renders is not a completed feature."*** (Criteria 1, 3, 4, 5, 6)
- **Header Modification** (Lines 1–7):
  ```markdown
  <<<< BEFORE
  # ERP Preflight Engineering Playbook: Enterprise Data Table & Large List Virtualization

  > **Playbook Identifier**: `data-table-and-large-list`  
  > **Authority**: Binding architectural playbook for all tabular data grids, finding tables, SAP object catalogs, and event streams.  
  > **Governing Standards**: TanStack Table v8, TanStack Virtual v3, Next.js 15+ App Router, WCAG 2.2 AA.  
  > **Applicable Trigger**: Creating or maintaining data grids, finding tables, SAP object inventories, migration catalogs, admin user tables, or MFS telegram logs.
  ====
  # ERP Preflight Engineering Playbook: Enterprise Data Table & Large List Virtualization

  > **Playbook Identifier**: `data-table-and-large-list`  
  > **Authority**: Binding architectural playbook for all tabular data grids, finding tables, SAP object catalogs, and event streams.  
  > **Governing Standards**: TanStack Table v8, TanStack Virtual v3, Next.js 15+ App Router, WCAG 2.2 AA.  
  > **Anchored Cardinal Axiom**: **Cardinal Axiom 1: *"A page that renders is not a completed feature."*** (Defined in `AGENTS.md` Section 1)  
  > **Applicable Trigger**: Creating or maintaining data grids, finding tables, SAP object inventories, migration catalogs, admin user tables, or MFS telegram logs.
  >>>>
  ```
- **Section 1 Addition** (Insert after Line 19):
  ```markdown
  ### 1.1 Cardinal Axiom 1 Anchoring: Tabular Data Completeness
  This playbook operationalizes **Cardinal Axiom 1** for tabular data grids. Rendering static rows or dumping 10,000 DOM elements is an incomplete, defective implementation. A data grid feature is complete **only** when:
  - Backend pagination, multi-column sorting, and facet filtering are bound to URL query parameters via TanStack Query.
  - Virtualization via `@tanstack/react-virtual` limits the active DOM footprint to ~30 rows regardless of dataset scale.
  - Loading skeletons preserve exact table column geometry, avoiding cumulative layout shift (CLS).
  - Row severity displays pair color tokens with explicit icons and text.
  - Keyboard navigation (`ArrowDown`, `ArrowUp`, `Space`, `Enter`) and screen reader ARIA landmarks (`role="region"`, `role="grid"`) are fully operable.
  ```

---

### A.3 Playbook: `/.agents/skills/dependency-graph.md`
- **Anchoring**: **Cardinal Axiom 1: *"A page that renders is not a completed feature."*** (Criteria 3, 4, 5, 6)
- **Header Modification** (Lines 1–7):
  ```markdown
  <<<< BEFORE
  # ERP Preflight Engineering Playbook: Interactive Dependency Graph & Impact Visualization

  > **Playbook Identifier**: `dependency-graph`  
  > **Authority**: Binding architectural playbook for all structural dependency graphs, transport lineage, custom field flows, and impact visualization.  
  > **Governing Standards**: React Flow (`@xyflow/react` v12), ELK.js layout engine, Next.js 15+ App Router, WCAG 2.2 AA.  
  > **Applicable Trigger**: Creating or modifying dependency viewers, impact analyzers, custom field propagation graphs, transport analyzers, API relationship diagrams, or MFS causal flow trees.
  ====
  # ERP Preflight Engineering Playbook: Interactive Dependency Graph & Impact Visualization

  > **Playbook Identifier**: `dependency-graph`  
  > **Authority**: Binding architectural playbook for all structural dependency graphs, transport lineage, custom field flows, and impact visualization.  
  > **Governing Standards**: React Flow (`@xyflow/react` v12), ELK.js layout engine, Next.js 15+ App Router, WCAG 2.2 AA.  
  > **Anchored Cardinal Axiom**: **Cardinal Axiom 1: *"A page that renders is not a completed feature."*** (Defined in `AGENTS.md` Section 1)  
  > **Applicable Trigger**: Creating or modifying dependency viewers, impact analyzers, custom field propagation graphs, transport analyzers, API relationship diagrams, or MFS causal flow trees.
  >>>>
  ```
- **Section 1 Addition** (Insert after Line 20):
  ```markdown
  ### 1.1 Cardinal Axiom 1 Anchoring: Non-Blocking, Accessible Visualization
  This playbook operationalizes **Cardinal Axiom 1** for complex relationship graphs. A graphical canvas alone is an incomplete prototype. A graph feature is complete **only** when:
  - Heavy graph bundles (`@xyflow/react`, `elkjs`) are dynamically code-split with layout-preserving loading skeletons.
  - Graph layout computation is offloaded to a Web Worker to ensure zero UI thread frame drops.
  - Canvas nodes and inspectors display accessible, non-color severity indicators.
  - A synchronized, keyboard-accessible table fallback (`DependencyTableFallback`) is provided to guarantee full WCAG 2.2 AA compliance for keyboard and screen-reader users.
  ```

---

### A.4 Playbook: `/.agents/skills/engine-authoring.md`
- **Anchoring**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (14-Point Anatomy)
- **Header Modification** (Lines 1–7):
  ```markdown
  <<<< BEFORE
  # SAP Preflight Engine Authoring & Execution Standard Playbook

  > **Playbook Identifier**: `engine-authoring`  
  > **Authority**: Binding architectural specification across all 18 SAP Preflight Engines and platform analysis modules.  
  > **Governing Standards**: Part 22.4, Part 17 Trust AI, Python 3.13 FastAPI, Pydantic, Zod, pytest, Hypothesis.  
  > **Applicable Trigger**: Any implementation, modification, refactoring, or testing of an analysis engine or parser in `services/analysis-python` or TypeScript analysis packages.
  ====
  # SAP Preflight Engine Authoring & Execution Standard Playbook

  > **Playbook Identifier**: `engine-authoring`  
  > **Authority**: Binding architectural specification across all 18 SAP Preflight Engines and platform analysis modules.  
  > **Governing Standards**: Part 22.4, Part 17 Trust AI, Python 3.13 FastAPI, Pydantic, Zod, pytest, Hypothesis.  
  > **Anchored Cardinal Axiom**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Defined in `AGENTS.md` Section 1)  
  > **Applicable Trigger**: Any implementation, modification, refactoring, or testing of an analysis engine or parser in `services/analysis-python` or TypeScript analysis packages.
  >>>>
  ```
- **Section 2 Modification** (Lines 18–21):
  ```markdown
  <<<< BEFORE
  ## 2. The 14-Point Engine Anatomy Specification

  Every engine implementation within `services/analysis-python/src/engines/` must implement all 14 points without exception:
  ====
  ## 2. Cardinal Axiom 2 & The 14-Point Engine Anatomy Specification

  Section 1 of `AGENTS.md` defines **Cardinal Axiom 2**: *"An engine without deterministic logic/evidence/fixtures is not complete."* A preflight analysis engine is not a prompt wrapper or heuristic script. Every engine within `services/analysis-python/src/engines/` must implement all 14 points below to achieve preflight certification:
  >>>>
  ```

---

### A.5 Playbook: `/.agents/skills/sap-evidence.md`
- **Anchoring**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Points 5, 6, 7)
- **Header Modification** (Lines 1–7):
  ```markdown
  <<<< BEFORE
  # SAP Evidence, Fact Verification, and Provenance Playbook

  > **Playbook Identifier**: `sap-evidence`  
  > **Authority**: Binding architectural specification for evidence extraction, Clean Core classification, trust scoring, and release alignment.  
  > **Governing Standards**: Part 22.5, Part 17 Trust AI, SAP Clean Core Extensibility Model, packages/evidence.  
  > **Applicable Trigger**: Collecting evidence, establishing source citations, calculating confidence, classifying Clean Core tiers, or aligning releases.
  ====
  # SAP Evidence, Fact Verification, and Provenance Playbook

  > **Playbook Identifier**: `sap-evidence`  
  > **Authority**: Binding architectural specification for evidence extraction, Clean Core classification, trust scoring, and release alignment.  
  > **Governing Standards**: Part 22.5, Part 17 Trust AI, SAP Clean Core Extensibility Model, packages/evidence.  
  > **Anchored Cardinal Axiom**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Points 5, 6, 7 — Taxonomy, Cryptographic Evidence & Epistemic Confidence)  
  > **Applicable Trigger**: Collecting evidence, establishing source citations, calculating confidence, classifying Clean Core tiers, or aligning releases.
  >>>>
  ```
- **Section 1 Addition** (Insert after Line 15):
  ```markdown
  ### 1.1 Cardinal Axiom 2 Anchoring: Cryptographic Grounding & Epistemic Honesty
  This playbook operationalizes Points 5, 6, and 7 of **Cardinal Axiom 2** (`AGENTS.md` Section 1):
  - **Point 5 (Finding Taxonomy)**: Every defect must map to a deterministic, structured finding code.
  - **Point 6 (Cryptographic Evidence Chains)**: Every finding must reference concrete evidence items containing artifact path, exact line and column numbers, code snippet, artifact SHA-256 hash, and provenance score. Unsubstantiated warnings are strictly forbidden.
  - **Point 7 (Confidence Classification)**: Explicit assignment to one of four strict classes: `VERIFIED` (1.0), `RULE_DERIVED` (0.85), `INFERRED` (0.60), or `UNKNOWN` (0.30). LLM assistance is strictly capped at `INFERRED` (0.60), and missing evidence triggers automatic demotion to `UNKNOWN` (0.30).
  ```

---

### A.6 Playbook: `/.agents/skills/release-aware-knowledge.md`
- **Anchoring**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Points 1, 4, 12)
- **Header Modification** (Lines 1–7):
  ```markdown
  <<<< BEFORE
  # Release-Aware Knowledge Base & Rule Lifecycle Governance Playbook

  > **Playbook Identifier**: `release-aware-knowledge`  
  > **Authority**: Binding architectural specification for knowledge base curation, SPRO/CBC catalogs, deprecation databases, rule bundles, and release lifecycle management.  
  > **Governing Standards**: Part 22.6, Part 17 Trust AI, S/4HANA Cloud quarterly release governance.  
  > **Applicable Trigger**: Ingesting SAP release notes, updating mapping databases, releasing new rule bundles, or modifying the support matrix.
  ====
  # Release-Aware Knowledge Base & Rule Lifecycle Governance Playbook

  > **Playbook Identifier**: `release-aware-knowledge`  
  > **Authority**: Binding architectural specification for knowledge base curation, SPRO/CBC catalogs, deprecation databases, rule bundles, and release lifecycle management.  
  > **Governing Standards**: Part 22.6, Part 17 Trust AI, S/4HANA Cloud quarterly release governance.  
  > **Anchored Cardinal Axiom**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Points 1, 4, 12 — Versioned Metadata, Pure Rule Reproducibility & Report Lineage)  
  > **Applicable Trigger**: Ingesting SAP release notes, updating mapping databases, releasing new rule bundles, or modifying the support matrix.
  >>>>
  ```
- **Section 1 Addition** (Insert after Line 15):
  ```markdown
  ### 1.1 Cardinal Axiom 2 Anchoring: Knowledge Immutability & Audit Defense
  This playbook guarantees that **Cardinal Axiom 2** holds over multi-year enterprise migration timelines:
  - Deterministic pure evaluation (Point 4) requires that identical inputs produce identical findings today, tomorrow, and years from now.
  - By binding all analysis executions to an immutable, cryptographically signed knowledge snapshot (`snapshot_id`) with source checksums (Point 1), this playbook eliminates probabilistic drift and silent rule mutation.
  ```

---

### A.7 Playbook: `/.agents/skills/secure-file-parser.md`
- **Anchoring**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Points 2, 3, 6)
- **Header Modification** (Lines 1–7):
  ```markdown
  <<<< BEFORE
  # Secure Ingestion Pipeline & Hardened File Parsing Playbook

  > **Playbook Identifier**: `secure-file-parser`  
  > **Authority**: Binding architectural specification for file ingestion, MIME validation, archive extraction, XML/JSON parsing, and secret scrubbing.  
  > **Governing Standards**: Part 22.7, OWASP Top 10, CWE-22 (Path Traversal), CWE-611 (XXE), CWE-400 (Resource Exhaustion).  
  > **Applicable Trigger**: Handling user uploads, reading uncompressed byte streams, extracting archives, or parsing structured customer data.
  ====
  # Secure Ingestion Pipeline & Hardened File Parsing Playbook

  > **Playbook Identifier**: `secure-file-parser`  
  > **Authority**: Binding architectural specification for file ingestion, MIME validation, archive extraction, XML/JSON parsing, and secret scrubbing.  
  > **Governing Standards**: Part 22.7, OWASP Top 10, CWE-22 (Path Traversal), CWE-611 (XXE), CWE-400 (Resource Exhaustion).  
  > **Anchored Cardinal Axiom**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Points 2, 3, 6 — Input Validation, Memory-Bounded Parsers & Line Number Retention)  
  > **Applicable Trigger**: Handling user uploads, reading uncompressed byte streams, extracting archives, or parsing structured customer data.
  >>>>
  ```
- **Section 1 Addition** (Insert after Line 20):
  ```markdown
  ### 1.1 Cardinal Axiom 2 Anchoring: Hardened Input Parsing & Coordinate Integrity
  This playbook directly enforces Points 2, 3, and 6 of **Cardinal Axiom 2**:
  - **Point 2 (Input Schema)**: Strict validation of incoming archives and files before routing to parsers.
  - **Point 3 (Deterministic Parser)**: Hardened, memory-bounded artifact parsing (XML, JSON, CSV, ABAP, XDP) rejecting malformed inputs, zip bombs, and XXE attacks.
  - **Point 6 (Evidence Coordinates)**: Parsers must retain exact line numbers, column numbers, and byte offsets so downstream engines can construct cryptographic evidence chains without falling back to line 1.
  ```

---

### A.8 Playbook: `/.agents/skills/multi-tenant-security.md`
- **Anchoring**: **Cardinal Axiom 1 (Criterion 1: SSR Cache Isolation)** & **Cardinal Axiom 2 (Points 2 & 12: Tenant-Isolated Data Pipelines)**
- **Header Modification** (Lines 1–7):
  ```markdown
  <<<< BEFORE
  # Multi-Tenant Isolation, Data Segregation & Security Playbook

  > **Playbook Identifier**: `multi-tenant-security`  
  > **Authority**: Binding architectural specification across all API endpoints, database queries, object storage, caching, background queues, and frontend tenant lifecycles.  
  > **Governing Standards**: Part 22.8, Part 21, PostgreSQL Row-Level Security (RLS), TanStack Query SSR safety.  
  > **Applicable Trigger**: Creating or modifying any route, database query, schema, background job, cache key, storage artifact, or auth flow.
  ====
  # Multi-Tenant Isolation, Data Segregation & Security Playbook

  > **Playbook Identifier**: `multi-tenant-security`  
  > **Authority**: Binding architectural specification across all API endpoints, database queries, object storage, caching, background queues, and frontend tenant lifecycles.  
  > **Governing Standards**: Part 22.8, Part 21, PostgreSQL Row-Level Security (RLS), TanStack Query SSR safety.  
  > **Anchored Cardinal Axioms**: **Cardinal Axiom 1 (Criterion 1: Multi-Tenant SSR Isolation)** & **Cardinal Axiom 2 (Points 2 & 12: Tenant-Isolated Storage & Finding Serialization)**  
  > **Applicable Trigger**: Creating or modifying any route, database query, schema, background job, cache key, storage artifact, or auth flow.
  >>>>
  ```
- **Section 1 Addition** (Insert after Line 17):
  ```markdown
  ### 1.1 Cardinal Axioms Anchoring: Zero-Trust Multi-Tenant Boundaries
  This playbook provides the isolation infrastructure required by both Cardinal Axioms:
  - **Axiom 1 (Frontend)**: Criterion 1 requires per-request SSR `QueryClient` isolation and immediate cache wiping on tenant switch/logout to prevent cross-tenant data leakage in UI views.
  - **Axiom 2 (Engines & Storage)**: Points 2 and 12 require that customer artifacts, analysis queues, and persisted findings operate within strict cryptographic and database tenant boundaries (PostgreSQL RLS, S3 prefix scoping `/tenants/{orgId}/projects/{projId}/`).
  ```

---

```
================================================================================
PART B: NO-DEPENDENCY-SOUP ANTI-PATTERNS SPECIFICATIONS
================================================================================
```

Every playbook must contain an explicit subsection under its Invariants or Anti-Patterns detailing the forbidden competing libraries for its operational domain, linking directly to Part 21.42 and `AGENTS.md` Section 4.2.

### B.1 `frontend-design-system.md`
Add to Section 9 / 10:
```markdown
### 9.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
To prevent bundle bloat, state synchronization failures, and dependency conflicts, the following libraries are strictly prohibited in `apps/web`:
- ❌ **Form Management**: `react-hook-form`, `formik` (Standard: `@tanstack/react-form` + `zod`).
- ❌ **Client State Management**: `redux`, `@reduxjs/toolkit`, `mobx`, `recoil`, `jotai` (Standard: URL Search Params + React state / scoped Zustand).
- ❌ **Server State & Caching**: `swr`, `@reduxjs/toolkit/query`, `apollo-client` (Standard: `@tanstack/react-query`).
- ❌ **UI Primitives**: `@chakra-ui/*`, `@mui/*`, `antd`, `@ark-ui/*`, raw `@radix-ui/react-*` for new components (Standard: Base UI `@base-ui-components/react` + shadcn/ui).
- ❌ **Application Routing**: `@tanstack/react-router`, `tanstack/start` (Standard: Next.js 15 App Router).
- ❌ **Animation**: `gsap`, `animejs`, legacy uncurated `framer-motion` (Standard: `motion/react` with reduced-motion discipline).
- ❌ **Schema Validation**: `joi`, `yup`, `validator` (Standard: `zod` 4).
```

### B.2 `data-table-and-large-list.md`
Add to Section 9 / 10:
```markdown
### 9.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
Tabular representations and virtualization must strictly adhere to the single-library standard:
- ❌ **Tabular Data Grids**: `ag-grid-community`, `ag-grid-react`, `ag-grid-enterprise`, `@mui/x-data-grid`, `handsontable`, `react-table` (v7 legacy), `ka-table` (Standard: `@tanstack/react-table` v8).
- ❌ **Virtualization**: `react-window`, `react-virtualized`, `virtuoso` (Standard: `@tanstack/react-virtual` v3).
- ❌ **Pacing & Search Debouncing**: `lodash.debounce`, `lodash.throttle` (Standard: `@tanstack/react-pacer` or native React transitions).
- ❌ **Grid State Stores**: Global `redux` or `mobx` stores for table filters, sorts, and pagination (Standard: URL search parameters via `useTableUrlSync`).
- ❌ **Client DOM Scraping Export**: `jspdf-autotable`, `tableexport` scraping rendered DOM (Standard: Server-side streaming API endpoints).
```

### B.3 `dependency-graph.md`
Add to Section 8 / 9:
```markdown
### 8.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
Graph visualization must strictly adhere to the single-library standard:
- ❌ **Graph Canvas**: `cytoscape`, `vis-network`, `vis.js`, `mxgraph`, `d3-graphviz`, `gojs`, `jointjs` (Standard: `@xyflow/react` v12).
- ❌ **Graph Layout**: `dagre` (unmaintained), `d3-force` for primary structural layout, `viz.js` (Standard: `elkjs` via Web Worker).
- ❌ **Chart Frameworks in Nodes**: Embedding `chart.js` or `recharts` inside custom nodes (Standard: SVG primitives or modular `echarts`).
- ❌ **State Management**: Storing graph selection or expansion state in Redux (Standard: URL query parameters `?selectedNode=` and local component state).
```

### B.4 `engine-authoring.md`
Add to Section 9 / 10:
```markdown
### 9.1 Strictly Forbidden Competing Libraries & Patterns (Part 21.42 & AGENTS.md §4.2)
Analysis engine authoring requires pure, deterministic evaluation:
- ❌ **AI Frameworks in Analysis Loops**: `langchain`, `llamaindex`, `crewai`, `autogen`, `semantic-kernel` inside core deterministic analysis loops. Analysis engines must be deterministic AST/DOM/rule machines. AI is strictly isolated in AI Problem Router for secondary explanation.
- ❌ **Schema Validation**: `marshmallow`, `voluptuous`, `cerberus` in Python (Standard: `pydantic` v2); `joi`, `yup` in TS (Standard: `zod` 4).
- ❌ **Unsafe XML Parsers**: Standard unsafe `xml.etree.ElementTree` or `minidom` (Standard: `defusedxml` and `lxml.etree` with line number retention).
- ❌ **Database ORMs in Analysis Service**: Direct database ORM access inside `services/analysis-python/src/engines/` (`prisma`, `drizzle-orm`, `sqlalchemy`). Engines must remain 100% stateless pure functions.
- ❌ **Testing Frameworks**: `unittest` legacy suites, `nose` (Standard: `pytest` + `hypothesis` in Python, `vitest` + `fast-check` in TS).
```

### B.5 `sap-evidence.md`
Add to Section 9 / 10:
```markdown
### 9.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
Evidence representation and trust scoring must adhere to strict deterministic standards:
- ❌ **Schema Validation**: `joi`, `yup` for evidence structures (Standard: `@erppreflight/evidence` with `zod` 4 in TS and `pydantic` v2 in Python).
- ❌ **Non-Cryptographic Hashing**: MD5, SHA-1, or non-cryptographic hashes (`murmurhash`, `crc32`) for audit evidence (Standard: SHA-256 via standard Node `crypto` / Python `hashlib`).
- ❌ **Probabilistic Classifiers**: Probabilistic ML clustering or LLMs for `VERIFIED` or `RULE_DERIVED` confidence classification (Standard: Pure deterministic rule logic; AI is strictly capped at `INFERRED` 0.60).
```

### B.6 `release-aware-knowledge.md`
Add to Section 9 / 10:
```markdown
### 9.1 Strictly Forbidden Competing Libraries & Patterns (Part 21.42 & AGENTS.md §4.2)
Knowledge curation and storage must adhere to strict reproducibility standards:
- ❌ **Database ORM**: `prisma`, `typeorm`, `sequelize`, or ad-hoc NoSQL/graph DB drivers (e.g. `neo4j-driver`) without an accepted ADR (Standard: PostgreSQL via `drizzle-orm`).
- ❌ **Mutable In-Place Updates**: Executing SQL `UPDATE` scripts directly against historical knowledge rows (Standard: Append-only immutable knowledge snapshots identified by cryptographic `snapshot_id`).
- ❌ **Dynamic Code Execution**: `eval()` or `exec()` for dynamically evaluating untrusted remote rule strings (Standard: Declarative AST/table rule schemas with version pinning).
```

### B.7 `secure-file-parser.md`
Add to Section 9 / 10:
```markdown
### 9.1 Strictly Forbidden Competing Libraries & Patterns (Part 21.42 & AGENTS.md §4.2)
File parsing and ingestion security must enforce strict hardening:
- ❌ **Unvetted Archive Extractors**: Unhardened `unzipper`, `adm-zip`, or raw `tar` packages that lack path traversal (`os.path.commonpath`) and ratio validation (Standard: Hardened Python `zipfile` wrapper with size/expansion ratio guards).
- ❌ **Unsafe XML Parsing**: `xml2js`, standard `xml.etree.ElementTree`, or unconfigured `lxml` resolving external entities (Standard: `defusedxml.ElementTree` with `forbid_dtd=True` and `lxml` with `resolve_entities=False`).
- ❌ **External Scrubbing Services**: Shelling out to external regex scripts or third-party cloud services for secret redaction (Standard: In-memory `SecretRedactionEngine` HMAC masking).
```

### B.8 `multi-tenant-security.md`
Add to Section 9 / 10:
```markdown
### 9.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
Multi-tenancy and security enforcement must strictly adhere to the curated stack:
- ❌ **Database ORMs**: `prisma`, `typeorm`, `sequelize` (Standard: `drizzle-orm` + PostgreSQL RLS).
- ❌ **Job Queue Systems**: `kue`, `bee-queue`, `celery` in TypeScript (Standard: `bullmq` on Redis 7).
- ❌ **Shared Server Caches**: Global singleton server caches or shared in-memory stores between tenants (Standard: Per-request `QueryClient` factory in SSR, tenant-prefixed Redis keys).
- ❌ **Unverified Auth Tokens**: Homemade JWT rollouts without tenancy claims or unverified `x-tenant-id` request headers (Standard: `@erppreflight/auth` and PostgreSQL session parameters).
```

---

```
================================================================================
PART C: LOCAL SERVICE TOPOLOGY BLUEPRINT FOR AGENTS.MD
================================================================================
```

### C.1 AGENTS.md Table 3 Dangling Route Fix (Line 121)
```markdown
<<<< BEFORE
| **Frontend UI / Design System Engineer** | `frontend-design-system.md` | `data-table-and-large-list.md`, `accessibility.md` | • Editing files in `apps/web/src/components/`<br>• Implementing UI layouts, styles, themes, or motion<br>• Creating forms, dialogs, buttons, or badges<br>• Implementing severity indicators or alert components |
====
| **Frontend UI / Design System Engineer** | `frontend-design-system.md` | `data-table-and-large-list.md` | • Editing files in `apps/web/src/components/`<br>• Implementing UI layouts, styles, themes, or motion<br>• Creating forms, dialogs, buttons, or badges<br>• Implementing severity indicators or alert components<br>*(Note: WCAG 2.2 AA accessibility standards are consolidated directly into `frontend-design-system.md`)* |
>>>>
```

### C.2 AGENTS.md New Section 6: Local Service Topology & Development Environment
Append the following section to `H:/erppreflight/AGENTS.md` after line 244 (Section 5.3):

```markdown
---

## 6. Local Service Topology & Development Environment

As mandated by Part 22.26, ERP Preflight defines an explicit local service topology. All autonomous coding agents and human contributors must adhere to these standard ports, service boundaries, and communication protocols.

### 6.1 Service Topology Matrix

| Service Container | Technology Stack | Local Host Port | Container Port | Service Role & Operational Scope | Health Check Endpoint |
|---|---|---|---|---|---|
| **`web`** | Next.js 15, React 19, Base UI, TanStack Suite | `3000` | `3000` | Web Frontend: App Router pages, finding inspector, dependency canvas | `GET /api/health` |
| **`api`** | NestJS 11, Fastify, Drizzle ORM, BullMQ | `3001` | `3001` | Core SaaS Backend: Auth, projects, uploads, reports, tenant RLS | `GET /health/liveness`<br>`GET /health/readiness` |
| **`analysis-python`** | Python 3.13, FastAPI, Pydantic v2, DefusedXML | `8000` | `8000` | Stateless Analysis Engine: 18 SAP Preflight Engines + MFS BlackBox | `GET /health`<br>`GET /docs` (OpenAPI) |
| **`postgres`** | PostgreSQL 16 + `pgvector` | `5432` | `5432` | Primary Database: Multi-tenant relational data, findings, vector embeddings | `pg_isready -U postgres` |
| **`redis`** | Redis 7.2 Alpine | `6379` | `6379` | Cache & Job Queue: BullMQ queue backend, distributed lock coordination | `redis-cli ping` |
| **`minio`** | MinIO (S3-Compatible Object Store) | `9000` (API)<br>`9001` (Console) | `9000`<br>`9001` | Artifact Storage: Customer ZIPs, XML/JSON extracts, generated reports | `GET /minio/health/live` |

### 6.2 Inter-Service Communication & Data Flow

```text
+-----------------------------------------------------------------------------------+
| Browser (User / Consultant)                                                       |
+-----------------------------------------------------------------------------------+
       |                                                    |
       | HTTP/REST (Port 3000)                              | Orval API Client (Port 3001)
       v                                                    v
+-----------------------+                            +------------------------------+
| web (Next.js 15)      |--------------------------->| api (NestJS 11 Core)         |
| SSR QueryClient       |  HTTP/REST (Port 3001)     | PostgreSQL RLS Context       |
+-----------------------+                            +------------------------------+
                                                            |          |          |
                      +-------------------------------------+          |          |
                      |                                                |          |
                      v                                                v          v
       +-------------------------------+             +-------------------+  +--------------+
       | postgres (PostgreSQL 16)      |             | redis (Redis 7.2) |  | minio (S3)   |
       | RLS Session: app.current_tenant_id          | BullMQ Queues     |  | Presigned URL|
       +-------------------------------+             +-------------------+  +--------------+
                                                               |                   ^
                                           Job Dispatch        |                   | S3 Stream
                                                               v                   v
                                                     +-------------------------------------+
                                                     | analysis-python (FastAPI 3.13)      |
                                                     | Stateless Pure Engine Dispatcher    |
                                                     +-------------------------------------+
```

### 6.3 Local Environment Variables Matrix

```bash
# Database & Persistence
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/erppreflight
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/erppreflight

# Redis & Queues
REDIS_URL=redis://localhost:6379

# Object Storage (MinIO)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_NAME=erppreflight-artifacts
S3_FORCE_PATH_STYLE=true

# Service Communication
NEXT_PUBLIC_API_URL=http://localhost:3001
ANALYSIS_SERVICE_URL=http://localhost:8000

# Auth & Secrets
JWT_SECRET=super-secret-development-jwt-key-minimum-32-chars-long
TENANT_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

### 6.4 Verification & Health Check Commands

To verify that all local services are healthy:

```bash
# 1. Verify PostgreSQL 16
docker exec erppreflight-postgres pg_isready -U postgres -d erppreflight

# 2. Verify Redis 7
docker exec erppreflight-redis redis-cli ping
# Expected output: PONG

# 3. Verify MinIO S3
curl -s http://localhost:9000/minio/health/live

# 4. Verify NestJS Core Backend
curl -s http://localhost:3001/health/liveness
curl -s http://localhost:3001/health/readiness

# 5. Verify Python Analysis Microservice
curl -s http://localhost:8000/health

# 6. Verify Next.js Web Frontend
curl -s http://localhost:3000/api/health
```
```

---

## 5. Verification Method

To independently verify that the blueprints completely satisfy all Challenger requirements, execute the following verification steps:

```bash
# 1. Verify all 8 playbooks will contain Cardinal Axiom references
node -e "
const fs = require('fs');
const files = fs.readdirSync('H:/erppreflight/.agents/skills');
const axioms = files.map(f => {
  const content = fs.readFileSync('H:/erppreflight/.agents/skills/' + f, 'utf-8');
  return { file: f, hasAxiom: /cardinal axiom (1|2)/i.test(content) };
});
console.table(axioms);
"

# 2. Verify forbidden duplicate libraries are represented in each playbook
node -e "
const fs = require('fs');
const tests = [
  { file: 'data-table-and-large-list.md', pattern: /ag-grid|mui\/x-data-grid/i },
  { file: 'dependency-graph.md', pattern: /cytoscape|vis-network|mxgraph/i },
  { file: 'frontend-design-system.md', pattern: /react-hook-form|formik|redux/i },
  { file: 'engine-authoring.md', pattern: /langchain|llamaindex|crewai|marshmallow/i },
  { file: 'multi-tenant-security.md', pattern: /prisma|typeorm|sequelize|kue|bee-queue/i },
  { file: 'sap-evidence.md', pattern: /joi|yup|murmurhash/i },
  { file: 'release-aware-knowledge.md', pattern: /prisma|neo4j/i },
  { file: 'secure-file-parser.md', pattern: /unzipper|adm-zip|xml2js/i },
];
tests.forEach(t => {
  const content = fs.readFileSync('H:/erppreflight/.agents/skills/' + t.file, 'utf-8');
  console.log(t.file, t.pattern.test(content) ? 'PASS' : 'FAIL');
});
"

# 3. Verify AGENTS.md Table 3 has no broken file references
node -e "
const fs = require('fs');
const agentsMd = fs.readFileSync('H:/erppreflight/AGENTS.md', 'utf-8');
const lines = agentsMd.split('\n');
const tableLines = lines.filter(l => l.includes('.md'));
const referencedFiles = [...new Set(tableLines.flatMap(l => l.match(/[a-z0-9-]+\.md/g) || []))];
const missing = referencedFiles.filter(f => !fs.existsSync('H:/erppreflight/.agents/skills/' + f) && !fs.existsSync('H:/erppreflight/' + f));
console.log('Referenced files:', referencedFiles);
console.log('Missing files (must be []):', missing);
"

# 4. Verify AGENTS.md contains Section 6 Local Service Topology
node -e "
const fs = require('fs');
const agentsMd = fs.readFileSync('H:/erppreflight/AGENTS.md', 'utf-8');
const hasTopology = /## 6\. Local Service Topology/i.test(agentsMd);
const hasPorts = /3000.*3001.*8000.*5432.*6379.*9000/s.test(agentsMd);
console.log('AGENTS.md has Local Service Topology:', hasTopology && hasPorts);
"
```
