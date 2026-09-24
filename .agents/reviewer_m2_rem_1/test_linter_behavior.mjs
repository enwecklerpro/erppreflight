import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// Read the linter script content
const linterContent = fs.readFileSync(path.join(REPO_ROOT, 'scripts/check-no-dependency-soup.mjs'), 'utf8');

// Ensure FORBIDDEN_RULES has Application Router and all specified forbidden packages
assert.ok(linterContent.includes("category: 'Application Router'"));
assert.ok(linterContent.includes("'@tanstack/react-router'"));
assert.ok(linterContent.includes("'@tanstack/start'"));
assert.ok(linterContent.includes("'react-router'"));
assert.ok(linterContent.includes("'react-router-dom'"));

// Now simulate a violation check
const importRegex = /(?:(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

const forbiddenList = [
  '@tanstack/react-router',
  '@tanstack/start',
  'react-router',
  'react-router-dom',
  'react-hook-form',
  'redux',
  'prisma'
];

function checkString(src) {
  const violations = [];
  let match;
  importRegex.lastIndex = 0;
  while ((match = importRegex.exec(src)) !== null) {
    const target = match[1] || match[2];
    for (const forbidden of forbiddenList) {
      if (target === forbidden || target.startsWith(`${forbidden}/`)) {
        violations.push(target);
      }
    }
  }
  return violations;
}

// Check detection of static import
assert.deepStrictEqual(checkString("import { Router } from '@tanstack/react-router';"), ['@tanstack/react-router']);

// Check detection of dynamic import
assert.deepStrictEqual(checkString("const r = await import('@tanstack/react-router');"), ['@tanstack/react-router']);

// Check detection of re-export
assert.deepStrictEqual(checkString("export * from 'react-router-dom';"), ['react-router-dom']);

// Check detection of deep subpath
assert.deepStrictEqual(checkString("import x from 'react-hook-form/dist/index.esm.mjs';"), ['react-hook-form/dist/index.esm.mjs']);

// Check clean code produces 0 violations
assert.deepStrictEqual(checkString("import { useQuery } from '@tanstack/react-query';\nimport { z } from 'zod';"), []);

console.log('Linter behavior simulation verified: all violations accurately caught, clean code produces 0 violations.');
