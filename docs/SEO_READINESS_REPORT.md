# SEO & Growth Readiness Report

> Spec C §73 (Definition of Done — Growth), C §43–§46, Part 02 §2.5–§2.15 / §75 #9.

| Field | Value |
|---|---|
| Commit | `6303f1d` on `claude/sharp-mendel-xg6cus` |
| Date | 2026-09-26 |
| Deployment checked | **None.** Nothing was checked on erppreflight.com: no live crawl, no Search Console, no Lighthouse/Core Web Vitals measurement. Results below are from the local production build |
| Commands (all passed) | `WEB_URL=… node scripts/e2e-public-smoke.cjs` (EN/DE public pages); `WEB_URL=… API_BASE_URL=… node scripts/e2e-tools-smoke.cjs` (24 checks); `WEB_URL=… node scripts/e2e-i18n-smoke.cjs` (5 public + 32 app pages in DE, 375/1440 px); web unit tests 233 passed incl. `apps/web/src/__tests__/seo-routes.test.ts`, `i18n.test.ts`, `i18n-hardcoded-text.test.ts` |
| Programmatic SEO gate (local, after real Cloudification sync) | **655** SAP object pages pass the quality gate and are indexable; all others are served `noindex` or 404 |

## C §73 checklist

| Item | Status | Evidence |
|---|---|---|
| Public marketing site | Done (local) | `apps/web/src/app/[locale]/page.tsx`; solutions `[locale]/solutions/[slug]` (6 slugs in `lib/solutions.ts`); footer with SAP independence disclaimer (`components/public/site-footer.tsx`) |
| Pricing | Done (local) | `[locale]/pricing/page.tsx`; data from `GET /api/v1/billing/plans` (`lib/plans.ts`), prices from the plan catalog, never hard-coded; ENTERPRISE/PARTNER shown as contact sales |
| EN/DE | Done (public), Partial (app) | next-intl, `localePrefix: 'always'` (`src/i18n/routing.ts`), `/en` + `/de`, hreflang incl. `x-default` (`lib/seo.ts` `hreflangAlternates`); DE dictionary typed against EN. App gaps: integrations UI, launcher/run history, API errors, engine texts English |
| Programmatic SEO | Done (local) | `[locale]/sap/clean-core/[object]`, `[locale]/sap/cloud/migration/[object]`, rendered on demand (`components/tools/sap-object-page.tsx`); quality gate `evaluateSeoGate` (`packages/schemas/src/public-tools.ts`) |
| Free tools | Done (local) | `[locale]/tools/[tool]`, 6 tools (`lib/tools.ts`): clean-core-lookup, cloud-successor, api-deprecations, xml-field-checker, fiori-403, search; API `public/tools/*` (`public-tools.controller.ts`); each result links to signup |
| Knowledge pages | Done (local) | `[locale]/knowledge/[slug]`; 7 seeded articles in EN and DE (`apps/api/src/modules/knowledge/knowledge-seed.ts`); API `GET /api/v1/public/knowledge[/:slug]?locale=`; content workflow (migration 019) |
| Docs | Done (local) | `[locale]/docs/[slug]` (7 pages in `lib/docs/pages.ts`, content EN/DE), `[locale]/docs/engines/[engine]` generated from the live engine catalog |
| API docs | Partial | Scalar reference `/api/v1/reference` + `/api/v1/openapi.json` (`apps/api/src/observability/api-reference.ts`); in production served only with `ENABLE_API_REFERENCE=true`; docs page `api-cli` |
| Sitemap | Done (local) | `app/sitemap.xml/route.ts` sitemap index → `sitemaps/pages.xml`, `knowledge.xml`, `sap-objects-N.xml` (`lib/sitemap.ts`, only gate-passing objects via `GET public/tools/seo/sitemap/objects`); `app/robots.ts` disallows `PRIVATE_ROUTE_PREFIXES` |
| Legal pages | Done (structure), owner review needed | `[locale]/legal/[doc]`: imprint, privacy, terms, cookies, subprocessors, dpa (`lib/routing.ts` `LEGAL_DOCS`); operator data from `NEXT_PUBLIC_LEGAL_*` (`lib/legal.ts`); `[locale]/security`; cookie settings (`components/public/cookie-consent.tsx`). Texts need lawyer review; values must be set in production |

## Programmatic SEO quality gate (Part 02 §2.9, C §43)

A page is indexable only when all checks pass (`evaluateSeoGate`):

| Check | Rule |
|---|---|
| `GLOBAL_REVIEWED` | global object, published snapshot |
| `OBJECT_TYPE` | object type known |
| `RELEASE_STATE` | at least one release state |
| `SUCCESSOR_OR_EXPLICIT_NONE` | not-released objects need a successor or successor concept |
| `EVIDENCE_SOURCE` | every evidence source `OFFICIAL_*` with a retrieval date |
| `RELATED_OBJECTS` | ≥ 2 related objects (`SEO_MIN_RELATED_OBJECTS`) |

Pages that fail are rendered with `robots: noindex` and the reason; unknown objects return 404. Migration pages exist
only for objects where a migration statement applies; the Cloudification data contains no transaction codes, so
`/en/sap/cloud/migration/va01` (a spec example) returns 404 by design. Page content: release states, successors,
graph-derived related objects (up to 24 shown), evidence with source host and retrieval date, CTA.

## Part 02 items

| Section | Status | Evidence / gap |
|---|---|---|
| 2.5 Homepage (hero, CTAs, sections) | Done | `[locale]/page.tsx` |
| 2.6 Solution pages | Partial | 6 slugs; spec lists 7 (`output-forms`, `cloud-migration`, `clean-core` …); implemented slugs combine them (`output-extensibility`, `migration-clean-core`, …) |
| 2.7 i18n with hreflang, human translation | Done (public) | see above; no machine translation |
| 2.8 Problem pages (`/sap/output/…`, `/sap/forms/…`, `/sap/change-pointers/…`, `/sap/api/deprecations/…`) | Missing | Only clean-core and cloud-migration object pages exist; output/forms/change-pointer topics are covered by knowledge articles instead |
| 2.9 Sitemap index split by type | Done | image sitemap and RSS/Atom feed: not implemented |
| 2.10 Structured data | Done | `components/public/json-ld.tsx` and pages: Organization, SoftwareApplication, TechArticle, FAQPage, BreadcrumbList, ItemList, AggregateOffer |
| 2.11 Technical SEO | Partial | canonical + hreflang + OG/Twitter (`lib/seo.ts` `publicPageMetadata`), SSR, robots, dynamic sitemap, 404. Missing: 410 handling, redirect registry; Core Web Vitals not measured |
| 2.12 Internal linking from the graph | Done | related objects from `knowledge_relationships` on object pages |
| 2.13 Content workflow + last reviewed / release / provenance | Partial | workflow API (migration 019, `admin/knowledge`), `lastReviewed` shown on articles; no admin UI |
| 2.14 Analytics | Partial | consent banner with necessary/analytics choice; **no analytics vendor integrated**, no funnel events |
| 2.15 Legal/public pages | Done (structure) | see C §73 row; `/status` page exists; lawyer review pending |

## Owner actions

1. Set `NEXT_PUBLIC_APP_URL` (canonical/sitemap base) and all `NEXT_PUBLIC_LEGAL_*` values before the web build.
2. After deploy: run the knowledge sync once (`docs/LIVE_PRODUCTION_VERIFICATION.md` §3.3) — without it no SAP object
   page passes the gate and `sap-objects-*.xml` is empty.
3. Submit `https://erppreflight.com/sitemap.xml` in Google Search Console / Bing Webmaster Tools; run Lighthouse.
4. Have the legal texts reviewed.
