# ERP Preflight — Technical Architecture, Monorepo Map & Hostinger Deployment Guide
> **Document Purpose**: Authoritative handoff and onboarding specification for autonomous AI coding agents and enterprise engineers.  
> **Target Repository**: `https://github.com/enwecklerpro/erppreflight`  
> **Production Target**: Hostinger VPS (Ubuntu 22.04 / 24.04 LTS) with Coolify v4+ or Docker Compose  
> **Current Baseline**: Git branch `main`, verified zero-facade production truth  

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
│       └── tests/                  # 501 automated pytest unit & golden fixture tests
│
├── packages/
│   ├── database/                   # Drizzle ORM schema & client (Part 21.42 compliance)
│   │   ├── src/schema/             # 6 modular schema definitions (core, platform, templates, etc.)
│   │   ├── src/schema.ts           # Master export for all 25 tables + $inferSelect/$inferInsert
│   │   ├── src/client.ts           # pg.Pool with withTenantTransaction & getDrizzle() helper
│   │   ├── migrations/             # 9 canonical SQL migrations (001 to 009) — NOT under src/
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

Never deploy with default or empty secrets. Ensure these variables are populated in your `.env`:

```env
# Database
POSTGRES_DB=erppreflight
POSTGRES_USER=erppreflight
POSTGRES_PASSWORD=[SECURE_RANDOM_PASSWORD]

# Authentication & Encryption
JWT_SECRET=[GENERATE_64_CHAR_RANDOM_STRING]
ADMIN_BOOTSTRAP_PASSWORD=[STRONG_SUPERADMIN_PASSWORD]
MASTER_ENCRYPTION_KEY=[GENERATE_32_BYTE_HEX_KEY]

# Object Storage (MinIO)
S3_ACCESS_KEY=[MINIO_ADMIN_USERNAME]
S3_SECRET_KEY=[MINIO_ADMIN_STRONG_PASSWORD]

# Domains & Routing
NEXT_PUBLIC_API_URL=https://api.erppreflight.com
CORS_ORIGIN=https://erppreflight.com,https://api.erppreflight.com

# Antivirus Invariant
CLAMAV_MOCK_MODE=false
```

---

## 5. Developer & AI Agent Operations Cheatsheet

### 5.1 Local Development Commands

```bash
# Install all dependencies across the monorepo
pnpm install

# Database migrations: there is NO root `db:migrate` script.
# Migrations run automatically when the api container starts (api-entrypoint.sh).
# Locally, start postgres (docker compose) and the api; SQL lives in packages/database/migrations/.

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

Before committing any code or pushing changes to `main`, run this exact sequence:

```bash
# 1. TypeScript Strict Typecheck (Must report 0 errors across 13 packages)
pnpm run typecheck

# 2. TypeScript Unit & Integration Tests (Must pass 100%)
pnpm run test

# 3. Python Analysis Engines Pytest Suite (Must pass all 501 tests)
pnpm run test:python        # scripts/run-pytest.mjs: uses $PYTHON, python3, python or py
# Requires: pip install -r services/analysis-python/requirements.txt pytest pytest-asyncio hypothesis

# 4. Production Truth Gate (Verifies zero fake IDs, real HTTP handshakes)
pnpm run check:production-truth

# 5. Anti-Facade Linter (Blocks mock timeouts, swallowed errors, hardcoded data)
pnpm run check:no-production-facades

# 6. Full Monorepo Build (Next.js 15 SSR and NestJS compilation)
pnpm run build
```

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
