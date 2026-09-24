# ERP Preflight — Platform Architecture, Foundation, Ingestion, Multi-Tenancy & Deployment Specification

Authoritative Source: `H:/erppreflight/ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md` & `H:/erppreflight/.agents/ORIGINAL_REQUEST.md`  
Target Repository: `https://github.com/enwecklerpro/erppreflight`  
Production Domain: `https://erppreflight.com`  
Deployment Environment: Hostinger VPS via Coolify PaaS  
Spec Miner Agent: `spec_miner_survey_2`  
Timestamp: 2026-09-24T01:15:00Z  

---

## 1. Executive Summary & Core Architectural Principles

ERP Preflight is an enterprise-grade, multi-tenant B2B SaaS platform delivering preflight intelligence, clean core auditing, migration verification, and release intelligence for ERP transformations (primarily SAP ERP, SAP S/4HANA on-premise, and SAP S/4HANA Cloud).

### Core Architectural Mandates
1. **Deterministic-First Reliability Hierarchy**:
   Findings must follow an authoritative verification hierarchy:
   - Level 1: Exact parser/schema/config evidence
   - Level 2: Deterministic rule engine
   - Level 3: Static analysis / dependency graph analysis
   - Level 4: Official versioned knowledge record
   - Level 5: Probabilistic semantic matching
   - Level 6: LLM reasoning (strictly restricted to intent routing, semantic extraction, and plain-language summarization; never used to fabricate or guess technical verdicts)
   - Every finding carries an explicit provenance confidence class: `VERIFIED`, `RULE_DERIVED`, `INFERRED`, or `UNKNOWN`.
2. **Centralized Business & Tenancy Invariant**:
   The main backend (`apps/api` NestJS service) exclusively owns business state, tenant boundaries, billing entitlements, and transactional persistence in PostgreSQL. Analysis engines (`services/analysis-python`) receive normalized job payloads and return typed, structured findings without direct database mutation privileges.
3. **File-First Security & Privacy by Default**:
   All customer content is private by default. Customer data traverses an isolated multi-stage ingestion pipeline (MIME sniffing, quarantine scanning, archive decompression limits, secret/credential redaction, checksumming, and S3-compatible encrypted storage) before any parser or analysis worker touches it.
4. **Deployable Anywhere, Optimized for Coolify/Hostinger**:
   The entire system packages into clean, multi-stage, non-root Docker containers orchestrated by `docker-compose.coolify.yml` with automated database migrations, explicit liveness/readiness health probes, and persistent volumes.

---

## 2. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Monorepo | Turborepo + pnpm Workspace Layout | Monorepo structuring isolating `apps/` (`web`, `api`, `admin`, `docs`, `local-agent`), `services/` (`analysis-python`, `ai-gateway`, `search-indexer`, `knowledge-sync`), `engines/` (18 SAP engines), `packages/` (11 shared packages), `integrations/`, and `infra/`. | Monorepo configuration files (`pnpm-workspace.yaml`, `turbo.json`, `package.json`). | Coordinated build, test, and lint dependency graph across TypeScript and Python workspaces. | Build halts on dependency cycle, TypeScript compiler errors, or unpinned workspace protocol mismatches. | Spec Part 03 (§3.3), Part 14 (§14.66) |
| 2 | Monorepo | Next.js App Router Web Application | Modern responsive frontend (`apps/web`) using Next.js App Router, Tailwind CSS, shadcn/ui accessible components, TanStack Query, and Server Components for dashboard, workspaces, analysis inspector, and public SEO pages. | User actions, HTTP requests, SSE/WebSocket streams from API. | Interactive dashboards, SVG/Canvas dependency graphs, WCAG 2.2 AA compliant UI, SSR/SSG HTML. | Displays typed error boundaries, accessible empty states, and unauthorized redirect flows; no raw stack traces. | Spec Part 03 (§3.2), Part 14 (§14.24, §14.56) |
| 3 | Monorepo | NestJS Core API Backend | Enterprise TypeScript API service (`apps/api`) governing authentication, RBAC/PBAC, tenant context, project workspaces, job dispatching, OpenAPI generation, and webhook triggers. | REST requests (`/api/v1/...`), JWT/API key headers, webhook payloads. | JSON REST responses, OpenAPI 3.0 specification (`/api/v1/docs`), BullMQ job dispatches. | Emits standardized error payloads with Correlation Support IDs (`Support ID: ABC-XXX`); HTTP 400/401/403/404/422/500. | Spec Part 03 (§3.2, §3.6, §3.13), Part 14 (§14.69) |
| 4 | Monorepo | Python FastAPI Analysis Engine | Microservice (`services/analysis-python`) providing high-performance deterministic parsing, rule execution, and data frame operations using Pydantic v2, Polars/Pandas, and safe XML parsers. | Normalized analysis job JSON context (`tenantId`, `projectId`, `engine`, `artifacts`, `options`). | Typed analysis results JSON (`status`, `findings`, `metrics`, `evidence`, `artifacts`, `tests`). | Returns structured `status: "failed"` with parse error diagnostics or `UNKNOWN / INSUFFICIENT_EVIDENCE` status. | Spec Part 03 (§3.2, §3.5), Part 16 (§16.37) |
| 5 | Monorepo | Shared Schema Package (`packages/schemas`) | Centralized data contract library declaring schemas for `AnalysisJob`, `NormalizedArtifact`, `Finding`, `Evidence`, `KnowledgeObject`, `TestCase`, and `ChangeSet` using Zod and Pydantic. | Raw payloads, cross-service IPC messages. | Validated typed TypeScript interfaces and Python schema models. | Validation exception on schema mismatch with detailed field-level path errors. | Spec Part 03 (§3.5), Part 16 (§16.8) |
| 6 | Database | Canonical PostgreSQL Relational Schema | PostgreSQL relational database serving as the immutable system of record across SaaS accounts, billing, projects, uploaded files, findings, evidence, and release intelligence. | Migration SQL scripts, ORM mutations, transactional writes. | ACID-compliant relational tables with foreign keys, unique constraints, and cascade policies. | Transaction rollback on constraint violation; deadlocks avoided via strict acquisition ordering. | Spec Part 03 (§3.2), Part 04 (§4.1, §4.2) |
| 7 | Database | Forward Idempotent Migrations | Forward-only database migration system managed via automated migration runner during container startup. | Timestamped migration files in `packages/database/migrations`. | Synchronized PostgreSQL schema state recorded in `_migrations` tracking table. | Halts application container boot with non-zero exit code if migration fails; prevents dirty schema state. | Spec Part 04 (§4.1), Part 12 (§12.6), ORIGINAL_REQUEST R4 |
| 8 | Database | pgvector Semantic Indexing | PostgreSQL `pgvector` extension storing 1536-dimensional or 768-dimensional embeddings on `knowledge_objects` and `evidence_items` for similarity retrieval. | Text embeddings generated by AI gateway or embedding model. | Cosine similarity query results (`<=>` operator) indexed via HNSW / IVFFlat. | Graceful fallback to PostgreSQL full-text search (`tsvector`/`tsquery`) if vector dimension mismatch occurs. | Spec Part 03 (§3.2, §3.10), Part 04 (§4.13) |
| 9 | Multi-Tenancy | Row Level Security (RLS) Tenant Isolation | Database-level defense-in-depth isolation enforcing `tenant_id` / `organization_id` matching on every SQL query via session variables (`app.current_tenant_id`). | `SET LOCAL app.current_tenant_id = :orgId` injected per database transaction. | Filtered table views restricted strictly to the current tenant's rows. | Query returns empty set or raises permission violation if tenant context is unassigned or invalid. | Spec Part 04 (§4.1), Part 10 (§10.1, §10.18) |
| 10 | Multi-Tenancy | Customer Dependency Graph Segregation | Customer custom code, YY1 fields, Z-objects, transports, and custom forms are persisted with `is_global = FALSE` and tenant foreign key. | Customer SAP artifact metadata and parse graphs. | Scoped tenant dependency graph isolating custom objects from global SAP knowledge. | Strict query filter blocks leakage of customer graph nodes to any public search or other tenant workspace. | Spec Part 04 (§4.5), Part 14 (§14.46) |
| 11 | Multi-Tenancy | Tenant Resource Isolation & Rate Limiting | Noisy-neighbor mitigation enforcing per-tenant job concurrency, API rate limits, file size caps, and fair background scheduling. | API requests, upload streams, asynchronous job enqueues. | Enforced token bucket rate limits, HTTP 429 responses, prioritized queues. | HTTP 429 Too Many Requests; job rejected with plan quota exhaustion notice when limits exceeded. | Spec Part 10 (§10.5), Part 18 (§18.9, §18.10) |
| 12 | Multi-Tenancy | Complete Tenant Deletion Cascade | GDPR/offboarding workflow orchestrating complete purge across PostgreSQL, S3 storage, Redis caches, search indexes, and connector vaults. | Organization deletion request with confirmation receipt. | Deletion audit receipt, complete scrub of all tenant data. | Incomplete deletion halts and alerts admin; locks tenant to prevent partial orphan data. | Spec Part 18 (§18.25, §18.26) |
| 13 | Redis | BullMQ Asynchronous Job Queuing | Redis-backed BullMQ job queues orchestrating multi-stage preflight jobs, quarantine scans, and report exports with progress tracking. | Job payloads (`analysis-queue`, `ingestion-queue`, `export-queue`). | Enqueued job IDs, execution state transitions (`waiting`, `active`, `completed`, `failed`). | Auto-retry with exponential backoff; dead-letter queue (DLQ) after configured retry limit (e.g. 3 attempts). | Spec Part 03 (§3.2, §3.8), Part 16 (§16.6) |
| 14 | Redis | Distributed Locking & Idempotency Keys | Redlock and Redis mutex locks using unique idempotency keys (`idempotency:{key}`) for file uploads, webhook events, and billing charges. | Idempotency key HTTP headers (`Idempotency-Key: <UUID>`), webhook signatures. | Atomically acquired locks; cached previous results returned for repeated calls. | Concurrent duplicate requests receive HTTP 409 Conflict or wait until lock owner finishes. | Spec Part 03 (§3.14), Part 10 (§10.4) |
| 15 | Redis | Real-time Analysis Progress Streaming | Pub/Sub streaming of analysis progress milestones (`analysis:{id}:progress`) to SSE / WebSocket gateways on the web frontend. | Engine execution milestone events (`parsing`, `graph_build`, `rule_eval`, `report_gen`). | Real-time progress bar and stage updates on user interface without HTTP polling. | Connection dropped triggers automatic client reconnect with exponential backoff and REST poll fallback. | Spec Part 03 (§3.8), Part 14 (§14.33) |
| 16 | Ingestion | File Format & Magic Bytes Validation | Content inspection and MIME sniffing validating uploaded files against strict whitelists (XML, JSON, CSV, ZIP, ABAP, XLSX, EDMX, XSD, XDP). | Uploaded file binary stream. | Detected MIME type, verified format classification, normalized artifact family. | Rejection with HTTP 422 Unprocessable Entity for spoofed extensions or unwhitelisted MIME types. | Spec Part 03 (§3.7), Part 05 (§5.7), Part 10 (§10.18) |
| 17 | Ingestion | Temporary Quarantine Pipeline | Isolated staging area where uploaded files reside until malware scanning, archive verification, and content safety checks pass. | Raw uploaded byte streams. | Quarantined file record with status transitions: `PENDING_SCAN` -> `CLEAN` or `QUARANTINED`. | Quarantined files are isolated from parsers, logged to security audit log, and tenant is notified. | Spec Part 03 (§3.7), Part 10 (§10.18) |
| 18 | Ingestion | Archive Decompression & Parser Safety | Protection against Zip Bombs, Zip Slip (path traversal), nested archives (>2 levels), XXE, and Billion Laughs XML expansions. | Archive streams (ZIP), XML documents (`defusedxml`, `lxml`). | Safely unpacked files within bounded memory and disk quotas (<500MB extracted, <100:1 ratio). | Throws `ArchiveSecurityException` or `XmlSecurityException`; aborts extraction; flags file as malicious. | Spec Part 10 (§10.18), Part 14 (§14.18) |
| 19 | Ingestion | Secret & Credential Redaction Engine | Automated entropy and regex scanner redacting Authorization headers, API keys, passwords, private keys, connection strings, and SAP RFC secrets. | Raw artifact text, logs, configuration files, XML/JSON payloads. | Sanitized text with redacted placeholders (e.g. `[REDACTED_API_KEY]`) and redaction metadata records. | Analysis runs on redacted text without leakage; audit record stores offset and redacted pattern type. | Spec Part 03 (§3.7), Part 05 (§5.8), Part 10 (§10.17) |
| 20 | Ingestion | Pre-signed Short-Lived S3 Storage URLs | Direct S3 upload and download orchestration using short-lived cryptographically signed URLs (TTL: 15 to 60 minutes). | Upload intent request (`fileName`, `fileSize`, `mimeType`, `projectId`). | Pre-signed PUT/GET URLs generated via AWS S3 / MinIO SDK. | Expired URLs return HTTP 403 Forbidden; tampered signatures rejected by S3 storage gateway. | Spec Part 03 (§3.7), Part 10 (§10.16), ORIGINAL_REQUEST R3 |
| 21 | Export | Multi-Format Preflight Export Engine | Report generation service transforming structured project findings into high-fidelity PDF, JSON, CSV, and XLSX deliverables. | Project analysis ID, user export options, template configuration. | Downloadable preflight assessment reports, traceability matrices, or raw JSON bundles. | Generates audit log on export; fails gracefully with user notification if export engine times out. | Spec Part 05 (§5.9), Part 14 (§14.11, §14.45), ORIGINAL_REQUEST R3 |
| 22 | Export | White-Label Report Customization | Customizable report branding for enterprise and consulting partners (logo, cover page, company details, disclaimer). | Organization branding assets (PNG/SVG logo, header/footer styling, contact metadata). | Customized PDF and HTML reports retaining underlying ERP Preflight evidence provenance. | Invalid logo dimensions or malicious SVG payloads rejected during upload validation. | Spec Part 14 (§14.45) |
| 23 | Deployment | Coolify Multi-Container Orchestration | `docker-compose.coolify.yml` orchestrating web, api, analysis-python, postgresql, and redis with private Docker network and persistent volumes. | Compose environment variables (`.env.example`), Coolify application webhook. | Automated multi-container runtime with persistent volumes (`postgres_data`, `redis_data`, `storage_data`). | Zero crash loops; containers restart automatically (`restart: unless-stopped`) on transient failure. | Spec Part 03 (§3.2), ORIGINAL_REQUEST R4 |
| 24 | Deployment | Multi-Stage Non-Root Dockerfiles | Hardened container images utilizing multi-stage builds, non-root system users (`UID 10001`), and minimal base images (`alpine` / `debian-slim`). | Source code trees, dependency lockfiles (`pnpm-lock.yaml`, `requirements.txt`). | Lean, hardened production container images stripped of development tools and secrets. | Build fails on unpinned dependencies; runtime container cannot execute privileged root commands. | Spec Part 12 (§12.4), Part 20 (§20.8), ORIGINAL_REQUEST R4 |
| 25 | Deployment | Standardized Health Check Probes | Unified `/health/liveness` and `/health/readiness` endpoints across web, api, and analysis-python services. | HTTP GET probes from Coolify, Traefik, or Docker healthcheck daemon. | HTTP 200 OK with dependency connectivity payload or HTTP 503 Service Unavailable with diagnostic status. | Unhealthy containers removed from ingress routing within 60s; triggers Coolify alert if failed. | Spec Part 12 (§12.10), ORIGINAL_REQUEST R4 |
| 26 | Deployment | Automated Startup Database Migration Runner | Idempotent migration execution script run on API container boot prior to traffic ingress, with connection polling for PostgreSQL. | Database connection string, migration scripts in `packages/database/migrations`. | Schema synchronized up to current release; seeds essential catalog data. | Container halts and prevents traffic ingress if migrations fail; retry loop prevents race condition during boot. | Spec Part 12 (§12.6), ORIGINAL_REQUEST R4 |
| 27 | Deployment | Typed Environment Variable Matrix | Validated `.env.example` documenting all configuration keys for database, redis, storage, auth secrets, and Coolify domains. | Environment configuration file (`.env`). | Type-safe configuration object validated at application boot via Zod. | Process terminates immediately on startup with explicit error message if required keys are missing or invalid. | Spec Part 03 (§3.16), ORIGINAL_REQUEST R4 |

---

## 3. Edge Cases & Observed System Behaviors

| # | Feature | Input / Trigger | Observed Behavior |
|---|---------|-----------------|-------------------|
| 1 | File Ingestion | Upload of `malicious.xml` containing recursive entity definitions (`<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">...`) | Parser catches entity expansion limit via `defusedxml.common.EntitiesForbidden` exception; parsing terminates immediately; quarantine logs security event; user receives `422 Unprocessable Entity: Malicious XML entity detected`. |
| 2 | File Ingestion | Upload of `repo.zip` containing path traversal filenames (`../../../../etc/passwd`) | Archive extractor canonicalizes target path; detects extracted path resolves outside designated quarantine directory; aborts extraction; flags upload as `QUARANTINED`; records path traversal attempt in audit log. |
| 3 | File Ingestion | Upload of a 10KB zip file that decompresses into a 100GB null-byte stream (Zip Bomb) | Extraction stream reader monitors cumulative uncompressed byte count; exceeds maximum extraction threshold (500MB) or 100:1 ratio; immediately aborts decompressor; discards partial files; returns `413 Payload Too Large`. |
| 4 | File Ingestion | Renamed executable file `malware.exe` uploaded as `sap_export.csv` | File sniffer inspects file header magic bytes; detects `MZ` header (Windows PE) instead of text/csv; validation fails before quarantine scan; returns `422 Unprocessable Entity: Content does not match CSV format`. |
| 5 | Ingestion Redaction | Uploaded transport log containing active RFC connection string with embedded password (`RFC_USER=SAP_EXT; RFC_PASS=P@ssw0rd123!; HOST=sap.corp`) | Redaction engine matches RFC password pattern; replaces value with `RFC_PASS=[REDACTED_SECRET_PASSWORD]`; generates redaction offset metadata; analysis engine receives sanitized log and flags credentials were found and redacted. |
| 6 | Database RLS | Rogue query attempt or tenant API bug attempting to query project belonging to another organization (`SELECT * FROM projects WHERE id = 'other-org-proj'`) | PostgreSQL Row Level Security policy evaluates `organization_id = current_setting('app.current_tenant_id')::uuid`; since `organization_id` does not match session variable, database returns empty result set (0 rows); API returns `404 Not Found`. |
| 7 | Multi-Tenancy | Organization deletion request executed while background analysis jobs for that organization are active in BullMQ | Tenant deletion orchestrator flags organization as `SUSPENDED_DELETION`; sends job cancellation signals to active BullMQ worker; workers abort execution and remove temp files; database rows, S3 bucket artifacts, and Redis keys are purged; audit receipt is emitted. |
| 8 | BullMQ Queues | Worker container crashes or gets killed via OOM killer while processing a 200MB MFS log analysis | BullMQ stalled job watchdog detects absence of heartbeat; marks job as stalled; moves job back to `waiting` state up to retry limit (e.g. 2 retries); if retry limit exceeded, moves to Dead Letter Queue (DLQ) and marks analysis run as `FAILED` with diagnostics. |
| 9 | Idempotency | User double-clicks "Run Analysis" button, triggering two simultaneous identical `POST /api/v1/projects/:id/analyses` requests with the same `Idempotency-Key` | First request acquires Redis lock `idempotency:run_analysis:<key>`; second request fails to acquire lock, waits on result cache or returns `409 Conflict: Analysis request already in progress`; exactly one analysis job is queued. |
| 10 | pgvector Search | User executes semantic search query, but vector embeddings for some newly imported knowledge objects are pending generation | Hybrid search engine queries PostgreSQL `tsvector` full-text search combined with available vector cosine similarity (`<=>`); returns relevant keyword matches and flags results as partial semantic match; queues missing embeddings for background generation. |
| 11 | Health Probes | Redis container experiences network timeout or goes down while PostgreSQL and API remain running | `/health/liveness` continues to return HTTP 200 OK (container is alive); `/health/readiness` returns HTTP 503 Service Unavailable (`{"status":"degraded","redis":"disconnected","database":"connected"}`); Coolify proxy temporarily pauses traffic ingress until Redis reconnects. |
| 12 | Database Migrations | API container boots up before PostgreSQL container has completed its initial initialization | Migration entrypoint script runs connection retry loop (`pg_isready -h postgresql -p 5432` with 5s backoff, max 12 retries); waits until PostgreSQL accepts connections; runs migrations idempotently; avoids container crash loop. |
| 13 | S3 Storage | Client attempts to download an expired signed URL (TTL elapsed past 60 minutes) | S3 gateway / MinIO returns HTTP 403 Forbidden with `RequestTimeTooSkewed` or `AccessDenied: Signature expired`; web app catches 403, requests a fresh signed URL from the API backend with tenant authentication, and seamlessly retries download. |
| 14 | Export Engine | User requests PDF export with white-label branding containing an invalid or corrupt SVG logo | Image preflight validator detects malformed SVG XML or malicious embedded `<script>` tags; rejects custom logo; falls back to default clean corporate text header; logs validation warning; completes PDF generation cleanly. |
| 15 | AI Gateway | AI provider (OpenAI/Anthropic) returns HTTP 429 Rate Limit or HTTP 500 Outage during analysis explanation generation | AI Gateway catches provider error; attempts configured fallback provider; if all external AI providers fail, engine falls back to deterministic-only mode; returns verified rule findings without AI prose; marks explanation as `UNAVAILABLE_AI_OFFLINE`. |

---

## 4. In-Depth Technical Architecture & Implementation Blueprint

```
                      +-------------------------------------------------------+
                      |               Hostinger VPS / Coolify                 |
                      +-------------------------------------------------------+
                                                 |
                                     (HTTP / HTTPS Ingress)
                                                 v
                      +-------------------------------------------------------+
                      |                  Traefik Reverse Proxy                |
                      +-------------------------------------------------------+
                                 |                                 |
                        (Port 3000)                               (Port 4000)
                                 v                                 v
    +--------------------------------------+      +--------------------------------------+
    |              apps/web                |      |              apps/api                |
    |          (Next.js Frontend)          | ---> |          (NestJS Backend)            |
    |  - App Router, Tailwind, Radix UI    |      |  - Auth, Multi-Tenancy (RLS)         |
    |  - Universal Inspector, Command Bar  |      |  - BullMQ Queue Producer             |
    |  - Non-root Container (User 10001)   |      |  - OpenAPI, Migration Runner         |
    +--------------------------------------+      +--------------------------------------+
                                                               |              |
                                        (Internal Job Payload) |              | (Direct SQL / RLS)
                                                               v              v
    +--------------------------------------+      +--------------------------------------+
    |       services/analysis-python       |      |          postgresql-pgvector         |
    |        (FastAPI Analysis Core)       |      |          (PostgreSQL 16 + Vec)       |
    |  - Deterministic Parsers, Polars     |      |  - Multi-tenant Schema               |
    |  - 18 SAP Engines, defusedxml        |      |  - Knowledge Graph, Evidence         |
    |  - Non-root Container (User 10001)   |      |  - Vector Embeddings (1536/768)      |
    +--------------------------------------+      +--------------------------------------+
                                                               |              |
                                                               |              |
                                                               v              v
    +--------------------------------------+      +--------------------------------------+
    |              redis-cache             |      |             minio-storage            |
    |              (Redis 7)               |      |         (S3-Compatible Object)       |
    |  - BullMQ Queues, Job Locks          |      |  - Quarantined & Approved Buckets    |
    |  - Progress Pub/Sub, Rate Limits     |      |  - Short-lived Signed URLs           |
    +--------------------------------------+      +--------------------------------------+
```

### 4.1 Monorepo Architecture & Directory Layout

The platform is structured as an enterprise monorepo using **pnpm workspaces** and **Turborepo** (`turbo.json`).

```text
erppreflight/
├── apps/
│   ├── web/                    # Next.js 14/15 App Router web app (React, TypeScript, Tailwind)
│   ├── api/                    # NestJS API backend (REST, BullMQ, Auth, OpenAPI, Webhooks)
│   ├── admin/                  # Super Admin console (Operational metrics, Knowledge curation)
│   ├── docs/                   # Developer & customer documentation portal
│   └── local-agent/            # Dockerized customer-network collection agent (mTLS outbound)
├── services/
│   ├── analysis-python/        # Python 3.11/3.12 FastAPI microservice (deterministic analysis)
│   ├── ai-gateway/             # Pluggable LLM gateway (OpenAI, Anthropic, Google, local)
│   ├── search-indexer/         # Background indexing worker (PostgreSQL FTS + pgvector)
│   └── knowledge-sync/         # SAP release metadata sync crawler and conflict resolver
├── engines/                    # 18 SAP Deterministic Preflight Engines
│   ├── opd/                    # Output Parameter Determination engine
│   ├── forms/                  # FormDoctor layout & XML data path tracer
│   ├── custom-fields/          # Custom Field Flow Doctor (YY1 field propagation)
│   ├── spro2cloud/             # SPRO to SSCUI/CBC migration mapping engine
│   ├── ecc2cloud/              # ECC to S/4HANA Cloud transition navigator
│   ├── gap-radar/              # Clean core gap radar & successor analyzer
│   ├── clean-core/             # Clean Core object compliance guard
│   ├── change-pointer/         # Change pointer coverage & trigger auditor
│   ├── api-change/             # API contract change & breaking diff guard
│   ├── transport/              # Software collection & transport dependency analyzer
│   ├── extension-impact/       # Extension impact blast radius calculator
│   ├── decommission/           # Safe decommission preflight validator
│   ├── fiori403/               # Fiori 403 authorization & catalog doctor
│   ├── workflow/               # Stuck workflow explainer & event linkage checker
│   ├── iam-cost/               # IAM licensing & authorization cost optimizer
│   ├── account-determination/  # Financial account determination verifier
│   ├── system-refresh/         # System refresh delta guard & config drift detector
│   └── mfs/                    # Warehouse automation telegram stream analyzer
├── packages/                   # Shared TypeScript Packages
│   ├── ui/                     # Accessible UI components (Radix primitives, Tailwind)
│   ├── schemas/                # Shared Zod / JSON schemas & contract types
│   ├── database/               # PostgreSQL schema, migrations, connection pool, RLS
│   ├── auth/                   # Authentication, RBAC/PBAC guards, JWT, API keys
│   ├── tenancy/                # Multi-tenancy middleware, AsyncLocalStorage context
│   ├── audit/                  # Tamper-evident cryptographic audit logging
│   ├── billing/                # Stripe adapter, entitlement verification, quotas
│   ├── evidence/               # Evidence engine, trust scoring, release validity
│   ├── jobs/                   # BullMQ job queue definitions & worker helpers
│   ├── logging/                # Structured JSON logging with Correlation Support IDs
│   └── config/                 # Validated configuration & environment loader
├── integrations/               # Open Source & SAP Connectors
│   ├── rosa/                   # Read-Only SAP Adapter
│   ├── cloudification/         # Cloudification repository mapper
│   ├── abaplint/               # ABAP parsing & AST analysis adapter
│   ├── abapgit/                # abapGit repository export parser
│   ├── oasdiff/                # OpenAPI contract breaking change diff engine
│   ├── odata/                  # OData metadata & EDMX parser
│   ├── gitleaks/               # Credential & secret leak scanner
│   ├── sap-cloud-sdk/          # SAP BTP Cloud SDK connectivity adapter
│   └── mfs-simulator/          # Warehouse automation sequence simulator
├── infra/                      # Infrastructure & Deployment Assets
│   ├── docker/                 # Production Dockerfiles (multi-stage non-root)
│   │   ├── web.Dockerfile
│   │   ├── api.Dockerfile
│   │   └── analysis.Dockerfile
│   ├── coolify/                # Coolify deployment orchestration
│   │   └── docker-compose.coolify.yml
│   ├── terraform/              # Cloud production infrastructure
│   └── monitoring/             # Prometheus alert rules, Grafana dashboards
├── docs/                       # Architecture Decisions (ADRs) & Runbooks
│   ├── adr/
│   └── runbooks/
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

### 4.2 PostgreSQL Database Schema, Migrations & pgvector

PostgreSQL 16 serves as the canonical system of record. Every business table includes `organization_id` for multi-tenant data isolation.

#### Core SaaS Entities
1. `organizations`: Tenant root record (`id UUID PRIMARY KEY`, `name TEXT`, `slug TEXT UNIQUE`, `plan_id UUID`, `region TEXT`, `data_policy JSONB`, `created_at TIMESTAMPTZ`).
2. `users`: Global authentication record (`id UUID PRIMARY KEY`, `email TEXT UNIQUE`, `password_hash TEXT`, `status TEXT`, `created_at TIMESTAMPTZ`).
3. `organization_members`: Junction table establishing tenant membership (`id UUID`, `organization_id UUID`, `user_id UUID`, `role TEXT`, `permissions JSONB`).
4. `projects`: Workspace container for analyses (`id UUID`, `organization_id UUID`, `name TEXT`, `slug TEXT`, `target_release TEXT`, `baseline_analysis_id UUID`).
5. `project_environments`: Deployment stages (`id UUID`, `project_id UUID`, `name TEXT` [DEV, TEST, QA, PREPROD, PROD], `is_production BOOLEAN`).
6. `uploaded_files`: Metadata for incoming customer artifacts (`id UUID`, `organization_id UUID`, `project_id UUID`, `file_name TEXT`, `file_size BIGINT`, `mime_type TEXT`, `storage_path TEXT`, `checksum_sha256 TEXT`, `quarantine_status TEXT`, `redaction_status TEXT`).
7. `normalized_artifacts`: Standardized engine inputs (`id UUID`, `uploaded_file_id UUID`, `organization_id UUID`, `artifact_type TEXT`, `content_hash TEXT`, `parsed_payload JSONB`).
8. `analyses`: Execution record (`id UUID`, `organization_id UUID`, `project_id UUID`, `environment_id UUID`, `status TEXT`, `requested_by UUID`, `trigger_type TEXT`).
9. `analysis_runs`: Per-engine execution metrics (`id UUID`, `analysis_id UUID`, `engine TEXT`, `engine_version TEXT`, `rule_version TEXT`, `status TEXT`, `started_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ`).
10. `findings`: Preflight discoveries (`id UUID`, `organization_id UUID`, `project_id UUID`, `analysis_run_id UUID`, `engine TEXT`, `code TEXT`, `title TEXT`, `severity TEXT` [LOW, MEDIUM, HIGH, CRITICAL], `confidence_class TEXT` [VERIFIED, RULE_DERIVED, INFERRED, UNKNOWN], `message TEXT`, `technical_details JSONB`, `affected_objects JSONB`, `fingerprint TEXT`).
11. `evidence_items`: Provenance records (`id UUID`, `finding_id UUID`, `knowledge_object_id UUID`, `source_type TEXT`, `source_url TEXT`, `source_title TEXT`, `publisher TEXT`, `trust_level TEXT`, `excerpt_hash TEXT`, `embedding vector(1536)`).
12. `audit_events`: Tamper-evident log (`id UUID`, `organization_id UUID`, `actor_id UUID`, `action TEXT`, `target_type TEXT`, `target_id UUID`, `prev_hash TEXT`, `current_hash TEXT`, `created_at TIMESTAMPTZ`).

#### Knowledge Graph Entities
1. `knowledge_objects`: Global SAP definitions (`id UUID PRIMARY KEY`, `name TEXT`, `type TEXT`, `component TEXT`, `package TEXT`, `is_global BOOLEAN DEFAULT TRUE`, `embedding vector(1536)`).
2. `knowledge_object_versions`: Release-specific support status (`id UUID`, `knowledge_object_id UUID`, `release TEXT`, `support_state TEXT`, `successor_id UUID`).
3. `object_relationships`: Graph edges (`id UUID`, `source_id UUID`, `target_id UUID`, `relationship TEXT`, `valid_from_release TEXT`, `valid_to_release TEXT`, `confidence TEXT`, `is_global BOOLEAN`).

#### pgvector Extension & Indexing
```sql
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW Index for sub-millisecond semantic retrieval
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_embedding 
ON knowledge_objects 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_evidence_items_embedding 
ON evidence_items 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

#### Row Level Security (RLS) Implementation
```sql
-- Enable RLS on business tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;

-- Tenant Isolation Policy
CREATE POLICY tenant_isolation_projects ON projects
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_files ON uploaded_files
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_findings ON findings
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```

---

### 4.3 Secure Ingestion Pipeline

The file ingestion pipeline guarantees that malicious, malformed, or sensitive data cannot penetrate the application or compromise tenant privacy.

```text
Incoming File Stream
       │
       ▼
1. Tenant Authorization & Quota Verification
       │
       ▼
2. Temporary Quarantine Storage (`quarantine/{tenantId}/{fileId}`)
       │
       ▼
3. MIME & Magic Bytes Validation (libmagic file-type inspection)
       │
       ▼
4. Archive & Parser Security Filter
   ├── Zip Bomb Protection (Max 500MB uncompressed, Max 100:1 ratio)
   ├── Zip Slip Protection (Disallow '../' traversal)
   ├── Archive Nesting Cap (Max depth: 2)
   └── XML Defense (defusedxml: resolve_entities=False, load_dtd=False)
       │
       ▼
5. Antivirus / Malware Quarantine Scan (ClamAV)
       │
       ▼
6. Secret & Credential Redaction Engine
   ├── Authorization / Bearer tokens
   ├── Private Keys (RSA, EC, PGP)
   ├── API Keys & Cloud Secrets
   └── SAP RFC Credentials
       │
       ▼
7. SHA-256 Checksum Calculation
       │
       ▼
8. Encrypted Object Storage Transition (`tenants/{tenantId}/projects/{projectId}/...`)
       │
       ▼
9. Artifact Normalization & Engine Execution
```

#### Secret Redaction Engine Specification
The redaction engine executes regex and entropy evaluation across raw text lines before persistence:
- Authorization: `(?i)(bearer\s+[a-z0-9\-_\.=]+)` -> `[REDACTED_BEARER_TOKEN]`
- Private Keys: `(?s)-----BEGIN [A-Z ]+PRIVATE KEY-----.*?-----END [A-Z ]+PRIVATE KEY-----` -> `[REDACTED_PRIVATE_KEY]`
- Passwords: `(?i)(password|passwd|pwd|rfc_pass)\s*[:=]\s*['"][^'"]+['"]` -> `[REDACTED_PASSWORD]`
- API Keys: `(?i)(api[_-]?key|secret[_-]?key)\s*[:=]\s*['"][a-z0-9\-_\.]{16,}['"]` -> `[REDACTED_API_KEY]`

---

### 4.4 Redis Queuing, Caching & Coordination

Redis 7 serves as the distributed concurrency and coordination layer:

1. **BullMQ Queues**:
   - `ingestion-queue`: Coordinates quarantine checks, malware scanning, and artifact normalization.
   - `analysis-queue`: Dispatches normalized analysis job contexts to Python analysis workers.
   - `export-queue`: Asynchronously generates PDF, CSV, and XLSX preflight reports.
   - `notification-queue`: Dispatches transactional emails, in-app notifications, and webhooks.
2. **Idempotency Locks (Redlock)**:
   - File uploads and analysis runs require an `Idempotency-Key` header.
   - Lock key: `lock:idempotency:{tenantId}:{key}` with a TTL of 60 seconds.
3. **Real-time Progress Streaming**:
   - Analysis execution milestones are published to Redis Pub/Sub: `channel:analysis:{analysisId}:progress`.
   - NestJS API subscribes and bridges events to connected frontend clients via Server-Sent Events (SSE) `/api/v1/analyses/:id/stream`.

---

### 4.5 Hostinger & Coolify End-to-End Deployment

#### Production Architecture on Coolify
Coolify orchestrates containers over a unified internal bridge network (`erppreflight-net`), routing public HTTP/HTTPS traffic through Traefik reverse proxy to the `web` and `api` services.

#### Multi-Stage Non-Root Dockerfiles

##### 1. Next.js Web Frontend (`infra/docker/web.Dockerfile`)
```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/ui/package.json ./packages/ui/
RUN pnpm install --frozen-lockfile --filter @erppreflight/web...

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm --filter @erppreflight/web build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 10001 nodejs && \
    adduser --system --uid 10001 nextjs
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/liveness || exit 1
CMD ["node", "server.js"]
```

##### 2. NestJS Core API (`infra/docker/api.Dockerfile`)
```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/
COPY packages/schemas/package.json ./packages/schemas/
RUN pnpm install --frozen-lockfile --filter @erppreflight/api...

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @erppreflight/api build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
RUN apk add --no-cache curl postgresql-client
RUN addgroup --system --gid 10001 apigroup && \
    adduser --system --uid 10001 apiuser
COPY --from=builder --chown=apiuser:apigroup /app ./
USER apiuser
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
  CMD curl -f http://localhost:4000/health/liveness || exit 1
CMD ["./apps/api/entrypoint.sh"]
```

##### 3. Python FastAPI Analysis Engine (`infra/docker/analysis.Dockerfile`)
```dockerfile
FROM python:3.11-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc libxml2-dev libxslt-dev \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY services/analysis-python/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl libxml2 libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 10001 appgroup && \
    useradd -u 10001 -g appgroup -s /bin/sh appuser
COPY --from=builder /opt/venv /opt/venv
COPY services/analysis-python /app
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=20s \
  CMD curl -f http://localhost:8000/health/liveness || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

#### Coolify Docker Compose Configuration (`infra/coolify/docker-compose.coolify.yml`)
```yaml
version: '3.8'

networks:
  erppreflight-net:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  minio_data:

services:
  postgresql:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-erppreflight}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Database password required}
      POSTGRES_DB: ${POSTGRES_DB:-erppreflight_prod}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - erppreflight-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-erppreflight}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD:?Redis password required}"]
    volumes:
      - redis_data:/data
    networks:
      - erppreflight-net
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:RELEASE.2024-05-10T01-41-38Z
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY:?S3 access key required}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY:?S3 secret key required}
    volumes:
      - minio_data:/data
    networks:
      - erppreflight-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: ../..
      dockerfile: infra/docker/api.Dockerfile
    restart: unless-stopped
    environment:
      PORT: 4000
      DATABASE_URL: postgres://${POSTGRES_USER:-erppreflight}:${POSTGRES_PASSWORD}@postgresql:5432/${POSTGRES_DB:-erppreflight_prod}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      ANALYSIS_SERVICE_URL: http://analysis-python:8000
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
      S3_BUCKET: ${S3_BUCKET:-erppreflight-artifacts}
      JWT_SECRET: ${JWT_SECRET:?JWT Secret required}
      SESSION_SECRET: ${SESSION_SECRET:?Session secret required}
      CORS_ORIGIN: ${WEB_URL:-https://erppreflight.com}
    depends_on:
      postgresql:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - erppreflight-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health/liveness"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  analysis-python:
    build:
      context: ../..
      dockerfile: infra/docker/analysis.Dockerfile
    restart: unless-stopped
    environment:
      PYTHONUNBUFFERED: "1"
    networks:
      - erppreflight-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health/liveness"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  web:
    build:
      context: ../..
      dockerfile: infra/docker/web.Dockerfile
    restart: unless-stopped
    environment:
      NEXT_PUBLIC_API_URL: ${API_URL:-https://api.erppreflight.com}
    depends_on:
      api:
        condition: service_healthy
    networks:
      - erppreflight-net
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health/liveness"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
```

#### Automated Database Migration Runner (`apps/api/entrypoint.sh`)
```bash
#!/bin/sh
set -e

echo "==> [ERP Preflight] Checking PostgreSQL availability..."
until pg_isready -h postgresql -p 5432 -U "${POSTGRES_USER:-erppreflight}"; do
  echo "==> [ERP Preflight] Waiting for PostgreSQL to become ready..."
  sleep 2
done

echo "==> [ERP Preflight] Running idempotent database migrations..."
pnpm run db:migrate:deploy

echo "==> [ERP Preflight] Seeding essential system catalogs if unpopulated..."
pnpm run db:seed:catalogs

echo "==> [ERP Preflight] Starting NestJS core API backend..."
exec node dist/main.js
```

#### Standardized Health Check Endpoints
Each service provides two distinct health probes:
1. **Liveness Probe (`/health/liveness`)**:
   - Status: HTTP 200 OK
   - Response: `{"status":"ok","timestamp":"2026-09-24T01:15:00Z"}`
   - Purpose: Validates that the event loop is active and the container process is responsive.
2. **Readiness Probe (`/health/readiness`)**:
   - Status: HTTP 200 OK (or HTTP 503 if any dependency check fails)
   - Response:
     ```json
     {
       "status": "ready",
       "services": {
         "database": { "status": "up", "latencyMs": 4 },
         "redis": { "status": "up", "latencyMs": 1 },
         "storage": { "status": "up", "latencyMs": 12 },
         "analysisEngine": { "status": "up", "latencyMs": 15 }
       },
       "timestamp": "2026-09-24T01:15:00Z"
     }
     ```
   - Purpose: Coolify and Traefik direct traffic only to containers reporting readiness.

#### Comprehensive Environment Configuration (`.env.example`)
```bash
# ==============================================================================
# ERP Preflight — Environment Configuration Matrix (.env.example)
# ==============================================================================

# Application & Hostinger / Coolify Ingress
NODE_ENV=production
PORT=4000
WEB_PORT=3000
API_URL=https://api.erppreflight.com
WEB_URL=https://erppreflight.com
COOLIFY_FQDN=erppreflight.com
CORS_ORIGIN=https://erppreflight.com

# PostgreSQL Database & pgvector
POSTGRES_USER=erppreflight
POSTGRES_PASSWORD=replace_with_strong_random_db_password
POSTGRES_DB=erppreflight_prod
POSTGRES_HOST=postgresql
POSTGRES_PORT=5432
DATABASE_URL=postgres://erppreflight:replace_with_strong_random_db_password@postgresql:5432/erppreflight_prod

# Redis Caching & BullMQ Queues
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=replace_with_strong_random_redis_password
REDIS_URL=redis://:replace_with_strong_random_redis_password@redis:6379

# Object Storage (S3 / MinIO)
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=erppreflight-artifacts
S3_ACCESS_KEY=replace_with_minio_access_key
S3_SECRET_KEY=replace_with_minio_secret_key
S3_USE_SSL=false

# Authentication & Encryption Secrets
JWT_SECRET=replace_with_at_least_32_char_jwt_secret_hash
JWT_EXPIRES_IN=7d
SESSION_SECRET=replace_with_random_session_secret
ENCRYPTION_KEY=replace_with_32_byte_aes_key_base64

# Python Analysis Service IPC
ANALYSIS_SERVICE_URL=http://analysis-python:8000
ANALYSIS_WORKER_CONCURRENCY=4

# External AI Provider Gateways (Optional / Pluggable)
AI_GATEWAY_DEFAULT_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx

# Stripe Billing (Optional / Mockable in Dev)
STRIPE_API_KEY=sk_test_replace_with_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_replace_with_stripe_webhook_secret
```

---

## 5. Summary & Implementation Verification Plan

The platform foundation establishes strict architectural discipline:
- **Monorepo**: Complete package and service segregation enforcing deterministic analysis and centralized SaaS state.
- **Database**: PostgreSQL with Row Level Security, pgvector HNSW indexing, and forward-only idempotent migrations.
- **Ingestion**: Multi-stage validation, quarantine scanning, zip bomb / XXE / traversal defenses, regex/entropy credential redaction, and short-lived pre-signed URLs.
- **Deployment**: Production-ready `docker-compose.coolify.yml`, multi-stage non-root container builds, standardized liveness/readiness health probes, and automated migration entrypoint scripts for zero-downtime deployment on Hostinger via Coolify.
