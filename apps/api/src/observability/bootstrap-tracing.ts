// Imported FIRST by main.ts so OpenTelemetry instrumentations patch http, express,
// pg, ioredis and undici before any application module loads them.
import { initTracing } from './tracing';

initTracing();
