import * as fs from 'node:fs';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Serves the OpenAPI document and the Scalar API reference (Part 21.38, C §47):
 *   GET /api/v1/openapi.json   OpenAPI 3 document
 *   GET /api/v1/reference      Scalar UI (self-hosted bundle, no CDN)
 * Enabled by main.ts only when ENABLE_SWAGGER or ENABLE_API_REFERENCE is true
 * (always outside production).
 */

export function resolveScalarBundle(): string | null {
  const candidates = [
    path.resolve(__dirname, '../vendor/scalar/standalone.js'), // dist/src/observability → dist/vendor
    path.resolve(__dirname, '../../vendor/scalar/standalone.js'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Development (ts / unbuilt): the devDependency inside apps/api/node_modules.
  const dev = path.resolve(__dirname, '../../node_modules/@scalar/api-reference/dist/browser/standalone.js');
  return fs.existsSync(dev) ? dev : null;
}

export function referenceHtml(specUrl: string, bundleUrl: string): string {
  const configuration = JSON.stringify({ withDefaultFonts: false, hideClientButton: false, theme: 'default' }).replace(/'/g, '&#39;');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>ERP Preflight API Reference</title>
  </head>
  <body>
    <script id="api-reference" data-url="${specUrl}" data-configuration='${configuration}'></script>
    <script src="${bundleUrl}"></script>
  </body>
</html>`;
}

export function registerApiReference(app: INestApplication, document: OpenAPIObject): void {
  const http = app.getHttpAdapter().getInstance();
  const bundle = resolveScalarBundle();
  const specJson = JSON.stringify(document);

  http.get('/api/v1/openapi.json', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(specJson);
  });

  http.get('/api/v1/reference', (_req: any, res: any) => {
    if (!bundle) {
      res.status(503).json({ statusCode: 503, message: 'API reference bundle is not installed in this build' });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(referenceHtml('/api/v1/openapi.json', '/api/v1/reference/standalone.js'));
  });

  http.get('/api/v1/reference/standalone.js', (_req: any, res: any) => {
    if (!bundle) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(bundle).pipe(res);
  });
}
