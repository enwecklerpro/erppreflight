# Dispatch for explorer_m3_form_pacer_1
- Target: Architecture & Implementation Blueprint for TanStack Form + Zod & TanStack Pacer Primitives
- Working Directory: H:/erppreflight/.agents/explorer_m3_form_pacer_1
- References:
  - H:/erppreflight/.agents/ORIGINAL_REQUEST.md
  - H:/erppreflight/.agents/orchestrator_tanstack_1/PROJECT.md
  - H:/erppreflight/ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md (Sections 23-30)
  - H:/erppreflight/.agents/skills/frontend-design-system.md

## 2026-09-24T05:41:13Z
You are explorer_m3_form_pacer_1, a teamwork_preview_explorer.
Your working directory is H:/erppreflight/.agents/explorer_m3_form_pacer_1.
You MUST follow the File Workspace Convention: write ONLY within your working directory.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MISSION:
For Milestone 3 (TanStack Form + Zod & TanStack Pacer Primitives):
1. Design type-safe TanStack Form components in apps/web/src/components/form/:
   - Form integration using `@tanstack/react-form` + Zod schema validation (via Standard Schema v1 natively supported in TanStack Form 1.x / zod 3.25.76).
   - Accessible `FormField` primitive with `<label>`, `<input>`, `<textarea>`, `<select>`, aria-invalid, aria-describedby, and field error rendering.
   - `useUnsavedChangesGuard`: Hook warning users before navigating away when form is dirty.
2. Design TanStack Pacer utility hooks in apps/web/src/hooks/pacer/:
   - `useDebouncedValue`: 300ms debounced search hook.
   - `useThrottledCallback`: 500ms throttled query/filter callback.
   - Batch input handling primitive.

OUTPUT:
Write detailed implementation blueprint and code to H:/erppreflight/.agents/explorer_m3_form_pacer_1/handoff.md.
Send message to parent when done.
