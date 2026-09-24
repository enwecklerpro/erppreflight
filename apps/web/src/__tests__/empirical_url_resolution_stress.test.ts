import { describe, it, expect, afterEach } from 'vitest';
import { resolveApiUrl } from '../lib/api/custom-instance';

describe('Empirical Challenger 1: R5 (Canonical API URL Resolution Stress)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_API_URL = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_API_URL;
    }
  });

  describe('1. Double Slashes Edge Cases', () => {
    it('R5-C1: Handles path with leading double slash "//projects"', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('//projects');
      // Should resolve to canonical path without duplicate slashes
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });

    it('R5-C2: Handles path with "//api/v1/projects"', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('//api/v1/projects');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });

    it('R5-C3: Handles intermediate double slashes "/projects//123"', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('/projects//123');
      // Notice what this produces
      expect(result).not.toContain('/api/v1//api/v1');
    });

    it('R5-C4: Handles base with double slashes "https://api.erppreflight.com//api/v1"', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com//api/v1';
      const result = resolveApiUrl('/projects');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });
  });

  describe('2. Duplicate /api/v1/api/v1 Permutations', () => {
    it('R5-C5: Handles path that already accidentally contains duplicate "/api/v1/api/v1/projects"', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('/api/v1/api/v1/projects');
      // A truly robust canonicalizer should collapse repeated /api/v1 segments
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });

    it('R5-C6: Handles base ending with duplicate "/api/v1/api/v1"', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1/api/v1';
      const result = resolveApiUrl('/projects');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });

    it('R5-C7: Handles path starting with /api/v10 (version prefix ambiguity)', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('/api/v10/projects');
      // Notice: if cleanPath.startsWith('/api/v1'), it treats /api/v10 as starting with /api/v1!
      // But /api/v10 is NOT /api/v1/!
      // Let's observe what resolveApiUrl does:
      expect(result).toBe('https://api.erppreflight.com/api/v1/api/v10/projects');
    });
  });

  describe('3. Query Strings and Parameters', () => {
    it('R5-C8: Preserves query strings when resolving paths without /api/v1', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('/projects?status=active&sort=desc');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects?status=active&sort=desc');
    });

    it('R5-C9: Preserves query strings when resolving paths with /api/v1', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('/api/v1/projects?status=active');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects?status=active');
    });

    it('R5-C10: Handles query parameter containing "/api/v1" as a value', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com';
      const result = resolveApiUrl('/export?path=/api/v1/clean.zip');
      expect(result).toBe('https://api.erppreflight.com/api/v1/export?path=/api/v1/clean.zip');
    });

    it('R5-C11: Handles query-only path "?filter=all"', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('?filter=all');
      expect(result).toBe('https://api.erppreflight.com/api/v1?filter=all');
    });
  });

  describe('4. Fragment Identifiers', () => {
    it('R5-C12: Preserves hash fragment identifiers on path', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('/projects#tab-artifacts');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects#tab-artifacts');
    });

    it('R5-C13: Preserves hash fragment with query string', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com';
      const result = resolveApiUrl('/projects?tab=overview#section-evidence');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects?tab=overview#section-evidence');
    });
  });

  describe('5. Leading / Trailing Whitespace', () => {
    it('R5-C14: Trims whitespace from path "  /projects  "', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('  /projects  ');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });

    it('R5-C15: Trims whitespace from absolute URL "  https://api.erppreflight.com/api/v1/test  "', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('  https://api.erppreflight.com/api/v1/test  ');
      expect(result).toBe('https://api.erppreflight.com/api/v1/test');
    });

    it('R5-C16: Handles whitespace in NEXT_PUBLIC_API_URL environment variable', () => {
      process.env.NEXT_PUBLIC_API_URL = '  https://api.erppreflight.com/api/v1  ';
      const result = resolveApiUrl('/projects');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });
  });

  describe('6. Absolute and Protocol-Relative URLs', () => {
    it('R5-C17: Returns http:// URL unchanged', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      expect(resolveApiUrl('http://insecure-api.internal/api/v1/ping')).toBe('http://insecure-api.internal/api/v1/ping');
    });

    it('R5-C18: Returns https:// URL unchanged', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      expect(resolveApiUrl('https://secure-api.corp/v1/scan')).toBe('https://secure-api.corp/v1/scan');
    });

    it('R5-C19: Handles protocol-relative URL "//cdn.corp.com/api/v1/resource"', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('//cdn.corp.com/api/v1/resource');
      // Empirical observation of protocol-relative behavior
      expect(result).toBeDefined();
    });
  });
});
