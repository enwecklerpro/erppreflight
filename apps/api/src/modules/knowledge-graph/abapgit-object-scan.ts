import * as unzipper from 'unzipper';
import { ArchiveSafetyGuard } from '../ingestion/archive-safety.guard';
import { extractCandidateNames } from './candidate-names';

/**
 * Object-name scan of abapGit repository ZIPs for the released-objects snapshot overlay
 * (KNOWN_LIMITATIONS E1). The analysis engine (CLEAN_CORE_OBJECT_GUARD) evaluates every `*.abap`
 * member of the archive; the API-side overlay must therefore classify the SAP objects referenced
 * inside those members too — not only in single ABAP uploads.
 *
 * Sources of candidate names, all bounded:
 *  - the content of `*.abap` members (ABAP statements referencing tables, classes, function modules, …)
 *  - the content of abapGit `*.xml` object descriptors (DDIC references: data elements, domains,
 *    check tables, super classes, …)
 *  - the object names encoded in abapGit file names (`zcl_foo.clas.abap`, `#bobf#cl_x.clas.xml`)
 * The archive passes the same entry checks as ingestion (zip slip, entry count, size, ratio) before
 * any member is inflated; nested archives are not opened.
 */

export const ABAPGIT_SCAN_LIMITS = {
  /** Total inflated bytes read from all scanned members. */
  maxTotalBytes: 64 * 1024 * 1024,
  /** Inflated bytes read from one member. */
  maxMemberBytes: 8 * 1024 * 1024,
  /** Members scanned (in archive order). */
  maxMembers: 5_000,
};

const SCANNED_SUFFIXES = ['.abap', '.xml'];

export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/**
 * abapGit file name -> SAP object name: `src/zcl_foo.clas.abap` -> `ZCL_FOO`,
 * `src/#bobf#cl_lib.clas.locals_imp.abap` -> `/BOBF/CL_LIB`. Returns null for non-object files.
 */
export function abapGitObjectName(entryPath: string): string | null {
  const base = entryPath.split('/').pop() ?? '';
  const parts = base.split('.');
  if (parts.length < 3) return null;
  const type = parts[1];
  if (!/^[a-z]{4}$/i.test(type)) return null;
  const name = parts[0].replace(/#/g, '/').toUpperCase();
  if (!/^(?:\/[A-Z0-9_]{1,10}\/)?[A-Z_][A-Z0-9_]{0,59}$/.test(name)) return null;
  return name;
}

export interface AbapGitScanResult {
  names: string[];
  membersScanned: number;
  bytesScanned: number;
  truncated: boolean;
}

/** Candidate SAP object names referenced by an abapGit ZIP (see module doc). Throws on unsafe archives. */
export async function extractAbapGitCandidateNames(
  buffer: Buffer,
  extract: (text: string) => string[] = extractCandidateNames
): Promise<AbapGitScanResult> {
  const directory = await unzipper.Open.buffer(buffer);
  ArchiveSafetyGuard.checkEntries(
    directory.files.map((f) => ({ path: f.path, compressedSize: f.compressedSize, uncompressedSize: f.uncompressedSize }))
  );
  const names = new Set<string>();
  let membersScanned = 0;
  let bytesScanned = 0;
  let truncated = false;
  const files = [...directory.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of files) {
    if (file.type !== 'File') continue;
    const lower = file.path.toLowerCase();
    if (!SCANNED_SUFFIXES.some((s) => lower.endsWith(s))) continue;
    const objectName = abapGitObjectName(file.path);
    if (objectName) names.add(objectName);
    if (membersScanned >= ABAPGIT_SCAN_LIMITS.maxMembers || bytesScanned >= ABAPGIT_SCAN_LIMITS.maxTotalBytes) {
      truncated = true;
      continue;
    }
    if (file.uncompressedSize > ABAPGIT_SCAN_LIMITS.maxMemberBytes) {
      truncated = true;
      continue;
    }
    const content = await file.buffer();
    membersScanned++;
    bytesScanned += content.length;
    for (const n of extract(content.toString('utf-8'))) names.add(n);
  }
  return { names: [...names].sort(), membersScanned, bytesScanned, truncated };
}
