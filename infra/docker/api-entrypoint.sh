#!/bin/sh
set -e

echo "=============================================================================="
echo " [ERP Preflight API] Initializing Production Container"
echo "=============================================================================="

# Determine whether to run migrations (default to true in production)
RUN_MIGRATIONS="${AUTO_MIGRATE:-true}"

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "[ERP Preflight API] AUTO_MIGRATE is active. Executing schema migrations..."

  node -e "
    const path = require('path');
    const fs = require('fs');
    
    // Resolve database package or local module
    let runMigrations;
    try {
      runMigrations = require('@erppreflight/database').runMigrations;
    } catch {
      try {
        runMigrations = require('./packages/database/dist/index.js').runMigrations;
      } catch {
        runMigrations = require('../packages/database/dist/index.js').runMigrations;
      }
    }

    if (!runMigrations) {
      console.warn('[ERP Preflight API] Could not load @erppreflight/database in pre-entrypoint. Migrations will run during NestJS bootstrap.');
      process.exit(0);
    }

    // Resolve migrations directory
    const candidates = [
      process.env.MIGRATIONS_DIR,
      path.resolve(process.cwd(), 'packages/database/migrations'),
      path.resolve(__dirname, 'packages/database/migrations'),
      path.resolve(__dirname, '../packages/database/migrations'),
      path.resolve(__dirname, '../../packages/database/migrations'),
      '/app/packages/database/migrations',
    ].filter(Boolean);
    const migrationsDir = candidates.find((dir) => fs.existsSync(dir));

    async function applyWithRetry(maxAttempts = 10, delayMs = 2000) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          console.log('[ERP Preflight API] Database migration attempt ' + attempt + '/' + maxAttempts + '...');
          const result = await runMigrations(process.env.DATABASE_URL, migrationsDir);
          console.log('[ERP Preflight API] Migrations complete: applied=' + result.applied.length + ', skipped=' + result.skipped.length);
          if (result.applied.length > 0) {
            console.log('[ERP Preflight API] Newly applied migrations: ' + result.applied.join(', '));
          }
          return;
        } catch (err) {
          console.warn('[ERP Preflight API] Migration attempt ' + attempt + ' failed: ' + err.message);
          if (attempt === maxAttempts) {
            if (process.env.STRICT_MIGRATIONS === 'true') {
              console.error('[ERP Preflight API] STRICT_MIGRATIONS enabled. Aborting startup.');
              process.exit(1);
            } else {
              console.warn('[ERP Preflight API] Non-strict mode: Proceeding with server start despite migration error.');
              return;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    applyWithRetry()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('[ERP Preflight API] Unexpected error in migration runner:', err);
        process.exit(process.env.STRICT_MIGRATIONS === 'true' ? 1 : 0);
      });
  "
else
  echo "[ERP Preflight API] AUTO_MIGRATE is disabled. Skipping database migrations."
fi

# Locate and launch NestJS main bundle
if [ -f "apps/api/dist/src/main.js" ]; then
  MAIN_FILE="apps/api/dist/src/main.js"
elif [ -f "apps/api/dist/main.js" ]; then
  MAIN_FILE="apps/api/dist/main.js"
elif [ -f "dist/src/main.js" ]; then
  MAIN_FILE="dist/src/main.js"
elif [ -f "dist/main.js" ]; then
  MAIN_FILE="dist/main.js"
elif [ -f "/app/apps/api/dist/src/main.js" ]; then
  MAIN_FILE="/app/apps/api/dist/src/main.js"
elif [ -f "/app/apps/api/dist/main.js" ]; then
  MAIN_FILE="/app/apps/api/dist/main.js"
else
  MAIN_FILE=$(find . -name "main.js" 2>/dev/null | grep -v "node_modules" | head -n 1)
  if [ -z "$MAIN_FILE" ]; then
    MAIN_FILE="apps/api/dist/src/main.js"
  fi
fi

echo "[ERP Preflight API] Launching NestJS production server ($MAIN_FILE) on port ${PORT:-3001}..."
exec node "$MAIN_FILE"
