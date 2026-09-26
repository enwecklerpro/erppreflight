// Copies the self-contained Scalar API reference bundle (Part 21.38) into dist/ so the
// production image serves it without a CDN and without shipping the package at runtime.
const fs = require('fs');
const path = require('path');

const apiRoot = path.resolve(__dirname, '..');
const src = require.resolve('@scalar/api-reference/dist/browser/standalone.js', { paths: [apiRoot] });
const destDir = path.join(apiRoot, 'dist', 'vendor', 'scalar');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'standalone.js'));
console.log('[api-reference] copied Scalar standalone bundle -> dist/vendor/scalar/standalone.js');
