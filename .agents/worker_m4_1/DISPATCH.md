## 2026-09-24T06:52:31Z

You are worker_m4_1, a teamwork_preview_worker.
Your working directory is H:/erppreflight/.agents/worker_m4_1.
You MUST follow the File Workspace Convention: write metadata only in your working directory. For target files, see Exclusive Write Ownership below.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You own exclusively:
1. packages/schemas/src/sap-object.ts
2. packages/schemas/src/index.ts
3. apps/web/src/components/findings/ (create components: severity-badge.tsx, confidence-badge.tsx, clean-core-badge.tsx, finding-columns.tsx, finding-detail-row.tsx, types.ts)
4. apps/web/src/components/objects/ (create components: object-type-badge.tsx, object-tier-badge.tsx, object-columns.tsx, object-detail-drawer.tsx, types.ts)
5. apps/web/src/app/projects/[id]/findings/page.tsx
6. apps/web/src/app/projects/[id]/objects/page.tsx
7. apps/web/src/app/projects/[id]/page.tsx
8. apps/web/src/app/inspector/page.tsx

INPUT BLUEPRINTS:
Read and strictly adhere to the exact blueprints in:
- H:/erppreflight/.agents/explorer_m4_findings_1/handoff.md
- H:/erppreflight/.agents/explorer_m4_objects_1/handoff.md
- H:/erppreflight/.agents/skills/frontend-design-system.md (Cardinal Axiom 1: Non-color severity triad: icon + text + ARIA)
- H:/erppreflight/.agents/skills/data-table-and-large-list.md (Virtualization & URL state sync)

TASKS:
1. Domain Schemas (packages/schemas):
   - Create `packages/schemas/src/sap-object.ts` defining `SapObjectTypeEnum`, `ModificationStatusEnum`, `ComplexityLevelEnum`, `ComplexityMetricsSchema`, `ObjectDependencySchema`, `SapObjectSchema`, `SapObjectListResponseSchema`, and export all types.
   - Re-export `sap-object.ts` in `packages/schemas/src/index.ts`. Build schemas package (`pnpm --filter @erppreflight/schemas build`).
2. Findings Reference Page (`apps/web/src/app/projects/[id]/findings/page.tsx`):
   - Implement `SeverityBadge` with WCAG 2.2 AA non-color triad (icon + textual badge + aria-label), `ConfidenceBadge`, `CleanCoreBadge`.
   - Implement `FindingColumns` with 8 columns, custom multi-select intersection filter, and expandable detail row `FindingDetailRow` (showing cryptographic evidence, line/col, SHA-256 hash, and remediation steps).
   - Implement page using `DataTable`, `useTableUrlSync`, faceted filters (Severity, Confidence, Tier, Engine), and CSV/JSON export actions.
3. SAP Object Inventory Reference Page (`apps/web/src/app/projects/[id]/objects/page.tsx`):
   - Implement `ObjectTypeBadge`, `ObjectTierBadge`, `ObjectColumns` (Type, Package, Clean Core Tier, Complexity, Findings Count, etc.).
   - Implement `ObjectDetailDrawer` slide-over inspector.
   - Implement page with `DataTable` with `enableVirtualization={true}` capable of handling 10,000+ objects, `useTableUrlSync`, and CSV/JSON export.
4. Project Workspace Integration (`apps/web/src/app/projects/[id]/page.tsx`):
   - Add "Findings" and "Objects" tabs with direct links and navigation cards to `/projects/[id]/findings` and `/projects/[id]/objects`.
5. Universal Inspector Upgrade (`apps/web/src/app/inspector/page.tsx`):
   - Upgrade inspector to use `DataTable` with `SeverityBadge`, faceted filtering, and URL state sync.

VERIFICATION:
Run all verification quality gates:
- node scripts/check-no-dependency-soup.mjs
- npx pnpm --filter @erppreflight/schemas build
- npx pnpm --filter @erppreflight/web typecheck
- npx pnpm run build
- npx pnpm test

Write your report to H:/erppreflight/.agents/worker_m4_1/handoff.md. Send message to parent when done.
