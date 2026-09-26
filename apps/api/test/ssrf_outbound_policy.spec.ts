import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  assertOutboundUrlSyntax,
  checkIpAddress,
  validateOutboundUrl,
  safeOutboundRequest,
  UnsafeOutboundUrlError,
  __setDnsLookupForTests,
  __setOutboundTransportForTests,
} from '../src/common/security/outbound-request';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { LandscapesService } from '../src/modules/landscapes/landscapes.service';

const PUBLIC_V4 = { address: '93.184.216.34', family: 4 };

describe('SSRF outbound policy (webhooks & landscape probes)', () => {
  const restores: Array<() => void> = [];
  afterEach(() => {
    while (restores.length) restores.pop()!();
    delete process.env.ALLOW_PRIVATE_LANDSCAPE_PROBES;
  });

  describe('IP literal classification', () => {
    it.each([
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:8.8.8.8',
      'fd00::1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::1',
    ])('rejects %s', (ip) => {
      expect(checkIpAddress(ip)).not.toBeNull();
    });

    it.each(['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])('allows public %s', (ip) => {
      expect(checkIpAddress(ip)).toBeNull();
    });

    it('allowPrivateNetworks permits RFC1918/ULA but never loopback, link-local or mapped', () => {
      const policy = { allowPrivateNetworks: true };
      expect(checkIpAddress('10.1.2.3', policy)).toBeNull();
      expect(checkIpAddress('fd12::1', policy)).toBeNull();
      expect(checkIpAddress('127.0.0.1', policy)).not.toBeNull();
      expect(checkIpAddress('169.254.169.254', policy)).not.toBeNull();
      expect(checkIpAddress('::ffff:10.0.0.1', policy)).not.toBeNull();
      expect(checkIpAddress('0.0.0.0', policy)).not.toBeNull();
    });
  });

  describe('URL syntax checks', () => {
    it.each([
      'http://127.0.0.1:8080/',
      'http://2130706433/', // decimal 127.0.0.1
      'http://0x7f.1/', // hex shorthand
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd00::1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3001/health',
      'http://sub.localhost/',
      'http://postgres:5432/',
      'http://redis/',
      'http://erppreflight-postgres/',
      'http://analysis-python:8000/health',
      'http://intranet/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'https://s4h.corp.internal/',
      'http://printer.local/',
      'ftp://example.com/file',
      'file:///etc/passwd',
      'https://user:pass@example.com/',
      'not a url',
    ])('rejects %s', (url) => {
      expect(() => assertOutboundUrlSyntax(url)).toThrow(UnsafeOutboundUrlError);
    });

    it('error message is generic and does not echo the URL or internal reason', () => {
      try {
        assertOutboundUrlSyntax('http://10.0.0.7/secret');
        throw new Error('expected rejection');
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnsafeOutboundUrlError);
        expect(err.message).not.toContain('10.0.0.7');
        expect(err.reason).toContain('10.0.0.7');
      }
    });
  });

  describe('DNS-resolved checks', () => {
    it('rejects a public-looking hostname that resolves to a private address', async () => {
      restores.push(__setDnsLookupForTests(async () => [{ address: '10.0.0.9', family: 4 }]));
      await expect(validateOutboundUrl('https://hooks.attacker.example/')).rejects.toBeInstanceOf(
        UnsafeOutboundUrlError
      );
    });

    it('rejects when ANY resolved record is internal (mixed A/AAAA answers)', async () => {
      restores.push(
        __setDnsLookupForTests(async () => [PUBLIC_V4, { address: '::1', family: 6 }])
      );
      await expect(validateOutboundUrl('https://mixed.example.com/')).rejects.toBeInstanceOf(
        UnsafeOutboundUrlError
      );
    });

    it('rejects hostnames that do not resolve', async () => {
      restores.push(
        __setDnsLookupForTests(async () => {
          throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
        })
      );
      await expect(validateOutboundUrl('https://nx.example.com/')).rejects.toBeInstanceOf(
        UnsafeOutboundUrlError
      );
    });

    it('accepts hostnames that resolve only to public addresses', async () => {
      restores.push(__setDnsLookupForTests(async () => [PUBLIC_V4]));
      const url = await validateOutboundUrl('https://hooks.example.com/path');
      expect(url.hostname).toBe('hooks.example.com');
    });

    it('re-checks DNS at connect time (DNS rebinding) inside the real transport', async () => {
      let calls = 0;
      restores.push(
        __setDnsLookupForTests(async () => {
          calls += 1;
          // First answer passes validation, the connect-time answer points at loopback.
          return calls === 1 ? [PUBLIC_V4] : [{ address: '127.0.0.1', family: 4 }];
        })
      );
      await expect(
        safeOutboundRequest('http://rebind.example.com:9/', { timeoutMs: 2000 })
      ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
      expect(calls).toBeGreaterThanOrEqual(2);
    });
  });

  describe('WebhooksService', () => {
    const orgId = '11111111-1111-4111-8111-111111111111';

    /** Minimal in-memory webhook tables for the delivery pipeline. */
    function webhookDb(url: string) {
      const deliveries = new Map<string, any>();
      return {
        deliveries,
        query: vi.fn(async (sql: string, params: any[] = []) => {
          if (sql.startsWith('SELECT id FROM webhooks')) return { rows: [{ id: 'wh-1' }] };
          if (sql.includes('INSERT INTO webhook_deliveries')) {
            deliveries.set(params[0], { id: params[0], event_id: params[3], event_type: 'ping', payload: JSON.parse(params[4]), status: 'PENDING', attempts: 0, max_attempts: 1 });
            return { rows: [] };
          }
          if (sql.includes('FROM webhook_deliveries d JOIN webhooks w')) {
            return { rows: [{ ...deliveries.get(params[1]), webhook_id: 'wh-1', url, secret: 'whsec_x', webhook_status: 'ACTIVE' }] };
          }
          if (sql.startsWith('UPDATE webhook_deliveries')) {
            const d = deliveries.get(params[1]);
            if (d) Object.assign(d, { status: params[2], attempts: params[3], last_error: params[5] });
          }
          return { rows: [] };
        }),
      };
    }

    it('rejects registration of internal webhook targets with a generic 400', async () => {
      restores.push(__setDnsLookupForTests(async () => [{ address: '172.18.0.4', family: 4 }]));
      const db = { query: vi.fn() };
      const service = new WebhooksService(db as any, { subscribe: () => {} } as any);
      const attempt = service.create(orgId, 'user-1', { url: 'https://internal-api.example.com/hook' });
      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(orgId, 'user-1', { url: 'https://internal-api.example.com/hook' })
      ).rejects.not.toThrow(/172\.18/);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('does not deliver test pings to a stored URL that now resolves internally', async () => {
      restores.push(__setDnsLookupForTests(async () => [{ address: '169.254.169.254', family: 4 }]));
      const transport = vi.fn();
      restores.push(__setOutboundTransportForTests(transport));
      const db = webhookDb('https://legacy.example.com/hook');
      const service = new WebhooksService(db as any, { subscribe: () => {} } as any);
      const res = await service.sendTestPing(orgId, 'wh-1');
      expect(res.success).toBe(false);
      expect((res as any).error).not.toMatch(/169\.254/);
      expect(transport).not.toHaveBeenCalled();
      expect([...db.deliveries.values()][0].status).toBe('DEAD');
    });

    it('treats redirects as failed deliveries (redirects are never followed)', async () => {
      restores.push(__setDnsLookupForTests(async () => [PUBLIC_V4]));
      const transport = vi.fn().mockResolvedValue({
        status: 302,
        statusText: 'Found',
        headers: { location: 'http://169.254.169.254/' },
      });
      restores.push(__setOutboundTransportForTests(transport));
      const db = webhookDb('https://hooks.example.com/hook');
      const service = new WebhooksService(db as any, { subscribe: () => {} } as any);
      const res = await service.sendTestPing(orgId, 'wh-1');
      expect(res.success).toBe(false);
      expect(res.httpStatus).toBe(302);
      expect(transport).toHaveBeenCalledTimes(1);
    });
  });

  describe('LandscapesService', () => {
    const orgId = '11111111-1111-4111-8111-111111111111';
    const base = {
      systemId: 'S4H',
      product: 'SAP S/4HANA',
      edition: 'Private Cloud',
      release: '2023',
      environment: 'DEV',
    };

    it('rejects loopback and docker-internal landscape URLs even without DNS', async () => {
      const service = new LandscapesService({ query: vi.fn() } as any);
      for (const url of ['http://127.0.0.1:44300', 'http://postgres:5432', 'http://[::1]:44300']) {
        await expect(service.create(orgId, { ...base, url })).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('private subnets require ALLOW_PRIVATE_LANDSCAPE_PROBES, loopback never allowed', async () => {
      restores.push(__setDnsLookupForTests(async () => [{ address: '10.20.30.40', family: 4 }]));
      const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'l1' }] }) };
      const service = new LandscapesService(db as any);
      await expect(
        service.create(orgId, { ...base, url: 'https://s4h-dev.customer.example/' })
      ).rejects.toBeInstanceOf(BadRequestException);

      process.env.ALLOW_PRIVATE_LANDSCAPE_PROBES = 'true';
      await expect(
        service.create(orgId, { ...base, url: 'https://s4h-dev.customer.example/' })
      ).resolves.toEqual({ id: 'l1' });
      await expect(
        service.create(orgId, { ...base, url: 'http://127.0.0.1:44300' })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('findAll returns only registered systems (no placeholder seeding)', async () => {
      const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      const service = new LandscapesService(db as any);
      expect(await service.findAll(orgId)).toEqual([]);
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });
});
