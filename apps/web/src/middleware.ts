import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, LOCALE_HEADER } from './i18n/config';
import { routing } from './i18n/routing';
import { resolveRoute } from './lib/routing';
import { buildContentSecurityPolicy, generateNonce } from './lib/csp';

const intlMiddleware = createIntlMiddleware(routing);

/**
 * - Public website: delegated to next-intl (locale-prefixed `/en|de/...`,
 *   redirects for unprefixed public URLs, locale cookie).
 * - Private app routes: navigation guard (→ /login) and locale from the
 *   preference cookie, passed to server components via a request header.
 * - Every document gets a nonce-based Content-Security-Policy. The policy is also
 *   put on the request so Next.js applies the nonce to its own inline scripts.
 * Rules live in src/lib/routing.ts and src/lib/csp.ts (unit-tested there).
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = resolveRoute({
    pathname,
    search,
    hasCookie: (name) => Boolean(request.cookies.get(name)?.value),
    preferredLocale: request.cookies.get(LOCALE_COOKIE)?.value,
  });

  if (decision.action === 'redirect') {
    return NextResponse.redirect(new URL(decision.location, request.url), decision.status);
  }

  const csp = buildContentSecurityPolicy({
    nonce: generateNonce(),
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    dev: process.env.NODE_ENV !== 'production',
    upgradeInsecureRequests: (process.env.NEXT_PUBLIC_APP_URL || '').startsWith('https://'),
  });
  request.headers.set('content-security-policy', csp);

  let response: NextResponse;
  if (decision.action === 'intl') {
    response = intlMiddleware(request);
  } else {
    const headers = new Headers(request.headers);
    headers.set(LOCALE_HEADER, decision.locale);
    response = NextResponse.next({ request: { headers } });
  }
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // Skip Next internals, route handlers under /api and files with an extension.
  matcher: ['/((?!_next/|api/|.*\\.[a-zA-Z0-9]+$).*)'],
};
