import { describe, it, expect } from 'vitest';
import { RULE_CATALOG_EN, localizeRule, ruleTextDe } from '../i18n/rule-catalog';
import { INPUT_RULES_DE, RULE_CATALOG_DE } from '../i18n/rule-catalog/de';

/**
 * Parity between the Python rule catalog (exported by scripts/generate-rule-catalog-i18n.py,
 * staleness checked by services/analysis-python/tests/test_rule_catalog_i18n_export.py) and the
 * German rule texts. A new finding code without a German title + remediation fails here.
 */
const codes = Object.keys(RULE_CATALOG_EN);
const engineCodes = codes.filter((c) => !RULE_CATALOG_EN[c].inputRule);

describe('rule catalog EN/DE parity', () => {
  it('covers every engine of the service', () => {
    expect(codes.length).toBeGreaterThan(200);
    expect(new Set(codes.map((c) => RULE_CATALOG_EN[c].engine)).size).toBeGreaterThanOrEqual(19);
  });

  it('every finding code has a German title and remediation', () => {
    const missing = codes.filter((c) => {
      const de = ruleTextDe(c);
      return !de || !de.title.trim() || !de.remediation.trim();
    });
    expect(missing, `Add German texts to src/i18n/rule-catalog/de.ts for:\n${missing.join('\n')}`).toEqual([]);
  });

  it('has no German entries for codes that no longer exist', () => {
    const stale = Object.keys(RULE_CATALOG_DE).filter((c) => !RULE_CATALOG_EN[c] || RULE_CATALOG_EN[c].inputRule);
    expect(stale).toEqual([]);
  });

  it('German texts are translations, not copies, and keep placeholders resolved', () => {
    for (const c of engineCodes) {
      const de = RULE_CATALOG_DE[c];
      expect(de.title, c).not.toBe(RULE_CATALOG_EN[c].title);
      expect(de.remediation, c).not.toBe(RULE_CATALOG_EN[c].remediation);
    }
    for (const c of codes.filter((code) => RULE_CATALOG_EN[code].inputRule)) {
      expect(ruleTextDe(c)!.remediation, c).not.toMatch(/\{\w+\}/);
    }
    expect(Object.keys(INPUT_RULES_DE).sort()).toEqual(
      [...new Set(codes.map((c) => RULE_CATALOG_EN[c].inputRule).filter(Boolean))].sort()
    );
  });
});

describe('localizeRule', () => {
  const code = 'CLEAN_CORE_UNRELEASED_OBJECT';
  const en = RULE_CATALOG_EN[code];

  it('leaves English output untouched', () => {
    const r = localizeRule('en', code, 'CDS view I_X is not released', en.remediation);
    expect(r).toMatchObject({ title: 'CDS view I_X is not released', remediation: en.remediation, localized: false });
  });

  it('shows the German catalog text and keeps the finding-specific engine title', () => {
    const r = localizeRule('de', code, 'CDS view I_X is not released', en.remediation);
    expect(r.title).toBe(RULE_CATALOG_DE[code].title);
    expect(r.remediation).toBe(RULE_CATALOG_DE[code].remediation);
    expect(r.engineTitle).toBe('CDS view I_X is not released');
    expect(r.engineRemediation).toBeNull();
  });

  it('keeps dynamic remediation details from the engine', () => {
    const specific = localizeRule('de', code, en.title, 'Use the released successor: I_PRODUCT.');
    expect(specific.engineTitle).toBeNull();
    expect(specific.engineRemediation).toBe('Use the released successor: I_PRODUCT.');
    const appended = localizeRule('de', 'CLEAN_CORE_DIRECT_DB_MUTATION', 'x', `${RULE_CATALOG_EN.CLEAN_CORE_DIRECT_DB_MUTATION.remediation} Owning business object / successor view: I_PRODUCT.`);
    expect(appended.engineRemediation).toBe('Owning business object / successor view: I_PRODUCT.');
  });

  it('fills the German input-validation template with engine name and formats', () => {
    const inputCode = codes.find((c) => RULE_CATALOG_EN[c].inputRule === 'PARSE_ERROR')!;
    const r = localizeRule('de', inputCode, RULE_CATALOG_EN[inputCode].title, RULE_CATALOG_EN[inputCode].remediation);
    expect(r.title).toBe('Artefakt konnte nicht geparst werden');
    expect(r.remediation).toContain(RULE_CATALOG_EN[inputCode].inputArgs!.engineName);
    expect(r.engineRemediation).toBeNull();
  });

  it('falls back to engine text for unknown codes', () => {
    const r = localizeRule('de', 'NOT_A_CODE', 'Engine title', 'Engine remediation');
    expect(r).toMatchObject({ title: 'Engine title', remediation: 'Engine remediation', localized: false });
  });
});
