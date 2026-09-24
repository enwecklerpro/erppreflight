/**
 * ERP Preflight — Hostinger hPanel Node.js Application Startup File
 * Location: /server.js
 *
 * Boots the Next.js production web server from apps/web.
 */

const http = require('http');
const path = require('path');

const port = parseInt(process.env.PORT || '3000', 10);
const hostname = process.env.HOSTNAME || '0.0.0.0';

console.log(`[ERP Preflight] Initializing server on ${hostname}:${port}...`);

let next;
try {
  next = require('./apps/web/node_modules/next');
} catch (e1) {
  try {
    next = require('next');
  } catch (e2) {
    console.error('[ERP Preflight] Could not resolve Next.js:', e1, e2);
    process.exit(1);
  }
}

const dir = path.join(__dirname, 'apps', 'web');

const app = next({
  dev: false,
  dir,
  hostname,
  port,
});

const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), service: 'erppreflight-web' }));
        return;
      }
      handle(req, res);
    });

    server.listen(port, hostname, (err) => {
      if (err) {
        console.error('[ERP Preflight] Server listen error:', err);
        process.exit(1);
      }
      console.log(`[ERP Preflight Web] Ready on http://${hostname}:${port}`);
    });
  })
  .catch((err) => {
    console.error('[ERP Preflight] Startup failure:', err);
    process.exit(1);
  });
