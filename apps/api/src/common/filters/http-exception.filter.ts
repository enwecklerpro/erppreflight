import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

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

    // Optional machine-readable error code, e.g. EMAIL_NOT_VERIFIED (web UI branches on it).
    const code =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      typeof (exceptionResponse as any).code === 'string'
        ? (exceptionResponse as any).code
        : undefined;

    const errorPayload = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      correlationId,
      message,
      ...(code ? { code } : {}),
    };

    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} - Error: ${message}`,
        exception instanceof Error ? exception.stack : undefined
      );
    }

    response.status(status).json(errorPayload);
  }
}
