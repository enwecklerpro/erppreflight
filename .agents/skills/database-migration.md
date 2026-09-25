# Playbook: Database Migrations & PostgreSQL RLS

> **Binding Authority**: Part 14.19, Part 21.19, Part 22.18 & AGENTS.md  
> **Scope**: Drizzle ORM schema, SQL migration files, PostgreSQL 16, pgvector, and Row-Level Security (RLS).

---

## 1. Migration Discipline
- **Ordered Numbered Files**: Migrations placed in `packages/database/migrations/` (e.g. `001_initial.sql`, `002_...`).
- **No Destructive Drops**: Never drop production tables or columns without a backward-compatible transitional migration.
- **Explicit RLS Enforcement**: Every tenant table MUST declare:
  ```sql
  ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
  ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation_<table_name> ON <table_name>
      FOR ALL
      USING (organization_id = get_current_tenant_id())
      WITH CHECK (organization_id = get_current_tenant_id());
  ```
- **Index Tenant Columns**: Ensure `organization_id` and foreign key columns are indexed (`CREATE INDEX IF NOT EXISTS ...`).

---

## 2. Implementation Checklist
- [ ] SQL migrations use idempotent `IF NOT EXISTS` constructs.
- [ ] Drizzle TypeScript schema in `packages/database/src/schema/` updated to match SQL definitions.
- [ ] Migration executed cleanly without errors under strict mode (`STRICT_MIGRATIONS=true`).
- [ ] Cross-tenant access denial tests verify tenant A cannot query tenant B records.
