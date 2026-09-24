import assert from 'node:assert';

const importRegex = /(?:(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

const testCases = [
  // Static imports
  { input: `import '@tanstack/react-router'`, expected: '@tanstack/react-router' },
  { input: `import { Router } from '@tanstack/react-router'`, expected: '@tanstack/react-router' },
  { input: `import * as ReactRouter from 'react-router-dom'`, expected: 'react-router-dom' },
  { input: `import ReactRouter from "react-router"`, expected: 'react-router' },
  { input: `import type { Route } from '@tanstack/react-router'`, expected: '@tanstack/react-router' },

  // Multiline static imports
  {
    input: `import {
      Route,
      Router,
      useNavigate
    } from '@tanstack/react-router'`,
    expected: '@tanstack/react-router'
  },
  {
    input: `import type {
      RouteOptions
    } from '@tanstack/react-router'`,
    expected: '@tanstack/react-router'
  },

  // Exports and re-exports
  { input: `export * from '@tanstack/start'`, expected: '@tanstack/start' },
  { input: `export { createRouter } from '@tanstack/react-router'`, expected: '@tanstack/react-router' },
  { input: `export type { RouteConfig } from '@tanstack/react-router'`, expected: '@tanstack/react-router' },
  {
    input: `export {
      a,
      b
    } from 'react-router'`,
    expected: 'react-router'
  },

  // Dynamic imports and require
  { input: `const mod = await import('@tanstack/react-router');`, expected: '@tanstack/react-router' },
  { input: `const mod = import ( "@tanstack/start" );`, expected: '@tanstack/start' },
  { input: `const r = require('react-router-dom');`, expected: 'react-router-dom' },
  { input: `const r = require ( "react-router" );`, expected: 'react-router' },

  // Deep subpaths
  { input: `import { x } from 'react-hook-form/dist/index.cjs'`, expected: 'react-hook-form/dist/index.cjs' },
  { input: `const x = await import('@tanstack/react-router/build')`, expected: '@tanstack/react-router/build' },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const regex = new RegExp(importRegex.source, importRegex.flags);
  const match = regex.exec(tc.input);
  if (!match) {
    console.error(`FAIL: No match for: ${tc.input}`);
    failed++;
  } else {
    const target = match[1] || match[2];
    if (target === tc.expected) {
      console.log(`PASS: Matched "${target}"`);
      passed++;
    } else {
      console.error(`FAIL: Expected "${tc.expected}", got "${target}"`);
      failed++;
    }
  }
}

console.log(`\nRegex adversarial test results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
