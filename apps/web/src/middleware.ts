import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, LOCALE_HEADER } from './i18n/config';
import { resolveRoute } from './lib/routing';

/**
 * Locale routing for the public website and navigation guard for private routes.
 * See src/lib/routing.ts for the rules (unit-tested there).
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

  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, decision.locale);

  if (decision.action === 'rewrite') {
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    return NextResponse.rewrite(url, { request: { headers } });
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Skip Next internals, route handlers under /api and files with an extension.
  matcher: ['/((?!_next/|api/|.*\\.[a-zA-Z0-9]+$).*)'],
};
