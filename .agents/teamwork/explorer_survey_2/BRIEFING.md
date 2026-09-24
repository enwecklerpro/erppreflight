# BRIEFING — 2026-09-24T21:15:00Z

## Mission
Comprehensive read-only survey of codebase for Requirements R4 (HttpOnly Session Cookies & Login/Signup UI) and R5 (Canonical API URL Resolution).

## 🔒 My Identity
- Archetype: explorer
- Roles: investigator, synthesizer
- Working directory: H:/erppreflight/.agents/teamwork/explorer_survey_2
- Original parent: 732d36b7-a399-4387-8843-8a3934bdf045
- Milestone: Survey Phase (Requirements R4 & R5)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Adhere strictly to H:/erppreflight/AGENTS.md and Cardinal Axioms
- Report exact file paths, line numbers, code snippets, and architectural recommendations

## Current Parent
- Conversation ID: 732d36b7-a399-4387-8843-8a3934bdf045
- Updated: 2026-09-24T21:15:00Z

## Investigation State
- **Explored paths**:
  - `apps/web/src/app/login/page.tsx` & `apps/web/src/app/signup/page.tsx` (verified non-existent)
  - `apps/web/src/components/ui/` (verified non-existent; form components located in `apps/web/src/components/form/`)
  - `apps/api/src/modules/auth/` (`auth.controller.ts`, `auth.service.ts`, `jwt.strategy.ts`, `jwt-auth.guard.ts`, `auth.module.ts`, `auth.dto.ts`)
  - `apps/web/src/lib/api/custom-instance.ts` & `apps/web/src/lib/api-client.ts`
  - `.env.example`, `.env.coolify.example`, `infra/coolify/.env.coolify.example`, `docker-compose.yaml`, `docker-compose.coolify.yml`
  - `apps/web/src/__tests__/` (verified zero tests for `resolveApiUrl`)
- **Key findings**:
  - R4: No login/signup pages exist. Form components in `apps/web/src/components/form/` are fully accessible and TanStack Form + Zod compliant.
  - R4: `AuthController` lacks cookie issuance, lacks logout endpoint, lacks `@Res({ passthrough: true })`.
  - R4: `JwtStrategy` only extracts bearer token from Authorization header; zero cookie extraction.
  - R4: `apps/api` uses `@nestjs/platform-express` (not Fastify); `cookie-parser` is not installed, but Express native `res.cookie` and a regex cookie extractor can be used with zero new dependencies.
  - R4: `apps/web/src/lib/api/custom-instance.ts` lacks `credentials: 'include'`.
  - R5: `resolveApiUrl()` fails when `NEXT_PUBLIC_API_URL` is set without `/api/v1` and endpoint is called without `/api/v1` (returns 404). Also hardcodes wrong fallback port 4000 instead of 3001.
  - R5: Multiple env files (`.env.example`, `.env.coolify.example`, `docker-compose.yaml`) set `NEXT_PUBLIC_API_URL` without `/api/v1`.
  - R5: No unit tests exist for `resolveApiUrl`.
- **Unexplored areas**: None for R4/R5 survey scope.

## Key Decisions Made
- Prepared exact regex and Express cookie implementations with fallback options.
- Formulated complete URL permutation test matrix for `resolveApiUrl`.
- Ready to produce comprehensive 5-component handoff report.

## Artifact Index
- H:/erppreflight/.agents/teamwork/explorer_survey_2/DISPATCH.md — Initial dispatch log
- H:/erppreflight/.agents/teamwork/explorer_survey_2/progress.md — Liveness heartbeat and progress
- H:/erppreflight/.agents/teamwork/explorer_survey_2/handoff.md — Final handoff report
