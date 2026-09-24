# BRIEFING — 2026-09-24T03:38:40Z

## Mission
Investigate apps/web/package.json, root package.json, and lockfile to determine exact package versions, peer dependencies, and compatibility with Next.js 15.1.7 and React 19 for TanStack Suite & curated libraries (Base UI, xyflow, motion, orval, etc.) for Milestone 2.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigator, dependency analyst
- Working directory: H:/erppreflight/.agents/explorer_m2_deps_1
- Original parent: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Milestone: Milestone 2 (Curated Library Standardization & Alignment)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Write ONLY within H:/erppreflight/.agents/explorer_m2_deps_1
- Follow File Workspace Convention & AGENTS.md rules
- Strict No-Dependency-Soup Policy adherence (Base UI, TanStack Query, TanStack Form, xyflow, motion, etc.)

## Current Parent
- Conversation ID: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Updated: not yet

## Investigation State
- **Explored paths**: `apps/web/package.json`, `package.json`, `pnpm-lock.yaml`, `21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md`, `ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md`, `orchestrator_tanstack_1/PROJECT.md`, npm registry for all 9 packages.
- **Key findings**:
  1. All 9 curated packages have validated releases compatible with React 19.3.0 and Next.js 15.1.7.
  2. TanStack Table must be pinned to v8 (`^8.21.3`) per specification, not v9.
  3. TanStack Form 1.x (`1.33.5`) natively implements Standard Schema v1 (`~standard`), which Zod 3.25.76 natively supports; legacy `@tanstack/zod-form-adapter` (frozen at 0.42.1) should NOT be installed.
  4. TanStack Pacer exists as `@tanstack/react-pacer@0.23.0` and can be complemented by a local React 19 hook (`use-pacer.ts`).
  5. Base UI is at `1.0.0-rc.0` with explicit React 19 peer support.
  6. `@xyflow/react` is at `12.11.6` with React 19 peer support.
  7. Motion is at `^12.43.0` (with `motion/react` export) with React 19 peer support.
  8. Orval is at `^8.37.0` (devDependency).
- **Unexplored areas**: None for dependency mapping; all versions and peer dependencies verified.

## Key Decisions Made
- Confirmed zero conflicting packages currently in `apps/web/package.json`.
- Formulated exact pnpm add commands and direct package.json modification snippet.

## Artifact Index
- DISPATCH.md — Task dispatch log
- BRIEFING.md — Situational awareness and working memory
- progress.md — Liveness heartbeat
- handoff.md — Final investigation report
