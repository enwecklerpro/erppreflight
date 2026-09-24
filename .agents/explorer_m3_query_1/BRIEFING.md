# BRIEFING — 2026-09-24T05:48:00Z

## Mission
Investigate and design the enterprise TanStack Query architecture in Next.js 15 App Router for ERP Preflight, covering SSR-safe QueryClient factory, QueryProvider with tenant isolation & cache clearing, hierarchical query key factory, and layout integration.

## 🔒 My Identity
- Archetype: explorer
- Roles: explorer, investigator, synthesizer
- Working directory: H:/erppreflight/.agents/explorer_m3_query_1
- Original parent: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Milestone: Milestone 3 (TanStack Query Architecture in Next.js 15 App Router)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement in production source code, write ONLY within .agents/explorer_m3_query_1
- Comply with AGENTS.md Cardinal Axioms & Invariants:
  - Axiom 1 (real data, server state via TanStack Query)
  - Axiom 2 (pure deterministic logic/evidence)
  - Section 4.4: SSR QueryClient isolation (new instance per server request, browser singleton on client)
  - Section 4.4: Tenant cache eviction (cancelQueries, clear on tenant switch or logout)
  - Section 4.2: Strict No-Dependency-Soup policy (TanStack Query standard)

## Current Parent
- Conversation ID: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Updated: 2026-09-24T05:48:00Z

## Investigation State
- **Explored paths**:
  - `H:/erppreflight/.agents/ORIGINAL_REQUEST.md`
  - `H:/erppreflight/package.json`
  - `H:/erppreflight/apps/web/package.json` (Next.js 15.1.7, React 19, @tanstack/react-query 5.66.0)
  - `H:/erppreflight/apps/web/src/app/layout.tsx` (Current root layout)
  - `H:/erppreflight/apps/web/src/lib/api/custom-instance.ts` (ApiError, AUTH_TOKEN_KEY, TENANT_ID_KEY)
  - `H:/erppreflight/apps/web/src/lib/api-client.ts`
  - `H:/erppreflight/apps/web/src/lib/api/generated/endpoints/projects/projects.ts` (Orval hook integration)
  - `H:/erppreflight/.agents/skills/multi-tenant-security.md` (Section 5 & 6 on QueryClient eviction)
  - `H:/erppreflight/.agents/skills/frontend-design-system.md`
- **Key findings**:
  - Root layout is currently a Server Component with no `QueryClientProvider`, while UI pages (`projects/page.tsx`, `inspector/page.tsx`) were using raw `useState` and `useEffect`.
  - Next.js 15 App Router requires `isServer` branching: new `QueryClient` per server request to prevent cross-tenant SSR leaks; browser singleton for client navigation.
  - Multi-tenant eviction requires a 2-step sequence: `await queryClient.cancelQueries()` followed by `queryClient.clear()`.
  - Event triggers must listen for in-app `erppreflight:tenant-change`, `erppreflight:auth-logout`, cross-tab `storage` events, and reactive `tenantId` prop changes.
  - Hierarchical query keys enable surgical prefix invalidation for projects, findings, objects, analysis, tenants, transports, audit, and exports.
- **Unexplored areas**: Production file creation in `apps/web/src/lib/query/` (deferred to implementer agent per read-only explorer role).

## Key Decisions Made
- Validated designs via TypeScript compilation (`npx tsc --noEmit`) with 0 errors.
- Validated runtime behavior via standalone test suite (`test_query_architecture.ts`) with 17 passed assertions.
- Formulated complete drop-in blueprints for `query-client.ts`, `query-provider.tsx`, `query-keys.ts`, and `layout.tsx`.

## Artifact Index
- DISPATCH.md — Dispatch log
- BRIEFING.md — Situational awareness
- progress.md — Liveness heartbeat
- proposed_query_client.ts — Validated implementation of query client factory
- proposed_query_keys.ts — Validated implementation of hierarchical query key factory
- proposed_query_provider.tsx — Validated implementation of root query provider & tenant listener
- test_query_architecture.ts — Automated verification test harness (17 assertions passed)
- test_tsc.json — TypeScript configuration for verification
- handoff.md — Complete 5-component handoff report
