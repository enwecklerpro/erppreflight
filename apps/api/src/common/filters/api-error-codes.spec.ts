import { describe, it, expect, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveErrorCode, GENERIC_ERROR_CODES, INDIRECT_ERROR_CODES, MESSAGE_ERROR_CODES } from './api-error-codes';

function run(exception: unknown): { status: number; body: Record<string, unknown> } {
  const filter = new HttpExceptionFilter();
  const result: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const response = {
    status: vi.fn((s: number) => {
      result.status = s;
      return response;
    }),
    json: vi.fn((b: Record<string, unknown>) => {
      result.body = b;
      return response;
    }),
  };
  const request = { url: '/api/v1/x', method: 'GET', headers: {}, path: '/api/v1/x' };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) };
  filter.catch(exception, host as never);
  return result;
}

describe('API error codes', () => {
  it('maps well-known messages to specific codes', () => {
    expect(deriveErrorCode(401, 'Invalid email or password')).toBe('INVALID_CREDENTIALS');
    expect(deriveErrorCode(404, 'Project not found')).toBe('PROJECT_NOT_FOUND');
    expect(deriveErrorCode(404, 'Project not found in this organization')).toBe('PROJECT_NOT_FOUND');
    expect(deriveErrorCode(409, 'The last owner cannot be demoted. Make another member an owner first.')).toBe('LAST_OWNER_DEMOTE');
  });

  it('derives generic codes from the status and flags validation arrays', () => {
    expect(deriveErrorCode(404, 'Regression test not found')).toBe('NOT_FOUND');
    expect(deriveErrorCode(400, ['name must be a string', 'name should not be empty'])).toBe('VALIDATION_FAILED');
    expect(deriveErrorCode(429, 'ThrottlerException: Too Many Requests')).toBe('RATE_LIMITED');
    expect(deriveErrorCode(503, 'down')).toBe('SERVICE_UNAVAILABLE');
    expect(deriveErrorCode(599, 'x')).toBe('INTERNAL_ERROR');
  });

  it('codes are UPPER_SNAKE_CASE and patterns are anchored', () => {
    const codes = [...Object.values(GENERIC_ERROR_CODES), ...MESSAGE_ERROR_CODES.map(([, c]) => c)];
    for (const c of codes) expect(c).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    for (const [re] of MESSAGE_ERROR_CODES) expect(re.source.startsWith('^')).toBe(true);
  });
});

describe('HttpExceptionFilter envelope', () => {
  it('always adds a code while keeping statusCode/message/details', () => {
    const { status, body } = run(new NotFoundException('Project not found'));
    expect(status).toBe(404);
    expect(body).toMatchObject({ statusCode: 404, message: 'Project not found', code: 'PROJECT_NOT_FOUND', path: '/api/v1/x' });
  });

  it('keeps an explicit code and structured fields', () => {
    const { body } = run(new ForbiddenException({ message: 'SSO required', code: 'SSO_REQUIRED', loginUrl: '/sso' }));
    expect(body.code).toBe('SSO_REQUIRED');
    expect(body.loginUrl).toBe('/sso');
    expect(body.message).toBe('SSO required');
  });

  it('codes validation errors and unknown errors', () => {
    expect(run(new BadRequestException(['a must be a string'])).body.code).toBe('VALIDATION_FAILED');
    expect(run(new ConflictException('Something unexpected')).body.code).toBe('CONFLICT');
    expect(run(new UnauthorizedException()).body.code).toBe('UNAUTHENTICATED');
    expect(run(new HttpException('teapot', 418)).body.code).toBe('BAD_REQUEST');
    const internal = run(new Error('boom'));
    expect(internal.status).toBe(500);
    expect(internal.body.code).toBe('INTERNAL_ERROR');
  });
});

describe('indirectly thrown error codes', () => {
  const src = (rel: string) => readFileSync(resolve(__dirname, '../../modules', rel), 'utf8');

  it('INDIRECT_ERROR_CODES lists every code emitted through constants, policy decisions and templates', () => {
    const listed = new Set<string>(INDIRECT_ERROR_CODES);
    const blockerType = src('governance/rule-governance.types.ts').match(/export type PublishBlocker =([^;]+);/)?.[1] ?? '';
    const blockers = [...blockerType.matchAll(/'([A-Z_]+)'/g)].map((m) => `RULE_PUBLISH_BLOCKED_${m[1]}`);
    expect(blockers.length).toBeGreaterThan(3);
    expect(src('governance/rule-governance.service.ts')).toContain('code: `RULE_PUBLISH_BLOCKED_${blocker}`');
    const constants = [
      ...src('auth/csrf.guard.ts').matchAll(/_CODE = '([A-Z_]+)'/g),
      ...src('auth/magic-link.service.ts').matchAll(/_CODE = '([A-Z_]+)'/g),
      ...src('tenant-access/impersonation.policy.ts').matchAll(/export const IMPERSONATION_[A-Z_]+ = '([A-Z_]+)'/g),
      ...src('tenant-access/tenant-access.policy.ts').matchAll(/code: '([A-Z_]+)'/g),
      ...src('tenant-access/impersonation.service.ts').matchAll(/'(IMPERSONATION_(?:EXPIRED|ENDED))'/g),
    ].map((m) => m[1]);
    expect(constants).toContain('CSRF_REJECTED');
    expect(constants).toContain('MAGIC_LINK_INVALID');
    const missing = [...new Set([...blockers, ...constants])].filter((c) => !listed.has(c));
    expect(missing).toEqual([]);
  });
});
