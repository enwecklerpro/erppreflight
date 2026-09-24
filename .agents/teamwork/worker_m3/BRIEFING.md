# BRIEFING — 2026-09-24T21:26:00Z

## Mission
Implement Milestone M3: Dynamic Engine Matrix Failure Representation (R6) & Anti-Facade verification in ERP Preflight web application.

## 🔒 My Identity
- Archetype: teamwork_preview_worker
- Roles: implementer, qa, specialist
- Working directory: H:/erppreflight/.agents/teamwork/worker_m3
- Original parent: 732d36b7-a399-4387-8843-8a3934bdf045
- Milestone: M3 (Requirement R6)

## 🔒 Key Constraints
- EXCLUSIVE WRITE OWNERSHIP:
  - apps/web/src/lib/api-client.ts (specifically EngineStatusItem, CANONICAL_ENGINES, and ALL_18_ENGINES)
  - apps/web/src/components/engine-matrix.tsx
  - scripts/check-no-production-facades.mjs
  - .agents/teamwork/worker_m3/*
- Adhere to AGENTS.md (Cardinal Axiom 1: A page that renders is not a completed feature; WCAG 2.2 AA non-color severity representation; real server state, error boundaries, loading skeletons, retry triggers).
- Adhere to frontend-design-system.md.
- Integrity mandate: Zero fake implementations, zero hardcoded OPERATIONAL status fallback when disconnected.

## Current Parent
- Conversation ID: 732d36b7-a399-4387-8843-8a3934bdf045
- Updated: 2026-09-24T21:26:00Z

## Task Summary
- **What to build**:
  1. `apps/web/src/lib/api-client.ts`: Update `EngineStatusItem.status` union to include `'UNKNOWN'`. Define `CANONICAL_ENGINES: Omit<EngineStatusItem, 'status'>[]` without hardcoded status. Define `ALL_18_ENGINES: EngineStatusItem[] = CANONICAL_ENGINES.map((e) => ({ ...e, status: 'UNKNOWN' }))`.
  2. `apps/web/src/components/engine-matrix.tsx`: Destructure `isError`, `error`, `isLoading`, `isFetching`, `refetch` from `useQuery`. Render prominent accessible Alert Banner with WifiOff icon and interactive "Retry Connection" button (`refetch()`). Implement WCAG 2.2 AA compliant triad severity representation for each engine card (token color + distinct Lucide icon + text + aria-label). Render loading skeleton during initial load.
  3. `scripts/check-no-production-facades.mjs`: Add checks asserting no static fallback `engineData?.engines || ALL_18_ENGINES` where `ALL_18_ENGINES` hardcodes `OPERATIONAL`, and asserting `engine-matrix.tsx` handles `isError` or `UNKNOWN`/`OFFLINE` status.
- **Success criteria**:
  - `node scripts/check-no-production-facades.mjs` passes with zero violations.
  - `tsc` passes for all modified files with zero errors.
- **Interface contracts**: H:/erppreflight/AGENTS.md
- **Code layout**: apps/web/src/lib/api-client.ts, apps/web/src/components/engine-matrix.tsx, scripts/check-no-production-facades.mjs

## Key Decisions Made
- `CANONICAL_ENGINES` exports clean engine metadata without any baked-in operational status.
- `ALL_18_ENGINES` maps all engines with default `status: 'UNKNOWN'`, preventing static operational facades.
- In `engine-matrix.tsx`, fallback status dynamically switches to `'OFFLINE'` when `isError` is true and `'UNKNOWN'` during initialization/disconnection.
- Triad status badges paired with distinct Lucide icons (`CheckCircle2`, `AlertTriangle`, `Clock`, `WifiOff`, `HelpCircle`), explicit labels, and `aria-label` attributes for WCAG 2.2 AA non-color compliance.
- Prominent `role="alert"` banner with `WifiOff` and interactive `Retry Connection` button allows manual recovery when analysis microservices are down.
- Added animated loading skeletons matching the exact card grid layout to prevent layout shifts.

## Artifact Index
- apps/web/src/lib/api-client.ts — Engine status types and canonical engine metadata
- apps/web/src/components/engine-matrix.tsx — UI component for preflight engine matrix
- scripts/check-no-production-facades.mjs — Anti-facade static analysis script

## Change Tracker
- **Files modified**:
  - `apps/web/src/lib/api-client.ts`: Added `'UNKNOWN'` status, `CANONICAL_ENGINES`, and updated `ALL_18_ENGINES`.
  - `apps/web/src/components/engine-matrix.tsx`: Added `isError`, `refetch`, alert banner, triad status icons, loading skeleton, empty state.
  - `scripts/check-no-production-facades.mjs`: Added 5 anti-facade checks for engine matrix failure handling and no hardcoded OPERATIONAL fallback.
- **Build status**: `check:no-production-facades` PASS; web typecheck on modified files PASS.
- **Pending issues**: none

## Quality Status
- **Build/test result**: PASS (zero violations in `scripts/check-no-production-facades.mjs`)
- **Lint status**: clean
- **Tests added/modified**: anti-facade script checks in `scripts/check-no-production-facades.mjs`

## Loaded Skills
- **Source**: H:/erppreflight/.agents/skills/frontend-design-system.md
- **Local copy**: H:/erppreflight/.agents/skills/frontend-design-system.md
- **Core methodology**: WCAG 2.2 AA non-color severity representation (triad: color + icon + text + ARIA), loading skeletons, error resilience, retry controls, Base UI / Tailwind tokens.
