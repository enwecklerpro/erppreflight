const MAX_CANDIDATES = 20_000;

/**
 * Candidate SAP object names referenced by an artifact: ABAP-style identifiers
 * (incl. namespaces like /BOBF/CL_X). Deliberately over-inclusive: only names
 * that exist in the knowledge graph are forwarded to the engine.
 */
export function extractCandidateNames(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:\/[A-Z0-9_]{1,10}\/)?[A-Z_][A-Z0-9_]{2,59}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[0].toUpperCase());
    if (out.size >= MAX_CANDIDATES) break;
  }
  return [...out];
}
