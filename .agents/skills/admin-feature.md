# Playbook: Admin Features & Trust Center Operations

> **Binding Authority**: Part 14.21, Part 17.29, Part 18.20, Part 22.20 & AGENTS.md  
> **Scope**: Super Admin portal (`/admin`), Trust Center, system health probes, tenant management, and user role updates.

---

## 1. Principles
- **Strict Role Separation**: Admin features require `systemRole: 'SUPER_ADMIN'` verified on every backend request via `RolesGuard`.
- **System Health Visibility**: Live operational status exposed for Database, Redis Queues, Python Stateless Engines, and Ingestion Antivirus Scanner.
- **Tenant Management**: Super admins can view all organizations, active user counts, project metrics, and worker queue depths.
- **Role Auditing**: Any promotion to `ADMIN` or `SUPER_ADMIN` logs an immutable audit trail entry with executing user ID and timestamp.

---

## 2. Implementation Checklist
- [ ] Endpoints protected with `@Roles('SUPER_ADMIN')` and `@UseGuards(JwtAuthGuard, RolesGuard)`.
- [ ] Health check aggregates liveness and readiness states.
- [ ] BullMQ queue metrics expose waiting, active, completed, and failed job counts.
- [ ] Automated integration tests verify that non-super-admin users are rejected with HTTP 403 Forbidden.
