# Multi-Tenant Isolation, Data Segregation & Security Playbook

> **Playbook Identifier**: `multi-tenant-security`  
> **Authority**: Binding architectural specification across all API endpoints, database queries, object storage, caching, background queues, and frontend tenant lifecycles.  
> **Governing Standards**: Part 22.8, Part 21, PostgreSQL Row-Level Security (RLS), TanStack Query SSR safety.  
> **Anchored Cardinal Axioms**: **Cardinal Axiom 1 (Criterion 1: Multi-Tenant SSR Isolation)** & **Cardinal Axiom 2 (Points 2 & 12: Tenant-Isolated Storage & Finding Serialization)**  
> **Applicable Trigger**: Creating or modifying any route, database query, schema, background job, cache key, storage artifact, or auth flow.

---

## 1. Overview & Zero-Trust Tenancy Principles

ERP Preflight is an enterprise SaaS platform processing proprietary SAP source code, custom field architectures, financial account determination setups, and strategic migration plans for competing global enterprises.

In this environment, a data leak between tenants is an existential event. The platform enforces a **Zero-Trust Multi-Tenancy Architecture**:
- Tenant boundary enforcement must be active at every architectural layer: ORM query, database engine (RLS), object storage, caching, background worker queues, and client-side browser caches.
- Reliance on application-level filtering alone is strictly prohibited. Database-level Row-Level Security (RLS) is mandatory.

### 1.1 Cardinal Axioms Anchoring: Zero-Trust Multi-Tenant Boundaries
This playbook provides the isolation infrastructure required by both Cardinal Axioms:
- **Axiom 1 (Frontend)**: Criterion 1 requires per-request SSR `QueryClient` isolation and immediate cache wiping on tenant switch/logout to prevent cross-tenant data leakage in UI views.
- **Axiom 2 (Engines & Storage)**: Points 2 and 12 require that customer artifacts, analysis queues, and persisted findings operate within strict cryptographic and database tenant boundaries (PostgreSQL RLS, S3 prefix scoping `/tenants/{orgId}/projects/{projId}/`).


---

## 2. Database Layer Segregation & PostgreSQL RLS Enforcement

### 2.1 Dual-Layer Segregation Standard
1. **Layer 1 (Application / Drizzle ORM)**: Every database query must explicitly include `organizationId` in its filter predicates:
   ```typescript
   db.select().from(findings).where(and(eq(findings.organizationId, tenantId), eq(findings.projectId, projectId)))
   ```
2. **Layer 2 (PostgreSQL Engine RLS)**: All tenant-scoped tables must have Row-Level Security enabled with an explicit policy checking the session variable `app.current_tenant_id`:
   ```sql
   ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation_policy ON findings
     USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
   ```

### 2.2 Scoped Transaction Execution
All queries execute inside `withTenantTransaction(pool, tenantId, callback)`, which sets the session parameter locally for the duration of the transaction (`isLocal = true`):

```typescript
// packages/database/src/rls.ts
import { Pool, PoolClient } from 'pg';

/**
 * Sets PostgreSQL session variable `app.current_tenant_id` for RLS.
 * Uses set_config() to support parameterized queries ($1, $2).
 * When isLocal is true, it MUST be executed inside an active transaction.
 */
export async function setTenantSession(
  client: PoolClient,
  tenantId: string,
  isLocal = true
): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', $1, $2)", [tenantId, isLocal]);
}

/**
 * Resets PostgreSQL session variable `app.current_tenant_id` to empty string.
 */
export async function resetTenantSession(
  client: PoolClient,
  isLocal = false
): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', '', $1)", [isLocal]);
}

/**
 * Executes a callback within a database transaction scoped with tenant RLS context.
 */
export async function withTenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let isBroken = false;
  try {
    await client.query('BEGIN');
    await setTenantSession(client, tenantId, true);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      isBroken = true;
    }
    throw error;
  } finally {
    if (isBroken) {
      client.release(true);
    } else {
      client.release();
    }
  }
}
```

---

## 3. Object Storage Hierarchy & Presigned URL Policies

### 3.1 Strict Key Prefixing
All customer artifacts, upload archives, and generated PDF/CSV reports in S3 or MinIO must be partitioned by tenant ID:
$$\text{/tenants/\{organization\_id\}/projects/\{project\_id\}/uploads/\{file\_uuid\}}$$
$$\text{/tenants/\{organization\_id\}/projects/\{project\_id\}/reports/\{report\_uuid\}.pdf}$$

### 3.2 Short-Lived Presigned URLs
1. **Zero Public Buckets**: Direct public read or write access to storage buckets is disabled at the IAM policy level.
2. **Maximum Lifespan**: Presigned URLs issued for file upload or report download must have a maximum lifespan of **15 minutes** (`expiresIn <= 900` seconds).
3. **Strictly Forbidden**: Issuing multi-hour, multi-day, or public direct URLs.

---

## 4. Redis Cache & BullMQ Queue Partitioning

### 4.1 Redis Cache Namespacing
All Redis cache keys must be prefixed with the organization ID:
```text
tenant:{organizationId}:projects:{projectId}:findings
tenant:{organizationId}:rate_limit:{userId}
```
Global un-partitioned cache keys for customer data are strictly forbidden.

### 4.2 BullMQ Queue Isolation & Noisy-Neighbor Defense
- Every job payload submitted to BullMQ must encapsulate `organizationId`.
- Workers verify tenant active status before processing jobs.
- Concurrency limits are enforced per tenant (e.g. maximum 5 concurrent analysis jobs per tenant) to prevent one heavy tenant from starving cluster resources.

---

## 5. Frontend Tenant Switching & Cache Invalidation Lifecycle

### 5.1 The Tenant Switch Event in Next.js
When a user switches organizations or projects in `apps/web`:
1. **Abort In-Flight Requests**: Cancel all pending HTTP requests for the previous tenant via `AbortController`.
2. **Wipe TanStack Query Cache**: Call `queryClient.cancelQueries()` followed immediately by `queryClient.clear()`. This purges all cached query and mutation data, preventing data from Tenant A from flashing in Tenant B's interface.
3. **Reset Local Component State**: Clear all form drafts and local component filters.

```typescript
// apps/web/src/hooks/use-tenant-switch.ts
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

export function useTenantSwitch() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useCallback(
    async (newOrganizationId: string) => {
      // 1. Cancel in-flight network queries
      await queryClient.cancelQueries();

      // 2. Wipe client cache completely
      queryClient.clear();

      // 3. Navigate to new organization workspace
      router.push(`/orgs/${newOrganizationId}/projects`);
    },
    [queryClient, router]
  );
}
```

---

## 6. Authentication State Changes & Session Security

- **SSR QueryClient Isolation**: In Next.js App Router, `getQueryClient()` must create a **new `QueryClient` instance per server request**. A shared server singleton will cause cross-tenant cache leaks across concurrent SSR requests.
- **Logout Action**: On user logout, wipe the browser QueryClient, purge localStorage/sessionStorage auth tokens, and redirect to login.

---

## 7. Automated Cross-Tenant Denial Testing Standard

Every API route and database query must have an automated integration test verifying cross-tenant access rejection:

```typescript
// apps/api/test/security/cross-tenant-isolation.e2e-spec.ts
describe('Cross-Tenant Security Isolation', () => {
  it('strictly denies Tenant B access to Tenant A project findings', async () => {
    // Setup: Create project and finding for Tenant A
    const findingA = await createTestFinding({ organizationId: tenantA.id });

    // Action: Attempt retrieval using Tenant B authentication credentials
    const response = await request(app.getHttpServer())
      .get(`/api/v1/findings/${findingA.id}`)
      .set('Authorization', `Bearer ${tenantBToken}`);

    // Verification: Must be rejected with 403 Forbidden or 404 Not Found
    expect([403, 404]).toContain(response.status);
  });
});
```

---

## 8. TypeScript & SQL Reference Implementation

```sql
-- packages/database/migrations/0004_tenant_rls_policies.sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_projects ON projects
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_findings ON findings
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```

---

## 9. Non-Negotiable Tenancy Invariants

1. **Dual-Layer Database Defense**: All tenant tables must have PostgreSQL RLS enabled and all ORM queries must filter by `organizationId`.
2. **Short-Lived Presigned URLs**: Presigned URLs must have a maximum lifespan of 15 minutes (`<= 900` seconds).
3. **Immediate Cache Wiping**: TanStack Query cache must be cleared immediately upon tenant switch or logout (`queryClient.clear()`).
4. **SSR Instance Isolation**: The server must create a new `QueryClient` instance per request; never reuse a global singleton on the server.
5. **Namespaced Cache & Queues**: Redis keys and BullMQ jobs must always be prefixed with the tenant ID.

### 9.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
Multi-tenancy and security enforcement must strictly adhere to the curated stack:
- ❌ **Database ORMs**: `prisma`, `typeorm`, `sequelize` (Standard: `drizzle-orm` + PostgreSQL RLS).
- ❌ **Job Queue Systems**: `kue`, `bee-queue`, `celery` in TypeScript (Standard: `bullmq` on Redis 7).
- ❌ **Shared Server Caches**: Global singleton server caches or shared in-memory stores between tenants (Standard: Per-request `QueryClient` factory in SSR, tenant-prefixed Redis keys).
- ❌ **Unverified Auth Tokens**: Homemade JWT rollouts without tenancy claims or unverified `x-tenant-id` request headers (Standard: `@erppreflight/auth` and PostgreSQL session parameters).

---

## 10. Forbidden Anti-Patterns

- ❌ **Anti-Pattern**: Omitting `organizationId` from a `WHERE` clause because an ID is a UUID.  
  *Violation*: Exposes the database to direct object reference (IDOR) attacks if RLS is bypassed.  
  *Correction*: Always pair resource IDs with `organizationId`.

- ❌ **Anti-Pattern**: Creating a single global `new QueryClient()` instance at module scope in a Next.js server module.  
  *Violation*: Causes concurrent server requests to share cache entries, leaking customer data between tenants.  
  *Correction*: Use a per-request `getQueryClient()` factory function.

- ❌ **Anti-Pattern**: Generating S3 pre-signed download URLs with a 24-hour expiration.  
  *Violation*: Breaches the 15-minute maximum TTL invariant for enterprise audit artifacts.  
  *Correction*: Set `expiresIn: 900` (15 minutes).
