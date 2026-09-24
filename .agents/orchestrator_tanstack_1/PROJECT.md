# Project: ERP Preflight TanStack Architecture & Standards

## Architecture
Monorepo consisting of Next.js 15 App Router (`apps/web`), Fastify API (`apps/api`), Python FastAPI analysis engine (`services/analysis-python`), and shared packages (`packages/auth`, `packages/database`, `packages/evidence`, `packages/schemas`, `packages/tenancy`).
This project integrates the Part 21 Curated Library Stack, Part 22 Repository Skills Playbooks & root `AGENTS.md`, and enterprise TanStack Suite primitives (Query, Table, Virtual, Form, Pacer) into `apps/web` and the root architecture.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Playbook: frontend-design-system.md | Base UI + shadcn, design tokens, non-color severity indicators, motion discipline, accessibility | M1 (DONE) | Part 22.1 |
| 2 | Playbook: data-table-and-large-list.md | TanStack Table + Virtual, URL sync, server-side pagination, dynamic row measurement, exports | M1 (DONE) | Part 22.2 |
| 3 | Playbook: dependency-graph.md | @xyflow/react + ELK.js layout, Web Worker, accessible table fallback | M1 (DONE) | Part 22.3 |
| 4 | Playbook: engine-authoring.md | 14-point engine anatomy, deterministic AST/rules, confidence scoring (1.0/0.85/0.60/0.30) | M1 (DONE) | Part 22.4 |
| 5 | Playbook: sap-evidence.md | Edition scoping, Clean Core tiers, trust score formula, UNKNOWN confidence rules | M1 (DONE) | Part 22.5 |
| 6 | Playbook: release-aware-knowledge.md | Knowledge snapshots, cryptographic checksums, support matrix, 5-stage promotion pipeline | M1 (DONE) | Part 22.6 |
| 7 | Playbook: secure-file-parser.md | Magic bytes, zip bomb limits (100x/500MB), path traversal, XXE disabled, secret scrubbing | M1 (DONE) | Part 22.7 |
| 8 | Playbook: multi-tenant-security.md | Tenant boundary, RLS defense-in-depth, presigned URLs (<=15m), Query cache clearing on tenant switch | M1 (DONE) | Part 22.8 |
| 9 | Root AGENTS.md | Product axioms, monorepo map, commands, quality gates, skill routing table, forbidden shortcuts | M1 (DONE) | Part 22.26 |
| 10 | Monorepo Dependency Alignment | Install @tanstack/react-query, @tanstack/react-table, @tanstack/react-virtual, @tanstack/react-form, @tanstack/pacer (or hook equivalents), @xyflow/react, motion, base-ui primitives | M2 (DONE) | Part 21.1-21.3 |
| 11 | Zero-Duplication & Prohibited Libs Audit | Guarantee zero react-hook-form, zero redux, zero duplicate state/form/table frameworks | M2 (DONE) | Part 21.42 |
| 12 | Orval Configuration | orval.config.ts setup for typed OpenAPI client & hook generation | M2 (DONE) | Part 21.5 |
| 13 | SSR-Safe QueryClient Factory | apps/web centralized factory preventing SSR singleton leaks, hydration wrapper, query key factories | M3 | TanStack Prompt §3-6 |
| 14 | Enterprise DataTable Component | Reusable DataTable wrapping TanStack Table: multi-sort, facet filter popovers, column visibility, bulk selection | M3 | TanStack Prompt §13-16 |
| 15 | Virtualization Primitive Integration | Seamless @tanstack/react-virtual integration with DataTable for 10,000+ rows, spacers, auto-measure | M3 | TanStack Prompt §18-21 |
| 16 | TanStack Form + Zod Integration | Type-safe form abstraction with Zod schema validation, accessible form fields, dirty state warning | M3 | TanStack Prompt §23-27 |
| 17 | TanStack Pacer Primitives | Debounced search (300ms), throttled filter queries (500ms), batch input handling | M3 | TanStack Prompt §28-30 |
| 18 | Findings Reference Page & Inspector | Virtualized findings grid, URL-synced facet filters (severity, confidence, tier, engine), export to CSV/JSON | M4 (DONE) | TanStack Prompt §16, 21 |
| 19 | SAP Object Inventory Reference Page | Virtualized inventory grid (10k+ capacity), type/package filters, details drawer, export | M4 (DONE) | TanStack Prompt §16, 21 |
| 20 | Frontend Test Suite Infrastructure | Vitest + React Testing Library configured in apps/web, root test script integration | M5 (DONE) | Acceptance Criteria |
| 21 | QueryClient SSR & Hydration Tests | Automated tests verifying per-request server isolation and client singleton caching | M5 (DONE) | Acceptance Criteria |
| 22 | DataTable & Virtualization Tests | Unit & component tests verifying multi-column sort, facet filter, selection, and virtual row rendering | M5 (DONE) | Acceptance Criteria |
| 23 | TanStack Form & Zod Tests | Tests verifying Zod schema validation errors, dirty state, and submission workflows | M5 (DONE) | Acceptance Criteria |
| 24 | Monorepo Build, Lint, and Integrity Audit | pnpm run build, pnpm run lint clean, and Forensic Auditor verification (zero cheating/facades) | M5 (DONE) | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Repository Agent Skills & AGENTS.md | Author 8 playbooks in /.agents/skills/ and root AGENTS.md | none | DONE |
| 2 | Curated Library Standardization & Alignment | Package.json dependencies, Orval config, zero-duplication verification | M1 | DONE |
| 3 | Enterprise TanStack Suite Architecture | SSR-safe QueryClient, DataTable, Virtualization, Form+Zod, Pacer | M2 | DONE |
| 4 | Reference Pages & Interactive Grids | Findings inspector, SAP Object Inventory, URL sync, exports | M3 | DONE |
| 5 | Automated Testing, Verification & Integrity Audit | Vitest suite in apps/web, build, lint, and Forensic Audit | M4 | DONE |

## Interface Contracts
### QueryClient Factory ↔ Next.js App Router
- `getQueryClient()` returns a new instance on the server per request, and a browser singleton on the client.
- `QueryProvider` wraps `apps/web/src/app/layout.tsx`.
- Tenant switch triggers `queryClient.clear()` and request abort.

### DataTable ↔ @tanstack/react-table & @tanstack/react-virtual
- `DataTableProps<TData>` accepts `columns: ColumnDef<TData>[]`, `data: TData[]`, `rowCount?: number`, `enableVirtualization?: boolean`.
- State synchronization: table sorting, filtering, pagination exported to URL query parameters via Next.js router.
- Virtualizer: uses `useVirtualizer` with `getScrollElement: () => parentRef.current`, fixed row estimation or `measureElement`.

### TanStack Form ↔ Zod Schemas
- Uses TanStack Form `useForm` with Zod validation and schemas from `packages/schemas`.
- Form fields provide accessible label, description, error message via ARIA attributes.

## Code Layout
- Playbooks: `H:/erppreflight/.agents/skills/*.md`
- Governance: `H:/erppreflight/AGENTS.md`
- Next.js Web: `H:/erppreflight/apps/web/`
  - Primitives: `apps/web/src/components/ui/`
  - Tables: `apps/web/src/components/data-table/`
  - Forms: `apps/web/src/components/form/`
  - Query: `apps/web/src/lib/query/`
  - Hooks: `apps/web/src/hooks/`
  - Pages: `apps/web/src/app/`
  - Tests: `apps/web/src/__tests__/`
