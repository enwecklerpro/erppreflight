import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import Redis from 'ioredis';
import * as net from 'node:net';
import { resolveRedisConnectionOptions } from '../jobs/redis-connection.factory';

@Injectable()
export class HealthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  getLiveness() {
    return {
      status: 'ok',
      service: 'erppreflight-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness() {
    // Postgres
    const dbStart = Date.now();
    const dbResult = await this.db.checkHealth();
    const dbLatency = Date.now() - dbStart;

    // Redis
    let redisStatus: 'up' | 'down' = 'down';
    let redisLatency = 0;
    const redisStart = Date.now();
    try {
      const redis = new Redis({
        ...resolveRedisConnectionOptions(this.config),
        maxRetriesPerRequest: 0,
        connectTimeout: 1000,
      });
      await redis.ping();
      redisStatus = 'up';
      redisLatency = Date.now() - redisStart;
      redis.disconnect();
    } catch (e) {
      redisStatus = 'down';
    }

    // MinIO
    let minioStatus: 'up' | 'down' | 'unconfigured' = 'unconfigured';
    const s3Endpoint = this.config.get<string>('S3_ENDPOINT');
    if (s3Endpoint) {
      try {
        const res = await fetch(`${s3Endpoint}/minio/health/live`, { signal: AbortSignal.timeout(2000) });
        minioStatus = res.ok ? 'up' : 'down';
      } catch (e) {
        minioStatus = 'down';
      }
    }

    // Python Analysis Service
    let analysisStatus: 'up' | 'down' = 'down';
    let engines = 0;
    const analysisUrl = this.config.get<string>('ANALYSIS_SERVICE_URL') || 'http://localhost:8000';
    try {
      const res = await fetch(`${analysisUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        analysisStatus = 'up';
        const enginesRes = await fetch(`${analysisUrl}/api/v1/engines`, { signal: AbortSignal.timeout(2000) });
        if (enginesRes.ok) {
          const list: unknown = await enginesRes.json().catch(() => []);
          engines = Array.isArray(list) ? list.length : 0;
        }
      }
    } catch (e) {
      analysisStatus = 'down';
    }

    // ClamAV
    let clamavStatus: 'up' | 'down' | 'mock_mode' = 'mock_mode';
    // Validated env turns CLAMAV_MOCK_MODE into a boolean; accept both shapes (same rule as ClamAvScanner).
    const useMock = String(this.config.get('CLAMAV_MOCK_MODE', 'true')).toLowerCase() === 'true';
    if (!useMock) {
      const clamavHost = this.config.get<string>('CLAMAV_HOST') || 'localhost';
      const clamavPort = parseInt(this.config.get<string>('CLAMAV_PORT') || '3310', 10);
      try {
        clamavStatus = await new Promise((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(1000);
          socket.on('connect', () => {
            socket.destroy();
            resolve('up');
          });
          socket.on('error', () => resolve('down'));
          socket.on('timeout', () => {
            socket.destroy();
            resolve('down');
          });
          socket.connect(clamavPort, clamavHost);
        });
      } catch (e) {
        clamavStatus = 'down';
      }
    }

    const isHealthy = dbResult.healthy && redisStatus === 'up';
    const isDegraded = isHealthy && (minioStatus === 'down' || analysisStatus === 'down' || clamavStatus === 'down');
    
    const overallStatus = isHealthy ? (isDegraded ? 'degraded' : 'healthy') : 'unhealthy';

    return {
      status: overallStatus,
      service: 'erppreflight-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      dependencies: {
        postgres: {
          status: dbResult.healthy ? 'up' : 'down',
          latencyMs: dbLatency,
          ...(dbResult.error ? { error: dbResult.error } : {})
        },
        redis: {
          status: redisStatus,
          latencyMs: redisLatency,
        },
        minio: {
          status: minioStatus,
        },
        analysis: {
          status: analysisStatus,
          engines,
        },
        clamav: {
          status: clamavStatus,
        }
      },
    };
  }
}
