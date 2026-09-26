import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, LOCALE_HEADER } from './i18n/config';
import { routing } from './i18n/routing';
import { resolveRoute } from './lib/routing';

const intlMiddleware = createIntlMiddleware(routing);

/**
 * - Public website: delegated to next-intl (locale-prefixed `/en|de/...`,
 *   redirects for unprefixed public URLs, locale cookie).
 * - Private app routes: navigation guard (→ /login) and locale from the
 *   preference cookie, passed to server components via a request header.
 * Rules live in src/lib/routing.ts (unit-tested there).
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = resolveRoute({
    pathname,
    search,
    hasCookie: (name) => Boolean(request.cookies.get(name)?.value),
    preferredLocale: request.cookies.get(LOCALE_COOKIE)?.value,
  });

  if (decision.action === 'intl') {
    return intlMiddleware(request);
  }
  if (decision.action === 'redirect') {
    return NextResponse.redirect(new URL(decision.location, request.url), decision.status);
  }

  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, decision.locale);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Skip Next internals, route handlers under /api and files with an extension.
  matcher: ['/((?!_next/|api/|.*\\.[a-zA-Z0-9]+$).*)'],
};
