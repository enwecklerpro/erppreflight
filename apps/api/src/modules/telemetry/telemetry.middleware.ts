import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TelemetryService } from './telemetry.service';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { TenancyContext } from '@erppreflight/tenancy';

@Injectable()
export class TelemetryMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');
  constructor(private readonly telemetryService: TelemetryService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = performance.now();
    const requestId = uuidv4();

    // 1. W3C TraceContext and X-Trace-Id resolution/injection
    let traceId = req.headers['x-trace-id'] as string;
    let traceparent = req.headers['traceparent'] as string;

    if (!traceId) {
      if (traceparent && traceparent.startsWith('00-')) {
        const parts = traceparent.split('-');
        if (parts.length >= 2) {
          traceId = parts[1];
        }
      }
    }

    if (!traceId) {
      traceId = crypto.randomBytes(16).toString('hex');
    }

    const spanId = crypto.randomBytes(8).toString('hex');
    const responseTraceparent = `00-${traceId}-${spanId}-01`;

    // Bind to request and response
    (req as any).traceId = traceId;
    (req as any).requestId = requestId;
    res.setHeader('X-Trace-Id', traceId);
    res.setHeader('traceparent', responseTraceparent);
    res.setHeader('X-Request-ID', requestId);

    // 2. Track duration and response status code upon response completion
    res.on('finish', () => {
      const elapsedMs = performance.now() - startTime;
      this.telemetryService.recordHttpRequestDuration(elapsedMs);
      this.telemetryService.incrementHttpRequests(req.method, res.statusCode);

      const tenantId = TenancyContext.getTenantId() || null;
      
      const logData = {
        requestId,
        method: req.method,
        url: req.originalUrl || req.url,
        userAgent: req.headers['user-agent'],
        tenantId,
        statusCode: res.statusCode,
        durationMs: Math.round(elapsedMs),
        contentLength: res.get('content-length'),
      };

      this.logger.log(JSON.stringify(logData));
    });

    next();
  }
}
