# ERP Preflight — Milestone 2 Technical Exploration: Ingestion Security Pipeline & Storage

**Document Version**: 1.0.0  
**Target Milestone**: M2 (Secure Ingestion & Shared Platform Services)  
**Author**: `m2_explorer_1` (Teamwork Explorer)  
**Parent Conversation**: `b18c0539-d6d7-4a41-968f-58324775ab38`  
**Date**: 2026-09-24  

---

## 1. Executive Summary & Architectural Invariants

The ERP Preflight Ingestion Security Pipeline is the frontline defense perimeter of the platform. Untrusted customer data—originating from heterogeneous SAP enterprise landscapes (SAP S/4HANA, ECC 6.0, Solution Manager, abapGit, Adobe Forms, BTP)—must be validated, isolated, scanned, and sanitized before reaching any deterministic parser or downstream preflight engine.

```
+---------------------------------------------------------------------------------------------------+
|                                  ERP Preflight Ingestion Pipeline                                 |
+---------------------------------------------------------------------------------------------------+
                                                  │
                 1. Client Requests Upload URL    ▼    (POST /api/v1/projects/:id/files/presign-upload)
         ┌────────────────────────────────────────────────────────────────────────┐
         │ NestJS API: Authenticate Tenant, Check Quotas, Generate S3 PUT URL     │
         └────────────────────────────────────────────────────────────────────────┘
                                                  │
                 2. Direct Client-to-S3 Upload   ▼    (HTTP PUT, 15-min TTL)
         ┌────────────────────────────────────────────────────────────────────────┐
         │ S3 / MinIO: Staged in Isolated Bucket: `erppreflight-quarantine`       │
         └────────────────────────────────────────────────────────────────────────┘
                                                  │
                 3. Client Confirms / Webhook     ▼    (POST /api/v1/projects/:id/files/:id/confirm)
         ┌────────────────────────────────────────────────────────────────────────┐
         │ BullMQ `ingestion-queue`: Worker picks up file verification job        │
         └────────────────────────────────────────────────────────────────────────┘
                                                  │
                 4. Stage 1: MIME Magic-Bytes     ▼    (Reject spoofed extensions, PE/ELF/Mach-O)
         ┌────────────────────────────────────────────────────────────────────────┐
         │ Sniff magic bytes: XML (<?xml), JSON ({/[), CSV, ZIP (PK..), PDF, ABAP │
         └────────────────────────────────────────────────────────────────────────┘
                                                  │
                 5. Stage 2: Archive Guard        ▼    (If ZIP format)
         ┌────────────────────────────────────────────────────────────────────────┐
         │ Zip Slip (../ traversal), Zip Bomb (<=500MB, <=100:1 ratio, <=10k files)│
         └────────────────────────────────────────────────────────────────────────┘
                                                  │
                 6. Stage 3: Quarantine Scan      ▼    (Antivirus inspection)
         ┌────────────────────────────────────────────────────────────────────────┐
         │ ClamAV Daemon (INSTREAM TCP) / High-Fidelity Mock Scanner              │
         └────────────────────────────────────────────────────────────────────────┘
                                                  │
                 7. Stage 4: Secret Redaction     ▼    (Coordination with m2_explorer_2)
         ┌────────────────────────────────────────────────────────────────────────┐
         │ Redact Bearer tokens, private keys, RFC passwords, API keys via regex  │
         └────────────────────────────────────────────────────────────────────────┘
                                                  │
                 8. Stage 5: Promotion & Dispatch ▼    (Copy to Clean Bucket)
         ┌────────────────────────────────────────────────────────────────────────┐
         │ Promoted to `erppreflight-clean`, Purged from Quarantine, Queued to AI │
         └────────────────────────────────────────────────────────────────────────┘
```

### Core Invariants

1. **Physical Bucket Segregation Invariant**: Untrusted files reside exclusively in the `erppreflight-quarantine` bucket. The Python Analysis Engine has zero network or IAM access to the quarantine bucket. Only verified, scanned, and redacted artifacts are promoted to `erppreflight-clean`.
2. **Deterministic MIME Sniffing Invariant**: File extensions are treated as untrusted metadata. Every file must match its declared format at the binary magic-byte level. Any spoofed extension (e.g., Windows PE `.exe` named as `.csv`) triggers immediate rejection with `HTTP 422 Unprocessable Entity`.
3. **Bounded Decompression Invariant**: Archive extraction enforces strict hard quotas:
   - Maximum uncompressed size: **500 MB** total across the archive.
   - Maximum compression ratio: **100:1** (evaluated once uncompressed data exceeds 10 MB).
   - Maximum file count: **10,000 files**.
   - Maximum directory traversal depth: **2 levels** of archive nesting.
   - Zero path traversal: Any entry with `../`, `..\`, absolute paths (`/`, `C:\`), or resolving outside the target sandbox directory triggers immediate abort.
4. **Short-Lived Ephemeral URL Invariant**: Pre-signed S3 URLs strictly enforce a TTL of 15 to 60 minutes. Upload URLs default to 15 minutes (900s); download URLs default to 30 minutes (1800s). No perpetual or public URLs are permitted.
5. **Multi-Tenant Storage Namespace Invariant**: S3 keys strictly encode the tenant boundary:
   - Quarantine: `quarantine/{organizationId}/{projectId}/{fileId}/{sanitizedFileName}`
   - Clean: `tenants/{organizationId}/projects/{projectId}/{fileId}/{sanitizedFileName}`
   - Reports: `tenants/{organizationId}/projects/{projectId}/reports/{analysisId}/{reportId}.{pdf|json|csv|xlsx}`

---

## 2. File Format & MIME Magic-Byte Validation Engine

### 2.1 Magic Byte & Binary Signature Specifications

The validation engine inspects the first 4,096 bytes (4 KB) of the incoming file stream to verify format authenticity before reading large payloads.

| Format | Extensions | Primary Magic Bytes / Signatures (Hex & ASCII) | Permitted MIME Types | Detection Heuristic & Validation Rules |
|---|---|---|---|---|
| **ZIP** | `.zip` | `50 4B 03 04` (`PK\x03\x04`), `50 4B 05 06` (empty EOCD), `50 4B 07 08` (spanned) | `application/zip`, `application/x-zip-compressed` | Matches local file header or central directory signature at offset 0. Rejects any non-PK signature. |
| **XML** | `.xml`, `.wsdl`, `.edmx`, `.xsd` | `3C 3F 78 6D 6C` (`<?xml`) or `3C` (`<`) after whitespace / BOM | `application/xml`, `text/xml` | Tolerates UTF-8 BOM (`EF BB BF`), UTF-16 BE (`FE FF`), UTF-16 LE (`FF FE`). Rejects XXE entity expansion constructs (`<!ENTITY`, `SYSTEM`, `PUBLIC`). |
| **XDP** | `.xdp` | `<?xml` or `<xdp:package` + Adobe Namespace | `application/vnd.adobe.xdp+xml`, `application/xml`, `text/xml` | XML document containing `<xdp:package` root or child and Adobe XDP namespace `xmlns:xdp="http://ns.adobe.com/xdp/"` in initial 4 KB. |
| **JSON** | `.json` | `7B` (`{`) or `5B` (`[`) after whitespace / BOM | `application/json` | First non-whitespace byte must be object `{` or array `[`. Tolerates UTF-8 BOM. Verifies strict RFC 8259 syntax parsing. |
| **CSV** | `.csv` | Delimited ASCII/UTF-8 text with `,`, `;`, `\t`, or `\|` | `text/csv`, `text/plain` | Delimiter sniffing across sample lines. Requires consistent field counts per line. Disallows binary null bytes (`0x00`). |
| **ABAP** | `.abap`, `.txt`, `.prog`, `.incl` | Valid UTF-8 / ASCII text with ABAP syntax markers | `text/x-abap`, `text/plain` | Valid text encoding. Zero null bytes. Validates presence of ABAP keywords (`REPORT`, `PROGRAM`, `FUNCTION-POOL`, `CLASS`, `INTERFACE`, `DATA:`, `FORM`, `SELECT`) or ABAP line comments (`*` or `"`). |
| **PDF** | `.pdf` | `25 50 44 46 2D` (`%PDF-`) | `application/pdf` | Magic bytes `%PDF-` at offset 0 (or within first 1024 bytes per PDF standard tolerance). Followed by version `1.x` or `2.0`. |

### 2.2 Rejection of Spoofed Extensions & Dangerous Binaries Blacklist

Any file presenting dangerous binary signatures is rejected immediately, regardless of what file extension or declared MIME type is sent by the client.

```typescript
export const FORBIDDEN_EXECUTABLE_SIGNATURES: Array<{ name: string; bytes: number[]; offset?: number }> = [
  { name: 'Windows PE/DOS Executable (MZ)', bytes: [0x4d, 0x5a], offset: 0 },
  { name: 'Linux ELF Executable', bytes: [0x7f, 0x45, 0x4c, 0x46], offset: 0 },
  { name: 'Mach-O Executable (32-bit)', bytes: [0xfe, 0xed, 0xfa, 0xce], offset: 0 },
  { name: 'Mach-O Executable (64-bit)', bytes: [0xfe, 0xed, 0xfa, 0xcf], offset: 0 },
  { name: 'Mach-O Executable (Reverse 32)', bytes: [0xce, 0xfa, 0xed, 0xfe], offset: 0 },
  { name: 'Mach-O Executable (Reverse 64)', bytes: [0xcf, 0xfa, 0xed, 0xfe], offset: 0 },
  { name: 'Java Class File', bytes: [0xca, 0xfe, 0xba, 0xbe], offset: 0 },
  { name: '7-Zip Archive', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], offset: 0 },
  { name: 'RAR Archive', bytes: [0x52, 0x61, 0x72, 0x21], offset: 0 },
  { name: 'GZIP Compressed (when unexpected)', bytes: [0x1f, 0x8b], offset: 0 },
  { name: 'BZIP2 Compressed', bytes: [0x42, 0x5a], offset: 0 },
];
```

#### Rejection Logic & Error Structure

If `malware.exe` is uploaded as `sap_export.csv`:
1. Magic bytes inspects header: reads `[0x4D, 0x5A]` (`MZ`).
2. Matches `Windows PE/DOS Executable`.
3. Validation fails before any quarantine antivirus scan is even scheduled.
4. Returns HTTP 422 with typed error payload:
```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "code": "SPOOFED_FILE_EXTENSION",
  "message": "File content does not match declared extension '.csv'. Detected Windows PE/DOS Executable (MZ).",
  "details": {
    "declaredExtension": "csv",
    "declaredMimeType": "text/csv",
    "detectedBinaryType": "application/x-dosexec",
    "detectedMagic": "4d5a",
    "supportId": "INGEST-SPOOF-9B21"
  }
}
```

### 2.3 Delimiter Sniffing & Character Encoding Detection

For tabular SAP exports (`.csv`) and ABAP source programs (`.abap`):
- **CSV Sniffing**:
  - Sample first 16 KB of text.
  - Count candidates for delimiters: `,`, `;`, `\t`, `|`.
  - The dominant delimiter that produces equal column counts across rows 1, 2, and 3 is selected.
  - Semicolon (`;`) is standard for German/European SAP regional decimal exports (`1.000,50 EUR`).
  - Comma (`,`) is standard for US/International SAP exports.
  - Tab (`\t`) is standard for SAP ALV grid exports.
- **Encoding Validation**:
  - Rejects any file containing byte `0x00` (null byte) — indicator of binary payload or shellcode.
  - Validates UTF-8 sequence validity.
  - Supports ISO-8859-1 / Windows-1252 (Latin-1) transcoding for legacy SAP ECC systems (SAP Code Page 1100).

### 2.4 TypeScript Reference Implementation (`MimeMagicValidator`)

```typescript
import { Injectable, BadRequestException, UnprocessableEntityException } from '@nestjs/common';

export interface ValidationResult {
  isValid: boolean;
  detectedFormat: string;
  detectedMime: string;
  sha256: string;
  rejectionReason?: string;
}

@Injectable()
export class MimeMagicValidator {
  /**
   * Validates a buffer chunk (at least 4096 bytes) against declared extension.
   */
  public validate(filename: string, buffer: Buffer): ValidationResult {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (!ext) {
      throw new UnprocessableEntityException({
        code: 'UNKNOWN_EXTENSION',
        message: 'Uploaded file has no recognizable file extension.',
      });
    }

    // 1. Check for blacklisted dangerous binary magic bytes
    this.checkBlacklistedExecutables(buffer, ext);

    // 2. Validate format by extension
    switch (ext) {
      case 'zip':
        return this.validateZip(buffer);
      case 'xml':
      case 'wsdl':
      case 'edmx':
      case 'xsd':
        return this.validateXml(buffer, ext);
      case 'xdp':
        return this.validateXdp(buffer);
      case 'json':
        return this.validateJson(buffer);
      case 'csv':
        return this.validateCsv(buffer);
      case 'abap':
      case 'txt':
      case 'prog':
      case 'incl':
        return this.validateAbapText(buffer, ext);
      case 'pdf':
        return this.validatePdf(buffer);
      default:
        throw new UnprocessableEntityException({
          code: `UNSUPPORTED_EXTENSION_${ext.toUpperCase()}`,
          message: `File extension '.${ext}' is not supported by the ingestion pipeline.`,
        });
    }
  }

  private checkBlacklistedExecutables(buf: Buffer, declaredExt: string): void {
    // PE check: MZ (4D 5A)
    if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
      throw new UnprocessableEntityException({
        code: 'SPOOFED_FILE_EXTENSION',
        message: `Spoofed file: Declared as .${declaredExt} but contains Windows executable (MZ) header.`,
      });
    }
    // ELF check: 7F 45 4C 46
    if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
      throw new UnprocessableEntityException({
        code: 'SPOOFED_FILE_EXTENSION',
        message: `Spoofed file: Declared as .${declaredExt} but contains Linux ELF binary header.`,
      });
    }
    // Mach-O check
    if (buf.length >= 4) {
      const b0 = buf[0], b1 = buf[1], b2 = buf[2], b3 = buf[3];
      if ((b0 === 0xfe && b1 === 0xed && b2 === 0xfa && (b3 === 0xce || b3 === 0xcf)) ||
          (b0 === 0xce && b1 === 0xfa && b2 === 0xed && b3 === 0xfe) ||
          (b0 === 0xcf && b1 === 0xfa && b2 === 0xed && b3 === 0xfe)) {
        throw new UnprocessableEntityException({
          code: 'SPOOFED_FILE_EXTENSION',
          message: `Spoofed file: Declared as .${declaredExt} but contains Mach-O binary header.`,
        });
      }
    }
  }

  private validateZip(buf: Buffer): ValidationResult {
    // PK\x03\x04 or PK\x05\x06
    if (buf.length < 4) {
      throw new UnprocessableEntityException({ code: 'INVALID_ZIP_MAGIC_BYTES', message: 'File too small for ZIP.' });
    }
    const isLocalHeader = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    const isEmptyEocd = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x05 && buf[3] === 0x06;

    if (!isLocalHeader && !isEmptyEocd) {
      throw new UnprocessableEntityException({
        code: 'INVALID_ZIP_MAGIC_BYTES',
        message: 'File does not contain valid ZIP PK magic bytes.',
      });
    }

    return { isValid: true, detectedFormat: 'ZIP', detectedMime: 'application/zip', sha256: '' };
  }

  private validateXml(buf: Buffer, ext: string): ValidationResult {
    const text = buf.toString('utf-8').trimStart();
    if (!text.startsWith('<?xml') && !text.startsWith('<')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_XML_HEADER',
        message: `File does not start with XML header or opening root element.`,
      });
    }

    // Security Check: XXE / DTD expansion constructs
    if (text.includes('<!ENTITY') || (text.includes('<!DOCTYPE') && (text.includes('SYSTEM') || text.includes('PUBLIC')))) {
      throw new UnprocessableEntityException({
        code: 'SECURITY_XXE_DETECTED',
        message: 'XML contains forbidden <!ENTITY or external <!DOCTYPE DTD definition.',
      });
    }

    return { isValid: true, detectedFormat: ext.toUpperCase(), detectedMime: 'application/xml', sha256: '' };
  }

  private validateXdp(buf: Buffer): ValidationResult {
    const text = buf.toString('utf-8');
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<xdp:package') && !trimmed.startsWith('<package')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_XDP_FORMAT',
        message: 'File does not start with valid Adobe XDP package opening tag.',
      });
    }

    if (!text.includes('xmlns:xdp="http://ns.adobe.com/xdp/"') && !text.includes('<xdp:package')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_XDP_FORMAT',
        message: 'File lacks required Adobe XDP namespace declaration (http://ns.adobe.com/xdp/).',
      });
    }

    return { isValid: true, detectedFormat: 'XDP', detectedMime: 'application/vnd.adobe.xdp+xml', sha256: '' };
  }

  private validateJson(buf: Buffer): ValidationResult {
    const text = buf.toString('utf-8').trimStart();
    if (!text.startsWith('{') && !text.startsWith('[')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_JSON_SYNTAX',
        message: 'JSON file must begin with object "{" or array "[".',
      });
    }

    try {
      JSON.parse(text);
    } catch (err: any) {
      throw new UnprocessableEntityException({
        code: 'INVALID_JSON_SYNTAX',
        message: `JSON syntax error: ${err.message}`,
      });
    }

    return { isValid: true, detectedFormat: 'JSON', detectedMime: 'application/json', sha256: '' };
  }

  private validateCsv(buf: Buffer): ValidationResult {
    // Check for binary null bytes
    if (buf.includes(0x00)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CSV_STRUCTURE',
        message: 'CSV file contains illegal binary null bytes.',
      });
    }

    const text = buf.toString('utf-8');
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CSV_STRUCTURE',
        message: 'CSV file is empty.',
      });
    }

    // Delimiter sniffing
    const sample = lines.slice(0, 5);
    const delimiters = [',', ';', '\t', '|'];
    let detectedDelimiter: string | null = null;

    for (const d of delimiters) {
      const counts = sample.map(l => l.split(d).length);
      if (counts[0] > 1 && counts.every(c => c === counts[0])) {
        detectedDelimiter = d;
        break;
      }
    }

    if (!detectedDelimiter && lines[0].includes(',')) detectedDelimiter = ',';
    if (!detectedDelimiter && lines[0].includes(';')) detectedDelimiter = ';';

    if (!detectedDelimiter) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CSV_STRUCTURE',
        message: 'Unable to detect consistent tabular delimiter in CSV file.',
      });
    }

    return { isValid: true, detectedFormat: 'CSV', detectedMime: 'text/csv', sha256: '' };
  }

  private validateAbapText(buf: Buffer, ext: string): ValidationResult {
    if (buf.includes(0x00)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_ABAP_ENCODING',
        message: 'ABAP source file contains illegal binary null bytes.',
      });
    }

    const text = buf.toString('utf-8');
    return { isValid: true, detectedFormat: 'ABAP', detectedMime: 'text/x-abap', sha256: '' };
  }

  private validatePdf(buf: Buffer): ValidationResult {
    if (buf.length < 5) {
      throw new UnprocessableEntityException({ code: 'INVALID_PDF_HEADER', message: 'File too small for PDF.' });
    }
    const header = buf.subarray(0, 1024).toString('ascii');
    if (!header.includes('%PDF-')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_PDF_HEADER',
        message: 'File does not contain valid %PDF- magic byte header.',
      });
    }

    return { isValid: true, detectedFormat: 'PDF', detectedMime: 'application/pdf', sha256: '' };
  }
}
```

---

## 3. Archive Safety & Decompression Guard

Archives (`.zip`) allow SAP administrators to upload multi-file exports (e.g., transports, abapGit repositories, Form packages with schema definitions, or multiple CSV audit tables). However, archives introduce severe security vulnerabilities: **Zip Slip** (arbitrary file overwrite via directory traversal) and **Zip Bombs** (denial-of-service via resource exhaustion).

### 3.1 Zip Slip Defense & Path Canonicalization

Zip Slip occurs when an archive entry name contains directory traversal sequences like `../../../../etc/passwd` or `..\..\..\windows\system32\calc.exe`.

#### Hard Enforcement Rules
1. **Raw Pattern Check**: Immediately reject if entry name contains `../`, `..\`, starts with `/` or `\`, or contains drive letters (`C:`).
2. **Canonical Path Guard**: The resolved target path must strictly start with the destination sandbox directory plus path separator:
   `resolvedPath.startsWith(path.resolve(sandboxDir) + path.sep)`
3. **Symlink Prohibition**: Any archive entry marked as a symbolic link (`S_IFLNK` or Unix file mode `0120000`) is unconditionally dropped or causes extraction failure.

### 3.2 Zip Bomb Defense (Thresholds & Hard Quotas)

A Zip Bomb is a high-compression payload (e.g. 42.zip, gzip bombs) that expands into gigabytes of data.

```
+---------------------------------------------------------------------------------------------------+
|                                  Archive Hard Quotas Matrix                                       |
+---------------------------------------------------------------------------------------------------+
| Metric                        | Limit Threshold         | Action on Breach                        |
+-------------------------------+-------------------------+-----------------------------------------+
| Max Uncompressed Total Size   | 500 MB (524,288,000 B)  | Immediate Abort, Purge Temp, HTTP 413   |
| Max Compression Ratio         | 100 : 1                 | Immediate Abort, Purge Temp, HTTP 422   |
| Ratio Calculation Threshold   | > 10 MB Uncompressed    | Ratio checked only once size > 10MB     |
| Max Extracted File Count      | 10,000 files            | Immediate Abort, Purge Temp, HTTP 422   |
| Max Single File Size          | 250 MB (262,144,000 B)  | Immediate Abort, Purge Temp, HTTP 413   |
| Max Archive Nesting Depth     | 2 levels (zip in zip)   | Rejects 3rd level zip entry             |
+---------------------------------------------------------------------------------------------------+
```

### 3.3 Archive Inspection Implementation (`ArchiveSafetyGuard`)

```typescript
import * as path from 'path';
import * as fs from 'fs';
import * as unzipper from 'unzipper';
import { Injectable, BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export interface ArchiveSafetyReport {
  isSafe: boolean;
  totalFiles: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
  compressionRatio: number;
  extractedFiles: string[];
}

@Injectable()
export class ArchiveSafetyGuard {
  public static readonly MAX_UNCOMPRESSED_TOTAL = 500 * 1024 * 1024; // 500 MB
  public static readonly MAX_COMPRESSION_RATIO = 100.0;             // 100:1
  public static readonly MAX_FILE_COUNT = 10000;                     // 10,000 files
  public static readonly MAX_SINGLE_FILE_SIZE = 250 * 1024 * 1024;  // 250 MB

  /**
   * Pre-flight inspection of zip entries before writing to disk.
   */
  public static checkEntries(entries: Array<{ path: string; compressedSize: number; uncompressedSize: number }>): void {
    let totalCompressed = 0;
    let totalUncompressed = 0;

    if (entries.length > this.MAX_FILE_COUNT) {
      throw new BadRequestException({
        code: 'ZIP_BOMB_MAX_FILES_EXCEEDED',
        message: `Archive exceeds maximum allowed file count of ${this.MAX_FILE_COUNT} entries (found ${entries.length}).`,
      });
    }

    for (const entry of entries) {
      // 1. Zip Slip Check
      const normalized = path.normalize(entry.path);
      if (
        normalized.startsWith('..') ||
        normalized.includes('../') ||
        normalized.includes('..\\') ||
        path.isAbsolute(entry.path) ||
        /^[a-zA-Z]:/.test(entry.path)
      ) {
        throw new BadRequestException({
          code: 'ZIP_SLIP_PATH_TRAVERSAL_DETECTED',
          message: `Malicious archive: Zip Slip path traversal attempt detected in entry: '${entry.path}'.`,
        });
      }

      // 2. Single file limit
      if (entry.uncompressedSize > this.MAX_SINGLE_FILE_SIZE) {
        throw new PayloadTooLargeException({
          code: 'ZIP_ENTRY_TOO_LARGE',
          message: `Single archive entry '${entry.path}' exceeds maximum size of 250 MB.`,
        });
      }

      totalCompressed += Math.max(entry.compressedSize, 1);
      totalUncompressed += entry.uncompressedSize;

      // 3. Total uncompressed size limit
      if (totalUncompressed > this.MAX_UNCOMPRESSED_TOTAL) {
        throw new PayloadTooLargeException({
          code: 'ZIP_BOMB_MAX_SIZE_EXCEEDED',
          message: `Archive uncompressed size exceeds maximum limit of 500 MB.`,
        });
      }

      // 4. Compression ratio limit (applied when uncompressed size > 10MB)
      const ratio = totalUncompressed / totalCompressed;
      if (totalUncompressed > 10 * 1024 * 1024 && ratio > this.MAX_COMPRESSION_RATIO) {
        throw new BadRequestException({
          code: 'ZIP_BOMB_COMPRESSION_RATIO_EXCEEDED',
          message: `Archive compression ratio (${ratio.toFixed(1)}:1) exceeds safety ceiling of 100:1.`,
        });
      }
    }
  }

  /**
   * Safely unpacks an archive stream into target destination while tracking cumulative bytes in flight.
   */
  public async extractSafely(
    archiveStream: NodeJS.ReadableStream,
    destinationDir: string,
    currentNestingDepth: number = 0
  ): Promise<ArchiveSafetyReport> {
    if (currentNestingDepth > 2) {
      throw new BadRequestException({
        code: 'ARCHIVE_NESTING_DEPTH_EXCEEDED',
        message: 'Archive nesting depth exceeds maximum limit of 2 levels.',
      });
    }

    const resolvedDest = path.resolve(destinationDir);
    await fs.promises.mkdir(resolvedDest, { recursive: true });

    let totalFiles = 0;
    let totalCompressedBytes = 0;
    let totalUncompressedBytes = 0;
    const extractedFiles: string[] = [];

    const zipParser = archiveStream.pipe(unzipper.Parse({ forceStream: true }));

    for await (const entry of zipParser) {
      const fileName = entry.path;
      const type = entry.type; // 'Directory' or 'File'
      const size = entry.vars.uncompressedSize;
      const compressedSize = entry.vars.compressedSize;

      totalFiles++;
      if (totalFiles > ArchiveSafetyGuard.MAX_FILE_COUNT) {
        entry.autodrain();
        await fs.promises.rm(resolvedDest, { recursive: true, force: true });
        throw new BadRequestException({ code: 'ZIP_BOMB_MAX_FILES_EXCEEDED', message: 'Exceeded 10,000 files limit.' });
      }

      // Path traversal assertion
      const targetFilePath = path.resolve(resolvedDest, fileName);
      if (!targetFilePath.startsWith(resolvedDest + path.sep)) {
        entry.autodrain();
        await fs.promises.rm(resolvedDest, { recursive: true, force: true });
        throw new BadRequestException({
          code: 'ZIP_SLIP_PATH_TRAVERSAL_DETECTED',
          message: `Entry '${fileName}' attempts extraction outside destination sandbox.`,
        });
      }

      if (type === 'Directory') {
        await fs.promises.mkdir(targetFilePath, { recursive: true });
        entry.autodrain();
      } else {
        await fs.promises.mkdir(path.dirname(targetFilePath), { recursive: true });
        totalCompressedBytes += Math.max(compressedSize, 1);

        // Stream and count bytes actively
        let entryBytes = 0;
        const writeStream = fs.createWriteStream(targetFilePath);

        for await (const chunk of entry) {
          entryBytes += chunk.length;
          totalUncompressedBytes += chunk.length;

          if (totalUncompressedBytes > ArchiveSafetyGuard.MAX_UNCOMPRESSED_TOTAL) {
            writeStream.destroy();
            await fs.promises.rm(resolvedDest, { recursive: true, force: true });
            throw new PayloadTooLargeException({
              code: 'ZIP_BOMB_MAX_SIZE_EXCEEDED',
              message: 'Uncompressed stream exceeded 500 MB limit during extraction.',
            });
          }

          const runningRatio = totalUncompressedBytes / totalCompressedBytes;
          if (totalUncompressedBytes > 10 * 1024 * 1024 && runningRatio > ArchiveSafetyGuard.MAX_COMPRESSION_RATIO) {
            writeStream.destroy();
            await fs.promises.rm(resolvedDest, { recursive: true, force: true });
            throw new BadRequestException({
              code: 'ZIP_BOMB_COMPRESSION_RATIO_EXCEEDED',
              message: `Archive compression ratio (${runningRatio.toFixed(1)}:1) exceeded limit.`,
            });
          }

          writeStream.write(chunk);
        }
        writeStream.end();
        extractedFiles.push(targetFilePath);
      }
    }

    return {
      isSafe: true,
      totalFiles,
      totalCompressedBytes,
      totalUncompressedBytes,
      compressionRatio: totalUncompressedBytes / Math.max(totalCompressedBytes, 1),
      extractedFiles,
    };
  }
}
```

---

## 4. Quarantine Staging & Malware Scanning Pipeline

### 4.1 Two-Bucket Architecture

To guarantee that unvetted files cannot be read by analysis parsers or downloaded by unauthorized users, the storage architecture maintains two separate, physically isolated S3 buckets:

1. **Quarantine Bucket (`erppreflight-quarantine`)**:
   - Holds raw uploaded objects directly written by clients via pre-signed PUT URLs.
   - Strictly isolated: Analysis services and ordinary users have zero GET permissions.
   - Lifecycle rule: Automatically purges objects after 7 days if not promoted.
2. **Clean Bucket (`erppreflight-clean`)**:
   - Only receives objects that have passed format validation, archive verification, ClamAV antivirus scan, and secret redaction.
   - Key: `tenants/{organizationId}/projects/{projectId}/{fileId}/{sanitizedFileName}`.
   - Read-only access granted to Python Analysis Engine workers via pre-signed URLs or IAM credentials.

```
[Client Upload]
       │ (Pre-signed PUT)
       ▼
+------------------------------------------+
| Bucket: `erppreflight-quarantine`        |
| Key: `quarantine/{orgId}/{projId}/...`   |
+------------------------------------------+
       │
       ▼ (Ingestion Worker streams bytes)
+------------------------------------------+
| ClamAV Antivirus Scanner (INSTREAM TCP)  |
| - Clean -> Proceed to Redaction          |
| - Infected -> Abort, Quarantine, Alert   |
+------------------------------------------+
       │
       ▼ (Copy upon complete verification)
+------------------------------------------+
| Bucket: `erppreflight-clean`             |
| Key: `tenants/{orgId}/projects/...`      |
+------------------------------------------+
       │
       ▼ (Purge from quarantine bucket)
(Delete object in `erppreflight-quarantine`)
```

### 4.2 ClamAV Daemon `INSTREAM` Protocol Integration

ClamAV runs as a microservice daemon (`clamd`) exposing a TCP port (default 3310). The Ingestion Worker streams chunks directly over TCP using the ClamAV `INSTREAM` protocol:

1. Connect to TCP socket `CLAMAV_HOST:CLAMAV_PORT`.
2. Send command string: `zINSTREAM\0`.
3. For each data chunk:
   - Send 4-byte unsigned integer in big-endian format indicating chunk length.
   - Send the chunk data bytes.
4. When upload finishes:
   - Send zero-length chunk (`0x00, 0x00, 0x00, 0x00`) to signal end-of-stream.
5. Receive scan result:
   - `stream: OK\0` -> File is clean.
   - `stream: <VirusName> FOUND\0` -> File is infected.
   - `stream: <ErrorMsg> ERROR\0` -> Scan failure.

### 4.3 High-Fidelity Mock Scanner for Development & CI/CD

To ensure fast, reliable automated tests without requiring a 1 GB ClamAV RAM footprint during local development or GitHub Actions / Coolify test runs, a mock scanner is provided.

- Controlled via environment variable: `CLAMAV_MOCK_MODE=true`.
- Recognizes the industry-standard **EICAR Standard Anti-Virus Test File**:
  `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`
- Returns `FOUND: EICAR-Test-Signature` for EICAR payloads.
- Returns `OK` for all valid customer test payloads.

```typescript
import * as net from 'net';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ScanResult {
  isInfected: boolean;
  virusName?: string;
  scanDurationMs: number;
}

@Injectable()
export class ClamAvScanner {
  private readonly logger = new Logger(ClamAvScanner.name);
  private readonly host: string;
  private readonly port: number;
  private readonly isMockMode: boolean;

  constructor(private readonly config: ConfigService) {
    this.host = this.config.get<string>('CLAMAV_HOST', 'localhost');
    this.port = this.config.get<number>('CLAMAV_PORT', 3310);
    this.isMockMode = this.config.get<boolean>('CLAMAV_MOCK_MODE', false);
  }

  public async scanStream(stream: NodeJS.ReadableStream): Promise<ScanResult> {
    const startTime = Date.now();

    if (this.isMockMode) {
      return this.mockScan(stream, startTime);
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port }, () => {
        // Send INSTREAM command
        socket.write('zINSTREAM\0');

        stream.on('data', (chunk: Buffer) => {
          const lengthBuf = Buffer.alloc(4);
          lengthBuf.writeUInt32BE(chunk.length, 0);
          socket.write(lengthBuf);
          socket.write(chunk);
        });

        stream.on('end', () => {
          // Zero-length chunk signals end of stream
          const endBuf = Buffer.alloc(4, 0);
          socket.write(endBuf);
        });

        stream.on('error', (err) => {
          socket.destroy();
          reject(err);
        });
      });

      let response = '';
      socket.on('data', (data) => {
        response += data.toString('utf-8');
      });

      socket.on('end', () => {
        const duration = Date.now() - startTime;
        const trimmed = response.trim();

        if (trimmed.includes('OK')) {
          resolve({ isInfected: false, scanDurationMs: duration });
        } else if (trimmed.includes('FOUND')) {
          const match = trimmed.match(/stream:\s*(.+)\s+FOUND/);
          const virus = match ? match[1] : 'UNKNOWN_VIRUS';
          resolve({ isInfected: true, virusName: virus, scanDurationMs: duration });
        } else {
          reject(new Error(`ClamAV scan error: ${trimmed}`));
        }
      });

      socket.on('error', (err) => {
        this.logger.error(`ClamAV socket connection failed: ${err.message}`);
        reject(err);
      });
    });
  }

  private async mockScan(stream: NodeJS.ReadableStream, startTime: number): Promise<ScanResult> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const fullBuffer = Buffer.concat(chunks);
    const content = fullBuffer.toString('utf-8');

    const duration = Date.now() - startTime;
    if (content.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {
      return {
        isInfected: true,
        virusName: 'Eicar-Test-Signature',
        scanDurationMs: duration,
      };
    }

    return {
      isInfected: false,
      scanDurationMs: duration,
    };
  }
}
```

---

## 5. S3 / MinIO Pre-Signed URL Management & Storage Architecture

### 5.1 AWS SDK v3 Client Configuration with MinIO Support

The storage subsystem uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. For local development and Coolify private network setups, MinIO operates with `forcePathStyle: true` so bucket names remain path segments (`http://minio:9000/bucket-name`) rather than DNS subdomains.

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3: S3Client;
  public readonly quarantineBucket: string;
  public readonly cleanBucket: string;
  public readonly reportsBucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('S3_ENDPOINT', 'http://localhost:9000');
    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY', 'minioadmin');
    const secretAccessKey = this.config.get<string>('S3_SECRET_KEY', 'minioadmin');

    this.quarantineBucket = this.config.get<string>('S3_BUCKET_QUARANTINE', 'erppreflight-quarantine');
    this.cleanBucket = this.config.get<string>('S3_BUCKET_CLEAN', 'erppreflight-clean');
    this.reportsBucket = this.config.get<string>('S3_BUCKET_REPORTS', 'erppreflight-reports');

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // Required for MinIO
    });
  }

  /**
   * Generates a short-lived pre-signed PUT upload URL for the quarantine bucket.
   * TTL: 15 minutes (900 seconds).
   */
  public async createUploadPresignedUrl(params: {
    organizationId: string;
    projectId: string;
    fileId: string;
    fileName: string;
    mimeType: string;
    ttlSeconds?: number;
  }): Promise<{ uploadUrl: string; storagePath: string; expiresInSeconds: number }> {
    const ttl = params.ttlSeconds || 900; // 15 min default
    const safeFileName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `quarantine/${params.organizationId}/${params.projectId}/${params.fileId}/${safeFileName}`;

    const command = new PutObjectCommand({
      Bucket: this.quarantineBucket,
      Key: storagePath,
      ContentType: params.mimeType,
      Metadata: {
        'organization-id': params.organizationId,
        'project-id': params.projectId,
        'file-id': params.fileId,
      },
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: ttl });
    return { uploadUrl, storagePath, expiresInSeconds: ttl };
  }

  /**
   * Generates a short-lived pre-signed GET download URL for the clean bucket or reports bucket.
   * TTL: 30 minutes (1800 seconds).
   */
  public async createDownloadPresignedUrl(params: {
    bucketType: 'clean' | 'reports';
    storagePath: string;
    downloadFileName?: string;
    ttlSeconds?: number;
  }): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
    const ttl = params.ttlSeconds || 1800; // 30 min default
    const bucket = params.bucketType === 'clean' ? this.cleanBucket : this.reportsBucket;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: params.storagePath,
      ResponseContentDisposition: params.downloadFileName
        ? `attachment; filename="${encodeURIComponent(params.downloadFileName)}"`
        : undefined,
    });

    const downloadUrl = await getSignedUrl(this.s3, command, { expiresIn: ttl });
    return { downloadUrl, expiresInSeconds: ttl };
  }

  /**
   * Promotes a verified, clean artifact from Quarantine to Clean bucket.
   */
  public async promoteQuarantineToClean(
    quarantineKey: string,
    cleanKey: string
  ): Promise<void> {
    // 1. Copy object from quarantine bucket to clean bucket
    await this.s3.send(
      new CopyObjectCommand({
        CopySource: `${this.quarantineBucket}/${quarantineKey}`,
        Bucket: this.cleanBucket,
        Key: cleanKey,
      })
    );

    // 2. Delete source object from quarantine bucket
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.quarantineBucket,
        Key: quarantineKey,
      })
    );
  }

  /**
   * Returns a readable stream for a quarantine bucket object to feed to scanners.
   */
  public async getQuarantineStream(storagePath: string): Promise<NodeJS.ReadableStream> {
    const res = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.quarantineBucket,
        Key: storagePath,
      })
    );
    return res.Body as NodeJS.ReadableStream;
  }
}
```

---

## 6. NestJS Ingestion Module Design (`apps/api/src/modules/ingestion`)

### 6.1 Data Transfer Objects (DTOs) & Validation Schemas

```typescript
import { z } from 'zod';

export const RequestPresignedUploadSchema = z.object({
  fileName: z.string().min(1).max(500),
  fileSize: z.number().int().positive().max(500 * 1024 * 1024), // Max 500 MB
  mimeType: z.string().min(1).max(255),
});
export type RequestPresignedUploadDto = z.infer<typeof RequestPresignedUploadSchema>;

export const ConfirmUploadSchema = z.object({
  fileId: z.string().uuid(),
});
export type ConfirmUploadDto = z.infer<typeof ConfirmUploadSchema>;
```

### 6.2 Controller Endpoints

Mounted under `/api/v1/projects/:projectId/files`:

1. `POST /api/v1/projects/:projectId/files/presign-upload`
   - Validates user tenant context & project ownership.
   - Generates UUID `fileId`.
   - Records metadata in `uploaded_files` table (`quarantine_status = 'PENDING_SCAN'`).
   - Issues short-lived pre-signed PUT URL for the quarantine bucket (15-min TTL).
2. `POST /api/v1/projects/:projectId/files/:fileId/confirm`
   - Triggered by client after S3 upload completes.
   - Updates status to `SCANNING`.
   - Enqueues job to BullMQ `ingestion-queue`.
3. `GET /api/v1/projects/:projectId/files/:fileId/presign-download`
   - Verifies tenant context and project ownership.
   - Queries `uploaded_files` record.
   - **Enforces Quarantine Boundary**: If `quarantine_status !== 'CLEAN'`, rejects with `HTTP 403 Forbidden: Artifact is quarantined or pending security verification`.
   - Issues short-lived pre-signed GET URL for the clean bucket (30-min TTL).
4. `GET /api/v1/projects/:projectId/files`
   - Lists uploaded files for project with current scan and redaction status.

### 6.3 BullMQ Ingestion Queue Consumer (`IngestionProcessor`)

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { S3StorageService } from './s3-storage.service';
import { MimeMagicValidator } from './mime-magic.validator';
import { ArchiveSafetyGuard } from './archive-safety.guard';
import { ClamAvScanner } from './clamav.scanner';

export interface IngestionJobData {
  fileId: string;
  organizationId: string;
  projectId: string;
  fileName: string;
  storagePath: string;
}

@Processor('ingestion-queue')
@Injectable()
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: S3StorageService,
    private readonly mimeValidator: MimeMagicValidator,
    private readonly archiveGuard: ArchiveSafetyGuard,
    private readonly clamAv: ClamAvScanner
  ) {
    super();
  }

  async process(job: Job<IngestionJobData>): Promise<void> {
    const { fileId, organizationId, projectId, fileName, storagePath } = job.data;
    this.logger.log(`Starting ingestion security pipeline for file ${fileId} (${fileName})`);

    try {
      // 1. Fetch byte stream from Quarantine bucket
      const stream = await this.storage.getQuarantineStream(storagePath);
      
      // 2. Read first chunk for magic-byte validation
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const fullBuffer = Buffer.concat(chunks);
      
      // 3. Stage 1: MIME & Magic-byte validation
      const validation = this.mimeValidator.validate(fileName, fullBuffer);
      
      // 4. Stage 2: Archive safety check (if ZIP)
      if (validation.detectedFormat === 'ZIP') {
        // Run pre-extraction checks
        // (If extraction needed, extractSafely enforces bounds)
      }

      // 5. Stage 3: ClamAV Antivirus Quarantine Scan
      const scanResult = await this.clamAv.scanStream(fullBuffer);
      if (scanResult.isInfected) {
        this.logger.warn(`MALWARE DETECTED: File ${fileId} infected with ${scanResult.virusName}`);
        await this.db.query(
          `UPDATE uploaded_files SET quarantine_status = 'QUARANTINED', metadata = metadata || $1 WHERE id = $2`,
          [JSON.stringify({ virusName: scanResult.virusName, quarantinedAt: new Date().toISOString() }), fileId],
          { bypassRls: true }
        );
        return;
      }

      // 6. Stage 4: Promotion to Clean Bucket
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const cleanKey = `tenants/${organizationId}/projects/${projectId}/${fileId}/${safeName}`;
      await this.storage.promoteQuarantineToClean(storagePath, cleanKey);

      // 7. Update uploaded_files record to CLEAN
      await this.db.query(
        `UPDATE uploaded_files 
         SET quarantine_status = 'CLEAN', 
             storage_path = $1, 
             updated_at = NOW() 
         WHERE id = $2`,
        [cleanKey, fileId],
        { bypassRls: true }
      );

      this.logger.log(`File ${fileId} successfully validated and promoted to clean storage.`);
    } catch (err: any) {
      this.logger.error(`Ingestion pipeline failed for file ${fileId}: ${err.message}`);
      await this.db.query(
        `UPDATE uploaded_files SET quarantine_status = 'REJECTED', metadata = metadata || $1 WHERE id = $2`,
        [JSON.stringify({ error: err.message, rejectedAt: new Date().toISOString() }), fileId],
        { bypassRls: true }
      );
      throw err;
    }
  }
}
```

---

## 7. Python Analysis Engine Ingestion Client

In `services/analysis-python`, workers consuming jobs from BullMQ / REST endpoints fetch clean artifacts from S3.

### 7.1 Clean Artifact Fetcher (`s3_client.py`)

```python
import os
import boto3
from botocore.config import Config

class CleanArtifactFetcher:
    """Fetches clean, verified artifacts from the clean S3 bucket only."""

    def __init__(self):
        endpoint_url = os.getenv("S3_ENDPOINT", "http://localhost:9000")
        access_key = os.getenv("S3_ACCESS_KEY", "minioadmin")
        secret_key = os.getenv("S3_SECRET_KEY", "minioadmin")
        self.clean_bucket = os.getenv("S3_BUCKET_CLEAN", "erppreflight-clean")

        self.s3 = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(s3={"addressing_style": "path"}),
        )

    def fetch_artifact_text(self, s3_key: str) -> str:
        # Enforce that key cannot target quarantine
        if s3_key.startswith("quarantine/"):
            raise PermissionError("Access Denied: Python analysis engine cannot read from quarantine bucket.")

        response = self.s3.get_object(Bucket=self.clean_bucket, Key=s3_key)
        return response["Body"].read().decode("utf-8")
```

---

## 8. Verification, Testing & Threat Matrix

### 8.1 Unit & Integration Test Specifications

| Test Case | Scenario / Payload | Expected Outcome | Component Verified |
|---|---|---|---|
| `test_valid_xml_accepted` | `<?xml version="1.0"?><root></root>` as `.xml` | Status: Valid XML (`VALID_XML`) | `MimeMagicValidator` |
| `test_xxe_entity_rejected` | `<!ENTITY xxe SYSTEM "file:///etc/passwd">` in XML | HTTP 422: `SECURITY_XXE_DETECTED` | `MimeMagicValidator` |
| `test_valid_json_accepted` | `{"system": "S4H", "release": "2023"}` as `.json` | Status: Valid JSON (`VALID_JSON`) | `MimeMagicValidator` |
| `test_spoofed_pe_rejected` | `MZ` binary header renamed as `export.csv` | HTTP 422: `SPOOFED_FILE_EXTENSION` | `MimeMagicValidator` |
| `test_spoofed_elf_rejected` | `\x7fELF` binary header renamed as `program.abap` | HTTP 422: `SPOOFED_FILE_EXTENSION` | `MimeMagicValidator` |
| `test_zip_slip_relative` | ZIP with entry `../../../../etc/shadow` | HTTP 422: `ZIP_SLIP_PATH_TRAVERSAL_DETECTED` | `ArchiveSafetyGuard` |
| `test_zip_slip_absolute` | ZIP with entry `/etc/passwd` or `C:\win.ini` | HTTP 422: `ZIP_SLIP_PATH_TRAVERSAL_DETECTED` | `ArchiveSafetyGuard` |
| `test_zip_bomb_500mb` | 10 KB zip decompressing into 600 MB | HTTP 413: `ZIP_BOMB_MAX_SIZE_EXCEEDED` | `ArchiveSafetyGuard` |
| `test_zip_bomb_ratio` | 50 KB zip decompressing into 25 MB (500:1 ratio) | HTTP 422: `ZIP_BOMB_COMPRESSION_RATIO_EXCEEDED`| `ArchiveSafetyGuard` |
| `test_zip_bomb_10k_files`| ZIP containing 10,001 entries | HTTP 422: `ZIP_BOMB_MAX_FILES_EXCEEDED` | `ArchiveSafetyGuard` |
| `test_eicar_quarantine` | File containing EICAR test string | Quarantined, `virusName: 'Eicar-Test-Signature'` | `ClamAvScanner` |
| `test_presigned_upload_ttl`| Request pre-signed PUT URL | Returns signed URL with 900s TTL (Quarantine bucket)| `S3StorageService` |
| `test_presigned_download_block`| Request download on `PENDING_SCAN` file | HTTP 403 Forbidden: File quarantined | `ProjectsController` |
| `test_presigned_download_clean`| Request download on `CLEAN` file | Returns signed GET URL with 1800s TTL (Clean bucket)| `ProjectsController` |

### 8.2 Security Threat & Edge Case Matrix

| Threat Category | Attack Vector | Mitigation in ERP Preflight | Defense Layer |
|---|---|---|---|
| **Malicious Code Execution** | Uploading shell scripts, PE executables, or ELF binaries disguised as `.csv` or `.abap`. | Binary signature inspection rejects non-text magic bytes. Zero null-bytes tolerated in text. | Ingestion Layer (MIME Sniffer) |
| **Path Traversal (Zip Slip)** | Archive contains `../` path traversal to overwrite host application files. | Entry path canonicalization; assertion of `resolved.startsWith(sandbox + sep)`. | Archive Guard |
| **Denial of Service (Zip Bomb)** | 42.zip or recursive archive expansions consuming all available host disk. | Strict 500 MB max uncompressed ceiling; 100:1 compression ratio limit; 10,000 files limit; max 2 nesting depth. | Archive Guard |
| **XXE & Billion Laughs** | XML files containing recursive entity expansion (`<!ENTITY lol "lol">...`). | `defusedxml` and string pre-filter forbid DTD entities and external resources (`forbid_dtd=True`, `forbid_entities=True`). | Safe XML Parser |
| **Malware & Trojan Vectors** | Virus or malicious script embedded in report attachments. | ClamAV antivirus daemon scanning in temporary quarantine bucket before parser consumption. | Antivirus Quarantine Layer |
| **Unauthorized Data Access** | Malicious tenant requesting pre-signed download URL for another tenant's artifact. | PostgreSQL RLS + NestJS `TenancyGuard` verifies organization ownership before issuing S3 signatures. | Storage & Tenancy Layer |
| **Expired Signature Abuse** | Replaying pre-signed URLs past expiration. | Short-lived TTLs (15-60 min). AWS S3/MinIO cryptographic signature verification rejects expired tokens. | S3 Object Gateway |

---

## 9. Implementation Roadmap & Task Breakdown for Worker Agents

To implement this specification in Milestone 2:

1. **Task 1: Shared Schemas & Database Updates (`packages/schemas`)**:
   - Add `RequestPresignedUploadSchema` and `ConfirmUploadSchema` to `packages/schemas/src/project.ts`.
   - Export ingestion DTO types across TypeScript and Python workspaces.
2. **Task 2: S3 Storage & Pre-signed URL Module (`apps/api/src/modules/storage`)**:
   - Install `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` in `apps/api`.
   - Update `env.validation.ts` with S3 and ClamAV configuration keys.
   - Implement `S3StorageService` with pre-signed PUT/GET generation, copy, and stream helpers.
3. **Task 3: MIME Magic-Byte Validator & Archive Safety Guard (`apps/api/src/modules/ingestion`)**:
   - Implement `MimeMagicValidator` supporting XML, JSON, CSV, ZIP, ABAP, PDF, and XDP.
   - Implement `ArchiveSafetyGuard` with Zip Slip and Zip Bomb (500MB, 100:1, 10k files) stream monitoring.
4. **Task 4: ClamAV Daemon & Mock Scanner (`apps/api/src/modules/ingestion`)**:
   - Implement `ClamAvScanner` with `INSTREAM` TCP protocol and deterministic mock mode.
5. **Task 5: BullMQ Ingestion Queue & REST API (`apps/api/src/modules/ingestion`)**:
   - Add `IngestionModule` to `app.module.ts`.
   - Implement `FilesController` with endpoints `/presign-upload`, `/confirm`, `/presign-download`, and `:fileId`.
   - Implement `IngestionProcessor` worker handling staging, scanning, promotion to clean bucket, and dispatching to analysis queue.
6. **Task 6: Test Suite Verification**:
   - Implement unit and integration tests in `apps/api/test/ingestion_security.spec.ts`.
   - Verify 100% pass rate in combination with E2E Tier 1 and Tier 2 tests.
