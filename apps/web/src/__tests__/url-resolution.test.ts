import { describe, it, expect, afterEach } from 'vitest';
import { resolveApiUrl } from '../lib/api/custom-instance';

describe('resolveApiUrl Canonical API URL Resolution', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_API_URL = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_API_URL;
    }
  });

  describe('Permutation 1: Base with /api/v1, path with /api/v1', () => {
    it('strips redundant /api/v1 from base and avoids double prefix', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('/api/v1/auth/login');
      expect(result).toBe('https://api.erppreflight.com/api/v1/auth/login');
    });
  });

  describe('Permutation 2: Base with /api/v1, path without /api/v1', () => {
    it('appends path directly preserving the single /api/v1 prefix', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const result = resolveApiUrl('/projects');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });
  });

  describe('Permutation 3: Base without /api/v1, path with /api/v1', () => {
    it('joins cleanly without adding redundant prefixes', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com';
      const result = resolveApiUrl('/api/v1/projects');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });
  });

  describe('Permutation 4: Base without /api/v1, path without /api/v1', () => {
    it('automatically prepends /api/v1 to route to correct backend prefix', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com';
      const result = resolveApiUrl('/projects');
      expect(result).toBe('https://api.erppreflight.com/api/v1/projects');
    });

    it('works for multi-segment path without /api/v1', () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';
      const result = resolveApiUrl('/findings/stats');
      expect(result).toBe('http://localhost:3001/api/v1/findings/stats');
    });
  });

  describe('Permutation 5: Trailing slashes on base', () => {
    it('normalizes single and multiple trailing slashes on base with /api/v1', () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/v1/';
      expect(resolveApiUrl('/projects')).toBe('http://localhost:3001/api/v1/projects');
      expect(resolveApiUrl('/api/v1/projects')).toBe('http://localhost:3001/api/v1/projects');

      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/v1///';
      expect(resolveApiUrl('/projects')).toBe('http://localhost:3001/api/v1/projects');
    });

    it('normalizes trailing slashes on base without /api/v1', () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/';
      expect(resolveApiUrl('/projects')).toBe('http://localhost:3001/api/v1/projects');
    });
  });

  describe('Permutation 6: Missing leading slash on path', () => {
    it('normalizes paths without leading slashes', () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';
      expect(resolveApiUrl('projects')).toBe('http://localhost:3001/api/v1/projects');
      expect(resolveApiUrl('api/v1/projects')).toBe('http://localhost:3001/api/v1/projects');
    });

    it('normalizes path without leading slash when base includes /api/v1', () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/v1';
      expect(resolveApiUrl('projects')).toBe('http://localhost:3001/api/v1/projects');
    });
  });

  describe('Permutation 7: Absolute HTTP URLs', () => {
    it('passes through absolute http:// URLs unchanged', () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/v1';
      const url = 'http://external-audit.corp/api/v2/check';
      expect(resolveApiUrl(url)).toBe(url);
    });
  });

  describe('Permutation 8: Absolute HTTPS URLs', () => {
    it('passes through absolute https:// URLs unchanged', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.erppreflight.com/api/v1';
      const url = 'https://s4h-gateway.corp.com:8443/sap/opu/odata/IWFND/CATALOGSERVICE';
      expect(resolveApiUrl(url)).toBe(url);
    });
  });

  describe('Permutation 9: Empty base (browser relative URLs)', () => {
    it('resolves relative URLs in browser environment', () => {
      process.env.NEXT_PUBLIC_API_URL = '';
      expect(resolveApiUrl('/projects')).toBe('/api/v1/projects');
      expect(resolveApiUrl('/api/v1/projects')).toBe('/api/v1/projects');
      expect(resolveApiUrl('projects')).toBe('/api/v1/projects');
    });
  });

  describe('Default SSR Fallback: Port 3001', () => {
    it('defaults to http://localhost:3001 in SSR when NEXT_PUBLIC_API_URL is unset', () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      const originalWindow = global.window;
      try {
        delete (global as any).window;
        expect(resolveApiUrl('/projects')).toBe('http://localhost:3001/api/v1/projects');
        expect(resolveApiUrl('/api/v1/auth/me')).toBe('http://localhost:3001/api/v1/auth/me');
      } finally {
        global.window = originalWindow;
      }
    });
  });
});
