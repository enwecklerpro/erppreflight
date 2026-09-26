# Final Remediation Report

> Spec C §75 #2 and 13.12 #1. **Structured for the coordinator to complete after merging all
> workstreams**: each workstream adds one section with the same fields; the header table holds the
> merged state. Do not state results that were not produced by a command recorded here.

| Field | Value |
|---|---|
| Merged commit | _coordinator: `git rev-parse HEAD` on `main` after merge_ |
| Date | _coordinator_ |
| Deployed? | _coordinator: VPS deploy + `docs/LIVE_PRODUCTION_VERIFICATION.md`_ |
| Test totals (merged) | _coordinator: fill from the commands in §1_ |

## 1. Commands that define "green" (run on the merged commit)

```bash
pnpm install --frozen-lockfile
pnpm run check:deps && pnpm run check:no-production-facades && pnpm run check:production-truth
pnpm run typecheck && pnpm run lint && pnpm run build
pnpm --filter @erppreflight/api run test:boot
pnpm run test                                    # vitest: api, web, local-agent
python -m pytest services/analysis-python/tests -q
python -m pytest tests/e2e tests/empirical_redaction_stress.py -q
python scripts/generate-engine-catalog.py --check
PG_ADMIN_URL=postgres://… bash scripts/ci-migration-check.sh
PG_ADMIN_URL=… S3_ACCESS_KEY=… S3_SECRET_KEY=… bash scripts/ci-live-e2e.sh   # API smoke + UI smoke + backup/restore drill
```

| Command | Result (merged) | Skipped / failed |
|---|---|---|
| typecheck / lint / build / test:boot | _ | _ |
| vitest | _ | _ |
| pytest (service) | _ | _ |
| pytest (tests/e2e + redaction stress) | _ | _ |
| migration check | _ | _ |
| live E2E (API 21 checks, UI 7 steps, restore drill) | _ | _ |
| GitHub Actions run (ci, security, docker) | _ | _ |

## 2. Workstream E — DevOps, CI/CD, security pipeline, operations docs

Branch `worktree-agent-ace1e348aa8f737f7` (based on `b6af091`, merged `f4ba771` spec and `c3f9b10`
Redis fix). Results on this branch: `docs/E2E_TEST_REPORT.md` §2–§4.

| Deliverable | Files |
|---|---|
| CI: Node 22, Python 3.13 (+pytest-asyncio, hypothesis, optional requirements-dev), all AGENTS.md gates incl. `test:boot`, python E2E suite, engine-catalog check | `.github/workflows/ci.yml` |
| Live E2E job (compose infra incl. ClamAV → python → API prod mode + RLS role → standalone web → API smoke → Chromium smoke → optional Playwright suite → backup/restore drill; artifacts on failure) | `ci.yml` `live-e2e`, `scripts/ci-live-e2e.sh`, `tests/ci/compose.ci.yml` |
| Migration check | `ci.yml` `migration-check`, `scripts/ci-migration-check.sh` |
| Image build + Trivy + SBOM; security scans; release with provenance + cosign | `.github/workflows/docker.yml`, `security.yml`, `release.yml`, `.trivyignore`, `renovate.json` |
| Image hardening, digest pins, `.dockerignore` | `infra/docker/Dockerfile.*`, `.dockerignore` |
| Backups | `scripts/backup.sh`, `scripts/restore.sh`, `docs/runbooks/DISASTER_RECOVERY.md` |
| Docs (spec 0.2 / 13.12 / C §64–§75) | `DEPLOYMENT_GUIDE.md`, `GO_LIVE_CHECKLIST.md`, `ADMIN_GUIDE.md`, `USER_GUIDE.md`, `SECURITY_REVIEW.md`, `THIRD_PARTY_NOTICES.md` (+ generator), `ENGINE_CATALOG.md` (+ generator), `KNOWN_LIMITATIONS.md` → `docs/KNOWN_LIMITATIONS.md`, `docs/CURRENT_PRODUCT_STATUS.md`, `docs/SECURITY_HARDENING_REPORT.md`, `docs/E2E_TEST_REPORT.md`, `docs/runbooks/*`, `README.md`, `docs/REPO_CLEANUP_PROPOSAL.md` |

Not done by workstream E (decision or other owner): repository cleanup deletions (proposal only),
separate migration job in compose (C §54 — documented as O3), OpenTelemetry/Sentry (C §57),
multi-browser Playwright suite (C §50 — hook in place), first GitHub run of the workflows.

## 3. Other workstreams

_A–D: add sections here (deliverables, files, verification commands, remaining gaps)._

## 4. Remaining limitations

`docs/KNOWN_LIMITATIONS.md` (maintained list) and `SECURITY_REVIEW.md` §5.
