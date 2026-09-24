# Handoff Report — Requirements R4 & R5 Codebase Survey

**Agent**: Explorer Survey 2 (`teamwork_preview_explorer`)  
**Working Directory**: `H:/erppreflight/.agents/teamwork/explorer_survey_2`  
**Target Requirements**: R4 (HttpOnly Session Cookies & Login/Signup UI) and R5 (Canonical API URL Resolution)  
**Date**: 2026-09-24T21:20:00Z  

---

## 1. Observation

### 1.1 R4: Web Frontend Authentication Pages & Form Primitives

1. **Login & Signup Routes**:
   - `apps/web/src/app/login/page.tsx`: **DOES NOT EXIST**. Directory `apps/web/src/app/login` is absent.
   - `apps/web/src/app/signup/page.tsx`: **DOES NOT EXIST**. Directory `apps/web/src/app/signup` is absent.
   - `apps/web/src/app/` currently contains only: `api/`, `inspector/`, `projects/`, `globals.css`, `icon.tsx`, `layout.tsx`, `not-found.tsx`, `page.tsx`.

2. **Design System & Form Primitives**:
   - `apps/web/src/components/ui/` **DOES NOT EXIST**.
   - Instead, the reusable accessible form components reside in `apps/web/src/components/form/`:
     - `apps/web/src/components/form/form-field.tsx` (lines 96–180): `FormField` primitive providing WCAG 2.2 AA compliant `aria-invalid`, `aria-describedby`, `aria-required`, `label`, `description`, and error alert banner with `AlertCircle` icon and `aria-live="polite"`.
     - `apps/web/src/components/form/form-inputs.tsx` (lines 18–67, 278–336): `FormInput` (supports `leftIcon`, `rightIcon`, focus rings, destructive styling) and `FormSummaryErrors` (top-level accessible error banner with keyboard focus navigation to invalid fields).
     - Both primitives are 100% compliant with `@tanstack/react-form` + `zod` as verified in `apps/web/src/__tests__/form.test.tsx` (lines 170–260).
   - Component styling: buttons across existing pages (`apps/web/src/app/page.tsx` line 53, `apps/web/src/app/projects/page.tsx` line 98) use Tailwind utility classes (`inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm`).

3. **Orval-Generated Auth Endpoints**:
   - `apps/web/src/lib/api/generated/endpoints/auth/auth.ts`:
     - `authControllerRegister` (`POST /api/v1/auth/register`, lines 70–98)
     - `authControllerLogin` (`POST /api/v1/auth/login`, lines 160–190)
     - `authControllerMe` (`GET /api/v1/auth/me`, lines 253–270)
     - **No logout endpoint** currently exists in the generated API client.

4. **Frontend Fetch Client Credentials**:
   - `apps/web/src/lib/api/custom-instance.ts` (lines 157–160):
     ```typescript
     const response = await fetch(fullUrl, {
       ...options,
       headers,
     });
     ```
     `credentials: 'include'` is **NOT configured**. Fetch defaults to `'same-origin'`. Cross-origin browser requests (e.g. `http://localhost:3000` to `http://localhost:3001` or `https://app.erppreflight.com` to `https://api.erppreflight.com`) will neither transmit nor store cookies.

---

### 1.2 R4: NestJS Backend Authentication & Cookie Handling

1. **`AuthController`**:
   - `apps/api/src/modules/auth/auth.controller.ts` (lines 15–35):
     ```typescript
     @Controller('auth')
     export class AuthController {
       constructor(private readonly authService: AuthService) {}

       @Post('register')
       async register(@Body() dto: RegisterDto) {
         return this.authService.register(dto);
       }

       @Post('login')
       @HttpCode(HttpStatus.OK)
       async login(@Body() dto: LoginDto) {
         return this.authService.login(dto);
       }

       @UseGuards(JwtAuthGuard)
       @Get('me')
       async me(@CurrentUser() user: any) {
         return { user };
       }
     }
     ```
   - No `@Res({ passthrough: true })` is injected into `login()` or `register()`.
   - No `Set-Cookie` header or `res.cookie()` call is executed anywhere in `AuthController`.
   - No `POST /api/v1/auth/logout` endpoint exists.

2. **`AuthService`**:
   - `apps/api/src/modules/auth/auth.service.ts` (lines 98–107, 151–162):
     Both `register()` and `login()` return `{ accessToken: token, user: { ... } }`. Password verification uses Argon2id with automatic rehash from legacy SHA-256 (lines 34–42, 131–138).

3. **`JwtStrategy` Token Extraction**:
   - `apps/api/src/modules/auth/strategies/jwt.strategy.ts` (lines 8–17):
     ```typescript
     @Injectable()
     export class JwtStrategy extends PassportStrategy(Strategy) {
       constructor(config: ConfigService) {
         super({
           jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
           ignoreExpiration: false,
           secretOrKey:
             config.get<string>('JWT_SECRET') ||
             'secret-key-must-be-at-least-32-chars-long-abcdef123456',
         });
       }
     ```
   - `jwtFromRequest` strictly uses `ExtractJwt.fromAuthHeaderAsBearerToken()`.
   - It **does not check** `Cookie: erppreflight_session` or `req.cookies`. Any request authenticated solely by cookie is rejected with HTTP 401 Unauthorized.

4. **HTTP Platform & Cookie Parser Availability**:
   - `apps/api/package.json` (line 30):
     `"@nestjs/platform-express": "^11.0.11"`. The NestJS application runs on **Express**, not Fastify.
   - `apps/api/src/main.ts` (lines 28–30):
     `const app = await NestFactory.create(AppModule, { bufferLogs: true });` (uses Express by default).
   - In Express, `res.cookie()` and `res.clearCookie()` are **native methods** on Express's `Response` object and require no third-party libraries.
   - `cookie-parser` is **not installed** in `apps/api/package.json`. Node module resolution confirms `require.resolve('cookie-parser')` returns `NOT FOUND`.
   - Without `cookie-parser`, `req.cookies` is undefined; however, the raw `Cookie` header is always accessible at `req.headers.cookie`.

5. **CORS Configuration**:
   - `apps/api/src/main.ts` (lines 47–58):
     `app.enableCors({ origin: allowedOrigins, credentials: true, ... })` is already configured with `credentials: true`. Allowed origins default to `['http://localhost:3000', 'https://erppreflight.com']`.

---

### 1.3 R5: Canonical API URL Resolution

1. **Current `resolveApiUrl()` Implementation**:
   - `apps/web/src/lib/api/custom-instance.ts` (lines 105–123):
     ```typescript
     export const resolveApiUrl = (path: string): string => {
       if (path.startsWith('http://') || path.startsWith('https://')) {
         return path;
       }

       const rawBase =
         process.env.NEXT_PUBLIC_API_URL ||
         (typeof window !== 'undefined' ? '' : 'http://localhost:4000');

       let cleanBase = rawBase.replace(/\/+$/, '');
       const cleanPath = path.startsWith('/') ? path : `/${path}`;

       // If base ends with /api/v1 and path starts with /api/v1, strip prefix from base
       if (cleanBase.endsWith('/api/v1') && cleanPath.startsWith('/api/v1')) {
         cleanBase = cleanBase.slice(0, -'/api/v1'.length);
       }

       return `${cleanBase}${cleanPath}`;
     };
     ```

2. **Divergent Path Conventions Across Frontend Callers**:
   - In `apps/web/src/lib/api-client.ts`:
     - Line 104: `customInstance<Project[]>('/projects')` (no `/api/v1` prefix)
     - Line 140: `customInstance('/findings...')` (no `/api/v1` prefix)
     - Line 180: `customInstance('/analyses', ...)` (no `/api/v1` prefix)
     - Line 206: `customInstance('/dashboard/summary')` (no `/api/v1` prefix)
     - Line 218: `customInstance('/engines/status')` (no `/api/v1` prefix)
   - In Orval-generated client (`apps/web/src/lib/api/generated/endpoints/auth/auth.ts`):
     - Line 71: `getAuthControllerRegisterUrl()` returns `/api/v1/auth/register` (has `/api/v1` prefix)
     - Line 164: `getAuthControllerLoginUrl()` returns `/api/v1/auth/login` (has `/api/v1` prefix)
     - Line 257: `getAuthControllerMeUrl()` returns `/api/v1/auth/me` (has `/api/v1` prefix)

3. **Backend Global Route Prefix**:
   - `apps/api/src/main.ts` (line 60):
     ```typescript
     app.setGlobalPrefix('api/v1', {
       exclude: ['health', 'health/liveness', 'health/readiness'],
     });
     ```
     All API routes live strictly under `/api/v1/*`. Requests to `/projects` or `/findings` return HTTP 404.

4. **Environment Configurations Missing `/api/v1`**:
   - `AGENTS.md` (line 311): `NEXT_PUBLIC_API_URL=http://localhost:3001` (missing `/api/v1`)
   - `.env.example` (line 46): `NEXT_PUBLIC_API_URL=https://api.erppreflight.com` (missing `/api/v1`)
   - `docker-compose.yaml` (line 246): `NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-https://api.erppreflight.com}` (missing `/api/v1`)
   - `docker-compose.coolify.yml` (line 282): `NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-https://api.erppreflight.com}` (missing `/api/v1`)
   - `infra/coolify/docker-compose.coolify.yml` (line 261): `NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-https://api.erppreflight.com}` (missing `/api/v1`)
   - `infra/coolify/.env.coolify.example` (line 21): `NEXT_PUBLIC_API_URL=https://api.erppreflight.com` (missing `/api/v1`)
   - `.env.coolify.example` (line 15): `NEXT_PUBLIC_API_URL=https://api.erppreflight.com` (missing `/api/v1`)
   - `apps/web/src/lib/api/custom-instance.ts` (line 112): hardcoded fallback `'http://localhost:4000'` (wrong port and missing `/api/v1`).

5. **Existing Test Coverage**:
   - Search across `apps/web/src/__tests__` and `apps/api` found **zero tests** for `resolveApiUrl()` or `custom-instance.ts`.

---

## 2. Logic Chain

```
[Observation 1.1.1] apps/web/src/app/login and signup do not exist
         │
         ├──> [Logic Step 1] Users cannot authenticate or register via the Web UI.
         │    Need /login and /signup App Router pages utilizing TanStack Form + Zod.
         │
[Observation 1.1.2] apps/web/src/components/form contains FormField and FormInput
         │
         ├──> [Logic Step 2] Accessible form primitives already exist in components/form/.
         │    They support Zod validation, WCAG 2.2 AA ARIA attributes, and error banners.
         │    No external component library is needed; existing primitives satisfy Axiom 1.
         │
[Observation 1.1.4] apps/web/src/lib/api/custom-instance.ts lacks credentials: 'include'
         │
         ├──> [Logic Step 3] Browser fetch in customInstance omits cookies on cross-origin
         │    requests (port 3000 to port 3001 or subdomain to API).
         │    Adding credentials: 'include' ensures HttpOnly session cookies are transmitted.
         │
[Observation 1.2.1] AuthController lacks res.cookie() and lacks POST /api/v1/auth/logout
         │
         ├──> [Logic Step 4] Even upon successful login/register, no session cookie is set.
         │    Injecting @Res({ passthrough: true }) res: Response allows issuing
         │    Set-Cookie: erppreflight_session=...; HttpOnly; Secure; SameSite=Lax; Path=/
         │    and adding logout endpoint clears the cookie.
         │
[Observation 1.2.3] JwtStrategy only extracts from Bearer Authorization header
         │
         ├──> [Logic Step 5] Cookie-authenticated requests fail with 401 Unauthorized.
         │    Updating JwtStrategy to use ExtractJwt.fromExtractors([
         │      ExtractJwt.fromAuthHeaderAsBearerToken(),
         │      cookieExtractor
         │    ]) enables seamless dual Bearer and Cookie authentication.
         │
[Observation 1.2.4] apps/api runs on Express; cookie-parser is not installed
         │
         ├──> [Logic Step 6] Express native res.cookie() and res.clearCookie() work out-of-the-box.
         │    For reading cookies in cookieExtractor, extracting from req.headers.cookie
         │    via regex /(?:^|;\s*)erppreflight_session=([^;]+)/ requires zero dependencies
         │    and avoids package bloat, while still supporting req.cookies if cookie-parser is added.
         │
[Observation 1.3.1, 1.3.2, 1.3.3] NEXT_PUBLIC_API_URL lacks /api/v1, callers pass /projects
         │
         ├──> [Logic Step 7] When cleanBase = 'http://localhost:3001' and cleanPath = '/projects',
         │    cleanBase.endsWith('/api/v1') is false and cleanPath.startsWith('/api/v1') is false.
         │    resolveApiUrl yields 'http://localhost:3001/projects', causing HTTP 404 because
         │    the backend route prefix is /api/v1.
         │
[Observation 1.3.4, 1.3.5] Multiple env files omit /api/v1; fallback is port 4000; 0 tests exist
         │
         └──> [Logic Step 8] Canonicalizing env configurations to .../api/v1, correcting
              fallback to http://localhost:3001/api/v1, updating resolveApiUrl to auto-prepend
              /api/v1 when both cleanBase and cleanPath lack it, and creating comprehensive unit
              tests prevents all URL permutation 404 errors.
```

---

## 3. Caveats

1. **`Secure` Cookie Flag in Development/Testing**:
   - RFC 6265bis specifies that `http://localhost` is a secure context in modern Chromium/Firefox/WebKit, so `Secure` cookies work on localhost in modern browsers and Playwright.
   - However, in pure HTTP test environments or custom hostnames (e.g. `http://host.docker.internal`), browsers reject `Secure` cookies over unencrypted connections.
   - **Recommendation**: Set `secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true'`. For automated test assertions requiring the literal `Secure` attribute in header strings, test runners can assert against production mode or `COOKIE_SECURE=true`.

2. **Orval Response Typing (`data: void`)**:
   - Because NestJS `AuthController` currently lacks `@ApiOkResponse({ type: ... })` Swagger decorators, Orval generated `export type authControllerLoginResponse200 = { data: void; status: 200 }`.
   - At runtime, `customInstance` returns the actual parsed JSON payload (`{ accessToken: string, user: ... }`).
   - If frontend code uses Orval's `useAuthControllerLogin()`, it should cast or handle the response data properly, or a lightweight wrapper function `loginUser()` / `registerUser()` can be provided in `apps/web/src/lib/api-client.ts`.

3. **`cookie-parser` vs Regex Header Extraction**:
   - Adding `cookie-parser` to `apps/api/package.json` requires running `pnpm add cookie-parser @types/cookie-parser` and adding `app.use(cookieParser())` in `apps/api/src/main.ts`.
   - Alternatively, a regex extractor `(req.headers.cookie || '').match(/(?:^|;\s*)erppreflight_session=([^;]+)/)` runs directly in Node.js with zero dependencies.
   - Both can be combined: check `req.cookies?.['erppreflight_session']` first, then fall back to `req.headers.cookie`.

4. **No other caveats**: The codebase is clean, tests run quickly under Vitest, and architecture boundaries are clear.

---

## 4. Conclusion & Actionable Blueprint

### 4.1 Requirement R4 Blueprint

#### Step 1: Update `apps/api/src/modules/auth/auth.controller.ts`
- Inject `@Res({ passthrough: true }) res: Response` from `'express'`.
- In `register()`: set `res.cookie('erppreflight_session', result.accessToken, { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/' })`.
- In `login()`: set `res.cookie('erppreflight_session', result.accessToken, { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/' })`.
- Add `POST /logout` endpoint:
  ```typescript
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('erppreflight_session', {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
    });
    return { success: true, message: 'Logged out successfully' };
  }
  ```

#### Step 2: Update `apps/api/src/modules/auth/strategies/jwt.strategy.ts`
- Implement dual extractor supporting `Authorization: Bearer` and `erppreflight_session` cookie:
  ```typescript
  import { Request } from 'express';

  const cookieExtractor = (req: Request): string | null => {
    if (!req) return null;
    if ((req as any).cookies && (req as any).cookies['erppreflight_session']) {
      return (req as any).cookies['erppreflight_session'];
    }
    const cookieHeader = req.headers?.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)erppreflight_session=([^;]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    }
    return null;
  };

  // In constructor:
  super({
    jwtFromRequest: ExtractJwt.fromExtractors([
      ExtractJwt.fromAuthHeaderAsBearerToken(),
      cookieExtractor,
    ]),
    ignoreExpiration: false,
    secretOrKey: config.get<string>('JWT_SECRET') || '...',
  });
  ```

#### Step 3: Update `apps/web/src/lib/api/custom-instance.ts`
- Add `credentials: 'include'` to `fetch(fullUrl, { ...options, credentials: 'include', headers })`.

#### Step 4: Implement `apps/web/src/app/login/page.tsx` & `apps/web/src/app/signup/page.tsx`
- Build accessible, styled authentication forms using:
  - `@tanstack/react-form` + `zod` validation schemas.
  - `FormField`, `FormInput`, `FormSummaryErrors` from `@/components/form`.
  - Non-color error representation, loading spinners (`Loader2`), dirty-state handling.
  - On submit: call API, save token and tenant ID via `setStoredAuthToken` and `setStoredTenantId`, and route to `/projects`.
  - Provide cross-links between Login and Signup.

---

### 4.2 Requirement R5 Blueprint

#### Step 1: Update `resolveApiUrl()` in `apps/web/src/lib/api/custom-instance.ts`
```typescript
export const resolveApiUrl = (path: string): string => {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const rawBase =
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined' ? '' : 'http://localhost:3001/api/v1');

  let cleanBase = rawBase.replace(/\/+$/, '');
  let cleanPath = path.startsWith('/') ? path : `/${path}`;

  // If path does not begin with /api/v1 and cleanBase does not end with /api/v1,
  // automatically prepend /api/v1 to cleanPath
  if (!cleanPath.startsWith('/api/v1') && !cleanBase.endsWith('/api/v1')) {
    cleanPath = `/api/v1${cleanPath}`;
  }

  // If base ends with /api/v1 and path starts with /api/v1, strip prefix from base
  if (cleanBase.endsWith('/api/v1') && cleanPath.startsWith('/api/v1')) {
    cleanBase = cleanBase.slice(0, -'/api/v1'.length);
  }

  return `${cleanBase}${cleanPath}`;
};
```

#### Step 2: Canonicalize Environment Configurations
Update the following files to use `.../api/v1`:
- `.env.example`: `NEXT_PUBLIC_API_URL=https://api.erppreflight.com/api/v1`
- `docker-compose.yaml`: `NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-https://api.erppreflight.com/api/v1}`
- `docker-compose.coolify.yml`: `NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-https://api.erppreflight.com/api/v1}`
- `infra/coolify/docker-compose.coolify.yml`: `NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-https://api.erppreflight.com/api/v1}`
- `.env.coolify.example`: `NEXT_PUBLIC_API_URL=https://api.erppreflight.com/api/v1`
- `infra/coolify/.env.coolify.example`: `NEXT_PUBLIC_API_URL=https://api.erppreflight.com/api/v1`
- `AGENTS.md`: `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1`

#### Step 3: Implement Unit Tests for `resolveApiUrl()`
Create `apps/web/src/__tests__/resolve-api-url.test.ts` testing the complete permutation matrix:
1. Full HTTP/HTTPS URLs (pass through unchanged).
2. Base with `/api/v1`, path with `/api/v1` (no duplication).
3. Base with `/api/v1`, path without `/api/v1` (appends cleanly).
4. Base without `/api/v1`, path with `/api/v1` (combines cleanly).
5. Base without `/api/v1`, path without `/api/v1` (auto-prepends `/api/v1`).
6. Empty base (browser relative URL), path with or without `/api/v1`.
7. Trailing slashes in base (`/api/v1/` or `/api/v1///`).
8. Missing leading slashes in path (`projects`, `api/v1/projects`).
9. Default SSR fallback port (3001 with `/api/v1`).

---

## 5. Verification Method

### 5.1 Verification Commands

```bash
# 1. Test Web App (including form, badges, and new resolve-api-url tests)
pnpm --filter @erppreflight/web test

# 2. Test API Backend (including auth service, controller, and strategy tests)
pnpm --filter @erppreflight/api test

# 3. Monorepo Typecheck
pnpm run typecheck

# 4. Monorepo Lint
pnpm run lint
```

### 5.2 Files to Inspect

| Component | Target File | Verification Criteria |
|---|---|---|
| **Login Page** | `apps/web/src/app/login/page.tsx` | Renders email/password inputs, TanStack Form validation, error alert, redirect on success |
| **Signup Page** | `apps/web/src/app/signup/page.tsx` | Renders org name, email, password (min 8 chars), TanStack Form validation, redirect on success |
| **Auth Controller** | `apps/api/src/modules/auth/auth.controller.ts` | Sets `erppreflight_session` HttpOnly cookie on register/login; `POST /logout` clears cookie |
| **JWT Strategy** | `apps/api/src/modules/auth/strategies/jwt.strategy.ts` | Extracts token from both `Authorization: Bearer` and `Cookie: erppreflight_session` |
| **API Client** | `apps/web/src/lib/api/custom-instance.ts` | `credentials: 'include'` set on fetch; `resolveApiUrl` prepends `/api/v1` if missing |
| **URL Unit Tests** | `apps/web/src/__tests__/resolve-api-url.test.ts` | 100% pass rate across all 9 URL permutation test cases |

### 5.3 Invalidation Conditions
- A browser request to `GET /api/v1/auth/me` with only `Cookie: erppreflight_session=<token>` returns HTTP 401.
- Calling `resolveApiUrl('/projects')` when `NEXT_PUBLIC_API_URL='https://api.erppreflight.com'` returns anything other than `'https://api.erppreflight.com/api/v1/projects'`.
- Calling `resolveApiUrl('/api/v1/auth/login')` when `NEXT_PUBLIC_API_URL='https://api.erppreflight.com/api/v1'` produces double prefix `.../api/v1/api/v1/...`.
- `fetch()` in `custom-instance.ts` omits `credentials: 'include'`, causing cross-origin session loss.
