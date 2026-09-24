import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = 'H:/erppreflight';

const FORBIDDEN_LIBRARIES = [
  // Form Management
  'react-hook-form',
  '@hookform/resolvers',
  '@hookform/devtools',
  'formik',
  'redux-form',
  'final-form',
  'react-final-form',

  // Client State Management
  'redux',
  '@reduxjs/toolkit',
  'react-redux',
  'mobx',
  'mobx-react',
  'mobx-react-lite',
  'recoil',
  'jotai',
  'effector',

  // Server State & Caching
  'swr',
  '@apollo/client',
  'apollo-boost',
  'urql',
  'react-query',

  // Database ORM
  'prisma',
  '@prisma/client',
  'typeorm',
  'sequelize',
  'bookshelf',
  'waterline',
  'objection',

  // Interactive Graph Canvas
  'cytoscape',
  'cytoscape-elk',
  'vis.js',
  'vis-network',
  'vis-data',
  'mxgraph',
  'sigma',
  'gojs',

  // Data Grid / Large Tables
  'ag-grid',
  'ag-grid-react',
  'ag-grid-community',
  'ag-grid-enterprise',
  'react-data-grid',
  'tabulator-tables',
  'react-table',

  // Analytics & Charts
  'chart.js',
  'react-chartjs-2',
  'recharts',
  'victory',
  'apexcharts',
  'react-apexcharts',
  'highcharts',
  'c3',

  // Job Queue & Background Tasks
  'kue',
  'bee-queue',
  'celery-node',
  'agenda',

  // Runtime Schema Validation
  'joi',
  'yup',
  'superstruct',
  'io-ts',

  // Headless UI Primitives
  '@ark-ui/react',
  '@chakra-ui/react',
];

const results = {
  check1_web_pkgs_vs_lockfile: { pass: true, details: [] },
  check1_web_pkgs_installed: { pass: true, details: [] },
  check2_custom_instance_authenticity: { pass: true, details: [] },
  check3_orval_config_authenticity: { pass: true, details: [] },
  check4_soup_script_authenticity: { pass: true, details: [] },
  check5_zero_forbidden_libraries: { pass: true, details: [] },
};

// 1. Audit apps/web/package.json vs pnpm-lock.yaml & node_modules
const webPkgJsonPath = path.join(REPO_ROOT, 'apps/web/package.json');
const webPkg = JSON.parse(fs.readFileSync(webPkgJsonPath, 'utf8'));
const lockfilePath = path.join(REPO_ROOT, 'pnpm-lock.yaml');
const lockfileContent = fs.readFileSync(lockfilePath, 'utf8');

// Parse apps/web section in lockfile
const webSectionMatch = lockfileContent.match(/apps\/web:\s*([\s\S]*?)(?=\n\s\s[a-zA-Z0-9_./@-]+:|\n\n\s*packages:|$)/);
if (!webSectionMatch) {
  results.check1_web_pkgs_vs_lockfile.pass = false;
  results.check1_web_pkgs_vs_lockfile.details.push('Could not find apps/web section in pnpm-lock.yaml');
} else {
  const webSection = webSectionMatch[1];
  const allWebDeps = {
    ...(webPkg.dependencies || {}),
    ...(webPkg.devDependencies || {})
  };

  for (const [dep, spec] of Object.entries(allWebDeps)) {
    // Check lockfile presence
    // Escaped dep name for regex
    const escapedDep = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const depRegex = new RegExp(`['"]?${escapedDep}['"]?:[\\s\\S]*?specifier:\\s*${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const foundInLock = depRegex.test(webSection);
    if (!foundInLock) {
      results.check1_web_pkgs_vs_lockfile.pass = false;
      results.check1_web_pkgs_vs_lockfile.details.push(`Package ${dep}@${spec} not found with expected specifier in pnpm-lock.yaml apps/web section`);
    } else {
      results.check1_web_pkgs_vs_lockfile.details.push(`OK: ${dep}@${spec} verified in pnpm-lock.yaml`);
    }

    // Check node_modules presence
    let existsInNodeModules = false;
    if (dep.startsWith('@erppreflight/')) {
      // Workspace package
      const pkgSubName = dep.replace('@erppreflight/', '');
      existsInNodeModules = fs.existsSync(path.join(REPO_ROOT, 'packages', pkgSubName));
    } else {
      const nodeModulesPath = path.join(REPO_ROOT, 'apps/web/node_modules', dep);
      const rootNodeModulesPath = path.join(REPO_ROOT, 'node_modules', dep);
      existsInNodeModules = fs.existsSync(nodeModulesPath) || fs.existsSync(rootNodeModulesPath);
    }

    if (!existsInNodeModules) {
      results.check1_web_pkgs_installed.pass = false;
      results.check1_web_pkgs_installed.details.push(`Package ${dep} is missing from node_modules`);
    } else {
      results.check1_web_pkgs_installed.details.push(`OK: ${dep} found installed`);
    }
  }
}

// 2. Audit custom-instance.ts
const customInstancePath = path.join(REPO_ROOT, 'apps/web/src/lib/api/custom-instance.ts');
if (!fs.existsSync(customInstancePath)) {
  results.check2_custom_instance_authenticity.pass = false;
  results.check2_custom_instance_authenticity.details.push('custom-instance.ts does not exist');
} else {
  const content = fs.readFileSync(customInstancePath, 'utf8');
  const checks = [
    { name: 'exports ApiError class', pass: /export class ApiError extends Error/.test(content) },
    { name: 'exports ApiErrorResponse interface', pass: /export interface ApiErrorResponse/.test(content) },
    { name: 'exports customInstance mutator function', pass: /export const customInstance = async/.test(content) },
    { name: 'handles resolveApiUrl with prefix normalization', pass: /export const resolveApiUrl =/.test(content) && content.includes('/api/v1') },
    { name: 'handles auth Bearer header injection', pass: /headers\.set\('Authorization',\s*`Bearer \${token}`\)/.test(content) },
    { name: 'handles X-Tenant-Id header injection', pass: /headers\.set\('X-Tenant-Id',\s*tenantId\)/.test(content) },
    { name: 'handles HTTP 204 No Content', pass: /response\.status === 204/.test(content) },
    { name: 'handles error parsing and throws ApiError', pass: /throw new ApiError\(response\.status/.test(content) },
    { name: 'no fake stubs/facades (e.g. return [] as any)', pass: !/return\s+(?:\[\]|\{\}|null)\s+as\s+any/i.test(content) }
  ];

  for (const c of checks) {
    if (!c.pass) {
      results.check2_custom_instance_authenticity.pass = false;
      results.check2_custom_instance_authenticity.details.push(`FAIL: ${c.name}`);
    } else {
      results.check2_custom_instance_authenticity.details.push(`PASS: ${c.name}`);
    }
  }
}

// 3. Audit orval.config.ts
const orvalPaths = [
  path.join(REPO_ROOT, 'apps/web/orval.config.ts'),
  path.join(REPO_ROOT, 'orval.config.ts')
];

for (const oPath of orvalPaths) {
  if (!fs.existsSync(oPath)) {
    results.check3_orval_config_authenticity.pass = false;
    results.check3_orval_config_authenticity.details.push(`Missing ${oPath}`);
  } else {
    const content = fs.readFileSync(oPath, 'utf8');
    const checks = [
      { name: `${path.basename(oPath)}: uses defineConfig`, pass: /defineConfig/.test(content) },
      { name: `${path.basename(oPath)}: client is react-query`, pass: /client:\s*['"]react-query['"]/.test(content) },
      { name: `${path.basename(oPath)}: mock is false (no stubs/mocks)`, pass: /mock:\s*false/.test(content) },
      { name: `${path.basename(oPath)}: mutator config points to customInstance`, pass: /mutator:[\s\S]*?customInstance/.test(content) },
      { name: `${path.basename(oPath)}: query config sets version 5 & signal true`, pass: /query:[\s\S]*?version:\s*5[\s\S]*?signal:\s*true/.test(content) }
    ];
    for (const c of checks) {
      if (!c.pass) {
        results.check3_orval_config_authenticity.pass = false;
        results.check3_orval_config_authenticity.details.push(`FAIL: ${c.name}`);
      } else {
        results.check3_orval_config_authenticity.details.push(`PASS: ${c.name}`);
      }
    }
  }
}

// 4. Audit check-no-dependency-soup.mjs
const soupScriptPath = path.join(REPO_ROOT, 'scripts/check-no-dependency-soup.mjs');
if (!fs.existsSync(soupScriptPath)) {
  results.check4_soup_script_authenticity.pass = false;
  results.check4_soup_script_authenticity.details.push('scripts/check-no-dependency-soup.mjs does not exist');
} else {
  const content = fs.readFileSync(soupScriptPath, 'utf8');
  const checks = [
    { name: 'scans all package.json files recursively', pass: /findPackageJsonFiles/.test(content) },
    { name: 'scans source files recursively', pass: /findSourceFiles/.test(content) },
    { name: 'checks regex import/require statements', pass: /importRegex/.test(content) },
    { name: 'contains all forbidden library categories', pass: FORBIDDEN_LIBRARIES.every(lib => content.includes(lib)) },
    { name: 'exits with non-zero on violations', pass: /process\.exit\(1\)/.test(content) }
  ];
  for (const c of checks) {
    if (!c.pass) {
      results.check4_soup_script_authenticity.pass = false;
      results.check4_soup_script_authenticity.details.push(`FAIL: ${c.name}`);
    } else {
      results.check4_soup_script_authenticity.details.push(`PASS: ${c.name}`);
    }
  }
}

// 5. Independent scan for 0 forbidden libraries across whole repo
function collectAllFiles(dir, exts, ignoreDirs, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (ignoreDirs.includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectAllFiles(full, exts, ignoreDirs, acc);
    } else if (exts.some(ext => e.name.endsWith(ext))) {
      acc.push(full);
    }
  }
  return acc;
}

const ignoreDirs = ['node_modules', '.git', '.next', 'dist', '.agents', '.turbo', '.vscode'];
const allPkgJsonFiles = collectAllFiles(REPO_ROOT, ['package.json'], ignoreDirs);
const allCodeFiles = collectAllFiles(REPO_ROOT, ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.json'], ignoreDirs)
  .filter(f => !f.endsWith('check-no-dependency-soup.mjs') && !f.endsWith('audit_verifier.mjs'));

const detectedViolations = [];

// Check package.json files
for (const p of allPkgJsonFiles) {
  try {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    const allDepKeys = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {})
    ];
    for (const dep of allDepKeys) {
      if (FORBIDDEN_LIBRARIES.includes(dep)) {
        detectedViolations.push(`package.json violation in ${p}: ${dep}`);
      }
    }
  } catch (err) {
    detectedViolations.push(`Error parsing ${p}: ${err.message}`);
  }
}

// Check source files for import / require of forbidden libraries
const importRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
for (const f of allCodeFiles) {
  // skip package-lock or json files that aren't package.json unless needed
  if (f.endsWith('.json') && !f.endsWith('package.json')) continue;

  const content = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const target = match[1] || match[2];
    for (const forbidden of FORBIDDEN_LIBRARIES) {
      if (target === forbidden || target.startsWith(`${forbidden}/`)) {
        detectedViolations.push(`Import violation in ${f}: imported '${target}' (forbidden: ${forbidden})`);
      }
    }
  }
}

if (detectedViolations.length > 0) {
  results.check5_zero_forbidden_libraries.pass = false;
  results.check5_zero_forbidden_libraries.details = detectedViolations;
} else {
  results.check5_zero_forbidden_libraries.pass = true;
  results.check5_zero_forbidden_libraries.details.push(
    `Scanned ${allPkgJsonFiles.length} package.json files and ${allCodeFiles.length} source/config files. Found 0 forbidden library references.`
  );
}

console.log(JSON.stringify(results, null, 2));
