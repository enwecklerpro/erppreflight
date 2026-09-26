/**
 * Deterministic recognition of API specifications registered as API Change Guard baselines:
 * OpenAPI 2.0 / 3.x (JSON or YAML) and OData EDMX (V2 / V4). The full structural diff is done by the
 * analysis engine; this inspector only proves the upload IS such a specification (fail closed) and
 * reads the metadata shown in the baseline registry (spec version, API version, title, surface size).
 *
 * XML is never parsed here: EDMX is recognised by its root element, and any DTD / entity declaration
 * is rejected outright (XXE policy, AGENTS.md 4.5).
 */

export type ApiSpecFormat = 'OPENAPI' | 'EDMX';

export interface ApiSpecSurface {
  paths?: number;
  operations?: number;
  schemas?: number;
  entityTypes?: number;
  entitySets?: number;
}

export interface InspectedApiSpec {
  format: ApiSpecFormat;
  /** OpenAPI / Swagger version or EDMX version attribute. */
  specVersion: string | null;
  /** info.version of an OpenAPI document (null for EDMX: OData metadata carries no API version). */
  apiVersion: string | null;
  title: string | null;
  surface: ApiSpecSurface;
}

export class ApiSpecError extends Error {
  constructor(
    public readonly code: 'API_BASELINE_UNSUPPORTED_FORMAT' | 'API_BASELINE_EMPTY_SURFACE' | 'API_BASELINE_XML_DTD_FORBIDDEN',
    message: string
  ) {
    super(message);
    this.name = 'ApiSpecError';
  }
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);

function count(re: RegExp, text: string): number {
  return (text.match(re) ?? []).length;
}

function inspectEdmx(text: string): InspectedApiSpec {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new ApiSpecError(
      'API_BASELINE_XML_DTD_FORBIDDEN',
      'XML specifications must not contain DTD or entity declarations.'
    );
  }
  const root = /<(?:[A-Za-z_][\w.-]*:)?Edmx\b([^>]*)>/.exec(text);
  if (!root) {
    throw new ApiSpecError('API_BASELINE_UNSUPPORTED_FORMAT', 'XML document is not an OData EDMX ($metadata) document.');
  }
  const version = /\bVersion\s*=\s*"([^"]{1,40})"/.exec(root[1])?.[1] ?? null;
  const namespace = /<Schema\b[^>]*\bNamespace\s*=\s*"([^"]{1,300})"/.exec(text)?.[1] ?? null;
  const surface: ApiSpecSurface = {
    entityTypes: count(/<(?:[A-Za-z_][\w.-]*:)?EntityType\b/g, text),
    entitySets: count(/<(?:[A-Za-z_][\w.-]*:)?EntitySet\b/g, text),
  };
  if (!surface.entityTypes && !surface.entitySets) {
    throw new ApiSpecError('API_BASELINE_EMPTY_SURFACE', 'EDMX document defines no entity types or entity sets.');
  }
  return { format: 'EDMX', specVersion: version, apiVersion: null, title: namespace, surface };
}

function inspectOpenApiJson(doc: unknown): InspectedApiSpec {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ApiSpecError('API_BASELINE_UNSUPPORTED_FORMAT', 'JSON document is not an OpenAPI / Swagger object.');
  }
  const d = doc as Record<string, any>;
  const specVersion = typeof d.openapi === 'string' ? d.openapi : d.swagger !== undefined ? String(d.swagger) : null;
  if (!specVersion || !/^(2\.0|3\.\d+(\.\d+)?)$/.test(specVersion)) {
    throw new ApiSpecError(
      'API_BASELINE_UNSUPPORTED_FORMAT',
      "JSON document has no supported 'openapi' (3.x) or 'swagger' (2.0) version."
    );
  }
  const paths = d.paths && typeof d.paths === 'object' ? (d.paths as Record<string, any>) : {};
  let operations = 0;
  for (const item of Object.values(paths)) {
    if (item && typeof item === 'object') {
      operations += Object.keys(item).filter((k) => HTTP_METHODS.has(k.toLowerCase())).length;
    }
  }
  const schemas = specVersion.startsWith('2') ? d.definitions : d.components?.schemas;
  const surface: ApiSpecSurface = {
    paths: Object.keys(paths).length,
    operations,
    schemas: schemas && typeof schemas === 'object' ? Object.keys(schemas).length : 0,
  };
  if (!surface.paths && !surface.schemas) {
    throw new ApiSpecError('API_BASELINE_EMPTY_SURFACE', 'OpenAPI document defines no paths and no schemas.');
  }
  const info = d.info && typeof d.info === 'object' ? d.info : {};
  return {
    format: 'OPENAPI',
    specVersion,
    apiVersion: info.version !== undefined && info.version !== null ? String(info.version).slice(0, 100) : null,
    title: typeof info.title === 'string' ? info.title.slice(0, 300) : null,
    surface,
  };
}

/** Value of a `key: value` YAML scalar line (quotes and trailing comments removed). */
function yamlScalar(line: string): string | null {
  const m = /^\s*[\w$-]+\s*:\s*(.*)$/.exec(line);
  if (!m) return null;
  let v = m[1].replace(/\s+#.*$/, '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v || null;
}

const indentOf = (line: string) => line.length - line.trimStart().length;

/** Lines of the block under a top-level key (until the next top-level key). */
function topLevelBlock(lines: string[], key: string): string[] {
  const start = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || l.trimStart().startsWith('#')) continue;
    if (indentOf(l) === 0) break;
    out.push(l);
  }
  return out;
}

function inspectOpenApiYaml(text: string): InspectedApiSpec {
  const lines = text.split(/\r?\n/);
  const versionLine = lines.find((l) => /^(openapi|swagger)\s*:/.test(l));
  const specVersion = versionLine ? yamlScalar(versionLine) : null;
  if (!specVersion || !/^(2\.0|3\.\d+(\.\d+)?)$/.test(specVersion)) {
    throw new ApiSpecError(
      'API_BASELINE_UNSUPPORTED_FORMAT',
      "Document is neither an OData EDMX nor an OpenAPI / Swagger (JSON or YAML) specification with a supported version."
    );
  }
  const info = topLevelBlock(lines, 'info');
  const infoIndent = info.length ? indentOf(info[0]) : 0;
  const infoValue = (key: string) => {
    const l = info.find((x) => indentOf(x) === infoIndent && new RegExp(`^\\s*${key}\\s*:`).test(x));
    return l ? yamlScalar(l) : null;
  };
  const paths = topLevelBlock(lines, 'paths');
  const pathIndent = paths.length ? indentOf(paths[0]) : 0;
  const pathLines = paths.filter((l) => indentOf(l) === pathIndent && /^\s*['"]?\//.test(l));
  let operations = 0;
  let opIndent = -1;
  for (const l of paths) {
    const ind = indentOf(l);
    if (ind <= pathIndent) continue;
    if (opIndent === -1) opIndent = ind;
    if (ind === opIndent && HTTP_METHODS.has(l.trim().replace(/:.*$/, '').toLowerCase())) operations++;
  }
  const schemaBlock = specVersion.startsWith('2') ? topLevelBlock(lines, 'definitions') : [];
  let schemas = 0;
  if (schemaBlock.length) {
    const ind = indentOf(schemaBlock[0]);
    schemas = schemaBlock.filter((l) => indentOf(l) === ind).length;
  } else {
    const components = topLevelBlock(lines, 'components');
    const compIndent = components.length ? indentOf(components[0]) : 0;
    const idx = components.findIndex((l) => indentOf(l) === compIndent && /^\s*schemas\s*:/.test(l));
    if (idx !== -1) {
      let childIndent = -1;
      for (let i = idx + 1; i < components.length; i++) {
        const ind = indentOf(components[i]);
        if (ind <= compIndent) break;
        if (childIndent === -1) childIndent = ind;
        if (ind === childIndent) schemas++;
      }
    }
  }
  const surface: ApiSpecSurface = { paths: pathLines.length, operations, schemas };
  if (!surface.paths && !surface.schemas) {
    throw new ApiSpecError('API_BASELINE_EMPTY_SURFACE', 'OpenAPI document defines no paths and no schemas.');
  }
  return {
    format: 'OPENAPI',
    specVersion,
    apiVersion: infoValue('version')?.slice(0, 100) ?? null,
    title: infoValue('title')?.slice(0, 300) ?? null,
    surface,
  };
}

/** Recognises an OpenAPI / EDMX specification. Throws ApiSpecError for anything else. */
export function inspectApiSpec(raw: string): InspectedApiSpec {
  const text = raw.replace(/^﻿/, '');
  const head = text.trimStart();
  if (head.startsWith('<')) return inspectEdmx(text);
  if (head.startsWith('{')) {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (err: any) {
      throw new ApiSpecError('API_BASELINE_UNSUPPORTED_FORMAT', `JSON document is not well-formed: ${String(err?.message ?? err).slice(0, 200)}`);
    }
    return inspectOpenApiJson(doc);
  }
  return inspectOpenApiYaml(text);
}
