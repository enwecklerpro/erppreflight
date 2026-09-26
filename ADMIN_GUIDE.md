# ERP Preflight — Administrator Guide

> Spec 13.12 #3. Covers the platform operator (SUPER_ADMIN) and tenant administrators. Server
> operations (deploy, backups, incidents) are in `DEPLOYMENT_GUIDE.md` and `docs/runbooks/`.

## 1. Roles

| Role | Scope | Where it is stored | Can |
|---|---|---|---|
| `SUPER_ADMIN` (system role) | Whole platform | `users.system_role` | Open **Admin** (`/admin`), list tenants and users, change system roles, see engine trust data and queue counts |
| `ADMIN` / `USER` (system role) | — | `users.system_role` | No platform administration |
| Organisation role: `ORGANIZATION_OWNER`, `SECURITY_ADMIN`, others (missing role = `VIEWER`) | One tenant | `organization_members.role` | Owner / security admin are required for destructive and approval routes, e.g. deleting a project, approving agent-gate proposals and changesets, changing organisation and workspace settings |

A user who signs up creates a new organisation and becomes its `ORGANIZATION_OWNER`; tenant data is
isolated by `organization_id` + PostgreSQL RLS. There is no invitation UI yet, so every signup is a
separate tenant.

## 2. Creating the first platform administrator

Set `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` (≥ 12 characters) in Coolify and deploy.
On start the API creates that account as `SUPER_ADMIN` **only if the e-mail does not exist**; it never
modifies existing accounts. Log in, change the password, then remove `ADMIN_BOOTSTRAP_PASSWORD`.

## 3. Admin console (`/admin`)

Visible only to `SUPER_ADMIN` (other users see an access notice). Backed by
`GET /api/v1/admin/{overview,tenants,users,engines,queues}` and `PATCH /api/v1/admin/users/:userId/role`.

- **Overview / tenants / users** — platform counts and lists; search users by e-mail, name or role.
- **Change a system role** — select USER / ADMIN / SUPER_ADMIN in the user row. Grant SUPER_ADMIN
  sparingly; there is no approval workflow or audit event for this change yet (KNOWN_LIMITATIONS P6).
- **Engines** — engine inventory and trust information from the analysis service (19 engines; see
  `ENGINE_CATALOG.md`).
- **Queues** — `analysis-queue` counts (waiting, active, completed, failed, delayed, paused). A
  growing `waiting` or `failed` count → `docs/runbooks/QUEUE_BACKLOG.md`.

## 4. Suspending a user

There is no UI for it yet. In the database:

```sql
UPDATE users SET status = 'SUSPENDED' WHERE email = 'user@example.com';
```

This blocks new logins. Already issued tokens stay valid until they expire (`JWT_EXPIRES_IN`,
default 7 days); to cut all sessions immediately rotate `JWT_SECRET` (logs everyone out) —
`docs/runbooks/SECRET_ROTATION.md` §2.

## 5. Tenant administration (Settings)

In **Settings** a tenant administrator manages:

- **API keys** — "Generate New API Key" with scopes; the full key is shown once and stored only as a
  SHA-256 hash; revoke in the same table.
- **Webhooks** — "Register Webhook Endpoint" (HTTPS URL + events). Deliveries are signed with
  HMAC-SHA256 using the endpoint secret shown at creation. Outbound URLs must resolve to public
  addresses (SSRF protection).
- **AI governance** — confidence ceiling and AI-assistance settings. AI output can never exceed
  `INFERRED` (0.60) and deterministic findings remain the source of truth.

## 6. Landscapes and agent gate

- **Landscapes** (`/landscapes`) register SAP systems (DEV/QA/PROD). Connection tests only reach
  public addresses unless `ALLOW_PRIVATE_LANDSCAPE_PROBES=true` is set for on-premise setups.
- **Agent gate** (`/agent-gate`) — AI-agent change proposals require approval by a user with the
  required organisation role; execution tokens are valid for 15 minutes.

## 7. Monitoring the platform

`/status` (public component status), `/health/readiness`, and Prometheus metrics at
`/api/v1/metrics` (`Authorization: Bearer $METRICS_TOKEN`; disabled when the token is unset).

## 8. Data requests

Account export/deletion flows are not implemented (GO_LIVE_CHECKLIST). Until they are, handle GDPR
requests manually: export with SQL filtered by `organization_id`/`user_id` and the tenant's objects under
`tenants/<organization_id>/` in MinIO; deletion must cover the database rows, the MinIO prefix and — by
retention expiry — the backups (`BACKUP_RETENTION_DAYS`).
