import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentDevicesService, EnrollSchema, HeartbeatSchema, JobResultSchema } from './agent-devices.service';
import { ZodBody } from '../../common/openapi/zod-openapi';
import { clientIpOf } from '../tenant-access/client-ip';

function rawBodyOf(req: any): string {
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return JSON.stringify(req.body);
  return '';
}

/**
 * Device-facing endpoints used by apps/local-agent (outbound-only polling).
 * Authentication is by device credential + Ed25519 request signature (see
 * AgentDevicesService.authenticate); user JWTs / API keys are not accepted here.
 */
@ApiTags('Local Agent Device API')
@Controller('agent-api')
export class AgentApiController {
  constructor(private readonly devices: AgentDevicesService) {}

  @Post('enroll')
  @ZodBody(EnrollSchema)
  @ApiOperation({ summary: 'Enroll a device with a single-use enrollment token and its Ed25519 public key' })
  enroll(@Req() req: any, @Body() body: unknown) {
    return this.devices.enroll(body, clientIpOf(req) ?? undefined);
  }

  @Post('heartbeat')
  @ZodBody(HeartbeatSchema)
  @HttpCode(200)
  @ApiOperation({ summary: 'Signed heartbeat; returns queued signed job envelopes' })
  async heartbeat(@Req() req: any, @Body() body: unknown) {
    const device = await this.devices.authenticate(req.headers, req.method, req.originalUrl || req.url, rawBodyOf(req), clientIpOf(req));
    return this.devices.heartbeat(device, body);
  }

  @Post('jobs/:jobId/result')
  @ZodBody(JobResultSchema)
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit a signed job result (redacted manifest; contents only if egress policy allows)' })
  async result(@Req() req: any, @Param('jobId', new ParseUUIDPipe()) jobId: string, @Body() body: unknown) {
    const device = await this.devices.authenticate(req.headers, req.method, req.originalUrl || req.url, rawBodyOf(req), clientIpOf(req));
    return this.devices.submitResult(device, jobId, body);
  }

  @Get('updates/:channel')
  @ApiOperation({ summary: 'Signed agent update manifest for a channel (Part 18.8)' })
  update(@Param('channel') channel: string) {
    return this.devices.updateManifest(channel);
  }
}
