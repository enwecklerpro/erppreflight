import * as crypto from 'node:crypto';
import { ConnectorContext, ConnectionTestResult, ConnectorAdapter, basicAuth, joinUrl } from './adapter.types';
import { getClientCredentialsToken } from './oauth2';
import { CONNECTOR_DEFINITIONS } from '../connector-registry';
import { XmlElement, childrenByLocal, findAll, parseSafeXml } from '../safe-xml';

/**
 * Metadata connectors (C §35, §30 API Change Guard):
 *  - ODATA: fetches `<serviceRoot>/$metadata`, parses the EDMX with the defused
 *    XML parser and normalizes it into a deterministic, sorted JSON structure.
 *  - HTTP_OPENAPI: health probe + optional OpenAPI (JSON) document normalization.
 * The normalized documents are stored as connector_metadata_snapshots and serve
 * as API Change Guard baselines; identical documents produce identical hashes.
 */

export interface MetadataSnapshot {
  kind: 'ODATA_METADATA' | 'OPENAPI';
  servicePath: string;
  protocolVersion: string;
  contentSha256: string;
  contentBytes: number;
  normalized: Record<string, unknown>;
  summary: Record<string, unknown>;
}

const byName = <T extends { name: string }>(a: T, b: T) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// ---------------------------------------------------------------------------
// OData $metadata normalization
// ---------------------------------------------------------------------------
export function normalizeODataMetadata(xml: string | Buffer) {
  const root = parseSafeXml(xml);
  if (root.local !== 'Edmx') {
    throw new Error(`Not an EDMX document (root element <${root.name}>)`);
  }
  const edmxVersion = root.attrs.Version || root.attrs['m:DataServiceVersion'] || '';
  const odataVersion = edmxVersion.startsWith('4') ? 'V4' : 'V2';
  const schemas = findAll(root, 'Schema');

  const entityTypes: any[] = [];
  const complexTypes: any[] = [];
  const entitySets: any[] = [];
  const operations: any[] = [];

  const prop = (p: XmlElement) => ({
    name: p.attrs.Name,
    type: p.attrs.Type,
    nullable: p.attrs.Nullable !== 'false',
    ...(p.attrs.MaxLength ? { maxLength: p.attrs.MaxLength } : {}),
  });

  for (const schema of schemas) {
    const ns = schema.attrs.Namespace || '';
    for (const et of childrenByLocal(schema, 'EntityType')) {
      const keyEl = childrenByLocal(et, 'Key')[0];
      entityTypes.push({
        name: `${ns}.${et.attrs.Name}`,
        key: keyEl ? childrenByLocal(keyEl, 'PropertyRef').map((r) => r.attrs.Name).sort() : [],
        properties: childrenByLocal(et, 'Property').map(prop).sort(byName),
        navigation: childrenByLocal(et, 'NavigationProperty')
          .map((n) => ({
            name: n.attrs.Name,
            target: n.attrs.Type || n.attrs.ToRole || '',
            ...(n.attrs.Relationship ? { relationship: n.attrs.Relationship } : {}),
          }))
          .sort(byName),
      });
    }
    for (const ct of childrenByLocal(schema, 'ComplexType')) {
      complexTypes.push({ name: `${ns}.${ct.attrs.Name}`, properties: childrenByLocal(ct, 'Property').map(prop).sort(byName) });
    }
    for (const container of childrenByLocal(schema, 'EntityContainer')) {
      for (const es of childrenByLocal(container, 'EntitySet')) {
        entitySets.push({ name: es.attrs.Name, entityType: es.attrs.EntityType });
      }
      for (const kind of ['FunctionImport', 'ActionImport']) {
        for (const fi of childrenByLocal(container, kind)) {
          operations.push({
            name: fi.attrs.Name,
            kind,
            httpMethod: fi.attrs['m:HttpMethod'] || undefined,
            returnType: fi.attrs.ReturnType || fi.attrs.Function || fi.attrs.Action || undefined,
            parameters: childrenByLocal(fi, 'Parameter')
              .map((p) => ({ name: p.attrs.Name, type: p.attrs.Type }))
              .sort(byName),
          });
        }
      }
    }
    for (const kind of ['Function', 'Action']) {
      for (const fn of childrenByLocal(schema, kind)) {
        operations.push({
          name: `${ns}.${fn.attrs.Name}`,
          kind,
          bound: fn.attrs.IsBound === 'true',
          parameters: childrenByLocal(fn, 'Parameter')
            .map((p) => ({ name: p.attrs.Name, type: p.attrs.Type }))
            .sort(byName),
        });
      }
    }
  }

  const normalized = {
    odataVersion,
    schemaNamespaces: schemas.map((s) => s.attrs.Namespace).filter(Boolean).sort(),
    entityTypes: entityTypes.sort(byName),
    complexTypes: complexTypes.sort(byName),
    entitySets: entitySets.sort(byName),
    operations: operations.sort(byName),
  };
  return {
    odataVersion,
    normalized,
    summary: {
      entityTypes: entityTypes.length,
      entitySets: entitySets.length,
      complexTypes: complexTypes.length,
      operations: operations.length,
      properties: entityTypes.reduce((n, e) => n + e.properties.length, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAPI normalization (JSON documents)
// ---------------------------------------------------------------------------
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function normalizeOpenApi(doc: any) {
  if (!doc || typeof doc !== 'object' || (!doc.openapi && !doc.swagger) || typeof doc.paths !== 'object') {
    throw new Error('Not an OpenAPI/Swagger JSON document');
  }
  const operations: any[] = [];
  for (const [path, item] of Object.entries<any>(doc.paths || {})) {
    const shared = Array.isArray(item?.parameters) ? item.parameters : [];
    for (const m of METHODS) {
      const op = item?.[m];
      if (!op) continue;
      const params = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]
        .filter((p: any) => p && p.name)
        .map((p: any) => ({ name: String(p.name), in: String(p.in || ''), required: Boolean(p.required) }));
      operations.push({
        name: `${m.toUpperCase()} ${path}`,
        method: m.toUpperCase(),
        path,
        operationId: op.operationId || null,
        deprecated: Boolean(op.deprecated),
        parameters: params.sort((a: any, b: any) => (`${a.in}:${a.name}` < `${b.in}:${b.name}` ? -1 : 1)),
        requestBodyRequired: Boolean(op.requestBody?.required),
        responses: Object.keys(op.responses || {}).sort(),
      });
    }
  }
  operations.sort(byName);
  return {
    version: String(doc.openapi || doc.swagger),
    normalized: {
      specVersion: String(doc.openapi || doc.swagger),
      title: doc.info?.title ?? null,
      apiVersion: doc.info?.version ?? null,
      operations,
    },
    summary: {
      operations: operations.length,
      paths: Object.keys(doc.paths || {}).length,
      deprecated: operations.filter((o) => o.deprecated).length,
    },
  };
}

function sha256(buf: Buffer | string) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// OData adapter
// ---------------------------------------------------------------------------
export interface ODataConfig {
  serviceRootUrl: string;
  odataVersion: 'AUTO' | 'V2' | 'V4';
  sapClient?: string;
  authType: 'NONE' | 'BASIC' | 'BEARER' | 'OAUTH2_CLIENT_CREDENTIALS';
  tokenUrl?: string;
}

export class ODataAdapter implements ConnectorAdapter {
  readonly type = 'ODATA' as const;

  private async headers(ctx: ConnectorContext<ODataConfig, any>): Promise<Record<string, string>> {
    const c = ctx.credentials || {};
    switch (ctx.config.authType) {
      case 'BASIC':
        if (!c.username || !c.password) throw new Error('Basic authentication requires username and password');
        return { Authorization: basicAuth(c.username, c.password) };
      case 'BEARER':
        if (!c.token) throw new Error('Bearer authentication requires a token');
        return { Authorization: `Bearer ${c.token}` };
      case 'OAUTH2_CLIENT_CREDENTIALS': {
        if (!ctx.config.tokenUrl || !c.clientId || !c.clientSecret) {
          throw new Error('OAuth2 requires tokenUrl, clientId and clientSecret');
        }
        const token = await getClientCredentialsToken(ctx.http, ctx.config.tokenUrl, c.clientId, c.clientSecret);
        return { Authorization: `Bearer ${token}` };
      }
      default:
        return {};
    }
  }

  metadataUrl(config: ODataConfig): string {
    const url = new URL(joinUrl(config.serviceRootUrl, '$metadata'));
    if (config.sapClient) url.searchParams.set('sap-client', config.sapClient);
    return url.toString();
  }

  async fetchMetadata(ctx: ConnectorContext<ODataConfig, any>): Promise<MetadataSnapshot> {
    const res = await ctx.http.request({
      url: this.metadataUrl(ctx.config),
      headers: { ...(await this.headers(ctx)), Accept: 'application/xml' },
      maxResponseBytes: 20 * 1024 * 1024,
    });
    const parsed = normalizeODataMetadata(res.body);
    if (ctx.config.odataVersion !== 'AUTO' && parsed.odataVersion !== ctx.config.odataVersion) {
      throw new Error(`Service reports OData ${parsed.odataVersion} but the connector is configured for ${ctx.config.odataVersion}`);
    }
    const canonical = JSON.stringify(parsed.normalized);
    return {
      kind: 'ODATA_METADATA',
      servicePath: new URL(ctx.config.serviceRootUrl).pathname,
      protocolVersion: parsed.odataVersion,
      contentSha256: sha256(canonical),
      contentBytes: res.body.length,
      normalized: parsed.normalized,
      summary: parsed.summary,
    };
  }

  async testConnection(ctx: ConnectorContext<ODataConfig, any>): Promise<ConnectionTestResult> {
    const started = Date.now();
    const snap = await this.fetchMetadata(ctx);
    const def = CONNECTOR_DEFINITIONS.ODATA;
    return {
      ok: true,
      message: `OData ${snap.protocolVersion} $metadata read: ${(snap.summary as any).entitySets} entity sets, ${(snap.summary as any).entityTypes} entity types`,
      latencyMs: Date.now() - started,
      capabilities: {
        product: 'SAP Gateway / OData service',
        protocol: `OData ${snap.protocolVersion}`,
        availableApis: [snap.servicePath],
        grantedScopes: ['$metadata: read'],
        readable: def.canRead,
        notAccessible: def.cannotAccess,
        canWrite: false,
        supportedEngines: def.supportedEngines,
        details: { summary: snap.summary, contentSha256: snap.contentSha256 },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// HTTP / OpenAPI adapter
// ---------------------------------------------------------------------------
export interface HttpOpenApiConfig {
  baseUrl: string;
  healthPath: string;
  openApiPath?: string;
  authType: 'NONE' | 'BEARER' | 'BASIC' | 'API_KEY_HEADER';
  apiKeyHeader?: string;
}

export class HttpOpenApiAdapter implements ConnectorAdapter {
  readonly type = 'HTTP_OPENAPI' as const;

  headers(ctx: ConnectorContext<HttpOpenApiConfig, any>): Record<string, string> {
    const c = ctx.credentials || {};
    switch (ctx.config.authType) {
      case 'BEARER':
        if (!c.token) throw new Error('Bearer authentication requires a token');
        return { Authorization: `Bearer ${c.token}` };
      case 'BASIC':
        if (!c.username || !c.password) throw new Error('Basic authentication requires username and password');
        return { Authorization: basicAuth(c.username, c.password) };
      case 'API_KEY_HEADER':
        if (!c.apiKey || !ctx.config.apiKeyHeader) throw new Error('API key authentication requires apiKey and apiKeyHeader');
        return { [ctx.config.apiKeyHeader]: c.apiKey };
      default:
        return {};
    }
  }

  async fetchOpenApi(ctx: ConnectorContext<HttpOpenApiConfig, any>): Promise<MetadataSnapshot> {
    if (!ctx.config.openApiPath) throw new Error('No openApiPath configured for this connector');
    const res = await ctx.http.request({
      url: joinUrl(ctx.config.baseUrl, ctx.config.openApiPath),
      headers: { ...this.headers(ctx), Accept: 'application/json' },
      maxResponseBytes: 20 * 1024 * 1024,
    });
    let doc: any;
    try {
      doc = res.json();
    } catch {
      throw new Error('OpenAPI document is not JSON (YAML documents must be served as JSON)');
    }
    const parsed = normalizeOpenApi(doc);
    return {
      kind: 'OPENAPI',
      servicePath: ctx.config.openApiPath,
      protocolVersion: parsed.version,
      contentSha256: sha256(JSON.stringify(parsed.normalized)),
      contentBytes: res.body.length,
      normalized: parsed.normalized,
      summary: parsed.summary,
    };
  }

  async testConnection(ctx: ConnectorContext<HttpOpenApiConfig, any>): Promise<ConnectionTestResult> {
    const started = Date.now();
    const res = await ctx.http.request({ url: joinUrl(ctx.config.baseUrl, ctx.config.healthPath || '/'), headers: this.headers(ctx) });
    const def = CONNECTOR_DEFINITIONS.HTTP_OPENAPI;
    return {
      ok: true,
      message: `Health endpoint answered HTTP ${res.status}`,
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      capabilities: {
        protocol: 'HTTP/REST',
        availableApis: [ctx.config.healthPath, ...(ctx.config.openApiPath ? [ctx.config.openApiPath] : [])],
        grantedScopes: ['GET'],
        readable: def.canRead,
        notAccessible: def.cannotAccess,
        canWrite: false,
        supportedEngines: def.supportedEngines,
      },
    };
  }
}
