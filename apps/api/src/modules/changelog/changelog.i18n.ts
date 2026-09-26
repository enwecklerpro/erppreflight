import type { ApiLocale } from '../../common/i18n/request-locale';
import type { ReleaseNote } from './changelog.service';

type ReleaseNoteText = Pick<ReleaseNote, 'title' | 'summary' | 'features' | 'engineChanges' | 'knowledgeUpdates' | 'breakingChanges'>;

/**
 * German release notes for the canonical changelog entries (keyed by entry id).
 * Product, engine and SAP object names stay verbatim. Entries stored in the
 * `release_notes` table without a German counterpart are returned unchanged.
 */
export const CHANGELOG_DE: Record<string, ReleaseNoteText> = {
  'rel-2026-09-25': {
    title: 'Enterprise-Plattform-Release: What-if-Canvas, 8-spaltige Rückverfolgbarkeit & MCP Change Gate',
    summary:
      'Großes Release mit interaktiver DAG-Simulation über React Flow, vollständiger Delivery-Rückverfolgbarkeit bis SAP Cloud ALM/Jira und Governance über das Model Context Protocol (MCP) Change Gate.',
    features: [
      'Interaktiver What-if-DAG-Simulations-Canvas auf Basis von @xyflow/react & der Layout-Engine ELK.js',
      '8-spaltige Delivery-Rückverfolgbarkeitsmatrix mit Behebungsaufgaben in SAP Cloud ALM / Jira per Klick',
      'Model-Context-Protocol-(MCP)-Server nach JSON-RPC 2.0 mit 7 offiziellen Preflight-Werkzeugen',
      'Agentic Change Gate mit Bewertung von Vorschlägen und kryptografischen HMAC-Ausführungstokens',
      'Unternehmensvorlagen für Analysen sowie Portal für Kundenfeedback & Abstimmung über Lücken',
      'Vollwertiges offizielles CLI-Werkzeug (`erp-preflight`) mit maschinenlesbarer JSON-Ausgabe',
    ],
    engineChanges: [
      'MFS BlackBox: Telegrammstrom-Parser im Submillisekundenbereich mit Erkennung von Topologiesprüngen und Timeouts',
      'Clean Core Guard: Regeln für direkte DB-Schreibzugriffe für den ABAP-Cloud-Umfang von S/4HANA 2025/2026 aktualisiert',
      'OPD Guard: Ersatzauflösung für Entscheidungstabellen mit mehreren Empfängern und BRFplus-XML-Parität',
    ],
    knowledgeUpdates: [
      'Unveränderlicher Snapshot `KNOW_SNAP_2026_09_24` mit 19 vollständig validierten Engines veröffentlicht',
      'Kompatibilitätsmatrix für S/4HANA Cloud 2608 mit 488 Golden-Test-Fixtures verifiziert',
    ],
    breakingChanges: [],
  },
  'rel-2026-09-24-know': {
    title: 'SAP-Wissensaktualisierung – 2608.2026-09-24',
    summary:
      'Quartalsweise Synchronisation des SAP-Release-Katalogs: 183 aktualisierte Objektklassifizierungen, 12 Nachfolgezuordnungen und 8 geschlossene Lücken für S/4HANA Cloud Public und Private Edition.',
    features: [],
    engineChanges: [
      'SPRO2Cloud: 8 klassische IMG-Aktivitäten direkt auf Aktivitäten der Central Business Configuration (CBC) abgebildet',
      'API Change Guard: OData-v4-Metadatenkatalog für S/4HANA 2025 um 42 neu freigegebene APIs ergänzt',
    ],
    knowledgeUpdates: [
      '183 ABAP-Objektklassifizierungen im Release-Kompatibilitätskatalog aktualisiert',
      '12 Nachfolgezuordnungen für veraltete Funktionsbausteine aus Vertrieb (SD) aktualisiert',
      '8 Migrationslücken für Central Finance und Konzernabschluss (Group Reporting) geschlossen',
    ],
    breakingChanges: ['Veralteter Funktionsbaustein BAPI_ACC_DOCUMENT_POST nur noch als klassische Modifikation (Stufe 3) eingestuft'],
  },
  'rel-2026-09-18': {
    title: 'Meilenstein 2: Sicherheit der Datenaufnahme & Streaming-Virenscan-Pipeline',
    summary:
      'Gehärtete Pipeline für die Datenaufnahme mit ClamAV-Streaming-Scan über TCP INSTREAM, Prüfung der Magic Bytes und Schwärzung von Geheimnissen per Shannon-Entropie.',
    features: [
      'Automatisierte Anbindung des ClamAV-Daemons mit Fail-closed-Sicherheitsgarantie',
      'Mehrstufiger Schutz beim Entpacken von Archiven (Verhältnis 100:1, höchstens 500 MB Volumen)',
      'Deterministische HMAC-SHA256-Schwärzung von SAP-Passwörtern und privaten Schlüsseln',
      'Durchsetzung von PostgreSQL Row-Level Security (RLS) für alle Mandantentabellen',
    ],
    engineChanges: ['FormDoctor: XML-Parsing von ADS-XDP gegen XXE- und Billion-Laughs-Angriffe gehärtet'],
    knowledgeUpdates: [],
    breakingChanges: [],
  },
};

export function localizeReleaseNote(note: ReleaseNote, locale: ApiLocale): ReleaseNote {
  if (locale !== 'de') return note;
  const de = CHANGELOG_DE[note.id];
  return de ? { ...note, ...de } : note;
}
