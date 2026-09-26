import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { ConnectorsService } from './connectors.service';
import { IntegrationAuditService } from './integration-audit.service';
import { parseBody } from './zod-body';
import {
  canonicalJson,
  deviceRequestSigningString,
  getAgentSigningKey,
  signEnvelope,
  verifyEd25519,
} from './agent-signing';

/**
 * Local agent device management (Part 03 §3.12, Part 18.7/18.8, C §36).
 *
 * Trust model:
 *  - Enrollment: an admin issues a single-use, short-lived enrollment token
 *    (stored as SHA-256). The device generates an Ed25519 key pair locally and
 *    enrolls with its PUBLIC key; the API returns a device credential (stored as
 *    SHA-256) and the API job-signing public key, which the agent pins.
 *  - Every device request carries the credential AND an Ed25519 signature over
 *    method/path/timestamp/body-hash made with the device private key (proof of
 *    possession, ±5 min clock skew) — a device identity equivalent to mTLS at the
 *    application layer; TLS termination can add mTLS at the proxy.
 *  - Outbound-only: the agent polls; the API never connects to the device.
 *  - Job instructions are Ed25519-signed envelopes bound to device, tenant and
 *    expiry; the agent refuses unsigned, expired, replayed or foreign jobs.
 *  - Heartbeats update device last-seen and the LOCAL_AGENT connector health.
 *  - Revocation invalidates the credential immediately.
 */

export const IssueEnrollmentTokenSchema = z
  .object({
    label: z.string().trim().max(200).optional(),
    ttlMinutes: z.coerce.number().int().min(5).max(7 * 24 * 60).default(60),
  })
  .strict();

export const EnrollSchema = z
  .object({
    enrollmentToken: z.string().min(20).max(200),
    name: z.string().trim().min(1).max(200),
    hostname: z.string().trim().max(255).optional(),
    publicKeyPem: z.string().min(40).max(2000),
    agentVersion: z.string().trim().max(50).optional(),
    platform: z.string().trim().max(100).optional(),
    capabilities: z.array(z.string().max(50)).max(20).default([]),
  })
  .strict();

export const HeartbeatSchema = z
  .object({
    agentVersion: z.string().max(50).optional(),
    uptimeSec: z.number().nonnegative().optional(),
    platform: z.string().max(100).optional(),
    capabilities: z.array(z.string().max(50)).max(20).optional(),
    rssBytes: z.number().nonnegative().optional(),
    loadAvg: z.array(z.number()).max(3).optional(),
  })
  .strict();

export const CreateJobSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('SCAN_DIRECTORY'),
      payload: z
        .object({
          directory: z.string().trim().min(1).max(1000),
          projectId: z.string().uuid().optional(),
          maxFiles: z.number().int().min(1).max(1000).default(200),
        })
        .strict(),
      ttlMinutes: z.number().int().min(1).max(1440).default(60),
    })
    .strict(),
  z
    .object({
      type: z.literal('PROBE_URL'),
      payload: z.object({ url: z.string().url().max(2000) }).strict(),
      ttlMinutes: z.number().int().min(1).max(1440).default(60),
    })
    .strict(),
]);

export const JobResultSchema = z
  .object({
    status: z.enum(['COMPLETED', 'FAILED', 'REJECTED']),
    error: z.string().max(1000).optional(),
    result: z
      .object({
        summary: z.record(z.unknown()).optional(),
        artifacts: z
          .array(
            z
              .object({
                relativePath: z.string().max(1000),
                sha256: z.string().regex(/^[0-9a-f]{64}$/),
                sizeBytes: z.number().int().nonnegative(),
                redactedCount: z.number().int().nonnegative(),
                contentBase64: z.string().max(7_000_000).optional(),
              })
              .strict()
          )
          .max(1000)
          .optional(),
        probe: z.record(z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const MAX_SKEW_MS = 5 * 60_000;
const MAX_UPLOAD_BYTES_PER_JOB = 20 * 1024 * 1024;

export interface AuthenticatedDevice {
  id: string;
  organization_id: string;
  connector_id: string | null;
  public_key_pem: string;
  status: string;
  egress_policy: { redactSecrets?: boolean; uploadRawFiles?: boolean };
  name: string;
}

@Injectable()
export class AgentDevicesService {
  private readonly logger = new Logger(AgentDevicesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly connectors: ConnectorsService,
    private readonly audit: IntegrationAuditService,
    @Optional() private readonly ingestion?: IngestionService
  ) {}

  signingKey() {
    return getAgentSigningKey();
  }

  // ---------------------------------------------------------------------------
  // Admin side
  // ---------------------------------------------------------------------------
  async issueEnrollmentToken(organizationId: string, actorId: string | null, body: unknown) {
    const dto = parseBody(IssueEnrollmentTokenSchema, body ?? {});
    const token = `erppf_enroll_${crypto.randomBytes(24).toString('base64url')}`;
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + dto.ttlMinutes * 60_000);
    await this.db.query(
      `INSERT INTO agent_enrollment_tokens (id, organization_id, token_hash, label, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, organizationId, sha256(token), dto.label ?? null, expiresAt, actorId],
      { tenantId: organizationId }
    );
    await this.audit.record({
      organizationId,
      action: 'agent.enrollment_token_issued',
      resourceType: 'AGENT_DEVICE',
      resourceId: id,
      actorId,
      payload: { label: dto.label ?? null, expiresAt: expiresAt.toISOString() },
    });
    return { id, enrollmentToken: token, expiresAt, jobSigningPublicKey: this.signingKey().publicKeyPem };
  }

  mapDevice(r: any) {
    return {
      id: r.id,
      name: r.name,
      hostname: r.hostname,
      status: r.status,
      agentVersion: r.agent_version,
      platform: r.platform,
      capabilities: r.capabilities,
      updateChannel: r.update_channel,
      egressPolicy: r.egress_policy,
      publicKeyFingerprint: r.public_key_fingerprint,
      connectorId: r.connector_id,
      lastSeenAt: r.last_seen_at,
      lastHeartbeat: r.last_heartbeat,
      enrolledAt: r.enrolled_at,
      revokedAt: r.revoked_at,
    };
  }

  async listDevices(organizationId: string) {
    const res = await this.db.query(`SELECT * FROM agent_devices WHERE organization_id = $1 ORDER BY enrolled_at DESC`, [organizationId], {
      tenantId: organizationId,
    });
    return res.rows.map((r: any) => this.mapDevice(r));
  }

  async revokeDevice(organizationId: string, actorId: string | null, id: string) {
    const res = await this.db.query(
      `UPDATE agent_devices SET status = 'REVOKED', revoked_at = NOW(), revoked_by = $3
        WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE' RETURNING *`,
      [organizationId, id, actorId],
      { tenantId: organizationId }
    );
    if (!res.rows[0]) throw new NotFoundException('Active device not found');
    const device = res.rows[0];
    await this.db.query(
      `UPDATE agent_jobs SET status = 'EXPIRED' WHERE organization_id = $1 AND device_id = $2 AND status IN ('QUEUED','DISPATCHED')`,
      [organizationId, id],
      { tenantId: organizationId }
    );
    if (device.connector_id) {
      await this.db.query(
        `UPDATE connector_instances SET status = 'DISABLED', health_status = 'UNHEALTHY', last_error = 'Device revoked', updated_at = NOW()
          WHERE organization_id = $1 AND id = $2`,
        [organizationId, device.connector_id],
        { tenantId: organizationId }
      );
    }
    await this.audit.record({
      organizationId,
      action: 'agent.device_revoked',
      resourceType: 'AGENT_DEVICE',
      resourceId: id,
      actorId,
      payload: { name: device.name, fingerprint: device.public_key_fingerprint },
    });
    return this.mapDevice(device);
  }

  async createJob(organizationId: string, actorId: string | null, deviceId: string, body: unknown) {
    const dto = parseBody(CreateJobSchema, body);
    const dev = await this.db.query(`SELECT * FROM agent_devices WHERE organization_id = $1 AND id = $2`, [organizationId, deviceId], {
      tenantId: organizationId,
    });
    const device = dev.rows[0];
    if (!device) throw new NotFoundException('Device not found');
    if (device.status !== 'ACTIVE') throw new BadRequestException('Device is revoked');
    if (dto.type === 'SCAN_DIRECTORY' && dto.payload.projectId) {
      const p = await this.db.query(`SELECT id FROM projects WHERE organization_id = $1 AND id = $2`, [organizationId, dto.payload.projectId], {
        tenantId: organizationId,
      });
      if (!p.rows[0]) throw new NotFoundException('Project not found');
    }
    const id = uuidv4();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + dto.ttlMinutes * 60_000);
    const envelope = {
      v: 1,
      jobId: id,
      deviceId,
      organizationId,
      type: dto.type,
      payload: dto.payload,
      egress: { uploadRawFiles: Boolean(device.egress_policy?.uploadRawFiles), redactSecrets: device.egress_policy?.redactSecrets !== false },
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const signed = signEnvelope(this.signingKey(), envelope);
    await this.db.query(
      `INSERT INTO agent_jobs (id, organization_id, device_id, job_type, payload, signed_envelope, signature, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, organizationId, deviceId, dto.type, JSON.stringify(dto.payload), signed.envelope, signed.signature, actorId, expiresAt],
      { tenantId: organizationId }
    );
    await this.audit.record({
      organizationId,
      action: 'agent.job_created',
      resourceType: 'AGENT_DEVICE',
      resourceId: deviceId,
      actorId,
      payload: { jobId: id, type: dto.type },
    });
    return { id, type: dto.type, status: 'QUEUED', expiresAt, signatureKeyId: signed.keyId };
  }

  async listJobs(organizationId: string, deviceId: string) {
    const res = await this.db.query(
      `SELECT id, job_type, payload, status, result, error, created_at, dispatched_at, completed_at, expires_at
         FROM agent_jobs WHERE organization_id = $1 AND device_id = $2 ORDER BY created_at DESC LIMIT 100`,
      [organizationId, deviceId],
      { tenantId: organizationId }
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      type: r.job_type,
      payload: r.payload,
      status: r.status,
      result: r.result,
      error: r.error,
      createdAt: r.created_at,
      dispatchedAt: r.dispatched_at,
      completedAt: r.completed_at,
      expiresAt: r.expires_at,
    }));
  }

  // ---------------------------------------------------------------------------
  // Device side
  // ---------------------------------------------------------------------------
  async enroll(body: unknown, clientIp?: string) {
    const dto = parseBody(EnrollSchema, body);
    let publicKey: crypto.KeyObject;
    try {
      publicKey = crypto.createPublicKey(dto.publicKeyPem);
    } catch {
      throw new BadRequestException('publicKeyPem is not a valid public key');
    }
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new BadRequestException('Device keys must be Ed25519');
    const tokenHash = sha256(dto.enrollmentToken);
    // Unknown tenant until the token is resolved: cross-tenant lookup by hash only.
    const tokRes = await this.db.query(
      `SELECT id, organization_id, expires_at, used_at FROM agent_enrollment_tokens WHERE token_hash = $1`,
      [tokenHash],
      { bypassRls: true }
    );
    const tok = tokRes.rows[0];
    if (!tok || tok.used_at || new Date(tok.expires_at) < new Date()) {
      throw new UnauthorizedException('Enrollment token is invalid, expired or already used');
    }
    const organizationId: string = tok.organization_id;
    const deviceId = uuidv4();
    const credential = `erppf_dev_${crypto.randomBytes(32).toString('base64url')}`;
    const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
    const fingerprint = crypto.createHash('sha256').update(spkiDer).digest('hex');
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    // Single-use: claim the token atomically.
    const claimed = await this.db.query(
      `UPDATE agent_enrollment_tokens SET used_at = NOW(), device_id = $3
        WHERE organization_id = $1 AND id = $2 AND used_at IS NULL RETURNING id`,
      [organizationId, tok.id, deviceId],
      { tenantId: organizationId }
    );
    if (!claimed.rows[0]) throw new UnauthorizedException('Enrollment token is invalid, expired or already used');

    const connector = await this.connectors.create(
      organizationId,
      null,
      { type: 'LOCAL_AGENT', name: `Local agent: ${dto.name} (${deviceId.slice(0, 8)})`, config: { deviceId } },
      { systemManaged: true }
    );
    await this.db.query(
      `INSERT INTO agent_devices (id, organization_id, connector_id, name, hostname, public_key_pem, public_key_fingerprint,
         credential_hash, agent_version, platform, capabilities)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        deviceId,
        organizationId,
        connector.id,
        dto.name,
        dto.hostname ?? null,
        publicPem,
        fingerprint,
        sha256(credential),
        dto.agentVersion ?? null,
        dto.platform ?? null,
        JSON.stringify(dto.capabilities),
      ],
      { tenantId: organizationId }
    );
    await this.audit.record({
      organizationId,
      action: 'agent.device_enrolled',
      resourceType: 'AGENT_DEVICE',
      resourceId: deviceId,
      payload: { name: dto.name, hostname: dto.hostname ?? null, fingerprint, agentVersion: dto.agentVersion ?? null, clientIp: clientIp ?? null },
    });
    const key = this.signingKey();
    return {
      deviceId,
      organizationId,
      connectorId: connector.id,
      deviceCredential: credential,
      publicKeyFingerprint: fingerprint,
      jobSigningPublicKey: key.publicKeyPem,
      jobSigningKeyId: key.keyId,
      heartbeatIntervalSec: Number(process.env.AGENT_HEARTBEAT_INTERVAL_SEC || 30),
    };
  }

  /**
   * Authenticates a device request: credential (hash lookup) + Ed25519 request
   * signature by the enrolled device key + timestamp freshness.
   */
  async authenticate(headers: Record<string, any>, method: string, path: string, rawBody: string): Promise<AuthenticatedDevice> {
    const auth = String(headers['authorization'] || '');
    const m = auth.match(/^Device\s+(\S+)$/i);
    if (!m) throw new UnauthorizedException('Device credential required');
    const ts = String(headers['x-agent-timestamp'] || '');
    const sig = String(headers['x-agent-signature'] || '');
    if (!ts || !sig) throw new UnauthorizedException('Signed device request required');
    const tsMs = Date.parse(ts);
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
      throw new UnauthorizedException('Device request timestamp outside the allowed window');
    }
    const res = await this.db.query(
      `SELECT id, organization_id, connector_id, public_key_pem, status, egress_policy, name FROM agent_devices WHERE credential_hash = $1`,
      [sha256(m[1])],
      { bypassRls: true }
    );
    const device = res.rows[0] as AuthenticatedDevice | undefined;
    if (!device) throw new UnauthorizedException('Unknown device credential');
    if (device.status !== 'ACTIVE') throw new ForbiddenException('Device has been revoked');
    const signingString = deviceRequestSigningString(method, path, ts, rawBody);
    if (!verifyEd25519(device.public_key_pem, signingString, sig)) {
      throw new UnauthorizedException('Device request signature is invalid');
    }
    return device;
  }

  async heartbeat(device: AuthenticatedDevice, body: unknown) {
    const dto = parseBody(HeartbeatSchema, body ?? {});
    const org = device.organization_id;
    await this.db.query(
      `UPDATE agent_devices SET last_seen_at = NOW(), last_heartbeat = $3,
              agent_version = COALESCE($4, agent_version), platform = COALESCE($5, platform),
              capabilities = COALESCE($6, capabilities)
        WHERE organization_id = $1 AND id = $2`,
      [org, device.id, JSON.stringify({ ...dto, receivedAt: new Date().toISOString() }), dto.agentVersion ?? null, dto.platform ?? null, dto.capabilities ? JSON.stringify(dto.capabilities) : null],
      { tenantId: org }
    );
    if (device.connector_id) {
      await this.db.query(
        `UPDATE connector_instances SET health_status = 'HEALTHY', last_checked_at = NOW(), last_success_at = NOW(),
                last_error = NULL, consecutive_failures = 0, circuit_state = 'CLOSED', circuit_opened_at = NULL, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2`,
        [org, device.connector_id],
        { tenantId: org }
      );
    }
    // Expire stale jobs, then dispatch queued ones (outbound-only polling).
    await this.db.query(
      `UPDATE agent_jobs SET status = 'EXPIRED' WHERE organization_id = $1 AND device_id = $2 AND status IN ('QUEUED','DISPATCHED') AND expires_at < NOW()`,
      [org, device.id],
      { tenantId: org }
    );
    const jobs = await this.db.query(
      `UPDATE agent_jobs SET status = 'DISPATCHED', dispatched_at = NOW()
        WHERE id IN (SELECT id FROM agent_jobs WHERE organization_id = $1 AND device_id = $2 AND status = 'QUEUED'
                      ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED)
        RETURNING id, signed_envelope, signature`,
      [org, device.id],
      { tenantId: org }
    );
    return {
      serverTime: new Date().toISOString(),
      jobs: jobs.rows.map((j: any) => ({ jobId: j.id, envelope: j.signed_envelope, signature: j.signature })),
    };
  }

  async submitResult(device: AuthenticatedDevice, jobId: string, body: unknown) {
    const dto = parseBody(JobResultSchema, body);
    const org = device.organization_id;
    const jobRes = await this.db.query(
      `SELECT * FROM agent_jobs WHERE organization_id = $1 AND id = $2 AND device_id = $3`,
      [org, jobId, device.id],
      { tenantId: org }
    );
    const job = jobRes.rows[0];
    if (!job) throw new NotFoundException('Job not found for this device');
    if (job.status !== 'DISPATCHED') throw new BadRequestException(`Job is ${job.status}`);

    const artifacts = dto.result?.artifacts ?? [];
    const withContent = artifacts.filter((a) => a.contentBase64);
    const ingested: Array<{ relativePath: string; fileId?: string; status: string; error?: string }> = [];
    if (withContent.length) {
      if (!device.egress_policy?.uploadRawFiles) {
        throw new ForbiddenException('Device egress policy does not allow uploading file contents');
      }
      const projectId = job.payload?.projectId;
      if (!projectId) throw new BadRequestException('Job has no target project for uploads');
      if (!this.ingestion) throw new BadRequestException('Ingestion pipeline unavailable');
      let total = 0;
      for (const a of withContent) {
        const buf = Buffer.from(a.contentBase64!, 'base64');
        total += buf.length;
        if (total > MAX_UPLOAD_BYTES_PER_JOB) {
          ingested.push({ relativePath: a.relativePath, status: 'SKIPPED', error: 'job upload volume limit reached' });
          continue;
        }
        try {
          const fileName = a.relativePath.split(/[\\/]/).pop() || 'artifact';
          const pre = await this.ingestion.requestPresignedUpload(org, projectId, null, {
            fileName,
            fileSize: buf.length,
            mimeType: 'application/octet-stream',
          } as any);
          const conf: any = await this.ingestion.confirmUpload(org, projectId, pre.fileId, buf);
          ingested.push({ relativePath: a.relativePath, fileId: pre.fileId, status: conf?.quarantineStatus || 'PROCESSED' });
        } catch (err: any) {
          ingested.push({ relativePath: a.relativePath, status: 'REJECTED', error: String(err?.response?.message || err?.message).slice(0, 200) });
        }
      }
    }
    // Store the manifest (paths, hashes, sizes, redaction counts) — never file contents.
    const storedResult = {
      summary: dto.result?.summary ?? null,
      probe: dto.result?.probe ?? null,
      artifacts: artifacts.map(({ contentBase64: _c, ...rest }) => rest),
      ingested,
    };
    await this.db.query(
      `UPDATE agent_jobs SET status = $3, result = $4, error = $5, completed_at = NOW() WHERE organization_id = $1 AND id = $2`,
      [org, jobId, dto.status, JSON.stringify(storedResult), dto.error ?? null],
      { tenantId: org }
    );
    await this.audit.record({
      organizationId: org,
      action: 'agent.job_completed',
      resourceType: 'AGENT_DEVICE',
      resourceId: device.id,
      payload: { jobId, status: dto.status, artifacts: artifacts.length, ingested: ingested.length },
    });
    return { accepted: true, ingested };
  }

  /** Part 18.8: signed update manifest for a channel (published by operators via env). */
  updateManifest(channel: string) {
    if (!/^[a-z]{1,20}$/.test(channel)) throw new BadRequestException('Invalid channel');
    const raw = process.env[`AGENT_UPDATE_MANIFEST_${channel.toUpperCase()}`];
    if (!raw) throw new NotFoundException(`No agent update published on channel '${channel}'`);
    let manifest: any;
    try {
      manifest = JSON.parse(raw);
    } catch {
      throw new NotFoundException('Published update manifest is malformed');
    }
    const parsed = z
      .object({ version: z.string().max(50), url: z.string().url(), sha256: z.string().regex(/^[0-9a-f]{64}$/), notes: z.string().max(2000).optional() })
      .safeParse(manifest);
    if (!parsed.success) throw new NotFoundException('Published update manifest is invalid');
    const body = { ...parsed.data, channel };
    const signed = signEnvelope(this.signingKey(), body);
    return { manifest: body, canonical: canonicalJson(body), signature: signed.signature, keyId: signed.keyId };
  }
}
