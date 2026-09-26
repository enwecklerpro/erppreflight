# Enterprise Readiness

> Spec C §72 (Definition of Done — Enterprise) / §75 #8. Every row names the code that was read to confirm it.

| Field | Value |
|---|---|
| Commit | `6303f1d` on `claude/sharp-mendel-xg6cus` |
| Date | 2026-09-26 |
| Deployment checked | **None** — no production or customer environment was verified |
| External systems | **No real** SAP Cloud ALM, Jira, Azure DevOps, ServiceNow tenant or OIDC IdP. All integration results come from contract test doubles (`apps/api/test/doubles/doubles.cjs`, `run-doubles.cjs`) |
| Commands | `node apps/api/test/doubles/run-doubles.cjs` (doubles), then `API_BASE_URL=… DOUBLES_FILE=… DATABASE_URL=… METRICS_TOKEN=… MAIL_DEV_OUTBOX_TOKEN=… node scripts/e2e-enterprise-live.cjs` → **85/85**; `WEB_URL=… API_BASE_URL=… DOUBLES_FILE=… node scripts/e2e-integrations-ui.cjs <dir>` → **17/17**; unit suites API 979 / local-agent 10 (0 failed) |

## C §72 checklist

| Item | Status | Evidence | Gap |
|---|---|---|---|
| SSO architecture | Done (vs double) | `apps/api/src/modules/sso/oidc.ts`, `sso.service.ts`, `sso.controller.ts` (`GET sso/discover`, `sso/login`, `sso/callback`; admin `sso/admin/config`, `domains`, `domains/:id/verify`). Enforcement: password login → 403 `SSO_REQUIRED` + `loginUrl` for members of SSO-enforced organisations (`auth.service.ts`, commit `6303f1d`), verified live | No SAML. No real IdP (Entra ID, Okta, Keycloak) tested |
| SCIM | Done (live, local) | `@Controller('scim/v2')` in `sso.controller.ts`: `ServiceProviderConfig`, `ResourceTypes`, `Users`, `Groups` (GET/POST/PUT/PATCH/DELETE); SCIM tokens `sso/admin/scim-tokens`; group → role mapping `sso/admin/scim-groups` | Not tested with a real IdP's SCIM client |
| Policy authorization | Partial | Role guards (`@Roles`), membership-verified tenancy (`tenancy/tenancy.guard.ts`), API-key scopes, partner delegation. ADR-101 (`ARCHITECTURE_DECISIONS.md`) defers ABAC/Cerbos | No policy engine; `packages/auth` permission map not used by API guards |
| Cloud ALM connector | Partial | `connectors/adapters/cloud-alm.adapter.ts`, `oauth2.ts`; `GET connectors/:id/cloud-alm/projects`, project links; finding → work item (`POST findings/:id/work-item`), sync + conflict resolution (`connectors/work-items/*`) | API paths not validated against a real Cloud ALM tenant; test-case sync and process hierarchy partial |
| Connector framework | Done (vs doubles) | `connectors/connector-registry.ts`: 9 types (`HTTP_OPENAPI`, `ODATA`, `SAP_CLOUD_ALM`, `JIRA`, `AZURE_DEVOPS`, `SERVICENOW`, `GIT`, `FILE`, `LOCAL_AGENT`); `credential-vault.ts` (encrypted credentials), `circuit-breaker.ts`, `connector-http.ts` (SSRF policy), `integration-audit.service.ts`, sync log, metadata snapshots, Git snapshot/ingest | Adapters for Jira/Azure DevOps/ServiceNow verified only against doubles |
| Local agent | Done (live) | `apps/local-agent/src/{cli,daemon,identity,jobs,probe,redactor,scanner,updater}.ts`; `infra/docker/Dockerfile.local-agent`; server side `connectors/agent-api.controller.ts` (`enroll`, `heartbeat`, `jobs/:jobId/result`, `updates/:channel`), device management + signed jobs (`agent-signing.ts`), revoke | Not run on a customer network against a real SAP system |
| Audit | Done (live) | `audit/audit-trail.service.ts`, `@Audited` decorator (47 call sites), per-tenant hash chain, `GET audit/verify`, `/settings/audit`. Live: 1852 events / 104 orgs, 0 gaps; verify → `isValid` | Immutability relies on the application role; no external WORM/anchoring |
| Observability | Partial | Pino structured logs with request/tenant ids and secret scrubbing (`apps/api/src/observability/logger.ts`); OpenTelemetry OTLP/HTTP tracing when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`tracing.ts`; Python `services/analysis-python/src/observability.py`); Sentry envelope protocol when `SENTRY_DSN` is set (`error-reporter.ts`); Prometheus `GET /api/v1/metrics` with `METRICS_TOKEN`; runbook `docs/runbooks/observability.md` | No dashboards or alert rules shipped; no collector/Sentry project connected |
| Partner mode | Partial | `partners/partners.controller.ts` (`grants`, `grants/:id/revoke`, `clients`); grants created/revoked only by the customer; partner members act in the client tenant only with an active, unexpired grant; second RLS policy `partner_read_partner_access_grants` (migration 015) | No partner rule/knowledge packs; branding per organisation, not per partner |
| MCP / agent gate | Done | MCP JSON-RPC endpoint `POST /api/v1/mcp` (`mcp/mcp.service.ts`, tools `search_knowledge`, `lookup_object`, `compare_releases`, `get_findings`, `explain_finding`, `generate_test`, `get_project_status`; JWT + tenant scoped); stdio bridge `packages/cli/bin/erp-preflight-mcp.js`; Agentic Change Gate `agent-gate/agent-gate.controller.ts` (register agent, propose, approve, execute with HMAC token bound to proposal id + hash, 15-min TTL, anti-replay; plan-gated `AGENT_GATE`) | Signature compare not constant-time; MCP tools are read/explain only |

## Additional enterprise surface (verified in the enterprise live suite)

| Capability | Evidence |
|---|---|
| Outbound webhooks: event catalog, HMAC-SHA256 signed deliveries, delivery log, payload view, replay, secret rotation | `webhooks/webhooks.controller.ts`; receivers on private networks need `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` |
| API keys with scopes | `api-keys/api-keys.controller.ts` |
| API reference (Scalar, self-hosted) + OpenAPI document | `apps/api/src/observability/api-reference.ts` (`/api/v1/reference`, `/api/v1/openapi.json`; production only with `ENABLE_API_REFERENCE=true`) |
| CLI | `packages/cli/bin/erp-preflight.js` |
| Traceability (requirements import, finding links, tasks) | `traceability/traceability.controller.ts` |

## Verdict

Enterprise integration code exists for every C §72 item and passed its live suite against contract doubles.
Four of ten items are Partial: policy authorization (engine deferred by ADR-101), Cloud ALM (not validated against a
real tenant), observability (no dashboards/alerts) and partner mode (no partner packs). None of it is verified in production or with a
real customer IdP/ALM system.
