import { createHash } from 'node:crypto';

export class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'SourceFetchError';
  }
}

export interface SecureFetchOptions {
  /** Hostnames that may be contacted (exact match, lower case). */
  allowedHosts: readonly string[];
  /** Hard cap on the downloaded body in bytes. */
  maxBytes: number;
  /** Total request timeout in milliseconds. */
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface SecureFetchResult {
  body: Buffer;
  sha256: string;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
  status: number;
}

/**
 * Validates a knowledge source URL: HTTPS only, allow-listed host, no
 * credentials, default port. Throws SourceFetchError otherwise.
 */
export function assertAllowedSourceUrl(rawUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SourceFetchError('Invalid source URL', rawUrl);
  }
  if (url.protocol !== 'https:') {
    throw new SourceFetchError('Knowledge sources must use https', rawUrl);
  }
  if (url.username || url.password) {
    throw new SourceFetchError('Knowledge source URLs must not embed credentials', rawUrl);
  }
  if (url.port && url.port !== '443') {
    throw new SourceFetchError('Knowledge source URLs must use the default https port', rawUrl);
  }
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new SourceFetchError(`Host '${host}' is not an allow-listed knowledge source`, rawUrl);
  }
  return url;
}

/**
 * Streams an allow-listed HTTPS resource into memory with a hard size cap and a
 * timeout, hashing it on the fly (SHA-256). Redirects are not followed: the
 * official raw endpoints answer directly, and a redirect could leave the allow list.
 */
export async function secureFetch(rawUrl: string, options: SecureFetchOptions): Promise<SecureFetchResult> {
  const url = assertAllowedSourceUrl(rawUrl, options.allowedHosts);
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    let res: Response;
    try {
      res = await doFetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
      });
    } catch (err: any) {
      throw new SourceFetchError(
        `Request failed: ${err?.name === 'AbortError' ? 'timeout' : err?.cause?.code ?? err?.message ?? err}`,
        rawUrl
      );
    }

    if (res.status >= 300 && res.status < 400) {
      throw new SourceFetchError(`Unexpected redirect (HTTP ${res.status})`, rawUrl, res.status);
    }
    if (!res.ok) {
      throw new SourceFetchError(`HTTP ${res.status}`, rawUrl, res.status);
    }

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      throw new SourceFetchError(
        `Declared size ${declared} exceeds the ${options.maxBytes} byte cap`,
        rawUrl,
        res.status
      );
    }
    if (!res.body) {
      throw new SourceFetchError('Empty response body', rawUrl, res.status);
    }

    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SourceFetchError(`Body exceeds the ${options.maxBytes} byte cap`, rawUrl, res.status);
      }
      const chunk = Buffer.from(value);
      hash.update(chunk);
      chunks.push(chunk);
    }

    return {
      body: Buffer.concat(chunks, total),
      sha256: hash.digest('hex'),
      bytes: total,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      status: res.status,
    };
  } finally {
    clearTimeout(timer);
  }
}
