// Must be the first import: starts OpenTelemetry (when configured) before any
// instrumented module (http, express, pg, ioredis, undici) is loaded.
import './observability/bootstrap-tracing';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { runMigrations } from '@erppreflight/database';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { PinoNestLogger, getRootLogger } from './observability/logger';
import { getErrorReporter } from './observability/error-reporter';
import { getTracingHandle } from './observability/tracing';
import { registerApiReference } from './observability/api-reference';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  Logger.overrideLogger(new PinoNestLogger());

  process.on('unhandledRejection', (reason) => {
    getRootLogger().error({ err: reason instanceof Error ? reason.message : String(reason) }, 'Unhandled promise rejection');
    void getErrorReporter().captureException(reason, { tags: { source: 'unhandledRejection' } });
  });

  const isProduction = process.env.NODE_ENV === 'production';
  // Migrations are controlled solely by AUTO_MIGRATE (unset = true). The container
  // entrypoint (infra/docker/api-entrypoint.sh) also migrates; runs are idempotent.
  const autoMigrate = (process.env.AUTO_MIGRATE ?? 'true').toLowerCase() === 'true';

  if (autoMigrate) {
    try {
      logger.log('Running automated database migrations...');
      const migResult = await runMigrations();
      logger.log(
        `Database migrations complete: applied=${migResult.applied.length}, skipped=${migResult.skipped.length}`
      );
    } catch (err: any) {
      logger.error(`Automated migration failed: ${err.message}`, err.stack);
      // In production we allow startup or fail fast based on strict flag
      if (process.env.STRICT_MIGRATIONS === 'true') {
        process.exit(1);
      }
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Preserve the exact request bytes (req.rawBody) for Stripe webhook signatures.
    rawBody: true,
  });
  app.useLogger(new PinoNestLogger());
  // SCIM 2.0 clients send application/scim+json (RFC 7644 §3.1).
  app.useBodyParser('json', { type: ['application/json', 'application/scim+json'], limit: '10mb' });

  // Behind Traefik/Coolify the client address arrives in X-Forwarded-For; trust only
  // the configured number of proxy hops so req.ip (used by auth rate limiting) is real.
  const trustProxy = process.env.TRUST_PROXY ?? (isProduction ? '1' : 'false');
  if (trustProxy !== 'false' && trustProxy !== '') {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  app.enableShutdownHooks();
  app.useGlobalInterceptors(new CorrelationIdInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );

  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : isProduction
      ? ['https://erppreflight.com', 'https://www.erppreflight.com']
      : ['http://localhost:3000', 'https://erppreflight.com'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-Id',
      'Idempotency-Key',
      'X-Correlation-Id',
    ],
  });

  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/liveness', 'health/readiness'],
  });

  // Swagger UI (api/v1/docs) and the Scalar API reference (api/v1/reference, Part 21.38)
  // are disabled in production unless explicitly enabled.
  const swaggerEnabled = !isProduction || process.env.ENABLE_SWAGGER === 'true';
  const referenceEnabled = swaggerEnabled || process.env.ENABLE_API_REFERENCE === 'true';
  if (referenceEnabled) {
    const config = new DocumentBuilder()
      .setTitle('ERP Preflight Core API')
      .setDescription(
        'Enterprise multi-tenant preflight analysis and clean core auditing API. ' +
          'Authenticate with `Authorization: Bearer <JWT>` (interactive sessions) or `X-Api-Key: <key>` ' +
          '(organization API keys, scope-limited). Webhook deliveries are signed with `X-Hub-Signature-256` ' +
          '(HMAC-SHA256 of the raw body with the endpoint secret).'
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
      .addApiKey(
        { type: 'apiKey', name: 'X-Tenant-Id', in: 'header' },
        'tenant-id'
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    if (swaggerEnabled) {
      SwaggerModule.setup('api/v1/docs', app, document);
    }
    registerApiReference(app, document);
  }

  const port = process.env.PORT || process.env.API_PORT || 3001;
  const shutdownObservability = async () => {
    await getErrorReporter().flush().catch(() => undefined);
    await getTracingHandle().shutdown();
  };
  process.once('SIGTERM', () => void shutdownObservability());
  process.once('SIGINT', () => void shutdownObservability());
  await app.listen(port, '0.0.0.0');
  logger.log(`ERP Preflight API listening on port ${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger docs available at http://0.0.0.0:${port}/api/v1/docs`);
  }
  if (referenceEnabled) {
    logger.log(`API reference (Scalar) available at http://0.0.0.0:${port}/api/v1/reference`);
  }
  logger.log(
    `Observability: tracing=${getTracingHandle().enabled ? 'OTLP' : 'off'}, error reporting=${getErrorReporter().name}`
  );
}

bootstrap();
