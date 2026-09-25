import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TelemetryService } from './telemetry.service';
import * as crypto from 'node:crypto';

@Injectable()
export class TelemetryMiddleware implements NestMiddleware {
  constructor(private readonly telemetryService: TelemetryService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = performance.now();

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
    res.setHeader('X-Trace-Id', traceId);
    res.setHeader('traceparent', responseTraceparent);

    // 2. Track duration and response status code upon response completion
    res.on('finish', () => {
      const elapsedMs = performance.now() - startTime;
      this.telemetryService.recordHttpRequestDuration(elapsedMs);
      this.telemetryService.incrementHttpRequests(req.method, res.statusCode);
    });

    next();
  }
}
