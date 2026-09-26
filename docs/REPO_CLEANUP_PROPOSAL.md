# Repository cleanup proposal (spec C §65)

> Proposal only — **no deletions were performed**. Decision: coordinator/owner at merge time.
> Performed already (non-destructive `git mv`, files not referenced by code or scripts):
> `TEST_INFRA.md`, `TEST_READY.md` → `docs/archive/audits/`;
> previous `docs/CURRENT_PRODUCT_STATUS.md` → `docs/archive/audits/CURRENT_PRODUCT_STATUS.superseded-2026-09-25.md`.

| # | Path | Size | Proposal | Reason | Breaks anything? |
|---|---|---|---|---|---|
| 1 | `14_…md` … `22_…md` (9 spec parts in repo root) | ~110 KB | `git mv` → `docs/archive/spec-history/` | Superseded by the consolidated `docs/spec/ERP_PREFLIGHT_ALL_PROMPTS_COMPLETE.md`; root should hold README/AGENTS/package files only | `scripts/generate-production-readiness-matrix.mjs` reads `21_…` and `22_…` from the root → update its two paths in the same commit (the generator itself only produces the superseded matrix, see #5) |
| 2 | `ERP_Preflight_Astra_Ultra_Prompt_Package_v5.zip` | 127 KB | `git mv` → `docs/archive/spec-history/` | Binary prompt archive in root; content is in `docs/spec` | No references |
| 3 | `.agents/*` except `.agents/skills/` (≈ 200 agent scratch dirs: BRIEFING/DISPATCH/progress/handoff files, probe scripts) | ≈ 14 MB | Delete from the tree (history keeps them; record the last commit containing them in `docs/archive/README.md`) | AGENTS.md §2.2.5 forbids source/tests in `.agents/`; several dirs contain Python probe/test scripts. Noise for reviewers and gitleaks allow-list | Only `.agents/skills/*` is referenced (AGENTS.md, readiness generator). `.agents/ORIGINAL_REQUEST.md` differs from `docs/archive/spec-history/ORIGINAL_REQUEST.md` → move it there as `ORIGINAL_REQUEST.agents-copy.md` first |
| 4 | `docker-compose.yaml` (legacy) | 10 KB | Delete (or move to `docs/archive/`) | Uses `POSTGRES_HOST_AUTH_METHOD: trust`, no ClamAV — violates spec C §53; production uses `docker-compose.coolify.yml`; risk of Coolify pointing at the wrong file (RELEASE_READINESS_REPORT §5.4) | Mentioned in `AI_AGENT_HANDOVER_AND_ARCHITECTURE.md` (doc text only) |
| 5 | `docs/PRODUCTION_READINESS_MATRIX.md`, `docs/production-readiness.json`, `scripts/generate-production-readiness-matrix.mjs` | ~300 KB | Move matrix outputs to `docs/archive/audits/` and mark the generator historical, or delete generator | Pre-audit matrix overstates completeness (RELEASE_READINESS_REPORT §4) | Generator writes to `docs/`; adjust output path if kept |
| 6 | `PROJECT.md` | 14 KB | `git mv` → `docs/archive/spec-history/PROJECT.md` | Early architecture brief | Cited in comments (`services/analysis-python/src/platform/confidence.py`, two test files, `tests/e2e/runner.py`) — update comment paths |
| 7 | `server.js` (Hostinger hPanel Node entry, Next.js only) | 1.5 KB | Keep only if hPanel deployment is still an option; otherwise delete | Alternative deployment path not used with Coolify | `package.json` `main`/`start` point to it |
| 8 | `apps/api/dist`, `tests/e2e/__pycache__` if tracked | — | Ensure untracked | Build/cache artefacts | `.gitignore` covers them |

Suggested single commit for 1–4 once approved:

```bash
mkdir -p docs/archive/spec-history
git mv 1[4-9]_*.md 2[0-2]_*.md ERP_Preflight_Astra_Ultra_Prompt_Package_v5.zip docs/archive/spec-history/
git mv .agents/ORIGINAL_REQUEST.md docs/archive/spec-history/ORIGINAL_REQUEST.agents-copy.md
git rm -r $(ls -d .agents/*/ | grep -v '^.agents/skills/$')
git rm docker-compose.yaml
sed -i "s#'21_LIBRARY#'docs/archive/spec-history/21_LIBRARY#; s#'22_REPOSITORY#'docs/archive/spec-history/22_REPOSITORY#" scripts/generate-production-readiness-matrix.mjs
pnpm run check:no-production-facades && pnpm run check:production-truth   # must stay green
```
