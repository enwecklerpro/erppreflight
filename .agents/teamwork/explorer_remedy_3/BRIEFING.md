# BRIEFING — 2026-09-24T21:55:00Z

## Mission
Investigate and design the exact fix strategy for Item 4 (Playwright E2E Spec Integrity): eliminate synthetic HTML mock facade in tests/e2e/preflight-pipeline.spec.ts, test real Next.js pages, verify server Set-Cookie issuance, and assert genuine line coordinate 23.

## 🔒 My Identity
- Archetype: teamwork_preview_explorer
- Roles: explorer, investigator
- Working directory: H:/erppreflight/.agents/teamwork/explorer_remedy_3
- Original parent: 732d36b7-a399-4387-8843-8a3934bdf045
- Milestone: M4 Remedy (Playwright E2E Spec Integrity)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Adhere strictly to Cardinal Axioms 1 & 2 in AGENTS.md
- Produce comprehensive evidence chain and exact proposed refactoring

## Current Parent
- Conversation ID: 732d36b7-a399-4387-8843-8a3934bdf045
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `ORIGINAL_REQUEST.md`, `AGENTS.md`, `PROJECT.md`, `GATE_STATUS.md`
  - `reviewer_2/handoff.md`, `auditor_1/handoff.md`
  - `tests/e2e/preflight-pipeline.spec.ts` (lines 1–580)
  - `playwright.config.ts` (lines 1–36)
  - `apps/web/package.json`
  - `apps/web/src/app/signup/page.tsx`
  - `apps/web/src/app/login/page.tsx`
  - `apps/web/src/app/projects/page.tsx`
  - `apps/web/src/app/projects/[id]/page.tsx`
  - `apps/web/src/app/projects/[id]/findings/page.tsx`
  - `apps/web/src/app/page.tsx`
  - `apps/web/src/components/findings/finding-columns.tsx`
  - `apps/web/src/components/findings/finding-detail-row.tsx`
  - `apps/web/src/components/metrics-card.tsx`
  - `apps/web/src/lib/api/custom-instance.ts`
  - `apps/web/src/lib/api-client.ts`
  - `apps/api/src/modules/auth/auth.controller.ts`
  - `apps/api/src/modules/ingestion/files.controller.ts`
  - `tests/fixtures/known_bad_billing_opd.xml` (lines 1–62)
  - Python CLI execution on `tests/fixtures/known_bad_billing_opd.xml`
- **Key findings**:
  1. Next.js app in `apps/web` builds cleanly in 1.5s (`next build`) and boots in 1.6s (`next dev --port 3000`).
  2. `playwright.config.ts` currently lacks a `webServer` block. Adding `webServer: { command: 'pnpm --filter @erppreflight/web dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI }` ensures Next.js runs during E2E.
  3. All frontend API requests go through `resolveApiUrl()` and target `/api/v1/**`. By intercepting ONLY `**/api/v1/**` when backend is offline, Next.js page routes (`/signup`, `/login`, `/projects`, `/projects/[id]`, `/projects/[id]/findings`, `/`) and `/_next/**` assets are served 100% genuinely by Next.js.
  4. Authentication endpoints return `Set-Cookie: erppreflight_session=...; HttpOnly; Path=/; SameSite=Lax`. By letting the server response set the cookie, Playwright's browser context stores it naturally in `context.cookies()`. `context.addCookies` is completely removed.
  5. Python analysis of `tests/fixtures/known_bad_billing_opd.xml` via `opd_guard.py` deterministically extracts `<Table name="Channel">` on line 23. Test assertion must check `Line 23`.
  6. In the real Next.js application, finding details (evidence file pointer, line number, SHA-256) are inside `FindingDetailRow`, which is revealed when the user clicks to expand the row (`button:has-text("OPD_DETERMINATION_STEP_MISSING")`).
  7. On the Executive Dashboard, the card title is "Clean Core Index" and value is `87.5%`. Heading is "Executive Clean Core & Preflight Intelligence".
- **Unexplored areas**: None. Full evidence chain complete.

## Key Decisions Made
- Formulate complete replacement design for `tests/e2e/preflight-pipeline.spec.ts` and `playwright.config.ts`.
- Design verification method and diff patch instructions for implementer.

## Artifact Index
- `H:/erppreflight/.agents/teamwork/explorer_remedy_3/DISPATCH.md` — Inbound instructions log
- `H:/erppreflight/.agents/teamwork/explorer_remedy_3/BRIEFING.md` — Working state & memory
- `H:/erppreflight/.agents/teamwork/explorer_remedy_3/progress.md` — Liveness heartbeat
- `H:/erppreflight/.agents/teamwork/explorer_remedy_3/handoff.md` — Comprehensive handoff report
