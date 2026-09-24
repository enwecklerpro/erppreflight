## 2026-09-24T01:50:09Z

You are m1_it2_explorer_1, working in directory H:/erppreflight/.agents/m1_it2_explorer_1.

MANDATORY: Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md before starting work.
Also read:
- H:/erppreflight/.agents/orchestrator_main/PROJECT.md
- H:/erppreflight/.agents/orchestrator_main/GATE_STATUS.md
- H:/erppreflight/.agents/m1_challenger_1/handoff.md

Problem Context (Milestone 1 Gate Failure - RLS Session Drop):
In `DatabasePool.query()` (packages/database/src/client.ts) and `DatabaseService.query()` (apps/api/src/modules/database/database.service.ts), `SELECT set_config('app.current_tenant_id', $1, true)` is executed with parameter `is_local = true` outside an explicit `BEGIN ... COMMIT` transaction. In PostgreSQL, setting `is_local = true` resets the config immediately after that single statement finishes! Any subsequent query evaluates `app.current_tenant_id = NULL` and returns 0 rows.

Objective:
Formulate the exact technical fix strategy for `packages/database` and `apps/api`:
1. Provide a transaction-scoped query execution pattern: `withTenantTransaction(tenantId, async (client) => { ... })` where `BEGIN`, `SET LOCAL app.current_tenant_id`, user query, and `COMMIT`/`ROLLBACK` are properly executed on the same dedicated client connection.
2. Provide a single-query helper that wraps queries with tenant context safely or uses session-scoped set_config on a checked-out connection with guaranteed reset in a `finally` block before returning to the pool.
3. Update Vitest tests to empirically verify tenant isolation across concurrent requests.

Write your fix blueprint to H:/erppreflight/.agents/m1_it2_explorer_1/rls_fix_plan.md and write a standard handoff.md.
Maintain progress.md with timestamps.
When done, call send_message to parent (conversation ID: b18c0539-d6d7-4a41-968f-58324775ab38).
