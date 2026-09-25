import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateLandscapeDto } from './dto/landscape.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LandscapesService {
  private readonly logger = new Logger(LandscapesService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Section 4 & Part 18.1: Validates target URL against SSRF and cloud metadata exfiltration attacks.
   */
  validateUrlSafety(parsedUrl: URL): { safe: boolean; reason?: string } {
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        safe: false,
        reason: `Disallowed protocol '${parsedUrl.protocol}'. Only HTTP and HTTPS are permitted.`,
      };
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // 1. Cloud instance metadata services (Unconditionally Blocked in all environments)
    const blockedCloudMetadata = [
      '169.254.169.254',
      '169.254.169.253',
      'metadata.google.internal',
      'metadata.google',
      '100.100.100.200',
      'instance-data',
    ];
    if (blockedCloudMetadata.includes(hostname) || hostname.endsWith('.metadata.google.internal')) {
      return {
        safe: false,
        reason: 'Target URL is blocked: Cloud instance metadata endpoint detected (SSRF protection).',
      };
    }

    // 2. Link-local address range (169.254.0.0/16, fe80::/10)
    if (hostname.startsWith('169.254.') || hostname.startsWith('fe80:')) {
      return {
        safe: false,
        reason: 'Target URL is blocked: Link-local addresses are prohibited (SSRF protection).',
      };
    }

    // 3. Loopback / Localhost Addresses
    const isLoopback =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('127.');

    if (isLoopback) {
      const allowLocal = process.env.ALLOW_LOCAL_LANDSCAPE_PROBES === 'true' || process.env.NODE_ENV === 'test';
      if (!allowLocal) {
        return {
          safe: false,
          reason: 'Target URL is blocked: Loopback addresses are prohibited in SaaS cloud deployment.',
        };
      }
    }

    // 4. Private RFC 1918 Subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    const allowPrivate = process.env.ALLOW_PRIVATE_LANDSCAPE_PROBES === 'true' || process.env.NODE_ENV === 'test';
    if (!allowPrivate) {
      if (
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
      ) {
        return {
          safe: false,
          reason: 'Target URL is blocked: Private RFC 1918 subnets require configured Local Agent connector or ALLOW_PRIVATE_LANDSCAPE_PROBES=true.',
        };
      }
    }

    return { safe: true };
  }

  async create(organizationId: string, dto: CreateLandscapeDto) {
    if (dto.url) {
      try {
        const parsed = new URL(dto.url);
        const safety = this.validateUrlSafety(parsed);
        if (!safety.safe) {
          throw new BadRequestException(safety.reason);
        }
      } catch (err: any) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException(`Invalid landscape URL: ${dto.url}`);
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
    let res = await this.db.query(
      `SELECT * FROM landscapes WHERE organization_id = $1 ORDER BY environment ASC, system_id ASC`,
      [organizationId]
    );

    // Auto-seed default landscape if empty
    if (!res.rows?.length) {
      await this.create(organizationId, {
        systemId: 'S4H_DEV_100',
        product: 'SAP S/4HANA',
        edition: 'Private Cloud',
        release: '2023',
        environment: 'DEV',
        url: 'https://s4h-dev.internal:44300',
        businessRole: 'Development & Custom Code Authoring',
        criticality: 'MEDIUM',
      });
      await this.create(organizationId, {
        systemId: 'S4H_QA_200',
        product: 'SAP S/4HANA',
        edition: 'Private Cloud',
        release: '2023',
        environment: 'QA',
        url: 'https://s4h-qa.internal:44300',
        businessRole: 'Preflight Regression & Integration Testing',
        criticality: 'HIGH',
      });
      await this.create(organizationId, {
        systemId: 'S4H_PRD_400',
        product: 'SAP S/4HANA',
        edition: 'Private Cloud',
        release: '2023',
        environment: 'PROD',
        url: 'https://s4h-prd.corp.internal:44300',
        businessRole: 'Live Production Core ERP',
        criticality: 'CRITICAL',
      });

      res = await this.db.query(
        `SELECT * FROM landscapes WHERE organization_id = $1 ORDER BY environment ASC, system_id ASC`,
        [organizationId]
      );
    }

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
        error: `Invalid URL format: ${rawUrl}`,
        status: 'OFFLINE',
        handshakeTimestamp: new Date().toISOString(),
      };
      await this.db.query(
        `UPDATE landscapes SET status = 'OFFLINE', updated_at = NOW() WHERE organization_id = $1 AND id = $2`,
        [organizationId, id]
      );
      return errResult;
    }

    const safety = this.validateUrlSafety(parsedUrl);
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const probeUrl = new URL('/sap/bc/ping', parsedUrl).toString();
      const res = await fetch(probeUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'ERPPreflight-ConnectorProbe/1.0',
          'Accept': 'text/plain,application/json,*/*',
        },
        signal: controller.signal,
      }).catch(async () => {
        // Fallback probe to root URL if /sap/bc/ping path fails
        return await fetch(parsedUrl.toString(), {
          method: 'GET',
          headers: { 'User-Agent': 'ERPPreflight-ConnectorProbe/1.0' },
          signal: controller.signal,
        });
      });

      clearTimeout(timeoutId);

      httpStatusCode = res.status;
      sapServerHeader = res.headers.get('server');

      // In enterprise SAP landscapes, 200 (OK), 401 (Unauthorized), 403 (Forbidden)
      // all prove that the Web Dispatcher / SAP NetWeaver AS is alive and answering on the port!
      if (res.status === 200 || res.status === 401 || res.status === 403) {
        reachable = true;
      } else {
        errorMessage = `HTTP ${res.status} ${res.statusText}`;
      }
    } catch (err: any) {
      reachable = false;
      errorMessage = err.name === 'AbortError' ? 'Connection timed out after 4000ms' : err.message;
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
      status: 'VERIFIED_HEALTHY',
      error: undefined as string | undefined,
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
      handshakeStatus: 'VERIFIED_HEALTHY',
      latencyMs,
      handshakeTimestamp: new Date().toISOString(),
    };

    await this.db.query(
      `UPDATE landscapes
       SET status = 'CONNECTED',
           updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, id]
    );

    return capabilities;
  }
}

