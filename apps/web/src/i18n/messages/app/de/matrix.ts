import type { matrix as En } from '../en/matrix';

export const matrix: typeof En = {
  eyebrow: 'Release-Abdeckung',
  title: 'SAP-Release-Kompatibilitätsmatrix',
  intro: 'Welche Preflight-Engine welches SAP-Produkt, welche Edition und welches Release unterstützt – mit den akzeptierten Eingabeformaten und dem Verifikationsstatus.',
  staticSource: 'Der Analysedienst ist nicht erreichbar; angezeigt wird der mit der Plattform ausgelieferte Release-Katalog.',
  searchPlaceholder: 'Engine oder Release suchen …',
  searchLabel: 'Release-Matrix durchsuchen',
  domainsLabel: 'Nach Bereich filtern',
  tableLabel: 'Release-Kompatibilität der Engines',
  colEngine: 'Engine',
  colDomain: 'Bereich',
  colRelease: 'Unterstützte SAP-Releases',
  colFormats: 'Eingabeformate',
  colStatus: 'Verifikationsstatus',
  colFixtures: 'Referenzdateien',
  fixtures: '{count, plural, one {# Referenzdatei} other {# Referenzdateien}}',
  loading: 'Release-Matrix wird geladen …',
  loadFailed: 'Die Release-Matrix konnte nicht geladen werden.',
  empty: 'Keine Engine entspricht dem aktuellen Filter.',
  status: {
    SUPPORTED_VERIFIED: 'Verifiziert',
    SUPPORTED_BETA: 'Beta',
    PARTIAL: 'Teilweise',
    FILE_MODE_ONLY: 'Nur Datei-Upload',
  },
};
