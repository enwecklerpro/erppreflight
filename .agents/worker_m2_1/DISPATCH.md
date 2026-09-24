## 2026-09-24T05:14:59Z

You are worker_m2_1, a teamwork_preview_worker.
Your working directory is H:/erppreflight/.agents/worker_m2_1.
You MUST follow the File Workspace Convention: write metadata only in your working directory. For target files, see Exclusive Write Ownership below.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You own exclusively:
1. H:/erppreflight/apps/web/package.json
2. H:/erppreflight/package.json
3. H:/erppreflight/apps/web/orval.config.ts
4. H:/erppreflight/orval.config.ts
5. H:/erppreflight/apps/web/src/lib/api/custom-instance.ts
6. H:/erppreflight/scripts/check-no-dependency-soup.mjs
7. H:/erppreflight/pnpm-lock.yaml

INPUT BLUEPRINTS:
Read and strictly implement the technical designs and verified packages from:
- H:/erppreflight/.agents/explorer_m2_deps_1/handoff.md (Exact package versions & React 19 compatibility)
- H:/erppreflight/.agents/explorer_m2_audit_1/handoff.md (Zero-duplication compliance script & script alignment)
- H:/erppreflight/.agents/explorer_m2_orval_2/handoff.md (Orval config and custom-instance.ts)

TASKS:
1. Update apps/web/package.json dependencies:
   - Add @tanstack/react-query@^5.66.0
   - Add @tanstack/react-table@^8.21.3
   - Add @tanstack/react-virtual@^3.14.0
   - Add @tanstack/react-form@^1.33.5
   - Add @tanstack/react-pacer@^0.23.0
   - Add @base-ui-components/react@1.0.0-rc.0
   - Add @xyflow/react@^12.11.6
   - Add motion@^12.43.0
   - Add orval@^8.37.0 to devDependencies
   - Ensure clean package scripts (add codegen:api: "orval")
2. Implement production custom fetch instance at H:/erppreflight/apps/web/src/lib/api/custom-instance.ts from explorer_m2_orval_2 blueprint (baseUrl normalization, X-Tenant-Id header, Authorization header, AbortSignal forwarding, 204 No Content guard, ApiError class).
3. Create H:/erppreflight/apps/web/orval.config.ts and/or root orval.config.ts with mode: 'tags-split', target client: 'react-query', version: 5, and custom mutator.
4. Implement H:/erppreflight/scripts/check-no-dependency-soup.mjs from explorer_m2_audit_1 blueprint and wire it into root package.json as "check:deps": "node scripts/check-no-dependency-soup.mjs".
5. Run `pnpm install` across the monorepo to resolve and link all packages into pnpm-lock.yaml.
6. Run `pnpm run check:deps` to verify zero-duplication across all packages.
7. Run `pnpm run typecheck` and `pnpm run build` to confirm zero TypeScript compilation errors.
8. Document all installed packages, verification outputs, and script executions in H:/erppreflight/.agents/worker_m2_1/handoff.md. Send a message to parent when done.
