# Technical Blueprint & Exact Markdown Specification for Root `AGENTS.md`

**Agent**: `explorer_m1_agents_1` (`teamwork_preview_explorer`)  
**Workspace**: `H:/erppreflight/.agents/explorer_m1_agents_1`  
**Parent**: `66440be0-c7ee-4a74-8a17-61e13b963df1` (`parent`)  
**Timestamp**: 2026-09-24T03:01:00Z  
**Target Repository**: `H:/erppreflight`  
**Deliverable File Target**: `H:/erppreflight/AGENTS.md`  

---

## 1. Observation

Direct observations extracted from the authoritative repository documents, master specifications, survey findings, and project codebases:

1. **Absence of Root `AGENTS.md` and Playbook Directory**:
   - `H:/erppreflight/AGENTS.md` currently does not exist.
   - `H:/erppreflight/.agents/skills/` directory does not currently exist.
   - `22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md` (lines 7–14, 289–309) mandates:
     - Canonical Markdown skill files under `/.agents/skills/`.
     - A root `AGENTS.md` file routing any coding agent to the appropriate skill for each task.
     - Section 22.26 explicitly requires the inclusion of product principles, monorepo map, commands, quality gates, skill routing table, forbidden shortcuts, definition of done, and the two cardinal axioms:
       * `"A page that renders is not a completed feature."`
       * `"An engine without deterministic logic/evidence/fixtures is not complete."`

2. **Repository Architecture & Directory Topology (`PROJECT.md` & `pnpm-workspace.yaml`)**:
   - Monorepo structure defined in `PROJECT.md` (lines 168–202) and `pnpm-workspace.yaml`:
     - `apps/web`: Next.js 15 App Router, React 19, Tailwind CSS, shadcn/ui.
     - `apps/api`: NestJS 11 SaaS core backend with BullMQ Redis queues and PostgreSQL RLS.
     - `services/analysis-python`: Python 3.13 FastAPI analysis microservice for 18 SAP Preflight Engines + MFS BlackBox.
     - `packages/schemas`: Shared Zod runtime schemas and TypeScript interfaces (`@erppreflight/schemas`).
     - `packages/evidence`: Shared evidence model, SHA-256 offset hashing, trust score calculation, provenance classifier (`@erppreflight/evidence`).
     - `packages/tenancy`: Multi-tenant context propagation (`AsyncLocalStorage`) and RLS helpers (`@erppreflight/tenancy`).
     - `packages/database`: Drizzle ORM client, migrations, and PostgreSQL connection management (`@erppreflight/database`).
     - `packages/auth`: Session auth and JWT verification utilities (`@erppreflight/auth`).
     - `tests/e2e`: Independent opaque-box end-to-end testing harness and test tiers.

3. **Curated Library Stack & Dependency Invariants (`21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md`)**:
   - Section 21.1: Next.js 15 App Router, React 19, Tailwind CSS, shadcn/ui built on Base UI headless primitives. Mixing Base UI, Radix UI, and Ark UI without an ADR is forbidden.
   - Section 21.3 & `ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md`:
     - TanStack Query: Server state only; per-request instance on SSR server, client singleton.
     - TanStack Table: Enterprise data grids (findings, SAP objects, migration inventory).
     - TanStack Virtual: Virtualized rendering for lists/tables > 100 items (up to 500k rows).
     - TanStack Form: Canonical form engine integrated with Zod; React Hook Form is forbidden.
     - TanStack Pacer: Debounced search (300ms) and throttled UI interactions.
     - Strict prohibition: TanStack Router and TanStack Start are forbidden (Next.js is the application router). Redux and MobX are forbidden.
   - Section 21.42: Strict No-Dependency-Soup rule prohibiting duplicate frameworks (Base UI + Radix + Ark UI; TanStack Form + React Hook Form; Drizzle + Prisma; ECharts + multiple chart libs; React Flow + other graph engines; BullMQ + other Redis queues).

4. **Engine Anatomy & Epistemic Boundaries (`22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md` & `ARCHITECTURE_DECISIONS.md`)**:
   - Section 22.4 requires 14 mandatory points for every engine: Metadata, Input Schema, Parser/Normalizer, Deterministic Analysis, Finding Codes, Evidence, Confidence, Fixtures, Tests, Generated Tests, Metrics, Project/Report Integration, Admin Visibility, Docs.
   - ADR-004 & ADR-005: Strict 4-level confidence hierarchy (`VERIFIED` = 1.0, `RULE_DERIVED` = 0.85, `INFERRED` = 0.60, `UNKNOWN` = 0.30). LLM involvement is strictly capped at `INFERRED` (0.60 maximum). LLM-only engines are forbidden. Missing evidence demotes findings to `UNKNOWN`.

5. **Verified Verification & Build Commands (`package.json`)**:
   - Root build: `pnpm run build` (`turbo run build`).
   - Root lint: `pnpm run lint` (`turbo run lint`).
   - Root typecheck: `pnpm run typecheck` (`turbo run typecheck`).
   - Root test: `pnpm run test` (`turbo run test`).
   - Python tests: `pnpm run test:python` / `pytest services/analysis-python/tests -v`.

---

## 2. Logic Chain

1. **Requirement Analysis**:
   - Milestone 1 requires establishing repository agent governance. Without a centralized, authoritative `AGENTS.md`, parallel coding agents and human contributors will make fragmented decisions: inventing custom state stores, introducing duplicate libraries (e.g. React Hook Form, Prisma, Redux), building superficial UI mockups without real data bindings, or creating prompt-only LLM stubs instead of deterministic SAP analysis engines.

2. **The Role of the Two Cardinal Axioms**:
   - *Axiom 1 ("A page that renders is not a completed feature")* directly prevents the common LLM failure mode of generating visually appealing React components backed by hardcoded arrays or missing loading/error/accessibility states.
   - *Axiom 2 ("An engine without deterministic logic/evidence/fixtures is not complete")* directly prevents the failure mode of implementing analysis engines as loose generative AI prompts without deterministic AST/DOM parsing, cryptographic evidence hashing, or regression test fixtures.

3. **Monorepo Directory Map & Architecture Boundaries**:
   - Boundaries must be strictly formalized in `AGENTS.md` so that agents know exactly which service owns what responsibility.
   - Web frontend never queries the Python service or database directly; it speaks exclusively to NestJS via typed OpenAPI contracts.
   - Python analysis service is completely stateless and decoupled from SaaS billing/auth.
   - Shared packages (`packages/*`) must remain leaf dependencies with zero reverse imports to `apps/*` or `services/*`.
   - `.agents/` directory is reserved solely for metadata and playbooks; application code must never be placed there.

4. **Agent Role to Playbook Routing**:
   - To make skills actionable, each agent role or incoming prompt must deterministically map to one or more of the 8 canonical playbooks under `/.agents/skills/`.
   - Providing explicit trigger conditions (triggering roles, target file paths, domain keywords, and composite trigger rules) ensures that agents automatically ingest the correct domain rules before proposing or writing code.

5. **Mandatory Invariants and Forbidden Shortcuts**:
   - Encoding forbidden shortcuts (no dummy endpoints, no hardcoded tenant/system IDs, no dependency soup, no server-side singleton QueryClient, no un-sanitized XML/ZIP parsing) in `AGENTS.md` provides an unambiguous compliance checklist for automated code reviews and CI gates.

6. **Automated Test Quality Gates & DoD**:
   - Clear, reproducible test commands (`pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, `pytest services/analysis-python/tests -v`, multi-tenant denial tests) ensure that every contribution is independently verified before merging.

---

## 3. Caveats

1. **Playbook File Existence**: The 8 canonical playbook files in `/.agents/skills/` are being authored in parallel as part of Milestone 1. `AGENTS.md` references their final canonical paths (`/.agents/skills/<playbook-name>.md`).
2. **Current Dependency Migration**: `apps/web/package.json` currently contains some Radix UI packages and Zod 3.24.2. `AGENTS.md` establishes Base UI and Zod 4 as the forward standard, permitting existing Radix components only where already functional, while prohibiting new Radix/Ark additions.
3. **Workspace Boundary**: This agent operates under the Explorer archetype (read-only investigation). It produces this specification in `.agents/explorer_m1_agents_1/handoff.md` and does not write directly to `H:/erppreflight/AGENTS.md`. The parent/builder agent will apply this blueprint to `H:/erppreflight/AGENTS.md`.

---

## 4. Conclusion

Below is the complete, exact technical design and verbatim markdown specification for `H:/erppreflight/AGENTS.md`. It covers all five mandatory areas with rigorous detail and precision.

***

# EXACT SPECIFICATION FOR `H:/erppreflight/AGENTS.md`

```markdown
# ERP Preflight — Repository Agent Operating Manual & Governance Standard

> **Target Repository**: `https://github.com/enwecklerpro/erppreflight`  
> **Product**: ERP Preflight — Enterprise Multi-Tenant SaaS for SAP Preflight Analysis, Clean Core Auditing, Migration Verification, and Release Intelligence  
> **Authority**: Binding across all human developers and autonomous coding agents working on this codebase.  
> **Extends**: Parts 00–22 of the ERP Preflight Master Specifications.

---

## 1. The Two Cardinal Axioms

Every contributor, agent, and reviewer must uphold two non-negotiable cardinal axioms. Any pull request or agent completion violating either axiom will fail code review and automated quality gates:

### Axiom 1: *"A page that renders is not a completed feature."*
A user interface that merely renders visual elements is an incomplete prototype, not a finished feature. A frontend feature is considered complete **only** when all of the following criteria are satisfied:
1. **Real Data & Server State**: Fully integrated with TanStack Query fetching from backend endpoints or typed mock contracts (via Orval). No hardcoded client-side dummy arrays or temporary mock constants in production components.
2. **Runtime Schema Validation**: All external inputs, form submissions, and API payloads are validated using Zod schemas.
3. **Error Boundaries & Resilience**: Comprehensive error handling, including contextual error states, query retry policies, and user-actionable retry triggers.
4. **Loading & Empty States**: Polished loading skeletons (matching exact content layout without layout shifts) and informative zero-result/empty states with clear user call-to-actions.
5. **Accessible Severity Representation**: Severity indicators (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `LOW`, `INFO`) must **never** rely on color alone. They must pair colors with unambiguous icons, textual badges, or ARIA labels.
6. **Interaction & Motion Discipline**: Keyboard accessible (tab index, arrow navigation, escape to close), fully responsive across desktop and mobile without horizontal scroll lockups, and compliant with `prefers-reduced-motion`.
7. **Form State Integrity**: Form workflows (TanStack Form + Zod) implement dirty-state tracking, unsaved changes warnings on navigation, and server/client validation feedback.

### Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*
A preflight analysis engine is not a prompt wrapper. ERP Preflight provides defensible enterprise audit findings. An engine is complete **only** when all 14 architectural points are implemented:
1. **Metadata**: Canonical engine ID, human-readable name, operational domain, target SAP releases, and supported artifact formats.
2. **Input Schema**: Strict runtime schema validation (Pydantic in Python, Zod in TypeScript) verifying input payloads before execution.
3. **Deterministic Parser**: Hardened, memory-bounded artifact parsing (XML, JSON, CSV, ABAP, XDP, WSDL, Spool) rejecting malformed inputs, zip bombs, and XXE attacks.
4. **Pure Rule Evaluation**: Deterministic rule logic and graph traversals. Zero probabilistic drift. Two identical artifact inputs must produce byte-for-byte identical findings.
5. **Standard Finding Taxonomy**: Structured, unique finding codes (e.g. `OPD_DETERMINATION_STEP_MISSING`, `CLEAN_CORE_TIER3_DIRECT_DB_MUTATION`).
6. **Cryptographic Evidence Chains**: Every finding must reference concrete evidence items containing artifact path, exact line and column numbers, code snippet, artifact SHA-256 hash, and provenance score.
7. **Epistemic Confidence Classification**: Explicit assignment to one of four strict classes: `VERIFIED` (1.0), `RULE_DERIVED` (0.85), `INFERRED` (0.60), or `UNKNOWN` (0.30). LLM assistance is strictly capped at `INFERRED` (0.60).
8. **Curated Test Fixtures**: Golden positive, negative, and edge-case test artifacts verifying rule trigger accuracy.
9. **Automated Test Suite**: Comprehensive unit and integration tests executing under `pytest` with a 100% pass rate.
10. **Property-Based Testing**: Fuzz/property tests (Hypothesis or fast-check) verifying parser stability against malformed or hostile inputs.
11. **Telemetry & Metrics**: Instrumentation tracking execution duration, memory consumption, rules evaluated, and unknown finding rates.
12. **Report Serialization**: Structured serialization into standardized JSON assessment exports and project findings models.
13. **Admin Visibility**: Operational status, rule inventory, and quality score exposed for Admin Trust Center diagnostics.
14. **Remediation Documentation**: Clear, release-specific technical remediation guides explaining the exact steps required to resolve each finding.

---

## 2. Monorepo Directory Map & Architecture Boundaries

ERP Preflight is organized as a high-performance monorepo using `pnpm` workspaces and Turborepo.

### 2.1 Directory Map

```text
H:/erppreflight/
├── apps/
│   ├── web/                        # Next.js 15 App Router Frontend
│   │   ├── src/app/                # App Router pages, layouts, and route handlers
│   │   ├── src/components/         # UI component library (shadcn/Base UI, DataTable, Form)
│   │   ├── src/hooks/              # TanStack Query, Table, Virtual, and Pacer hooks
│   │   └── src/lib/                # SSR-safe QueryClient, API clients, utilities
│   └── api/                        # NestJS 11 Core SaaS API Backend
│       ├── src/modules/auth/       # Multi-tenant auth, session, and JWT handling
│       ├── src/modules/projects/   # Project lifecycle, workspaces, and audit trail
│       ├── src/modules/ingestion/  # File upload, magic bytes, archive safety, redaction
│       ├── src/modules/queues/     # BullMQ Redis job queues (ingestion, analysis, export)
│       └── src/modules/reports/    # Preflight assessment export generation (JSON/CSV/PDF)
├── services/
│   └── analysis-python/            # Python 3.13 FastAPI Stateless Analysis Microservice
│       ├── src/api/                # FastAPI analysis endpoints & health checks
│       ├── src/core/               # Engine dispatcher, runner, and telemetry
│       ├── src/engines/            # The 18 SAP Preflight Engines + MFS BlackBox
│       ├── src/parsers/            # Deterministic parsers (XML, JSON, CSV, ABAP, XDP)
│       ├── src/platform/           # Evidence Engine, Confidence Classifier, AI Problem Router
│       ├── src/models/             # Pydantic domain models and contracts
│       └── tests/                  # Pytest test suite & golden fixture archives
├── packages/
│   ├── schemas/                    # @erppreflight/schemas: Shared Zod domain contracts
│   ├── evidence/                   # @erppreflight/evidence: Evidence model, hashing, scoring
│   ├── tenancy/                    # @erppreflight/tenancy: AsyncLocalStorage context & RLS
│   ├── database/                   # @erppreflight/database: Drizzle ORM schema & migrations
│   └── auth/                       # @erppreflight/auth: Auth utilities & RBAC policies
├── /.agents/
│   └── skills/                     # Canonical Engineering Playbooks (8 core playbooks)
├── infra/
│   ├── coolify/                    # docker-compose.coolify.yml & reverse proxy configs
│   └── docker/                     # Hardened multi-stage non-root Dockerfiles
├── tests/
│   └── e2e/                        # Opaque-box E2E test harness & Tiers 1-5 test suites
├── ARCHITECTURE_DECISIONS.md       # Authoritative Architectural Decision Records (ADRs)
├── IMPLEMENTATION_STATUS.md        # Feature tracking and milestone execution status
├── package.json                    # Monorepo root configuration & scripts
├── pnpm-workspace.yaml             # pnpm workspace package glob declarations
└── turbo.json                      # Turborepo task pipeline definition
```

### 2.2 Strict Architecture Boundaries & Data Flow

1. **Frontend Boundary (`apps/web`)**:
   - Communicates **exclusively** with `apps/api` via HTTP/REST or WebSocket endpoints generated by Orval.
   - **Never** communicates directly with `services/analysis-python` or the PostgreSQL database.
   - Server Components and Client Components must use the SSR-safe QueryClient factory to prevent cross-tenant cache contamination.
2. **Backend SaaS Boundary (`apps/api`)**:
   - Exclusively owns user identity, organization multi-tenancy, billing, project state, file ingestion permissions, and job orchestration.
   - Enforces PostgreSQL Row-Level Security (RLS) on every tenant query via `@erppreflight/tenancy` `AsyncLocalStorage`.
   - Dispatches compute jobs to `services/analysis-python` via BullMQ queues backed by Redis.
3. **Analysis Engine Boundary (`services/analysis-python`)**:
   - **Stateless & Decoupled**: Has zero direct database access to the SaaS database (PostgreSQL user/billing tables).
   - Receives sanitized artifact references or streams, executes deterministic parsing and rule checks, and returns structured findings and evidence payloads.
   - Does not perform authentication or multi-tenant billing checks; trusts normalized job payloads from `apps/api`.
4. **Shared Package Boundaries (`packages/*`)**:
   - Shared packages are leaf libraries. They must **never** import from `apps/*` or `services/*`.
   - Circular dependencies between packages are strictly forbidden.
5. **Agent Metadata Isolation (`.agents/`)**:
   - The `.agents/` directory is reserved strictly for agent coordination metadata (briefings, plans, progress logs, handoff reports) and canonical playbooks (`.agents/skills/`).
   - Source code, tests, and production assets must **never** be placed inside `.agents/`.

---

## 3. Agent Role to Playbook Routing Table

Before starting any task, coding agents and contributors **must** load and adhere to the relevant engineering playbooks located in `/.agents/skills/`.

| Agent Role / Contributor Context | Primary Playbook | Secondary / Composite Playbooks | Explicit Trigger Conditions |
|---|---|---|---|
| **Frontend UI / Design System Engineer** | `frontend-design-system.md` | `data-table-and-large-list.md`, `accessibility.md` | • Editing files in `apps/web/src/components/`<br>• Implementing UI layouts, styles, themes, or motion<br>• Creating forms, dialogs, buttons, or badges<br>• Implementing severity indicators or alert components |
| **Data Grid & Large List Engineer** | `data-table-and-large-list.md` | `frontend-design-system.md`, `sap-evidence.md` | • Editing findings table, object inventory, or MFS logs<br>• Implementing pagination, sorting, or facet filtering<br>• Rendering datasets with >100 rows<br>• Implementing data export (CSV, JSON, XLSX) |
| **Dependency Graph & Impact Specialist** | `dependency-graph.md` | `frontend-design-system.md`, `sap-evidence.md` | • Visualizing SAP object dependencies, transports, or custom field flows<br>• Using `@xyflow/react` or `elkjs`<br>• Building interactive graph canvases or What-If simulation trees<br>• Implementing node inspectors or graph filtering |
| **SAP Preflight Engine Author (Python/TS)** | `engine-authoring.md` | `sap-evidence.md`, `secure-file-parser.md` | • Creating or modifying any of the 18 SAP Preflight Engines or MFS BlackBox<br>• Adding rule definitions, finding codes, or AST evaluations<br>• Writing engine unit tests, fixtures, or property tests<br>• Editing files in `services/analysis-python/src/engines/` |
| **SAP Knowledge & Evidence Specialist** | `sap-evidence.md` | `release-aware-knowledge.md`, `engine-authoring.md` | • Writing rules relying on SAP standard vs custom code<br>• Defining Clean Core Tier 1/2/3 extensibility rules<br>• Constructing evidence pointers (line/col, snippet, SHA-256)<br>• Computing composite trust scores or provenance classes |
| **Release Intelligence & Governance Engineer** | `release-aware-knowledge.md` | `sap-evidence.md`, `engine-authoring.md` | • Updating SAP release metadata, SPRO/CBC catalogs, or note mappings<br>• Publishing or versioning immutable knowledge snapshots<br>• Configuring target release compatibility matrices<br>• Implementing shadow evaluation or finding stability regression checks |
| **Security & Ingestion Pipeline Engineer** | `secure-file-parser.md` | `multi-tenant-security.md` | • Ingesting, parsing, or extracting customer artifacts (ZIP, XML, JSON, CSV, ABAP, XDP)<br>• Implementing file upload endpoints or MIME sniffers<br>• Implementing archive decompression or XML parsers<br>• Adding secret scrubbing or credential redaction logic |
| **Multi-Tenant Backend & Security Engineer** | `multi-tenant-security.md` | `secure-file-parser.md` | • Creating or modifying API endpoints, DB queries, or schemas<br>• Working with PostgreSQL RLS, storage buckets, or Redis cache keys<br>• Implementing tenant switching, auth guards, or BullMQ jobs<br>• Writing cross-tenant security denial tests |

### Composite Playbook Rules
When building complex full-stack features, multiple playbooks must be combined:
- **Findings Inspector View**: `data-table-and-large-list.md` + `frontend-design-system.md` + `sap-evidence.md`.
- **SAP Connector & Ingestion Upload**: `secure-file-parser.md` + `multi-tenant-security.md` + `frontend-design-system.md` (TanStack Form).
- **Transport Dependency Graph**: `dependency-graph.md` + `sap-evidence.md` + `data-table-and-large-list.md` (accessible table fallback).
- **New Preflight Engine Pipeline**: `engine-authoring.md` + `secure-file-parser.md` + `sap-evidence.md` + `release-aware-knowledge.md`.

---

## 4. Mandatory Architectural Invariants & Forbidden Shortcuts

The following invariants are strictly enforced across the entire repository. Bypassing them is prohibited.

### 4.1 No Stubs, No Dummy Implementations, No Hardcoding
- **Zero Mocking in Production Paths**: Production endpoints, services, and engines must contain real logic. Mocking or returning static dummy arrays to simulate feature completion is strictly forbidden.
- **Zero Hardcoded Identifiers**: Never hardcode customer names, tenant IDs, system IDs, SAP credentials, API keys, or absolute local machine paths. All configuration must flow through validated environment variables or project settings.
- **Deterministic Pure Engines**: Analysis engines must produce identical findings for identical inputs. System clocks, random number generators, or network calls are prohibited inside core deterministic analysis loops.

### 4.2 Strict No-Dependency-Soup Policy
To maintain high code quality, minimal bundle size, and maintainability, ERP Preflight enforces a **single curated library per concern** (Part 21.42). Adding duplicate or competing frameworks requires an accepted Architecture Decision Record (ADR):

| Concern | Approved Standard Library | Strictly Forbidden Duplicates (Without ADR) |
|---|---|---|
| **Headless UI Primitives** | **Base UI** (for new shadcn components) | Adding raw Radix UI or Ark UI to new components |
| **Form Management** | **TanStack Form** (`@tanstack/react-form` + Zod) | **React Hook Form**, Formik |
| **Server State & Caching** | **TanStack Query** (`@tanstack/react-query`) | RTK Query, SWR, Apollo Client |
| **Client State Management** | **URL Parameters** (filters/search) + React State / scoped Zustand | **Redux**, MobX, Recoil |
| **Application Router** | **Next.js App Router** | **TanStack Router**, TanStack Start |
| **Database ORM** | **Drizzle ORM** | **Prisma**, TypeORM, Sequelize |
| **Interactive Graph Canvas** | **@xyflow/react** (React Flow) + **ELK.js** | Cytoscape, Vis.js, mxGraph |
| **Analytics & Charts** | **Apache ECharts** (modular imports) | Chart.js, Recharts, Victory |
| **Job Queue & Background Tasks** | **BullMQ** (Redis) | Kue, Bee-Queue, Celery (in TS) |
| **Runtime Validation** | **Zod 4** | Joi, Yup |

### 4.3 Epistemic & AI Boundary Invariants
- **No LLM-Only Engines**: An engine that consists solely of an LLM prompt is prohibited. AI is strictly restricted to secondary explanatory text, remediation recommendations, or natural language query parsing.
- **Confidence Ceiling**: Findings derived with AI involvement can **never** exceed `INFERRED` confidence (score <= 0.60).
- **Demotion on Missing Evidence**: Any finding lacking verifiable file pointers, line numbers, and SHA-256 hashes must be demoted to `UNKNOWN` (score <= 0.30).
- **Finding Immutability**: Historical findings are immutable records tied to an exact knowledge snapshot. They must never be silently overwritten in place when rules change.

### 4.4 Multi-Tenant Isolation & SSR Safety Invariants
- **SSR QueryClient Isolation**: In Next.js App Router, `getQueryClient()` must create a **new `QueryClient` instance per server request**. A shared server singleton will cause catastrophic cross-tenant data leaks across concurrent SSR requests. The browser uses a shared client singleton.
- **Tenant Cache Eviction**: Switching organizations or logging out in the web application must immediately trigger `queryClient.cancelQueries()`, `queryClient.clear()`, and reset all tenant-scoped state.
- **PostgreSQL RLS**: All tenant tables must enforce PostgreSQL RLS policies checking `organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`.
- **Storage Scoping**: All customer artifacts in S3/MinIO must reside under `/tenants/{organization_id}/projects/{project_id}/`. Pre-signed URLs must have a maximum lifespan of 15 minutes.

### 4.5 Ingestion & Parser Hardening Invariants
- **Magic Bytes Validation**: File extensions must never be trusted. Validate MIME types and file signatures against raw byte buffers before routing to parsers.
- **Archive Protection**: Decompression routines must enforce: maximum 100:1 expansion ratio, maximum 500MB total uncompressed volume, maximum 2 nested archive levels, and path traversal validation (rejecting `../` or absolute targets).
- **Defused XML**: All XML parsing (Python and TypeScript) must disable external DTDs, external entity resolution, and parameter entities (`defusedxml`).
- **Secret Scrubbing**: Raw customer files and logs must pass through secret redaction (regex + entropy scanning) before snippets are stored in evidence databases.

---

## 5. Automated Test Quality Gates, Build & Lint Requirements

All contributions must pass the following automated quality gates prior to review and merge:

### 5.1 Verification Commands

```bash
# 1. Monorepo Build (must pass with 0 TypeScript and packaging errors)
pnpm run build

# 2. Strict Typecheck across all apps and packages
pnpm run typecheck

# 3. Monorepo Linting & Formatting Check
pnpm run lint

# 4. TypeScript Unit & Integration Tests (NestJS backend, Web components, Schemas)
pnpm run test

# 5. Python Analysis Engine Pytest Suite & Golden Fixtures (100% pass rate mandatory)
pnpm run test:python
# or directly in services/analysis-python:
pytest services/analysis-python/tests -v

# 6. End-to-End Opaque-Box & Accessibility Test Suite
pnpm exec playwright test
```

### 5.2 Mandatory Quality Gates

1. **Gate 1: Monorepo Compilation & Type Safety**:
   - `pnpm run build` and `pnpm run typecheck` complete with zero errors under TypeScript strict mode.
   - Zero circular dependencies across packages (`turbo run build`).
2. **Gate 2: Code Quality & Dependency Compliance**:
   - `pnpm run lint` passes without warnings or errors.
   - Automated check confirms zero forbidden duplicate libraries (no React Hook Form, Redux, Prisma).
3. **Gate 3: Deterministic Engine Verification**:
   - All 18 SAP Preflight Engines pass golden positive and negative fixture tests in `services/analysis-python/tests`.
   - Every finding emitted in tests includes valid evidence pointers, SHA-256 hashes, and valid confidence classifications.
4. **Gate 4: Multi-Tenant Denial Verification**:
   - Automated integration tests execute cross-tenant access attempts: Tenant A attempting to access Tenant B's project, artifact, finding, or pre-signed URL must be rejected with HTTP 403 Forbidden or HTTP 404 Not Found.
5. **Gate 5: Ingestion Security Verification**:
   - Malformed archives (zip bombs, zip slips), malicious XML payloads (XXE), and files containing mock credentials trigger quarantine, rejection, and redaction assertions.
6. **Gate 6: Accessibility (WCAG 2.2 AA) & Performance**:
   - Automated axe-core/Playwright tests verify keyboard accessibility, ARIA labels, and non-color severity representation.
   - Large list virtualization verified: virtualized tables rendering 10,000+ items maintain a constant DOM element footprint (~30 rows) without memory bloat.

### 5.3 Definition of Done (DoD) Checklist

Before submitting a task or pull request, verify that:
- [ ] Feature complies with Cardinal Axiom 1 (real data, error/loading states, non-color severity, responsive, accessible).
- [ ] Engine complies with Cardinal Axiom 2 (14-point structure, deterministic logic, evidence, confidence, fixtures, tests).
- [ ] Assigned playbooks in `/.agents/skills/` were consulted and adhered to.
- [ ] Zero duplicate libraries introduced; No-Dependency-Soup rule respected.
- [ ] All database queries enforce tenant isolation (`organization_id` + RLS).
- [ ] `pnpm run build` succeeds cleanly.
- [ ] `pnpm run typecheck` reports 0 errors.
- [ ] `pnpm run lint` reports 0 errors.
- [ ] `pnpm run test` and `pnpm run test:python` pass with 100% success rate.
- [ ] Relevant documentation, ADRs, or test fixtures are updated.
```

***

## 5. Verification Method

To independently verify the completeness, architectural soundness, and compliance of this specification:

1. **Review Specification Alignment**:
   - Inspect `H:/erppreflight/22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md` (specifically Section 22.26) to verify that all required topics (product principles, monorepo map, commands, quality gates, skill routing table, forbidden shortcuts, definition of done, and the two cardinal axioms) are covered comprehensively.
   - Inspect `H:/erppreflight/21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md` (specifically Section 21.42) to verify that all prohibited duplicate libraries and architectural rules are captured in the No-Dependency-Soup policy.
   - Inspect `H:/erppreflight/ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md` to verify that TanStack rules (SSR QueryClient isolation, Table + Virtualization, TanStack Form, Pacer, prohibition of TanStack Router/Start) are faithfully specified.
2. **Review Repository Path Coherence**:
   - Confirm that all paths in the Monorepo Directory Map match the real layout in `H:/erppreflight`: `apps/web`, `apps/api`, `services/analysis-python`, `packages/schemas`, `packages/evidence`, `packages/tenancy`, `packages/database`, `packages/auth`.
   - Confirm that verification commands match `package.json` scripts (`pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run test:python`).
3. **Downstream Implementation Verification**:
   - When the parent or builder agent writes `H:/erppreflight/AGENTS.md` using the exact markdown content specified in Section 4 of this report:
     - Verify that `H:/erppreflight/AGENTS.md` is valid Markdown and renders cleanly.
     - Verify that every agent in subsequent milestones can resolve its playbook routing and adheres to the two cardinal axioms and architectural invariants.
