import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { localeFromAcceptLanguage, resolveRequestLocale } from './request-locale';
import { SYSTEM_TEMPLATES } from '../../modules/templates/templates.service';
import { SYSTEM_TEMPLATES_DE, localizeTemplate } from '../../modules/templates/templates.i18n';
import { CANONICAL_CHANGELOGS } from '../../modules/changelog/changelog.service';
import { CHANGELOG_DE, localizeReleaseNote } from '../../modules/changelog/changelog.i18n';
import { CONNECTOR_DEFINITIONS, CONNECTOR_TYPES, describeConnectorType } from '../../modules/connectors/connector-registry';
import { CONNECTOR_TEXT_DE, localizeConnectorType } from '../../modules/connectors/connector-registry.i18n';

describe('request locale', () => {
  it('prefers an explicit query parameter and validates it', () => {
    expect(resolveRequestLocale('de', 'en-US')).toBe('de');
    expect(resolveRequestLocale('en', 'de-DE')).toBe('en');
    expect(() => resolveRequestLocale('fr', undefined)).toThrow(BadRequestException);
  });

  it('parses Accept-Language by weight and falls back to English', () => {
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9,en;q=0.8')).toBe('de');
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,de;q=0.5,en;q=0.7')).toBe('en');
    expect(localeFromAcceptLanguage('fr')).toBe('en');
    expect(localeFromAcceptLanguage('en;q=0.1, de')).toBe('de');
    expect(localeFromAcceptLanguage(undefined)).toBe('en');
    expect(resolveRequestLocale(undefined, 'de')).toBe('de');
  });
});

describe('server-authored content in German', () => {
  it('every system template has a complete German text', () => {
    for (const tpl of SYSTEM_TEMPLATES) {
      const de = SYSTEM_TEMPLATES_DE[tpl.id];
      expect(de, tpl.id).toBeTruthy();
      expect(de.name).not.toBe(tpl.name);
      expect(de.requiredInputs.length, tpl.id).toBe(tpl.requiredInputs.length);
      expect(de.optionalInputs.length, tpl.id).toBe(tpl.optionalInputs.length);
      expect(de.standardChecks.length, tpl.id).toBe(tpl.standardChecks.length);
    }
    expect(Object.keys(SYSTEM_TEMPLATES_DE).sort()).toEqual(SYSTEM_TEMPLATES.map((t) => t.id).sort());
  });

  it('localizes system templates only and keeps canonical keys', () => {
    const tpl = { ...SYSTEM_TEMPLATES[0], createdAt: '2026-01-01' };
    const de = localizeTemplate(tpl, 'de');
    expect(de.name).toBe(SYSTEM_TEMPLATES_DE[tpl.id].name);
    expect(de.targetDomain).toBe(tpl.targetDomain);
    expect(de.engines).toEqual(tpl.engines);
    expect(localizeTemplate(tpl, 'en')).toBe(tpl);
    const custom = { ...tpl, id: 'x', isSystemTemplate: false, name: 'Mine' };
    expect(localizeTemplate(custom, 'de').name).toBe('Mine');
  });

  it('every canonical changelog entry has a complete German text', () => {
    for (const note of CANONICAL_CHANGELOGS) {
      const de = CHANGELOG_DE[note.id];
      expect(de, note.id).toBeTruthy();
      for (const key of ['features', 'engineChanges', 'knowledgeUpdates', 'breakingChanges'] as const) {
        expect(de[key].length, `${note.id}.${key}`).toBe(note[key].length);
      }
      const localized = localizeReleaseNote(note, 'de');
      expect(localized.version).toBe(note.version);
      expect(localized.title).toBe(de.title);
    }
  });
});

describe('connector registry in German', () => {
  it('covers every connector type, scope reason and capability list', () => {
    for (const type of CONNECTOR_TYPES) {
      const def = describeConnectorType(CONNECTOR_DEFINITIONS[type]);
      const de = CONNECTOR_TEXT_DE[type];
      expect(de, type).toBeTruthy();
      for (const s of def.scopes) expect(de.why[s.scope], `${type} ${s.scope}`).toBeTruthy();
      expect(de.canRead.length, type).toBe(def.canRead.length);
      expect(de.cannotAccess.length, type).toBe(def.cannotAccess.length);
      const localized = localizeConnectorType(def, 'de');
      expect(localized.description).toBe(de.description);
      expect(localized.configFields).toEqual(def.configFields);
      expect(localizeConnectorType(def, 'en')).toBe(def);
    }
  });
});
