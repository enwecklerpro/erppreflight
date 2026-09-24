# BRIEFING — 2026-09-24T21:20:00Z

## Mission
Comprehensive read-only survey of ERP Preflight codebase for R6 (Dynamic Engine Matrix Failure Representation) and R7 (Playwright E2E Test Suite & Golden Fixture).

## 🔒 My Identity
- Archetype: explorer
- Roles: explorer, synthesis
- Working directory: H:/erppreflight/.agents/teamwork/explorer_survey_3
- Original parent: 732d36b7-a399-4387-8843-8a3934bdf045
- Milestone: Survey Phase (R6 & R7)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Adhere to AGENTS.md and Cardinal Axioms
- Do not edit production code or files outside working directory
- Record all findings, exact line numbers, code snippets in handoff.md

## Current Parent
- Conversation ID: 732d36b7-a399-4387-8843-8a3934bdf045
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `apps/web/src/components/engine-matrix.tsx` (static fallback, missing error state, binary styling)
  - `apps/web/src/lib/api-client.ts` (`ALL_18_ENGINES` hardcoded 'OPERATIONAL', missing 'UNKNOWN' in union)
  - `apps/api/src/modules/engines/engines.service.ts` (API status responses: ONLINE, DEGRADED, OFFLINE)
  - `scripts/check-no-production-facades.mjs` (regex checks, scanDir mechanism, required updates)
  - `package.json`, `pnpm-workspace.yaml`, `playwright.config.ts` (missing @playwright/test and config)
  - `tests/fixtures/known_bad_billing_opd.xml` (does not exist, missing tests/fixtures directory)
  - `services/analysis-python/src/engines/opd_guard.py` (lacks XML parser in _parse_inputs, uses OPD_STEP_FAILED instead of OPD_DETERMINATION_STEP_MISSING)
  - `services/analysis-python/src/parsers/safe_xml.py` (LineElement with sourceline/sourcecolumn available)
  - `apps/web/src/app/page.tsx`, `apps/web/src/app/projects/page.tsx`, `apps/web/src/app/projects/[id]/page.tsx`, `apps/web/src/app/projects/[id]/findings/page.tsx` (E2E user flow mapping)
- **Key findings**:
  - R6: `engine-matrix.tsx:24` uses `engineData?.engines || ALL_18_ENGINES`. All 18 engines in `api-client.ts` have `status: 'OPERATIONAL'`. On query failure/unreachable API, UI falsely renders all 18 engines as green `OPERATIONAL`.
  - R6: `check-no-production-facades.mjs` requires assertions forbidding fallback to static `OPERATIONAL` status and requiring `UNKNOWN`/`OFFLINE` handling with retry prompt.
  - R7: `@playwright/test` is completely absent from all `package.json` files and `playwright.config.ts` is missing.
  - R7: `known_bad_billing_opd.xml` does not exist; furthermore, `opd_guard.py` currently only parses CSV/XLSX/JSON and does not parse XML artifacts or emit `OPD_DETERMINATION_STEP_MISSING`.
  - R7: Full 5-step E2E flow traced from Auth to Clean Core Index dashboard update.
- **Unexplored areas**: none (all core survey questions thoroughly answered).

## Key Decisions Made
- Detailed survey complete. Ready to compile structured `handoff.md` and send report to orchestrator.

## Artifact Index
- H:/erppreflight/.agents/teamwork/explorer_survey_3/DISPATCH.md — Initial dispatch
- H:/erppreflight/.agents/teamwork/explorer_survey_3/BRIEFING.md — Working memory
- H:/erppreflight/.agents/teamwork/explorer_survey_3/progress.md — Heartbeat
- H:/erppreflight/.agents/teamwork/explorer_survey_3/handoff.md — Final investigation report
