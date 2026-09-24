# ERP Preflight — Hostinger VPS & Coolify End-to-End Deployment Runbook

> **Target Repository**: `https://github.com/enwecklerpro/erppreflight`  
> **Production Frontend**: `https://erppreflight.com`  
> **Production API & OpenAPI**: `https://api.erppreflight.com` / `https://api.erppreflight.com/api/v1/docs`  
> **Deployment Tooling**: Coolify v4+ on Hostinger KVM VPS (Ubuntu 22.04 / 24.04 LTS)

---

## 1. Architecture & Service Topology on Hostinger VPS

The entire ERP Preflight enterprise SaaS stack is orchestrated via `docker-compose.coolify.yml`. Coolify manages reverse proxying (Traefik), automatic Let's Encrypt SSL certificates, container health checks, and zero-downtime rolling updates.

```text
+-----------------------------------------------------------------------------------+
| Hostinger KVM VPS (Public IP)                                                     |
|                                                                                   |
|  Traefik Reverse Proxy (Coolify Gateway :80, :443)                                |
|    │                                                                              |
|    ├── Host: erppreflight.com, www.erppreflight.com (SSL: Let's Encrypt)          |
|    │     └──> web:3000 (Next.js 15 App Router, Base UI, TanStack Suite)           |
|    │                                                                              |
|    └── Host: api.erppreflight.com (SSL: Let's Encrypt)                            |
|          └──> api:3001 (NestJS 11 Core SaaS API, RLS Multi-Tenancy)               |
|                                                                                   |
|  Internal Docker Network (erppreflight-network — Isolated from Public Internet)   |
|    ├── analysis-python:8000 (Stateless Python 3.13 FastAPI — 18 SAP Engines + MFS)|
|    ├── postgres:5432 (PostgreSQL 16 + pgvector, RLS Policies, Persistent Volume)  |
|    ├── redis:6379 (Redis 7.2 Alpine, BullMQ Queues, Distributed Locks)            |
|    └── minio:9000 (MinIO S3-Compatible Storage: Quarantine, Clean & Reports)      |
+-----------------------------------------------------------------------------------+
```

---

## 2. Step 1: Hostinger VPS Provisioning

1. Log into your **Hostinger Control Panel** (hPanel) -> **VPS Management**.
2. Select your VPS instance (recommended: KVM 2 or KVM 4 with >= 8GB RAM, >= 2 vCPUs).
3. Ensure the operating system is set to **Ubuntu 24.04 LTS** (or Ubuntu 22.04 LTS).
4. Note your VPS **Public IPv4 Address** (e.g. `123.45.67.89`).
5. Connect via SSH:
   ```bash
   ssh root@<YOUR_HOSTINGER_VPS_IP>
   ```
6. Update packages and configure basic firewall:
   ```bash
   apt update && apt upgrade -y
   apt install -y curl ufw git
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw allow 8000/tcp   # Coolify Dashboard
   ufw --force enable
   ```

---

## 3. Step 2: Install Coolify on Hostinger VPS

Run the official automated Coolify installer:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

After 2–3 minutes, Coolify will be running. Open your browser and navigate to:
```
http://<YOUR_HOSTINGER_VPS_IP>:8000
```
Create your root admin account.

---

## 4. Step 3: Configure DNS Records for Your Domains

In Hostinger DNS Zone Management (or Cloudflare / your registrar):

| Type | Host | Points to | TTL |
|---|---|---|---|
| **A** | `@` (`erppreflight.com`) | `<YOUR_HOSTINGER_VPS_IP>` | 300 / Auto |
| **A** | `api` (`api.erppreflight.com`) | `<YOUR_HOSTINGER_VPS_IP>` | 300 / Auto |
| **CNAME** | `www` (`www.erppreflight.com`) | `erppreflight.com` | 300 / Auto |

---

## 5. Step 4: Deploying ERP Preflight in Coolify

### Option A: Direct Git / GitHub Deployment (Recommended)

1. In Coolify, navigate to **Projects** -> **New Project** (Name: `ERP Preflight Production`).
2. Add a new Resource -> **Docker Compose** -> **From Git Repository**.
3. Set the Git Repository URL:
   ```
   https://github.com/enwecklerpro/erppreflight
   ```
4. Set Branch: `main`.
5. Set Compose File Path:
   ```
   docker-compose.coolify.yml
   ```
6. Under **Environment Variables**, paste the contents of `.env.coolify.example`:
   ```bash
   NODE_ENV=production
   PORT=3001
   API_PORT=3001
   WEB_PORT=3000
   NEXT_PUBLIC_API_URL=https://api.erppreflight.com
   CORS_ORIGIN=https://erppreflight.com,https://www.erppreflight.com
   
   POSTGRES_DB=erppreflight
   POSTGRES_USER=erppreflight_user
   POSTGRES_PASSWORD=<GENERATE_SECURE_PASSWORD>
   DATABASE_URL=postgres://erppreflight_user:<GENERATE_SECURE_PASSWORD>@postgres:5432/erppreflight
   AUTO_MIGRATE=true
   
   REDIS_HOST=redis
   REDIS_PORT=6379
   REDIS_URL=redis://redis:6379
   
   ANALYSIS_SERVICE_URL=http://analysis-python:8000
   
   S3_ENDPOINT=http://minio:9000
   S3_ACCESS_KEY=<GENERATE_MINIO_KEY>
   S3_SECRET_KEY=<GENERATE_MINIO_SECRET>
   S3_REGION=us-east-1
   S3_BUCKET_QUARANTINE=erppreflight-quarantine
   S3_BUCKET_CLEAN=erppreflight-clean
   S3_BUCKET_REPORTS=erppreflight-reports
   
   JWT_SECRET=<GENERATE_STRONG_RANDOM_SECRET_64_CHARS>
   JWT_EXPIRES_IN=7d
   ```
7. Click **Deploy**.

Coolify will:
- Clone `https://github.com/enwecklerpro/erppreflight`
- Build the 3 container images using the multi-stage Dockerfiles in `infra/docker/`
- Launch `postgres`, `redis`, `minio`, `analysis-python`, `api`, and `web`
- Run database migrations automatically via `AUTO_MIGRATE=true` on API startup
- Provision Let's Encrypt TLS certificates for `erppreflight.com` and `api.erppreflight.com`

---

## 6. Step 5: Post-Deployment Verification

Execute these verification commands from your local machine or terminal:

```bash
# 1. Verify Web Frontend Liveness & Status
curl -i https://erppreflight.com/api/health
# Expected: HTTP 200 OK, {"status":"ok","service":"web",...}

# 2. Verify NestJS API Liveness
curl -i https://api.erppreflight.com/health/liveness
# Expected: HTTP 200 OK, {"status":"ok",...}

# 3. Verify NestJS API Readiness (checks DB & Redis connection)
curl -i https://api.erppreflight.com/health/readiness
# Expected: HTTP 200 OK, {"status":"ready","database":"healthy","redis":"healthy",...}

# 4. Verify OpenAPI Swagger Documentation
curl -i https://api.erppreflight.com/api/v1/docs
# Expected: HTTP 200 OK (Interactive Swagger UI)
```

---

## 7. Step 6: Backup & Disaster Recovery

### Automated PostgreSQL Backups
Coolify includes automated scheduled database dumps:
1. In Coolify, click on the `postgres` service under your project.
2. Go to **Backups** tab.
3. Enable **Automated Daily Backups** (e.g., at 03:00 UTC).
4. Optionally configure an external S3 bucket (AWS S3, Wasabi, or Backblaze B2) for off-site disaster recovery.

### Manual Backup Command
```bash
docker exec -t erppreflight-postgres pg_dump -U erppreflight_user erppreflight | gzip > erppreflight_backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

---

## 8. Summary Checklist for Release

- [x] Multi-stage non-root Dockerfiles created in `infra/docker/` (`Dockerfile.api`, `Dockerfile.web`, `Dockerfile.analysis`).
- [x] Standardized `docker-compose.coolify.yml` with health checks, persistent volumes, and Traefik SSL routing labels.
- [x] Environment variable template documented in `.env.coolify.example`.
- [x] Automated database migrations configured on container bootstrap (`AUTO_MIGRATE=true`).
- [x] Healthcheck endpoints operational (`/api/health` on web, `/health/liveness` & `/health/readiness` on API, `/health` on Python analysis).
- [x] DNS and Hostinger VPS deployment documented step-by-step.
