/**
 * Localized rule texts for findings (title + remediation per finding code).
 *
 * Engines emit English, deterministic text (it is part of the finding fingerprint and of every
 * export), often with dynamic parts ("CDS view I_FOO is not released …"). For German users the UI
 * shows the German catalog title of the rule and the German catalog remediation; the engine's
 * finding-specific text is kept visible as a secondary line whenever it carries more information
 * than the generic catalog text (dynamic parts are never machine-translated).
 */
import catalog from './rule-catalog.en.json';
import { INPUT_RULES_DE, RULE_CATALOG_DE, type InputRuleSuffix, type RuleTextDe } from './de';
import type { Locale } from '../config';

export interface RuleCatalogEntryEn {
  engine: string;
  title: string;
  remediation: string;
  inputRule?: InputRuleSuffix;
  inputArgs?: { engineName: string; formats: string };
}

export const RULE_CATALOG_EN = (catalog as { rules: Record<string, RuleCatalogEntryEn> }).rules;

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** German catalog text for a finding code, or null when the code is unknown to the catalog. */
export function ruleTextDe(code: string | null | undefined): RuleTextDe | null {
  if (!code) return null;
  const direct = RULE_CATALOG_DE[code];
  if (direct) return direct;
  const en = RULE_CATALOG_EN[code];
  if (en?.inputRule && en.inputArgs) {
    const tpl = INPUT_RULES_DE[en.inputRule];
    return { title: tpl.title, remediation: fill(tpl.remediation, en.inputArgs) };
  }
  return null;
}

export interface LocalizedRuleText {
  /** Title to display as the finding headline. */
  title: string;
  /** Remediation to display. */
  remediation: string;
  /** Engine's finding-specific title when it differs from the catalog title (shown as secondary line). */
  engineTitle: string | null;
  /** Engine's finding-specific remediation when it carries dynamic details the catalog text lacks. */
  engineRemediation: string | null;
  /** True when German catalog text is shown. */
  localized: boolean;
}

/**
 * Chooses the display text for a finding. English: engine text unchanged. German: catalog
 * translation; the engine's own wording is returned alongside when it is finding-specific.
 */
export function localizeRule(
  locale: Locale,
  code: string | null | undefined,
  engineTitle: string | null | undefined,
  engineRemediation: string | null | undefined
): LocalizedRuleText {
  const title = engineTitle ?? '';
  const remediation = engineRemediation ?? '';
  const unchanged: LocalizedRuleText = { title, remediation, engineTitle: null, engineRemediation: null, localized: false };
  if (locale !== 'de' || !code) return unchanged;
  const de = ruleTextDe(code);
  if (!de) return unchanged;
  const en = RULE_CATALOG_EN[code];
  const sameTitle = !title || (en ? title.trim() === en.title.trim() : false);
  let extraRemediation: string | null = null;
  if (remediation && en && remediation.trim() !== en.remediation.trim()) {
    if (remediation.startsWith(en.remediation)) {
      // Catalog text plus an engine-appended detail (e.g. "Owning business object: …").
      const tail = remediation.slice(en.remediation.length).trim();
      extraRemediation = tail || null;
    } else {
      // Fully finding-specific remediation (e.g. "Use the released successor: I_PRODUCT.").
      extraRemediation = remediation;
    }
  } else if (remediation && !en) {
    extraRemediation = remediation;
  }
  return {
    title: de.title,
    remediation: de.remediation,
    engineTitle: sameTitle ? null : title,
    engineRemediation: extraRemediation,
    localized: true,
  };
}
