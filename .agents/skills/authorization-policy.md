# Playbook: Authorization Policy & Access Governance

> **Binding Authority**: Part 21.20, Part 22.9 & AGENTS.md  
> **Scope**: All API endpoints, controllers, mutations, admin features, and tenant access gates.

---

## 1. Core Principles
1. **Deny by Default**: An unauthenticated or unauthorized request must never succeed.
2. **Canonical Permission Names**: Use standard domain permissions:
   - `projects:read`, `projects:write`
   - `analysis:run`, `analysis:read`
   - `changes:propose`, `changes:approve`
   - `reports:read`, `reports:export`
   - `admin:super_admin`
3. **Backend Enforcement is Mandatory**: Frontend UI hiding is not authorization. Every mutation and query endpoint must enforce tenant context and role guards.
4. **Dual Approval for Production**: Any action with target environment `PROD` requires explicit approval by an authorized Human Architect.

---

## 2. Implementation Checklist
- [ ] Controller/handler is protected with `@UseGuards(JwtAuthGuard)` or equivalent.
- [ ] Tenant context extracted from verified JWT or session cookie; never trusted from user-supplied query/body params.
- [ ] PostgreSQL queries apply `organization_id = get_current_tenant_id()` or equivalent RLS context.
- [ ] Deny-by-default integration test verifies that requests without proper permissions receive HTTP 403 Forbidden.
- [ ] Audit log entry emitted for every sensitive role or permission change.
