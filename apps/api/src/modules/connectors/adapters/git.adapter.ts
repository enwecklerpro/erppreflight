import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import { promises as dns } from 'node:dns';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  UnsafeOutboundUrlError,
  assertOutboundUrlSyntax,
  checkIpAddress,
} from '../../../common/security/outbound-request';
import { ConnectorContext, ConnectionTestResult, ConnectorAdapter } from './adapter.types';
import { CONNECTOR_DEFINITIONS } from '../connector-registry';
import { connectorOutboundPolicy } from '../connector-http';

/**
 * Git connector (read-only abapGit ingestion, C §29/§35).
 *
 * Security model:
 *  - HTTPS only (plain http is accepted only when NODE_ENV=test for local doubles);
 *    all other git transports (ssh, git, file, ext) are disabled via protocol.allow.
 *  - The host is resolved and checked against the outbound SSRF policy, and the
 *    connection is pinned to that address with http.curloptResolve, so DNS rebinding
 *    between validation and connect is not possible. Redirects are disabled.
 *  - Shallow (depth 1), single branch, no tags; hooks disabled; no system/global
 *    git config; no credential helpers or prompts. Credentials are passed via
 *    GIT_CONFIG_* environment (an http.extraHeader), never in argv or the URL.
 *  - Clones into a private mkdtemp sandbox (0700) that is always deleted; the
 *    working tree size is polled and the clone is killed above maxRepoBytes;
 *    wall-clock timeout; symlinks are not materialized (core.symlinks=false)
 *    and never followed when reading files.
 */

export interface GitConfig {
  repositoryUrl: string;
  branch: string;
  pathFilter: string;
  maxRepoBytes: number;
}
export interface GitCredentials {
  username?: string;
  token?: string;
}

export interface GitFileEntry {
  path: string;
  bytes: number;
  sha256: string;
  objectType: string | null;
}

export interface GitTreeSnapshot {
  commit: string;
  branch: string;
  totalFiles: number;
  totalBytes: number;
  abapFiles: number;
  objectTypes: Record<string, number>;
  files: GitFileEntry[];
}

export class GitConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitConnectorError';
  }
}

const CLONE_TIMEOUT_MS = Number(process.env.CONNECTOR_GIT_TIMEOUT_MS || 120_000);
const MAX_LISTED_FILES = 5000;

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += (await fs.lstat(p)).size;
        } catch {
          /* raced with git */
        }
      }
    }
  }
  return total;
}

/** abapGit file naming: <object>.<type>[.<subtype>].<ext>, e.g. zcl_foo.clas.abap */
export function abapGitObjectType(file: string): string | null {
  const parts = path.basename(file).toLowerCase().split('.');
  if (parts.length < 3) return null;
  const type = parts[1];
  return /^[a-z]{4}$/.test(type) ? type.toUpperCase() : null;
}

export class GitAdapter implements ConnectorAdapter {
  readonly type = 'GIT' as const;

  /** Resolves the repository host and returns a pinned address that satisfies the SSRF policy. */
  async resolvePinnedTarget(repositoryUrl: string): Promise<{ url: URL; host: string; port: number; address: string }> {
    const policy = connectorOutboundPolicy();
    const url = assertOutboundUrlSyntax(repositoryUrl, policy);
    const plainHttpAllowed = process.env.NODE_ENV === 'test';
    if (url.protocol !== 'https:' && !(plainHttpAllowed && url.protocol === 'http:')) {
      throw new UnsafeOutboundUrlError('git connector requires https');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    let address = host;
    if (!net.isIP(host)) {
      const records = await dns.lookup(host, { all: true, verbatim: true }).catch((err) => {
        throw new UnsafeOutboundUrlError(`DNS resolution failed for ${host}: ${err?.code || err?.message}`);
      });
      for (const r of records) {
        const reason = checkIpAddress(r.address, policy);
        if (reason) throw new UnsafeOutboundUrlError(`${host} resolves to ${reason}`);
      }
      if (!records.length) throw new UnsafeOutboundUrlError(`no DNS records for ${host}`);
      address = records[0].address;
    } else {
      const reason = checkIpAddress(host, policy);
      if (reason) throw new UnsafeOutboundUrlError(reason);
    }
    return { url, host, port, address };
  }

  private gitEnv(
    home: string,
    extraConfig: Array<[string, string]>
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '/bin/false',
      SSH_ASKPASS: '/bin/false',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_LFS_SKIP_SMUDGE: '1',
      LANG: 'C',
    };
    if (process.env.GIT_SSL_CAINFO) env.GIT_SSL_CAINFO = process.env.GIT_SSL_CAINFO;
    const cfg: Array<[string, string]> = [
      ['protocol.allow', 'never'],
      ['protocol.https.allow', 'always'],
      ...(process.env.NODE_ENV === 'test' ? ([['protocol.http.allow', 'always']] as Array<[string, string]>) : []),
      ['http.followRedirects', 'false'],
      ['core.hooksPath', '/dev/null'],
      ['core.symlinks', 'false'],
      ['credential.helper', ''],
      ['submodule.recurse', 'false'],
      ...extraConfig,
    ];
    env.GIT_CONFIG_COUNT = String(cfg.length);
    cfg.forEach(([k, v], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = k;
      env[`GIT_CONFIG_VALUE_${i}`] = v;
    });
    return env;
  }

  private run(args: string[], cwd: string, env: NodeJS.ProcessEnv, watchDir?: string, maxBytes?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let killedReason: string | null = null;
      child.stdout.on('data', (d) => {
        if (stdout.length < 1_000_000) stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        if (stderr.length < 20_000) stderr += d.toString();
      });
      const timer = setTimeout(() => {
        killedReason = `git timed out after ${CLONE_TIMEOUT_MS}ms`;
        child.kill('SIGKILL');
      }, CLONE_TIMEOUT_MS);
      const poll =
        watchDir && maxBytes
          ? setInterval(async () => {
              const size = await dirSize(watchDir);
              if (size > maxBytes && !killedReason) {
                killedReason = `repository exceeds the ${maxBytes} byte limit`;
                child.kill('SIGKILL');
              }
            }, 300)
          : null;
      child.on('error', (err) => {
        clearTimeout(timer);
        if (poll) clearInterval(poll);
        reject(new GitConnectorError(`git could not be started: ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (poll) clearInterval(poll);
        if (killedReason) return reject(new GitConnectorError(killedReason));
        if (code !== 0) {
          const msg = stderr
            .split('\n')
            .filter((l) => /fatal|error/i.test(l))
            .join(' ')
            .replace(/Authorization:[^\s]*/gi, 'Authorization:***')
            .slice(0, 300);
          return reject(new GitConnectorError(`git exited with code ${code}${msg ? `: ${msg}` : ''}`));
        }
        resolve(stdout);
      });
    });
  }

  /**
   * Shallow read-only clone into a sandbox; `consume` receives the checkout
   * directory. The sandbox is always removed afterwards.
   */
  async withCheckout<T>(ctx: ConnectorContext<GitConfig, GitCredentials>, consume: (dir: string, commit: string) => Promise<T>): Promise<T> {
    const target = await this.resolvePinnedTarget(ctx.config.repositoryUrl);
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'erppf-git-'));
    await fs.chmod(sandbox, 0o700);
    const checkout = path.join(sandbox, 'repo');
    try {
      const extra: Array<[string, string]> = [
        ['http.curloptResolve', `${target.host}:${target.port}:${net.isIPv6(target.address) ? `[${target.address}]` : target.address}`],
      ];
      if (ctx.credentials?.token) {
        const user = ctx.credentials.username || 'x-access-token';
        extra.push(['http.extraHeader', `Authorization: Basic ${Buffer.from(`${user}:${ctx.credentials.token}`).toString('base64')}`]);
      }
      const env = this.gitEnv(sandbox, extra);
      const meter = (status: number | null, error: string | null) =>
        ctx.recordOutbound?.({ connectorKey: ctx.connectorId, method: 'GIT_CLONE', host: target.host, attempt: 1, status, error });
      try {
        await this.run(
          ['clone', '--depth', '1', '--single-branch', '--no-tags', '--branch', ctx.config.branch, '--', target.url.toString(), checkout],
          sandbox,
          env,
          sandbox,
          ctx.config.maxRepoBytes
        );
      } catch (err: any) {
        await meter(null, String(err?.name || 'error').slice(0, 60));
        throw err;
      }
      await meter(200, null);
      const commit = (await this.run(['rev-parse', 'HEAD'], checkout, env)).trim();
      return await consume(checkout, commit);
    } finally {
      await fs.rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Walks the checkout (no symlinks, .git excluded) under the configured path filter. */
  async listFiles(checkout: string, pathFilter: string): Promise<GitFileEntry[]> {
    const root = path.resolve(checkout, pathFilter || '.');
    if (!root.startsWith(path.resolve(checkout))) throw new GitConnectorError('pathFilter escapes the repository');
    const out: GitFileEntry[] = [];
    const stack = [root];
    while (stack.length && out.length < MAX_LISTED_FILES) {
      const cur = stack.pop()!;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (e.name === '.git') continue;
        const p = path.join(cur, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          stack.push(p);
        } else if (e.isFile()) {
          const buf = await fs.readFile(p);
          const rel = path.relative(checkout, p).split(path.sep).join('/');
          out.push({
            path: rel,
            bytes: buf.length,
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
            objectType: abapGitObjectType(rel),
          });
        }
      }
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async snapshot(ctx: ConnectorContext<GitConfig, GitCredentials>): Promise<GitTreeSnapshot> {
    return this.withCheckout(ctx, async (dir, commit) => {
      const files = await this.listFiles(dir, ctx.config.pathFilter);
      const objectTypes: Record<string, number> = {};
      for (const f of files) if (f.objectType) objectTypes[f.objectType] = (objectTypes[f.objectType] || 0) + 1;
      return {
        commit,
        branch: ctx.config.branch,
        totalFiles: files.length,
        totalBytes: files.reduce((n, f) => n + f.bytes, 0),
        abapFiles: files.filter((f) => f.path.endsWith('.abap')).length,
        objectTypes,
        files,
      };
    });
  }

  async testConnection(ctx: ConnectorContext<GitConfig, GitCredentials>): Promise<ConnectionTestResult> {
    const started = Date.now();
    const target = await this.resolvePinnedTarget(ctx.config.repositoryUrl);
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'erppf-git-'));
    try {
      const extra: Array<[string, string]> = [
        ['http.curloptResolve', `${target.host}:${target.port}:${target.address}`],
      ];
      if (ctx.credentials?.token) {
        const user = ctx.credentials.username || 'x-access-token';
        extra.push(['http.extraHeader', `Authorization: Basic ${Buffer.from(`${user}:${ctx.credentials.token}`).toString('base64')}`]);
      }
      const out = await this.run(
        ['ls-remote', '--heads', '--', target.url.toString(), ctx.config.branch],
        sandbox,
        this.gitEnv(sandbox, extra)
      );
      const found = out.trim().length > 0;
      const def = CONNECTOR_DEFINITIONS.GIT;
      return {
        ok: found,
        message: found
          ? `Repository reachable; branch '${ctx.config.branch}' at ${out.trim().slice(0, 12)}`
          : `Repository reachable, but branch '${ctx.config.branch}' does not exist`,
        latencyMs: Date.now() - started,
        capabilities: {
          protocol: 'git smart HTTP (read-only)',
          availableApis: ['git-upload-pack'],
          grantedScopes: ['repository: read'],
          readable: def.canRead,
          notAccessible: def.cannotAccess,
          canWrite: false,
          supportedEngines: def.supportedEngines,
        },
      };
    } finally {
      await fs.rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
