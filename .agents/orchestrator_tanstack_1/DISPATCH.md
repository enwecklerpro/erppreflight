## 2026-09-24T02:49:53Z

You are the Project Orchestrator for ERP Preflight.

Working Directory: H:/erppreflight/.agents/orchestrator_tanstack_1
Workspace Directory: H:/erppreflight
Original Request: Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md (specifically the latest request under ## 2026-09-24T02:48:48Z).

Key References:
- H:/erppreflight/21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md
- H:/erppreflight/22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md
- H:/erppreflight/ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md

Mission:
Implement the curated library stack (Part 21), repository-local agent skills and playbooks (Part 22), and full TanStack suite architecture in ERP Preflight inside H:/erppreflight.

Requirements:
1. Repository Agent Skills & Architecture Playbooks (Part 22):
   - Author all 8 canonical markdown playbook files in /.agents/skills/:
     1. frontend-design-system.md: shadcn/Base UI rules, design tokens, light/dark accessibility, typography, responsive behavior.
     2. data-table-and-large-list.md: TanStack Table & Virtualization rules, URL-backed filters, keyboard accessibility.
     3. dependency-graph.md: React Flow (@xyflow/react) rules, ELK layout, graph IDs, accessible table fallback.
     4. engine-authoring.md: Standard engine structure (metadata, input schema, parser, deterministic rules, finding codes, evidence, test fixtures).
     5. sap-evidence.md: Release-specific SAP facts, provenance tracking, clean core distinction, UNKNOWN confidence rules.
     6. release-aware-knowledge.md: Knowledge versioning, product edition tagging, checksum tracking.
     7. secure-file-parser.md: Magic bytes verification, size/archive limits, XXE/path-traversal protection, secret scrubbing.
     8. multi-tenant-security.md: Tenant isolation rules, RLS enforcement, presigned URLs.
   - Create root AGENTS.md specifying triggers, mapping agent roles to playbooks, and establishing non-negotiable architectural invariants.

2. Curated Library Standardization & Clean Monorepo Alignment (Part 21):
   - Standardize dependencies across apps/web and packages:
     - Base UI + shadcn/ui component layer with Tailwind CSS, Lucide icons, and disciplined Motion (motion/react) respecting prefers-reduced-motion.
     - Zod 4 runtime schema validation across boundaries.
     - Orval configuration for OpenAPI client and typed hook generation.
     - @xyflow/react integration for dependency graph visualization.
   - Ensure strict zero-duplication policy (no React Hook Form, no Redux, no mixing incompatible primitive frameworks).

3. Enterprise TanStack Suite Architecture & Reusable Primitives:
   - TanStack Query:
     - Centralized SSR-safe QueryClient factory in apps/web preventing client singleton leaks during Next.js App Router SSR.
     - Type-safe query and mutation hook patterns with automated cache invalidation and optimistic updates.
   - TanStack Table & Virtual:
     - Enterprise data table component (DataTable) supporting multi-column sorting, facet filtering, column visibility toggles, pagination, and bulk selection.
     - Seamless virtualization integration with @tanstack/react-virtual for handling tens of thousands of rows without DOM bloat.
     - Dedicated reference tables for Findings and SAP Object Inventory with CSV/JSON export actions.
   - TanStack Form:
     - Type-safe form abstraction integrated with Zod validation schemas and accessible input components.
   - TanStack Pacer:
     - Utility hooks for debounced global search, throttled filter queries, and batch input handling.

Acceptance Criteria:
- All 8 canonical playbooks exist in /.agents/skills/ and strictly follow Part 22.
- Root AGENTS.md is present and valid.
- Monorepo packages and apps/web build cleanly (pnpm run build) with zero TypeScript errors.
- Monorepo passes lint check (pnpm run lint) without dependency or schema violations.
- Automated tests verify SSR-safety and query hydration of the QueryClient factory.
- Unit and component tests verify TanStack Table sorting, filtering, selection, and virtualized row rendering.
- TanStack Form validation tests confirm correct Zod schema validation errors and submission workflows.
- Reference pages for Findings and SAP Object Inventory render cleanly and interact with virtualized data grids.

## 2026-09-24T10:22:29Z

Server restarted and quota has reset. All tests and code are verified clean. Please resume execution from your current state (Milestone 4 Iteration 2 Gating). Note that challenger_m4_rem_1 has delivered its APPROVE handoff report (.agents/challenger_m4_rem_1/handoff.md). Check on or re-dispatch reviewer_m4_rem_1 and auditor_m4_rem_1 if needed, complete Milestone 4 gate, and proceed to Milestone 5.

