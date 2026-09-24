## 2026-09-24T21:22:18Z
You are Worker M3 (teamwork_preview_worker).
Your working directory is H:/erppreflight/.agents/teamwork/worker_m3.
You MUST read the original user request at H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md before starting.
Also review the comprehensive blueprint prepared by Explorer 3 at:
H:/erppreflight/.agents/teamwork/explorer_survey_3/handoff.md
And adhere to H:/erppreflight/AGENTS.md and /.agents/skills/frontend-design-system.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP (You may ONLY edit or create these files):
- apps/web/src/lib/api-client.ts (specifically EngineStatusItem, CANONICAL_ENGINES, and ALL_18_ENGINES)
- apps/web/src/components/engine-matrix.tsx
- scripts/check-no-production-facades.mjs

TASKS FOR MILESTONE M3:
1. R6: Dynamic Engine Matrix Failure Representation:
   - In `apps/web/src/lib/api-client.ts`:
     - Update `EngineStatusItem` status type to `'OPERATIONAL' | 'DEGRADED' | 'STANDBY' | 'OFFLINE' | 'UNKNOWN'`.
     - Define `CANONICAL_ENGINES: Omit<EngineStatusItem, 'status'>[]` containing metadata for all 18 engines without hardcoded status.
     - Define `ALL_18_ENGINES: EngineStatusItem[] = CANONICAL_ENGINES.map((e) => ({ ...e, status: 'UNKNOWN' }))` so fallback status is ALWAYS `'UNKNOWN'`, NEVER static `'OPERATIONAL'`.
   - In `apps/web/src/components/engine-matrix.tsx`:
     - Destructure `isError`, `error`, `isLoading`, `isFetching`, `refetch` from `useQuery`.
     - When `isError` or data is unavailable:
       - Render a prominent, accessible Alert Banner (e.g. `<WifiOff />`, "Analysis Services Offline / Unavailable", description) with an interactive "Retry Connection" button (`refetch()`).
     - Render WCAG 2.2 AA compliant triad severity representation for each engine card:
       - Do NOT rely on color alone! Pair semantic token colors with distinct Lucide icons and text:
         - `OPERATIONAL`: `<CheckCircle2 />`, green tokens, `aria-label="Engine status: Operational"`
         - `DEGRADED`: `<AlertTriangle />`, amber tokens, `aria-label="Engine status: Degraded"`
         - `STANDBY`: `<Clock />`, blue tokens, `aria-label="Engine status: Standby"`
         - `OFFLINE`: `<WifiOff />`, red tokens, `aria-label="Engine status: Offline"`
         - `UNKNOWN`: `<HelpCircle />`, muted gray tokens, `aria-label="Engine status: Unknown"`
     - Render loading skeleton state during initial load.
2. Anti-Facade Script Update in `scripts/check-no-production-facades.mjs`:
   - Add checks asserting:
     - No static fallback `engineData?.engines || ALL_18_ENGINES` where `ALL_18_ENGINES` hardcodes `OPERATIONAL`.
     - `engine-matrix.tsx` handles `isError` or `UNKNOWN` / `OFFLINE` status.
   - Run `node scripts/check-no-production-facades.mjs` and ensure it passes with zero violations.

VERIFICATION:
Run tests:
- `node scripts/check-no-production-facades.mjs`
- `pnpm --filter @erppreflight/web typecheck` (or `pnpm run typecheck`)
Document all changes, test commands, and test results in `H:/erppreflight/.agents/teamwork/worker_m3/handoff.md`. Send completion message when done.
