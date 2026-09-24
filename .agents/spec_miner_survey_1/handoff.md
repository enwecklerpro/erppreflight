# Architectural Specification Survey & Cataloging Report

**Agent**: `spec_miner_survey_1` (`teamwork_preview_spec_miner`)  
**Workspace**: `H:/erppreflight/.agents/spec_miner_survey_1`  
**Parent**: `66440be0-c7ee-4a74-8a17-61e13b963df1` (`parent`)  
**Timestamp**: 2026-09-24T02:56:00Z  
**Target Monorepo**: `H:/erppreflight`  

---

## 1. Observation

Direct observations extracted from authoritative documents (`21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md`, `22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md`, `ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md`, `17_TRUST_AI_KNOWLEDGE_RELEASE_GOVERNANCE.md`, and `ORIGINAL_REQUEST.md`):

1. **Local Repository State**:
   - `H:/erppreflight/.agents/skills/` directory does not currently exist.
   - `H:/erppreflight/AGENTS.md` does not currently exist.
   - `apps/web/package.json` currently has Next.js `15.1.7`, React `19.0.0`, Tailwind `3.4.17`, Radix UI primitives (`@radix-ui/react-*`), Zod `3.24.2`, and zero `@tanstack/*` packages installed.
   - `packages/evidence` contains canonical trust scoring, provenance classification (`classifier.ts`), release validation, and SHA-256 offset hashing.
   - `packages/schemas` defines `FindingSchema`, `EvidenceItemSchema`, `SeverityEnum`, `ConfidenceClassEnum` (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`), `EngineTypeEnum` (18 SAP engines), and `CleanCoreTierEnum`.

2. **Part 21 Curated Library Standard (`21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md`)**:
   - Section 21.1: UI Foundation is Next.js, React, TypeScript strict mode, Tailwind CSS, shadcn/ui, and Base UI as preferred headless primitive foundation for new components. "Do not mix Base UI, Radix UI and Ark UI across the product without a documented exception" (lines 19-21).
   - Section 21.2: Motion (`motion/react`) used for intentional micro-interactions only, respecting `prefers-reduced-motion`; no excessive dashboard animation (lines 30-38).
   - Section 21.3: TanStack Query (server state only; not global client store), TanStack Table (findings, SAP object inventories, migration matrices), TanStack Virtual (large lists/tables), TanStack Form (preferred complex form engine; no React Hook Form), TanStack Pacer (debounced search, throttled filters) (lines 39-59).
   - Section 21.4: Zod 4 runtime schema validation across boundaries (API, env, forms, commands, AI structured outputs) (lines 60-74).
   - Section 21.5: Orval for OpenAPI client, TypeScript models, typed hooks, MSW mocks; no hand-maintained duplicate frontend DTOs (lines 75-87).
   - Section 21.6 & 21.7: `@xyflow/react` for interactive dependency/traceability graphs; ELK.js for deterministic automatic graph layouts (LR, TB, hierarchical); accessible table fallback mandatory; heavy layouts in Web Worker (lines 88-125).
   - Section 21.8: Apache ECharts for advanced analytics with modular imports and accessible textual/table alternatives (lines 126-143).
   - Section 21.15: State hierarchy: (1) Server state -> TanStack Query; (2) URL/filter state -> URL params; (3) Local UI -> React state; (4) Complex client workflow -> scoped Zustand only when justified; Redux globally prohibited (lines 207-216).
   - Section 21.19: Drizzle ORM + PostgreSQL; Prisma prohibited (lines 251-263).
   - Section 21.22 & 21.23: BullMQ for async/queued jobs; Temporal evaluated for critical multi-day durable workflows (lines 292-315).
   - Section 21.42: Strict No-Dependency-Soup rule: prohibited duplicates without ADR (Base UI + Radix + Ark UI; TanStack Form + React Hook Form; Drizzle + Prisma; ECharts + multiple chart frameworks; React Flow + alternative graph editor; BullMQ + another Redis queue) (lines 473-492).
   - Section 21.43: Lazy loading required for Monaco, React Flow, ECharts, and large file previews (lines 493-503).

3. **Part 22 Agent Skills and Playbooks (`22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md`)**:
   - Section 22.0: Canonical markdown skill files reside under `/.agents/skills/`. Root `AGENTS.md` routes agents to skills (lines 7-14).
   - Section 22.26: Root `AGENTS.md` must contain product principles, monorepo map, commands, quality gates, skill routing table, forbidden shortcuts, and explicitly state:
     * `A page that renders is not a completed feature.`
     * `An engine without deterministic logic/evidence/fixtures is not complete.` (lines 289-309).
   - Eight specific playbooks designated in dispatch:
     1. `frontend-design-system.md` (22.1)
     2. `data-table-and-large-list.md` (22.2)
     3. `dependency-graph.md` (22.3)
     4. `engine-authoring.md` (22.4)
     5. `sap-evidence.md` (22.5)
     6. `release-aware-knowledge.md` (22.6)
     7. `secure-file-parser.md` (22.7)
     8. `multi-tenant-security.md` (22.8)

4. **TanStack-Only Architecture Specification (`ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md`)**:
   - Scope: TanStack Query, Table, Virtual, Form, Pacer ONLY. Explicitly prohibits TanStack Router and TanStack Start (Next.js is the application router/framework) (lines 16-35).
   - Section 3: Centralized SSR-safe QueryClient factory in Next.js App Router: per-request instance on server (preventing singleton leak across concurrent SSR requests) and persistent singleton on browser (lines 93-120).
   - Section 4 & 5: Typed query keys hierarchical factory; differentiated stale times (static SAP metadata vs SaaS data vs dynamic job status) (lines 123-184).
   - Section 7: Optimistic updates restricted to safe-rollback fields (status, tags, comments, read state); forbidden for billing, permissions, analysis results, destructive actions, or write approvals (lines 213-233).
   - Section 13-16: Reusable `DataTable` architecture with server-side pagination, facet filtering, multi-column sorting, URL sync, column visibility, bulk actions, and server-side exports (lines 329-416).
   - Section 18-21: TanStack Virtual integration for MFS telegrams, SAP objects (100k+), findings (10k+); dynamic vs fixed row height handling (lines 433-496).
   - Section 23-27: TanStack Form + Zod domain schemas, accessible UI components, nested arrays, multi-step wizards, unsaved changes warning, autosave integration with Pacer (lines 517-618).
   - Section 28-30: TanStack Pacer for debounced search, throttled filters, autosave, and client rate-limiting (lines 619-665).
   - Section 49-50: Tenant switching and auth state changes MUST immediately clear the TanStack Query cache, abort pending requests, and reset tenant state (lines 944-969).

---

## 2. Detailed Architectural Specifications Catalog

### 2.1 The 8 Canonical Playbooks (`/.agents/skills/`)

#### Playbook 1: `frontend-design-system.md`
- **Exact Path**: `/.agents/skills/frontend-design-system.md`
- **Title**: `Frontend Design System & Component Architecture Playbook`
- **Trigger**: Any UI component, page layout, theme, styling, or frontend interaction work in `apps/web`.
- **Key Concepts**:
  - Component Architecture: Base UI as the preferred headless primitive layer for new shadcn/ui components, paired with Tailwind CSS, `class-variance-authority` (cva), `clsx`, and `tailwind-merge`.
  - Design Tokens: Standardized color palette with semantic mapping (surface, background, border, primary, secondary, destructive, muted, accent).
  - Accessibility & Light/Dark Mode: WCAG 2.2 AA compliance. Dark mode handled via CSS variables and semantic classes (`bg-background text-foreground`). Contrast ratios >= 4.5:1 for normal text, >= 3:1 for large text/graphical elements.
  - Severity Presentation: Severity indicators (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `LOW`, `INFO`) must NEVER use color as the sole indicator. Must always pair colors with explicit icons, badges, or textual labels.
  - Motion Discipline (`motion/react`):
    * Micro-interactions only.
    * Strict adherence to `prefers-reduced-motion` (disable animations or collapse transitions).
    * Zero excessive dashboard animations; simple CSS transitions for hover/focus.
    * Motion reserved exclusively for layout transitions that materially enhance user comprehension (e.g. accordion expansion, modal entry, animated filter chips).
  - Iconography: Lucide React icons with consistent stroke width (1.5–2px) and semantic sizing (`size-4`, `size-5`).
  - Command Palette: Global shortcut `Cmd/Ctrl + K` providing project switching, object search, finding navigation, engine execution, and admin shortcuts.
  - Toast Notifications: Toast layer encapsulated behind an internal notification component. Analysis findings and critical alerts must persist in UI cards/tables, never solely in ephemeral toasts.
  - Storybook / Isolated Workbench: Stories required for buttons, dialogs, finding cards, evidence blocks, tables, graph nodes, upload states, analysis progress, and empty/error states.
- **Required Invariants**:
  - Do NOT mix Base UI, Radix UI, and Ark UI across the product without a documented ADR exception.
  - Never convey status or severity through color alone.
  - Heavy visual components (Monaco, React Flow, ECharts) must be lazy-loaded with dynamic `next/dynamic` or `React.lazy`.
  - Responsive fallback: Desktop-first enterprise density, with mobile-friendly card/list alternative (no horizontal-scroll lockups).
- **Anti-Patterns**:
  - Importing raw Radix UI or Ark UI alongside Base UI in new components.
  - Over-animating data tables, metrics cards, or charts.
  - Relying on 5-second transient toasts to alert users of migration-blocking findings.
  - Shipping devtools or table debug panels to production builds.

---

#### Playbook 2: `data-table-and-large-list.md`
- **Exact Path**: `/.agents/skills/data-table-and-large-list.md`
- **Title**: `Enterprise Data Table and Large List Virtualization Playbook`
- **Trigger**: Developing or modifying tables, grids, finding lists, SAP object catalogs, migration inventories, admin tables, or MFS telegram logs.
- **Key Concepts**:
  - Canonical Component Structure:
    * `DataTable`: Core table container wrapping `@tanstack/react-table`.
    * `DataTableToolbar`: Global search, facet filter triggers, view toggles, bulk action triggers.
    * `DataTableFilters`: Multi-select facet filter popovers with counts and search.
    * `DataTablePagination`: Page navigation, page size selector (`10, 20, 50, 100`), item range display.
    * `DataTableColumnMenu`: Column visibility toggle menu and pinning controls.
    * `DataTableBulkActions`: Floating/pinned contextual bar when rows are selected (Assign, Resolve, Accept Risk, Export).
    * `DataTableExport`: CSV, JSON, and server-side XLSX export triggers.
    * `DataTableEmptyState`: Contextual empty and zero-search-result states with clear action prompts.
  - Server-Side Operations: For enterprise datasets (>500 items), pagination, multi-column sorting, facet filtering, and global search must execute on the backend. TanStack Table manages local table state and reflects it in query parameters.
  - URL Synchronization: Table state (`page`, `pageSize`, `sort`, `severity`, `status`, `engine`, `tier`) must synchronize with URL search parameters using Next.js `useRouter` / `useSearchParams`. Enables shareable deep links and browser back/forward navigation.
  - Virtualization via `@tanstack/react-virtual`:
    * Used whenever rendered rows exceed 100 items (e.g. MFS logs with 500k+ events, SAP object catalogs with 100k+ items, large findings tables).
    * Fixed row height (`estimateSize: () => 48`) preferred for maximum scroll performance; dynamic row height supported via `measureElement` for expandable detail rows.
    * Top and bottom spacer divs (`virtualRow.start`, `virtualItem.size`) to keep scrollbar geometry accurate without DOM bloat.
    * Overscan configured to 5–10 items for smooth scrolling without visual tearing.
  - Row Selection & Stable IDs: Every row must have a unique stable identifier (UUID or SAP canonical key). Checkbox column with header "select all" supporting indeterminate state.
  - Export Integrity: Export actions must trigger a backend generation or streaming download of the FULL filtered query dataset, NEVER just the virtualized visible DOM slice.
- **Required Invariants**:
  - Never render 10,000+ un-virtualized DOM nodes into the browser.
  - URL query parameters must never contain confidential data or access tokens.
  - Table selection must be fully keyboard accessible (Arrow keys, Spacebar toggle, Enter to open).
- **Anti-Patterns**:
  - Downloading 50,000 JSON records to the browser and performing client-side pagination.
  - Storing duplicate filter state in global Redux or Zustand stores.
  - Virtualizing a table without a fixed-height parent container or proper scroll ref.
  - Exporting only the 20 visible DOM rows when the user clicked "Export All Filtered".

---

#### Playbook 3: `dependency-graph.md`
- **Exact Path**: `/.agents/skills/dependency-graph.md`
- **Title**: `Interactive Dependency Graph and Visual Traceability Playbook`
- **Trigger**: Impact visualization, requirement-to-test traceability, custom field propagation, transport dependency analysis, API relationships, MFS causal flow, What-If simulation trees.
- **Key Concepts**:
  - Canvas Engine: `@xyflow/react` (React Flow) providing smooth interactive canvas with zoom (`minZoom: 0.1, maxZoom: 2`), pan, minimap, background grid, and multi-node selection.
  - Automated Layout via `ELK.js`: Eclipse Layout Kernel for deterministic, layered graph layouts (Left-to-Right `elk.direction=RIGHT`, Top-to-Bottom `elk.direction=DOWN`).
  - Worker Thread Offloading: For graphs exceeding 200 nodes or 500 edges, ELK layout computations must run in a dedicated Web Worker or server-side service to prevent freezing the main UI thread.
  - Canonical Graph Identifiers: Node IDs and Edge IDs must map 1:1 to backend entity identifiers (e.g., SAP object name `R3TR_PROG_ZDEMO`, finding UUID, transport request `DEVK900123`).
  - Object Inspector: Clicking any node opens a slide-over Sheet or sidebar displaying metadata, clean core tier, upstream/downstream dependencies, and linked preflight findings.
  - Interactive Filtering: Dynamic toolbar to filter graph nodes by clean core tier (Tier 1/2/3), subsystem, finding severity, or execution path.
  - Accessible Table Fallback: Graph visualizations must NEVER be the sole method to inspect data. An accessible, synchronized tabular view must always be available via a prominent toggle (`View as Table`).
- **Required Invariants**:
  - Core business logic, dependency resolution, or severity scoring must NEVER be embedded inside UI edge/node rendering functions.
  - Every graph route must provide an accessible table alternative.
  - Large graphs must decouple layout computation from React render cycles.
  - Heavy graph libraries (`@xyflow/react`, `elkjs`) must be code-split and dynamically imported.
- **Anti-Patterns**:
  - Attempting to render 5,000 SVG nodes simultaneously without clustering, subgraphs, or bounding-box culling.
  - Defining custom business rules solely inside canvas drag-and-drop event handlers.
  - Graph views without keyboard navigation or screen reader summaries.

---

#### Playbook 4: `engine-authoring.md`
- **Exact Path**: `/.agents/skills/engine-authoring.md`
- **Title**: `SAP Preflight Engine Authoring & Execution Standard Playbook`
- **Trigger**: Implementing, modifying, or testing any of the 18 SAP Preflight Engines.
- **Key Concepts**:
  - The 18 Canonical SAP Engines:
    1. Output & Extensibility: `OPD_GUARD`, `FORM_DOCTOR`, `CUSTOM_FIELD_FLOW_DOCTOR`, `EXTENSION_IMPACT_GUARD`.
    2. Migration & Clean Core: `SPRO2CLOUD`, `ECC2CLOUD_NAVIGATOR`, `SAP_GAP_RADAR`, `CLEAN_CORE_OBJECT_GUARD`.
    3. Integration: `CHANGE_POINTER_COVERAGE_AUDITOR`, `API_CHANGE_GUARD`.
    4. Release & Transport: `SOFTWARE_COLLECTION_DEPENDENCY_GUARD`, `TRANSPORT_DEPENDENCY_ANALYZER`.
    5. Operations: `SAFE_DECOMMISSION_PREFLIGHT`, `FIORI_403_ROOT_CAUSE_DOCTOR`, `WORKFLOW_STUCK_EXPLAINER`, `IAM_COST_OPTIMIZER`, `ACCOUNT_DETERMINATION_PREFLIGHT`, `SYSTEM_REFRESH_DELTA_GUARD`.
    6. Warehouse Automation: `MFS_BLACKBOX`.
  - Strict 14-Point Engine Anatomy:
    1. Metadata: ID, Name, Operational Domain, Target SAP Releases, Supported Artifact Types.
    2. Input Schema: Strict runtime schema validation (Pydantic in Python, Zod in TS).
    3. Parser / Normalizer: Deterministic, memory-bounded artifact parsing.
    4. Deterministic Analysis: Pure, rule-based AST/DOM/table evaluation logic without probabilistic drift.
    5. Finding Codes: Standardized taxonomy of finding identifiers (e.g. `OPD_DETERMINATION_STEP_MISSING`, `CLEAN_CORE_TIER3_DIRECT_DB_MUTATION`).
    6. Evidence Items: Verifiable pointers containing file path, line number, column, code snippet, artifact SHA-256, and trust score.
    7. Confidence Classifier: Confidence class assignment (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`).
    8. Fixtures: Curated positive, negative, and edge-case test artifacts.
    9. Tests: Automated unit and integration test suites achieving 100% pass rate.
    10. Generated / Property Tests: Property-based testing using Hypothesis (Python) or fast-check (TS) against malformed inputs.
    11. Metrics: Telemetry for execution duration, memory consumption, finding count, unknown rate.
    12. Project / Report Integration: Serialization into unified project findings and assessment exports.
    13. Admin Visibility: Status, health, rule count, and quality score exposed to the Admin Trust Center.
    14. Documentation: Runbooks, rule explanations, and remediation guides.
  - Python Analysis Stack: FastAPI, Pydantic, Polars (for high-volume tabular logs/telegrams), defusedxml/lxml, openpyxl, NetworkX, pytest, Hypothesis.
- **Required Invariants**:
  - Never create an engine that is solely an LLM prompt. AI is strictly for secondary explanation, never the primary verdict.
  - LLM outputs can NEVER exceed `INFERRED` (0.60) confidence.
  - Missing mandatory evidence demotes finding confidence to `UNKNOWN` (score <= 0.30).
  - Every finding must contain exact provenance and cryptographic fingerprint.
- **Anti-Patterns**:
  - Swallowing parser errors and silently returning zero findings.
  - Hardcoding customer-specific names or SAP system IDs into general rules.
  - Calling external web APIs during deterministic analysis execution.

---

#### Playbook 5: `sap-evidence.md`
- **Exact Path**: `/.agents/skills/sap-evidence.md`
- **Title**: `SAP Evidence, Fact Verification, and Provenance Playbook`
- **Trigger**: Writing rules, ingesting knowledge records, constructing evidence chains, or classifying finding confidence.
- **Key Concepts**:
  - Exact Edition & Release Scoping: Explicitly distinguish S/4HANA Public Cloud (e.g. `S4HC_2402`, `S4HC_2408`), S/4HANA Private Cloud, S/4HANA On-Premise (`S4H_2020` to `S4H_2023`), and ECC 6.0. Behavior from On-Premise must NEVER be assumed in Public Cloud.
  - Clean Core Extensibility Distinction:
    * Tier 1 (Cloud Extensibility): Key-user extensibility, public released ABAP APIs, Developer Extensibility in Cloud.
    * Tier 2 (Developer Extensibility): Released APIs, custom wrappers, side-by-side BTP apps.
    * Tier 3 (Classic Extensibility): Unreleased standard objects, modifications, direct DB mutations (`PROHIBITED` in Clean Core).
  - Authoritative Source Trust Hierarchy:
    * Official Metadata / BAPIs / CDS Annotations: `1.0`
    * Official SAP Documentation / Help Portal: `0.95`
    * Official Support Notes & KBAs: `0.90`
    * Curated ERP Preflight Domain Rules: `0.85`
    * Official SAP Community Articles: `0.70`
    * Third-Party Technical References: `0.60`
    * Customer Evidence / Uploaded Artefacts: `0.50`
    * Inferred / Heuristic Analysis: `0.30`
  - Composite Trust Score Formula:
    $$\text{Trust}_{\text{composite}} = \max(T_k) \times \left(1 - \prod_{k=1}^n (1 - 0.2 \cdot T_k)\right) \quad \text{bounded by } \max(T_k)$$
  - Provenance Tracking: Every evidence record must store `artifactPath`, `lineNumber`, `columnNumber`, `snippet`, `sha256`, `sourceType` (`AST`, `XML_DOM`, `CSV_TABLE`, `SAP_CONFIG`, etc.), and `trustScore`.
  - Non-Generalization Invariant: Public Cloud restrictions cannot be back-ported to On-Premise without release qualification; On-Premise custom code cannot be assumed compatible with Public Cloud.
  - Absence Invariant: Absence of an entry in an incomplete customer export does NOT prove the feature is unsupported in SAP. Mark as `UNKNOWN`.
- **Required Invariants**:
  - Findings without verifiable evidence must be classified as `UNKNOWN`.
  - LLM explanations can never override engine verdict or evidence.
  - Cryptographic hash checks are mandatory for all evidence snippets.
- **Anti-Patterns**:
  - Assuming classic user exits or BAdIs are available in S/4HANA Cloud Public Edition.
  - Marking an unmapped SPRO node as "deprecated" when it is merely uncataloged.
  - Fabricating SAP transaction codes or object names in remediation text.

---

#### Playbook 6: `release-aware-knowledge.md`
- **Exact Path**: `/.agents/skills/release-aware-knowledge.md`
- **Title**: `Release-Aware Knowledge Base & Rule Lifecycle Governance Playbook`
- **Trigger**: Updating SAP knowledge bases, mapping tables, SPRO/CBC catalogs, deprecation databases, or rule bundles.
- **Key Concepts**:
  - Canonical Support Matrix: Explicit mapping of Product $\times$ Edition $\times$ Release $\times$ Engine $\times$ Input Artifact $\times$ Status (`SUPPORTED_VERIFIED`, `SUPPORTED_BETA`, `PARTIAL`, `FILE_MODE_ONLY`, `CONNECTOR_MODE_ONLY`, `NOT_SUPPORTED`, `UNKNOWN`).
  - Knowledge Snapshot Versioning: Global SAP knowledge is immutable by snapshot. Snapshots contain Snapshot UUID, build timestamp, source checksums, parser versions, graph version, release metadata, and cryptographic signature.
  - Analysis Immutability: An analysis executed in 2026 binds immutably to an exact Knowledge Snapshot and Rule Bundle. Re-running or inspecting the report in 2028 must yield identical results.
  - Knowledge / Rule Promotion Pipeline: Five-stage promotion: `Draft → Review → Staging → Canary → Production`.
  - Shadow Evaluation: Before promoting rules or knowledge, run in shadow mode against the regression corpus. Evaluate delta in findings, unexpected severity shifts, and unknown rates.
  - Finding Stability & Delta Tracking: If a knowledge update modifies a finding verdict, the system displays: `"Finding changed because rule bundle vX replaced vY"`. Historical records are never silently overwritten.
  - Blast Radius Preview: Before publishing knowledge updates, calculate affected public pages, open findings, watched releases, and customer projects.
- **Required Invariants**:
  - Global knowledge updates must be immutable snapshots with cryptographic checksums.
  - Historical analysis findings must never be silently mutated.
  - A release status can only be set to `SUPPORTED_VERIFIED` after passing its certification pack.
- **Anti-Patterns**:
  - Executing direct SQL updates against production knowledge base tables.
  - Overwriting historical findings in place when knowledge rules change.
  - Releasing unversioned knowledge updates without shadow regression testing.

---

#### Playbook 7: `secure-file-parser.md`
- **Exact Path**: `/.agents/skills/secure-file-parser.md`
- **Title**: `Secure Ingestion Pipeline & Hardened File Parsing Playbook`
- **Trigger**: Ingesting, parsing, extracting, or validating uploaded files (XML, JSON, CSV, ZIP, XLSX, XDP, ABAP, WSDL, EDMX).
- **Key Concepts**:
  - Magic Bytes Verification: Validate MIME types and file signatures (magic numbers) before passing buffers to parsers. Never trust file extensions.
  - Hard Resource & Size Limits:
    * Standard single file upload cap: 100MB (multipart upload up to 2GB for database dumps/telegrams).
    * Maximum uncompressed archive expansion ratio: 100x (reject zip bombs).
    * Maximum uncompressed archive volume: 500MB total.
    * Maximum nested archive depth: 2 levels.
  - Path Traversal Defense: Normalize all archive paths (`zipfile.ZipFile`, `tarfile`). Reject or strip filenames containing `../`, leading slashes, null bytes (`%00`), or Windows drive letters (`C:`).
  - XML External Entity (XXE) Defense: Completely disable external DTDs, external entity resolution, parameter entities, and network entity expansion across all XML parsers (`defusedxml` in Python; safe parser configuration in TypeScript).
  - Secret & Credential Scrubbing: Pre-parse scanner redacting passwords, API tokens, RFC logon credentials, bearer tokens, private keys, and connection strings from files and log outputs before persisting evidence snippets.
  - Sanitized Error Masking: Internal logs retain detailed diagnostic exceptions with correlation IDs; public/API errors return sanitized, user-safe error codes without filesystem paths or stack traces.
  - Memory-Bounded Streaming: Parse large CSV, JSON, and XML files using chunked streams (e.g. PyArrow, Polars streaming, SAX parsers); avoid loading multi-gigabyte files into unified memory.
- **Required Invariants**:
  - XML parsers must disable external DTDs and entities by default.
  - File extension alone must never determine parser routing.
  - Compressed archives must be checked for expansion ratio and path traversal before extraction.
  - Secrets and credentials must be scrubbed before storing evidence snippets.
- **Anti-Patterns**:
  - Using unconfigured `xml.etree.ElementTree` or `lxml` on untrusted customer uploads.
  - Calling `zipfile.extractall()` without verifying extracted member targets.
  - Leaking internal server file paths or database connection errors to client browsers.

---

#### Playbook 8: `multi-tenant-security.md`
- **Exact Path**: `/.agents/skills/multi-tenant-security.md`
- **Title**: `Multi-Tenant Isolation, Data Segregation & Security Playbook`
- **Trigger**: Creating or modifying any API endpoint, database schema, query, cache key, storage artifact, background job, or frontend state management.
- **Key Concepts**:
  - Tenant Boundary Enforcement: Every database query, update, delete, and lookup MUST enforce `organization_id` or tenant scope.
  - PostgreSQL Row-Level Security (RLS): RLS policies active on tenant-partitioned tables as defense-in-depth behind application-layer checks.
  - Object Storage Segregation: S3/MinIO bucket keys structured with strict tenant path prefixes: `/tenants/{organization_id}/projects/{project_id}/...`.
  - Presigned, Short-Lived URLs: File uploads and assessment report downloads use presigned URLs with strict time-to-live (max 15 minutes). No public read access on customer buckets.
  - Cache Isolation: Redis and in-memory cache keys MUST include the tenant identifier (`tenant:{org_id}:...`).
  - Queue Job Isolation: BullMQ jobs must carry tenant context, enforce tenant-aware concurrency limits, and re-verify tenant permissions upon worker execution.
  - Frontend Tenant Switching: When the active organization/tenant switches in the web app:
    * Immediately clear the TanStack Query cache (`queryClient.clear()`).
    * Abort all active in-flight HTTP requests.
    * Reset tenant-scoped local state to prevent cross-tenant UI leakage.
  - Authentication State Changes: On logout, clear all queries, local storage tokens, and memory caches. On role change, invalidate authorization-dependent queries.
  - Automated Cross-Tenant Denial Tests: Every endpoint must have an integration test proving Tenant A cannot access, modify, or infer Tenant B's data (must return HTTP 403 or 404).
- **Required Invariants**:
  - All database tables holding tenant data must include `organization_id`.
  - Presigned URLs must have short lifespans (<= 15 minutes).
  - TanStack Query cache must be cleared immediately upon tenant switch or logout.
  - Cross-tenant requests must fail closed and emit security audit alerts.
- **Anti-Patterns**:
  - Omitting `organization_id` from a `WHERE` clause because an ID is a UUID.
  - Sharing global Redis cache keys across tenants without tenant prefixing.
  - Caching sensitive SAP findings in browser `localStorage`.
  - Accepting tenant IDs from client request bodies without validating user session permissions.

---

### 2.2 Root `AGENTS.md` Requirements

The root `H:/erppreflight/AGENTS.md` serves as the authoritative operating manual for all human and AI agents working on the repository. It must include:

1. **Mission Statement & Product Principles**:
   - ERP Preflight is a production-grade, enterprise-ready multi-tenant SaaS platform for SAP preflight analysis, clean core auditing, migration verification, and release intelligence.
   - Non-negotiable core axioms:
     * `A page that renders is not a completed feature.` (UI without real data, schema validation, accessibility, and error handling is incomplete).
     * `An engine without deterministic logic/evidence/fixtures is not complete.` (Engines must have deterministic parsers, rules, evidence, trust scoring, and test fixtures).
2. **Monorepo Directory Map**:
   - `apps/web`: Next.js App Router frontend (Base UI, shadcn/ui, TanStack Suite, Tailwind CSS).
   - `apps/api`: NestJS core API backend (Fastify adapter, Drizzle ORM, multi-tenant auth, BullMQ queues).
   - `services/analysis-python`: FastAPI analysis microservice (deterministic SAP parsers, Polars, defusedxml).
   - `packages/schemas`: Zod schemas and TypeScript types defining platform contracts.
   - `packages/evidence`: Evidence engine, trust scoring, provenance classifier, release validation.
   - `packages/tenancy`: Multi-tenant isolation, context guards, RLS utilities.
   - `packages/database`: Drizzle schema, migrations, PostgreSQL connection management.
   - `packages/auth`: Authentication and authorization adapters (Better Auth, Cerbos policies).
   - `/.agents/skills/`: Canonical engineering playbooks and architecture standards.
3. **Agent Skill Routing Table**:
   | Domain / Task Context | Assigned Playbook | Primary Focus & Invariants |
   |---|---|---|
   | Frontend, UI, pages, components | `frontend-design-system.md` | Base UI + shadcn, design tokens, non-color severity, motion restraint |
   | Tables, lists, large grids, virtual rows | `data-table-and-large-list.md` | TanStack Table + Virtual, URL sync, server paging, no 10k DOM nodes |
   | Visual graphs, dependency flow, impact | `dependency-graph.md` | `@xyflow/react`, ELK.js layout, Web Worker, accessible table fallback |
   | SAP preflight engines, parsers, rules | `engine-authoring.md` | 14-point engine structure, deterministic logic, fixtures, no LLM-only engines |
   | SAP facts, evidence chains, trust scoring | `sap-evidence.md` | Provenance tracking, trust scoring, clean core tiers, UNKNOWN on absence |
   | Knowledge base, SPRO/CBC catalogs, releases | `release-aware-knowledge.md` | Immutable snapshots, support matrix, shadow evaluation, finding stability |
   | File uploads, parsers, ZIP/XML ingestion | `secure-file-parser.md` | Magic bytes, zip bomb defense, XXE disabled, secret scrubbing |
   | Multi-tenancy, auth, RLS, storage, cache | `multi-tenant-security.md` | Tenant isolation on all queries/keys, RLS, presigned URLs, query cache wipe |
4. **Architectural Guardrails & Forbidden Shortcuts**:
   - No LLM-only engines; AI is strictly for secondary explanation.
   - Zero-duplication library policy: no React Hook Form, no Redux, no Prisma, no mixing Base UI/Radix/Ark UI.
   - Next.js App Router is the sole router; no TanStack Router.
   - TanStack QueryClient must be created per-request on SSR to prevent cross-tenant data leaks.
   - Zod 4 runtime validation required across all external and inter-service boundaries.
   - Drizzle ORM is the single source of truth for database interactions; transactions explicit.
5. **Quality Gates & Test Commands**:
   - Monorepo Build: `pnpm run build` (must pass with 0 errors).
   - Typecheck: `pnpm run typecheck` or `tsc --noEmit`.
   - Linting: `pnpm run lint`.
   - Python Analysis Tests: `pytest services/analysis-python/tests`.
   - Backend NestJS Tests: `pnpm --filter @erppreflight/api test`.
   - E2E & Accessibility Tests: `pnpm exec playwright test`.

---

### 2.3 Part 21 Curated Library Stack Requirements

1. **UI Foundation & Design System**:
   - **Framework**: Next.js 15+ App Router, React 19, TypeScript strict mode.
   - **Styling**: Tailwind CSS (with `@tailwindcss/typography`, custom theme tokens).
   - **Component Layer**: shadcn/ui built on **Base UI** headless primitives.
   - **Icons**: `lucide-react`.
   - **Motion**: `motion` (`motion/react`). Rules: intentional micro-interactions only; must check `prefers-reduced-motion`; simple CSS transitions for hover/focus; no excessive dashboard motion.
2. **Runtime Schema Validation**:
   - **Primary Library**: **Zod 4** (or current stable Zod with Zod 4 migration compatibility).
   - **Validation Scope**: API request payloads, API responses, environment variables, form state, internal worker commands, AI structured outputs, event schemas.
   - **JSON Schema**: High-performance JSON Schema workloads (imported schemas, external plugin manifests) use **Ajv**; application TypeScript schemas use **Zod**.
3. **OpenAPI Client Generation**:
   - **Tool**: **Orval**.
   - **Workflow**: Backend NestJS Swagger/OpenAPI spec -> Orval CLI -> generated TypeScript models, typed API fetch clients, and TanStack Query hooks.
   - **Rule**: Generated code resides in a dedicated package (e.g. `packages/api-client`), marked with `@generated`, and NEVER manually edited.
4. **Graph & Visualization Stack**:
   - **Interactive Graphs**: `@xyflow/react` (React Flow) for dependency trees, transport chains, custom field flows, and What-If simulations.
   - **Automatic Layout**: `elkjs` (ELK.js) for deterministic hierarchical and directed layouts. Executed in Web Workers for large graphs.
   - **Analytics & Charts**: `echarts` (Apache ECharts) for complex time-series, clean core distribution, and readiness metrics. Modular imports only; accessible table/text alternatives mandatory.
5. **Desktop Technical Editors**:
   - **Editor**: `monaco-editor` / `@monaco-editor/react`.
   - **Use Cases**: JSON/YAML rule editing, XML inspection, side-by-side Diff Editor for ChangeSets and API deprecations.
   - **Rule**: Lazy-loaded via dynamic import; lightweight textareas for simple/mobile editing.
6. **Drag & Drop**:
   - **Library**: `@dnd-kit/core`, `@dnd-kit/sortable`.
   - **Rule**: Used for widget reordering and mapping interfaces; accessible keyboard reordering required.
7. **Internationalization & Dates**:
   - **i18n**: `next-intl` (EN/DE at launch, ICU formatting, localized numbers/dates, canonical SAP technical terms un-translated).
   - **Dates**: Temporal API / polyfill + `date-fns`. Timestamps stored in UTC, displayed in user timezone, SAP source timezone preserved.
8. **State Management Hierarchy**:
   - Priority 1: Server State -> **TanStack Query**.
   - Priority 2: Filter/Search/Page State -> **URL Parameters**.
   - Priority 3: Component UI State -> **React `useState` / `useReducer`**.
   - Priority 4: Complex Multi-Step Client Workflow -> Scoped **Zustand** store only when justified.
   - **Forbidden**: Redux.
9. **Strict Zero-Duplication Policies**:
   - No React Hook Form (TanStack Form is canonical).
   - No Redux or MobX.
   - No Prisma (Drizzle is canonical).
   - No TanStack Router (Next.js is canonical).
   - No mixing Base UI, Radix, and Ark UI without ADR.
   - No arbitrary multiple chart libraries (ECharts is canonical).
   - No BullMQ replacement for simple Redis queues; Temporal reserved for multi-day durable workflows.

---

### 2.4 Enterprise TanStack Suite Architecture

#### 1. TanStack Query (`@tanstack/react-query`)
- **SSR-Safe QueryClient Factory (Next.js App Router)**:
  * Problem: In Next.js App Router, SSR requests share the same Node.js runtime process. A global singleton `QueryClient` will leak cached tenant data across user requests!
  * Factory Architecture:
    ```ts
    // apps/web/src/lib/query-client.ts
    import { QueryClient, defaultShouldDehydrateQuery, isServer } from '@tanstack/react-query';

    function makeQueryClient() {
      return new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error: any) => {
              if (error?.status === 401 || error?.status === 403 || error?.status === 404) return false;
              return failureCount < 2;
            },
          },
          dehydrate: {
            shouldDehydrateQuery: (query) =>
              defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
          },
        },
      });
    }

    let browserQueryClient: QueryClient | undefined = undefined;

    export function getQueryClient(): QueryClient {
      if (isServer) {
        // Server: always create a fresh QueryClient per request
        return makeQueryClient();
      } else {
        // Browser: create a singleton on the client
        if (!browserQueryClient) browserQueryClient = makeQueryClient();
        return browserQueryClient;
      }
    }
    ```
- **Hydration Pattern**:
  * Server Components prefetch data: `await queryClient.prefetchQuery({ queryKey, queryFn })`.
  * Wrap Client Component subtree in `<HydrationBoundary state={dehydrate(queryClient)}>`.
  * Client Component calls `useQuery(options)` with instant cache hit and zero layout shift.
- **Hierarchical Typed Query Keys**:
  * Centralized query key factories:
    ```ts
    export const projectKeys = {
      all: ['projects'] as const,
      lists: () => [...projectKeys.all, 'list'] as const,
      list: (filters: ProjectFilters) => [...projectKeys.lists(), filters] as const,
      details: () => [...projectKeys.all, 'detail'] as const,
      detail: (id: string) => [...projectKeys.details(), id] as const,
    };

    export const findingKeys = {
      all: ['findings'] as const,
      lists: () => [...findingKeys.all, 'list'] as const,
      list: (projectId: string, filters: FindingFilters) => [...findingKeys.lists(), projectId, filters] as const,
      details: () => [...findingKeys.all, 'detail'] as const,
      detail: (id: string) => [...findingKeys.details(), id] as const,
    };
    ```
- **Cache Invalidation & Optimistic Updates**:
  * Explicit invalidation on mutation success: `queryClient.invalidateQueries({ queryKey: findingKeys.list(projectId, filters) })`.
  * Optimistic updates allowed ONLY for safe rollback actions (status toggle, tags, comments, notification read marker).
  * Optimistic updates FORBIDDEN for billing, permissions, destructive deletes, and production write approvals.
- **Tenant Switching & Logout Safety**:
  * On organization switch or user logout, immediately execute:
    ```ts
    queryClient.cancelQueries();
    queryClient.clear();
    ```
  * Prevents previous tenant data from flashing or remaining accessible.

#### 2. TanStack Table (`@tanstack/react-table`) & Virtual (`@tanstack/react-virtual`)
- **Enterprise `DataTable` Features**:
  * Multi-column sorting (`sorting` state).
  * Faceted multi-value filtering (`columnFilters` state).
  * Column visibility toggle menu (`columnVisibility` state).
  * Bulk row selection (`rowSelection` state) with indeterminate master checkbox.
  * Server-side pagination (`pagination` state, page index/size).
  * Column resizing and pinning where needed.
  * Export engine: CSV/JSON/XLSX export triggers backend generation of the complete filtered dataset.
- **TanStack Virtual Integration (`@tanstack/react-virtual`)**:
  * Virtualizes table rows when row counts exceed 100 items (supporting 10,000 to 500,000 items).
  * Core virtualizer hook:
    ```ts
    const virtualizer = useVirtualizer({
      count: table.getRowModel().rows.length,
      getScrollElement: () => tableContainerRef.current,
      estimateSize: () => 48,
      overscan: 10,
    });
    ```
  * Renders top and bottom spacer rows:
    ```tsx
    {virtualizer.getVirtualItems().map((virtualRow) => {
      const row = table.getRowModel().rows[virtualRow.index];
      return <TableRow key={row.id} data-index={virtualRow.index} ref={virtualizer.measureElement}>...</TableRow>;
    })}
    ```
  * Dynamic height support via `measureElement` for expandable finding details and multiline log entries.
  * Accessibility: Roving tabindex, arrow key navigation, aria-rowindex, aria-selected.

#### 3. TanStack Form (`@tanstack/react-form`)
- **Architecture**:
  * Canonical form engine for ERP Preflight.
  * Seamless integration with Zod schemas via `@tanstack/zod-form-adapter`.
  * Form state tracking: `values`, `errors`, `touched`, `isDirty`, `isValid`, `isSubmitting`.
- **Reusable UI Integration**:
  * `FormField` component encapsulating accessible label, input/select/textarea, description help text, required marker (`*`), and inline error message.
  * Screen reader summary alert at the top of multi-field forms listing all validation errors.
- **Advanced Enterprise Capabilities**:
  * Dynamic arrays (`form.pushFieldValue`) for mapping rules and SAP connection parameters.
  * Multi-step wizards (SAP Connector Wizard, Project Onboarding Wizard).
  * Async validation (e.g. validating system slug uniqueness or SAP connection reachability).
  * Unsaved changes warning: Dirty state tracking prompting confirmation before navigating away.
  * Autosave integration with TanStack Pacer for drafting project notes and custom rules.

#### 4. TanStack Pacer
- **High-Frequency UX Pacing Utilities**:
  * `useDebouncedSearch`: Debounced input for global search and SAP object search (300ms debounce), preventing backend API floods.
  * `useThrottledFilter`: Throttled filter updates (e.g., slider/numeric range filters).
  * `useAutosavePacer`: Controlled debounced saving for non-destructive drafts (notes, draft rules).
  * `useRateLimitedAction`: Throttling expensive client-side operations (graph re-layouts, simulation previews).

---

### 2.5 Reference Pages and Acceptance Criteria

#### 1. Findings Reference Page (`/projects/[id]/findings`)
- **Route**: `apps/web/src/app/projects/[id]/findings/page.tsx`
- **Data Ingestion**: TanStack Query fetching findings by `projectId` and URL filters.
- **Table Components**:
  * Search bar with TanStack Pacer debounce.
  * Facet filter bar: Severity (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `LOW`, `INFO`), Engine Type (18 engines), Clean Core Tier (Tier 1/2/3), Confidence Class (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`), Finding Status (`OPEN`, `RESOLVED`, `ACCEPTED_RISK`).
  * Table Columns: Selection checkbox, Severity badge (color + icon + text), Finding Title & Rule ID, Engine Type badge, Affected Objects, Clean Core Tier, Confidence badge with Trust Score, Created Date, Actions menu.
  * Virtualized rendering via `@tanstack/react-virtual` for projects with 10,000+ findings.
  * Bulk action toolbar: Batch Assign, Batch Resolve, Batch Risk Acceptance, Export to CSV / JSON.
  * Interactive Row Inspector: Slide-over sheet opening on row click, rendering finding remediation guide, technical details JSON, and interactive Evidence Inspector (file snippet, line/col, sha256 hash, trust score).

#### 2. SAP Object Inventory Reference Page (`/projects/[id]/objects`)
- **Route**: `apps/web/src/app/projects/[id]/objects/page.tsx`
- **Scale**: Architected to handle 100,000+ custom and standard SAP objects (tables, programs, CDS views, BAdIs, function modules, OData services).
- **Features**:
  * Global object search with 300ms TanStack Pacer debounce.
  * Server-side windowed pagination and virtualized list/table rendering.
  * Prefetching on Hover: Hovering an object prefetches its dependency graph and impact summary via `queryClient.prefetchQuery`.
  * Object Inspector: Clean Core Tier classification, modification flags, deprecation status, and linked preflight findings.
  * Export: Filtered object inventory export to CSV and JSON.

#### 3. Verification Standards & Acceptance Criteria
- **Playbooks & AGENTS.md**:
  * All 8 canonical playbooks exist under `/.agents/skills/` with complete sections, invariants, and anti-patterns.
  * Root `AGENTS.md` is present, valid, and maps every agent task to its corresponding playbook.
- **Build & Quality**:
  * `pnpm run build` succeeds across monorepo with 0 TypeScript errors.
  * `pnpm run lint` passes cleanly with no schema or dependency violations.
- **TanStack Suite Automated Tests**:
  * SSR Safety: Test verifies `getQueryClient()` returns distinct instances on server and a single shared instance on client.
  * Hydration: Test verifies server-dehydrated state hydrates cleanly into client components without client refetches.
  * Table: Tests verify multi-column sorting, facet filtering, row selection, bulk action triggers, and URL sync.
  * Virtualization: Test verifies DOM node count remains constant (~30 rendered DOM elements) when scrolling through a 10,000-row virtualized table.
  * Form: Tests verify Zod schema validation errors render inline, valid submissions invoke API mutations, and dirty state triggers unsaved warnings.
  * Pacer: Tests verify debounce timer delay, cancellation on unmount, and latest-value execution.

---

## 3. Features Discovered Table

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|---|---|---|---|---|---|---|
| 1 | Playbooks | `frontend-design-system.md` | Base UI + shadcn/ui, design tokens, non-color severity, motion restraint | Component props, tokens | Accessible UI elements | WCAG violation flagged in CI | Part 22.1, 21.1 |
| 2 | Playbooks | `data-table-and-large-list.md` | TanStack Table + Virtual enterprise grid, URL sync, server paging | Dataset, column definitions, URL params | Virtualized table, filters, exports | DOM bloat error if >100k unvirtualized | Part 22.2, 21.3, TanStack Prompt §12 |
| 3 | Playbooks | `dependency-graph.md` | `@xyflow/react` + ELK.js layout, Web Worker, accessible table fallback | Graph nodes, edges, layout config | Interactive canvas + table view | Main thread block error if not in worker | Part 22.3, 21.6, 21.7 |
| 4 | Playbooks | `engine-authoring.md` | 14-point engine structure, deterministic analysis, test fixtures | Artifact streams, target releases | Findings, evidence, trust score | Reject LLM-only engines; throw on invalid input | Part 22.4, 22.26, Part 17 |
| 5 | Playbooks | `sap-evidence.md` | Provenance tracking, source trust scoring, clean core tiers | Artifact line/col offsets, source type | Verifiable evidence items, trust score | Missing evidence demotes to UNKNOWN | Part 22.5, `packages/evidence` |
| 6 | Playbooks | `release-aware-knowledge.md` | Immutable knowledge snapshots, support matrix, shadow evaluation | SAP release metadata, rules | Snapshot hash, stability audit | Reject live edits to prod knowledge | Part 22.6, Part 17.1-17.10 |
| 7 | Playbooks | `secure-file-parser.md` | Magic bytes check, zip bomb defense, XXE disabled, secret scrubbing | Uploaded raw byte buffers | Sanitized normalized data structures | Reject zip bombs, XXE, malformed files | Part 22.7, Part 21.29 |
| 8 | Playbooks | `multi-tenant-security.md` | Tenant boundary on all queries/keys, RLS, presigned URLs, query cache wipe | Tenant context, user session | Isolated tenant data | Deny cross-tenant access with 403/404 | Part 22.8, TanStack Prompt §49 |
| 9 | Governance | Root `AGENTS.md` | Operating rules, skill routing table, non-negotiable architectural axioms | Agent task assignment | Playbook binding, command guides | Fail quality gate on violation | Part 22.26 |
| 10 | Library Stack | Base UI Foundation | Headless accessible primitives for shadcn/ui component layer | Component props | Styled accessible HTML elements | Reject Radix/Ark UI duplication | Part 21.1 |
| 11 | Library Stack | Zod 4 Schema Validation | Runtime schema validation across API, env, forms, commands, AI | Unknown external payloads | Typed, validated domain objects | ZodError with path-specific details | Part 21.4 |
| 12 | Library Stack | Orval Client Generation | OpenAPI contract to typed fetch clients and TanStack Query hooks | OpenAPI JSON/YAML spec | Typed TS models, hooks, MSW mocks | Build failure on spec drift | Part 21.5 |
| 13 | Library Stack | Apache ECharts | Advanced enterprise data visualizations with modular bundle imports | Metrics time series, distributions | Canvas/SVG charts + table fallback | Reject simple card usage | Part 21.8 |
| 14 | Library Stack | Monaco Editor | Desktop code/XML/JSON editing and side-by-side Diff Editor | Text, language, diff models | Interactive code editor | Fallback to textarea on mobile | Part 21.9 |
| 15 | TanStack Suite | SSR-Safe QueryClient | Per-request QueryClient on SSR, client singleton, hydration boundary | Request context, server queries | Hydrated React query state | Memory leak / cross-tenant leak if singleton | TanStack Prompt §3, §38 |
| 16 | TanStack Suite | Hierarchical Query Keys | Structured query key factory for deterministic cache invalidation | Entity ID, filter objects | Tuple query keys | Ad-hoc string keys prohibited | TanStack Prompt §4 |
| 17 | TanStack Suite | Optimistic Update Guard | Optimistic updates restricted to safe-rollback user actions | Mutation input, rollback cache | Optimistic UI state | Disallowed for billing/permissions | TanStack Prompt §7 |
| 18 | TanStack Suite | Enterprise DataTable | Multi-column sort, facet filter, column visibility, bulk selection | Row data, column configs | Interactive data grid | Inconsistent table architecture rejected | TanStack Prompt §13-16 |
| 19 | TanStack Suite | `@tanstack/react-virtual` | DOM windowing for 10k-500k rows with dynamic row height support | Row count, scroll ref, estimateSize | Rendered slice with top/bottom spacers | Fallback to fixed size on measure fail | TanStack Prompt §18-21 |
| 20 | TanStack Suite | TanStack Form + Zod | Type-safe form management with Zod schema validation and error UX | Zod schema, default values | Form instance, field states, submit | Inline field errors + summary alert | TanStack Prompt §22-25 |
| 21 | TanStack Suite | TanStack Pacer | Debounced search (300ms), throttled filters, autosave pacing | High-frequency input events | Paced function execution | Cancel pending timers on unmount | TanStack Prompt §28-30 |
| 22 | TanStack Suite | Tenant Cache Wipe | Immediate query cache clearance on tenant switch or user logout | Tenant switch event, logout event | Clean QueryClient cache | Security audit alert on cross-tenant hit | TanStack Prompt §49, §50 |
| 23 | Reference Pages | Findings Inspector Page | Virtualized findings table with facet filters, bulk actions, row inspector | Project ID, query params | Findings grid + Evidence drawer | Error boundary on query failure | TanStack Prompt §67 |
| 24 | Reference Pages | SAP Object Inventory Page | Virtualized 100k+ object catalog with debounced search & prefetching | Project ID, search term | Object grid + Inspector sheet | Empty state with suggested queries | TanStack Prompt §68 |

---

## 4. Edge Cases

| # | Feature | Input / Scenario | Observed Behavior / Architectural Rule |
|---|---|---|---|
| 1 | TanStack Query SSR | Concurrent user requests during Next.js App Router server-side rendering | A global singleton QueryClient would leak Tenant A's cached queries to Tenant B. Enforce `makeQueryClient()` factory per-request on server (`isServer` check). |
| 2 | Tenant Switching | User switches organization from Org A to Org B in UI | In-flight requests for Org A are aborted; `queryClient.clear()` wipes all cached queries immediately; local tenant state resets to prevent cross-tenant data leakage. |
| 3 | Query Optimistic Updates | User attempts optimistic update on permission grant or billing upgrade | Forbidden. Optimistic updates permitted ONLY on safe rollback items (tags, status, comments). High-risk operations must wait for authoritative server response. |
| 4 | Large List Virtualization | 100,000 SAP objects or 500,000 MFS telegrams loaded | Browser crashes if rendered directly. Backend must use windowed/paged queries; frontend renders only visible window (~30 items) with top/bottom spacer divs. |
| 5 | Dynamic Row Heights | Expandable finding row containing multiline code snippet and evidence details | Virtualizer row heights cannot be fixed. Use `measureElement` callback on row DOM node to dynamically update scroll height cache without jitter. |
| 6 | File Ingestion / Parser | Malformed ZIP file containing 10,000 nested empty directories or 1000x expansion ratio | Zip bomb defense triggers: reject files exceeding 100x expansion ratio or >500MB uncompressed volume; reject nested archives deeper than 2 levels. |
| 7 | File Path Traversal | ZIP archive containing entry `../../../../etc/passwd` or `C:\Windows\System32` | Path traversal protection cleanses path; rejects any entry resolving outside extraction target directory; returns sanitized validation error. |
| 8 | XML Parsing | Uploaded XML file containing `<!ENTITY xxe SYSTEM "http://malicious.internal">` | XXE protection blocks entity resolution; `defusedxml` (Python) or safe DOM parser (TS) halts parsing immediately and raises security violation. |
| 9 | Confidence Classification | Finding generated with missing mandatory evidence or generated via LLM prompt | `classifyProvenance` demotes missing evidence finding to `UNKNOWN` (score 0.30 or 0.0); LLM output is capped at `INFERRED` (score 0.60 maximum). |
| 10 | SAP Public vs On-Prem | User runs custom BAdI rule designed for On-Premise against S/4HANA Public Cloud 2408 | Rule engine fails closed or marks as `UNKNOWN`; does NOT generalize On-Premise compatibility; flags Tier 3 classic extensibility violation. |
| 11 | Export Full Dataset | User filters 50,000 findings down to 2,400 and clicks "Export to CSV" | System must NOT export only the ~20 visible virtualized DOM rows. It must stream or trigger a server-side export using the exact query filter parameters. |
| 12 | Form Unsaved Changes | User edits SAP connector configuration and attempts to click a navigation link | TanStack Form dirty state detection halts route change and renders confirmation modal: "You have unsaved changes. Discard or Save?" |
| 13 | Mobile Table Rendering | Mobile viewport (<768px) loads complex multi-column finding grid | Horizontal scroll lockup avoided by switching DataTable to responsive card/list presentation with accessible accordion inspector. |
| 14 | Motion Accessibility | Operating system has `prefers-reduced-motion: reduce` enabled | All Motion (`motion/react`) transitions collapse or disable instantly; zero continuous looping animations or spring physics. |

---

## 5. Logic Chain

1. **Premise**: ERP Preflight is an enterprise-grade multi-tenant SaaS platform where incorrect findings or data leaks directly impact enterprise migration decisions and regulatory compliance.
2. **Observation**: Parts 21 and 22 explicitly mandate a curated, non-overlapping library stack, 8 canonical playbooks under `/.agents/skills/`, a root `AGENTS.md`, and strict architectural invariants.
3. **Inference**: Autonomous agents and developers will inevitably introduce duplicate libraries (React Hook Form vs TanStack Form, Radix vs Base UI, Redux vs TanStack Query) or create LLM-only engines unless playbooks establish unambiguous, non-negotiable rules and anti-patterns.
4. **Observation**: In Next.js App Router SSR, multiple requests execute concurrently in the same Node.js server process.
5. **Inference**: A global singleton `QueryClient` creates a severe multi-tenant vulnerability, leaking sensitive SAP data across tenant boundaries. Therefore, the QueryClient factory must strictly differentiate server (per-request instance) from client (browser singleton).
6. **Observation**: Preflight analyses process datasets ranging from tens of thousands of findings to 500,000+ MFS telegrams.
7. **Inference**: Direct DOM rendering will crash client browsers. TanStack Table coupled with `@tanstack/react-virtual` is necessary to maintain a constant DOM footprint (~30 elements) while maintaining fluid 60fps scrolling and keyboard accessibility.
8. **Conclusion**: Establishing the 8 playbooks, root `AGENTS.md`, curated library standards, and TanStack suite primitives provides the necessary architectural foundation for all downstream implementation milestones.

---

## 6. Caveats

1. **Version Pinning Details**: Next.js 15.1.7 and React 19 are installed in `apps/web`. TanStack packages (`@tanstack/react-query` v5, `@tanstack/react-table` v8, `@tanstack/react-virtual` v3, `@tanstack/react-form` v0.x, `@tanstack/react-pacer`) must be verified for complete React 19 peer-dependency compatibility during installation.
2. **Base UI Release Status**: Base UI (by the MUI team) is emerging as the headless foundation for modern shadcn/ui. While existing Radix components in `apps/web` can be retained where functional, all new components must conform to the unified ERP Preflight component API.
3. **Zod 4 Upgrade**: `apps/web` currently installs Zod 3.24.2. Zod 4 migration should be handled with backward-compatible schemas to avoid breaking existing validators in `packages/schemas`.
4. **Read-Only Scope**: In strict accordance with the Specification Miner archetype, this agent has NOT created, modified, or deleted any implementation code outside its designated `.agents/spec_miner_survey_1` directory.

---

## 7. Conclusion

The architectural investigation and specification mining for ERP Preflight is complete. All requirements across the 8 canonical playbooks, root `AGENTS.md`, Part 21 curated stack, Enterprise TanStack suite, and reference pages have been thoroughly extracted, structured, and cross-referenced with repository source code and master specifications.

Downstream worker agents can immediately proceed to:
1. Author the 8 canonical playbooks in `/.agents/skills/`.
2. Generate root `AGENTS.md`.
3. Install and configure the curated TanStack and UI packages in `apps/web`.
4. Implement the SSR-safe QueryClient, DataTable, TanStack Form, and Pacer abstractions.
5. Build the reference Findings and SAP Object Inventory pages.

---

## 8. Verification Method

To independently verify the discoveries and architectural invariants in this report:

1. **Inspect Authoritative Specifications**:
   - `H:/erppreflight/21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md`
   - `H:/erppreflight/22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md`
   - `H:/erppreflight/ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md`
   - `H:/erppreflight/17_TRUST_AI_KNOWLEDGE_RELEASE_GOVERNANCE.md`
2. **Inspect Existing Schemas & Evidence**:
   - `H:/erppreflight/packages/evidence/src/classifier.ts` (verify trust scoring and provenance invariants)
   - `H:/erppreflight/packages/schemas/src/finding.ts` (verify finding structure and evidence schema)
   - `H:/erppreflight/apps/web/package.json` (verify current dependencies and lack of TanStack packages)
3. **Invalidation Conditions**:
   - If an agent installs React Hook Form or Redux in `apps/web`, this violates the zero-duplication standard in Part 21.42.
   - If an engine is implemented as a raw LLM prompt without deterministic rules and fixtures, this violates Part 22.4 and AGENTS.md.
   - If the QueryClient is initialized as a server-side singleton in Next.js, this violates TanStack Prompt §3 and multi-tenant security rules.
