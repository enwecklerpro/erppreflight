/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 * Deterministically serializes JSON data across TypeScript and Python:
 * - Object keys sorted lexicographically by UTF-16 code unit values
 * - No whitespace outside string literals
 * - Minimal JSON representation
 */
export function canonicalJsonSerialize(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonSerialize).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + canonicalJsonSerialize(val);
  });
  return '{' + pairs.join(',') + '}';
}
