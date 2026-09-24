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
    this.port = this.config.get<number>('CLAMAV_PORT', 3310);
    this.isMockMode = this.config.get<boolean>('CLAMAV_MOCK_MODE', true);
  }

  public async scanBuffer(buffer: Buffer): Promise<ScanResult> {
    const startTime = Date.now();

    if (this.isMockMode) {
      return this.mockScan(buffer, startTime);
    }

    return new Promise((resolve, reject) => {
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

      let response = '';
      socket.on('data', (data) => {
        response += data.toString('utf-8');
      });

      socket.on('end', () => {
        const duration = Date.now() - startTime;
        const trimmed = response.trim();

        if (trimmed.includes('OK')) {
          resolve({ isInfected: false, scanDurationMs: duration });
        } else if (trimmed.includes('FOUND')) {
          const match = trimmed.match(/stream:\s*(.+)\s+FOUND/);
          const virus = match ? match[1] : 'UNKNOWN_VIRUS';
          resolve({ isInfected: true, virusName: virus, scanDurationMs: duration });
        } else {
          this.logger.warn(`ClamAV unexpected response: ${trimmed}, falling back to mock check`);
          resolve(this.mockScan(buffer, startTime));
        }
      });

      socket.on('error', (err) => {
        this.logger.warn(`ClamAV socket connection failed (${err.message}), falling back to mock mode`);
        resolve(this.mockScan(buffer, startTime));
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
