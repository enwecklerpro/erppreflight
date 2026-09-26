#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { LocalDirectoryScanner } from './scanner';
import { ErpPreflightClient } from './client';
import { AgentIdentityManager, AGENT_VERSION, normalizeApiBase } from './identity';
import { AgentDaemon } from './daemon';
import { SapLandscapeProber } from './probe';
import { SignedUpdateVerifier, UpdateManifest } from './updater';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function usage() {
  console.log(`ERP Preflight Local Agent v${AGENT_VERSION}

Usage:
  erp-preflight-agent enroll <apiUrl> <enrollmentToken> [--name <deviceName>]
      Generate a device key pair locally and enroll it with a single-use token.
  erp-preflight-agent status
      Show the enrolled identity and check API reachability.
  erp-preflight-agent daemon [--once] [--interval <seconds>]
      Outbound-only loop: signed heartbeats, signed job verification, local execution.
  erp-preflight-agent scan <directory>
      Scan SAP artifacts locally (SHA-256 + secret redaction); nothing is uploaded.
  erp-preflight-agent probe <sapUrl>
      Probe an on-premise SAP NetWeaver ICM endpoint (TLS always validated).
  erp-preflight-agent check-update [--channel stable]
      Fetch the signed update manifest and verify its signature.
  erp-preflight-agent verify-update <file> <manifest.json>
      Verify an update artifact against a signed manifest ({manifest, signature}).

Environment:
  ERP_PREFLIGHT_AGENT_HOME        Identity directory (default ~/.erppreflight)
  ERP_PREFLIGHT_AGENT_SCAN_ROOTS  Directories jobs may scan (path-delimiter separated)`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const identityManager = new AgentIdentityManager();

  switch (command) {
    case 'enroll': {
      const [apiUrl, token] = [args[1], args[2]];
      if (!apiUrl || !token) {
        console.error('Usage: erp-preflight-agent enroll <apiUrl> <enrollmentToken> [--name <deviceName>]');
        process.exit(2);
      }
      const identity = await identityManager.enroll(apiUrl, token, flag(args, '--name'));
      console.log(`Enrolled device ${identity.deviceId} for organization ${identity.organizationId}`);
      console.log(`Device key fingerprint: ${identity.publicKeyFingerprint}`);
      console.log(`Identity stored in ${identityManager.identityFile} (mode 0600)`);
      return;
    }
    case 'status': {
      const identity = await identityManager.load();
      const apiUrl = identity?.apiUrl || (process.env.ERP_PREFLIGHT_API_URL ? normalizeApiBase(process.env.ERP_PREFLIGHT_API_URL) : '');
      if (identity) {
        console.log(`Device:      ${identity.name} (${identity.deviceId})`);
        console.log(`Org:         ${identity.organizationId}`);
        console.log(`Fingerprint: ${identity.publicKeyFingerprint}`);
      } else {
        console.log('Device is not enrolled.');
      }
      if (apiUrl) {
        const ping = await new ErpPreflightClient({ apiUrl }).ping();
        console.log(`API ${apiUrl}: ${ping.healthy ? 'REACHABLE' : `UNREACHABLE (${ping.message})`}`);
        if (!ping.healthy) process.exit(1);
      }
      return;
    }
    case 'daemon': {
      const interval = flag(args, '--interval');
      const stats = await new AgentDaemon({ once: args.includes('--once'), intervalMs: interval ? Number(interval) * 1000 : undefined }).start();
      console.log(`Daemon stopped after ${stats.cycles} cycle(s): ${stats.jobsExecuted} job(s) executed, ${stats.jobsRejected} rejected`);
      return;
    }
    case 'scan': {
      const dir = args[1] || '.';
      const artifacts = LocalDirectoryScanner.scan({ rootDir: dir, redactSecrets: true });
      console.log(`Found ${artifacts.length} SAP artifact(s) in ${path.resolve(dir)} (nothing uploaded):`);
      for (const a of artifacts) {
        console.log(`  ${a.relativePath}  ${a.sizeBytes} B  sha256=${a.sha256.slice(0, 16)}…${a.redactedCount ? `  [${a.redactedCount} secret(s) redacted]` : ''}`);
      }
      return;
    }
    case 'probe': {
      if (!args[1]) {
        console.error('Usage: erp-preflight-agent probe <sapUrl>');
        process.exit(2);
      }
      const r = await SapLandscapeProber.probe(args[1]);
      console.log(JSON.stringify(r, null, 2));
      if (!r.isReachable) process.exit(1);
      return;
    }
    case 'check-update': {
      const identity = await identityManager.load();
      if (!identity) throw new Error('Agent not enrolled (the signing key is pinned at enrollment)');
      const channel = flag(args, '--channel') || 'stable';
      const res = await fetch(`${identity.apiUrl}/agent-api/updates/${encodeURIComponent(channel)}`);
      if (res.status === 404) {
        console.log(`No update published on channel '${channel}'. Running ${AGENT_VERSION}.`);
        return;
      }
      if (!res.ok) throw new Error(`Update check failed: HTTP ${res.status}`);
      const body = (await res.json()) as { manifest: UpdateManifest; signature: string };
      const valid = SignedUpdateVerifier.verifyManifest(body.manifest, body.signature, identity.jobSigningPublicKey);
      if (!valid) {
        console.error('Update manifest signature INVALID — update refused.');
        process.exit(1);
      }
      console.log(`Signed update available: ${body.manifest.version} (sha256 ${body.manifest.sha256}) — current ${AGENT_VERSION}`);
      console.log(`Download ${body.manifest.url} and run: erp-preflight-agent verify-update <file> <manifest.json>`);
      return;
    }
    case 'verify-update': {
      const [file, manifestFile] = [args[1], args[2]];
      if (!file || !manifestFile) {
        console.error('Usage: erp-preflight-agent verify-update <file> <manifest.json>');
        process.exit(2);
      }
      const identity = await identityManager.load();
      if (!identity) throw new Error('Agent not enrolled (the signing key is pinned at enrollment)');
      const { manifest, signature } = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const r = await SignedUpdateVerifier.verifyFile(path.resolve(file), manifest, signature, identity.jobSigningPublicKey);
      if (!r.ok) {
        console.error(`Update verification FAILED: ${r.reason}. Never execute this file.`);
        process.exit(1);
      }
      console.log(`Update ${manifest.version} verified: signature valid, SHA-256 matches.`);
      return;
    }
    default:
      usage();
      if (command !== 'help' && command !== '--help') process.exit(2);
  }
}

main().catch((err) => {
  console.error(`Fatal agent error: ${err.message}`);
  process.exit(1);
});
