/**
 * abapGit overlay scan must bound the ACTUAL inflated bytes of a member, not trust the sizes declared in the
 * ZIP directory: ingestion only inspects declared sizes, so a 200 KB deflate member declaring 100 bytes
 * would otherwise expand to 200 MB (x up to 5,000 members) inside the API process.
 */
import { describe, it, expect } from 'vitest';
import { crc32, deflateRawSync } from 'node:zlib';
import {
  ABAPGIT_SCAN_LIMITS,
  extractAbapGitCandidateNames,
} from '../src/modules/knowledge-graph/abapgit-object-scan';

/** One deflated member whose local + central headers declare `declared` uncompressed bytes. */
function lyingZip(name: string, real: Buffer, declared: number): Buffer {
  const data = deflateRawSync(real, { level: 9 });
  const nameBuf = Buffer.from(name);
  const crc = crc32(real) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42);
  const cd = Buffer.concat([central, nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + nameBuf.length + data.length, 16);
  return Buffer.concat([local, nameBuf, data, cd, end]);
}

describe('abapGit scan inflation bound', () => {
  it('stops inflating a member that lies about its uncompressed size', async () => {
    const real = Buffer.alloc(ABAPGIT_SCAN_LIMITS.maxMemberBytes * 4, 0x41); // 32 MiB of 'A'
    const zip = lyingZip('src/zbomb.prog.abap', real, 100);
    expect(zip.length).toBeLessThan(real.length / 100);
    const result = await extractAbapGitCandidateNames(zip);
    expect(result.truncated).toBe(true);
    expect(result.bytesScanned).toBeLessThanOrEqual(ABAPGIT_SCAN_LIMITS.maxMemberBytes);
    // The file-name object is still reported; the unscanned content contributes nothing.
    expect(result.names).toEqual(['ZBOMB']);
  });

  it('still scans an honest member fully', async () => {
    const zip = lyingZip('src/zok.prog.abap', Buffer.from('SELECT * FROM mara INTO TABLE @lt.'), 34);
    const result = await extractAbapGitCandidateNames(zip);
    expect(result.truncated).toBe(false);
    expect(result.names).toEqual(expect.arrayContaining(['MARA', 'ZOK']));
  });
});
