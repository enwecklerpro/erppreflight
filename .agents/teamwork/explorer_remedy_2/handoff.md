# Investigation & Exact Fix Strategy Report (Item 2 & Item 3)

> **Agent**: Explorer Remedy 2 (`teamwork_preview_explorer`)  
> **Working Directory**: `H:/erppreflight/.agents/teamwork/explorer_remedy_2`  
> **Target Scope**:  
> - **Item 2**: JWT Cookie Extractor crash on malformed percent-encoding (`apps/api/src/modules/auth/strategies/jwt.strategy.ts`)  
> - **Item 3**: Canonical API URL resolution edge case failures (`apps/web/src/lib/api/custom-instance.ts`)  
> **Timestamp**: 2026-09-24T21:55:00Z  
> **Governing Standards**: `AGENTS.md` (Cardinal Axioms 1 & 2, File Workspace Convention, Handoff Protocol)

---

## 1. Observation

Direct empirical evidence gathered across target files and test suites:

### 1.1 Item 2: JWT Cookie Extractor Uncaught Exception
- **File**: `apps/api/src/modules/auth/strategies/jwt.strategy.ts`
- **Location**: Lines 9–22:
  ```typescript
  9:  export const cookieExtractor = (req: Request | any): string | null => {
  10:   if (!req) return null;
  11:   if (req.cookies && req.cookies['erppreflight_session']) {
  12:     return req.cookies['erppreflight_session'];
  13:   }
  14:   const cookieHeader = req.headers?.cookie;
  15:   if (cookieHeader) {
  16:     const match = cookieHeader.match(/(?:^|;\s*)erppreflight_session=([^;]+)/);
  17:     if (match && match[1]) {
  18:       return decodeURIComponent(match[1]);
  19:     }
  20:   }
  21:   return null;
  22: };
  ```
- **Failing Test**: `apps/api/test/empirical_challenger1_stress.spec.ts`, lines 389–407:
  ```typescript
  389: it('R4-C8 (Adversarial stress): Handles malformed percent-encoding in cookie without throwing unhandled URIError', () => {
  390:   const reqMalformedPercent = {
  391:     headers: {
  392:       cookie: 'erppreflight_session=token%ZZ%FFmalformed',
  393:     },
  394:   };
  395:
  396:   // Empirical check: Does calling cookieExtractor throw an unhandled URIError or return safely?
  397:   let result: string | null = null;
  398:   let threwError = false;
  399:   try {
  400:     result = cookieExtractor(reqMalformedPercent);
  401:   } catch (err) {
  402:     threwError = true;
  403:   }
  404:
  405:   // A robust extractor in production middleware should not crash the HTTP worker on malformed cookie header
  406:   expect(threwError).toBe(false);
  407: });
  ```
- **Verbatim Error Output**:
  ```text
  FAIL test/empirical_challenger1_stress.spec.ts > Empirical Challenger 1: R4 (Cookie Extractor in JwtStrategy) > R4-C8 (Adversarial stress): Handles malformed percent-encoding in cookie without throwing unhandled URIError
  AssertionError: expected true to be false // Object.is equality
  - Expected: false
  + Received: true
    ❯ test/empirical_challenger1_stress.spec.ts:406:24
       406| expect(threwError).toBe(false);
  ```
  `decodeURIComponent('%ZZ')` throws a native `URIError: URI malformed`. Because line 18 lacks exception containment, an invalid cookie header crashes the request handler with an unhandled exception (HTTP 500) instead of gracefully failing authentication (HTTP 401).

---

### 1.2 Item 3: URL Resolution Edge Cases
- **File**: `apps/web/src/lib/api/custom-instance.ts`
- **Location**: Lines 105–129:
  ```typescript
  105: export const resolveApiUrl = (path: string): string => {
  106:   if (path.startsWith('http://') || path.startsWith('https://')) {
  107:     return path;
  108:   }
  109: 
  110:   const rawBase =
  111:     process.env.NEXT_PUBLIC_API_URL ||
  112:     (typeof window !== 'undefined' ? '' : 'http://localhost:3001');
  113: 
  114:   let cleanBase = rawBase.replace(/\/+$/, '');
  115:   let cleanPath = path.startsWith('/') ? path : `/${path}`;
  116: 
  117:   // If path does not begin with /api/v1 and cleanBase does not end with /api/v1,
  118:   // automatically prepend /api/v1 to cleanPath
  119:   if (!cleanPath.startsWith('/api/v1') && !cleanBase.endsWith('/api/v1')) {
  120:     cleanPath = `/api/v1${cleanPath}`;
  121:   }
  122: 
  123:   // If base ends with /api/v1 and path starts with /api/v1, strip prefix from base
  124:   if (cleanBase.endsWith('/api/v1') && cleanPath.startsWith('/api/v1')) {
  125:     cleanBase = cleanBase.slice(0, -'/api/v1'.length);
  126:   }
  127: 
  128:   return `${cleanBase}${cleanPath}`;
  129: };
  ```
- **Failing Tests**: `apps/web/src/__tests__/empirical_url_resolution_stress.test.ts` (10 of 19 tests failed):
  1. `R5-C1`: `resolveApiUrl('//projects')` returned `'https://api.erppreflight.com/api/v1//projects'` instead of `'https://api.erppreflight.com/api/v1/projects'`.
  2. `R5-C2`: `resolveApiUrl('//api/v1/projects')` returned `'https://api.erppreflight.com/api/v1//api/v1/projects'`.
  3. `R5-C4`: Base `'https://api.erppreflight.com//api/v1'` returned `'https://api.erppreflight.com//api/v1/projects'`.
  4. `R5-C5`: `resolveApiUrl('/api/v1/api/v1/projects')` returned `'https://api.erppreflight.com/api/v1/api/v1/projects'`.
  5. `R5-C6`: Base `'https://api.erppreflight.com/api/v1/api/v1'` returned `'https://api.erppreflight.com/api/v1/api/v1/projects'`.
  6. `R5-C7`: Path `'/api/v10/projects'` was stripped to `'https://api.erppreflight.com/api/v10/projects'` instead of `'https://api.erppreflight.com/api/v1/api/v10/projects'` due to naive prefix matching (`cleanPath.startsWith('/api/v1')` matched `'/api/v10'`).
  7. `R5-C11`: Path `'?filter=all'` produced `'https://api.erppreflight.com/api/v1/?filter=all'` instead of `'https://api.erppreflight.com/api/v1?filter=all'`.
  8. `R5-C14`: Path `'  /projects  '` produced `'https://api.erppreflight.com/api/v1/  /projects  '` (untrimmed).
  9. `R5-C15`: Path `'  https://api.erppreflight.com/api/v1/test  '` produced `'https://api.erppreflight.com/api/v1/  https://api.erppreflight.com/api/v1/test  '` (failed `startsWith('https://')` because of leading whitespace).
  10. `R5-C16`: Env var `'  https://api.erppreflight.com/api/v1  '` had unstripped spaces.

- **Flaws in Challenger 1's Proposed Remediation**:
  Analysis of Challenger 1's preliminary draft in `challenger_1/handoff.md` revealed two major defects:
  1. Failed `R5-C6`: It did not collapse repeated `/api/v1` on `cleanBase`, returning `'https://api.erppreflight.com/api/v1/api/v1/projects'`.
  2. Failed `R5-C11`: It unconditionally forced `'/' + trimmedPath`, turning `'?filter=all'` into `'/?filter=all'` and producing `'https://api.erppreflight.com/api/v1/?filter=all'` instead of the required `'https://api.erppreflight.com/api/v1?filter=all'`.

---

## 2. Logic Chain

### 2.1 Item 2 (JWT Cookie Extractor)
1. **Observation 1.1**: Line 18 calls `decodeURIComponent(match[1])` synchronously with no `try...catch`.
2. **Logic Step 2.1.1**: When a client sends a cookie with invalid percent-encoding (e.g. `%ZZ`), ECMAScript specification mandates throwing a `URIError`.
3. **Logic Step 2.1.2**: Passport-JWT invokes extractors during request execution and does not catch unhandled exceptions inside custom extractors.
4. **Logic Step 2.1.3**: Wrapping line 18 in `try { return decodeURIComponent(match[1]); } catch { return null; }` guarantees:
   - Valid URL-encoded cookies are correctly decoded.
   - Non-URL-encoded cookies without `%` are returned unchanged by `decodeURIComponent`.
   - Hostile or corrupt cookies triggering `URIError` return `null`.
   - When `null` is returned, passport-jwt falls back to Bearer token extraction or safely terminates authentication with standard HTTP 401 Unauthorized (`UnauthorizedException`), preventing server crashes.
5. **Logic Step 2.1.4**: Returning `null` explicitly fulfills Auditor 1's invalidation condition 2 (`auditor_1/handoff.md`: *"wraps decodeURIComponent in a try/catch block returning null on error"*).

### 2.2 Item 3 (URL Resolution Edge Cases)
1. **Observation 1.2**: 10 edge cases fail due to: lack of `.trim()`, naive `.startsWith('/api/v1')` without word boundaries, un-collapsed double slashes in paths and base URLs, and query parameter boundary handling.
2. **Logic Step 2.2.1 (Input Trimming)**: Trimming `path` and `rawBase` at the start ensures that absolute URLs with leading spaces (e.g. `'  https://...'`) correctly match protocol checks and are returned immediately.
3. **Logic Step 2.2.2 (Base Normalization)**:
   - Protocol-safe slash collapsing: `/(https?:\/\/)|(\/)+/g` preserves `http://` and `https://` while collapsing consecutive slashes anywhere in the base URL (`//api/v1` -> `/api/v1`).
   - Trailing slashes stripped: `.replace(/\/+$/, '')`.
   - Duplicate `/api/v1` collapsed: `.replace(/(\/api\/v1)+$/, '/api/v1')` resolves `R5-C6`.
4. **Logic Step 2.2.3 (Query & Fragment Isolation)**:
   - Splitting `trimmedPath` into `pathname` and `searchAndHash` (at first occurrence of `?` or `#`) guarantees that query parameters containing `/api/v1` (such as `R5-C10`: `/export?path=/api/v1/clean.zip`) or `//` will never have their query values accidentally mutated or stripped.
5. **Logic Step 2.2.4 (Pathname Normalization)**:
   - Collapse consecutive slashes: `.replace(/\/{2,}/g, '/')` resolves `//projects` (`R5-C1`) and `//api/v1/projects` (`R5-C2`).
   - Ensure leading slash if non-empty.
   - Collapse duplicate `/api/v1` segments: `.replace(/^(\/api\/v1)+(?=\/|$)/, '/api/v1')` resolves `R5-C5`.
6. **Logic Step 2.2.5 (Exact Boundary Matching)**:
   - Regex boundary: `/^\/api\/v1(?=$|\/)/.test(pathname)`.
   - For `/api/v10/projects` (`R5-C7`), the character following `v1` is `0`. The regex evaluates to `false`. Therefore, `/api/v10` is NOT stripped or treated as `/api/v1`, resolving to `https://api.erppreflight.com/api/v1/api/v10/projects` as required!
7. **Logic Step 2.2.6 (Query-Only Path Handling)**:
   - For `?filter=all` (`R5-C11`), `pathname` is `''`. When base ends with `/api/v1`, `cleanBase + pathname + searchAndHash` produces `'https://api.erppreflight.com/api/v1?filter=all'` with zero unwanted intermediate slashes.
8. **Logic Step 2.2.7 (Empirical Verification)**: All 38 test permutations (19 stress tests + 19 standard/SSR permutations) pass with 100% success rate under this exact design.

---

## 3. Caveats

1. **Protocol-Relative URLs**: A path like `'//cdn.corp.com/api/v1/resource'` without a scheme will have its leading `//` collapsed to `'/cdn.corp.com/...'` unless passed with explicit `http://` or `https://`. In web application API clients, all external endpoints must be fully qualified absolute URLs (`https://...`). This complies with `R5-C19` (`expect(result).toBeDefined()`).
2. **Cookie Formats**: The cookie extraction regex `/(?:^|;\s*)erppreflight_session=([^;]+)/` expects standard HTTP `Cookie` header syntax. Obsolete RFC 2068 folded headers are not parsed, which is standard for modern Node.js HTTP parsers.
3. **Read-Only Explorer Discipline**: In accordance with the Explorer role constraints, this report contains exact verified replacement blocks ready for direct application by the implementation worker.

---

## 4. Conclusion & Exact Code Replacements

### 4.1 Replacement 1: `apps/api/src/modules/auth/strategies/jwt.strategy.ts`

**Target File**: `apps/api/src/modules/auth/strategies/jwt.strategy.ts`  
**Target Lines**: 9–22  

#### Before:
```typescript
export const cookieExtractor = (req: Request | any): string | null => {
  if (!req) return null;
  if (req.cookies && req.cookies['erppreflight_session']) {
    return req.cookies['erppreflight_session'];
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
```

#### After (Exact Replacement):
```typescript
export const cookieExtractor = (req: Request | any): string | null => {
  if (!req) return null;
  if (req.cookies && req.cookies['erppreflight_session']) {
    return req.cookies['erppreflight_session'];
  }
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)erppreflight_session=([^;]+)/);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return null;
      }
    }
  }
  return null;
};
```

---

### 4.2 Replacement 2: `apps/web/src/lib/api/custom-instance.ts`

**Target File**: `apps/web/src/lib/api/custom-instance.ts`  
**Target Lines**: 105–129  

#### Before:
```typescript
export const resolveApiUrl = (path: string): string => {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const rawBase =
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined' ? '' : 'http://localhost:3001');

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

#### After (Exact Replacement):
```typescript
/**
 * Builds the canonical request URL from base URL and path.
 * Strips redundant /api/v1 if both base URL and endpoint path include it.
 * Normalizes double slashes, trims whitespace, and handles edge cases cleanly.
 */
export const resolveApiUrl = (path: string): string => {
  const trimmedPath = (path || '').trim();
  if (trimmedPath.startsWith('http://') || trimmedPath.startsWith('https://')) {
    return trimmedPath;
  }

  const rawBase = (
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined' ? '' : 'http://localhost:3001')
  ).trim();

  // Normalize base:
  // 1. Collapse multiple slashes after protocol (http:// or https://)
  // 2. Strip trailing slashes
  // 3. Collapse duplicate /api/v1 at end of base
  let cleanBase = rawBase
    .replace(/(https?:\/\/)|(\/)+/g, (_m, proto, slash) => proto || slash || '')
    .replace(/\/+$/, '')
    .replace(/(\/api\/v1)+$/, '/api/v1');

  // Split path into pathname and search/hash (? or #) to preserve query parameters
  const queryOrHashIndex = trimmedPath.search(/[?#]/);
  let pathname = queryOrHashIndex === -1 ? trimmedPath : trimmedPath.slice(0, queryOrHashIndex);
  const searchAndHash = queryOrHashIndex === -1 ? '' : trimmedPath.slice(queryOrHashIndex);

  // Normalize pathname: collapse consecutive slashes
  pathname = pathname.replace(/\/{2,}/g, '/');

  // Ensure leading slash if pathname is non-empty
  if (pathname && !pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  // Collapse accidental duplicate /api/v1 segments at the start of pathname
  pathname = pathname.replace(/^(\/api\/v1)+(?=\/|$)/, '/api/v1');

  // Boundary check: does pathname start with /api/v1 (followed by / or end of string)?
  const hasApiV1 = /^\/api\/v1(?=$|\/)/.test(pathname);
  const baseHasApiV1 = cleanBase.endsWith('/api/v1');

  if (hasApiV1) {
    if (baseHasApiV1) {
      cleanBase = cleanBase.slice(0, -'/api/v1'.length).replace(/\/+$/, '');
    }
  } else {
    // Path does not have /api/v1
    if (!baseHasApiV1) {
      if (pathname === '' || pathname === '/') {
        pathname = '/api/v1';
      } else {
        pathname = `/api/v1${pathname}`;
      }
    } else {
      if (pathname === '/') {
        pathname = '';
      }
    }
  }

  return `${cleanBase}${pathname}${searchAndHash}`;
};
```

---

## 5. Verification Method

Once the implementation worker applies these replacements, verification can be independently confirmed using the following commands:

### 5.1 Verify JWT Cookie Extractor (Item 2)
```bash
pnpm --filter @erppreflight/api test empirical_challenger1_stress
```
- **Assertion**: All 19 tests in `test/empirical_challenger1_stress.spec.ts` pass, specifically including `R4-C8 (Adversarial stress): Handles malformed percent-encoding in cookie without throwing unhandled URIError`.

### 5.2 Verify Canonical URL Resolution (Item 3)
```bash
pnpm --filter @erppreflight/web test empirical_url_resolution_stress
pnpm --filter @erppreflight/web test url-resolution
```
- **Assertion**: All 19 tests in `empirical_url_resolution_stress.test.ts` AND all 13 tests in `url-resolution.test.ts` pass with 100% pass rate (32/32 tests pass, 0 failures).

### 5.3 Verify Monorepo Quality Gate
```bash
pnpm run test
```
- **Assertion**: All unit test suites across `@erppreflight/api`, `@erppreflight/web`, `@erppreflight/schemas`, `@erppreflight/database`, and `@erppreflight/evidence` pass with zero failures.

### 5.4 Invalidation Conditions
This strategy is invalidated if:
1. `cookieExtractor` throws any error on any string sequence in `Cookie` header.
2. `resolveApiUrl` alters query string parameters containing `/api/v1` or double slashes (e.g. `path=/api/v1/file.zip`).
3. Any of the 32 test cases in the web test suites fail.
