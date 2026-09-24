# Original User Request

## 2026-09-24T01:10:30Z

Use a large team of agents for full-scale parallel build of all 18 engines and platform services.

Build ERP Preflight, a production-grade, enterprise-ready multi-tenant SaaS platform for SAP preflight analysis, clean core auditing, migration verification, and release intelligence, deployed end-to-end for Hostinger via Coolify.

Working directory: H:/erppreflight
Integrity mode: development

Reference specification: H:/erppreflight/ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md

## Requirements

### R1. Production Monorepo & Platform Foundation
Initialize and structure the repository as an enterprise-grade monorepo containing:
- Web Application: Next.js frontend with responsive UI, dashboard, project workspaces, analysis inspector, and role-based access.
- API Backend: NestJS core service handling multi-tenant auth, workspace/project management, file upload coordination, job queuing (BullMQ/Redis), and reporting APIs.
- Analysis Engine: Python FastAPI microservice providing deterministic parsing, rule-based evaluations, and statistical analysis.
- Shared Persistence: PostgreSQL database schema with migration scripts, pgvector indexing, and Redis for caching and coordination.
- Documentation & ADRs: IMPLEMENTATION_STATUS.md, ARCHITECTURE_DECISIONS.md, and deployment runbooks.

### R2. Complete Implementation of the 18 SAP Preflight Engines
Simultaneously build out deterministic parsers, domain rule engines, and analysis pipelines across all defined operational domains:
1. Output & Extensibility: OPD Guard, FormDoctor, Custom Field Flow Doctor, Extension Impact Guard.
2. Migration & Clean Core: SPRO2Cloud, ECC2Cloud Navigator, SAP Gap Radar, Clean Core Object Guard.
3. Integration: Change Pointer Coverage Auditor, API Change Guard.
4. Release & Transport: Software Collection Dependency Guard, Transport Dependency Analyzer.
5. Operations: Safe Decommission Preflight, Fiori 403 Root-Cause Doctor, Workflow Stuck Explainer, IAM Cost Optimizer, Account Determination Preflight, System Refresh Delta Guard.
6. Warehouse Automation: MFS BlackBox.
7. Shared Platform Services: Evidence Engine, Confidence Classifier (VERIFIED, RULE_DERIVED, INFERRED, UNKNOWN), AI Problem Router with pluggable LLM gateway, and Audit Trail.

### R3. Secure Ingestion Pipeline & Multi-Tenant Isolation
- Ingestion pipeline with file format validation (XML, JSON, CSV, ZIP, ABAP/text), quarantine scanning, and secret/credential redaction.
- Signed, short-lived URLs for file storage and generated preflight audit reports (PDF/JSON/CSV).
- Multi-tenant data segregation enforcing tenant boundaries on every database query and storage artifact.

### R4. Hostinger & Coolify End-to-End Deployment Configuration
- Provide production-ready docker-compose.coolify.yml orchestrating web, api, analysis-python, postgresql, and redis containers.
- Pinned container Dockerfiles with multi-stage builds, non-root execution, and minimal image footprint.
- Comprehensive .env.example documenting all configuration keys (database, redis, storage, auth secrets, Coolify domains).
- Standardized health check endpoints (/health/liveness, /health/readiness) for every service container.
- Automated database migration runner executed during container startup before traffic ingress.

## Acceptance Criteria

### Automated Build & Code Quality
- [ ] Monorepo build passes cleanly via pnpm run build with zero TypeScript errors.
- [ ] Code formatting and linting pass via pnpm run lint across all packages.
- [ ] Python analysis service passes pytest test suite with 100% test success rate.
- [ ] Backend NestJS unit and integration tests pass via pnpm test.

### Functional Engine & End-to-End Pipeline
- [ ] Deterministic parsing and analysis verified with fixture test data for all 18 engines.
- [ ] Ingestion pipeline successfully validates test uploads, quarantines invalid formats, redacts secrets, and enqueues jobs into Redis.
- [ ] Asynchronous worker processes analysis jobs, writes structured findings into PostgreSQL, and assigns valid provenance classes (VERIFIED, RULE_DERIVED, INFERRED).
- [ ] Export engine successfully generates downloadable preflight assessment reports.

### Coolify & Hostinger Readiness
- [ ] docker-compose.coolify.yml launches all services (docker compose -f docker-compose.coolify.yml up -d) with zero crash loops.
- [ ] Healthcheck endpoints for web, api, and analysis-python return HTTP 200 OK within 60 seconds of container boot.
- [ ] Database migrations execute automatically and idempotently on boot without manual intervention.

## 2026-09-24T02:48:48Z

Focused multi-agent team for TanStack architecture, library standardization, and agent skills playbooks.

Implement the curated library stack (Part 21), repository-local agent skills and playbooks (Part 22), and full TanStack suite architecture in ERP Preflight inside `H:/erppreflight`.

Working directory: H:/erppreflight
Integrity mode: development

References:
- H:/erppreflight/21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md
- H:/erppreflight/22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md
- H:/erppreflight/ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md

## Requirements

### R1. Repository Agent Skills & Architecture Playbooks (Part 22)
- Author all 8 canonical markdown playbook files in `/.agents/skills/`:
  1. `frontend-design-system.md`: shadcn/Base UI rules, design tokens, light/dark accessibility, typography, responsive behavior.
  2. `data-table-and-large-list.md`: TanStack Table & Virtualization rules, URL-backed filters, keyboard accessibility.
  3. `dependency-graph.md`: React Flow (`@xyflow/react`) rules, ELK layout, graph IDs, accessible table fallback.
  4. `engine-authoring.md`: Standard engine structure (metadata, input schema, parser, deterministic rules, finding codes, evidence, test fixtures).
  5. `sap-evidence.md`: Release-specific SAP facts, provenance tracking, clean core distinction, UNKNOWN confidence rules.
  6. `release-aware-knowledge.md`: Knowledge versioning, product edition tagging, checksum tracking.
  7. `secure-file-parser.md`: Magic bytes verification, size/archive limits, XXE/path-traversal protection, secret scrubbing.
  8. `multi-tenant-security.md`: Tenant isolation rules, RLS enforcement, presigned URLs.
- Create root `AGENTS.md` specifying triggers, mapping agent roles to playbooks, and establishing non-negotiable architectural invariants.

### R2. Curated Library Standardization & Clean Monorepo Alignment (Part 21)
- Standardize dependencies across `apps/web` and packages:
  - Base UI + shadcn/ui component layer with Tailwind CSS, Lucide icons, and disciplined Motion (`motion/react`) respecting `prefers-reduced-motion`.
  - Zod 4 runtime schema validation across boundaries.
  - Orval configuration for OpenAPI client and typed hook generation.
  - `@xyflow/react` integration for dependency graph visualization.
- Ensure strict zero-duplication policy (no React Hook Form, no Redux, no mixing incompatible primitive frameworks).

### R3. Enterprise TanStack Suite Architecture & Reusable Primitives
- **TanStack Query**:
  - Centralized SSR-safe QueryClient factory in `apps/web` preventing client singleton leaks during Next.js App Router SSR.
  - Type-safe query and mutation hook patterns with automated cache invalidation and optimistic updates.
- **TanStack Table & Virtual**:
  - Enterprise data table component (`DataTable`) supporting multi-column sorting, facet filtering, column visibility toggles, pagination, and bulk selection.
  - Seamless virtualization integration with `@tanstack/react-virtual` for handling tens of thousands of rows without DOM bloat.
  - Dedicated reference tables for Findings and SAP Object Inventory with CSV/JSON export actions.
- **TanStack Form**:
  - Type-safe form abstraction integrated with Zod validation schemas and accessible input components.
- **TanStack Pacer**:
  - Utility hooks for debounced global search, throttled filter queries, and batch input handling.

## Acceptance Criteria

### Playbooks & Governance Verification
- [ ] All 8 canonical playbooks exist in `/.agents/skills/` and strictly follow the specification in Part 22.
- [ ] Root `AGENTS.md` is present and valid, mapping each playbook to its trigger context and invariants.

### Build & Type Safety
- [ ] `apps/web` and monorepo packages build cleanly (`pnpm run build`) with zero TypeScript errors.
- [ ] Monorepo passes lint check (`pnpm run lint`) without dependency or schema violations.

### TanStack Suite Functionality & Tests
- [ ] Automated tests verify SSR-safety and query hydration of the QueryClient factory.
- [ ] Unit and component tests verify TanStack Table sorting, filtering, selection, and virtualized row rendering.
- [ ] TanStack Form validation tests confirm correct Zod schema validation errors and submission workflows.
- [ ] Reference pages for Findings and SAP Object Inventory render cleanly and interact with virtualized data grids.
