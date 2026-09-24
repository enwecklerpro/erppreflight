# BRIEFING — 2026-09-24T03:41:00Z

## Mission
Investigate apps/api OpenAPI setup and design the exact orval.config.ts configuration and codegen workflow for Milestone 2 adhering to Part 21.5.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis
- Working directory: H:/erppreflight/.agents/explorer_m2_orval_1
- Original parent: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Milestone: Milestone 2 (Orval OpenAPI Configuration)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement source code outside working directory
- Write ONLY within your working directory (H:/erppreflight/.agents/explorer_m2_orval_1)
- Communicate via send_message to parent (id: 66440be0-c7ee-4a74-8a17-61e13b963df1)
- Adhere to AGENTS.md Cardinal Axioms 1 & 2, Part 21.5, Part 22

## Current Parent
- Conversation ID: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `apps/api/src/main.ts` (DocumentBuilder, SwaggerModule, globalPrefix `api/v1`)
  - `apps/api/src/app.module.ts` and all 8 controller modules
  - `apps/web/package.json` and `apps/web/src/lib/api-client.ts`
  - `21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md` (§21.5 API Client Generation)
  - `AGENTS.md` (Cardinal Axioms 1 & 2, local service topology, multi-tenancy)
  - Orval v8.37.0 execution behavior, configuration options, TanStack Query v5 compatibility, MSW mock generation, tags-split mode, and custom mutator integration
- **Key findings**:
  - `apps/api` sets up SwaggerModule on `/api/v1/docs` exposing 21 endpoints across 8 controller tags: `auth`, `workspaces`, `projects`, `jobs`, `files`, `audit`, `export`, `health`.
  - Statically extracting the Swagger JSON from `AppModule` is completely deterministic and runnable headless via NestJS.
  - Orval v8.37.0 supports `mode: 'tags-split'` which generates separate domain folders with co-located `.ts` (hooks), `.msw.ts` (MSW v2 mocks), and an index re-exporter.
  - Orval requires `override.query.version: 5` to emit TanStack Query v5 `DataTag` and partial option types.
  - A custom mutator `customInstance` using native `fetch` satisfies Part 21 (no unnecessary axios dependency), injects `Authorization: Bearer <token>` and `X-Tenant-Id: <tenantId>`, handles base URL, and supports SSR.
- **Unexplored areas**: None. Tested and verified end-to-end with Orval 8.37.0.

## Key Decisions Made
- Select `mode: 'tags-split'` for optimal code-splitting, tree-shaking, and domain modularity matching NestJS modules.
- Use `override.query.version: 5` and `signal: true` for TanStack Query v5.
- Provide custom fetch mutator `customInstance` in `apps/web/src/lib/api/custom-instance.ts` to enforce multi-tenant `X-Tenant-Id` header and JWT token propagation.
- Configure input target with fallback: `process.env.OPENAPI_SPEC_URL || '../api/openapi.json'`.

## Artifact Index
- `DISPATCH.md` — incoming task log
- `BRIEFING.md` — working memory
- `progress.md` — liveness heartbeat
- `openapi-sample.json` — verified exported OpenAPI 3.0 spec containing 21 endpoints
- `production-custom-instance.ts` — tested custom fetch mutator
- `orval.verify.config.ts` — tested Orval configuration
- `handoff.md` — final 5-component handoff report
