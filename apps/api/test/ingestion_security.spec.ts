import { describe, it, expect } from 'vitest';
import * as net from 'node:net';
import { MimeMagicValidator } from '../src/modules/ingestion/mime-magic.validator';
import { ArchiveSafetyGuard } from '../src/modules/ingestion/archive-safety.guard';
import { ClamAvScanner, normalizeClamdReply } from '../src/modules/ingestion/clamav.scanner';
import {
  S3StorageService,
  buildCleanKey,
  buildQuarantineKey,
} from '../src/modules/storage/s3-storage.service';
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
    it('passes clean business files in mock mode', async () => {
      const cleanBuf = Buffer.from('CUSTOMER_ID,REVENUE\nC100,500000\n');
      const res = await clamAvScanner.scanBuffer(cleanBuf);
      expect(res.isInfected).toBe(false);
    });

    it('detects EICAR standard test virus signature and quarantines in mock mode', async () => {
      const eicarBuf = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
      const res = await clamAvScanner.scanBuffer(eicarBuf);
      expect(res.isInfected).toBe(true);
      expect(res.virusName).toBe('Eicar-Test-Signature');
    });

    it('fails closed when CLAMAV_MOCK_MODE=false on unreachable socket / connection refused', async () => {
      const prodConfig = new ConfigService({
        CLAMAV_MOCK_MODE: 'false',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: 39999, // Unused port
      });
      const prodScanner = new ClamAvScanner(prodConfig);
      const buf = Buffer.from('CUSTOMER_ID,REVENUE\nC100,500000\n');
      const res = await prodScanner.scanBuffer(buf);
      expect(res.isInfected).toBe(true);
      expect(res.virusName).toBe('SCAN_FAILED_CONNECTION_ERROR');
    });

    it('fails closed on socket timeout with CLAMAV_MOCK_MODE=false', async () => {
      const server = net.createServer(() => {
        // Deliberately keep connection open without sending response
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as net.AddressInfo;

      try {
        const prodConfig = new ConfigService({
          CLAMAV_MOCK_MODE: 'false',
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: address.port,
          CLAMAV_TIMEOUT_MS: 50,
        });
        const prodScanner = new ClamAvScanner(prodConfig);
        const buf = Buffer.from('CUSTOMER_ID,REVENUE\nC100,500000\n');
        const res = await prodScanner.scanBuffer(buf);
        expect(res.isInfected).toBe(true);
        expect(res.virusName).toBe('SCAN_FAILED_TIMEOUT');
      } finally {
        server.close();
      }
    });

    it('fails closed on unexpected response string with CLAMAV_MOCK_MODE=false', async () => {
      const server = net.createServer((socket) => {
        socket.on('data', () => {
          socket.write('ERROR: COMMAND_UNRECOGNIZED\n');
          socket.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as net.AddressInfo;

      try {
        const prodConfig = new ConfigService({
          CLAMAV_MOCK_MODE: 'false',
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: address.port,
        });
        const prodScanner = new ClamAvScanner(prodConfig);
        const buf = Buffer.from('CUSTOMER_ID,REVENUE\nC100,500000\n');
        const res = await prodScanner.scanBuffer(buf);
        expect(res.isInfected).toBe(true);
        expect(res.virusName).toBe('SCAN_FAILED_UNRECOGNIZED_RESPONSE');
      } finally {
        server.close();
      }
    });

    it('correctly passes clean file when daemon responds stream: OK with CLAMAV_MOCK_MODE=false', async () => {
      const server = net.createServer((socket) => {
        socket.on('data', () => {
          socket.write('stream: OK\n');
          socket.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as net.AddressInfo;

      try {
        const prodConfig = new ConfigService({
          CLAMAV_MOCK_MODE: 'false',
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: address.port,
        });
        const prodScanner = new ClamAvScanner(prodConfig);
        const buf = Buffer.from('CUSTOMER_ID,REVENUE\nC100,500000\n');
        const res = await prodScanner.scanBuffer(buf);
        expect(res.isInfected).toBe(false);
      } finally {
        server.close();
      }
    });

    it('passes clean file when daemon replies with NUL-terminated zINSTREAM response "stream: OK\\0"', async () => {
      const server = net.createServer((socket) => {
        socket.on('data', () => {
          socket.write('stream: OK\0');
          socket.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as net.AddressInfo;

      try {
        const prodScanner = new ClamAvScanner(
          new ConfigService({ CLAMAV_MOCK_MODE: 'false', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: address.port })
        );
        const res = await prodScanner.scanBuffer(Buffer.from('<root/>'));
        expect(res.isInfected).toBe(false);
        expect(res.virusName).toBeUndefined();
      } finally {
        server.close();
      }
    });

    it('extracts virus name from NUL-terminated "stream: <sig> FOUND\\0" reply', async () => {
      const server = net.createServer((socket) => {
        socket.on('data', () => {
          socket.write('stream: Eicar-Test-Signature FOUND\0');
          socket.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as net.AddressInfo;

      try {
        const prodScanner = new ClamAvScanner(
          new ConfigService({ CLAMAV_MOCK_MODE: 'false', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: address.port })
        );
        const res = await prodScanner.scanBuffer(Buffer.from('payload'));
        expect(res.isInfected).toBe(true);
        expect(res.virusName).toBe('Eicar-Test-Signature');
      } finally {
        server.close();
      }
    });

    it('normalizeClamdReply strips NUL terminators and whitespace', () => {
      expect(normalizeClamdReply('stream: OK\0')).toBe('stream: OK');
      expect(normalizeClamdReply('stream: OK\n\0')).toBe('stream: OK');
      expect(normalizeClamdReply('\0stream: X FOUND\0\0')).toBe('stream: X FOUND');
    });

    it('correctly identifies virus when daemon responds stream: <virus> FOUND with CLAMAV_MOCK_MODE=false', async () => {
      const server = net.createServer((socket) => {
        socket.on('data', () => {
          socket.write('stream: Win.Trojan.Custom-42 FOUND\n');
          socket.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as net.AddressInfo;

      try {
        const prodConfig = new ConfigService({
          CLAMAV_MOCK_MODE: 'false',
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: address.port,
        });
        const prodScanner = new ClamAvScanner(prodConfig);
        const buf = Buffer.from('MALICIOUS_DATA');
        const res = await prodScanner.scanBuffer(buf);
        expect(res.isInfected).toBe(true);
        expect(res.virusName).toBe('Win.Trojan.Custom-42');
      } finally {
        server.close();
      }
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
      expect(res.storagePath).toBe(
        'tenants/c1234567-89ab-cdef-0123-456789abcdef/projects/b1234567-89ab-cdef-0123-456789abcdef/quarantine/a1234567-89ab-cdef-0123-456789abcdef/sap_transport.zip'
      );
      expect(res.expiresInSeconds).toBe(900);
    });

    it('generates pre-signed GET download URL targeting clean bucket with 900s (15 min) default TTL', async () => {
      const res = await storageService.createDownloadPresignedUrl({
        bucketType: 'clean',
        storagePath: 'tenants/c1234567-89ab-cdef-0123-456789abcdef/projects/p1/f1/clean.xml',
        downloadFileName: 'clean.xml',
      });
      expect(res.downloadUrl).toBeDefined();
      expect(res.downloadUrl).toContain('erppreflight-clean');
      expect(res.expiresInSeconds).toBe(900);
    });

    it('clamps any requested pre-signed TTL above 900 seconds down to 900', async () => {
      const download = await storageService.createDownloadPresignedUrl({
        bucketType: 'reports',
        storagePath: 'tenants/t1/projects/p1/reports/a1/r1_report.json',
        ttlSeconds: 3600,
      });
      expect(download.expiresInSeconds).toBe(900);
      expect(download.downloadUrl).toContain('X-Amz-Expires=900');

      const upload = await storageService.createUploadPresignedUrl({
        organizationId: 't1',
        projectId: 'p1',
        fileId: 'f1',
        fileName: 'x.xml',
        mimeType: 'application/xml',
        ttlSeconds: 1800,
      });
      expect(upload.expiresInSeconds).toBe(900);
      expect(S3StorageService.clampTtl(60)).toBe(60);
      expect(S3StorageService.clampTtl(undefined)).toBe(900);
    });

    it('builds tenant-scoped quarantine and clean object keys and neutralises path traversal in names', () => {
      expect(buildQuarantineKey('org', 'proj', 'file', '../../etc/passwd')).toBe(
        'tenants/org/projects/proj/quarantine/file/passwd'
      );
      expect(buildCleanKey('org', 'proj', 'file', 'my report (v2).xml')).toBe(
        'tenants/org/projects/proj/file/my_report__v2_.xml'
      );
      expect(buildCleanKey('org', 'proj', 'file', '..hidden')).toBe('tenants/org/projects/proj/file/_hidden');
    });
  });
});
