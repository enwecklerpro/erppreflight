#!/usr/bin/env node
import { LocalDirectoryScanner } from './scanner';
import { ErpPreflightClient } from './client';
import { AgentIdentityManager } from './identity';
import { AgentDaemon } from './daemon';
import { SapLandscapeProber } from './probe';
import { SignedUpdateVerifier } from './updater';
import * as path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  console.log('ERP Preflight — Local On-Premise Extraction & Ingestion Agent v0.1.0\n');

  if (command === 'status') {
    const apiUrl = process.env.ERP_PREFLIGHT_API_URL || 'http://localhost:3001';
    
    const identityManager = new AgentIdentityManager();
    const identity = await identityManager.load();
    const apiKey = identity?.apiKey || process.env.ERP_PREFLIGHT_API_KEY;

    if (identity) {
      console.log(`Identity loaded: Device ID ${identity.deviceId} on ${identity.hostname}`);
    } else {
      console.log('No local identity found. Device is not enrolled.');
    }

    const client = new ErpPreflightClient({ apiUrl, apiKey });
    console.log(`Checking connection to: ${apiUrl}...`);
    const ping = await client.ping();
    if (ping.healthy) {
      console.log(`✅ Status: CONNECTED [HTTP ${ping.status}]`);
    } else {
      console.log(`❌ Status: UNREACHABLE (${ping.message})`);
    }
  } else if (command === 'enroll') {
    const apiUrl = args[1];
    const pairingToken = args[2];
    if (!apiUrl || !pairingToken) {
      console.error('Usage: erp-preflight-agent enroll <apiUrl> <pairingToken>');
      process.exit(1);
    }
    const identityManager = new AgentIdentityManager();
    try {
      const identity = await identityManager.enroll(apiUrl, pairingToken);
      console.log(`✅ Successfully enrolled device! Device ID: ${identity.deviceId}`);
    } catch (err: any) {
      console.error(`❌ Enrollment failed: ${err.message}`);
      process.exit(1);
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
  } else if (command === 'daemon') {
    const apiUrl = process.env.ERP_PREFLIGHT_API_URL || 'http://localhost:3001';
    const daemon = new AgentDaemon({ apiUrl, intervalMs: 10000 });
    await daemon.start();
  } else if (command === 'probe') {
    const sapUrl = args[1];
    if (!sapUrl) {
      console.error('Usage: erp-preflight-agent probe <sapUrl>');
      process.exit(1);
    }
    console.log(`Probing SAP landscape at ${sapUrl}...`);
    const result = await SapLandscapeProber.probe(sapUrl);
    if (result.isReachable) {
      console.log(`✅ Probe successful!`);
      console.log(`  Latency: ${result.latencyMs}ms`);
      console.log(`  TLS Valid: ${result.isTlsValid}`);
      if (result.sapSid) console.log(`  SAP SID: ${result.sapSid}`);
      if (result.serverHeader) console.log(`  Server: ${result.serverHeader}`);
    } else {
      console.log(`❌ Probe failed: ${result.error}`);
    }
  } else if (command === 'verify-update') {
    const file = args[1];
    const expectedSha256 = args[2];
    if (!file || !expectedSha256) {
      console.error('Usage: erp-preflight-agent verify-update <file> <expectedSha256>');
      process.exit(1);
    }
    console.log(`Verifying update file ${file}...`);
    const isValid = await SignedUpdateVerifier.verifyFile(path.resolve(file), expectedSha256);
    if (isValid) {
      console.log(`✅ Update verified successfully (SHA-256 matches).`);
    } else {
      console.error(`❌ Update verification failed! File corrupt or tampered.`);
      process.exit(1);
    }
  } else {
    console.log('Usage:');
    console.log('  erp-preflight-agent status                                Test connection to ERP Preflight SaaS/API');
    console.log('  erp-preflight-agent enroll <apiUrl> <pairingToken>        Enroll device with ERP Preflight SaaS');
    console.log('  erp-preflight-agent scan <directory>                      Scan local SAP artifacts and verify cryptographic hashes');
    console.log('  erp-preflight-agent daemon                                Run enterprise agent in background daemon mode with heartbeats');
    console.log('  erp-preflight-agent probe <sapUrl>                        Test on-premise SAP landscape NetWeaver connectivity');
    console.log('  erp-preflight-agent verify-update <file> <expectedSha256> Verify integrity of an agent bundle');
    console.log('');
    console.log('Environment Variables:');
    console.log('  ERP_PREFLIGHT_API_URL   Base API URL (default: http://localhost:3001)');
    console.log('  ERP_PREFLIGHT_API_KEY   Tenant Ingestion API Key (fallback if not enrolled)');
  }
}

main().catch((err) => {
  console.error(`Fatal agent error: ${err.message}`);
  process.exit(1);
});
