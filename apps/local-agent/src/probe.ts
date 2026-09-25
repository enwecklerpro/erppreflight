import * as https from 'https';

export interface ProbeResult {
  url: string;
  isReachable: boolean;
  latencyMs?: number;
  statusCode?: number;
  serverHeader?: string;
  isTlsValid?: boolean;
  sapSid?: string;
  error?: string;
}

export class SapLandscapeProber {
  static async probe(sapUrl: string): Promise<ProbeResult> {
    const url = new URL(sapUrl);
    
    if (url.hostname === '169.254.169.254' || url.hostname.endsWith('.internal')) {
      return { url: sapUrl, isReachable: false, error: 'SSRF blocked' };
    }

    const pingPaths = ['/sap/bc/ping', '/sap/public/ping'];
    let lastError: any = null;

    for (const path of pingPaths) {
      const targetUrl = new URL(path, sapUrl);
      const start = Date.now();
      
      try {
        const res = await fetch(targetUrl.toString(), {
          method: 'GET',
          agent: targetUrl.protocol === 'https:' ? new https.Agent({ rejectUnauthorized: false }) : undefined
        } as any);

        const latency = Date.now() - start;
        const serverHeader = res.headers.get('server') || undefined;
        const sapSid = res.headers.get('sap-system-id') || undefined;

        let isTlsValid = true;
        if (targetUrl.protocol === 'https:') {
           try {
              await fetch(targetUrl.toString(), { method: 'GET' });
           } catch (tlsErr: any) {
              isTlsValid = false;
           }
        }

        return {
          url: sapUrl,
          isReachable: true,
          latencyMs: latency,
          statusCode: res.status,
          serverHeader,
          sapSid,
          isTlsValid: targetUrl.protocol === 'https:' ? isTlsValid : undefined
        };
      } catch (err: any) {
        lastError = err;
      }
    }

    return {
      url: sapUrl,
      isReachable: false,
      error: lastError?.message || 'Unknown error'
    };
  }
}
