# ERP Preflight

Multi-tenant SaaS for deterministic SAP preflight analysis: upload SAP artifacts, run evidence-backed
engines (output determination, forms, clean core, integrations, transports, operations, MFS) and get
findings that point to the exact file, line and SHA-256.

**Status:** not launch-complete — see [`docs/CURRENT_PRODUCT_STATUS.md`](docs/CURRENT_PRODUCT_STATUS.md)
(canonical) and [`RELEASE_READINESS_REPORT.md`](RELEASE_READINESS_REPORT.md).

| Read | For |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Binding engineering rules (contributors and coding agents) |
| [`AI_AGENT_HANDOVER_AND_ARCHITECTURE.md`](AI_AGENT_HANDOVER_AND_ARCHITECTURE.md) | Architecture, monorepo map, environment variables |
| [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) · [`docs/runbooks/`](docs/runbooks) | Deploying, backups, incidents |
| [`USER_GUIDE.md`](USER_GUIDE.md) · [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) | Using and administering the product |
| [`ENGINE_CATALOG.md`](ENGINE_CATALOG.md) | Engines, finding codes, fixtures (generated) |
| [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md) · [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) · [`GO_LIVE_CHECKLIST.md`](GO_LIVE_CHECKLIST.md) | Risk and readiness |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | Open-source licenses (generated) |
| [`docs/spec/`](docs/spec) | Original build specification |

## Quick start (development)

```bash
pnpm install
pnpm --filter "./packages/*" build
pnpm run typecheck && pnpm run lint && pnpm run test
python -m pip install -r services/analysis-python/requirements-dev.txt && pnpm run test:python
```

Full local stack against real Postgres/Redis/MinIO/ClamAV, exactly as CI runs it:
`scripts/ci-live-e2e.sh` (header documents the variables).
