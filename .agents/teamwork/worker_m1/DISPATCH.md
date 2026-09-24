## 2026-09-24T21:22:17Z
You are Worker M1 (teamwork_preview_worker).
Your working directory is H:/erppreflight/.agents/teamwork/worker_m1.
You MUST read the original user request at H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md before starting.
Also review the comprehensive blueprint prepared by Explorer 2 at:
H:/erppreflight/.agents/teamwork/explorer_survey_2/handoff.md
And adhere to H:/erppreflight/AGENTS.md, /.agents/skills/frontend-design-system.md, and /.agents/skills/multi-tenant-security.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP (You may ONLY edit or create these files):
- apps/web/src/app/login/page.tsx
- apps/web/src/app/signup/page.tsx
- apps/api/src/modules/auth/auth.controller.ts
- apps/api/src/modules/auth/strategies/jwt.strategy.ts
- apps/web/src/lib/api/custom-instance.ts
- apps/web/src/__tests__/url-resolution.test.ts

TASKS FOR MILESTONE M1:
1. R5: Canonical API URL Resolution in `apps/web/src/lib/api/custom-instance.ts`:
   - Update `resolveApiUrl()` so that if `path` does not begin with `/api/v1` and `cleanBase` does not end with `/api/v1`, `/api/v1` is automatically prepended.
   - Support `http://localhost:3001` as local default base instead of 4000.
   - Set `credentials: 'include'` on `fetch(fullUrl, { ...options, headers, credentials: 'include' })`.
   - Create unit tests in `apps/web/src/__tests__/url-resolution.test.ts` verifying all 9 URL permutations (cleanBase with/without /api/v1, path with/without /api/v1, trailing/leading slashes, absolute http/https URLs).
2. R4: NestJS Auth Cookies & Logout:
   - In `apps/api/src/modules/auth/auth.controller.ts`:
     - Inject `@Res({ passthrough: true }) res: Response` from Express into `register()` and `login()`.
     - Set cookie `erppreflight_session` with options: `{ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 }`.
     - Add `@Post('logout')` `@HttpCode(HttpStatus.OK)` endpoint that clears the cookie using `res.clearCookie('erppreflight_session', { path: '/' })` and returns `{ success: true, message: 'Logged out successfully' }`.
   - In `apps/api/src/modules/auth/strategies/jwt.strategy.ts`:
     - Update `jwtFromRequest` to support both `Authorization: Bearer <token>` AND `Cookie: erppreflight_session=<token>` using `ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), (req) => { ... extract erppreflight_session from req.headers.cookie ... }])`.
3. R4: Web Frontend Auth Pages:
   - Implement `apps/web/src/app/login/page.tsx`:
     - Accessible login form using `@tanstack/react-form` + `zod` schema (email + password).
     - Uses design system components from `apps/web/src/components/form/` (`FormField`, `FormInput`, `FormSummaryErrors`).
     - Includes clear link to `/signup` and proper error handling.
   - Implement `apps/web/src/app/signup/page.tsx`:
     - Accessible registration form using `@tanstack/react-form` + `zod` schema (organization name, email, password, confirm password).
     - Uses design system components and provides link to `/login`.

VERIFICATION:
Run tests:
- `pnpm --filter @erppreflight/web test` (or run vitest for url-resolution.test.ts)
- `pnpm --filter @erppreflight/api test`
- `pnpm run typecheck`
Ensure zero errors and 100% pass rate.
Document all changes, test commands, and test results in `H:/erppreflight/.agents/teamwork/worker_m1/handoff.md`. Send completion message when done.
