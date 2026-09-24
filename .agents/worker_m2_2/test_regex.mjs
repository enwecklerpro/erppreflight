import assert from 'node:assert';

const importRegex = /(?:(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

const testCases = [
  { code: "import { useForm } from 'react-hook-form';", expected: 'react-hook-form' },
  { code: "import Formik from 'formik';", expected: 'formik' },
  { code: "import * as Redux from 'redux';", expected: 'redux' },
  { code: "import 'mobx';", expected: 'mobx' },
  { code: "const r = require('react-redux');", expected: 'react-redux' },
  { code: "const r2 = require( 'formik' );", expected: 'formik' },
  { code: "import { Controller } from 'react-hook-form/dist/index.js';", expected: 'react-hook-form/dist/index.js' },
  { code: "import {\n  useForm,\n  Controller\n} from 'react-hook-form';", expected: 'react-hook-form' },
  { code: "const mod = await import('react-hook-form');", expected: 'react-hook-form' },
  { code: "const mod2 = await import( 'react-hook-form' );", expected: 'react-hook-form' },
  { code: "export * from 'react-hook-form';", expected: 'react-hook-form' },
  { code: "export { a, b } from '@tanstack/react-router';", expected: '@tanstack/react-router' },
  { code: "export { default as Router } from '@tanstack/start';", expected: '@tanstack/start' },
];

for (const tc of testCases) {
  importRegex.lastIndex = 0;
  const match = importRegex.exec(tc.code);
  assert.ok(match, `Should match: ${tc.code}`);
  const target = match[1] || match[2];
  assert.equal(target, tc.expected, `Target should match expected for: ${tc.code}`);
  console.log(`PASS: ${tc.code.replace(/\n/g, ' ')} -> ${target}`);
}

console.log('ALL REGEX TESTS PASSED!');
