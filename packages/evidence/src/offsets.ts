import { EvidenceSourceOffset, EvidenceSelector } from '@erppreflight/schemas';

/**
 * Extracts line/column coordinates and a bounded preview context window (typically 3-5 lines).
 */
export function extractLineContext(
  fullText: string,
  lineNumber: number,
  contextRadius: number = 3
): { snippet: string; contextSnippet: string } {
  const lines = fullText.split(/\r?\n/);
  const targetIndex = Math.max(0, lineNumber - 1);
  const snippet = lines[targetIndex] || '';

  const start = Math.max(0, targetIndex - contextRadius);
  const end = Math.min(lines.length, targetIndex + contextRadius + 1);
  const contextSnippet = lines.slice(start, end).join('\n');

  return { snippet, contextSnippet };
}

/**
 * Finds exact character/byte coordinates of a pattern in source text.
 */
export function findTextCoordinates(
  fullText: string,
  target: string
): {
  lineNumber: number;
  columnNumber: number;
  byteOffsetStart: number;
  byteOffsetEnd: number;
} | null {
  const index = fullText.indexOf(target);
  if (index === -1) return null;

  const preText = fullText.slice(0, index);
  const lines = preText.split('\n');
  const lineNumber = lines.length;
  const columnNumber = lines[lines.length - 1].length + 1;

  const byteOffsetStart = Buffer.byteLength(preText, 'utf-8');
  const byteOffsetEnd = byteOffsetStart + Buffer.byteLength(target, 'utf-8');

  return {
    lineNumber,
    columnNumber,
    byteOffsetStart,
    byteOffsetEnd,
  };
}

/**
 * Helper to build an EvidenceSourceOffset object.
 */
export function createSourceOffset(params: {
  artifactPath: string;
  selectorType?: EvidenceSelector;
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  byteOffsetStart?: number;
  byteOffsetEnd?: number;
  selectorQuery?: string;
  snippet: string;
  contextSnippet?: string;
}): EvidenceSourceOffset {
  return {
    artifactPath: params.artifactPath,
    selectorType: params.selectorType || 'LINE_COLUMN',
    startLine: params.startLine ?? null,
    endLine: params.endLine ?? null,
    startColumn: params.startColumn ?? null,
    endColumn: params.endColumn ?? null,
    byteOffsetStart: params.byteOffsetStart ?? null,
    byteOffsetEnd: params.byteOffsetEnd ?? null,
    selectorQuery: params.selectorQuery ?? null,
    snippet: params.snippet,
    contextSnippet: params.contextSnippet ?? null,
  };
}
