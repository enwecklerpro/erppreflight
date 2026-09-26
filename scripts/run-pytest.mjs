#!/usr/bin/env node
// Cross-platform pytest launcher for `pnpm run test:python`.
// Picks the first available interpreter: $PYTHON, python3, python, py (Windows launcher).
import { spawnSync } from 'node:child_process';

const candidates = [process.env.PYTHON, 'python3', 'python', 'py'].filter(Boolean);
const interpreter = candidates.find(
  (cmd) => spawnSync(cmd, ['-c', 'import pytest'], { stdio: 'ignore' }).status === 0,
);

if (!interpreter) {
  console.error(
    '[test:python] No Python interpreter with pytest found. Tried: ' + candidates.join(', ') +
      '\nInstall: pip install -r services/analysis-python/requirements-dev.txt',
  );
  process.exit(1);
}

const args = ['-m', 'pytest', 'services/analysis-python/tests', '-v', ...process.argv.slice(2)];
const result = spawnSync(interpreter, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
