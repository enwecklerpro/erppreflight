# Handoff Report — Platform Architecture, Foundation, Ingestion, Multi-Tenancy & Deployment Specification

Agent: `spec_miner_survey_2`  
Working Directory: `H:/erppreflight/.agents/spec_miner_survey_2`  
Target File Created: `H:/erppreflight/.agents/spec_miner_survey_2/platform_spec.md`  
Date: 2026-09-24T01:16:00Z  
Handoff Type: Hard (Task Complete)  

---

### 1. Observation
- Inspected `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (lines 1–64) detailing requirements R1 (Monorepo & Platform Foundation), R3 (Secure Ingestion Pipeline & Multi-Tenant Isolation), and R4 (Hostinger & Coolify End-to-End Deployment Configuration), with explicit acceptance criteria for zero TypeScript errors via `pnpm run build`, pytest test suite, container boot with zero crash loops via `docker-compose.coolify.yml`, and standardized health check endpoints (`/health/liveness`, `/health/readiness`).
- Inspected authoritative master prompt `H:/erppreflight/ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md` (7,975 lines):
  - Part 00 (§0.4, lines 69–92): Reliability hierarchy (exact parser -> deterministic rule engine -> static analysis -> official knowledge -> semantic matching -> LLM reasoning); Confidence classes (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`).
  - Part 03 (§3.1–§3.16, lines 779–1131): Preferred stack (Next.js, NestJS, Python 3 FastAPI, PostgreSQL 16 + pgvector, Redis BullMQ, S3 storage, Docker Compose/Coolify); Monorepo directory structure (`apps/`, `services/`, `engines/`, `packages/`, `integrations/`, `infra/`, `docs/`); Engine internal contract payload and return shapes; Ingestion pipeline stages; Async execution flows.
  - Part 04 (§4.1–§4.14, lines 1132–1412): PostgreSQL canonical model; Core SaaS entities (users, orgs, projects, uploaded_files, findings, evidence, tests); Knowledge entities and release validity; Relationship graph edges (`DEPENDS_ON`, `USED_BY`, `SUCCESSOR_OF`, etc.); Row Level Security (RLS) enforcement.
  - Part 05 (§5.7–§5.9, lines 1524–1579): File ingestion engine artifact families; Secret sanitization (Authorization headers, tokens, keys, passwords); Structured reporting engine.
  - Part 10 (§10.1–§10.20, lines 2339–2650): Organization-based multi-tenancy; 12 granular roles; Tenant security pipeline (MIME sniff, archive bombs, malware scan, secret scan, XML entity protection, path traversal protection, file retention).
  - Part 12 (§12.6, §12.10, lines 2976–3030): Forward database migrations; Health endpoints (`/health/liveness`, `/health/readiness`).
  - Part 14 (§14.18, lines 3757–3771): Archive & parser safety (zip bombs, nested archives, XXE, billion laughs, path traversal).
  - Part 16 (§16.6, §16.8, §16.23, lines 5356–5708): Durable workflow orchestration; internal schema registry; deployment profiles.
  - Part 18 (§18.9, §18.25–§18.26, lines 6673–6942): Tenant resource isolation (fair scheduling, rate limits, concurrency); Complete tenant offboarding/deletion cascade across DB, S3, Redis, and search.
  - Part 20 (§20.8, lines 7522–7534): Container hardening (minimal base, non-root user UID 10001, no build tools, no embedded secrets, healthcheck).

### 2. Logic Chain
1. The user request requires a complete architectural specification for ERP Preflight focusing on Monorepo structure, PostgreSQL + pgvector + RLS, Secure Ingestion Pipeline + Export Engine, and Hostinger/Coolify deployment.
2. The authoritative specification (`ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md`) establishes that business invariants and multi-tenancy are owned by `apps/api` (NestJS) while deterministic parsing and calculation are executed by `services/analysis-python` (FastAPI).
3. Database isolation must operate both at the application middleware layer (tenant guards, AsyncLocalStorage) and at the database layer (PostgreSQL Row Level Security via `SET LOCAL app.current_tenant_id`).
4. Ingestion security must be defense-in-depth: untrusted files must enter an isolated quarantine bucket, undergo MIME validation via magic bytes, pass archive safety limits (decompression ratio < 100:1, max size 500MB, path traversal checks), pass ClamAV malware scan, and pass regex/entropy secret redaction before reaching parsers.
5. Deployment to Hostinger via Coolify requires a self-contained `docker-compose.coolify.yml` that starts PostgreSQL with pgvector, Redis, MinIO, API, Analysis-Python, and Web with multi-stage non-root containers, startup migration scripts that poll for database availability to prevent crash loops, and explicit health endpoints (`/health/liveness`, `/health/readiness`).
6. All 27 core features across these 7 operational categories were identified, cataloged, and cross-referenced with exact inputs, outputs, error behaviors, and edge cases in `platform_spec.md`.

### 3. Caveats
- No implementation code was written during this task, as this agent's archetype is strictly a read-only Specification Miner.
- External production secrets (Stripe live keys, OpenAI production API keys) are mocked or parameterized via `.env.example` placeholders, as mandated for early local/development environments.
- OpenSearch is specified as an optional future scale projection; initial semantic and keyword retrieval relies on PostgreSQL full-text search (`tsvector`) + `pgvector` HNSW index.

### 4. Conclusion
The comprehensive specification has been fully extracted and documented in `H:/erppreflight/.agents/spec_miner_survey_2/platform_spec.md`. It provides the complete blueprint for implementation teams to scaffold the monorepo, implement database schemas with pgvector and RLS, build the secure ingestion pipeline with secret redaction, and configure Hostinger/Coolify deployment artifacts with zero crash loops.

### 5. Verification Method
- Inspect `H:/erppreflight/.agents/spec_miner_survey_2/platform_spec.md`:
  - Check presence of `## 2. Features Discovered` table with all 8 required columns.
  - Check presence of `## 3. Edge Cases` table with all 4 required columns.
  - Verify complete Dockerfiles (Web, API, Analysis) with multi-stage non-root definitions.
  - Verify `docker-compose.coolify.yml` orchestrating all required services.
  - Verify automated database migration runner script (`apps/api/entrypoint.sh`).
  - Verify `.env.example` configuration matrix.
- Verification command for downstream build:
  - `pnpm run build` (monorepo compile)
  - `pytest services/analysis-python` (Python engine tests)
  - `docker compose -f infra/coolify/docker-compose.coolify.yml config` (Compose syntax validation)
