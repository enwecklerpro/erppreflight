import { Injectable, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as unzipper from 'unzipper';

export interface ArchiveSafetyReport {
  isSafe: boolean;
  totalFiles: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
  compressionRatio: number;
  extractedFiles: string[];
}

export interface ZipEntryMeta {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
}

@Injectable()
export class ArchiveSafetyGuard {
  public static readonly MAX_UNCOMPRESSED_TOTAL = 500 * 1024 * 1024; // 500 MB
  public static readonly MAX_COMPRESSION_RATIO = 100.0; // 100:1
  public static readonly MAX_FILE_COUNT = 10000; // 10,000 files
  public static readonly MAX_SINGLE_FILE_SIZE = 250 * 1024 * 1024; // 250 MB

  /**
   * Pre-flight inspection of zip entries before writing to disk.
   */
  public static checkEntries(entries: ZipEntryMeta[]): void {
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
      const entryPath = entry.path;
      const normalized = path.normalize(entryPath);
      if (
        normalized.startsWith('..') ||
        entryPath.includes('../') ||
        entryPath.includes('..\\') ||
        path.isAbsolute(entryPath) ||
        entryPath.startsWith('/') ||
        entryPath.startsWith('\\') ||
        /^[a-zA-Z]:/.test(entryPath)
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
          message: 'Archive uncompressed size exceeds maximum limit of 500 MB.',
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
   * Inspects a ZIP buffer to check entry metadata and enforce bomb/slip boundaries.
   */
  public async inspectZipBuffer(buffer: Buffer): Promise<{ isSafe: boolean; totalFiles: number }> {
    const directory = await unzipper.Open.buffer(buffer);
    const entries: ZipEntryMeta[] = directory.files.map((file) => ({
      path: file.path,
      compressedSize: file.compressedSize,
      uncompressedSize: file.uncompressedSize,
    }));

    ArchiveSafetyGuard.checkEntries(entries);
    return { isSafe: true, totalFiles: entries.length };
  }

  /**
   * Safely unpacks an archive stream into target destination sandbox while actively counting bytes.
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
      const size = entry.vars?.uncompressedSize || 0;
      const compressedSize = entry.vars?.compressedSize || 0;

      totalFiles++;
      if (totalFiles > ArchiveSafetyGuard.MAX_FILE_COUNT) {
        entry.autodrain();
        await fs.promises.rm(resolvedDest, { recursive: true, force: true });
        throw new BadRequestException({
          code: 'ZIP_BOMB_MAX_FILES_EXCEEDED',
          message: 'Exceeded 10,000 files limit.',
        });
      }

      // Path traversal check
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

        const writeStream = fs.createWriteStream(targetFilePath);

        for await (const chunk of entry) {
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
          if (
            totalUncompressedBytes > 10 * 1024 * 1024 &&
            runningRatio > ArchiveSafetyGuard.MAX_COMPRESSION_RATIO
          ) {
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
