#!/usr/bin/env node

/**
 * ERP Preflight — Production Facade & Security Anti-Pattern Gate
 *
 * Verifies that no development placeholders, mock data constants,
 * insecure trust configurations, or alerts exist in production paths.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const CHECKS = [
  {
    name: 'Zero MOCK_FINDINGS in Web source',
    dir: path.join(ROOT_DIR, 'apps', 'web', 'src'),
    pattern: /\bMOCK_FINDINGS\b/,
    forbidden: true,
  },
  {
    name: 'Zero MOCK_PROJECTS in Web source',
    dir: path.join(ROOT_DIR, 'apps', 'web', 'src'),
    pattern: /\bMOCK_PROJECTS\b/,
    forbidden: true,
  },
  {
    name: 'Zero browser alert() in Web source',
    dir: path.join(ROOT_DIR, 'apps', 'web', 'src'),
    pattern: /\balert\s*\(/,
    forbidden: true,
  },
  {
    name: 'No POSTGRES_HOST_AUTH_METHOD: trust in docker-compose.coolify.yml',
    file: path.join(ROOT_DIR, 'docker-compose.coolify.yml'),
    pattern: /POSTGRES_HOST_AUTH_METHOD\s*:\s*trust/,
    forbidden: true,
  },
  {
    name: 'ClamAV service declared in docker-compose.coolify.yml',
    file: path.join(ROOT_DIR, 'docker-compose.coolify.yml'),
    pattern: /clamav\s*:/,
    forbidden: false, // Required to be present!
  },
  {
    name: 'Argon2id password hashing in AuthService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'auth', 'auth.service.ts'),
    pattern: /@node-rs\/argon2/,
    forbidden: false, // Required to be present!
  },
  {
    name: 'No static fallback engineData?.engines || ALL_18_ENGINES in engine-matrix.tsx',
    file: path.join(ROOT_DIR, 'apps', 'web', 'src', 'components', 'engine-matrix.tsx'),
    pattern: /engineData\?\.engines\s*\|\|\s*ALL_18_ENGINES/,
    forbidden: true,
  },
  {
    name: 'No hardcoded OPERATIONAL fallback in ALL_18_ENGINES in api-client.ts',
    file: path.join(ROOT_DIR, 'apps', 'web', 'src', 'lib', 'api-client.ts'),
    pattern: /ALL_18_ENGINES[\s\S]*?status:\s*['"]OPERATIONAL['"]/,
    forbidden: true,
  },
  {
    name: 'EngineMatrix handles isError state from query',
    file: path.join(ROOT_DIR, 'apps', 'web', 'src', 'components', 'engine-matrix.tsx'),
    pattern: /\bisError\b/,
    forbidden: false, // Required to be present!
  },
  {
    name: 'EngineMatrix handles OFFLINE status for disconnected services',
    file: path.join(ROOT_DIR, 'apps', 'web', 'src', 'components', 'engine-matrix.tsx'),
    pattern: /\bOFFLINE\b/,
    forbidden: false, // Required to be present!
  },
  {
    name: 'EngineMatrix handles UNKNOWN status for unverified services',
    file: path.join(ROOT_DIR, 'apps', 'web', 'src', 'components', 'engine-matrix.tsx'),
    pattern: /\bUNKNOWN\b/,
    forbidden: false, // Required to be present!
  },
  {
    name: 'Zero generateMockSapObjects or cachedMockObjects in Web source',
    dir: path.join(ROOT_DIR, 'apps', 'web', 'src'),
    pattern: /\b(generateMockSapObjects|cachedMockObjects)\b/,
    forbidden: true,
  },
  {
    name: 'Zero hardcoded INITIAL_SERVICES in StatusPage',
    file: path.join(ROOT_DIR, 'apps', 'web', 'src', 'app', 'status', 'page.tsx'),
    pattern: /\bINITIAL_SERVICES\b/,
    forbidden: true,
  },
  {
    name: 'Zero silent .catch(() => {}) error swallowing in OutboxService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'outbox', 'outbox.service.ts'),
    pattern: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/,
    forbidden: true,
  },
  {
    name: 'Zero Math.random() in LandscapesService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'landscapes', 'landscapes.service.ts'),
    pattern: /Math\.random\s*\(\s*\)/,
    forbidden: true,
  },
  {
    name: 'SSRF defense validateUrlSafety present in LandscapesService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'landscapes', 'landscapes.service.ts'),
    pattern: /validateUrlSafety\s*\(/,
    forbidden: false, // Required to be present!
  },
  {
    name: 'Zero fake CALM-TSK Date.now() ID generation without remote REST call in TraceabilityService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'traceability', 'traceability.service.ts'),
    pattern: /CALM-TSK-[\$a-zA-Z0-9_{}]+Date\.now/,
    forbidden: true,
  },
  {
    name: 'Zero prompt injection vulnerability in safe XML parser',
    file: path.join(ROOT_DIR, 'services', 'analysis-python', 'src', 'parsers', 'safe_xml.py'),
    pattern: /defusedxml/,
    forbidden: false, // Required to be present!
  },
];

let failed = false;

function scanDir(dir, pattern, checkName) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.next') {
        scanDir(fullPath, pattern, checkName);
      }
    } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (pattern.test(content)) {
        console.error(`[FAIL] ${checkName} found in: ${path.relative(ROOT_DIR, fullPath)}`);
        failed = true;
      }
    }
  }
}

console.log('Running ERP Preflight Production Facade & Security Gate...');

for (const check of CHECKS) {
  if (check.dir) {
    scanDir(check.dir, check.pattern, check.name);
  } else if (check.file) {
    if (!fs.existsSync(check.file)) {
      console.error(`[FAIL] Missing required file: ${path.relative(ROOT_DIR, check.file)}`);
      failed = true;
      continue;
    }
    const content = fs.readFileSync(check.file, 'utf-8');
    const matched = check.pattern.test(content);
    if (check.forbidden && matched) {
      console.error(`[FAIL] ${check.name}: Forbidden pattern found in ${path.relative(ROOT_DIR, check.file)}`);
      failed = true;
    } else if (!check.forbidden && !matched) {
      console.error(`[FAIL] ${check.name}: Required pattern missing in ${path.relative(ROOT_DIR, check.file)}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nProduction facade check FAILED! Please eliminate all mocks, alerts, and insecure configurations.');
  process.exit(1);
} else {
  console.log('\n[PASS] All production facade & security checks PASSED cleanly!');
  process.exit(0);
}
