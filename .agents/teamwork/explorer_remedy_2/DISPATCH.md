## 2026-09-24T21:50:40Z

You are Explorer Remedy 2 (teamwork_preview_explorer).
Your working directory is H:/erppreflight/.agents/teamwork/explorer_remedy_2.
You MUST read the original user request at H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md before starting.
Also review H:/erppreflight/AGENTS.md, H:/erppreflight/.agents/teamwork/orchestrator_1/PROJECT.md, and H:/erppreflight/.agents/teamwork/orchestrator_1/GATE_STATUS.md.

FORENSIC AUDIT EVIDENCE:
You MUST read the Forensic Auditor's FULL evidence report at:
H:/erppreflight/.agents/teamwork/auditor_1/handoff.md
And Challenger 1's report at:
H:/erppreflight/.agents/teamwork/challenger_1/handoff.md

YOUR MISSION:
Investigate and design the exact fix strategy for Item 2 (JWT Cookie Extractor crash) and Item 3 (URL Resolution edge cases):
1. In `apps/api/src/modules/auth/strategies/jwt.strategy.ts`:
   Inspect line 18 where `decodeURIComponent(match[1])` is called without `try/catch`. Examine `apps/api/test/empirical_challenger1_stress.spec.ts` for failing tests where malformed percent-encoded cookies (`%ZZ`) cause 500 unhandled exceptions.
2. In `apps/web/src/lib/api/custom-instance.ts`:
   Inspect `resolveApiUrl()`. Examine `apps/web/src/__tests__/empirical_url_resolution_stress.test.ts` for the 10 failing normalization test cases (whitespace trimming, double slashes, duplicate `/api/v1`).
3. Formulate the precise code fixes so that:
   - `jwt.strategy.ts` safely decodes cookies with `try/catch` and gracefully handles malformed cookies without throwing.
   - `resolveApiUrl()` normalizes URLs, trims whitespace, collapses double slashes, and deduplicates `/api/v1` so that all 19 tests in `empirical_url_resolution_stress.test.ts` AND all 13 tests in `url-resolution.test.ts` pass 100%.

Document the verified evidence chain, line numbers, and exact code replacements in `H:/erppreflight/.agents/teamwork/explorer_remedy_2/handoff.md`.
Send completion message to parent when done.
