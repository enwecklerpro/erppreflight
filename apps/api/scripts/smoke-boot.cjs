// Boot smoke test: resolves the full AppModule dependency graph from the compiled
// build (dist/). Unit tests never import AppModule, so a missing provider/module
// import only surfaced as a crash at container start. Run after `pnpm build`.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-jwt-secret-0123456789abcdef0123456789';
const path = require('path');
const { Test } = require('@nestjs/testing');
const { AppModule } = require(path.resolve(__dirname, '../dist/src/app.module.js'));

(async () => {
  const started = Date.now();
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    console.log(`[smoke] AppModule dependency graph resolved in ${Date.now() - started}ms`);
    await moduleRef.close().catch(() => {});
    process.exit(0);
  } catch (err) {
    console.error('[smoke] AppModule failed to compile:', err && err.message);
    process.exit(1);
  }
})();
