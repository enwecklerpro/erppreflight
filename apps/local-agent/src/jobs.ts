import * as crypto from 'crypto';
import * as path from 'path';
import type { AgentIdentity } from './identity';
import { LocalDirectoryScanner } from './scanner';
import { SapLandscapeProber } from './probe';

/**
 * Signed job instructions (Part 03 §3.12). The agent executes a job only if:
 *  - the Ed25519 signature verifies with the job-signing key pinned at enrollment,
 *  - the envelope is addressed to this device and organization,
 *  - it has not expired and has not been executed before (replay protection),
 *  - SCAN_DIRECTORY targets lie inside the operator-configured allowed roots
 *    (ERP_PREFLIGHT_AGENT_SCAN_ROOTS) — the SaaS cannot make the agent read
 *    arbitrary directories.
 */

export interface JobEnvelope {
  v: number;
  jobId: string;
  deviceId: string;
  organizationId: string;
  type: 'SCAN_DIRECTORY' | 'PROBE_URL';
  payload: any;
  egress: { uploadRawFiles: boolean; redactSecrets: boolean };
  issuedAt: string;
  expiresAt: string;
}

export class JobRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobRejectedError';
  }
}

export function verifyJob(
  identity: Pick<AgentIdentity, 'deviceId' | 'organizationId' | 'jobSigningPublicKey'>,
  envelope: string,
  signature: string,
  seen: Set<string>,
  now = new Date()
): JobEnvelope {
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(envelope, 'utf8'), crypto.createPublicKey(identity.jobSigningPublicKey), Buffer.from(signature, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new JobRejectedError('job signature invalid (not signed by the pinned ERP Preflight key)');
  const job = JSON.parse(envelope) as JobEnvelope;
  if (job.v !== 1) throw new JobRejectedError(`unsupported envelope version ${job.v}`);
  if (job.deviceId !== identity.deviceId || job.organizationId !== identity.organizationId) {
    throw new JobRejectedError('job is addressed to another device or organization');
  }
  if (Date.parse(job.expiresAt) < now.getTime()) throw new JobRejectedError('job has expired');
  if (seen.has(job.jobId)) throw new JobRejectedError('job was already executed (replay)');
  return job;
}

export function allowedScanRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ERP_PREFLIGHT_AGENT_SCAN_ROOTS || '')
    .split(path.delimiter)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => path.resolve(r));
}

export function assertInsideRoots(dir: string, roots: string[]): string {
  const target = path.resolve(dir);
  if (!roots.length) throw new JobRejectedError('no scan roots configured (set ERP_PREFLIGHT_AGENT_SCAN_ROOTS)');
  if (!roots.some((r) => target === r || target.startsWith(r + path.sep))) {
    throw new JobRejectedError(`directory ${target} is outside the allowed scan roots`);
  }
  return target;
}

const MAX_UPLOAD_FILE_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 15 * 1024 * 1024;

export async function executeJob(job: JobEnvelope, env: NodeJS.ProcessEnv = process.env) {
  if (job.type === 'SCAN_DIRECTORY') {
    const dir = assertInsideRoots(String(job.payload?.directory || ''), allowedScanRoots(env));
    const maxFiles = Math.min(Number(job.payload?.maxFiles) || 200, 1000);
    const artifacts = LocalDirectoryScanner.scan({ rootDir: dir, redactSecrets: true, maxFiles });
    let uploaded = 0;
    const out = artifacts.map((a) => {
      const entry: any = { relativePath: a.relativePath, sha256: a.sha256, sizeBytes: a.sizeBytes, redactedCount: a.redactedCount };
      // Contents leave the network only when the device egress policy allows it,
      // and only in redacted form (never raw).
      if (job.egress?.uploadRawFiles && a.redactedContent !== undefined && job.payload?.projectId) {
        const buf = Buffer.from(a.redactedContent, 'utf8');
        if (buf.length <= MAX_UPLOAD_FILE_BYTES && uploaded + buf.length <= MAX_UPLOAD_TOTAL_BYTES) {
          entry.contentBase64 = buf.toString('base64');
          uploaded += buf.length;
        }
      }
      return entry;
    });
    return {
      status: 'COMPLETED' as const,
      result: {
        summary: {
          directory: dir,
          files: artifacts.length,
          secretsRedacted: artifacts.reduce((n, a) => n + a.redactedCount, 0),
          uploadedBytes: uploaded,
        },
        artifacts: out,
      },
    };
  }
  if (job.type === 'PROBE_URL') {
    const probe = await SapLandscapeProber.probe(String(job.payload?.url || ''));
    return { status: 'COMPLETED' as const, result: { probe: probe as any } };
  }
  throw new JobRejectedError(`unsupported job type ${(job as any).type}`);
}
