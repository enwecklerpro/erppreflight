import { describe, it, expect } from 'vitest';
import { canonicalJsonSerialize, calculateSha256 } from '../../packages/evidence/src';
import { SecretRedactorService } from '../../apps/api/src/modules/redaction/secret-redactor.service';
import { MimeMagicValidator } from '../../apps/api/src/modules/ingestion/mime-magic.validator';
import { ArchiveSafetyGuard } from '../../apps/api/src/modules/ingestion/archive-safety.guard';
import { ExportService } from '../../apps/api/src/modules/export/export.service';

describe('Forensic Verification of Milestone 2 Algorithms', () => {
  it('verifies cross-language RFC 8785 canonical JSON', () => {
    const complexObj = {
      z_field: 123,
      a_field: 'hello',
      nested: {
        inner_b: [3, 2, 1],
        inner_a: true,
        nil: null,
      },
      numbers: [1.5, -10],
    };

    const tsSerialized = canonicalJsonSerialize(complexObj);
    expect(tsSerialized).toBe('{"a_field":"hello","nested":{"inner_a":true,"inner_b":[3,2,1],"nil":null},"numbers":[1.5,-10],"z_field":123}');
    const tsHash = calculateSha256(tsSerialized);
    expect(tsHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies genuine mathematical Shannon entropy formula', () => {
    const mockConfig: any = {
      get: (key: string, defVal: string) => defVal || 'test-master-key-32-chars-long-abc',
    };
    const redactor = new SecretRedactorService(mockConfig);

    const testCases = [
      { str: 'AAAA', expected: 0.0 },
      { str: 'ABAB', expected: 1.0 },
      { str: 'ABCD', expected: 2.0 },
      { str: 'ABCDEFGH', expected: 3.0 },
    ];

    for (const tc of testCases) {
      const computed = redactor.calculateEntropy(tc.str);
      expect(Math.abs(computed - tc.expected)).toBeLessThanOrEqual(1e-6);
    }
  });

  it('verifies MIME magic sniffing blocks executables and XXE', () => {
    const mime = new MimeMagicValidator();

    // Windows PE MZ header
    expect(() => mime.validate('report.csv', Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toThrow();
    // Linux ELF header
    expect(() => mime.validate('code.abap', Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).toThrow();
    // Java class bytecode CAFE BABE
    expect(() => mime.validate('input.xml', Buffer.from([0xca, 0xfe, 0xba, 0xbe]))).toThrow();
    // XXE SYSTEM entity
    const evilXml = '<?xml version="1.0"?><!DOCTYPE root SYSTEM "http://malicious.com/evil.dtd"><root></root>';
    expect(() => mime.validate('rules.xml', Buffer.from(evilXml))).toThrow();
  });

  it('verifies archive safety blocks Zip Slip and Zip Bomb', () => {
    // Zip Slip Unix
    expect(() => ArchiveSafetyGuard.checkEntries([
      { path: '../../../../etc/shadow', compressedSize: 100, uncompressedSize: 500 },
    ])).toThrow();

    // Zip Slip Windows
    expect(() => ArchiveSafetyGuard.checkEntries([
      { path: '..\\..\\windows\\system32\\cmd.exe', compressedSize: 100, uncompressedSize: 500 },
    ])).toThrow();

    // Zip Bomb ratio > 100:1 with >10MB
    expect(() => ArchiveSafetyGuard.checkEntries([
      { path: 'bomb.dat', compressedSize: 10 * 1024, uncompressedSize: 15 * 1024 * 1024 },
    ])).toThrow();

    // Zip Bomb total size > 500MB
    expect(() => ArchiveSafetyGuard.checkEntries([
      { path: 'huge.bin', compressedSize: 1000, uncompressedSize: 501 * 1024 * 1024 },
    ])).toThrow();
  });

  it('verifies export generators produce valid PDF, XLSX, and CSV binaries', async () => {
    const mockDb: any = { query: async () => ({ rows: [] }) };
    const mockStorage: any = {
      putReportObject: async () => {},
      createDownloadPresignedUrl: async () => ({ downloadUrl: 'http://s3/test', expiresInSeconds: 1800 }),
    };
    const exportService = new ExportService(mockDb, mockStorage);

    const sampleFindings = [
      {
        id: 'f1111111-1111-1111-1111-111111111111',
        engine: 'OPD_GUARD',
        rule_id: 'OPD_001',
        severity: 'BLOCKER',
        title: 'Missing BRFplus Output Condition',
        remediation: 'Configure output type in OPD',
        confidence_class: 'VERIFIED',
        confidence_score: 1.0,
      },
    ];

    // CSV
    const csvOutput = exportService.generateCsvReport(sampleFindings);
    expect(csvOutput.charCodeAt(0)).toBe(0xFEFF);
    expect(csvOutput).toContain('OPD_001');

    // JSON Bundle
    const bundle: any = exportService.generateJsonBundle(
      { id: 'ana-1', project_name: 'Audit Landscape', target_release: 'S4H_2023' },
      sampleFindings,
      []
    );
    expect(bundle.summary.blocker_count).toBe(1);

    // PDF
    const pdfBuffer: Buffer = await (exportService as any).generatePdfReport(
      { id: 'ana-1', project_name: 'Audit Landscape', target_release: 'S4H_2023' },
      sampleFindings,
      [],
      { format: 'PDF' }
    );
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    // XLSX
    const xlsxBuffer: Buffer = await (exportService as any).generateXlsxWorkbook(
      { id: 'ana-1', project_name: 'Audit Landscape', target_release: 'S4H_2023' },
      sampleFindings,
      []
    );
    expect(xlsxBuffer[0]).toBe(0x50);
    expect(xlsxBuffer[1]).toBe(0x4b);
    expect(xlsxBuffer[2]).toBe(0x03);
    expect(xlsxBuffer[3]).toBe(0x04);
    expect(xlsxBuffer.length).toBeGreaterThan(1000);
  });
});
