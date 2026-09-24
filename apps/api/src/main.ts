import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { runMigrations } from '@erppreflight/database';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  if (process.env.AUTO_MIGRATE === 'true' || process.env.NODE_ENV === 'production') {
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

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

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
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
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

  const config = new DocumentBuilder()
    .setTitle('ERP Preflight Core API')
    .setDescription(
      'Enterprise multi-tenant preflight analysis and clean core auditing API'
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey(
      { type: 'apiKey', name: 'X-Tenant-Id', in: 'header' },
      'tenant-id'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document);

  const port = process.env.PORT || process.env.API_PORT || 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`ERP Preflight API listening on port ${port}`);
  logger.log(`Swagger docs available at http://0.0.0.0:${port}/api/v1/docs`);
}

bootstrap();
