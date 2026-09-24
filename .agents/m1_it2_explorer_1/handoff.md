# Handoff Report: RLS Session Drop Technical Fix Strategy

**Agent**: `m1_it2_explorer_1`  
**Role**: Explorer / Investigator  
**Working Directory**: `H:/erppreflight/.agents/m1_it2_explorer_1`  
**Target Root**: `H:/erppreflight`  
**Target Artifact**: `H:/erppreflight/.agents/m1_it2_explorer_1/rls_fix_plan.md`  
**Recipient**: `parent` (conversation ID: `b18c0539-d6d7-4a41-968f-58324775ab38`)  
**Type**: Hard Handoff (Task Complete)

---

## 1. Observation

### 1.1 Direct Observation of the Code Defect
In `packages/database/src/client.ts` (lines 41–52) and `apps/api/src/modules/database/database.service.ts` (lines 55–68):
```typescript
async query<T extends QueryResultRow = any>(
  text: string,
  params: any[] = [],
  bypassRls = false
): Promise<QueryResult<T>> {
  const client = await this.pool.connect();
  try {
    if (!bypassRls) {
      const tenantId = TenancyContext.get()?.tenantId;
      if (tenantId) {
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      }
    }
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}
```

### 1.2 Database RLS Schema & Policy
In `packages/database/migrations/001_initial_schema.sql` (lines 20–26, 193–200):
```sql
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_projects ON projects;
CREATE POLICY tenant_isolation_projects ON projects
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());
```

### 1.3 Challenger 1 Reproduction Finding
In `H:/erppreflight/.agents/m1_challenger_1/handoff.md` (lines 37–50):
- Autocommit `SELECT set_config('app.current_tenant_id', $1, true)` returns tenant ID.
- Immediate subsequent query `SELECT current_setting('app.current_tenant_id', true)` on the same connection returns `''`.
- Autocommit query on table with RLS returned 0 rows.
- Inside explicit transaction (`BEGIN ... COMMIT`), the query returned 1 row.

### 1.4 Downstream Service Call Sites
Across `apps/api`:
- `apps/api/src/modules/projects/projects.service.ts` (lines 20, 31, 44, 57, 72): invokes `this.db.query(...)` without `bypassRls: true` for all project CRUD operations.
- `apps/api/src/modules/workspaces/workspaces.service.ts` (line 37): invokes `this.db.query(...)` for `getMembers(organizationId)`.
- `apps/api/src/modules/auth/auth.service.ts` (lines 28, 48, 56, 64, 95): invokes `this.db.query(..., { bypassRls: true })` for pre-authentication queries.
- `apps/api/src/modules/jobs/jobs.service.ts` (lines 42, 78, 108, 143, 151, 164): invokes `this.db.query(...)`.

---

## 2. Logic Chain

1. **Autocommit Boundary Breakdown**:
   - `client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId])` is executed without prior `BEGIN`.
   - In PostgreSQL, statements outside an explicit transaction block run in auto-commit mode, where each statement is implicitly wrapped in `BEGIN` and `COMMIT`.
   - The parameter `is_local = true` specifies transaction-scoped configuration. The moment this statement completes and commits, PostgreSQL resets `app.current_tenant_id` to its session-level value (`''`).

2. **RLS Policy Evaluation Collapse**:
   - The subsequent `client.query(text, params)` executes in a new autocommit transaction.
   - During row evaluation, PostgreSQL triggers `get_current_tenant_id()`.
   - `current_setting('app.current_tenant_id', true)` returns `''`, so `NULLIF('', '')` yields `NULL`.
   - The policy expression `organization_id = NULL` evaluates to `UNKNOWN` for all rows.
   - PostgreSQL filters out all rows, resulting in 0 rows returned, even for valid tenant data.

3. **Transaction-Scoped Resolution (`withTenantTransaction`)**:
   - By issuing `BEGIN` on a dedicated checked-out client, setting `set_config('app.current_tenant_id', $1, true)`, executing user queries, and concluding with `COMMIT` (or `ROLLBACK` on error), PostgreSQL maintains `app.current_tenant_id` across all queries within that transaction block.
   - Upon `COMMIT` or `ROLLBACK`, PostgreSQL automatically clears `app.current_tenant_id`, leaving the client completely clean before it is returned to the pool.

4. **Single-Query Safe Execution**:
   - For single queries with tenant context, wrapping the query inside `withTenantTransaction` (Approach 2A) provides 100% engine-enforced isolation, zero residual state, and full compatibility with PgBouncer in transaction-pooling mode.
   - Alternatively, session-scoped `set_config(..., false)` (Approach 2B) requires mandatory reset in `finally` and poison eviction via `client.release(error)` if reset fails.
   - Making `query()` delegate to `withTenantTransaction` when `!bypassRls && tenantId` fixes all callers in `apps/api` with zero breaking changes to existing service method signatures.

---

## 3. Caveats

- **Mocked Unit Tests vs Live PostgreSQL**: Standard unit tests that mock `db.query` or `pg.Pool` pass without exposing the autocommit reset behavior. Empirical verification requires either testing against a live PostgreSQL instance or using a stateful mock client that correctly simulates transaction boundaries and `is_local` resetting.
- **Superuser Bypass**: If the application connects as a PostgreSQL superuser or table owner, PostgreSQL bypasses RLS unless `ALTER TABLE ... FORCE ROW LEVEL SECURITY` is set. The migration already sets `FORCE ROW LEVEL SECURITY`, ensuring strict enforcement even for table owners.
- **PgBouncer Pooling Mode**: If PgBouncer or AWS RDS Proxy is used in `transaction` mode, session-level settings (`set_config(..., false)`) are prohibited or lost across transactions. Therefore, Approach 2A (transaction-wrapped query) is strongly recommended over Approach 2B for cloud deployments.

---

## 4. Conclusion

The Milestone 1 RLS session drop failure has been fully diagnosed, and a complete, actionable technical blueprint has been formulated in `H:/erppreflight/.agents/m1_it2_explorer_1/rls_fix_plan.md`.

The strategy delivers:
1. **Transaction-Scoped Pattern**: `withTenantTransaction(tenantId, async (client) => { ... })` and overloaded `withTenantTransaction(async (client) => { ... })` (using `TenancyContext`), with robust `BEGIN`, `COMMIT`, rollback safety, and broken-connection eviction.
2. **Safe Single-Query Execution**: `query()` updated with backward-compatible options (`boolean | QueryOptions`) delegating automatically to `withTenantTransaction` when tenant context is active, fixing all services (`ProjectsService`, `WorkspacesService`, etc.) transparently.
3. **Empirical Vitest Test Suite**: A 5-suite comprehensive test file (`apps/api/test/tenant_isolation.spec.ts`) verifying autocommit failure reproduction, single-query safety, transaction scoping, 50-request concurrent interleaving, and pool recycling cleanliness.

---

## 5. Verification Method

To independently verify the blueprint and its future implementation:

1. **Inspect Blueprint**:
   - Review `H:/erppreflight/.agents/m1_it2_explorer_1/rls_fix_plan.md` for exact code diffs and implementation details.

2. **Builder Implementation Verification**:
   - Builder executes Steps 1–5 from Section 7 of `rls_fix_plan.md`.
   - Run Vitest suite:
     ```powershell
     $env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"
     pnpm --filter @erppreflight/api test
     ```
   - Verify all tests in `apps/api/test/tenant_isolation.spec.ts` pass cleanly.

3. **Full Workspace Typecheck**:
   ```powershell
   pnpm turbo run typecheck
   ```
   Must pass with 0 errors across `@erppreflight/database`, `@erppreflight/api`, and shared packages.
