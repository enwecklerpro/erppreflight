# BRIEFING — 2026-09-24T05:46:45Z

## Mission
Design type-safe TanStack Form components and TanStack Pacer utility hooks for Milestone 3.

## 🔒 My Identity
- Archetype: teamwork_preview_explorer
- Roles: Explorer, Investigation, Synthesis
- Working directory: H:/erppreflight/.agents/explorer_m3_form_pacer_1
- Original parent: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Milestone: Milestone 3 (TanStack Form + Zod & TanStack Pacer Primitives)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement directly in apps/web or packages/ (write reports/handoffs ONLY in working directory)
- Strict adherence to monorepo rules and Cardinal Axiom 1 (accessible forms, dirty state, WCAG 2.2 AA)
- No React Hook Form, Redux, or forbidden libraries (No-Dependency-Soup standard)
- Standard Schema v1 compliance with TanStack Form v1 & Zod 3.25.76
- Output detailed implementation blueprint and code to handoff.md

## Current Parent
- Conversation ID: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Updated: 2026-09-24T05:41:40Z

## Investigation State
- **Explored paths**:
  - H:/erppreflight/.agents/ORIGINAL_REQUEST.md
  - H:/erppreflight/.agents/orchestrator_tanstack_1/PROJECT.md
  - H:/erppreflight/ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md (Sections 23-35)
  - H:/erppreflight/.agents/skills/frontend-design-system.md (Sections 1-7)
  - H:/erppreflight/apps/web/package.json
  - Node modules for @tanstack/react-form (v1.33.5) and @tanstack/react-pacer (v0.23.0)
  - H:/erppreflight/packages/schemas (common.ts, finding.ts, project.ts)
- **Key findings**:
  1. Standard Schema v1 is natively supported in `@tanstack/react-form` 1.33.5 via `isStandardSchemaValidator` and Zod 3.24.2+ via `~standard` property on every Zod schema. No `@tanstack/zod-form-adapter` is required or needed!
  2. In `@tanstack/react-pacer` 0.23.0, `useDebouncedValue`, `useThrottledCallback`, `useBatcher`, and `useBatchedCallback` are fully implemented and function without requiring a `PacerProvider` wrapper for baseline options.
  3. `useDebouncedValue` returns `[debouncedValue, debouncer]` where `debouncer.state.isPending` can be used for loading spinners. Default delay for search is 300ms.
  4. `useThrottledCallback` provides a stable function reference for rate-limiting expensive client interactions like graph layout or query execution. Default wait is 500ms.
  5. `useBatcher` provides item queuing with `maxSize`, `wait`, and `onUnmount` handling.
  6. Accessibility requires dual render-prop and context support on `FormField`, associating `id`, `htmlFor`, `aria-invalid`, `aria-describedby` (`${id}-description ${id}-error`), and `role="alert"` with an `AlertCircle` icon (never relying on color alone).
  7. `useUnsavedChangesGuard` must guard both native browser reload/exit (`beforeunload`) and Next.js 15 client-side link transitions and history navigations (`click` capture and `popstate`).
- **Unexplored areas**: None. All core mechanisms verified with live Node.js code execution.

## Key Decisions Made
- Standardize `FormField` to support both render-prop pattern and context injection for nested input primitives (`FormInput`, `FormTextarea`, `FormSelect`, `FormCheckbox`).
- Design `FormSummaryErrors` for complex multi-section/wizard forms to satisfy Section 25 accessibility rules.
- Design `parseBatchDelimitedInput` helper for enterprise SAP bulk entry (comma, semicolon, tab, newline separation).
- Provide production-ready reference form `SapConnectorConfigForm` proving full end-to-end integration.

## Artifact Index
- H:/erppreflight/.agents/explorer_m3_form_pacer_1/DISPATCH.md — Incoming dispatches log
- H:/erppreflight/.agents/explorer_m3_form_pacer_1/BRIEFING.md — Persistent situational awareness memory
- H:/erppreflight/.agents/explorer_m3_form_pacer_1/progress.md — Liveness heartbeat and progress tracking
- H:/erppreflight/.agents/explorer_m3_form_pacer_1/handoff.md — Final 5-component handoff report
