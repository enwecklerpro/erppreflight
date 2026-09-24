# Dispatch for explorer_m2_deps_1
- Target: TanStack Suite & Curated Library Dependency Mapping & Compatibility
- Working Directory: H:/erppreflight/.agents/explorer_m2_deps_1
- References:
  - H:/erppreflight/.agents/ORIGINAL_REQUEST.md
  - H:/erppreflight/.agents/orchestrator_tanstack_1/PROJECT.md
  - apps/web/package.json
  - pnpm-lock.yaml

## 2026-09-24T03:33:00Z
Received user request:
For Milestone 2 (Curated Library Standardization & Alignment):
1. Investigate apps/web/package.json and root package.json.
2. Determine the exact package versions and peer dependency requirements for:
   - @tanstack/react-query (v5)
   - @tanstack/react-table (v8)
   - @tanstack/react-virtual (v3)
   - @tanstack/react-form (and @tanstack/zod-form-adapter)
   - TanStack Pacer primitives or @tanstack/react-pacer / local hook implementation
   - @base-ui-components/react
   - @xyflow/react
   - motion (motion/react)
   - orval
3. Check compatibility with Next.js 15.1.7 and React 19.0.0.
4. Formulate the exact pnpm install / package.json modification commands for apps/web.
OUTPUT: Write findings to H:/erppreflight/.agents/explorer_m2_deps_1/handoff.md. Send message to parent when done.
