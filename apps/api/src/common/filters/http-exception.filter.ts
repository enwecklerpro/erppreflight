import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getErrorReporter } from '../../observability/error-reporter';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const message =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as any).message || exceptionResponse
        : exception instanceof Error
        ? exception.message
        : 'Internal server error';

    const correlationId =
      request.headers['x-correlation-id'] || 'no-correlation-id';

    // Structured details attached to an HttpException (e.g. a permission diff) are
    // passed through under `details`; statusCode/message/error keep their fixed slots.
    let details: Record<string, unknown> | undefined;
    if (status < 500 && typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const { statusCode: _s, message: _m, error: _e, ...rest } = exceptionResponse as Record<string, unknown>;
      if (Object.keys(rest).length > 0) details = rest;
    }

    const errorPayload = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      correlationId,
      message,
      ...(details ? { details } : {}),
      // Machine-readable error code and plan-limit context (e.g. PLAN_LIMIT_EXCEEDED, HTTP 402).
      ...pickStructuredErrorFields(exceptionResponse),
    };

    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} - Error: ${message}`,
        exception instanceof Error ? exception.stack : undefined
      );
      // Error reporting adapter (Sentry when SENTRY_DSN is set, no-op otherwise).
      void getErrorReporter()
        .captureException(exception, {
          method: request.method,
          path: request.route?.path ? `${request.baseUrl || ''}${request.route.path}` : request.path,
          statusCode: status,
          requestId: (request as any).requestId,
          tenantId: (request as any).tenantId,
        })
        .catch(() => undefined);
    }

    response.status(status).json(errorPayload);
  }
}

const STRUCTURED_ERROR_KEYS = ['code', 'limitKey', 'used', 'limit', 'planTier', 'loginUrl'] as const;

function pickStructuredErrorFields(exceptionResponse: unknown): Record<string, unknown> {
  if (typeof exceptionResponse !== 'object' || exceptionResponse === null) return {};
  const source = exceptionResponse as Record<string, unknown>;
  if (typeof source.code !== 'string') return {};
  const out: Record<string, unknown> = {};
  for (const key of STRUCTURED_ERROR_KEYS) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  }
  return out;
}
