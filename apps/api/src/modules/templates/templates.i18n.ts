import type { ApiLocale } from '../../common/i18n/request-locale';
import type { AnalysisTemplate } from './templates.service';

/** `targetDomain` stays the canonical English key (filter value; the web localizes the label). */
type TemplateText = Pick<AnalysisTemplate, 'name' | 'description' | 'requiredInputs' | 'optionalInputs' | 'standardChecks'>;

/**
 * German texts of the system templates (keyed by template id). Engine IDs, SAP
 * transaction codes and artifact format names stay verbatim. Custom templates are
 * customer-authored and are never translated.
 */
export const SYSTEM_TEMPLATES_DE: Record<string, TemplateText> = {
  'tpl-po-email-output': {
    name: 'Prüfung der E-Mail-Ausgabe von Bestellungen',
    description:
      'Preflight-Prüfung automatisierter Bestellbenachrichtigungen per E-Mail, der OPD-Findungsregeln und der Empfängerermittlung für die Ausgabe.',
    requiredInputs: ['OPD-Regelmatrix (XML)', 'Formularvorlage (XML / XDP)'],
    optionalInputs: ['Definitionen der Kundenfelder (JSON)', 'Konfiguration des E-Mail-Ausgabekanals'],
    standardChecks: ['Integrität der Empfängerfindungsregeln', 'Gültigkeit des Ersatzkanals', 'Fehlende Elemente der Formularbindung'],
  },
  'tpl-billing-form-field': {
    name: 'Prüfung von Faktura-Formularfeldern & Feldfluss',
    description:
      'Prüft die Weitergabe von Key-User-Kundenfeldern aus SAP-Standard-Fakturabelegen in Layouts der Adobe Document Services (ADS).',
    requiredInputs: ['Rechnungsformularvorlage (XML)', 'Zuordnung der Kundenfelder (JSON)'],
    optionalInputs: ['Erweiterungsdefinitionen der CDS-Views'],
    standardChecks: ['Feldfluss-Verfolgung für YY1_-Felder', 'Prüfung der ADS-Schemabindung', 'Risiko abgeschnittener Schrift / Layouts'],
  },
  'tpl-ecc2cloud-assessment': {
    name: 'Migrationsbewertung ECC → Public Cloud',
    description:
      'Durchgängige Machbarkeitsanalyse der Migration von ECC 6.0 EHP8 nach S/4HANA Cloud Public Edition mit Prüfung der SPRO-Konfiguration und der Fit-to-Standard-Lücken.',
    requiredInputs: ['ECC-SPRO-/IMG-Konfiguration (CSV)', 'Inventar des kundeneigenen Altcodes (abapGit)'],
    optionalInputs: ['ST03-Nutzungsprotokolle (CSV)', 'SAP Readiness Check (XML)'],
    standardChecks: [
      'Direkte Zuordnung SPRO zu CBC/SSCUI',
      'Ermittlung von Nachfolgern für kundeneigene Z-Transaktionen',
      'Einstufung der Clean-Core-Erweiterbarkeit',
    ],
  },
  'tpl-clean-core-abap-scan': {
    name: 'Clean-Core-Prüfung von ABAP-Code',
    description:
      'Prüft kundeneigenen ABAP-Code gegen SAP Clean Core Stufe 1 (Cloud-Erweiterbarkeit), Stufe 2 (freigegebene APIs) und Stufe 3 (klassische Modifikationen).',
    requiredInputs: ['ABAP-Quellcode-Repository (.zip / abapGit)'],
    optionalInputs: ['ATC-Ergebnisse (XML)', 'BAdI-Implementierungsdefinitionen'],
    standardChecks: [
      'Erkennung direkter Schreibzugriffe auf Standardtabellen',
      'Verwendung nicht freigegebener interner SAP-APIs',
      'Cloud-Tauglichkeit von BAdIs',
    ],
  },
  'tpl-api-upgrade-guard': {
    name: 'Prüfung von API-Upgrade & inkompatiblen Änderungen',
    description:
      'Vergleicht OData- und SOAP-Service-Definitionen mit neueren S/4HANA-Releases, um inkompatible Schemaänderungen zu erkennen.',
    requiredInputs: ['Basis-API-Spezifikation (EDMX / WSDL / OpenAPI)', 'API-Spezifikation des Ziel-Release'],
    optionalInputs: ['Definitionen der Integrationsflüsse (iFlow-JSON)'],
    standardChecks: [
      'Entfernte veraltete Entitäten & Felder',
      'Neue Pflichtparameter in Anfragen',
      'Warnungen zu Typinkompatibilitäten',
    ],
  },
  'tpl-matmas-change-pointer': {
    name: 'Abdeckung der MATMAS-Änderungszeiger',
    description:
      'Prüft die Abdeckung der Änderungszeiger-Auslöser (BD21 / BD52) für die Materialstammverteilung an externe E-Commerce- und MES-Plattformen.',
    requiredInputs: ['Feldkonfiguration TBD52 (CSV)', 'Nachrichtentyp-Zuordnung TBD62 (CSV)'],
    optionalInputs: ['IDoc-Segmentdefinition (XML)'],
    standardChecks: [
      'Prüfung aktiver Feldereignis-Auslöser',
      'Vollständigkeit der Nachrichtentyp-Filter',
      'Risiko verzögerter Replikation',
    ],
  },
  'tpl-transport-release-preflight': {
    name: 'Preflight für Transportfreigaben',
    description:
      'Prüft transportübergreifende Abhängigkeiten, die Integrität der Importreihenfolge und die Konsistenz von Software-Collection-Bündeln vor dem Import in QS/PROD.',
    requiredInputs: ['Objektliste der Transportaufträge (E071/E071K, CSV)', 'Software-Collection-Export (XML)'],
    optionalInputs: ['Systemverzeichnis der Ziellandschaft'],
    standardChecks: [
      'Fehlende vorausgesetzte Transporte',
      'Abweichende Reihenfolge von Tabellenstruktur und Code',
      'Zirkuläre Abhängigkeiten zwischen Collections',
    ],
  },
  'tpl-safe-decommission-preflight': {
    name: 'Preflight für die Stilllegung von Benutzern & Objekten',
    description:
      'Vorabprüfung vor dem Löschen ungenutzter Kundenobjekte, dem Entfernen von RFC-Destinationen oder dem Sperren technischer Benutzer in der Produktion.',
    requiredInputs: ['Liste der Stilllegungskandidaten (CSV)', 'PFCG-Rollen- & Nutzungsprotokoll (CSV)'],
    optionalInputs: ['Variantenkonfiguration der Hintergrundjobs (TBTCO)'],
    standardChecks: [
      'Prüfung auf Verweise aktiver Hintergrundjobs',
      'Abhängigkeitsprüfung der RFC-Destinationen',
      'Risiko verwaister Berechtigungskataloge',
    ],
  },
  'tpl-mfs-incident-investigation': {
    name: 'MFS-Vorfallanalyse (Ursachenermittlung)',
    description:
      'Analysiert hochfrequente SPS-Telegrammprotokolle des SAP-EWM-Materialflusssystems (MFS), um die erste kausale Abweichung bei Stillständen im Lager exakt zu bestimmen.',
    requiredInputs: ['MFS-Telegrammprotokollpuffer (CSV / TXT / LOG)'],
    optionalInputs: ['Topologie von Fördertechnik / Regalbediengeräten (JSON)'],
    standardChecks: [
      'Erkennung von ACK-Timeouts & Retry-Stürmen bei Telegrammen',
      'Anomalie: Topologiesprung',
      'Analyse vertauschter Sequenzen',
    ],
  },
};

/** Returns the template in the requested language (system templates only). */
export function localizeTemplate<T extends AnalysisTemplate>(template: T, locale: ApiLocale): T {
  if (locale !== 'de' || !template.isSystemTemplate) return template;
  const de = SYSTEM_TEMPLATES_DE[template.id];
  return de ? { ...template, ...de } : template;
}
