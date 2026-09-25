#!/usr/bin/env node
import { LocalDirectoryScanner } from './scanner';
import { ErpPreflightClient } from './client';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  console.log('ERP Preflight — Local On-Premise Extraction & Ingestion Agent v0.1.0\n');

  if (command === 'status') {
    const apiUrl = process.env.ERP_PREFLIGHT_API_URL || 'http://localhost:3001';
    const apiKey = process.env.ERP_PREFLIGHT_API_KEY;
    const client = new ErpPreflightClient({ apiUrl, apiKey });

    console.log(`Checking connection to: ${apiUrl}...`);
    const ping = await client.ping();
    if (ping.healthy) {
      console.log(`✅ Status: CONNECTED [HTTP ${ping.status}]`);
    } else {
      console.log(`❌ Status: UNREACHABLE (${ping.message})`);
    }
  } else if (command === 'scan') {
    const targetDir = args[1] || '.';
    console.log(`Scanning directory: ${targetDir} for SAP artifacts...`);
    const artifacts = LocalDirectoryScanner.scan({
      rootDir: targetDir,
      redactSecrets: true,
    });

    console.log(`Found ${artifacts.length} SAP technical artifacts:`);
    for (const art of artifacts) {
      const red = art.redactedCount > 0 ? ` [${art.redactedCount} secrets scrubbed]` : '';
      console.log(`  - ${art.relativePath} (${art.extension}, ${art.sizeBytes} bytes, SHA-256: ${art.sha256.substring(0, 12)}...)${red}`);
    }
  } else {
    console.log('Usage:');
    console.log('  erp-preflight-agent status               Test connection to ERP Preflight SaaS/API');
    console.log('  erp-preflight-agent scan <directory>     Scan local SAP artifacts and verify cryptographic hashes');
    console.log('');
    console.log('Environment Variables:');
    console.log('  ERP_PREFLIGHT_API_URL   Base API URL (default: http://localhost:3001)');
    console.log('  ERP_PREFLIGHT_API_KEY   Tenant Ingestion API Key');
  }
}

main().catch((err) => {
  console.error(`Fatal agent error: ${err.message}`);
  process.exit(1);
});
