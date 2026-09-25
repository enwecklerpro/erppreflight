import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { LocalArtifactRedactor } from './redactor';

export interface ScannedArtifact {
  relativePath: string;
  absolutePath: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  redactedContent?: string;
  redactedCount: number;
}

export interface ScanOptions {
  rootDir: string;
  redactSecrets?: boolean;
  maxFileSizeBytes?: number;
}

export class LocalDirectoryScanner {
  private static readonly SUPPORTED_EXTS = new Set([
    '.xml',
    '.json',
    '.abap',
    '.xdp',
    '.edmx',
    '.csv',
    '.txt',
    '.zip',
  ]);

  static scan(options: ScanOptions): ScannedArtifact[] {
    const root = path.resolve(options.rootDir);
    if (!fs.existsSync(root)) {
      throw new Error(`Directory '${root}' does not exist.`);
    }

    const maxSizeBytes = options.maxFileSizeBytes || 100 * 1024 * 1024; // 100MB
    const artifacts: ScannedArtifact[] = [];

    const walk = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Avoid scanning node_modules, git directories
          if (entry.name !== 'node_modules' && entry.name !== '.git') {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (this.SUPPORTED_EXTS.has(ext)) {
            const stats = fs.statSync(fullPath);
            if (stats.size > maxSizeBytes) {
              continue;
            }

            const rawBuffer = fs.readFileSync(fullPath);
            const sha256 = crypto.createHash('sha256').update(rawBuffer).digest('hex');
            const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');

            let redactedContent: string | undefined;
            let redactedCount = 0;

            if (options.redactSecrets && ext !== '.zip') {
              try {
                const text = rawBuffer.toString('utf-8');
                const redRes = LocalArtifactRedactor.redact(text);
                redactedContent = redRes.content;
                redactedCount = redRes.redactedCount;
              } catch {
                // Binary or non-UTF-8
              }
            }

            artifacts.push({
              relativePath,
              absolutePath: fullPath,
              extension: ext,
              sizeBytes: stats.size,
              sha256,
              redactedContent,
              redactedCount,
            });
          }
        }
      }
    };

    walk(root);
    return artifacts;
  }
}
