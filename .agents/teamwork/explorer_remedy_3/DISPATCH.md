## 2026-09-24T21:50:40Z

You are Explorer Remedy 3 (teamwork_preview_explorer).
Your working directory is H:/erppreflight/.agents/teamwork/explorer_remedy_3.
You MUST read the original user request at H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md before starting.
Also review H:/erppreflight/AGENTS.md, H:/erppreflight/.agents/teamwork/orchestrator_1/PROJECT.md, and H:/erppreflight/.agents/teamwork/orchestrator_1/GATE_STATUS.md.

FORENSIC AUDIT EVIDENCE:
You MUST read Reviewer 2's FULL report at:
H:/erppreflight/.agents/teamwork/reviewer_2/handoff.md
And the Forensic Auditor's report at:
H:/erppreflight/.agents/teamwork/auditor_1/handoff.md

YOUR MISSION:
Investigate and design the exact fix strategy for Item 4 (Playwright E2E Spec Integrity):
- Inspect `tests/e2e/preflight-pipeline.spec.ts`:
  Review Reviewer 2's specific findings:
  1. The offline fallback intercepts `**/*` with synthetic raw HTML strings, completely bypassing the actual Next.js application in `apps/web`.
  2. The test manually injects the cookie via `context.addCookies` and asserts the cookie it just injected exists, rather than verifying server Set-Cookie issuance.
  3. The mock asserts line coordinate 22, whereas the actual Python engine (`opd_guard.py` + `SafeXmlParser`) extracts `<Table name="Channel">` on line 23 of `tests/fixtures/known_bad_billing_opd.xml`.
- Formulate the precise refactoring plan for `tests/e2e/preflight-pipeline.spec.ts`:
  - Test real Next.js application routes (`/signup`, `/login`, `/projects`, `/projects/[id]`, `/projects/[id]/findings`).
  - Intercept only backend API calls (`/api/v1/**`) if live backend is offline, while rendering the true Next.js frontend pages.
  - Verify server Set-Cookie response on login/signup.
  - Assert the genuine line coordinate: line 23 for `<Table name="Channel">`.
  - Ensure `playwright test` passes cleanly against the real Next.js application.

Document the verified evidence chain, line numbers, and exact code refactoring in `H:/erppreflight/.agents/teamwork/explorer_remedy_3/handoff.md`.
Send completion message to parent when done.
