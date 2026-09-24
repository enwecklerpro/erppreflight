import { describe, it, expect } from 'vitest';
import { MimeMagicValidator } from '../src/modules/ingestion/mime-magic.validator';
import { ArchiveSafetyGuard } from '../src/modules/ingestion/archive-safety.guard';
import { ClamAvScanner } from '../src/modules/ingestion/clamav.scanner';
import { S3StorageService } from '../src/modules/storage/s3-storage.service';
import { ConfigService } from '@nestjs/config';
import { UnprocessableEntityException, BadRequestException, PayloadTooLargeException } from '@nestjs/common';

describe('M2 Ingestion Security & Storage Suite', () => {
  const mimeValidator = new MimeMagicValidator();
  const config = new ConfigService({
    CLAMAV_MOCK_MODE: true,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET_QUARANTINE: 'erppreflight-quarantine',
    S3_BUCKET_CLEAN: 'erppreflight-clean',
    S3_BUCKET_REPORTS: 'erppreflight-reports',
  });
  const clamAvScanner = new ClamAvScanner(config);
  const storageService = new S3StorageService(config);

  describe('1. MIME Magic-Byte Validation & Spoofing Defense', () => {
    it('accepts valid XML header', () => {
      const xmlBuf = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><root><item>1</item></root>');
      const res = mimeValidator.validate('data.xml', xmlBuf);
      expect(res.isValid).toBe(true);
      expect(res.detectedFormat).toBe('XML');
    });

    it('rejects XXE injection with external SYSTEM entity', () => {
      const xxeBuf = Buffer.from('<?xml version="1.0"?><!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>');
      expect(() => mimeValidator.validate('evil.xml', xxeBuf)).toThrow(UnprocessableEntityException);
      try {
        mimeValidator.validate('evil.xml', xxeBuf);
      } catch (err: any) {
        expect(err.response.code).toBe('SECURITY_XXE_DETECTED');
      }
    });

    it('accepts valid JSON payload', () => {
      const jsonBuf = Buffer.from('{"system": "S4H", "release": "2023"}');
      const res = mimeValidator.validate('config.json', jsonBuf);
      expect(res.isValid).toBe(true);
      expect(res.detectedFormat).toBe('JSON');
    });

    it('rejects malformed JSON syntax', () => {
      const corruptJson = Buffer.from('{ unquoted_key: 123 ');
      expect(() => mimeValidator.validate('bad.json', corruptJson)).toThrow(UnprocessableEntityException);
      try {
        mimeValidator.validate('bad.json', corruptJson);
      } catch (err: any) {
        expect(err.response.code).toBe('INVALID_JSON_SYNTAX');
      }
    });

    it('accepts valid CSV and rejects CSV with illegal null bytes', () => {
      const validCsv = Buffer.from('COL1,COL2,COL3\nA,B,C\n1,2,3\n');
      const res = mimeValidator.validate('table.csv', validCsv);
      expect(res.isValid).toBe(true);
      expect(res.detectedFormat).toBe('CSV');

      const nullByteCsv = Buffer.from('COL1,COL2\x00,COL3\n');
      expect(() => mimeValidator.validate('corrupt.csv', nullByteCsv)).toThrow(UnprocessableEntityException);
      try {
        mimeValidator.validate('corrupt.csv', nullByteCsv);
      } catch (err: any) {
        expect(err.response.code).toBe('INVALID_CSV_STRUCTURE');
      }
    });

    it('rejects spoofed Windows PE executable (.exe renamed to .csv)', () => {
      const peHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]); // MZ header
      expect(() => mimeValidator.validate('sap_export.csv', peHeader)).toThrow(UnprocessableEntityException);
      try {
        mimeValidator.validate('sap_export.csv', peHeader);
      } catch (err: any) {
        expect(err.response.code).toBe('SPOOFED_FILE_EXTENSION');
      }
    });

    it('rejects spoofed Linux ELF binary (.elf renamed to .abap)', () => {
      const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]); // \x7fELF
      expect(() => mimeValidator.validate('zreport.abap', elfHeader)).toThrow(UnprocessableEntityException);
      try {
        mimeValidator.validate('zreport.abap', elfHeader);
      } catch (err: any) {
        expect(err.response.code).toBe('SPOOFED_FILE_EXTENSION');
      }
    });

    it('accepts valid ZIP and rejects invalid ZIP header', () => {
      const validZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // PK\x03\x04
      const res = mimeValidator.validate('archive.zip', validZip);
      expect(res.isValid).toBe(true);
      expect(res.detectedFormat).toBe('ZIP');

      const corruptZip = Buffer.from([0x50, 0x4b, 0xff, 0xff]);
      expect(() => mimeValidator.validate('bad.zip', corruptZip)).toThrow(UnprocessableEntityException);
    });
  });

  describe('2. Archive Safety & Zip Bomb / Slip Defense', () => {
    it('detects and blocks Unix Zip Slip directory traversal (../../etc/passwd)', () => {
      const maliciousEntries = [
        { path: 'valid_folder/file1.txt', compressedSize: 100, uncompressedSize: 200 },
        { path: '../../../../etc/shadow', compressedSize: 100, uncompressedSize: 200 },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(maliciousEntries)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(maliciousEntries);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_SLIP_PATH_TRAVERSAL_DETECTED');
      }
    });

    it('detects and blocks Windows backslash traversal (..\\..\\windows\\system32)', () => {
      const maliciousEntries = [
        { path: '..\\..\\windows\\system32\\calc.exe', compressedSize: 100, uncompressedSize: 200 },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(maliciousEntries)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(maliciousEntries);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_SLIP_PATH_TRAVERSAL_DETECTED');
      }
    });

    it('detects and blocks Zip Bomb exceeding 500 MB uncompressed limit', () => {
      const bombEntries = [
        { path: 'bomb.dat', compressedSize: 1000, uncompressedSize: 600 * 1024 * 1024 }, // 600 MB
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(bombEntries)).toThrow(PayloadTooLargeException);
    });

    it('detects and blocks Zip Bomb with extreme compression ratio (> 100:1 when > 10MB)', () => {
      const highRatioEntries = [
        { path: 'sparse.bin', compressedSize: 50 * 1024, uncompressedSize: 20 * 1024 * 1024 }, // 400:1 ratio, 20MB
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(highRatioEntries)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(highRatioEntries);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_BOMB_COMPRESSION_RATIO_EXCEEDED');
      }
    });

    it('detects and blocks archive with more than 10,000 files', () => {
      const manyFiles = Array.from({ length: 10001 }, (_, i) => ({
        path: `file_${i}.txt`,
        compressedSize: 10,
        uncompressedSize: 10,
      }));
      expect(() => ArchiveSafetyGuard.checkEntries(manyFiles)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(manyFiles);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_BOMB_MAX_FILES_EXCEEDED');
      }
    });
  });

  describe('3. ClamAV Quarantine Antivirus Scanner', () => {
    it('passes clean business files', async () => {
      const cleanBuf = Buffer.from('CUSTOMER_ID,REVENUE\nC100,500000\n');
      const res = await clamAvScanner.scanBuffer(cleanBuf);
      expect(res.isInfected).toBe(false);
    });

    it('detects EICAR standard test virus signature and quarantines', async () => {
      const eicarBuf = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
      const res = await clamAvScanner.scanBuffer(eicarBuf);
      expect(res.isInfected).toBe(true);
      expect(res.virusName).toBe('Eicar-Test-Signature');
    });
  });

  describe('4. S3 Storage & Pre-signed URL Staging', () => {
    it('generates pre-signed PUT upload URL targeting quarantine bucket with 900s TTL', async () => {
      const res = await storageService.createUploadPresignedUrl({
        organizationId: 'c1234567-89ab-cdef-0123-456789abcdef',
        projectId: 'b1234567-89ab-cdef-0123-456789abcdef',
        fileId: 'a1234567-89ab-cdef-0123-456789abcdef',
        fileName: 'sap_transport.zip',
        mimeType: 'application/zip',
      });
      expect(res.uploadUrl).toBeDefined();
      expect(res.uploadUrl).toContain('erppreflight-quarantine');
      expect(res.storagePath).toContain('quarantine/c1234567-89ab-cdef-0123-456789abcdef');
      expect(res.expiresInSeconds).toBe(900);
    });

    it('generates pre-signed GET download URL targeting clean bucket with 1800s TTL', async () => {
      const res = await storageService.createDownloadPresignedUrl({
        bucketType: 'clean',
        storagePath: 'tenants/c1234567-89ab-cdef-0123-456789abcdef/projects/p1/f1/clean.xml',
        downloadFileName: 'clean.xml',
      });
      expect(res.downloadUrl).toBeDefined();
      expect(res.downloadUrl).toContain('erppreflight-clean');
      expect(res.expiresInSeconds).toBe(1800);
    });
  });
});
