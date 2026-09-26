#!/usr/bin/env node

/**
 * ERP Preflight — Command Line Interface (C §47, Part 14.6)
 *
 * Thin, dependency-free client of the public REST API. All analysis runs on the
 * server with the deterministic engines; the CLI never evaluates rules locally.
 * Authentication: organization API key (`X-Api-Key`), scope-limited.
 * Every command supports `--json` for machine-readable output.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const VERSION = '0.2.0';
const CONFIG_DIR = process.env.ERP_PREFLIGHT_CONFIG_DIR || path.join(os.homedir(), '.erppreflight');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ENGINE_ALIASES = {
  'clean-core': 'CLEAN_CORE_OBJECT_GUARD',
  'api-diff': 'API_CHANGE_GUARD',
  mfs: 'MFS_BLACKBOX',
  opd: 'OPD_GUARD',
  forms: 'FORM_DOCTOR',
  transports: 'TRANSPORT_DEPENDENCY_ANALYZER',
};
const SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO'];

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------
// args & config
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (a === '-h') {
      flags.help = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);
}

function apiBase(flags) {
  const raw = flags['api-url'] || process.env.ERP_PREFLIGHT_API_URL || loadConfig().apiUrl || 'http://localhost:3001';
  const u = new URL(raw);
  const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
}

function apiKey() {
  return process.env.ERP_PREFLIGHT_API_KEY || loadConfig().apiKey;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function request(flags, method, endpoint, { body, form, raw } = {}) {
  const key = apiKey();
  if (!key) throw new CliError('Not authenticated. Run: erp-preflight login --key <api_key> [--api-url <url>]', 2);
  const headers = { 'X-Api-Key': key, Accept: raw ? '*/*' : 'application/json', 'User-Agent': `erp-preflight-cli/${VERSION}` };
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${apiBase(flags)}${endpoint}`, { method, headers, body: payload, signal: AbortSignal.timeout(Number(flags['http-timeout'] || 60) * 1000) });
  } catch (err) {
    throw new CliError(`Cannot reach ${apiBase(flags)}: ${(err.cause && err.cause.code) || err.message}`);
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = Array.isArray(j.message) ? j.message.join('; ') : j.message || text;
    } catch {
      /* plain */
    }
    throw new CliError(`API ${method} ${endpoint} failed [HTTP ${res.status}]: ${String(msg).slice(0, 400)}`, res.status === 401 || res.status === 403 ? 2 : 1);
  }
  if (raw) return Buffer.from(await res.arrayBuffer());
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function out(flags, data, human) {
  if (flags.quiet) return;
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    human(data);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
async function login(flags) {
  const key = flags.key;
  if (!key || key === true) throw new CliError('Usage: erp-preflight login --key <api_key> [--api-url <url>]', 2);
  const cfg = loadConfig();
  cfg.apiKey = key;
  if (flags['api-url']) cfg.apiUrl = flags['api-url'];
  // Verify the key before storing it.
  process.env.ERP_PREFLIGHT_API_KEY = key;
  const projects = await request({ ...flags, 'api-url': flags['api-url'] || cfg.apiUrl }, 'GET', '/projects');
  saveConfig(cfg);
  const count = Array.isArray(projects) ? projects.length : (projects.items || []).length;
  out(flags, { authenticated: true, apiUrl: apiBase({ 'api-url': cfg.apiUrl }), projects: count }, () =>
    console.log(`Authenticated against ${apiBase({ 'api-url': cfg.apiUrl })} (${count} project(s) visible). Config: ${CONFIG_FILE} (0600)`)
  );
}

function projectsOf(res) {
  return Array.isArray(res) ? res : res.items || res.data || [];
}

async function projectList(flags) {
  const items = projectsOf(await request(flags, 'GET', '/projects'));
  out(flags, items, (list) => {
    if (!list.length) return console.log('No projects.');
    console.table(list.map((p) => ({ id: p.id, name: p.name, targetRelease: p.targetRelease || p.target_release, createdAt: p.createdAt || p.created_at })));
  });
}

async function projectCreate(flags) {
  if (!flags.name || flags.name === true) throw new CliError('Usage: erp-preflight project create --name <name> [--release S4H_2023] [--description <text>]', 2);
  const p = await request(flags, 'POST', '/projects', {
    body: { name: flags.name, targetRelease: flags.release || 'S4H_2023', ...(flags.description ? { description: flags.description } : {}) },
  });
  out(flags, p, () => console.log(`Project created: ${p.id} (${p.name})`));
}

async function upload(flags, projectId, files) {
  if (!projectId || !files.length) throw new CliError('Usage: erp-preflight upload <projectId> <file> [file...]', 2);
  const results = [];
  for (const f of files) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new CliError(`File not found: ${f}`, 2);
    const buf = fs.readFileSync(abs);
    const form = new FormData();
    form.append('file', new Blob([buf]), path.basename(abs));
    const r = await request(flags, 'POST', `/projects/${encodeURIComponent(projectId)}/files`, { form });
    results.push({
      file: f,
      fileId: r.fileId || r.id,
      status: r.status || r.quarantineStatus,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      redactions: r.redactionsCount ?? 0,
    });
  }
  out(flags, results, (rs) => {
    for (const r of rs) console.log(`${r.status === 'CLEAN' ? 'CLEAN     ' : r.status.padEnd(10)} ${r.fileId}  ${r.file}  (${r.redactions} secret(s) redacted)`);
  });
  const bad = results.filter((r) => r.status !== 'CLEAN');
  if (bad.length) throw new CliError(`${bad.length} file(s) were not accepted by the ingestion pipeline`, 1);
  return results;
}

async function waitForAnalysis(flags, analysisId) {
  const timeoutMs = Number(flags.timeout || 600) * 1000;
  const started = Date.now();
  let a;
  while (Date.now() - started < timeoutMs) {
    a = await request(flags, 'GET', `/analyses/${encodeURIComponent(analysisId)}`);
    if (['COMPLETED', 'FAILED', 'PARTIAL'].includes(a.status)) return a;
    if (!flags.json) process.stderr.write(`  status: ${a.status}\r`);
    await sleep(2000);
  }
  throw new CliError(`Timed out after ${timeoutMs / 1000}s waiting for analysis ${analysisId} (last status ${a && a.status})`);
}

async function analyze(flags, projectId) {
  if (!projectId) throw new CliError('Usage: erp-preflight analyze <projectId> --engines OPD_GUARD[,..] [--files id,..] [--wait]', 2);
  const engines = String(flags.engines || '')
    .split(',')
    .map((e) => ENGINE_ALIASES[e.trim()] || e.trim().toUpperCase())
    .filter(Boolean);
  if (!engines.length) throw new CliError('--engines is required (e.g. --engines OPD_GUARD,CLEAN_CORE_OBJECT_GUARD)', 2);
  let fileIds = flags.files && flags.files !== true ? String(flags.files).split(',').map((s) => s.trim()) : null;
  if (!fileIds) {
    const files = await request(flags, 'GET', `/projects/${encodeURIComponent(projectId)}/files`);
    fileIds = projectsOf(files)
      .filter((f) => (f.quarantineStatus || f.quarantine_status) === 'CLEAN')
      .map((f) => f.id);
    if (!fileIds.length) throw new CliError('The project has no CLEAN artifacts; upload files first', 1);
  }
  const started = await request(flags, 'POST', '/analyses', { body: { projectId, engineTypes: engines, fileIds, ...(flags.release ? { targetRelease: flags.release } : {}) } });
  const analysisId = started.analysisId || started.id;
  if (!flags.wait) {
    out(flags, started, () => console.log(`Analysis queued: ${analysisId} (${started.status}). Use --wait or: erp-preflight findings --analysis ${analysisId}`));
    return started;
  }
  const done = await waitForAnalysis(flags, analysisId);
  const findings = await fetchFindings(flags, { analysisId, projectId });
  const summary = summarize(findings);
  out(flags, { analysisId, status: done.status, engines, files: fileIds.length, summary, findings }, () => {
    console.log(`Analysis ${analysisId}: ${done.status} — ${findings.length} finding(s) ${JSON.stringify(summary)}`);
    printFindings(findings);
  });
  gate(flags, findings, done.status);
  return done;
}

/** Convenience flows named in the spec: analyze clean-core|api-diff|mfs <paths...> --project <id>. */
async function analyzePaths(flags, alias, paths) {
  const projectId = flags.project;
  if (!projectId || projectId === true) throw new CliError(`Usage: erp-preflight analyze ${alias} <path...> --project <projectId> [--wait]`, 2);
  const files = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new CliError(`Path not found: ${p}`, 2);
    if (fs.statSync(abs).isDirectory()) {
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name === '.git' || e.name === 'node_modules') continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.isFile() && /\.(abap|xml|json|yaml|yml|csv|edmx|wsdl|xdp)$/i.test(e.name)) files.push(full);
        }
      };
      walk(abs);
    } else files.push(abs);
  }
  if (!files.length) throw new CliError('No analysable files found', 1);
  const uploaded = await upload({ ...flags, quiet: true }, projectId, files);
  return analyze({ ...flags, engines: ENGINE_ALIASES[alias], files: uploaded.map((u) => u.fileId).join(',') }, projectId);
}

async function fetchFindings(flags, { analysisId, projectId }) {
  if (analysisId) {
    const r = await request(flags, 'GET', `/analyses/${encodeURIComponent(analysisId)}/findings`);
    return projectsOf(r);
  }
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const r = await request(flags, 'GET', `/findings?projectId=${encodeURIComponent(projectId)}&page=${page}&pageSize=100`);
    const items = projectsOf(r);
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

function summarize(findings) {
  const s = {};
  for (const f of findings) s[f.severity] = (s[f.severity] || 0) + 1;
  return s;
}

function printFindings(findings) {
  if (!findings.length) return console.log('No findings.');
  console.table(
    findings.slice(0, 200).map((f) => {
      const ev = (f.evidence || [])[0] || {};
      return {
        severity: f.severity,
        rule: f.ruleId || f.code,
        confidence: f.confidence,
        title: String(f.title || '').slice(0, 60),
        evidence: ev.artifactPath ? `${ev.artifactPath}:${ev.lineNumber ?? '?'}` : '',
      };
    })
  );
}

/** CI quality gate: --fail-on BLOCKER,CRITICAL exits 3 when such findings exist. */
function gate(flags, findings, status) {
  if (status === 'FAILED') throw new CliError('Analysis FAILED', 1);
  if (!flags['fail-on'] || flags['fail-on'] === true) return;
  const levels = String(flags['fail-on']).toUpperCase().split(',').map((s) => s.trim());
  const hits = findings.filter((f) => levels.includes(String(f.severity).toUpperCase()));
  if (hits.length) throw new CliError(`Quality gate failed: ${hits.length} finding(s) at ${levels.join('/')}`, 3);
}

async function findingsCmd(flags, projectId) {
  const analysisId = flags.analysis && flags.analysis !== true ? flags.analysis : null;
  if (!analysisId && !projectId) throw new CliError('Usage: erp-preflight findings <projectId> | --analysis <analysisId> [--severity CRITICAL]', 2);
  let findings = await fetchFindings(flags, { analysisId, projectId });
  if (flags.severity && flags.severity !== true) {
    const max = SEVERITY_ORDER.indexOf(String(flags.severity).toUpperCase());
    findings = findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) <= max);
  }
  out(flags, findings, printFindings);
  gate(flags, findings, 'COMPLETED');
}

async function reportExport(flags, projectId, analysisId) {
  if (!projectId || !analysisId) throw new CliError('Usage: erp-preflight report export <projectId> <analysisId> --format PDF|JSON_BUNDLE|XLSX|CSV|HTML_OFFLINE [--out <file>]', 2);
  const format = String(flags.format || 'PDF').toUpperCase();
  const r = await request(flags, 'POST', `/projects/${encodeURIComponent(projectId)}/analyses/${encodeURIComponent(analysisId)}/export`, { body: { format } });
  const buf = await request(flags, 'GET', `/reports/${encodeURIComponent(r.reportId)}/file`, { raw: true });
  const outPath = path.resolve(flags.out && flags.out !== true ? flags.out : r.fileName || `erp-preflight-${analysisId}.${format.toLowerCase()}`);
  fs.writeFileSync(outPath, buf);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  out(flags, { reportId: r.reportId, format, path: outPath, bytes: buf.length, sha256 }, (d) => console.log(`Report ${d.format} saved: ${d.path} (${d.bytes} bytes, sha256 ${d.sha256})`));
}

async function reportDownload(flags, analysisId) {
  if (!analysisId) throw new CliError('Usage: erp-preflight report download <analysisId> [--out <path>]', 2);
  const buf = await request(flags, 'GET', `/analyses/${encodeURIComponent(analysisId)}/reproducibility-bundle`, { raw: true });
  const outPath = path.resolve(flags.out && flags.out !== true ? flags.out : `erp-preflight-bundle-${analysisId}.zip`);
  fs.writeFileSync(outPath, buf);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  out(flags, { path: outPath, bytes: buf.length, sha256 }, (d) => console.log(`Reproducibility bundle saved: ${d.path} (${d.bytes} bytes, sha256 ${d.sha256})`));
}

async function status(flags) {
  const origin = new URL(apiBase(flags)).origin;
  let health;
  try {
    const res = await fetch(`${origin}/health/readiness`, { signal: AbortSignal.timeout(10_000) });
    health = { httpStatus: res.status, body: await res.json().catch(() => null) };
  } catch (err) {
    throw new CliError(`API unreachable at ${origin}: ${(err.cause && err.cause.code) || err.message}`);
  }
  out(flags, { apiUrl: apiBase(flags), authenticated: Boolean(apiKey()), health }, (d) => {
    console.log(`API: ${d.apiUrl}  readiness HTTP ${d.health.httpStatus}  ${d.authenticated ? 'API key configured' : 'not logged in'}`);
  });
}

function printUsage() {
  console.log(`ERP Preflight CLI v${VERSION}

USAGE: erp-preflight <command> [options]   (add --json for machine-readable output)

  login --key <api_key> [--api-url <url>]            Verify and store an organization API key (config 0600)
  status                                             API readiness and login state
  project list                                       List projects
  project create --name <n> [--release S4H_2023]     Create a project
  upload <projectId> <file...>                       Upload artifacts (magic bytes, ClamAV, redaction on the server)
  analyze <projectId> --engines E1,E2 [--files id,..] [--wait] [--timeout 600] [--fail-on BLOCKER,CRITICAL]
                                                     Run deterministic engines on the project's CLEAN artifacts
  analyze clean-core|api-diff|mfs <path...> --project <id> [--wait] [--fail-on ...]
                                                     Upload local files and run the matching engine
  findings <projectId> | --analysis <id> [--severity CRITICAL] [--fail-on ...]
  report export <projectId> <analysisId> --format PDF|JSON_BUNDLE|XLSX|CSV|HTML_OFFLINE [--out file]
  report download <analysisId> [--out file]          Reproducibility bundle
  mcp                                                Start the MCP stdio server
  version

Exit codes: 0 ok, 1 error, 2 usage/authentication, 3 quality gate failed (--fail-on).
Environment: ERP_PREFLIGHT_API_URL, ERP_PREFLIGHT_API_KEY, ERP_PREFLIGHT_CONFIG_DIR`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, sub, ...rest] = positional;
  if (!command || flags.help) return printUsage();
  switch (command) {
    case 'login':
      return login(flags);
    case 'status':
      return status(flags);
    case 'project':
      if (sub === 'list') return projectList(flags);
      if (sub === 'create') return projectCreate(flags);
      throw new CliError('Usage: erp-preflight project list|create', 2);
    case 'upload':
      return upload(flags, sub, rest);
    case 'analyze':
      if (ENGINE_ALIASES[sub] && (flags.project || rest.length)) return analyzePaths(flags, sub, rest);
      return analyze(flags, sub);
    case 'findings':
      return findingsCmd(flags, sub);
    case 'report':
      if (sub === 'export') return reportExport(flags, rest[0], rest[1]);
      if (sub === 'download') return reportDownload(flags, rest[0]);
      throw new CliError('Usage: erp-preflight report export|download ...', 2);
    case 'mcp':
      require('./erp-preflight-mcp.js');
      return;
    case 'version':
      return console.log(`erp-preflight v${VERSION}`);
    default:
      printUsage();
      throw new CliError(`Unknown command '${command}'`, 2);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(err.exitCode || 1);
});
