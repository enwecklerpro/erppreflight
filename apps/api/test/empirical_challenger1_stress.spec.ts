import * as net from 'node:net';
import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ClamAvScanner } from '../src/modules/ingestion/clamav.scanner';
import { cookieExtractor } from '../src/modules/auth/strategies/jwt.strategy';

describe('Empirical Challenger 1: R3 (ClamAV Fail-Closed Security)', () => {
  const dummyPayload = Buffer.from('SAP_ABAP_REPORT_ZR_PREFLIGHT_2026_TEST');

  const createMockTcpServer = async (
    handler: (socket: net.Socket) => void,
  ): Promise<{ server: net.Server; port: number; close: () => Promise<void> }> => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {}); // Ignore server-side socket errors on abrupt termination
      handler(socket);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as net.AddressInfo;
    const close = () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    return { server, port: address.port, close };
  };

  it('R3-C1: Fails closed on connection refused (unreachable port)', async () => {
    const config = new ConfigService({
      CLAMAV_MOCK_MODE: 'false',
      CLAMAV_HOST: '127.0.0.1',
      CLAMAV_PORT: 49999, // Unused port
    });
    const scanner = new ClamAvScanner(config);
    const result = await scanner.scanBuffer(dummyPayload);

    expect(result.isInfected).toBe(true);
    expect(result.virusName).toBe('SCAN_FAILED_CONNECTION_ERROR');
  });

  it('R3-C2: Fails closed on abrupt daemon disconnect immediately upon connect', async () => {
    const { port, close } = await createMockTcpServer((socket) => {
      // Abruptly destroy socket upon accept before anything is read/written
      socket.destroy();
    });

    try {
      const config = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port,
      });
      const scanner = new ClamAvScanner(config);
      const result = await scanner.scanBuffer(dummyPayload);

      expect(result.isInfected).toBe(true);
      // Either connection error (ECONNRESET/EPIPE) or unrecognized empty response
      expect(result.virusName).toMatch(/SCAN_FAILED_(CONNECTION_ERROR|UNRECOGNIZED_RESPONSE)/);
    } finally {
      await close();
    }
  });

  it('R3-C3: Fails closed on TCP connection reset (ECONNRESET) mid-handshake', async () => {
    const { port, close } = await createMockTcpServer((socket) => {
      socket.on('data', () => {
        socket.destroy(new Error('read ECONNRESET'));
      });
    });

    try {
      const config = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port,
      });
      const scanner = new ClamAvScanner(config);
      const result = await scanner.scanBuffer(dummyPayload);

      expect(result.isInfected).toBe(true);
      expect(result.virusName).toMatch(/SCAN_FAILED_(CONNECTION_ERROR|UNRECOGNIZED_RESPONSE)/);
    } finally {
      await close();
    }
  });

  it('R3-C4: Fails closed on abrupt daemon disconnect mid-stream chunk', async () => {
    const { port, close } = await createMockTcpServer((socket) => {
      let receivedBytes = 0;
      socket.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > 10) {
          // Abruptly close socket mid-stream
          socket.destroy();
        }
      });
    });

    try {
      const config = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port,
      });
      const scanner = new ClamAvScanner(config);
      // Large buffer to ensure chunking
      const largeBuffer = Buffer.alloc(8192, 0x41);
      const result = await scanner.scanBuffer(largeBuffer);

      expect(result.isInfected).toBe(true);
      expect(result.virusName).toMatch(/SCAN_FAILED_(CONNECTION_ERROR|UNRECOGNIZED_RESPONSE)/);
    } finally {
      await close();
    }
  });

  it('R3-C5: Fails closed when daemon receives full stream but drops connection without response', async () => {
    const { port, close } = await createMockTcpServer((socket) => {
      socket.on('data', () => {
        // Read everything and do not respond, then end
      });
      socket.end(); // Closes immediately without response
    });

    try {
      const config = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port,
      });
      const scanner = new ClamAvScanner(config);
      const result = await scanner.scanBuffer(dummyPayload);

      expect(result.isInfected).toBe(true);
      expect(result.virusName).toBe('SCAN_FAILED_UNRECOGNIZED_RESPONSE');
    } finally {
      await close();
    }
  });

  it('R3-C6: Fails closed on slow byte trickle past socket timeout', async () => {
    const { port, close } = await createMockTcpServer((socket) => {
      socket.on('data', () => {
        // Trickle 1 byte every 80ms while client timeout is 30ms
        const interval = setInterval(() => {
          if (!socket.destroyed) {
            socket.write('x');
          } else {
            clearInterval(interval);
          }
        }, 80);
        socket.on('close', () => clearInterval(interval));
      });
    });

    try {
      const config = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port,
        CLAMAV_TIMEOUT_MS: 30, // 30ms timeout
      });
      const scanner = new ClamAvScanner(config);
      const result = await scanner.scanBuffer(dummyPayload);

      expect(result.isInfected).toBe(true);
      expect(result.virusName).toBe('SCAN_FAILED_TIMEOUT');
    } finally {
      await close();
    }
  });

  it('R3-C7: Fails closed on daemon error responses (e.g. INSTREAM size limit exceeded)', async () => {
    const { port, close } = await createMockTcpServer((socket) => {
      socket.on('data', () => {
        socket.write('INSTREAM size limit exceeded. ERROR\n');
        socket.end();
      });
    });

    try {
      const config = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port,
      });
      const scanner = new ClamAvScanner(config);
      const result = await scanner.scanBuffer(dummyPayload);

      expect(result.isInfected).toBe(true);
      expect(result.virusName).toBe('SCAN_FAILED_UNRECOGNIZED_RESPONSE');
    } finally {
      await close();
    }
  });

  it('R3-C8: Fails closed on truncated or garbage response', async () => {
    const { port, close } = await createMockTcpServer((socket) => {
      socket.on('data', () => {
        socket.write('stream: O'); // Truncated 'OK'
        socket.end();
      });
    });

    try {
      const config = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port,
      });
      const scanner = new ClamAvScanner(config);
      const result = await scanner.scanBuffer(dummyPayload);

      expect(result.isInfected).toBe(true);
      expect(result.virusName).toBe('SCAN_FAILED_UNRECOGNIZED_RESPONSE');
    } finally {
      await close();
    }
  });

  it('R3-C9 (Adversarial stress): Checks behavior on response containing "OK" inside virus name or negative response', async () => {
    // Test 1: What if virus is named "Win.Trojan.OK-payload FOUND"?
    // In ClamAV, viruses can have arbitrary names including substring "OK"
    const virusName = 'Win32.Malware.OK_Variant';
    const { port: port1, close: close1 } = await createMockTcpServer((socket) => {
      socket.on('data', () => {
        socket.write(`stream: ${virusName} FOUND\n`);
        socket.end();
      });
    });

    try {
      const config = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port1,
      });
      const scanner = new ClamAvScanner(config);
      const result = await scanner.scanBuffer(dummyPayload);

      // CRITICAL CHECK: Does a virus with "OK" in its name get detected as infected,
      // or does `trimmed.includes('OK')` cause it to pass as clean?!
      expect(result.isInfected).toBe(true);
      expect(result.virusName).toBe(virusName);
    } finally {
      await close1();
    }
  });

  it('R3-C10 (Adversarial stress): Checks behavior on "stream: NOT OK" or "STATUS_NOK"', async () => {
    const { port, close } = await createMockTcpServer((socket) => {
      socket.on('data', () => {
        socket.write('stream: NOT OK\n');
        socket.end();
      });
    });

    try {
      const config = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port,
      });
      const scanner = new ClamAvScanner(config);
      const result = await scanner.scanBuffer(dummyPayload);

      // "stream: NOT OK" should NOT be classified as clean!
      expect(result.isInfected).toBe(true);
    } finally {
      await close();
    }
  });
});

describe('Empirical Challenger 1: R4 (Cookie Extractor in JwtStrategy)', () => {
  it('R4-C1: Returns null when request is undefined, null, or empty', () => {
    expect(cookieExtractor(undefined)).toBeNull();
    expect(cookieExtractor(null)).toBeNull();
    expect(cookieExtractor({})).toBeNull();
  });

  it('R4-C2: Extracts from parsed req.cookies if available', () => {
    const req = {
      cookies: {
        other_cookie: 'xyz',
        erppreflight_session: 'parsed-jwt-token-12345',
      },
    };
    expect(cookieExtractor(req)).toBe('parsed-jwt-token-12345');
  });

  it('R4-C3: Extracts from single cookie in Cookie header', () => {
    const req = {
      headers: {
        cookie: 'erppreflight_session=header-jwt-token-abcdef',
      },
    };
    expect(cookieExtractor(req)).toBe('header-jwt-token-abcdef');
  });

  it('R4-C4: Extracts correctly among multiple cookies in various positions', () => {
    // At start
    const reqStart = {
      headers: {
        cookie: 'erppreflight_session=first-token; other=123; third=456',
      },
    };
    expect(cookieExtractor(reqStart)).toBe('first-token');

    // In middle
    const reqMiddle = {
      headers: {
        cookie: 'first=123; erppreflight_session=middle-token; last=456',
      },
    };
    expect(cookieExtractor(reqMiddle)).toBe('middle-token');

    // At end
    const reqEnd = {
      headers: {
        cookie: 'first=123; second=456; erppreflight_session=end-token',
      },
    };
    expect(cookieExtractor(reqEnd)).toBe('end-token');
  });

  it('R4-C5: Handles semicolon spacing variations', () => {
    // No space after semicolon
    const reqNoSpace = {
      headers: {
        cookie: 'first=123;erppreflight_session=token-no-space;last=456',
      },
    };
    expect(cookieExtractor(reqNoSpace)).toBe('token-no-space');

    // Multiple spaces
    const reqMultiSpace = {
      headers: {
        cookie: 'first=123;   erppreflight_session=token-multi-space',
      },
    };
    expect(cookieExtractor(reqMultiSpace)).toBe('token-multi-space');

    // Tab character
    const reqTab = {
      headers: {
        cookie: 'first=123;\terppreflight_session=token-tab',
      },
    };
    expect(cookieExtractor(reqTab)).toBe('token-tab');
  });

  it('R4-C6: Does NOT match similar prefix or substring cookie names', () => {
    // Prefixed cookie name
    const reqPrefix = {
      headers: {
        cookie: 'not_erppreflight_session=fake-token',
      },
    };
    expect(cookieExtractor(reqPrefix)).toBeNull();

    // Prefixed cookie name followed by real cookie
    const reqPrefixAndReal = {
      headers: {
        cookie: 'x_erppreflight_session=fake; erppreflight_session=real-token',
      },
    };
    expect(cookieExtractor(reqPrefixAndReal)).toBe('real-token');
  });

  it('R4-C7: Handles special characters and URL-encoded values in cookie', () => {
    // Standard Base64URL JWT format
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doz...-123_abc';
    const reqJwt = {
      headers: {
        cookie: `erppreflight_session=${jwt}`,
      },
    };
    expect(cookieExtractor(reqJwt)).toBe(jwt);

    // URL-encoded token
    const encoded = encodeURIComponent('token+with/special=chars');
    const reqEncoded = {
      headers: {
        cookie: `erppreflight_session=${encoded}`,
      },
    };
    expect(cookieExtractor(reqEncoded)).toBe('token+with/special=chars');
  });

  it('R4-C8 (Adversarial stress): Handles malformed percent-encoding in cookie without throwing unhandled URIError', () => {
    const reqMalformedPercent = {
      headers: {
        cookie: 'erppreflight_session=token%ZZ%FFmalformed',
      },
    };

    // Empirical check: Does calling cookieExtractor throw an unhandled URIError or return safely?
    let result: string | null = null;
    let threwError = false;
    try {
      result = cookieExtractor(reqMalformedPercent);
    } catch (err) {
      threwError = true;
    }

    // A robust extractor in production middleware should not crash the HTTP worker on malformed cookie header
    expect(threwError).toBe(false);
  });

  it('R4-C9: Handles empty, deleted, or expired cookie formats', () => {
    // Empty value: erppreflight_session=;
    const reqEmpty = {
      headers: {
        cookie: 'erppreflight_session=; other=123',
      },
    };
    // Should be null or empty
    const resEmpty = cookieExtractor(reqEmpty);
    expect(resEmpty === null || resEmpty === '').toBe(true);

    // erppreflight_session=""
    const reqQuotes = {
      headers: {
        cookie: 'erppreflight_session=""',
      },
    };
    const resQuotes = cookieExtractor(reqQuotes);
    expect(typeof resQuotes).toBe('string');
  });
});
