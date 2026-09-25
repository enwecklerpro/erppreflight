import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalArtifactRedactor } from '../src/redactor';
import { LocalDirectoryScanner } from '../src/scanner';
import { ErpPreflightClient } from '../src/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Local Agent On-Premise Suite', () => {
  describe('LocalArtifactRedactor', () => {
    it('redacts RFC passwords and database credentials while preserving text structure', () => {
      const raw = `
        rfc_password="SuperSecretSapPassword123"
        database_url="postgres://user:super_secret_db_pass@db.internal:5432/s4h"
        clean_code=true
      `;
      const result = LocalArtifactRedactor.redact(raw);

      expect(result.redactedCount).toBeGreaterThanOrEqual(2);
      expect(result.content).not.toContain('SuperSecretSapPassword123');
      expect(result.content).not.toContain('super_secret_db_pass');
      expect(result.content).toContain('[REDACTED_');
      expect(result.content).toContain('clean_code=true');
    });

    it('redacts bearer tokens and API keys', () => {
      const raw = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature';
      const result = LocalArtifactRedactor.redact(raw);

      expect(result.redactedCount).toBe(1);
      expect(result.content).not.toContain('doNotLeakThisSignature');
    });
  });

  describe('LocalDirectoryScanner', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-scan-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('scans SAP artifacts, computes SHA-256 hashes, and applies local redactions', () => {
      const sampleXml = '<Form><Password value="ConfidentialPass123"/></Form>';
      fs.writeFileSync(path.join(tempDir, 'billing_doc.xml'), sampleXml, 'utf-8');

      const artifacts = LocalDirectoryScanner.scan({
        rootDir: tempDir,
        redactSecrets: true,
      });

      expect(artifacts.length).toBe(1);
      expect(artifacts[0].relativePath).toBe('billing_doc.xml');
      expect(artifacts[0].extension).toBe('.xml');
      expect(artifacts[0].sha256).toHaveLength(64);
      expect(artifacts[0].redactedContent).not.toContain('ConfidentialPass123');
      expect(artifacts[0].redactedCount).toBe(1);
    });
  });

  describe('ErpPreflightClient', () => {
    it('returns healthy status when endpoint responds with HTTP 200', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new ErpPreflightClient({ apiUrl: 'http://localhost:3001' });
      const res = await client.ping();

      expect(res.healthy).toBe(true);
      expect(res.status).toBe(200);

      vi.unstubAllGlobals();
    });

    it('handles connection failures gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', mockFetch);

      const client = new ErpPreflightClient({ apiUrl: 'http://unreachable-host:9999' });
      const res = await client.ping();

      expect(res.healthy).toBe(false);
      expect(res.message).toContain('ECONNREFUSED');

      vi.unstubAllGlobals();
    });
  });
});
