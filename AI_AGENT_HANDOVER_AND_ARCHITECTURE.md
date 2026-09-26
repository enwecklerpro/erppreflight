# ERP Preflight — Technical Architecture, Monorepo Map & Hostinger Deployment Guide
> **Document Purpose**: Authoritative handoff and onboarding specification for autonomous AI coding agents and enterprise engineers.  
> **Target Repository**: `https://github.com/enwecklerpro/erppreflight`  
> **Production Target**: Hostinger VPS (Ubuntu 22.04 / 24.04 LTS) with Coolify v4+ or Docker Compose  
> **Current Baseline**: commit `6303f1d` (2026-09-26, all remediation workstreams merged). Verdict and owner actions: `RELEASE_READINESS_REPORT.md`; canonical per-capability status: `docs/CURRENT_PRODUCT_STATUS.md`; commands and test counts: `docs/E2E_TEST_REPORT.md`. **Nothing on this commit has been deployed or verified in production** (`docs/LIVE_PRODUCTION_VERIFICATION.md`).  

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
                        |  19 Deterministic SAP Engines    |                         |  62 tenant tables, FORCE RLS     |
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
│   │   ├── src/app/                # 64 pages: public [locale]/ (EN/DE site, pricing, tools, sap/*, docs, knowledge, legal) + app routes
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
│   │   ├── src/modules/health/     # Multi-dependency readiness checks (DB, Redis, S3, etc.)
│   │   ├── src/modules/{account,organizations,mail}/   # GDPR export/delete, members/invitations, mail transports (migration 011)
│   │   ├── src/modules/{audit,usage,billing,export,retention,admin,feature-flags,support}/  # commercial + governance (012, 016)
│   │   ├── src/modules/knowledge/  # knowledge articles + content workflow (013, 019)
│   │   ├── src/modules/{knowledge-graph,release-intelligence,notifications}/  # Cloudification sync, watches (014)
│   │   ├── src/modules/{connectors,sso,partners}/      # 9 connector types, work items, local-agent API, OIDC + SCIM, partner grants (015)
│   │   ├── src/modules/findings/, lab/regression/      # finding lifecycle, Test Lab (017)
│   │   ├── src/modules/{router,analyses}/              # Problem Router, SSE progress, Full Project Preflight (018); run detail, cancel, rerun (020)
│   │   ├── src/modules/public-tools/                   # free tools + programmatic SEO gate
│   │   └── src/observability/      # Pino logger, OTel tracing, Sentry-protocol reporter, Scalar API reference
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
│       └── tests/                  # 1169 pytest tests (+1 optional-dependency skip): unit, adversarial, golden fixtures, Hypothesis
│
├── packages/
│   ├── database/                   # Drizzle ORM schema & client (Part 21.42 compliance)
│   │   ├── src/schema/             # 6 modular schema definitions (core, platform, templates, etc.)
│   │   ├── src/schema.ts           # Master export for the Drizzle tables + $inferSelect/$inferInsert
│   │   ├── src/client.ts           # pg.Pool with withTenantTransaction & getDrizzle() helper
│   │   ├── migrations/             # 20 SQL migrations (001 to 020; 010 = RLS runtime role) — NOT under src/
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
│       ├── Dockerfile.local-agent  # On-premise agent image
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
├── .github/workflows/              # ci.yml, security.yml, docker.yml, release.yml (never run on GitHub yet)
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
| `NEXT_PUBLIC_APP_URL` | yes | **Build-time** for the web image: canonical URLs, sitemap and robots base. |
| `NEXT_PUBLIC_LEGAL_*` | yes (public site) | Operator data for imprint/privacy/DPA/subprocessors (`COMPANY_NAME`, `ADDRESS`, `EMAIL`, `PHONE`, `REGISTER`, `VAT_ID`, `REPRESENTATIVE`, `RESPONSIBLE_PERSON`, `SUBPROCESSORS`); read by `apps/web/src/lib/legal.ts`. Build-time. |
| `STRIPE_PRICE_ID_STARTER` / `STRIPE_PRICE_ID_PROFESSIONAL`, `PLAN_PRICE_EUR_*`, `TRIAL_DAYS`, `TRIAL_PLAN_TIER` | for billing | Price ids for checkout; list prices shown on `/pricing`; trial defaults 14 days / PROFESSIONAL. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | optional | Error reporting via the Sentry envelope protocol (`apps/api/src/observability/error-reporter.ts`). |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | optional | OTLP/HTTP tracing (API and analysis service). |
| `ENABLE_API_REFERENCE` | default `false` | Serves `/api/v1/reference` (Scalar) and `/api/v1/openapi.json` in production. |
| `KNOWLEDGE_SYNC_CRON`, `KNOWLEDGE_CR_FILES`, `KNOWLEDGE_SEED` | optional | Weekly Cloudification sync (default `17 3 * * 1` UTC, `off` disables); knowledge-article seeding. |
| `MAX_UPLOAD_SIZE_MB` | default `100` | Multipart upload cap (413 above it). |
| `WEBHOOK_ALLOW_PRIVATE_NETWORKS`, `CONNECTOR_ALLOW_PRIVATE_NETWORKS`, `SSO_ALLOW_PRIVATE_NETWORKS` | default `false` | SSRF policy exceptions for private receivers/IdPs/connector targets (staging only). |
| `AGENT_JOB_SIGNING_KEY`, `AGENT_UPDATE_MANIFEST_*` | for local agents | Signs jobs sent to enrolled local agents; update channels. |
| `AUTH_RATE_LIMIT_SCALE`, `TRUST_PROXY`, `BILLING_RETURN_ORIGINS`, `ALLOW_PRIVATE_LANDSCAPE_PROBES` | optional | See `.env.coolify.example`. |

Never commit real values. Coolify helper scripts read `COOLIFY_*` variables from the environment (§4.1.1).

---

## 5. Developer & AI Agent Operations Cheatsheet

### 5.1 Local Development Commands

```bash
# Install all dependencies across the monorepo
pnpm install

# Database migrations: there is NO root `db:migrate` script.
# Migrations (packages/database/migrations/001..020) run automatically when the API starts
# (AUTO_MIGRATE=true). 001-009 core platform; 010 RLS runtime role erppreflight_app; 011 account lifecycle;
# 012 billing/usage/retention; 013 knowledge articles; 014 knowledge graph + release intelligence;
# 015 connectors/identity/partner; 016 billing_events RLS; 017 finding lifecycle + Test Lab;
# 018 analysis orchestration; 019 knowledge content workflow; 020 analysis run lifecycle (inputs, cancel,
# rerun link, Test Lab runs as analyses, generated-test promotion).
# Verify: PG_ADMIN_URL=postgres://<user>:<pw>@localhost:5432 bash scripts/ci-migration-check.sh

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
pnpm run test                              # API 979, Web 233, local-agent 10 — all must pass (6303f1d)
pnpm run test:python                       # 1169 passed + 1 skipped (scripts/run-pytest.mjs picks python3/python/py)
python -m pytest tests/e2e tests/empirical_redaction_stress.py -q   # 267
python scripts/generate-engine-catalog.py --check                   # ENGINE_CATALOG.md up to date (19 engines)
pnpm run check:deps && pnpm run check:no-production-facades && pnpm run check:production-truth
pnpm run build
pnpm --filter @erppreflight/api run test:boot   # compiles the full Nest DI graph from dist/ (catches startup crashes)
```

### 5.3 Live End-to-End Verification (against a running stack)

Unit tests mock the database, S3, ClamAV and the Python service. Every serious defect fixed on
2026-09-25 was invisible to them and only showed up in a live run. After any change to ingestion,
analysis, tenancy, redaction or export, run the relevant suites against a running stack:

All suites create throwaway tenants. Most follow e-mail links from the dev mailbox, so the API must run with
`MAIL_TRANSPORT=dev`; pass `MAIL_DEV_OUTBOX_TOKEN` when the API sets one. Browser suites need Chromium
(`CHROMIUM_PATH=/path/to/chromium` if Playwright's bundled browser is not installed). Results on `6303f1d`: all passed
(`docs/E2E_TEST_REPORT.md`).

```bash
# API: register, verification, reset, 2FA, invitations, org switch, GDPR, upload + ClamAV, OPD Guard run, exports,
# cross-tenant denials, redaction at rest — 77 checks
API_BASE_URL=http://localhost:3001 MAIL_DEV_OUTBOX_TOKEN=... bash scripts/e2e-live-smoke.sh     # pnpm smoke:live
# Chromium: signup -> verify e-mail -> project -> upload -> launch -> finding with evidence
WEB_URL=http://localhost:3000 API_URL=http://localhost:3001 MAIL_DEV_OUTBOX_TOKEN=... node scripts/e2e-ui-smoke.cjs [shotDir]
# Chromium: reset password, 2FA enroll + login, invitations, org switch, GDPR export + account deletion
WEB_URL=... API_URL=... MAIL_DEV_OUTBOX_TOKEN=... node scripts/e2e-account-ui-smoke.cjs
# Public site EN/DE (home, pricing, solutions, knowledge incl. 404, legal pages, sitemap/robots, CSP headers)
WEB_URL=... node scripts/e2e-public-smoke.cjs [shotDir]
# Audit chain, usage metering, plan limits (402), trial, exports, admin, flags, support (~64 checks);
# Stripe webhook checks only when the API runs with the same STRIPE_WEBHOOK_SECRET
API_BASE_URL=... SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... MAIL_DEV_OUTBOX_TOKEN=... [STRIPE_WEBHOOK_SECRET=whsec_...] \
  python3 scripts/e2e-commercial-smoke.py                                                     # pnpm smoke:commercial
WEB_URL=... API_BASE_URL=... SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... MAIL_DEV_OUTBOX_TOKEN=... node scripts/e2e-commercial-ui.cjs   # 17 steps
WEB_URL=... API_BASE_URL=... MAIL_DEV_OUTBOX_TOKEN=... node scripts/e2e-findings-smoke.cjs     # finding lifecycle, 14
WEB_URL=... API_BASE_URL=... MAIL_DEV_OUTBOX_TOKEN=... node scripts/e2e-analyze-smoke.cjs      # /analyze + router + SSE, 13
WEB_URL=... API_BASE_URL=... [SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=...] node scripts/e2e-tools-smoke.cjs   # free tools + SEO pages, 24
WEB_URL=... API_URL=... MAIL_DEV_OUTBOX_TOKEN=... node scripts/e2e-i18n-smoke.cjs             # DE on every app page, 375/1440 px
# Analysis run lifecycle: detail page, cancel queued + running run, rerun (identical inputs, immutability),
# Test Lab runs in the history, generated-test promotion, VIEWER 403, cross-tenant 404, EN/DE + 375 px — 16 steps
WEB_URL=... API_BASE_URL=... MAIL_DEV_OUTBOX_TOKEN=... node scripts/e2e-analysis-lifecycle-smoke.cjs   # pnpm smoke:analysis-lifecycle
# Enterprise integrations against the contract doubles. Start them first:
#   node apps/api/test/doubles/run-doubles.cjs --host <ip> --base-port 3710 --certs /tmp/erppf-certs --out /tmp/erppf-doubles.json
# and start the API with NODE_EXTRA_CA_CERTS=/tmp/erppf-certs/ca.pem, CONNECTOR_/WEBHOOK_/SSO_ALLOW_PRIVATE_NETWORKS=true,
# SSO_DNS_SERVERS=<ip>:<base+9> (see the header of run-doubles.cjs).
# Run with ONE API per database (a second API's outbox dispatcher can steal webhook events).
API_BASE_URL=... DOUBLES_FILE=/tmp/erppf-doubles.json DATABASE_URL=... METRICS_TOKEN=... MAIL_DEV_OUTBOX_TOKEN=... \
  node scripts/e2e-enterprise-live.cjs                                                        # 85 checks
WEB_URL=... API_BASE_URL=... DOUBLES_FILE=... MAIL_DEV_OUTBOX_TOKEN=... node scripts/e2e-integrations-ui.cjs <shotDir>   # 17 steps
# Everything the CI live-e2e job runs (infra, builds, API prod mode, smokes, backup/restore drill):
PG_ADMIN_URL=... S3_ACCESS_KEY=... S3_SECRET_KEY=... bash scripts/ci-live-e2e.sh
```

Account lifecycle endpoints:
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
| **Database changes / New tables** | `packages/database/` | 1. Add a new SQL file `migrations/020_*.sql` (next free number; never edit an applied migration)<br>2. Every table with `organization_id` needs ENABLE + FORCE RLS and a policy (enforced by `scripts/ci-migration-check.sh`)<br>3. Add Drizzle table in `src/schema/`<br>4. Export in `src/schema.ts`. |
| **Modify SAP Analysis Rules** | `services/analysis-python/src/engines/` | Must be deterministic. Add golden fixture tests in `services/analysis-python/tests/`. |
| **Add or update On-Prem Agent features** | `apps/local-agent/src/` | Commands in `cli.ts`, daemon tasks in `daemon.ts`, network checks in `probe.ts`. |
| **Public website pages (EN/DE)** | `apps/web/src/app/[locale]/` | Server components only; call `resolveLocale(params)` (validates + `setRequestLocale`), export `generateMetadata` built with `publicPageMetadata()` from `lib/seo.ts` (canonical, hreflang, OG/Twitter). Add the path to `LOCALIZED_PUBLIC_ROUTES` (sitemap) and, for a new top-level segment, to `LOCALIZED_PUBLIC_EXACT/PREFIXES` in `lib/routing.ts`. |
| **Route classification / SEO** | `apps/web/src/lib/seo.ts`, `lib/routing.ts` | Single route inventory: public (EN-only), localized public, private (noindex). New private segment = `layout.tsx` with `PRIVATE_ROUTE_METADATA` + entry in `PRIVATE_ROUTE_PREFIXES`; login-only segments also in `AUTH_REQUIRED_PREFIXES` (middleware redirects to `/login?next=`). Enforced by `__tests__/seo-routes.test.ts`. |
| **Knowledge base articles** | `apps/api/src/modules/knowledge/` | Public `GET /api/v1/public/knowledge[/:slug]?locale=en\|de` (PUBLISHED only); SUPER_ADMIN CRUD at `/api/v1/admin/knowledge` (POST, PATCH, DELETE = archive, `GET :id/revisions`). Table + append-only revisions: migration 013. Starter content: `knowledge-seed.ts` (idempotent). Web renders Markdown with the safe renderer `components/public/markdown.tsx` (no raw HTML). |
| **Pricing page data** | `apps/web/src/lib/plans.ts` | Reads `GET /api/v1/billing/plans` (PLAN_CATALOG from `@erppreflight/schemas` + configured prices). If the API is unreachable, limits come from PLAN_CATALOG and prices are withheld ("Contact sales"). Never hard-code prices in the web app. |
| **Legal operator data** | env `NEXT_PUBLIC_LEGAL_*` (see `.env.coolify.example`) | Read by `lib/legal.ts`; never hard-code company data. |
| **Deploy or modify Hostinger VPS containers** | `docker-compose.coolify.yml` (repo root) & `infra/docker/` | Edit the **root** compose file (Coolify deployment) or the Dockerfiles. Keep `.env.coolify.example` in sync with every `${VAR}` the compose file reads. |

### 6.0 Analysis run lifecycle, analysis detail page and the Test Lab model (migration 020)

**Endpoints** (`apps/api/src/modules/analyses/analysis-lifecycle.*`, all tenant-scoped, foreign ids = 404):

| Endpoint | Guards | Behaviour |
|---|---|---|
| `GET /api/v1/analyses/:id/detail` | JWT + tenant | Everything the detail page shows: status, timing (`created/started/completed`, queue wait), recorded inputs (artifacts with SHA-256 + size at launch, current state, "changed/deleted" flags), requested + effective configuration, knowledge snapshot (seq, content SHA-256, superseded flag), engine calls (outcome, findings, rules, duration, engine version, error), telemetry totals, lineage (rerun of / reruns), cancellation, lab results, generated-test counts, `permissions` for the caller. |
| `POST /api/v1/analyses/:id/cancel` `{reason?}` | role ≠ VIEWER/AUDITOR (`RolesGuard`), `@Audited analysis.cancel_requested` | QUEUED: BullMQ job removed (job id = analysis id) → `CANCELLED` at once. RUNNING: `cancel_requested_at` stamped; the worker stops at the next engine step and aborts the in-flight analysis-service `fetch` (`RunCancellation`: DB flag polled every second + in-process signal) → `CANCELLED`. Idempotent (`ALREADY_CANCELLED` / `ALREADY_REQUESTED`), 409 `ANALYSIS_NOT_CANCELLABLE` for finished runs, 409 `ANALYSIS_FINALIZING` once results are being published. Final transition writes `analysis.cancelled` (audit + outbox event) and a `CANCELLED` progress stage. |
| `POST /api/v1/analyses/:id/rerun` | role ≠ VIEWER/AUDITOR, verified e-mail, `@RequireEntitlement('RUN_ANALYSIS')`, `@Metered ANALYSIS_RUN`, `@Audited analysis.rerun_queued` | New run with the identical recorded inputs (artifacts re-resolved: must still be CLEAN in the project, else 409 `RERUN_INPUTS_UNAVAILABLE`; engines, target release, requested configuration — the current data policy is applied on top; planner assignments/stages), `rerun_of_analysis_id` = source, knowledge snapshot in force now recorded (`previousKnowledgeSnapshotId` in the response). 409 `ANALYSIS_STILL_ACTIVE` for queued/running sources. 409 `ANALYSIS_RERUN_IN_PROGRESS` while a rerun of the same source is still queued/running (unique partial index `uq_analyses_active_rerun`, so double clicks / concurrent requests cannot queue it twice or consume quota twice). The source run and its findings are never touched. Lab runs re-run the same test cases / scenario. |
| `GET /api/v1/lab/generated-tests?projectId=` (or `?analysisId=`), `GET /lab/generated-tests/:id`, `POST /lab/generated-tests/:id/promote` | JWT + tenant; promote needs finding write role, `@Audited lab.generated_test_promoted` | Generated regression test specifications and their promotion into the Test Lab (idempotent). |

**State machine** (pure, unit-tested: `analysis-lifecycle.state.ts`): `QUEUED → RUNNING → (publish gate) → COMPLETED | PARTIAL | FAILED`; `QUEUED → CANCELLED`; `RUNNING (+cancel request) → CANCELLED`; any terminal state → rerun creates a new `QUEUED` run. **Publish gate:** the executor keeps engine results in memory and persists findings only after `UPDATE analyses SET published_at = NOW() … WHERE cancel_requested_at IS NULL` succeeded — a cancelled run therefore never publishes partial findings, and findings are written in deterministic work-unit order. Cancel requests after the gate are rejected (409). Guarded terminal writes (`status <> 'CANCELLED'`) make "cancel wins / publish wins" race-free. Every new run stores `analyses.inputs` (schema `AnalysisInputsSchema`, version 1), `knowledge_snapshot_id` (latest PUBLISHED at creation), `started_at`, and on failure `error_message`.

**Test Lab model (P6).** There are three kinds of test artefacts, with explicit links:
1. `tests` — *generated regression test specifications* written by the analysis GENERATING_TESTS stage (steps + expected result, one per evidence-backed BLOCKER/CRITICAL/MAJOR finding). Now carry `analysis_id` and `generator_version`.
2. `regression_test_cases` / `regression_test_runs` — the *executable* Test Lab (engine + rule + fixture artifact with SHA-256, expected outcome, runs, baseline, schedules).
3. `synthetic_scenarios` — the scenario lab (synthetic payloads).
Promotion turns (1) into (2) through the same code path as "finding → regression test" (`RegressionLabService.createFromFinding`), links both rows (`tests.regression_test_case_id` ↔ `regression_test_cases.generated_test_id`, unique ⇒ idempotent) and marks the generated test `PROMOTED`. The analysis detail page lists the generated tests of the run (promote button, "In Test Lab" + last run verdict); the Test Lab page lists all generated tests of the project and each promoted case shows "From run …" (its `originAnalysisId`).
Every Test Lab execution is recorded as an analysis (`LabAnalysisRecorder`): one `analyses` row per manual run, batch run, schedule firing or rerun, `kind = LAB_REGRESSION` (regression cases) or `LAB_SCENARIO` (scenario runs inside a project), inputs = test case ids / scenario id + fixture artifacts, stage progress, per-test engine calls in `orchestration.calls`, verdict summary in `orchestration.lab`; `regression_test_runs.analysis_id` links each test run. Status: every test executed → COMPLETED (FAILED verdicts are results, not errors), some errors → PARTIAL, all errors → FAILED. Lab runs never write `findings` rows, so every "latest analysis of a project" query (dashboard at-risk, drift default, work-item verification, traceability, SAP import, findings stats) reads only `kind IN ('STANDARD','FULL_PREFLIGHT')`; a lab run can't be the project baseline. Lab runs are cancellable between tests (and the in-flight engine call is aborted).

**Web:** `/projects/[id]/analyses/[analysisId]` (`components/analysis-run/*`, dictionary `app.analysisRun`, API client `lib/api/analysis-lifecycle.ts`). Linked from the project run history (Details + Test Lab badge), the project launcher and `/analyze` after a launch, the reports hub (per report) and notifications (`analysis.completed|failed`, `finding.critical` now deep-link to the run). Cancel and re-run use confirm dialogs (TanStack Form + Zod for the reason).

### 6.1 Internationalization (EN/DE, next-intl)

- **Routing:** public pages are locale-prefixed (`/en/...`, `/de/...`, `app/[locale]`, next-intl `localePrefix: 'always'`). Unprefixed public URLs (`/`, `/pricing`, …) redirect to the visitor's locale (cookie `erp_locale`, then `Accept-Language`, then `en`). Application routes (`/dashboard`, `/projects`, …) stay unprefixed; their locale comes from the `erp_locale` cookie. Rules: `apps/web/src/lib/routing.ts` + `src/middleware.ts`; next-intl config: `src/i18n/routing.ts`, `src/i18n/request.ts`.
- **Messages:** `src/i18n/messages/en.ts` is the reference; `de.ts` is typed as `Messages`, so missing/extra keys are compile errors. `__tests__/i18n.test.ts` also checks list lengths, ICU placeholders and that every message renders. ICU syntax (`{count}`); canonical SAP names (transactions, objects, engine names) are never translated. Human-written only — no machine translation.
- **Server components:** `const t = getT(locale); t('nav.pricing')`, structured content via `getMessages(locale)` (arrays/records), formatting via `getFormat(locale).number(...) / .dateTime(...)` — all from `@/i18n/translate`. Outside `app/[locale]`, get the locale with `await getRequestLocale()` from `@/i18n/server`.
- **Client components:** `const t = useT()`, `useLocale()`, `useMessages()`, `useFormatter()`, `useSetLocale()` from `@/i18n/client` (the root layout provides `NextIntlClientProvider`).
- **Links:** build public links with `localizePath(locale, '/pricing')`; the language switcher is `components/public/language-switcher.tsx`.
- **Adopting in an existing page:** add keys to `en.ts` and `de.ts` under a namespace for the page, replace literals with `t('<ns>.<key>')`; no other wiring is needed.
- **Authenticated app dictionaries:** app copy lives under the `app` namespace, one file per feature in `src/i18n/messages/app/{en,de}/<feature>.ts` (the DE file is typed `typeof En`), registered in `app/{en,de}/index.ts`. Use `t('app.<feature>.<key>')`. Keys must not contain dots (test-enforced); messages with inline markup end in `Rich` and are rendered with `useRichT()`; plurals use ICU (`{count, plural, one {…} other {…}}`).
- **Enum labels / errors / formats (client):** `useLabel()(group, code)` returns the translated label for an enum code or the code itself; `useErrorText()(error, fallback)` localizes API errors (known English server messages are mapped in `src/i18n/validation.ts`); `useFmt()` formats dates (viewer time zone), numbers, percent, bytes and currency for the active locale — never `toLocaleString('en-US')`.
- **Zod messages:** write `z.string().min(3, vmsg('app.validation.minChars', { min: 3 }))`; built-in Zod issues are localized by the error map installed in `i18n/client.tsx`, and `FormField` translates `vmsg` references.
- **Guards:** `__tests__/i18n-hardcoded-text.test.ts` fails on hardcoded English JSX text or user-facing attributes in `app/` and `components/` (allowlist and excluded paths at the top of the file). `scripts/e2e-i18n-smoke.cjs` (`pnpm smoke:i18n`, part of `ci-live-e2e.sh`) switches the navbar to German and checks every app page for raw keys, an English denylist and horizontal scroll at 375/1440 px. Mark proper names and authored/customer content with `translate="no"` so the denylist skips it.
- **Known gaps:** `app/integrations/**` and `components/integrations/**` (except `RemediationBadge`) and the analysis launcher/run history in `app/projects/[id]/page.tsx` still contain English literals; API error messages that are not mapped in `validation.ts`, and server-authored content (system templates, release notes), are shown as sent.
