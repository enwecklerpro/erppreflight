import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TelemetryService } from './telemetry.service';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { TenancyContext } from '@erppreflight/tenancy';
import { runWithRequestContext } from '../../observability/request-context';

@Injectable()
export class TelemetryMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');
  constructor(private readonly telemetryService: TelemetryService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = performance.now();
    // Honour a well-formed upstream request id (reverse proxy), otherwise mint one.
    const incomingId = req.headers['x-request-id'];
    const requestId =
      typeof incomingId === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(incomingId) ? incomingId : uuidv4();

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
      this.telemetryService.recordHttpRequestDuration(elapsedMs, req.method, res.statusCode);
      this.telemetryService.incrementHttpRequests(req.method, res.statusCode);

      // Never throw from a 'finish' listener: an uncaught error here crashes the process.
      const tenantId = (req as any).tenantId || TenancyContext.get()?.tenantId || null;
      
      const logData = {
        requestId,
        traceId,
        method: req.method,
        // Query strings may carry tokens: log the path only.
        url: String(req.originalUrl || req.url || '').split('?')[0],
        userAgent: req.headers['user-agent'],
        tenantId,
        statusCode: res.statusCode,
        durationMs: Math.round(elapsedMs),
        contentLength: res.get('content-length'),
      };

      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
      this.logger[level](JSON.stringify({ msg: 'request completed', ...logData }));
    });

    runWithRequestContext(
      { requestId, traceId, method: req.method, path: String(req.originalUrl || req.url || '').split('?')[0] },
      () => next()
    );
  }
}
