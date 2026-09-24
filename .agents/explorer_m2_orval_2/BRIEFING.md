# BRIEFING — 2026-09-24T05:14:15Z

## Mission
Finalize the Orval codegen blueprint for Milestone 2: review predecessor's artifacts, apps/api Swagger setup, define orval.config.ts, custom fetch mutator instance with auth/tenant headers, codegen scripts, and handoff report.

## 🔒 My Identity
- Archetype: teamwork_preview_explorer
- Roles: explorer, investigator, synthesizer
- Working directory: H:/erppreflight/.agents/explorer_m2_orval_2
- Original parent: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Milestone: Milestone 2 (M2 Orval Codegen Blueprint)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement in production source code, write ONLY within working directory H:/erppreflight/.agents/explorer_m2_orval_2.
- Adhere to AGENTS.md axioms & invariants (TanStack Query, SSR-safety, tenant isolation, Zod validation, Base UI/shadcn).
- Produce self-contained 5-component handoff report (Observation, Logic Chain, Caveats, Conclusion, Verification Method).

## Current Parent
- Conversation ID: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Updated: 2026-09-24T05:14:15Z

## Investigation State
- **Explored paths**:
  - `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (read fully as mandatory first step)
  - `H:/erppreflight/.agents/explorer_m2_orval_1/` (briefing, verify config, custom instance, swagger test script, test outputs)
  - `apps/api/src/main.ts` (Swagger DocumentBuilder, global prefix `api/v1`, CORS headers, excluded health routes)
  - `apps/api/src/modules/projects/` (controller, DTOs, missing `@ApiProperty` and `@ApiTags`)
  - `apps/api/nest-cli.json` (missing `@nestjs/swagger` compiler plugin)
  - `apps/api/src/modules/tenancy/` (tenancy middleware, guard, `X-Tenant-Id` header enforcement)
  - `apps/api/src/common/filters/http-exception.filter.ts` (standard error payload schema with correlationId)
  - `apps/web/package.json` and `apps/web/tsconfig.json` (missing `@tanstack/react-query`, paths `@/*`)
  - `apps/web/src/lib/api-client.ts` (violates Axiom 1 with hardcoded dummy arrays and mock fallbacks)
- **Key findings**:
  - Critical discovery: In predecessor's config, setting `override.query.useQuery: true` caused Orval to generate `useQuery` for POST/PUT/DELETE mutations instead of `useMutation`! Removing `useQuery: true` and keeping `query: { version: 5, signal: true }` correctly generates `useQuery` for GET and `useMutation` for POST/PUT/PATCH/DELETE.
  - Custom mutator `customInstance` must defensively normalize URLs: strip redundant `/api/v1` from base URL if path already includes `/api/v1`, forward `signal` for TanStack Query cancellation, inject `X-Tenant-Id` and `Authorization: Bearer <token>`, parse `ApiError` with `correlationId`, and guard against empty 204 responses.
  - Verified `production-custom-instance.ts` compiles cleanly with TypeScript strict mode and passes test assertions.
  - Verified exact directory layout with `mode: 'tags-split'` in `test-web-layout`: generates relative import `import { customInstance } from '../../../custom-instance'` and barrel `endpoints/index.ts`.
  - Identified requirement for `@nestjs/swagger` plugin in `apps/api/nest-cli.json` to turn empty `{ [key: string]: unknown }` DTOs into typed schema models.
- **Unexplored areas**: None. Tested and verified end-to-end with Orval 8.37.0.

## Key Decisions Made
- Recommend co-located `apps/web/orval.config.ts` (with root alternative provided) for monorepo encapsulation.
- Recommend removing `useQuery: true` and `useMutation: true` from Orval config to preserve standard HTTP semantics (GET = query, POST/PUT/PATCH/DELETE = mutation).
- Define production-grade `customInstance` in `apps/web/src/lib/api/custom-instance.ts` with browser storage helpers, URL normalization, tenant/auth injection, and structured `ApiError`.
- Define script workflow: `codegen:api` in `apps/web`, `openapi:export` in `apps/api`, and top-level `codegen:api` and `codegen` in root `package.json`.

## Artifact Index
- `DISPATCH.md` — incoming task log
- `BRIEFING.md` — working memory
- `progress.md` — liveness heartbeat
- `production-custom-instance.ts` — tested production custom fetch mutator
- `orval.blueprint.ts` — verified Orval config specification
- `test-mutator.mjs` — unit test suite for mutator logic
- `test-web-layout/` — verified reproduction of exact web layout and Orval outputs
- `handoff.md` — authoritative 5-component handoff report
