import type { ApiLocale } from '../../common/i18n/request-locale';
import type { ConnectorType } from './connector-registry';

/**
 * German texts of the connector registry (shown when adding a connector and after a
 * connection test). Scope identifiers, product names and HTTP paths stay verbatim;
 * `why` texts are keyed by the scope identifier.
 */
export interface ConnectorTextDe {
  displayName?: string;
  description: string;
  why: Record<string, string>;
  canRead: string[];
  cannotAccess: string[];
}

export const CONNECTOR_TEXT_DE: Record<ConnectorType, ConnectorTextDe> = {
  HTTP_OPENAPI: {
    description: 'Generische REST-API. Liest ein OpenAPI-Dokument als Baseline für den API Change Guard.',
    why: {
      'GET <healthPath>': 'Health-Check der Verbindung',
      'GET <openApiPath>': 'OpenAPI-Vertrag als Baseline lesen',
    },
    canRead: ['Status des Health-Endpunkts', 'OpenAPI-Dokument (Pfade, Operationen, Parameter)'],
    cannotAccess: ['Geschäftsdaten', 'Jede Operation außer GET'],
  },
  ODATA: {
    description: 'Liest das $metadata-Dokument (EDMX) eines SAP-OData-Service.',
    why: {
      'GET <serviceRoot>/$metadata': 'Entitätstypen, Eigenschaften und Navigation für Baselines des API Change Guard normalisieren',
      'S_SERVICE (display) for the OData service': 'SAP-Berechtigung zum Lesen von $metadata',
    },
    canRead: ['Service-Metadaten (EDMX): Entitätsmengen, Typen, Schlüssel, Eigenschaften, Navigation, Function Imports'],
    cannotAccess: ['Entitätsdaten (es werden keine Abfragen auf Entitätsmengen ausgeführt)', 'Jede schreibende Operation'],
  },
  SAP_CLOUD_ALM: {
    description:
      'Synchronisiert Projekte, Aufgaben/Anforderungen und den Behebungsstatus mit SAP Cloud ALM (OAuth2 Client Credentials).',
    why: {
      'calm-projects: read': 'ERP-Preflight-Projekte Cloud-ALM-Projekten zuordnen',
      'calm-tasks: read': 'Aufgabenstatus zurücksynchronisieren (Pull)',
      'calm-tasks: write': 'Behebungsaufgaben und Kommentare aus Befunden anlegen',
    },
    canRead: ['Cloud-ALM-Projekte', 'Von ERP Preflight angelegte oder verknüpfte Aufgaben (Status, Bearbeiter, Fälligkeit)'],
    cannotAccess: ['Nicht mit ERP Preflight verknüpfte Aufgaben', 'Personenbezogene Daten aus Testausführungen', 'Jegliches Löschen'],
  },
  JIRA: {
    description: 'Legt Jira-Vorgänge über die Jira Cloud REST API v3 an und synchronisiert sie.',
    why: {
      'read:jira-work': 'Projekt- und Vorgangsstatus lesen',
      'read:jira-user': 'Inhaber des API-Tokens prüfen (/myself)',
      'write:jira-work': 'Vorgänge und Kommentare aus Befunden anlegen',
    },
    canRead: ['Metadaten des konfigurierten Projekts', 'Von ERP Preflight angelegte Vorgänge'],
    cannotAccess: ['Andere Projekte', 'Löschen von Vorgängen', 'Benutzerverwaltung'],
  },
  AZURE_DEVOPS: {
    description: 'Legt Work Items über die Azure DevOps Work Item Tracking REST API 7.1 an und synchronisiert sie.',
    why: {
      'vso.project': 'Konfiguriertes Projekt prüfen',
      'vso.work': 'Status der Work Items lesen',
      'vso.work_write': 'Work Items und Kommentare aus Befunden anlegen',
    },
    canRead: ['Konfiguriertes Projekt', 'Von ERP Preflight angelegte Work Items'],
    cannotAccess: ['Repositorys', 'Pipelines', 'Löschen von Work Items'],
  },
  SERVICENOW: {
    description: 'Legt Datensätze über die ServiceNow Table API an und synchronisiert sie.',
    why: {
      '<table>: read (ACL)': 'Status von Datensätzen lesen',
      '<table>: create/write (ACL)': 'Datensätze und Arbeitsnotizen aus Befunden anlegen',
    },
    canRead: ['Von ERP Preflight angelegte Datensätze der konfigurierten Tabelle'],
    cannotAccess: ['Andere Tabellen', 'CMDB', 'Löschen von Datensätzen'],
  },
  GIT: {
    displayName: 'Git (abapGit, nur lesend)',
    description: 'Schreibgeschützter flacher Klon eines abapGit-Repositorys über HTTPS für die Clean-Core-Datenaufnahme.',
    why: { 'repository: read (clone/fetch)': 'ABAP-Quellen und abapGit-Metadaten lesen' },
    canRead: ['Dateien des konfigurierten Branches (flach, größenbegrenzt)'],
    cannotAccess: ['Push, Tags, andere Branches, Historie über Tiefe 1 hinaus'],
  },
  FILE: {
    displayName: 'Datei-Upload (Offline-Modus)',
    description: 'Reiner Dateimodus: Artefakte werden manuell hochgeladen; kein Netzwerkzugriff auf Kundensysteme.',
    why: {},
    canRead: ['Nur von Benutzern ausdrücklich hochgeladene Dateien'],
    cannotAccess: ['Jegliche Kundensysteme (keine ausgehende Verbindung)'],
  },
  LOCAL_AGENT: {
    displayName: 'Lokaler Agent',
    description: 'Rein ausgehend kommunizierender On-Premise-Agent (Geräteidentität, signierte Jobs, lokale Schwärzung).',
    why: { 'Signed job instructions': 'Verzeichnisscan- und Prüfjobs, die On-Premise ausgeführt werden' },
    canRead: ['Vom Agenten hochgeladene, geschwärzte Scan-Zusammenfassungen', 'Heartbeat des Agenten (Version, Laufzeit)'],
    cannotAccess: ['Rohdateien, sofern die Egress-Richtlinie des Geräts dies nicht erlaubt'],
  },
};

interface DescribedConnectorType {
  type: string;
  displayName: string;
  description: string;
  scopes: Array<{ scope: string; why: string }>;
  canRead: string[];
  cannotAccess: string[];
}

/** Registry entry in the requested language (English registry text is the fallback per field). */
export function localizeConnectorType<T extends DescribedConnectorType>(entry: T, locale: ApiLocale): T {
  if (locale !== 'de') return entry;
  const de = (CONNECTOR_TEXT_DE as Record<string, ConnectorTextDe | undefined>)[entry.type];
  if (!de) return entry;
  return {
    ...entry,
    displayName: de.displayName ?? entry.displayName,
    description: de.description,
    scopes: entry.scopes.map((s) => ({ ...s, why: de.why[s.scope] ?? s.why })),
    canRead: de.canRead.length === entry.canRead.length ? de.canRead : entry.canRead,
    cannotAccess: de.cannotAccess.length === entry.cannotAccess.length ? de.cannotAccess : entry.cannotAccess,
  };
}
