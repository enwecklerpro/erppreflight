#!/bin/sh
set -e

echo "[ERP Preflight API] Starting container entrypoint..."
echo "[ERP Preflight API] Running automated database migrations..."

# Run migrations via node script
node -e "
const { runMigrations } = require('@erppreflight/database');
runMigrations()
  .then((res) => {
    console.log('[ERP Preflight API] Migrations completed successfully:', res);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[ERP Preflight API] Migration failed:', err);
    process.exit(1);
  });
"

echo "[ERP Preflight API] Launching NestJS production server..."
exec node dist/main.js
