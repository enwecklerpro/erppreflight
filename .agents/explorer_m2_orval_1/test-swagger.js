const { NestFactory } = require('@nestjs/core');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const path = require('path');
const fs = require('fs');

async function testExport() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'secret-key-must-be-at-least-32-chars-long-abcdef123456';
  
  // require the compiled AppModule from dist
  const { AppModule } = require(path.resolve(__dirname, '../../apps/api/dist/src/app.module.js'));
  
  const app = await NestFactory.create(AppModule, { logger: false });
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
  const outPath = path.resolve(__dirname, 'openapi-sample.json');
  fs.writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf8');
  console.log('SUCCESS: Generated Swagger JSON to', outPath);
  console.log('Endpoints count:', Object.keys(document.paths || {}).length);
  console.log('Paths:', Object.keys(document.paths || {}));
  await app.close();
  process.exit(0);
}

testExport().catch(err => {
  console.error('ERROR generating swagger:', err);
  process.exit(1);
});
