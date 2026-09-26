import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Lint-like guard (spec C §42, Part 02 §2.7): application pages and shared
 * components must not render hardcoded English. User-visible copy lives in the
 * EN/DE dictionaries (`src/i18n/messages`) and is read with `useT()` / `getT()`.
 *
 * Pragmatic heuristic: flags JSX text nodes and literal user-facing attributes
 * (placeholder, aria-label, title, alt, label, …) that contain a lower-case
 * word. Technical tokens are allowed: upper-case codes (engine IDs, SAP object
 * names such as `BKPF`, `SE38`), numbers, symbols and the allowlist below.
 */

const SRC = path.resolve(__dirname, '..');
const ROOTS = ['app', 'components'];

/** Owned by other workstreams / public site with its own dictionaries. */
const EXCLUDED = [
  /^app\/\[locale\]\//, // public website (localized separately)
  /^app\/api\//, // route handlers
  /^app\/docs\//, // public docs (being moved under [locale])
  /^app\/projects\/\[id\]\/findings\//,
  /^app\/projects\/\[id\]\/lab\//,
  /^app\/projects\/\[id\]\/page\.tsx$/, // analysis launcher / run history (shared file, see handover §6.1)
  /^app\/analyze\//,
  /^app\/reports\//,
  /^app\/integrations\//,
  /^components\/findings\//,
  /^components\/integrations\//,
  /^components\/evidence-inspector\.tsx$/,
  /^components\/public\//,
];

/** Exact strings that are allowed verbatim (product names, formats, standards). */
const ALLOWED_TEXT = new Set<string>([
  'ERP Preflight',
  'CSV',
  'JSON',
  'PDF',
  'XLSX',
  'SARIF',
  'S/4HANA',
  'ECC 6.0',
  'OData',
  'BRFplus',
  'TOTP',
  'SAML',
  'OIDC',
  'Webhook',
  'Slack',
  'Jira',
  'GitHub',
  'ServiceNow',
  'BTP',
  'Esc',
]);

/** Attribute names whose literal values are read by users or assistive technology. */
const ATTRS = [
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'title',
  'alt',
  'label',
  'description',
  'emptyTitle',
  'emptyDescription',
  'searchPlaceholder',
  'busyLabel',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(entry.name)) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '{}')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    // Template literals hold data (sample payloads, URLs, class names), never JSX; keep line numbers.
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** A string is "English copy" when it contains a word with 3+ letters that has a lower-case letter. */
function looksLikeCopy(text: string): boolean {
  const t = text.replace(/&[a-z]+;|&#\d+;/g, ' ').trim();
  if (!t || ALLOWED_TEXT.has(t)) return false;
  if (/^https?:\/\/\S+$/.test(t)) return false; // example URLs
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(t)) return false; // contact addresses
  return /[A-Za-z]*[a-z][A-Za-z]*/.test(t) && /\b[A-Za-z]*[a-z][A-Za-z]{1,}\b/.test(t) && /[a-z]{2,}/.test(t);
}

export function findHardcodedText(file: string, source: string): string[] {
  const src = stripComments(source);
  const hits: string[] = [];
  const lineOf = (index: number) => src.slice(0, index).split('\n').length;

  // JSX text: between a tag end ('>' not part of '=>' or '->') and the next '<' or '{'.
  const textRe = /(^|[^=\-])>([^<>{}]*?)(?=<|\{)/g;
  for (const m of src.matchAll(textRe)) {
    const text = m[2];
    if (!text.trim()) continue;
    if (/[();=&|`]/.test(text) || /^\s*(else|return|as|from|typeof|extends|keyof)\b/.test(text)) continue;
    if (!looksLikeCopy(text)) continue;
    hits.push(`${file}:${lineOf(m.index ?? 0)}  text  "${text.trim().slice(0, 80)}"`);
  }
  // Text following a JSX expression: `{count} selected</span>`
  const afterExprRe = /\}([^<>{}()=;`'"&|]*?)<\//g;
  for (const m of src.matchAll(afterExprRe)) {
    const text = m[1];
    if (!text.trim() || !looksLikeCopy(text)) continue;
    hits.push(`${file}:${lineOf(m.index ?? 0)}  text  "${text.trim().slice(0, 80)}"`);
  }
  // Literal attributes: placeholder="Search…", aria-label="Close"
  const attrRe = new RegExp(`\\s(${ATTRS.join('|')})=(?:"([^"]*)"|\\{'([^']*)'\\}|\\{"([^"]*)"\\})`, 'g');
  for (const m of src.matchAll(attrRe)) {
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (!looksLikeCopy(value)) continue;
    hits.push(`${file}:${lineOf(m.index ?? 0)}  ${m[1]}  "${value.slice(0, 80)}"`);
  }
  return hits;
}

describe('no hardcoded English in the application UI', () => {
  const files = ROOTS.flatMap((r) => walk(path.join(SRC, r)))
    .map((abs) => ({ abs, rel: path.relative(SRC, abs).split(path.sep).join('/') }))
    .filter(({ rel }) => !EXCLUDED.some((re) => re.test(rel)));

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it('JSX text and user-facing attributes come from the dictionaries', () => {
    const hits = files.flatMap(({ abs, rel }) => findHardcodedText(rel, fs.readFileSync(abs, 'utf8')));
    expect(hits, `Hardcoded UI text found — move it to src/i18n/messages/app/{en,de}:\n${hits.join('\n')}`).toEqual([]);
  });

  it('detector catches typical violations and ignores technical tokens', () => {
    const sample = [
      '<h1>Project settings</h1>',
      '<span>{count} selected</span>',
      '<input placeholder="Search projects" />',
      '<button aria-label={"Close dialog"} />',
      '<code>BKPF</code>',
      '<span>SE38</span>',
      '<span>{t("app.ui.save")}</span>',
      '<td>—</td>',
      '<span>CSV</span>',
      'const f = (a) => a < b;',
    ].join('\n');
    const hits = findHardcodedText('sample.tsx', sample);
    expect(hits).toHaveLength(4);
  });
});
