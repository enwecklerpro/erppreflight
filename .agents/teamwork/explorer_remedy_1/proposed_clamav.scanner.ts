import * as net from 'node:net';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ScanResult {
  isInfected: boolean;
  virusName?: string;
  scanDurationMs: number;
}

@Injectable()
export class ClamAvScanner {
  private readonly logger = new Logger(ClamAvScanner.name);
  private readonly host: string;
  private readonly port: number;
  private readonly isMockMode: boolean;

  constructor(private readonly config: ConfigService) {
    this.host = this.config.get<string>('CLAMAV_HOST', 'localhost');
    this.port = Number(this.config.get<number>('CLAMAV_PORT', 3310));
    this.isMockMode = String(this.config.get('CLAMAV_MOCK_MODE', 'true')).toLowerCase() === 'true';
  }

  public async scanBuffer(buffer: Buffer): Promise<ScanResult> {
    const startTime = Date.now();

    if (this.isMockMode) {
      return this.mockScan(buffer, startTime);
    }

    return new Promise((resolve) => {
      let isSettled = false;
      const safeResolve = (result: ScanResult) => {
        if (!isSettled) {
          isSettled = true;
          resolve(result);
        }
      };

      const socket = net.createConnection({ host: this.host, port: this.port }, () => {
        socket.write('zINSTREAM\0');

        const chunkSize = 2048;
        for (let i = 0; i < buffer.length; i += chunkSize) {
          const chunk = buffer.subarray(i, i + chunkSize);
          const lengthBuf = Buffer.alloc(4);
          lengthBuf.writeUInt32BE(chunk.length, 0);
          socket.write(lengthBuf);
          socket.write(chunk);
        }

        // Zero-length chunk signals end of stream
        const endBuf = Buffer.alloc(4, 0);
        socket.write(endBuf);
      });

      const timeoutMs = Number(this.config.get<number>('CLAMAV_TIMEOUT_MS', 10000));
      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => {
        socket.destroy();
        const duration = Date.now() - startTime;
        if (!this.isMockMode) {
          this.logger.error('ClamAV socket timeout: failing closed');
          safeResolve({
            isInfected: true,
            virusName: 'SCAN_FAILED_TIMEOUT',
            scanDurationMs: duration,
          });
        } else {
          this.logger.warn('ClamAV socket timeout, falling back to mock mode');
          safeResolve(this.mockScan(buffer, startTime));
        }
      });

      let response = '';
      socket.on('data', (data) => {
        response += data.toString('utf-8');
      });

      socket.on('end', () => {
        const duration = Date.now() - startTime;
        const trimmed = response.trim();

        // 1. Check for virus detection FIRST to prevent substring false-clean matches
        if (trimmed.includes('FOUND')) {
          const match = trimmed.match(/stream:\s*(.+)\s+FOUND/);
          const virus = match
            ? match[1].trim()
            : trimmed.replace(/^stream:\s*/, '').replace(/\s+FOUND$/, '').trim() || 'UNKNOWN_VIRUS';
          safeResolve({ isInfected: true, virusName: virus, scanDurationMs: duration });
        } else if (
          // 2. Clean files require exact 'stream: OK' or ending with 'OK' without 'FOUND', 'ERROR', 'NOT OK', or 'NOK'
          trimmed === 'stream: OK' ||
          (trimmed.endsWith('OK') &&
            !trimmed.endsWith('NOK') &&
            !trimmed.includes('ERROR') &&
            !trimmed.includes('NOT OK'))
        ) {
          safeResolve({ isInfected: false, scanDurationMs: duration });
        } else {
          // 3. All daemon errors or unexpected responses fail closed when !this.isMockMode
          if (!this.isMockMode) {
            this.logger.error(`ClamAV unexpected response: ${trimmed} - failing closed`);
            safeResolve({
              isInfected: true,
              virusName: 'SCAN_FAILED_UNRECOGNIZED_RESPONSE',
              scanDurationMs: duration,
            });
          } else {
            this.logger.warn(`ClamAV unexpected response: ${trimmed}, falling back to mock check`);
            safeResolve(this.mockScan(buffer, startTime));
          }
        }
      });

      socket.on('error', (err) => {
        const duration = Date.now() - startTime;
        if (!this.isMockMode) {
          this.logger.error(`ClamAV socket connection failed (${err.message}) - failing closed`);
          safeResolve({
            isInfected: true,
            virusName: 'SCAN_FAILED_CONNECTION_ERROR',
            scanDurationMs: duration,
          });
        } else {
          this.logger.warn(`ClamAV socket connection failed (${err.message}), falling back to mock mode`);
          safeResolve(this.mockScan(buffer, startTime));
        }
      });
    });
  }

  private mockScan(buffer: Buffer, startTime: number): ScanResult {
    const content = buffer.toString('utf-8');
    const duration = Date.now() - startTime;

    if (content.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {
      return {
        isInfected: true,
        virusName: 'Eicar-Test-Signature',
        scanDurationMs: duration,
      };
    }

    return {
      isInfected: false,
      scanDurationMs: duration,
    };
  }
}
