// Copies the self-contained Scalar API reference bundle (Part 21.38) into dist/ so the
// production image serves it without a CDN and without shipping the package at runtime.
const fs = require('fs');
const path = require('path');

const apiRoot = path.resolve(__dirname, '..');
const src = path.join(apiRoot, 'node_modules', '@scalar', 'api-reference', 'dist', 'browser', 'standalone.js');
if (!fs.existsSync(src)) {
  console.error('[api-reference] @scalar/api-reference is not installed; run pnpm install');
  process.exit(1);
}
const destDir = path.join(apiRoot, 'dist', 'vendor', 'scalar');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'standalone.js'));
console.log('[api-reference] copied Scalar standalone bundle -> dist/vendor/scalar/standalone.js');
