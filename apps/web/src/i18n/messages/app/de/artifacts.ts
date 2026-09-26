import type { artifacts as En } from '../en/artifacts';

export const artifacts: typeof En = {
  eyebrow: 'Artefakt-Referenz',
  noPii: 'Keine Speicherung personenbezogener Daten',
  title: 'Unterstützte Artefaktformate',
  intro:
    'Welche SAP-Artefakte die Preflight-Engines verarbeiten, wie Sie sie exportieren und wie Uploads bereinigt werden. Der Upload selbst erfolgt im Projekt-Workspace.',
  securityTitle: 'Automatische Entfernung von Geheimnissen und personenbezogenen Daten',
  securityBody:
    'Jeder Upload wird auf Schadsoftware geprüft, der Dateityp wird anhand des Inhalts verifiziert, und Zugangsdaten werden vor dem Parsen per Muster- und Entropieerkennung entfernt.',
  trustLink: 'Trust Center öffnen →',
  searchPlaceholder: 'Artefakte oder Transaktionscodes suchen (z. B. SFP, OPD) …',
  searchLabel: 'Artefakte durchsuchen',
  categoriesLabel: 'Nach Kategorie filtern',
  allCategories: 'Alle Kategorien',
  empty: 'Kein Artefakt entspricht dem aktuellen Filter.',
  tcodes: 'SAP-Transaktionen:',
  howTo: 'Export aus SAP',
  engines: 'Engines:',
  upload: 'In einem Projekt hochladen',
  families: {
    'opd-matrix': {
      name: 'Entscheidungstabellen der Ausgabesteuerung (OPD)',
      summary: 'Regeln der Entscheidungstabellen für Ausgabearten, Versandkanäle (EMAIL, PRINT, EDI), E-Mail-Empfänger und Absenderadressen.',
      steps: [
        'Starten Sie die Transaktion OPD in SAP S/4HANA.',
        'Wählen Sie den Anwendungsobjekttyp (z. B. BILLING_DOCUMENT oder PURCHASE_ORDER).',
        'Wählen Sie bei den Tabellenoperationen Exportieren → Entscheidungstabelle als XML oder Excel.',
        'Stellen Sie sicher, dass alle Findungsschritte (Ausgabeart, Empfänger, Kanal, Druckereinstellungen, E-Mail-Einstellungen) enthalten sind.',
      ],
      note: 'Empfänger und E-Mail-Domänen werden vor der Analyse pseudonymisiert (HMAC SHA-256).',
    },
    'form-xdp': {
      name: 'Formularlayouts und XML der Adobe Document Services (ADS)',
      summary: 'Interaktive und Druckformulare (Adobe LiveCycle XDP) mit Datenbindungen, Teilformularen und Schriftdefinitionen.',
      steps: [
        'Öffnen Sie die Transaktion SFP (Form Builder).',
        'Geben Sie den Formularnamen ein (z. B. S4H_INVOICE_LAYOUT).',
        'Wählen Sie Layout → Werkzeuge → Layout als XDP-XML exportieren.',
        'Alternativ exportieren Sie den Schnittstellenkontext über Kontext → XML-Schema exportieren.',
      ],
      note: 'Sensible Testrechnungswerte und personenbezogene Daten werden durch Muster- und Entropiescanner entfernt.',
    },
    'custom-code-abapgit': {
      name: 'Kundeneigener Code (abapGit-Export)',
      summary: 'Kundeneigene Z- und Y-Pakete, BAdI-Implementierungen, CDS-Views und ABAP-Klassen für die Clean-Core-Stufeneinordnung.',
      steps: [
        'Starten Sie abapGit im Entwicklungssystem (Transaktion SE38 → ZABAPGIT).',
        'Wählen Sie das kundeneigene Entwicklungspaket (z. B. ZCORE_MIGRATION).',
        'Wählen Sie im Repository-Menü „Export as ZIP“.',
        'Speichern Sie das Archiv lokal.',
      ],
      note: 'Eingebettete Datenbank-Zugangsdaten, RFC-Passwörter und fest codierte Tokens werden durch deterministische Platzhalter ersetzt.',
    },
    'spro-cbc-config': {
      name: 'SPRO-/IMG-Customizing-Tabellen',
      summary: 'Customizing-Tabellen (z. B. T001G, T005, TVKO, T161), mit denen bestehende Geschäftsregeln auf Cloud CBC / SSCUI abgebildet werden.',
      steps: [
        'Öffnen Sie in der Transaktion SPRO die Customizing-Aktivität.',
        'Wählen Sie Tabellensicht → Drucken / Exportieren → Lokale Datei (Tabellenkalkulation oder Text mit Trennzeichen).',
        'Alternativ verwenden Sie SE16N mit dem Namen der Customizing-Tabelle und exportieren alle Einträge des Mandanten.',
      ],
      note: 'Mandantenspezifische Geschäftskennungen können in den Datenschutzeinstellungen der Organisation maskiert werden.',
    },
    'api-metadata': {
      name: 'Metadaten von OData- und SOAP-Services',
      summary: 'Entity Data Model (EDMX) oder WSDL-Spezifikationen, die API-Verträge, Entitätsmengen und Pflichtparameter festlegen.',
      steps: [
        'Rufen Sie in der Transaktion /IWFND/GW_CLIENT die Service-URL mit $metadata auf (z. B. /sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata).',
        'Führen Sie die Anfrage aus und wählen Sie Datei → Antworttext als XML exportieren.',
        'Für SOAP-Services öffnen Sie SOAMANAGER, wählen den Webservice und laden die WSDL-Datei herunter.',
      ],
      note: 'Authentifizierungs-Header, API-Schlüssel und Sitzungs-Cookies werden beim Einlesen der Datei entfernt.',
    },
    'transport-requests': {
      name: 'Objektlisten von CTS-Transportaufträgen',
      summary: 'Kopfdaten von Transportaufträgen, Objektlisten (E070 / E071) und Software-Collection-Manifeste für das Ziel-Release.',
      steps: [
        'Geben Sie in der Transaktion SE01 oder SE09 die Transportaufträge ein (z. B. TRK900100 bis TRK900110).',
        'Wählen Sie Anzeigen → Auftrag → Objektliste → In lokale Datei exportieren (Text mit Tabulatoren oder CSV).',
        'Nehmen Sie alle Aufgaben und Stücklisteneinträge auf, damit transportübergreifende Abhängigkeiten geprüft werden können.',
      ],
      note: 'Benutzernamen der Entwickler und Systemnamen bleiben für die Abhängigkeitsverfolgung erhalten, erscheinen aber nicht in Zusammenfassungen.',
    },
    'mfs-telegrams': {
      name: 'Telegrammpuffer und Protokolle von SAP EWM MFS',
      summary: 'Telegramme zwischen SAP EWM und den SPS-Steuerungen automatisierter Fördertechnik und Regalbediengeräte.',
      steps: [
        'Öffnen Sie den Lagerverwaltungsmonitor (Transaktion /SCWM/MON).',
        'Navigieren Sie zu Materialflusssystem (MFS) → Telegramme.',
        'Grenzen Sie den Zeitraum ein (z. B. 15 Minuten vor und während des Stillstands).',
        'Wählen Sie Liste → Exportieren → Tabellenkalkulation oder Textdatei mit Trennzeichen.',
      ],
      note: 'Barcodes von Handling Units und Personalkennungen im Lager können durch deterministische SHA-256-Tokens ersetzt werden.',
    },
    'change-pointer-tbd52': {
      name: 'Konfiguration der Änderungszeiger (BD21 / BD52)',
      summary: 'Änderungsbelegobjekte und Tabellenfelder, die asynchrone Benachrichtigungen an externe Systeme auslösen.',
      steps: [
        'Geben Sie in der Transaktion BD52 den Nachrichtentyp ein (z. B. MATMAS oder DEBMAS).',
        'Exportieren Sie die konfigurierte Feldliste (Tabellenname, Feldname) als CSV oder Excel.',
        'Erfassen Sie zusätzlich den Aktivierungsstatus des Nachrichtentyps in der Transaktion BD50.',
      ],
      note: 'Benötigt werden nur Tabellen- und Feldnamen; es werden keine Geschäftswerte eingelesen.',
    },
  },
};
