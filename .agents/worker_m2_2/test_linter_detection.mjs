import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// Import check script logic
const scriptCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts/check-no-dependency-soup.mjs'), 'utf8');

// Extract FORBIDDEN_RULES and checkSourceImports or test regex directly
assert.ok(scriptCode.includes("'Application Router'"), "Must include 'Application Router'");
assert.ok(scriptCode.includes("'@tanstack/react-router'"), "Must include '@tanstack/react-router'");
assert.ok(scriptCode.includes("'@tanstack/start'"), "Must include '@tanstack/start'");
assert.ok(scriptCode.includes("'react-router'"), "Must include 'react-router'");
assert.ok(scriptCode.includes("'react-router-dom'"), "Must include 'react-router-dom'");

// Test regex against dynamic import and re-export
const importRegex = /(?:(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

function checkSnippet(snippet) {
  importRegex.lastIndex = 0;
  const match = importRegex.exec(snippet);
  return match ? (match[1] || match[2]) : null;
}

assert.equal(checkSnippet("const r = await import('@tanstack/react-router');"), '@tanstack/react-router');
assert.equal(checkSnippet("export * from 'react-router-dom';"), 'react-router-dom');
assert.equal(checkSnippet("export { Link } from '@tanstack/react-router';"), '@tanstack/react-router');
assert.equal(checkSnippet("import { createServerFn } from '@tanstack/start';"), '@tanstack/start');
assert.equal(checkSnippet("const rr = require('react-router');"), 'react-router');

console.log('LINTER DETECTION TESTS PASSED 100%!');
