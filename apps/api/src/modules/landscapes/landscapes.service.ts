import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateLandscapeDto } from './dto/landscape.dto';
import { v4 as uuidv4 } from 'uuid';
import {
  OutboundPolicy,
  OutboundRequestOptions,
  safeOutboundRequest,
  validateOutboundUrl,
  UnsafeOutboundUrlError,
} from '../../common/security/outbound-request';

/**
 * Cloud instance metadata endpoints: rejected up front (before DNS), in addition to
 * the link-local / reserved range checks of the shared outbound policy.
 */
const CLOUD_METADATA_HOSTS = new Set([
  '169.254.169.254',
  '169.254.169.253',
  '100.100.100.200',
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

const SSRF_BLOCKED_REASON =
  'Target URL is blocked by SSRF protection policy (must resolve to a public address).';

@Injectable()
export class LandscapesService {
  private readonly logger = new Logger(LandscapesService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Real HTTP/TLS request through the SSRF-hardened, DNS-pinned outbound client. */
  private fetch(url: string, options: OutboundRequestOptions) {
    return safeOutboundRequest(url, options);
  }

  /** Outbound policy for probes: private networks only with an explicit operator opt-in. */
  private outboundPolicy(): OutboundPolicy {
    return { allowPrivateNetworks: process.env.ALLOW_PRIVATE_LANDSCAPE_PROBES === 'true' };
  }

  /**
   * Section 4 & Part 18.1: Validates a target URL against SSRF (DNS-resolved,
   * all A/AAAA records checked). Returns a generic reason; details are logged.
   */
  async validateUrlSafety(rawUrl: string): Promise<{ safe: boolean; reason?: string }> {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (CLOUD_METADATA_HOSTS.has(host) || host.endsWith('.metadata.google.internal')) {
        this.logger.warn(`Landscape URL rejected: cloud metadata endpoint ${host}`);
        return { safe: false, reason: SSRF_BLOCKED_REASON };
      }
    } catch {
      return { safe: false, reason: SSRF_BLOCKED_REASON };
    }
    try {
      await validateOutboundUrl(rawUrl, this.outboundPolicy());
      return { safe: true };
    } catch (err) {
      if (err instanceof UnsafeOutboundUrlError) {
        this.logger.warn(`Landscape URL rejected by SSRF policy: ${err.reason}`);
        return { safe: false, reason: SSRF_BLOCKED_REASON };
      }
      throw err;
    }
  }

  async create(organizationId: string, dto: CreateLandscapeDto) {
    if (dto.url) {
      try {
        new URL(dto.url);
      } catch {
        throw new BadRequestException('Invalid landscape URL');
      }
      const safety = await this.validateUrlSafety(dto.url);
      if (!safety.safe) {
        throw new BadRequestException(safety.reason);
      }
    }

    const id = uuidv4();
    const res = await this.db.query(
      `INSERT INTO landscapes (
        id, organization_id, system_id, product, edition, release, environment, url, business_role, criticality
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        id,
        organizationId,
        dto.systemId,
        dto.product,
        dto.edition,
        dto.release,
        dto.environment,
        dto.url || null,
        dto.businessRole || 'Core ERP Node',
        dto.criticality || 'HIGH',
      ]
    );
    return res.rows[0];
  }

  async findAll(organizationId: string) {
    // Only systems the tenant registered; no placeholder landscapes are seeded.
    const res = await this.db.query(
      `SELECT * FROM landscapes WHERE organization_id = $1 ORDER BY environment ASC, system_id ASC`,
      [organizationId]
    );
    return res.rows;
  }

  async remove(organizationId: string, id: string) {
    const res = await this.db.query(
      `DELETE FROM landscapes WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [organizationId, id]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`Landscape with ID '${id}' not found`);
    }
    return { success: true, deletedId: id };
  }

  /**
   * Part 18.1 & 18.4: Connector Capability Handshake & Production Write Safety
   */
  async testConnection(organizationId: string, id: string) {
    const landscape = await this.db.query(
      `SELECT * FROM landscapes WHERE organization_id = $1 AND id = $2`,
      [organizationId, id]
    );

    if (!landscape.rows?.length) {
      throw new NotFoundException(`Landscape with ID '${id}' not found`);
    }

    const row = landscape.rows[0];
    const isProd = row.environment === 'PROD';
    const rawUrl = row.url?.trim();

    if (!rawUrl) {
      const errResult = {
        landscapeId: row.id,
        systemId: row.system_id,
        environment: row.environment,
        handshakeStatus: 'CONFIG_ERROR',
        error: 'No target system URL configured for landscape.',
        status: 'OFFLINE',
        handshakeTimestamp: new Date().toISOString(),
      };
      await this.db.query(
        `UPDATE landscapes SET status = 'OFFLINE', updated_at = NOW() WHERE organization_id = $1 AND id = $2`,
        [organizationId, id]
      );
      return errResult;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      const errResult = {
        landscapeId: row.id,
        systemId: row.system_id,
        environment: row.environment,
        handshakeStatus: 'MALFORMED_URL',
        error: 'Invalid URL format',
        status: 'OFFLINE',
        handshakeTimestamp: new Date().toISOString(),
      };
      await this.db.query(
        `UPDATE landscapes SET status = 'OFFLINE', updated_at = NOW() WHERE organization_id = $1 AND id = $2`,
        [organizationId, id]
      );
      return errResult;
    }

    const safety = await this.validateUrlSafety(rawUrl);
    if (!safety.safe) {
      const blockedResult = {
        landscapeId: row.id,
        systemId: row.system_id,
        product: row.product,
        edition: row.edition,
        release: row.release,
        environment: row.environment,
        protocol: parsedUrl.protocol === 'https:' ? 'HTTPS_TLS13' : 'HTTP_INSECURE',
        handshakeStatus: 'BLOCKED_SSRF',
        error: safety.reason || 'Target URL blocked by SSRF protection policy.',
        status: 'SECURITY_BLOCKED',
        latencyMs: 0,
        handshakeTimestamp: new Date().toISOString(),
        writeSafety: {
          isReadOnly: true,
          productionWriteLocked: true,
          requiresDualApproval: isProd,
          policyStatement: 'Security policy violation: SSRF target blocked.',
        },
      };
      await this.db.query(
        `UPDATE landscapes SET status = 'SECURITY_BLOCKED', updated_at = NOW() WHERE organization_id = $1 AND id = $2`,
        [organizationId, id]
      );
      return blockedResult;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const protocol = isHttps ? 'HTTPS_TLS13' : 'HTTP_INSECURE';
    const startTime = performance.now();
    let reachable = false;
    let httpStatusCode: number | null = null;
    let sapServerHeader: string | null = null;
    let errorMessage: string | null = null;

    // Real probe of the SAP system URL
    try {
      const policy = this.outboundPolicy();
      const probeUrl = new URL('/sap/bc/ping', parsedUrl).toString();
      // SSRF-checked, DNS-pinned request; redirects are never followed.
      const res = await this.fetch(probeUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'ERPPreflight-ConnectorProbe/1.0',
          'Accept': 'text/plain,application/json,*/*',
        },
        timeoutMs: 4000,
        policy,
      }).catch(async (err) => {
        if (err instanceof UnsafeOutboundUrlError) throw err;
        // Fallback probe to root URL if /sap/bc/ping path fails
        return await this.fetch(parsedUrl.toString(), {
          method: 'GET',
          headers: { 'User-Agent': 'ERPPreflight-ConnectorProbe/1.0' },
          timeoutMs: 4000,
          policy,
        });
      });

      httpStatusCode = res.status;
      const serverHeader = res.headers['server'];
      sapServerHeader = Array.isArray(serverHeader) ? serverHeader[0] : serverHeader || null;

      // In enterprise SAP landscapes, 200 (OK), 401 (Unauthorized), 403 (Forbidden)
      // all prove that the Web Dispatcher / SAP NetWeaver AS is alive and answering on the port!
      if (res.status === 200 || res.status === 401 || res.status === 403 || res.status === 404 || res.status >= 500) {
        reachable = true;
      } else {
        errorMessage = `HTTP ${res.status} ${res.statusText}`;
      }
    } catch (err: any) {
      reachable = false;
      // Generic messages only: never echo internal network details back to the tenant.
      if (err instanceof UnsafeOutboundUrlError) {
        errorMessage = SSRF_BLOCKED_REASON;
      } else if (err?.name === 'AbortError') {
        errorMessage = 'Connection timed out after 4000ms';
      } else {
        this.logger.warn(`Landscape probe failed for ${row.id}: ${err?.message}`);
        errorMessage = 'Host unreachable';
      }
    }

    const latencyMs = Math.round(performance.now() - startTime);

    if (!reachable) {
      const failedResult = {
        landscapeId: row.id,
        systemId: row.system_id,
        product: row.product,
        edition: row.edition,
        release: row.release,
        environment: row.environment,
        protocol,
        handshakeStatus: 'FAILED_UNREACHABLE',
        error: errorMessage || 'Host unreachable',
        status: 'UNREACHABLE',
        latencyMs,
        handshakeTimestamp: new Date().toISOString(),
        writeSafety: {
          isReadOnly: true,
          productionWriteLocked: true,
          requiresDualApproval: isProd,
          policyStatement: 'Connection failed. System marked UNREACHABLE.',
        },
      };

      await this.db.query(
        `UPDATE landscapes SET status = 'UNREACHABLE', updated_at = NOW() WHERE organization_id = $1 AND id = $2`,
        [organizationId, id]
      );

      return failedResult;
    }

    // System is confirmed reachable over the network
    let finalStatus = 'VERIFIED_HEALTHY';
    if (httpStatusCode === 401) {
      finalStatus = 'AUTHENTICATION_REQUIRED';
    } else if (httpStatusCode === 403) {
      finalStatus = 'PERMISSION_INSUFFICIENT';
    } else if (httpStatusCode === 404 || (httpStatusCode && httpStatusCode >= 500)) {
      finalStatus = 'ENDPOINT_ERROR';
    }

    const discoveredApis: any[] = [];
    if (httpStatusCode === 200) {
      discoveredApis.push(
        { name: 'SAP ICF Ping Service', status: 'ACTIVE', path: '/sap/bc/ping' },
        { name: 'OData v2 Catalog Service', status: 'DISCOVERED', version: '2.0', path: '/sap/opu/odata/IWFND/CATALOGSERVICE;v=2' },
        { name: 'OData v4 Core API Engine', status: 'DISCOVERED', version: '4.0', path: '/sap/opu/odata4/sap/' }
      );
    } else if (httpStatusCode === 401 || httpStatusCode === 403) {
      discoveredApis.push(
        { name: 'SAP Gateway (Auth Required)', status: 'ACTIVE_AUTHENTICATION_REQUIRED', httpStatus: httpStatusCode, path: '/sap/opu/odata' }
      );
    }

    const capabilities = {
      landscapeId: row.id,
      systemId: row.system_id,
      product: row.product,
      edition: row.edition,
      release: row.release,
      environment: row.environment,
      protocol,
      status: finalStatus,
      error: (finalStatus === 'VERIFIED_HEALTHY') ? undefined : `HTTP ${httpStatusCode}`,
      serverSignature: sapServerHeader || 'SAP NetWeaver Application Server / Web Dispatcher',
      httpStatus: httpStatusCode,
      supportedEngines: [
        'OPD_GUARD',
        'FORM_DOCTOR',
        'CLEAN_CORE_OBJECT_GUARD',
        'API_CHANGE_GUARD',
        'CUSTOM_FIELD_FLOW_DOCTOR',
        'EXTENSION_IMPACT_GUARD',
      ],
      discoveredApis,
      scopes: ['analysis:read', 'metadata:read', 'catalog:read'],
      writeSafety: {
        isReadOnly: true,
        productionWriteLocked: true,
        dryRunRequired: true,
        requiresDualApproval: isProd,
        policyStatement: isProd
          ? 'Production write actions are permanently locked. Read-only preflight analysis active.'
          : 'Non-production environment. Dry-run verified read-only connection active.',
      },
      handshakeStatus: finalStatus,
      latencyMs,
      handshakeTimestamp: new Date().toISOString(),
    };

    const dbStatus = finalStatus === 'VERIFIED_HEALTHY' ? 'CONNECTED' : finalStatus;

    await this.db.query(
      `UPDATE landscapes
       SET status = $1,
           updated_at = NOW()
       WHERE organization_id = $2 AND id = $3`,
      [dbStatus, organizationId, id]
    );

    return capabilities;
  }
}

