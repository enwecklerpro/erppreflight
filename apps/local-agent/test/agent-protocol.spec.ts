import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentIdentityManager } from '../src/identity';
import { AgentDaemon } from '../src/daemon';
import { signingString } from '../src/client';
import { JobRejectedError, assertInsideRoots, verifyJob } from '../src/jobs';
import { SignedUpdateVerifier, canonicalJson } from '../src/updater';

const server = crypto.generateKeyPairSync('ed25519');
const serverPub = server.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const signEnv = (obj: any) => {
  const envelope = canonicalJson(obj);
  return { envelope, signature: crypto.sign(null, Buffer.from(envelope), server.privateKey).toString('base64') };
};

describe('signed job verification', () => {
  const identity = { deviceId: 'dev-1', organizationId: 'org-1', jobSigningPublicKey: serverPub };
  const job = (patch: any = {}) => ({
    v: 1,
    jobId: crypto.randomUUID(),
    deviceId: 'dev-1',
    organizationId: 'org-1',
    type: 'SCAN_DIRECTORY',
    payload: { directory: '/tmp' },
    egress: { uploadRawFiles: false, redactSecrets: true },
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...patch,
  });

  it('accepts authentic jobs and rejects tampering, foreign devices, expiry and replays', () => {
    const ok = signEnv(job());
    const seen = new Set<string>();
    const parsed = verifyJob(identity, ok.envelope, ok.signature, seen);
    expect(parsed.type).toBe('SCAN_DIRECTORY');
    expect(() => verifyJob(identity, ok.envelope.replace('/tmp', '/etc'), ok.signature, new Set())).toThrow(/signature/);
    const foreign = signEnv(job({ deviceId: 'dev-2' }));
    expect(() => verifyJob(identity, foreign.envelope, foreign.signature, new Set())).toThrow(/another device/);
    const expired = signEnv(job({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(() => verifyJob(identity, expired.envelope, expired.signature, new Set())).toThrow(/expired/);
    seen.add(parsed.jobId);
    expect(() => verifyJob(identity, ok.envelope, ok.signature, seen)).toThrow(/replay/);
    const attacker = crypto.generateKeyPairSync('ed25519');
    const forged = canonicalJson(job());
    const forgedSig = crypto.sign(null, Buffer.from(forged), attacker.privateKey).toString('base64');
    expect(() => verifyJob(identity, forged, forgedSig, new Set())).toThrow(JobRejectedError);
  });

  it('confines directory scans to operator-configured roots', () => {
    expect(() => assertInsideRoots('/etc', [])).toThrow(/no scan roots/);
    expect(() => assertInsideRoots('/etc/passwd', ['/srv/sap'])).toThrow(/outside/);
    expect(() => assertInsideRoots('/srv/sap-evil', ['/srv/sap'])).toThrow(/outside/);
    expect(assertInsideRoots('/srv/sap/exports', ['/srv/sap'])).toBe('/srv/sap/exports');
  });
});

describe('signed updates', () => {
  it('requires a valid manifest signature AND a matching SHA-256', () => {
    const payload = Buffer.from('agent-bundle-v0.3.0');
    const manifest = { version: '0.3.0', url: 'https://updates.example.com/a.tgz', sha256: crypto.createHash('sha256').update(payload).digest('hex'), channel: 'stable' };
    const sig = crypto.sign(null, Buffer.from(canonicalJson(manifest)), server.privateKey).toString('base64');
    expect(SignedUpdateVerifier.verifyUpdate(payload, manifest, sig, serverPub)).toEqual({ ok: true });
    expect(SignedUpdateVerifier.verifyUpdate(Buffer.from('tampered'), manifest, sig, serverPub).ok).toBe(false);
    expect(SignedUpdateVerifier.verifyUpdate(payload, { ...manifest, version: '9.9.9' }, sig, serverPub).ok).toBe(false);
    expect(SignedUpdateVerifier.verifyUpdate(payload, manifest, '', serverPub).ok).toBe(false);
  });
});

describe('enroll → heartbeat → signed job → redacted result (against a protocol double)', () => {
  let srv: http.Server;
  let base: string;
  let home: string;
  let scanRoot: string;
  const state: any = { devicePub: null, credential: 'erppf_dev_testcredential', results: [], heartbeats: 0, jobs: [] };

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-home-'));
    scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-scan-'));
    fs.writeFileSync(path.join(scanRoot, 'rfc_dest.xml'), '<Dest><Password>SuperSecretRfcPwd99</Password><Host>sap-prd</Host></Dest>');
    fs.writeFileSync(path.join(scanRoot, 'zreport.abap'), 'REPORT zreport.\nWRITE / sy-uname.\n');
    process.env.ERP_PREFLIGHT_AGENT_SCAN_ROOTS = scanRoot;
    srv = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const send = (status: number, obj: any) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        if (req.url === '/api/v1/agent-api/enroll') {
          const b = JSON.parse(body);
          if (b.enrollmentToken !== 'erppf_enroll_ok') return send(401, { message: 'Enrollment token is invalid' });
          state.devicePub = b.publicKeyPem;
          const fp = crypto.createHash('sha256').update(crypto.createPublicKey(b.publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex');
          return send(201, { deviceId: 'dev-9', organizationId: 'org-9', deviceCredential: state.credential, publicKeyFingerprint: fp, jobSigningPublicKey: serverPub, heartbeatIntervalSec: 1 });
        }
        // Device authentication exactly like the API: credential + Ed25519 request signature.
        const sig = String(req.headers['x-agent-signature'] || '');
        const ts = String(req.headers['x-agent-timestamp'] || '');
        const okSig = crypto.verify(null, Buffer.from(signingString(req.method!, req.url!, ts, body)), crypto.createPublicKey(state.devicePub), Buffer.from(sig, 'base64'));
        if (req.headers.authorization !== `Device ${state.credential}` || !okSig) return send(401, { message: 'bad device signature' });
        if (req.url === '/api/v1/agent-api/heartbeat') {
          state.heartbeats++;
          const jobs = state.jobs.splice(0);
          return send(200, { jobs });
        }
        const m = req.url!.match(/^\/api\/v1\/agent-api\/jobs\/([^/]+)\/result$/);
        if (m) {
          state.results.push({ jobId: m[1], ...JSON.parse(body) });
          return send(200, { accepted: true });
        }
        return send(404, {});
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(srv.address() as any).port}`;
  });

  afterAll(() => {
    srv.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(scanRoot, { recursive: true, force: true });
  });

  it('rejects a bad enrollment token', async () => {
    const mgr = new AgentIdentityManager(home);
    await expect(mgr.enroll(base, 'erppf_enroll_bad')).rejects.toThrow(/HTTP 401/);
  });

  it('enrolls with a locally generated key (identity file 0600) and runs signed jobs', async () => {
    const mgr = new AgentIdentityManager(home);
    const identity = await mgr.enroll(base, 'erppf_enroll_ok', 'plant-01');
    expect(identity.deviceId).toBe('dev-9');
    expect(fs.statSync(mgr.identityFile).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(mgr.identityFile, 'utf8')).toContain('PRIVATE KEY');

    const mkJob = (patch: any) => ({
      v: 1,
      jobId: crypto.randomUUID(),
      deviceId: 'dev-9',
      organizationId: 'org-9',
      egress: { uploadRawFiles: true, redactSecrets: true },
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...patch,
    });
    const scan = signEnv(mkJob({ type: 'SCAN_DIRECTORY', payload: { directory: scanRoot, projectId: 'p-1' } }));
    const outside = signEnv(mkJob({ type: 'SCAN_DIRECTORY', payload: { directory: '/etc' } }));
    const forgedEnv = canonicalJson(mkJob({ type: 'SCAN_DIRECTORY', payload: { directory: scanRoot } }));
    state.jobs.push(
      { jobId: 'j-scan', ...scan },
      { jobId: 'j-outside', ...outside },
      { jobId: 'j-forged', envelope: forgedEnv, signature: crypto.sign(null, Buffer.from(forgedEnv), crypto.generateKeyPairSync('ed25519').privateKey).toString('base64') }
    );

    const logs: string[] = [];
    const stats = await new AgentDaemon({ once: true, identityManager: mgr, log: (m) => logs.push(m) }).start();
    expect(state.heartbeats).toBe(1);
    expect(stats.jobsExecuted).toBe(1);
    expect(stats.jobsRejected).toBe(1); // forged signature never executed nor acknowledged
    const scanResult = state.results.find((r: any) => r.status === 'COMPLETED');
    expect(scanResult.result.summary.files).toBe(2);
    const dest = scanResult.result.artifacts.find((a: any) => a.relativePath === 'rfc_dest.xml');
    expect(dest.redactedCount).toBeGreaterThan(0);
    const uploaded = Buffer.from(dest.contentBase64, 'base64').toString('utf8');
    expect(uploaded).not.toContain('SuperSecretRfcPwd99');
    expect(uploaded).toContain('sap-prd');
    const rejected = state.results.find((r: any) => r.status === 'REJECTED');
    expect(rejected.error).toMatch(/outside the allowed scan roots/);
    expect(logs.some((l) => /Rejected job j-forged/.test(l))).toBe(true);
  });
});
