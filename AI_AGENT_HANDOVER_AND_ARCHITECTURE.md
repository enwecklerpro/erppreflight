# ERP Preflight — Technical Architecture, Monorepo Map & Hostinger Deployment Guide
> **Document Purpose**: Authoritative handoff and onboarding specification for autonomous AI coding agents and enterprise engineers.  
> **Target Repository**: `https://github.com/enwecklerpro/erppreflight`  
> **Production Target**: Hostinger VPS (Ubuntu 22.04 / 24.04 LTS) with Coolify v4+ or Docker Compose  
> **Current Baseline**: see `RELEASE_READINESS_REPORT.md` for the verified state, what was tested live, and the open gaps against the original specification  

---

## 1. Executive System Overview

**ERP Preflight** is an enterprise multi-tenant SaaS platform for automated preflight analysis, Clean Core compliance auditing, SAP upgrade verification, and release intelligence.

```
                              +-------------------------------------------------------+
                              |              End User / Browser / SAP Joule           |
                              +-------------------------------------------------------+
                                        |                                    |
                         HTTP / Port 3000 (HTTPS)              API / Port 3001 (HTTPS)
                                        v                                    v
                       +----------------------------------+ +----------------------------------+
                       |             apps/web             | |             apps/api             |
                       |       Next.js 15 App Router      | |       NestJS 11 Fastify API      |
                       |   (Base UI, TanStack 5 Suite)    | |   (Multi-Tenant, BullMQ, Auth)   |
                       +----------------------------------+ +----------------------------------+
                                                                     |                |
                                     BullMQ Redis Jobs / HTTP        |                | SQL (RLS)
                                                 +-------------------+                +-------------------+
                                                 v                                                        v
                        +----------------------------------+                         +----------------------------------+
                        |     services/analysis-python     |                         |             Postgres             |
                        |      Python 3.13 FastAPI         |                         |      PostgreSQL 16 + pgvector    |
                        |  19 Deterministic SAP Engines    |                         |     25 Tables with Strict RLS    |
                        +----------------------------------+                         +----------------------------------+
                                         |                                                        |
                                         | Ingestion Verification                                 | Cache & Queues
                                         v                                                        v
                        +----------------------------------+                         +----------------------------------+
                        |              clamav              |                         |              redis               |
                        |       ClamAV Daemon (:3310)      |                         |         Redis 7.2 Alpine         |
                        |     Quarantine / Virus Scan      |                         |      BullMQ Queue & Locks        |
                        +----------------------------------+                         +----------------------------------+
                                                                                                  |
                                                                             S3 API (:9000)       |
                                                                             +--------------------+
                                                                             v
                                                                    +----------------------------------+
                                                                    |              minio               |
                                                                    |     MinIO S3-Compatible Store    |
                                                                    |   (Quarantine, Clean, Reports)   |
                                                                    +----------------------------------+
```

---

## 2. Monorepo Directory Map & Where to Work

The repository is managed via `pnpm` workspaces (v9+) and `turbo` pipelines.

```text
H:/erppreflight/
├── apps/
│   ├── web/                        # Next.js 15 App Router Frontend (Port 3000)
│   │   ├── src/app/                # 27 App Router routes (Findings, Projects, Lab, Simulation, etc.)
│   │   ├── src/components/         # Accessible UI components (DataTable, Form, Badges)
│   │   ├── src/hooks/              # TanStack Query & Table hooks
│   │   └── src/lib/                # SSR-safe QueryClient, API clients, utilities
│   │
│   ├── api/                        # NestJS 11 Core SaaS Backend (Port 3001)
│   │   ├── src/modules/auth/       # Multi-tenant Argon2id auth, JWT, session scoping
│   │   ├── src/modules/projects/   # Project lifecycle, baselines, and drift
│   │   ├── src/modules/findings/   # Preflight findings, review workflows, and cascades
│   │   ├── src/modules/changesets/ # What-If simulation engine & blast radius traversal
│   │   ├── src/modules/agent-gate/ # Agent proposal verification & HMAC execution tokens
│   │   ├── src/modules/ingestion/  # File upload, ClamAV antivirus, ZIP safety, redaction
│   │   ├── src/modules/landscapes/ # SAP NetWeaver/ICM HTTP handshake & SSRF firewall
│   │   ├── src/modules/knowledge/  # Release compatibility matrix & RFC 8785 snapshots
│   │   ├── src/modules/mcp/        # Model Context Protocol tools for AI assistants
│   │   ├── src/modules/outbox/     # Transactional Outbox with FOR UPDATE SKIP LOCKED
│   │   ├── src/modules/webhooks/   # Real HTTP webhook dispatch with HMAC-SHA256
│   │   ├── src/modules/telemetry/  # Structured logging with X-Request-ID & metrics
│   │   └── src/modules/health/     # Multi-dependency readiness checks (DB, Redis, S3, etc.)
│   │
│   └── local-agent/                # Enterprise On-Premise Agent CLI & Daemon
│       ├── src/cli.ts              # Commands: status, enroll, scan, daemon, probe, verify-update
│       ├── src/daemon.ts           # Background daemon loop with telemetry heartbeats
│       ├── src/identity.ts         # Device pairing & secure identity storage (0600 mode)
│       ├── src/probe.ts            # On-premise NetWeaver ICM probe with SSRF defense
│       └── src/updater.ts          # Cryptographic SHA-256 digital signature validation
│
├── services/
│   └── analysis-python/            # Python 3.13 FastAPI Stateless Microservice (Port 8000)
│       ├── src/engines/            # The 19 SAP Preflight Engines + MFS BlackBox
│       │   ├── opd_guard.py        # BRFplus Output Determination engine
│       │   ├── clean_core.py       # Classic table replacements, obsolete ABAP statements
│       │   ├── form_doctor.py      # Adobe Forms / XDP / Fragment analyzer
│       │   ├── mfs_blackbox.py     # Handling Unit conveyor state machine engine
│       │   └── ...                 # 15 additional domain-specific engines
│       ├── src/platform/           # Evidence engine, confidence classifier, AI problem router
│       └── tests/                  # 548 automated pytest unit, adversarial & golden fixture tests
│
├── packages/
│   ├── database/                   # Drizzle ORM schema & client (Part 21.42 compliance)
│   │   ├── src/schema/             # 6 modular schema definitions (core, platform, templates, etc.)
│   │   ├── src/schema.ts           # Master export for all 25 tables + $inferSelect/$inferInsert
│   │   ├── src/client.ts           # pg.Pool with withTenantTransaction & getDrizzle() helper
│   │   ├── migrations/             # 10 SQL migrations (001 to 010; 010 = RLS runtime role) — NOT under src/
│   │   └── src/rls.ts              # PostgreSQL app.current_tenant_id RLS integration
│   │
│   ├── schemas/                    # Shared Zod contracts (@erppreflight/schemas)
│   ├── evidence/                   # Evidence data model & RFC 8785 canonical JSON hashing
│   ├── tenancy/                    # AsyncLocalStorage context for multi-tenancy
│   ├── auth/                       # RBAC policies and permission definitions
│   └── cli/                        # Global automation CLI & stdio MCP server bridge
│
├── infra/
│   └── docker/                     # Hardened multi-stage non-root container definitions
│       ├── Dockerfile.web          # Next.js standalone container
│       ├── Dockerfile.api          # NestJS Fastify production build
│       ├── Dockerfile.analysis     # Python 3.13 FastAPI microservice
│       └── api-entrypoint.sh       # Migration auto-runner entrypoint
│
├── tests/
│   └── e2e/                        # End-to-End Playwright test suite
│       ├── preflight-pipeline.mocked-ui.spec.ts # Category A: UI Contract tests
│       └── preflight-pipeline.live.spec.ts      # Category B: Live multi-container E2E
│
├── docker-compose.coolify.yml      # ★ LIVE production compose deployed by Coolify on the Hostinger VPS
├── .env.coolify.example            # Env template matching the live compose file
├── docker-compose.yaml             # Legacy compose (no ClamAV) — reference only
├── server.js                       # Alternative: Hostinger hPanel Node.js startup file (Next.js only)
├── scripts/                        # Quality-gate checks + Coolify deploy/monitor helpers (*.py)
├── .github/workflows/              # ci.yml, security.yml
├── AGENTS.md                       # Binding repository rules & Cardinal Axioms
├── ARCHITECTURE_DECISIONS.md       # Authoritative ADR records (Base UI, Drizzle, etc.)
└── package.json                    # Workspace orchestrator & verification scripts
```

---

## 3. The Two Cardinal Axioms (Non-Negotiable Rules)

Any AI agent modifying code in this repository **must** strictly enforce:

1. **Cardinal Axiom 1: *"A page that renders is not a completed feature."***
   - Frontend components must fetch real data using TanStack Query (`useQuery` / `useMutation`).
   - Hardcoded arrays, temporary dummy lists, or fake numbers in production components are strictly prohibited.
   - All forms must use dirty-state tracking, pending button states, and server error handling.
   - Severity badges (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `INFO`) must **never** rely on color alone; they must pair color with textual labels or ARIA descriptions.
   - Every view must have polished layout skeletons and actionable empty states.

2. **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."***
   - Analysis engines are deterministic AST/rule evaluators—never prompt wrappers.
   - Identical inputs must yield byte-for-byte identical findings.
   - Every finding must contain cryptographic SHA-256 evidence pointers (file, line, column).
   - Generative AI is strictly capped at `INFERRED` confidence (score $\le 0.60$).
   - Pure-LLM engines are strictly prohibited.

---

## 4. Hostinger VPS & Production Deployment Guide

Deploying ERP Preflight to a **Hostinger VPS** (e.g. KVM 2, KVM 4, or KVM 8 running Ubuntu 22.04 or 24.04 LTS) is fully containerized.

### 4.1 Recommended Hostinger Topology: Coolify v4+

> **Production compose file:** `docker-compose.coolify.yml` in the **repo root** is the Coolify deployment file. It uses `expose:` only (no public DB/Redis/MinIO ports), joins the external `coolify` Traefik network, builds with `context: .`, and uses the container aliases `erppreflight-postgres`, `erppreflight-redis`, `erppreflight-minio`, `erppreflight-analysis`. Its env template is the root `.env.coolify.example`. The CI facade gate (`scripts/check-no-production-facades.mjs`) validates this exact file.
>
> The former `infra/coolify/` variant was removed: it published `5432`/`6379`/`9000` on the host (Docker bypasses `ufw`) and had no `coolify` network. `docker-compose.yaml` (root) is a legacy variant without ClamAV that still uses `POSTGRES_HOST_AUTH_METHOD: trust` — do not point Coolify at it.

Internal ports of the live stack (host ports are **not** published; Traefik routes only `web` and `api`):

| Container | Service Name | Internal Port | Technology | Role |
|---|---|---|---|---|
| 1 | `postgres` | `5432` | PostgreSQL 16 + pgvector | Relational data, RLS, 1536-dim vector store |
| 2 | `redis` | `6379` | Redis 7.2 Alpine | BullMQ queues, caching, distributed locks |
| 3 | `minio` | `9000` / `9001` | MinIO | S3 quarantine, clean storage, PDF reports |
| 4 | `clamav` | `3310` | ClamAV Daemon | Ingestion virus scanner (fail-closed) |
| 5 | `analysis-python` | `8000` | Python 3.13 FastAPI | 19 SAP Preflight deterministic engines |
| 6 | `api` | `3001` | NestJS 11 Fastify | Multi-tenant SaaS API, Outbox, BullMQ |
| 7 | `web` | `3000` | Next.js 15 App Router | Responsive Web UI (Traefik SSL frontend) |

### 4.1.1 Coolify helper scripts (`scripts/*.py`)

`check-coolify.py`, `deploy-coolify.py`, `monitor-deployment.py` and `server-exec.py` call the Coolify API.
They read all credentials from environment variables — **never commit a token**:

```bash
export COOLIFY_BASE_URL=http://<VPS_IP>:8000
export COOLIFY_API_TOKEN=<token from Coolify → Keys & Tokens>
export COOLIFY_APP_UUID=<application uuid>
export COOLIFY_SERVER_UUID=<server uuid>   # server-exec.py only
python3 scripts/deploy-coolify.py
python3 scripts/monitor-deployment.py <deployment_uuid>
```

---

### 4.2 Step-by-Step Hostinger VPS Deployment

#### Step 1: Hostinger DNS Setup
In your Hostinger hPanel DNS Manager, point your domain records to your Hostinger VPS IPv4:
```text
A     @                   -> [HOSTINGER_VPS_IP]     # erppreflight.com (Web Frontend)
A     api                 -> [HOSTINGER_VPS_IP]     # api.erppreflight.com (SaaS API)
A     s3                  -> [HOSTINGER_VPS_IP]     # s3.erppreflight.com (MinIO, optional)
```

#### Step 2: Install Coolify on Hostinger VPS (if not installed)
Connect via SSH to your Hostinger VPS and install Coolify:
```bash
curl -fsSL https://cdn.coolify.io/coolify/install.sh | bash
```
Access the Coolify dashboard at `http://[HOSTINGER_VPS_IP]:8000`.

#### Step 3: Deploy Application via Coolify
1. In Coolify, create a new **Project** -> **Environment** -> **New Resource**.
2. Select **Docker Compose** or **GitHub Repository**:
   - Repository: `https://github.com/enwecklerpro/erppreflight`
   - Branch: `main`
   - Base Directory: `/`
   - Compose File Path: `/docker-compose.coolify.yml` (repo root — see warning in 4.1)
3. Configure the **Environment Variables** in Coolify using the values from the root `.env.coolify.example`.
4. Database migrations run automatically on `api` container start (`infra/docker/api-entrypoint.sh`, controlled by `AUTO_MIGRATE`, default `true`; SQL files from `MIGRATIONS_DIR=/app/packages/database/migrations`).

---

### 4.3 Alternative: Pure Docker Compose on Hostinger VPS (Without Coolify)

If running directly on the VPS via Docker without Coolify. The root file declares the external `coolify` network, so create it once (or remove it from the file) and put your own reverse proxy / Traefik in front of `web` and `api`:

```bash
# 1. SSH into Hostinger VPS
ssh root@[HOSTINGER_VPS_IP]

# 2. Clone repository
git clone https://github.com/enwecklerpro/erppreflight.git /opt/erppreflight
cd /opt/erppreflight

# 3. Setup environment configuration
cp .env.coolify.example .env
nano .env  # Fill in production passwords, JWT_SECRET, S3 keys, and domains

# 4. Start all services
docker network create coolify 2>/dev/null || true
docker compose -f docker-compose.coolify.yml up -d --build

# 5. Verify all 7 containers are healthy
docker compose -f docker-compose.coolify.yml ps
```

---

### 4.4 Mandatory Production Environment Variables

The API **refuses to start** in `NODE_ENV=production` when a required secret is missing or still a known default
(`apps/api/src/config/env.validation.ts`). Template: root `.env.coolify.example`.

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Schema-owner password (used for migrations). |
| `JWT_SECRET` | yes | ≥ 32 chars, `openssl rand -base64 48`. |
| `MASTER_ENCRYPTION_KEY` | yes | `openssl rand -hex 32`. Also keys secret-redaction masks. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | yes | MinIO root credentials. |
| `NEXT_PUBLIC_API_URL` | yes | **Build-time** for the web image (build arg). Changing it needs a web rebuild. |
| `CORS_ORIGIN` | yes | https origins only, comma-separated. |
| `DB_RUNTIME_ROLE` | default `erppreflight_app` | NOBYPASSRLS role created by migration 010; tenant transactions `SET LOCAL ROLE` to it so RLS applies. `none` disables (not recommended). |
| `APP_DATABASE_URL` | optional | Separate non-superuser runtime login. |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | optional | Creates one SUPER_ADMIN **only if the email does not exist yet**; never resets existing accounts. Password ≥ 12 chars. |
| `METRICS_TOKEN` | optional | Enables `GET /api/v1/metrics` for Prometheus (otherwise 404 in production). |
| `ENABLE_SWAGGER` | default `false` | Swagger UI is off in production unless `true`. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | for billing | Without them checkout returns 503 (no fake URLs). |
| `CLAMAV_MOCK_MODE` | must be `false` | Uploads fail closed if clamd is unreachable. |
| `MAIL_TRANSPORT` / `MAIL_FROM` | yes | `smtp` (`SMTP_HOST/PORT/SECURE/USER/PASSWORD`), `http` (`MAIL_HTTP_PROVIDER=resend\|postmark`, `MAIL_HTTP_API_KEY`) or `dev` (stores mail in `mail_outbox`, readable at `GET /api/v1/dev/mail/messages?to=` with header `X-Dev-Mailbox-Token`; in production only with `MAIL_DEV_OUTBOX_TOKEN` ≥ 24 chars, for staging/E2E stacks). |
| `APP_PUBLIC_URL` | yes (or `CORS_ORIGIN`) | Web origin used in verification / reset / invitation links. |
| `EMAIL_VERIFICATION_REQUIRED` | default `true` | Unverified users can sign in, create projects and upload, but cannot run analyses, export reports, create API keys or invite members (403 `EMAIL_NOT_VERIFIED`). |
| `AUTH_RATE_LIMIT_SCALE`, `TRUST_PROXY`, `BILLING_RETURN_ORIGINS`, `ALLOW_PRIVATE_LANDSCAPE_PROBES` | optional | See `.env.coolify.example`. |

Never commit real values. Coolify helper scripts read `COOLIFY_*` variables from the environment (§4.1.1).

---

## 5. Developer & AI Agent Operations Cheatsheet

### 5.1 Local Development Commands

```bash
# Install all dependencies across the monorepo
pnpm install

# Database migrations: there is NO root `db:migrate` script.
# Migrations (packages/database/migrations/001..010) run automatically when the API starts
# (AUTO_MIGRATE=true). Migration 010 creates the RLS runtime role erppreflight_app.

# Local infrastructure only (Postgres/pgvector, Redis, MinIO, ClamAV) from the production compose,
# with an override file that publishes the ports to localhost (never do this on the VPS):
#   services: { postgres: {ports: ["5432:5432"]}, redis: {ports: ["6379:6379"]},
#               minio: {ports: ["9000:9000","9001:9001"]}, clamav: {ports: ["3310:3310"]} }
docker network create coolify 2>/dev/null || true
docker compose --env-file .env -f docker-compose.coolify.yml -f compose.local.yml up -d postgres redis minio clamav

# Start all applications in watch/dev mode
pnpm dev

# Start only the Next.js web application
pnpm --filter @erppreflight/web dev

# Start only the NestJS backend API
pnpm --filter @erppreflight/api start:dev   # (the api package has no `dev` script)

# Start the Python analysis microservice
cd services/analysis-python && uvicorn src.main:app --reload --port 8000   # entrypoint is src/main.py
```

### 5.2 Mandatory Pre-Commit Quality Gates

```bash
pnpm run typecheck                         # 0 errors (13 packages)
pnpm run lint
pnpm run test                              # API 678, Web 155, local-agent 5 — all must pass
pnpm run test:python                       # 548 Python tests (scripts/run-pytest.mjs picks python3/python/py)
pnpm run check:deps && pnpm run check:no-production-facades && pnpm run check:production-truth
pnpm run build
pnpm --filter @erppreflight/api run test:boot   # compiles the full Nest DI graph from dist/ (catches startup crashes)
```

### 5.3 Live End-to-End Verification (against a running stack)

Unit tests mock the database, S3, ClamAV and the Python service. Every serious defect fixed on
2026-09-25 was invisible to them and only showed up in a live run. After any change to ingestion,
analysis, tenancy, redaction or export, run both smoke tests against a running stack:

```bash
API_BASE_URL=http://localhost:3001 pnpm smoke:live   # 21 API checks: register, upload+ClamAV, analysis,
                                                      # findings+evidence, 5 export formats, tenant isolation,
                                                      # secret redaction at rest
WEB_URL=http://localhost:3000 pnpm smoke:ui          # Chromium: signup -> verify e-mail -> project -> upload -> launch -> finding
WEB_URL=http://localhost:3000 node scripts/e2e-account-ui-smoke.cjs  # Chromium: reset password, 2FA enroll + login,
                                                      # invitations, org switch, GDPR export + account deletion
```

Both smoke tests follow e-mail links from the dev mailbox, so the API must run with `MAIL_TRANSPORT=dev`
(pass `MAIL_DEV_OUTBOX_TOKEN` to the scripts when the API sets one). Account lifecycle endpoints:
`/auth/{verify-email,verify-email/resend,password/forgot,password/reset,password/change,login/2fa,2fa/*,sessions,logout-all,switch-organization}`,
`/organizations/{members,invitations,ownership-transfer,current/security,current/export}`, `/invitations/{preview,accept,accept-new}`,
`/account/{export,deletion-impact}` and `DELETE /account` (migration 011).

Local API run with production semantics: `pnpm --filter @erppreflight/api build`, then start
`node apps/api/dist/src/main.js` with `NODE_ENV=production` and the variables from §4.4. The web must be built with
`NEXT_PUBLIC_API_URL=http://localhost:3001` and served with `next start`.

---

## 6. Where an AI Agent Must Make Specific Changes

| Task / Change Request | Where to Work | Specific Files & Notes |
|---|---|---|
| **Add or edit UI views** | `apps/web/src/app/` | Must use TanStack Query (`useQuery`), loading skeletons, and accessible badges. |
| **Add a new REST API endpoint** | `apps/api/src/modules/` | Add controller method with `@UseGuards(JwtAuthGuard, TenancyGuard)` and `@RequireEntitlement()`. |
| **Database changes / New tables** | `packages/database/` | 1. Add SQL in `migrations/010_*.sql`<br>2. Add Drizzle table in `src/schema/`<br>3. Export in `src/schema.ts`. |
| **Modify SAP Analysis Rules** | `services/analysis-python/src/engines/` | Must be deterministic. Add golden fixture tests in `services/analysis-python/tests/`. |
| **Add or update On-Prem Agent features** | `apps/local-agent/src/` | Commands in `cli.ts`, daemon tasks in `daemon.ts`, network checks in `probe.ts`. |
| **Deploy or modify Hostinger VPS containers** | `docker-compose.coolify.yml` (repo root) & `infra/docker/` | Edit the **root** compose file (Coolify deployment) or the Dockerfiles. Keep `.env.coolify.example` in sync with every `${VAR}` the compose file reads. |
