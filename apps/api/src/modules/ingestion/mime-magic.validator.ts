import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import * as crypto from 'node:crypto';

export interface MimeValidationResult {
  isValid: boolean;
  detectedFormat: string;
  detectedMime: string;
  sha256: string;
}

@Injectable()
export class MimeMagicValidator {
  /**
   * Validates a buffer chunk against declared filename extension.
   */
  public validate(filename: string, buffer: Buffer): MimeValidationResult {
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
    let formatResult: { detectedFormat: string; detectedMime: string };

    switch (ext) {
      case 'zip':
        formatResult = this.validateZip(buffer);
        break;
      case 'xml':
      case 'wsdl':
      case 'edmx':
      case 'xsd':
        formatResult = this.validateXml(buffer, ext);
        break;
      case 'xdp':
        formatResult = this.validateXdp(buffer);
        break;
      case 'json':
        formatResult = this.validateJson(buffer);
        break;
      case 'csv':
        formatResult = this.validateCsv(buffer);
        break;
      case 'abap':
      case 'txt':
      case 'prog':
      case 'incl':
        formatResult = this.validateAbapText(buffer, ext);
        break;
      case 'pdf':
        formatResult = this.validatePdf(buffer);
        break;
      default:
        throw new UnprocessableEntityException({
          code: `UNSUPPORTED_EXTENSION_${ext.toUpperCase()}`,
          message: `File extension '.${ext}' is not supported by the ingestion pipeline.`,
        });
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    return {
      isValid: true,
      detectedFormat: formatResult.detectedFormat,
      detectedMime: formatResult.detectedMime,
      sha256,
    };
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
      if (
        (b0 === 0xfe && b1 === 0xed && b2 === 0xfa && (b3 === 0xce || b3 === 0xcf)) ||
        (b0 === 0xce && b1 === 0xfa && b2 === 0xed && b3 === 0xfe) ||
        (b0 === 0xcf && b1 === 0xfa && b2 === 0xed && b3 === 0xfe)
      ) {
        throw new UnprocessableEntityException({
          code: 'SPOOFED_FILE_EXTENSION',
          message: `Spoofed file: Declared as .${declaredExt} but contains Mach-O binary header.`,
        });
      }
    }
    // Java Class check: CA FE BA BE
    if (buf.length >= 4 && buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe) {
      throw new UnprocessableEntityException({
        code: 'SPOOFED_FILE_EXTENSION',
        message: `Spoofed file: Declared as .${declaredExt} but contains Java class bytecode.`,
      });
    }
  }

  private validateZip(buf: Buffer): { detectedFormat: string; detectedMime: string } {
    if (buf.length < 4) {
      throw new UnprocessableEntityException({
        code: 'INVALID_ZIP_MAGIC_BYTES',
        message: 'File too small for ZIP.',
      });
    }
    const isLocalHeader = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    const isEmptyEocd = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x05 && buf[3] === 0x06;

    if (!isLocalHeader && !isEmptyEocd) {
      throw new UnprocessableEntityException({
        code: 'INVALID_ZIP_MAGIC_BYTES',
        message: 'File does not contain valid ZIP PK magic bytes.',
      });
    }

    return { detectedFormat: 'ZIP', detectedMime: 'application/zip' };
  }

  private validateXml(buf: Buffer, ext: string): { detectedFormat: string; detectedMime: string } {
    const text = buf.toString('utf-8').trimStart();
    if (!text.startsWith('<?xml') && !text.startsWith('<')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_XML_HEADER',
        message: 'File does not start with XML header or opening root element.',
      });
    }

    // Security check: XXE / DTD expansion constructs
    if (
      text.includes('<!ENTITY') ||
      (text.includes('<!DOCTYPE') && (text.includes('SYSTEM') || text.includes('PUBLIC')))
    ) {
      throw new UnprocessableEntityException({
        code: 'SECURITY_XXE_DETECTED',
        message: 'XML contains forbidden <!ENTITY or external <!DOCTYPE DTD definition.',
      });
    }

    return { detectedFormat: ext.toUpperCase(), detectedMime: 'application/xml' };
  }

  private validateXdp(buf: Buffer): { detectedFormat: string; detectedMime: string } {
    const text = buf.toString('utf-8');
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<xdp:package') && !trimmed.startsWith('<package') && !trimmed.startsWith('<xdp:xdp')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_XDP_FORMAT',
        message: 'File does not start with valid Adobe XDP package opening tag.',
      });
    }

    if (
      !text.includes('xmlns:xdp="http://ns.adobe.com/xdp/"') &&
      !text.includes('<xdp:package') &&
      !text.includes('<xdp:xdp')
    ) {
      throw new UnprocessableEntityException({
        code: 'INVALID_XDP_FORMAT',
        message: 'File lacks required Adobe XDP namespace declaration (http://ns.adobe.com/xdp/).',
      });
    }

    return { detectedFormat: 'XDP', detectedMime: 'application/vnd.adobe.xdp+xml' };
  }

  private validateJson(buf: Buffer): { detectedFormat: string; detectedMime: string } {
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

    return { detectedFormat: 'JSON', detectedMime: 'application/json' };
  }

  private validateCsv(buf: Buffer): { detectedFormat: string; detectedMime: string } {
    if (buf.includes(0x00)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CSV_STRUCTURE',
        message: 'CSV file contains illegal binary null bytes.',
      });
    }

    const text = buf.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CSV_STRUCTURE',
        message: 'CSV file is empty.',
      });
    }

    return { detectedFormat: 'CSV', detectedMime: 'text/csv' };
  }

  private validateAbapText(buf: Buffer, ext: string): { detectedFormat: string; detectedMime: string } {
    if (buf.includes(0x00)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_ABAP_ENCODING',
        message: 'ABAP source file contains illegal binary null bytes.',
      });
    }

    return { detectedFormat: ext.toUpperCase(), detectedMime: 'text/x-abap' };
  }

  private validatePdf(buf: Buffer): { detectedFormat: string; detectedMime: string } {
    if (buf.length < 5) {
      throw new UnprocessableEntityException({
        code: 'INVALID_PDF_HEADER',
        message: 'File too small for PDF.',
      });
    }
    const header = buf.subarray(0, Math.min(buf.length, 1024)).toString('ascii');
    if (!header.includes('%PDF-')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_PDF_HEADER',
        message: 'File does not contain valid %PDF- magic byte header.',
      });
    }

    return { detectedFormat: 'PDF', detectedMime: 'application/pdf' };
  }
}
