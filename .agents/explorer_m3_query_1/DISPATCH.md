## 2026-09-24T05:41:13Z

You are explorer_m3_query_1, a teamwork_preview_explorer.
Your working directory is H:/erppreflight/.agents/explorer_m3_query_1.
You MUST follow the File Workspace Convention: write ONLY within your working directory.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MISSION:
For Milestone 3 (TanStack Query Architecture in Next.js 15 App Router):
1. Design centralized SSR-safe QueryClient factory in apps/web/src/lib/query/query-client.ts:
   - Prevent server singleton leaks across concurrent SSR requests (per-request instance on server, browser singleton on client).
   - Configure default staleTime (e.g. 1 minute), retry policies, and dehydrate/hydrate options.
2. Design root QueryProvider in apps/web/src/lib/query/query-provider.tsx:
   - Client component wrapping layout children.
   - Tenant-switch listener: when tenant changes or logout occurs, immediately call `queryClient.cancelQueries()`, `queryClient.clear()`, and reset cache.
3. Design hierarchical query key factory in apps/web/src/lib/query/query-keys.ts (projects, findings, objects, analysis).
4. Review layout.tsx in apps/web to show how QueryProvider should wrap the app.

OUTPUT:
Write detailed implementation blueprint and code to H:/erppreflight/.agents/explorer_m3_query_1/handoff.md.
Send message to parent when done.
