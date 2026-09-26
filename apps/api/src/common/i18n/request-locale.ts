import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Language of server-generated, user-facing content (system templates, changelog, …).
 *
 * Resolution: explicit `?locale=en|de` query parameter (validated, 400 otherwise) →
 * `Accept-Language` header (the web client sends the active UI language) → English.
 * Only content the API itself authors is localized; customer data, engine output
 * (deterministic, part of finding fingerprints) and audit records stay as stored.
 */
export const API_LOCALES = ['en', 'de'] as const;
export type ApiLocale = (typeof API_LOCALES)[number];

export const ApiLocaleSchema = z.enum(API_LOCALES);

export function localeFromAcceptLanguage(header: unknown): ApiLocale {
  if (typeof header !== 'string' || !header.trim()) return 'en';
  // Highest-priority tag first ("de-DE,de;q=0.9,en;q=0.8" → "de").
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split('-')[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((e) => e.lang && e.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of ranked) {
    if ((API_LOCALES as readonly string[]).includes(entry.lang)) return entry.lang as ApiLocale;
  }
  return 'en';
}

export function resolveRequestLocale(query: unknown, acceptLanguage: unknown): ApiLocale {
  if (query !== undefined && query !== null && query !== '') {
    const parsed = ApiLocaleSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('locale must be one of: en, de');
    return parsed.data;
  }
  return localeFromAcceptLanguage(acceptLanguage);
}
