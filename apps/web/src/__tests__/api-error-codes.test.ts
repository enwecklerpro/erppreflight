import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../lib/api/custom-instance';
import { getT } from '../i18n/translate';
import { localizeError } from '../i18n/validation';
import { apiErrorCodes as en } from '../i18n/messages/app/en/apiErrorCodes';
import { apiErrorCodes as de } from '../i18n/messages/app/de/apiErrorCodes';
import { ACCOUNT_ERROR_CODES } from '@erppreflight/schemas';

/**
 * Every machine code the API can put into the error envelope has EN + DE text:
 * the generic/message catalog in api-error-codes.ts, explicit `code:` values thrown
 * with Nest exceptions anywhere in apps/api/src, and the shared account codes.
 */
const API_SRC = path.resolve(__dirname, '../../../api/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function apiCodes(): Set<string> {
  const codes = new Set<string>(Object.values(ACCOUNT_ERROR_CODES));
  const catalog = fs.readFileSync(path.join(API_SRC, 'common/filters/api-error-codes.ts'), 'utf8');
  for (const m of catalog.matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{4,})'/g)) codes.add(m[1]);
  for (const file of walk(API_SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:new \w*Exception|super)\(\s*\{[\s\S]{0,400}?\bcode:\s*'([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]);
  }
  return codes;
}

describe('API error codes are localized', () => {
  const codes = apiCodes();

  it('finds the API code catalog', () => {
    expect(codes.size).toBeGreaterThan(60);
    expect(codes.has('PLAN_LIMIT_EXCEEDED')).toBe(true);
    expect(codes.has('PROJECT_NOT_FOUND')).toBe(true);
  });

  it('every API code has English and German text', () => {
    const missing = [...codes].filter((c) => !(c in en.codes) || !(c in de.codes));
    expect(missing, `Add to app.apiErrorCodes.codes (EN + DE): ${missing.join(', ')}`).toEqual([]);
  });

  it('German texts are translated', () => {
    const same = (Object.keys(en.codes) as Array<keyof typeof en.codes>).filter((c) => en.codes[c] === de.codes[c]);
    expect(same).toEqual([]);
  });
});

describe('localizeError with API codes', () => {
  const tEn = getT('en');
  const tDe = getT('de');

  it('uses the dictionary for specific codes', () => {
    const err = new ApiError(404, { statusCode: 404, message: 'Project not found', code: 'PROJECT_NOT_FOUND' });
    expect(localizeError(err, tDe)).toBe('Das Projekt wurde nicht gefunden.');
    expect(localizeError(err, tEn)).toBe('The project was not found.');
  });

  it('keeps the server detail for generic codes and prepends a German summary', () => {
    const err = new ApiError(404, { statusCode: 404, message: 'Regression test not found', code: 'NOT_FOUND' });
    expect(localizeError(err, tEn)).toBe('Regression test not found');
    expect(localizeError(err, tDe)).toBe('Das angeforderte Element wurde nicht gefunden. (Hinweis des Servers: Regression test not found)');
  });

  it('still maps known messages when the server sends only a generic code', () => {
    const err = new ApiError(401, { statusCode: 401, message: 'Invalid email or password', code: 'UNAUTHENTICATED' });
    expect(localizeError(err, tDe)).toBe('E-Mail-Adresse oder Passwort ist falsch');
  });

  it('works without a code (older API) and for unknown codes', () => {
    expect(localizeError(new ApiError(409, { statusCode: 409, message: 'Custom conflict' }), tDe)).toBe('Custom conflict');
    expect(localizeError(new ApiError(400, { statusCode: 400, message: 'x', code: 'SOMETHING_NEW' }), tDe)).toBe('x');
  });
});
