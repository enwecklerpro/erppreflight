## 2026-09-24T02:50:39Z
You are spec_miner_survey_1, a teamwork_preview_spec_miner.
Your working directory is H:/erppreflight/.agents/spec_miner_survey_1.
You MUST follow the File Workspace Convention: write ONLY within your working directory.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md (specifically the latest request under ## 2026-09-24T02:48:48Z).

AUTHORITATIVE SOURCES TO INVESTIGATE:
1. H:/erppreflight/21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md
2. H:/erppreflight/22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md
3. H:/erppreflight/ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md

MISSION:
Extract and catalog all architectural requirements, specifications, invariants, and feature checklists:
1. All 8 canonical playbooks to be created in /.agents/skills/:
   - Exact filenames, titles, key concepts, detailed sections, required invariants, and anti-patterns for:
     * frontend-design-system.md
     * data-table-and-large-list.md
     * dependency-graph.md
     * engine-authoring.md
     * sap-evidence.md
     * release-aware-knowledge.md
     * secure-file-parser.md
     * multi-tenant-security.md
2. Root AGENTS.md requirements:
   - Agent roles, playbook mapping, trigger conditions, architectural guardrails and invariants.
3. Part 21 Curated Library Stack requirements:
   - Base UI + shadcn/ui component layer, Tailwind CSS, Lucide icons, Motion (motion/react).
   - Zod 4 runtime schema validation rules across boundaries.
   - Orval OpenAPI typed client/hook generation rules.
   - @xyflow/react rules.
   - Strict zero-duplication policies (no React Hook Form, no Redux, etc.).
4. Enterprise TanStack Suite Architecture:
   - TanStack Query: SSR-safe QueryClient factory in Next.js App Router (preventing singleton leak across SSR requests), hydration patterns, cache invalidation, optimistic update patterns.
   - TanStack Table & Virtual: Enterprise DataTable (sorting, facet filtering, column visibility, pagination, row selection, export to CSV/JSON), @tanstack/react-virtual integration for 10,000+ rows.
   - TanStack Form: Type-safe form abstraction with Zod integration and accessible UI inputs.
   - TanStack Pacer: Debounced search, throttled filters, batch handling.
5. Reference Pages and Acceptance Criteria:
   - Findings page, SAP Object Inventory page, interactive virtualized grids.
   - Test criteria and verification standards.

OUTPUT:
Write your structured findings to H:/erppreflight/.agents/spec_miner_survey_1/handoff.md.
Include progress.md updates with timestamps as you work.
When complete, send a message to parent summarizing key discoveries and referencing the handoff file.
