import { describe, it, expect } from 'vitest';
import { en } from '../i18n/messages/en';
import { de } from '../i18n/messages/de';
import { createTranslator, getFormat } from '../i18n/translate';
import { CANONICAL_ENGINES } from '../lib/api-client';
import { SOLUTION_SLUGS } from '../lib/solutions';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Flattens a dictionary into path → leaf, including array indices. */
function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === 'string') {
    out[prefix] = value;
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, Json>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('i18n dictionaries', () => {
  const flatEn = flatten(en);
  const flatDe = flatten(de);

  it('EN and DE have identical key sets (including list lengths)', () => {
    expect(Object.keys(flatDe).sort()).toEqual(Object.keys(flatEn).sort());
  });

  it('no translation is empty and placeholders match', () => {
    for (const [key, value] of Object.entries(flatEn)) {
      expect(value.trim(), `en ${key}`).not.toBe('');
      expect(flatDe[key]?.trim(), `de ${key}`).not.toBe('');
      expect(placeholders(flatDe[key]), `placeholders ${key}`).toBe(placeholders(value));
    }
  });

  it('every canonical engine has a description in both languages', () => {
    for (const engine of CANONICAL_ENGINES) {
      expect(en.engines[engine.id], engine.id).toBeTruthy();
      expect(de.engines[engine.id], engine.id).toBeTruthy();
    }
    expect(Object.keys(de.engines).sort()).toEqual(CANONICAL_ENGINES.map((e) => e.id).sort());
  });

  it('every solution slug has localized content', () => {
    for (const slug of SOLUTION_SLUGS) {
      expect(en.solutions.items[slug].name).toBeTruthy();
      expect(de.solutions.items[slug].examples.length).toBe(en.solutions.items[slug].examples.length);
    }
  });

  it('footer carries the SAP independence disclaimer in both languages', () => {
    expect(en.footer.disclaimer).toMatch(/not affiliated with, endorsed or sponsored by SAP SE/);
    expect(de.footer.disclaimer).toMatch(/SAP SE/);
    expect(de.footer.disclaimer).toMatch(/unabhängiges Produkt/);
  });
});

describe('translator', () => {
  it('resolves typed keys per locale and interpolates variables', () => {
    expect(createTranslator('en')('nav.pricing')).toBe('Pricing');
    expect(createTranslator('de')('nav.pricing')).toBe('Preise');
    expect(createTranslator('de')('common.engineCount', { count: 19 })).toBe('19 Analyse-Engines');
  });

  it('formats numbers and dates per locale via next-intl', () => {
    expect(getFormat('de').number(1490)).toBe('1.490');
    expect(getFormat('en').number(1490)).toBe('1,490');
    expect(getFormat('de').dateTime(new Date('2026-09-26T00:00:00Z'), { dateStyle: 'long' })).toBe('26. September 2026');
  });

  it('every message is valid ICU syntax (renders without throwing)', () => {
    for (const locale of ['en', 'de'] as const) {
      const t = createTranslator(locale);
      for (const [key, message] of Object.entries(flatten(locale === 'en' ? en : de))) {
        if (key.includes('[') || key.startsWith('engines.')) continue;
        // Supply a value for every placeholder the message declares.
        const vars: Record<string, string | number> = { count: 1, language: 'x' };
        for (const m of message.match(/\{(\w+)\}/g) ?? []) vars[m.slice(1, -1)] ??= 'x';
        expect(() => t(key as never, vars), `${locale} ${key}`).not.toThrow();
        expect(t(key as never, vars), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
