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

## ADR-021: Product documentation as typed content pages (Fumadocs not adopted)
- **Status**: Accepted (2026-09-26, workstream W3)
- **Context**: Part 21 / C §46 suggest Fumadocs "if it fits the main repo". Fumadocs needs `fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx` and an MDX compilation pipeline (remark/rehype plugins, its own layout/theme and search index), i.e. either a second Next.js app or a large set of new dependencies and a second styling system inside `apps/web`. The docs must also be localized (EN/DE via next-intl), share the public-site chrome, CSP nonce handling and SEO helpers, and part of their content (engine catalog, file formats) is generated from live data.
- **Decision**: Implement documentation as MDX-free, typed content modules (`apps/web/src/lib/docs/content.{en,de}.ts`, page list in `lib/docs/pages.ts`) rendered under `/[locale]/docs/**` with the existing safe markdown renderer (`components/public/markdown.tsx`). The engine catalog and file-format pages are generated from the analysis service catalog through the API (`GET /api/v1/public/tools/engines`). The OpenAPI reference stays with the API (Scalar at `/api/v1/reference`, owned by the connectors workstream) and is linked from the docs.
- **Consequences**:
  - No new dependencies (No-Dependency-Soup policy), one styling system, same i18n/SEO/CSP pipeline as the public site; EN/DE page and section parity is unit-tested.
  - No raw HTML or MDX components in docs content (the renderer only emits React elements), so docs cannot inject scripts.
  - Full-text docs search is not provided by the docs framework; the public knowledge & error search tool covers articles, SAP objects and engine finding codes.

## ADR-022: Public free tools and programmatic SEO read only global reviewed knowledge
- **Status**: Accepted (2026-09-26, workstream W3)
- **Context**: Part 01 §1.11 free tools and Part 02 §2.8/§2.9 programmatic SEO pages are unauthenticated; Part 04 §4.14 forbids exposing tenant knowledge.
- **Decision**: A dedicated `public-tools` API module (`/api/v1/public/tools/*`) serves the tools and SEO page data. Every statement filters `organization_id IS NULL` and `review_status = 'PUBLISHED'` explicitly (unit-tested on every statement), endpoints are rate limited per client IP, and the form XML checker is proxied to the stateless analysis service (`POST /api/v1/tools/xml-field-check`, defusedxml, in memory, nothing stored). SEO object pages are rendered on demand (never generated for all objects) and indexed only when the shared quality gate (`evaluateSeoGate` in `@erppreflight/schemas`, mirrored in SQL for the sitemap) passes; the sitemap is an index split by content type with ≤ 50 000 URLs per child.
- **Consequences**: No tenant data can reach a public page; thin object pages are served `noindex`; the sitemap lists exactly the pages that pass the gate.
## ADR-101: Authorization Model — Keep RBAC Guards + Partner Delegation; Defer ABAC/Cerbos
- **Status**: Accepted (Workstream H — enterprise integrations)
- **Context**: Enterprise buyers ask for SSO/SCIM group mapping, partner (SI) access and finer rules such as "an analyst may create work items only on connectors the org admin granted write access to". Part 21 lists ABAC via an external policy decision point (Cerbos) as an option.
- **Decision**:
  - Keep the existing `RolesGuard` + org-membership RBAC as the single enforcement point, with PostgreSQL RLS as the data-layer backstop.
  - SSO/SCIM groups map onto existing roles (`scim_groups.mapped_role`).
  - Partner access is a time-boxed `partner_access_grants` row. The tenancy middleware resolves it into a *delegated* role (VIEWER / MIGRATION_CONSULTANT / LEAD_ARCHITECT, never OWNER or billing) and audits every use.
  - Resource-level conditions (connector write scopes, confirmed permission diffs, agent egress policy) live in the owning service as explicit checks (`assertWriteAllowed`, `confirmWriteAccess`).
  - Cerbos/ABAC is **not** introduced now.
- **Consequences**:
  - No new runtime service, no policy language to operate, and no split-brain between the guard and the PDP.
  - Revisit when customer-defined policies are needed (attribute rules per project/landscape), or when more than 3 services must share the same decisions. Migration path: keep roles as principal attributes, move service checks into Cerbos resource policies, and run the PDP as a sidecar with fail-closed semantics.

## ADR-102: Connector Framework — Registry, Encrypted Credentials, Least-Privilege Writes
- **Status**: Accepted
- **Context**: SAP Cloud ALM, Jira, Azure DevOps, ServiceNow, OData/OpenAPI metadata, Git and local agents need a common way to store credentials, call remote systems safely and write back remediation work items.
- **Decision**:
  - A typed registry (`modules/connectors/connector-registry.ts`) declares, per connector type, the Zod config/credential schemas, read/write scopes and write actions.
  - Credentials are AES-256-GCM encrypted with a tenant-bound AAD and key id. Rotation is supported through `MASTER_ENCRYPTION_KEY_PREVIOUS`. Secrets are never returned.
  - Every outbound call goes through the SSRF-safe client (DNS pinning, private ranges blocked by default), a token-bucket rate limiter, retry/backoff and a persisted circuit breaker. Each call writes a sync-log row.
  - Connectors start READ_ONLY. Write access requires an explicit two-step permission diff confirmation.
  - Each external system has a production adapter plus a contract test double (`apps/api/test/doubles`) used by integration tests.
- **Consequences**: A new system is one adapter plus a registry entry. Contract doubles are only as accurate as the vendor documentation, so each adapter must be validated against a real tenant before GA.

## ADR-103: Vendor-Neutral Observability Without Vendor SDKs
- **Status**: Accepted
- **Context**: Operators run Grafana, Datadog, Honeycomb or nothing. Vendor SDKs add weight and patch globals.
- **Decision**:
  - Pino JSON logs with secret redaction and ALS request context.
  - OpenTelemetry (OTLP/HTTP) for traces in the API and analysis-python, started only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
  - Prometheus text metrics at `/api/v1/metrics`.
  - An `ErrorReporter` interface whose production adapter speaks the Sentry envelope protocol directly (`SENTRY_DSN`), with a no-op adapter otherwise.
- **Consequences**:
  - One instrumentation core and no lock-in.
  - Error grouping is less rich than the official Sentry SDK (no breadcrumbs).
  - Runbook: `docs/runbooks/observability.md`.
