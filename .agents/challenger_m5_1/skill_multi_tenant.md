# Copy of multi-tenant-security.md
See H:/erppreflight/.agents/skills/multi-tenant-security.md for authoritative source.
Core methodology:
- Zero-Trust Multi-Tenancy Architecture
- SSR QueryClient Isolation: In Next.js App Router, getQueryClient() must create a new QueryClient instance per server request to prevent cross-tenant data leaks.
- Client browser uses a singleton QueryClient; cache is cleared on tenant switch or logout.
- PostgreSQL RLS + tenantId filtering on every query.
