# Branch protection for `main` — recommended configuration

> KNOWN_LIMITATIONS O8, spec 12.4 ("every job is a required gate"), 12.16 (release flow), C §65.
> **Status: recommendation.** Branch protection is a repository setting that only an owner can
> apply (GitHub → Settings → Branches / Rules). Nothing in this repository proves it is active;
> check the live state with the `gh` command in §4.

## 0. Prerequisite: GitHub Actions must run at all (owner item)

On 2026-09-26 every workflow run in `enwecklerpro/erppreflight` failed within about 3 seconds
without producing a job log. That is the signature of an account-level block (Actions disabled
for the account, an exhausted spending limit, or a billing problem), not of a workflow error —
the same workflows are actionlint-clean and their commands pass locally. Fix it under
GitHub → Settings → Billing and plans (spending limit / payment method) and
Settings → Actions → General ("Allow all actions" or an allow-list covering the SHA-pinned
actions). **Do not enable the required status checks below before a green run exists**, or no
pull request can ever be merged.

## 1. Ruleset for `main` (Settings → Rules → Rulesets → New branch ruleset)

| Setting | Value | Why |
|---|---|---|
| Target | `main` (default branch) | Coolify deploys `main` (manually; no auto-deploy on push) |
| Enforcement | Active | |
| Bypass list | empty (at most the owner, "for pull requests only") | even admins go through review + checks |
| Restrict deletions | on | |
| Block force pushes | on | history is the audit trail (gitleaks scans it) |
| Require linear history | on | squash or rebase merges only |
| Require a pull request before merging | on | |
| — Required approvals | 1 (2 once there is a second maintainer) | |
| — Dismiss stale approvals when new commits are pushed | on | |
| — Require review from Code Owners | on | `.github/CODEOWNERS` covers tenancy, auth, migrations, ingestion, engines, CI/infra |
| — Require approval of the most recent reviewable push | on | the author cannot approve their own last push |
| — Require conversation resolution | on | |
| Require status checks to pass | on, "require branches to be up to date" on | |
| Require signed commits | recommended | |

## 2. Required status checks

Use the job names exactly as GitHub shows them after the first green run:

| Workflow | Check name |
|---|---|
| `ci.yml` | `Lint, typecheck, build, compliance gates & API boot` |
| `ci.yml` | `TypeScript unit & integration tests` |
| `ci.yml` | `Python engines, golden fixtures, property tests & E2E contract suite` |
| `ci.yml` | `DB migrations — fresh apply, idempotency, deterministic schema, RLS coverage` |
| `ci.yml` | `Live E2E — real Postgres/Redis/MinIO/ClamAV + API (production mode) + web + Chromium` |
| `security.yml` | `Gitleaks (full history)` |
| `security.yml` | `Trivy filesystem (lockfiles) + Dockerfile misconfiguration` |
| `security.yml` | `Python dependency audit (blocking)` |
| `docker.yml` | `api image — build, scan, SBOM`, `web image — build, scan, SBOM`, `analysis image — build, scan, SBOM` |

`Node dependency audit (report-only …)` stays optional (SECURITY_REVIEW.md §S7). The weekly
scheduled runs of `security.yml` / `docker.yml` are not merge gates; watch them via notifications.

## 3. Tags and releases

- Ruleset for tags `v*`: restrict creation/update/deletion to the owner; block force pushes.
  `release.yml` publishes signed images for every `v*` tag, so a tag is a release decision.
- Environments: if GHCR publishing moves to a protected environment, require the owner as reviewer.

## 4. Verify the live configuration

```bash
gh api repos/enwecklerpro/erppreflight/rulesets --jq '.[] | {name, enforcement, target}'
gh api repos/enwecklerpro/erppreflight/rules/branches/main --jq '.[].type'
# expected to include: deletion, non_fast_forward, required_linear_history, pull_request, required_status_checks
gh api repos/enwecklerpro/erppreflight/branches/main/protection 2>/dev/null | head   # classic protection, if used instead
```

Record the output and the date in `SECURITY_REVIEW.md` once applied.
