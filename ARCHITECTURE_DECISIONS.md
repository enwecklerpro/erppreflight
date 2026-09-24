# Architectural Decision Records (ADRs) — ERP Preflight

## ADR-001: Monorepo Architecture with pnpm Workspaces & Turborepo
- **Status**: Accepted
- **Context**: ERP Preflight comprises a web dashboard (Next.js 15), a core SaaS API (NestJS 11), a deterministic analysis worker (Python 3.13 FastAPI), and shared TypeScript domain packages.
- **Decision**: Standardize on `pnpm` workspaces orchestrated via `turbo`.
- **Consequences**:
  - Deterministic dependency resolution with hard-linking to `H:\.pnpm-store\v10`.
  - Topological build pipeline (`turbo build`) caching outputs across workspace packages.
  - Zero circular dependency enforcement across packages.

## ADR-002: Dual-Port Redis Configuration for Local Dev vs Docker
- **Status**: Accepted
- **Context**: Windows development host runs an existing Redis container on port 6379 (`dj-redis`), causing port collisions if ERP Preflight Redis binds to host 6379.
- **Decision**: Configure local environment to bind Redis on port `6380:6379`, while internal container-to-container communication inside Docker network utilizes default port `6379`.
- **Consequences**:
  - Local host commands and tests connect to `localhost:6380` without crashing or colliding with existing containers.
  - Production Coolify deployment on Linux VPS uses standard `6379`.

## ADR-003: Multi-Tenant Row-Level Security (RLS) with AsyncLocalStorage
- **Status**: Accepted
- **Context**: SaaS multi-tenancy requires ironclad guarantees that no query can inadvertently leak customer SAP configurations across organization boundaries.
- **Decision**: Implement a two-tier defense model:
  1. Node.js `AsyncLocalStorage` (`@erppreflight/tenancy`) propagates tenant context (`tenantId`) across asynchronous request execution without parameter drilling.
  2. PostgreSQL Row-Level Security (RLS) policies enforce `organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` on every tenant table.
- **Consequences**:
  - Even if an application SQL query omits `WHERE organization_id = ...`, PostgreSQL RLS rejects cross-tenant records at the database engine level.

## ADR-004: Epistemic Confidence Hierarchy & Strict LLM Boundary
- **Status**: Accepted
- **Context**: Enterprise preflight audits cannot permit probabilistic hallucination to masquerade as verified technical facts.
- **Decision**: Enforce a strict 4-level epistemic hierarchy:
  - `VERIFIED` (score: 1.0): Exact parser AST, schema, or configuration proof.
  - `RULE_DERIVED` (score: 0.85): Deterministic domain rule evaluation or graph traversal.
  - `INFERRED` (score: 0.60): Heuristic similarity or LLM-assisted finding.
  - `UNKNOWN` (score: 0.30): Missing evidence or unverified pattern.
  - **Hard Invariant**: Any finding derived with LLM/AI involvement can NEVER exceed `INFERRED` (0.60) and is non-negotiably demoted.
- **Consequences**:
  - Complete customer trust in audit findings and defensibility during SAP compliance reviews.

## ADR-005: Decoupled Stateless Python Analysis Engine
- **Status**: Accepted
- **Context**: High-compute parsing and rule evaluations across massive SAP transports should not impact SaaS API responsiveness.
- **Decision**: Keep `services/analysis-python` completely stateless and decoupled from SaaS billing/auth databases. All communication is parameterized via normalized `AnalysisRequest` contracts.
- **Consequences**:
  - Horizontal scaling of worker pods under Coolify without database connection pool exhaustion.
  - Clean boundary between SaaS business logic (NestJS) and SAP domain knowledge (Python).

## ADR-006: Defused XML Defense-in-Depth Against XXE and Billion Laughs
- **Status**: Accepted
- **Context**: SAP artifacts often contain untrusted XML/XDP exports from customer on-premise systems.
- **Decision**: Prohibit standard Python `xml.etree` parsing on untrusted inputs; mandate `SafeXmlParser` backed by `defusedxml` with DTD and external entities strictly forbidden.
- **Consequences**:
  - Total prevention of XML External Entity (XXE) injection and recursive entity expansion attacks.
