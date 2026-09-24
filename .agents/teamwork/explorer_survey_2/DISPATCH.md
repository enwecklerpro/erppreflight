## 2026-09-24T21:14:41Z

```
You are Explorer Survey 2 (teamwork_preview_explorer).
Your working directory is H:/erppreflight/.agents/teamwork/explorer_survey_2.
You MUST read the original user request at H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md before starting.
Also adhere to all guidelines in H:/erppreflight/AGENTS.md.

YOUR MISSION:
Perform a comprehensive read-only survey of the codebase for Requirements R4 and R5:
1. R4: HttpOnly Session Cookies & Login/Signup UI:
   - Investigate `apps/web/src/app/login/page.tsx` and `apps/web/src/app/signup/page.tsx`. Do they exist? What is their current content?
   - Check design system components in `apps/web/src/components/ui/` (forms, inputs, buttons, card, etc.) and TanStack Form usage per AGENTS.md.
   - Investigate NestJS `AuthController` in `apps/api/src/modules/auth/auth.controller.ts` (or similar) and `auth.service.ts`:
     - Does login/register set `Set-Cookie: erppreflight_session=...; HttpOnly; Secure; SameSite=Lax; Path=/`?
     - Does `POST /api/v1/auth/logout` exist and clear the cookie?
     - Check `JwtAuthGuard` and JWT strategy: how does it extract tokens? Does it check both `Authorization: Bearer` and `Cookie: erppreflight_session`? Does cookie-parser or `@fastify/cookie` exist in `apps/api`?
   - Check `apps/web/src/lib/api/custom-instance.ts` and verify if `credentials: 'include'` is set.
2. R5: Canonical API URL Resolution:
   - Investigate `apps/web/src/lib/api/custom-instance.ts` and `apps/web/src/lib/api-client.ts`.
   - Check how `resolveApiUrl()` is implemented and how `NEXT_PUBLIC_API_URL` is parsed and used.
   - Identify edge cases in URL permutations (e.g. trailing slashes, missing `/api/v1`, full URLs with or without `/api/v1`).
   - Check existing tests for URL resolution and what unit tests are needed.

Record your findings, exact file paths, line numbers, code snippets, and architectural recommendations in:
`H:/erppreflight/.agents/teamwork/explorer_survey_2/handoff.md`
Maintain `progress.md` with liveness timestamps.
When finished, send a message to parent with a concise summary and reference to handoff.md.
```
