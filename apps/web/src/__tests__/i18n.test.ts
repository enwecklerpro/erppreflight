import { describe, it, expect } from 'vitest';
import { en } from '../i18n/messages/en';
import { de } from '../i18n/messages/de';
import { createTranslator as createIntlTranslator } from 'next-intl';
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

  it('no dictionary key contains a dot (next-intl uses dots as path separators)', () => {
    const dotted: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (k.includes('.')) dotted.push(`${path}.${k}`);
          walk(v, path ? `${path}.${k}` : k);
        }
      }
    };
    walk(en, '');
    walk(de, '');
    expect(dotted).toEqual([]);
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
      const intl = createIntlTranslator({ locale, messages: locale === 'en' ? en : de, timeZone: 'UTC' });
      for (const [key, message] of Object.entries(flatten(locale === 'en' ? en : de))) {
        if (key.includes('[') || key.startsWith('engines.')) continue;
        // Supply every placeholder the message declares (plural/select arguments get a number).
        const vars: Record<string, string | number> = { count: 1, language: 'x' };
        for (const m of message.matchAll(/\{(\w+)(,[^{}]*)?/g)) vars[m[1]] = m[2] ? 1 : 'x';
        if (key.endsWith('Rich')) {
          // Rich-text messages (inline tags) are rendered with t.rich by the UI.
          const tags: Record<string, (c: unknown) => unknown> = {};
          for (const m of message.matchAll(/<(\w+)>/g)) tags[m[1]] = (c) => c;
          expect(() => (intl.rich as never as (k: string, v: object) => unknown)(key, { ...vars, ...tags }), `${locale} ${key}`).not.toThrow();
          continue;
        }
        expect(message, `${locale} ${key} contains markup; name the key *Rich`).not.toMatch(/<\w+>/);
        expect(() => t(key as never, vars), `${locale} ${key}`).not.toThrow();
        expect(t(key as never, vars), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
