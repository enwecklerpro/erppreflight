# BRIEFING — 2026-09-24T05:35:00Z

## Mission
Fix custom-instance stream double-consumption, commit permanent OpenAPI contract, harden orval configs and check-no-dependency-soup script.

## 🔒 My Identity
- Archetype: teamwork_preview_worker
- Roles: implementer, qa, specialist
- Working directory: H:/erppreflight/.agents/worker_m2_2
- Original parent: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Milestone: M2

## 🔒 Key Constraints
- Follow File Workspace Convention (write metadata only to H:/erppreflight/.agents/worker_m2_2/)
- Respect Exclusive Write Ownership:
  1. H:/erppreflight/apps/web/src/lib/api/custom-instance.ts
  2. H:/erppreflight/apps/api/openapi.json
  3. H:/erppreflight/apps/web/orval.config.ts
  4. H:/erppreflight/orval.config.ts
  5. H:/erppreflight/scripts/check-no-dependency-soup.mjs
- Integrity Mandate: Genuine implementations only, no cheating or fake mocks.

## Current Parent
- Conversation ID: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Updated: 2026-09-24T05:35:00Z

## Task Summary
- **What to build**:
  1. Fix response stream double-consumption in `apps/web/src/lib/api/custom-instance.ts`.
  2. Commit permanent canonical OpenAPI contract at `apps/api/openapi.json`.
  3. Configure `apps/web/orval.config.ts` and `orval.config.ts` with permanent input target and `clean: false`.
  4. Harden `scripts/check-no-dependency-soup.mjs` with 'Application Router' rules and dynamic import / export regex.
  5. Verify `pnpm run check:deps`, `pnpm run typecheck`, `pnpm run build`.
- **Success criteria**: All checks pass, codegen:api works without running API server, 0 errors.
- **Interface contracts**: apps/api/openapi.json
- **Code layout**: apps/web, apps/api, scripts

## Key Decisions Made
- `custom-instance.ts`: Read `await response.text()` once on HTTP error, safely parsing JSON in-memory and falling back to raw text so non-JSON responses (HTML 502/504) produce `ApiError` instances rather than crashing with stream disturbance `TypeError`.
- `apps/api/openapi.json`: Established permanent canonical OpenAPI 3.0.0 contract containing all 21 core API routes.
- `orval.config.ts`: Set `clean: false` in both root and `apps/web` configs to safeguard generated code and pointed input to canonical spec.
- `check-no-dependency-soup.mjs`: Added 'Application Router' category (prohibiting `@tanstack/react-router`, `@tanstack/start`, `react-router`, `react-router-dom`) and updated `importRegex` to capture dynamic `import()` and `export ... from`.

## Artifact Index
- H:/erppreflight/.agents/worker_m2_2/DISPATCH.md
- H:/erppreflight/.agents/worker_m2_2/progress.md
- H:/erppreflight/.agents/worker_m2_2/handoff.md
- H:/erppreflight/.agents/worker_m2_2/test_regex.mjs
- H:/erppreflight/.agents/worker_m2_2/test_linter_detection.mjs

## Change Tracker
- **Files modified**:
  - `apps/web/src/lib/api/custom-instance.ts`: Stream safe error reading
  - `apps/api/openapi.json`: Permanent canonical OpenAPI specification
  - `apps/web/orval.config.ts`: Set `clean: false`
  - `orval.config.ts`: Set `clean: false`
  - `scripts/check-no-dependency-soup.mjs`: Application Router category & hardened regex
- **Build status**: PASS (turbo build 7/7 packages, 0 errors)
- **Pending issues**: None

## Quality Status
- **Build/test result**: PASS (typecheck 12/12, build 7/7, check:deps 11/11, vitest 16/16 files 366/366 passed)
- **Lint status**: 0 violations detected
- **Tests added/modified**: `test_regex.mjs`, `test_linter_detection.mjs`, verified against `reproduce_stream_bug.mjs`

## Loaded Skills
- None specified in dispatch.
