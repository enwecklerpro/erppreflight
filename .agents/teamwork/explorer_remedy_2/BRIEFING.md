# BRIEFING — 2026-09-24T21:55:00Z

## Mission
Investigate and design the exact fix strategy for Item 2 (JWT Cookie Extractor crash) and Item 3 (URL Resolution edge cases).

## 🔒 My Identity
- Archetype: explorer
- Roles: teamwork_preview_explorer, investigation, remedy design
- Working directory: H:/erppreflight/.agents/teamwork/explorer_remedy_2
- Original parent: 732d36b7-a399-4387-8843-8a3934bdf045
- Milestone: Fix Strategy Design for Item 2 & Item 3

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Strict compliance with AGENTS.md and team protocols
- Formulate precise, verifiable code replacements

## Current Parent
- Conversation ID: 732d36b7-a399-4387-8843-8a3934bdf045
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `apps/api/src/modules/auth/strategies/jwt.strategy.ts` (lines 9–22)
  - `apps/api/test/empirical_challenger1_stress.spec.ts` (lines 350–430)
  - `apps/web/src/lib/api/custom-instance.ts` (lines 105–130)
  - `apps/web/src/__tests__/url-resolution.test.ts` (lines 1–121)
  - `apps/web/src/__tests__/empirical_url_resolution_stress.test.ts` (lines 1–146)
- **Key findings**:
  - Item 2: `decodeURIComponent(match[1])` on line 18 in `jwt.strategy.ts` lacks defensive exception handling, causing malformed cookies (e.g. `%ZZ`) to throw uncaught `URIError` and trigger 500 error in test `R4-C8`. Wrapping in `try { return decodeURIComponent(match[1]); } catch { return null; }` guarantees safe fallback to `null` without throwing.
  - Item 3: Challenger 1's naive remediation proposal in `challenger_1/handoff.md` had two defects: it failed `R5-C6` (duplicate `/api/v1` on base) and failed `R5-C11` (query-only path `?filter=all`).
  - Item 3 solution: Developed a robust algorithm splitting `pathname` and `searchAndHash`, collapsing multiple slashes via `/(https?:\/\/)|(\/)+/g`, normalizing trailing slashes, collapsing duplicate `/api/v1` on base and pathname, and performing regex-based boundary checking `/^\/api\/v1(?=$|\/)/`. Independently tested and verified 38/38 passing tests (19 empirical + 19 standard/SSR).
- **Unexplored areas**: none within Item 2 and Item 3 scope.

## Key Decisions Made
- Confirmed `catch { return null; }` for `cookieExtractor` to satisfy Auditor 1's explicit invalidation criteria and prevent 500 crashes on hostile input.
- Designed exact `resolveApiUrl()` implementation with clean separation of `pathname` and `searchAndHash` so query parameters with `/api/v1` (like `?path=/api/v1/clean.zip`) are never mutated or corrupted.

## Artifact Index
- `H:/erppreflight/.agents/teamwork/explorer_remedy_2/BRIEFING.md` — persistent working memory
- `H:/erppreflight/.agents/teamwork/explorer_remedy_2/progress.md` — liveness heartbeat
- `H:/erppreflight/.agents/teamwork/explorer_remedy_2/handoff.md` — 5-component handoff report
