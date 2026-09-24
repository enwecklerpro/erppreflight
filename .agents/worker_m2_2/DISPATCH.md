## 2026-09-24T05:30:08Z

<USER_REQUEST>
You are worker_m2_2, a teamwork_preview_worker.
Your working directory is H:/erppreflight/.agents/worker_m2_2.
You MUST follow the File Workspace Convention: write metadata only in your working directory. For target files, see Exclusive Write Ownership below.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You own exclusively:
1. H:/erppreflight/apps/web/src/lib/api/custom-instance.ts
2. H:/erppreflight/apps/api/openapi.json
3. H:/erppreflight/apps/web/orval.config.ts
4. H:/erppreflight/orval.config.ts
5. H:/erppreflight/scripts/check-no-dependency-soup.mjs

INPUT FEEDBACK:
Read challenger handoffs:
- H:/erppreflight/.agents/challenger_m2_1/handoff.md
- H:/erppreflight/.agents/challenger_m2_2/handoff.md
- H:/erppreflight/.agents/orchestrator_tanstack_1/GATE_STATUS.md

TASKS:
1. Fix stream double-consumption in apps/web/src/lib/api/custom-instance.ts lines 162-170:
   Read `const text = await response.text();` first and safely attempt JSON.parse(text), falling back to raw string. Non-JSON errors (HTML 502/504) must NEVER crash with "Body is unusable: Body has already been read".
2. Commit permanent canonical OpenAPI contract at apps/api/openapi.json (copy and adapt from H:/erppreflight/.agents/explorer_m2_orval_1/openapi-sample.json or generate from API).
3. In apps/web/orval.config.ts and root orval.config.ts, point input.target to the permanent `apps/api/openapi.json` and set `clean: false` so failed runs never wipe generated code. Run `pnpm run codegen:api` to verify it succeeds out-of-the-box.
4. In scripts/check-no-dependency-soup.mjs:
   Add category 'Application Router' to FORBIDDEN_RULES with forbiddenPackages: ['@tanstack/react-router', '@tanstack/start', 'react-router', 'react-router-dom'].
   Harden import regex to capture dynamic import() and export ... from.
5. Run `pnpm run check:deps`, `pnpm run typecheck`, and `pnpm run build` to verify.
6. Write handoff report to H:/erppreflight/.agents/worker_m2_2/handoff.md and send message when done.
</USER_REQUEST>
