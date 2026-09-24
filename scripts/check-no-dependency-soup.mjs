#!/usr/bin/env node

/**
 * check-no-dependency-soup.mjs
 * 
 * Monorepo Dependency Compliance & Anti-Duplication Linter.
 * Enforces ERP Preflight Cardinal Axiom 2, AGENTS.md §4.2, and Part 21.42.
 * 
 * Verifies that forbidden competing frameworks are NOT introduced into
 * package.json files or imported in source files across the monorepo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Color codes for ANSI terminal output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const FORBIDDEN_RULES = [
  {
    category: 'Application Router',
    approved: 'Next.js App Router',
    forbidden: [
      '@tanstack/react-router',
      '@tanstack/start',
      'react-router',
      'react-router-dom'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.16 / 21.42'
  },
  {
    category: 'Form Management',
    approved: 'TanStack Form (@tanstack/react-form + Zod)',
    forbidden: [
      'react-hook-form',
      '@hookform/resolvers',
      '@hookform/devtools',
      'formik',
      'redux-form',
      'final-form',
      'react-final-form'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.3 / 21.42'
  },
  {
    category: 'Client State Management',
    approved: 'URL Parameters + React State / scoped Zustand',
    forbidden: [
      'redux',
      '@reduxjs/toolkit',
      'react-redux',
      'mobx',
      'mobx-react',
      'mobx-react-lite',
      'recoil',
      'jotai',
      'effector'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.15 / 21.42'
  },
  {
    category: 'Server State & Caching',
    approved: 'TanStack Query (@tanstack/react-query)',
    forbidden: [
      'swr',
      '@apollo/client',
      'apollo-boost',
      'urql',
      'react-query'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.3 / 21.42'
  },
  {
    category: 'Database ORM',
    approved: 'Drizzle ORM (drizzle-orm + pg)',
    forbidden: [
      'prisma',
      '@prisma/client',
      'typeorm',
      'sequelize',
      'bookshelf',
      'waterline',
      'objection'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.19 / 21.42'
  },
  {
    category: 'Interactive Graph Canvas',
    approved: '@xyflow/react (React Flow) + ELK.js',
    forbidden: [
      'cytoscape',
      'cytoscape-elk',
      'vis.js',
      'vis-network',
      'vis-data',
      'mxgraph',
      'sigma',
      'gojs'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.6 / 21.42'
  },
  {
    category: 'Data Grid / Large Tables',
    approved: 'TanStack Table (@tanstack/react-table) + TanStack Virtual (@tanstack/react-virtual)',
    forbidden: [
      'ag-grid',
      'ag-grid-react',
      'ag-grid-community',
      'ag-grid-enterprise',
      'react-data-grid',
      'tabulator-tables',
      'react-table'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.3 / 21.42'
  },
  {
    category: 'Analytics & Charts',
    approved: 'Apache ECharts (echarts)',
    forbidden: [
      'chart.js',
      'react-chartjs-2',
      'recharts',
      'victory',
      'apexcharts',
      'react-apexcharts',
      'highcharts',
      'c3'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.8 / 21.42'
  },
  {
    category: 'Job Queue & Background Tasks',
    approved: 'BullMQ (bullmq / @nestjs/bullmq)',
    forbidden: [
      'kue',
      'bee-queue',
      'celery-node',
      'agenda'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.22 / 21.42'
  },
  {
    category: 'Runtime Schema Validation',
    approved: 'Zod 4 (zod)',
    forbidden: [
      'joi',
      'yup',
      'superstruct',
      'io-ts'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.4 / 21.42'
  },
  {
    category: 'Headless UI Primitives (New Components)',
    approved: 'Base UI (@base-ui-components/react) + shadcn/ui',
    forbidden: [
      '@ark-ui/react',
      '@chakra-ui/react'
    ],
    ruleRef: 'AGENTS.md §4.2, Part 21.1 / 21.42'
  }
];

function findPackageJsonFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.agents' || entry.name === 'dist' || entry.name === '.next') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findPackageJsonFiles(fullPath, files);
    } else if (entry.name === 'package.json') {
      files.push(fullPath);
    }
  }
  return files;
}

function findSourceFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.agents' || entry.name === 'dist' || entry.name === '.next') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findSourceFiles(fullPath, files);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkPackageJson(pkgPath, violations) {
  const content = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(content);
  const relPath = path.relative(REPO_ROOT, pkgPath);

  const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const allDeps = new Set();

  for (const field of depFields) {
    if (pkg[field]) {
      for (const depName of Object.keys(pkg[field])) {
        allDeps.add(depName);
      }
    }
  }

  for (const rule of FORBIDDEN_RULES) {
    for (const forbiddenPkg of rule.forbidden) {
      if (allDeps.has(forbiddenPkg)) {
        violations.push({
          type: 'package.json',
          file: relPath,
          category: rule.category,
          forbiddenPkg,
          approved: rule.approved,
          ruleRef: rule.ruleRef
        });
      }
    }
  }
}

function checkSourceImports(sourceFiles, violations) {
  // Regex to detect static import/export, dynamic import(), or require statements
  const importRegex = /(?:(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

  // Flatten forbidden packages
  const forbiddenMap = new Map();
  for (const rule of FORBIDDEN_RULES) {
    for (const forbiddenPkg of rule.forbidden) {
      forbiddenMap.set(forbiddenPkg, rule);
    }
  }

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relPath = path.relative(REPO_ROOT, file);

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importTarget = match[1] || match[2];
      // Check exact match or package subpath match (e.g., 'react-hook-form/dist')
      for (const [forbiddenPkg, rule] of forbiddenMap.entries()) {
        if (importTarget === forbiddenPkg || importTarget.startsWith(`${forbiddenPkg}/`)) {
          violations.push({
            type: 'source_import',
            file: relPath,
            category: rule.category,
            forbiddenPkg: importTarget,
            approved: rule.approved,
            ruleRef: rule.ruleRef
          });
        }
      }
    }
  }
}

function main() {
  console.log(`\n${BOLD}${BLUE}=== ERP Preflight: No-Dependency-Soup Compliance Audit ===${RESET}\n`);

  const packageJsonFiles = findPackageJsonFiles(REPO_ROOT);
  console.log(`Scanning ${packageJsonFiles.length} package.json files across monorepo...`);

  const sourceDirs = [
    path.join(REPO_ROOT, 'apps'),
    path.join(REPO_ROOT, 'packages')
  ];

  let sourceFiles = [];
  for (const dir of sourceDirs) {
    findSourceFiles(dir, sourceFiles);
  }
  console.log(`Scanning ${sourceFiles.length} TypeScript/JavaScript source files...\n`);

  const violations = [];

  for (const pkgPath of packageJsonFiles) {
    checkPackageJson(pkgPath, violations);
  }

  checkSourceImports(sourceFiles, violations);

  // Group check by rule categories
  console.log(`${BOLD}--- Category Compliance Matrix ---${RESET}`);
  for (const rule of FORBIDDEN_RULES) {
    const categoryViolations = violations.filter(v => v.category === rule.category);
    if (categoryViolations.length === 0) {
      console.log(` ${GREEN}✔${RESET} ${rule.category.padEnd(40)} [Approved: ${rule.approved}]`);
    } else {
      console.log(` ${RED}✖${RESET} ${rule.category.padEnd(40)} [Violations: ${categoryViolations.length}]`);
    }
  }

  console.log('\n--------------------------------------------------------------');

  if (violations.length === 0) {
    console.log(`\n${BOLD}${GREEN}✔ SUCCESS: 100% compliant with No-Dependency-Soup standard!${RESET}`);
    console.log(`Zero prohibited duplicate libraries detected across all ${packageJsonFiles.length} package.json files and ${sourceFiles.length} source files.\n`);
    process.exit(0);
  } else {
    console.error(`\n${BOLD}${RED}✖ VIOLATIONS DETECTED: Found ${violations.length} prohibited library references!${RESET}\n`);
    for (const v of violations) {
      console.error(`  - [${v.type}] in ${BOLD}${v.file}${RESET}:`);
      console.error(`    Forbidden: ${RED}${v.forbiddenPkg}${RESET} (${v.category})`);
      console.error(`    Approved Alternative: ${GREEN}${v.approved}${RESET}`);
      console.error(`    Standard: ${v.ruleRef}\n`);
    }
    process.exit(1);
  }
}

main();
