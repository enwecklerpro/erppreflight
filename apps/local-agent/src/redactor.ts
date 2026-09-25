import * as crypto from 'node:crypto';

export interface RedactionResult {
  content: string;
  redactedCount: number;
  redactedCategories: string[];
}

export class LocalArtifactRedactor {
  private static readonly PATTERNS: Array<{ category: string; regex: RegExp }> = [
    {
      category: 'SAP_PASSWORD_FIELD',
      regex: /(?:password|passwd|rfc_password|pwd)(?:[^=>:\n]*[=:]\s*['"]?|<[^>]*value=['"])([^'",<>\s\r\n]{4,})['"]?/gi,
    },
    {
      category: 'SAP_PASSWORD_XML_ELEMENT',
      regex: /<(?:password|passwd|rfc_password|pwd)[^>]*>([^<]{4,})<\/(?:password|passwd|rfc_password|pwd)>/gi,
    },
    {
      category: 'BEARER_JWT_TOKEN',
      regex: /Bearer\s+([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/gi,
    },
    {
      category: 'API_SECRET_KEY',
      regex: /(?:api[_-]?key|client[_-]?secret|private[_-]?key)\s*[=:]\s*['"]?([A-Za-z0-9_\-+/]{16,})['"]?/gi,
    },
    {
      category: 'DATABASE_CONNECTION_STRING',
      regex: /(?:postgres|mysql|hdb):\/\/[^:]+:([^@]+)@/gi,
    },
    {
      category: 'IBAN_CREDIT_CARD',
      regex: /\b([A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16})\b|\b(?:\d{4}[ -]?){3}\d{4}\b/g,
    },
  ];

  /**
   * Performs in-place deterministic redaction of sensitive strings before transmission.
   * Preserves line counts and structure so evidence coordinate pointers remain accurate.
   */
  static redact(rawText: string): RedactionResult {
    let content = rawText;
    let redactedCount = 0;
    const categories = new Set<string>();

    for (const { category, regex } of this.PATTERNS) {
      content = content.replace(regex, (match, captured) => {
        redactedCount++;
        categories.add(category);
        const secretVal = captured || match;
        const hash = crypto.createHash('sha256').update(secretVal).digest('hex').substring(0, 8);
        return match.replace(secretVal, `[REDACTED_${category}_${hash}]`);
      });
    }

    return {
      content,
      redactedCount,
      redactedCategories: Array.from(categories),
    };
  }
}
