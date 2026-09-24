import { describe, it, expect } from 'vitest';
import { SecretRedactorService } from '../src/modules/redaction/secret-redactor.service';
import { ExportService } from '../src/modules/export/export.service';
import { ConfigService } from '@nestjs/config';

describe('M2 Secret Redaction & Report Export Suite', () => {
  const config = new ConfigService({
    MASTER_ENCRYPTION_KEY: 'test-master-encryption-key-for-unit-testing-32-chars',
    S3_BUCKET_CLEAN: 'erppreflight-clean',
    S3_BUCKET_REPORTS: 'erppreflight-reports',
  });
  const redactor = new SecretRedactorService(config);

  describe('1. Secret Redaction & Shannon Entropy Engine', () => {
    it('redacts Bearer tokens with deterministic HMAC-SHA256 mask', () => {
      const tenant1 = 'c1111111-1111-1111-1111-111111111111';
      const tenant2 = 'c2222222-2222-2222-2222-222222222222';
      const sampleText = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token_payload_xyz';

      const res1 = redactor.redact(sampleText, tenant1);
      expect(res1.redactionsCount).toBeGreaterThanOrEqual(1);
      expect(res1.sanitizedText).toContain('[REDACTED:SECRET:');
      expect(res1.sanitizedText).not.toContain('eyJhbGciOi');

      // Referential integrity: Same secret under same tenant gives exact same mask
      const res1Repeat = redactor.redact(sampleText, tenant1);
      expect(res1.sanitizedText).toBe(res1Repeat.sanitizedText);

      // Cross-tenant privacy: Same secret under different tenant gives different mask
      const res2 = redactor.redact(sampleText, tenant2);
      expect(res1.sanitizedText).not.toBe(res2.sanitizedText);
    });

    it('redacts multi-line private key blocks', () => {
      const tenant = 'c1111111-1111-1111-1111-111111111111';
      const privateKey = [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEowIBAAKCAQEA0Y1+g43hYjdQkI3+4W5',
        'Z1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8',
        '-----END RSA PRIVATE KEY-----',
      ].join('\n');

      const res = redactor.redact(privateKey, tenant);
      expect(res.redactionsCount).toBe(1);
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
      expect(res.sanitizedText).not.toContain('MIIEowIBAAKCA');
      expect(res.redactedCategories).toContain('PRIVATE_KEY');
    });

    it('redacts SAP RFC credentials and parameters', () => {
      const tenant = 'c1111111-1111-1111-1111-111111111111';
      const rfcConfig = 'rfc_password = "SecretRFC2026!"; ASHOST = "erp.corp.internal"; PASSWD = "AdminPassword!";';
      const res = redactor.redact(rfcConfig, tenant);
      expect(res.sanitizedText).not.toContain('SecretRFC2026!');
      expect(res.sanitizedText).not.toContain('AdminPassword!');
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
    });

    it('detects high-entropy random secrets while preserving allowlisted SAP tables', () => {
      const tenant = 'c1111111-1111-1111-1111-111111111111';
      // High entropy random string
      const highEntropy = 'API_TOKEN = 4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e5f6a7b8c';
      const res = redactor.redact(highEntropy, tenant);
      expect(res.sanitizedText).not.toContain('4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e5f6a7b8c');

      // Allowlist verification: SAP standard tables & ABAP keywords remain intact
      const abapCode = 'SELECT * FROM MARA INTO TABLE @DATA(lt_mara) WHERE matnr = :uuid_val.';
      const resAllowlist = redactor.redact(abapCode, tenant);
      expect(resAllowlist.sanitizedText).toContain('MARA');
      expect(resAllowlist.sanitizedText).toContain('SELECT');
      expect(resAllowlist.redactionsCount).toBe(0);
    });
  });

  describe('2. Preflight Report Export Engine Deliverables', () => {
    const mockDb: any = { query: async () => ({ rows: [] }) };
    const mockStorage: any = {
      putReportObject: async () => {},
      createDownloadPresignedUrl: async () => ({ downloadUrl: 'http://minio/report.pdf', expiresInSeconds: 1800 }),
    };
    const exportService = new ExportService(mockDb, mockStorage);

    it('generates RFC-4180 CSV export with UTF-8 BOM and correct column headers', () => {
      const mockFindings = [
        {
          id: 'find-1',
          engine: 'CLEAN_CORE',
          rule_id: 'CC_DIRECT_DB',
          severity: 'BLOCKER',
          title: 'Direct Database Access to MARA',
          remediation: 'Use released CDS view I_Product',
          confidence_class: 'VERIFIED',
          confidence_score: 1.0,
        },
      ];

      const csv = exportService.generateCsvReport(mockFindings);
      // Starts with UTF-8 BOM \uFEFF for seamless opening in Excel on Windows
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('Finding ID,Engine,Rule ID,Severity,Title,Remediation,Confidence Class,Confidence Score');
      expect(csv).toContain('find-1,CLEAN_CORE,CC_DIRECT_DB,BLOCKER');
    });

    it('generates Machine-Readable JSON Reproducibility Bundle with DAG topology', () => {
      const analysis = {
        id: 'ana-1',
        project_name: 'SAP Retail Migration',
        project_id: 'proj-1',
        organization_id: 'org-1',
        target_release: 'S4H_2023',
      };
      const findings = [
        {
          id: 'find-1',
          rule_id: 'OPD_001',
          severity: 'BLOCKER',
        },
      ];
      const evidence = [
        {
          id: 'evi-1',
          finding_id: 'find-1',
          artifact_path: 'rules.xml',
          sha256: 'a'.repeat(64),
        },
      ];

      const bundle: any = exportService.generateJsonBundle(analysis, findings, evidence);
      expect(bundle.$schema).toBe('https://erppreflight.com/schemas/v1/reproducibility-bundle.json');
      expect(bundle.bundle_id).toBeDefined();
      expect(bundle.summary.total_findings).toBe(1);
      expect(bundle.summary.blocker_count).toBe(1);
      expect(bundle.graph.nodes.length).toBeGreaterThanOrEqual(3);
      expect(bundle.graph.edges.length).toBeGreaterThanOrEqual(1);
      expect(bundle.evidence_hashes[0].sha256).toBe('a'.repeat(64));
    });
  });
});
