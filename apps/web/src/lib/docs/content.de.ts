import type { DocPage, DocSlug } from './pages';

/**
 * Deutsche Dokumentation — inhaltsgleich zur englischen Fassung (gleiche Seiten
 * und Abschnitts-IDs, geprüft in docs.test.ts). Bedienelemente der Anwendung
 * werden so genannt, wie sie in der Oberfläche beschriftet sind.
 */
export const docsDe: Record<DocSlug, DocPage> = {
  'getting-started': {
    title: 'Erste Schritte',
    description: 'Von der Registrierung bis zum exportierten Preflight-Bericht: Konto, E-Mail-Bestätigung, Projekt, Upload, Analyse, Befunde und Export.',
    sections: [
      {
        id: 'sign-up',
        title: '1. Konto anlegen',
        body: `Öffnen Sie [Registrieren](/signup) und geben Sie Organisationsnamen, Ihren Namen, eine geschäftliche E-Mail-Adresse und ein Passwort (zweimal) ein. Die Registrierung legt den Workspace Ihrer Organisation an und macht Sie zur Inhaberin bzw. zum Inhaber; Sie sind sofort angemeldet.

Das Passwort wird beim Absenden gegen die Passwortrichtlinie (Länge und Komplexität) geprüft.`,
      },
      {
        id: 'verify',
        title: '2. E-Mail-Adresse bestätigen',
        body: `Nach der Registrierung fordert ein Hinweisbanner Sie auf, **Ihre E-Mail-Adresse zu bestätigen**. Wir senden einen Bestätigungslink an die eingegebene Adresse; nach dem Öffnen ist die Adresse bestätigt und die Seite zeigt *E-mail verified*.

Solange die Adresse nicht bestätigt ist, können Sie sich anmelden, Projekte anlegen und Artefakte hochladen, aber **keine Analysen starten, keine Berichte exportieren und keine API-Schlüssel anlegen**. Der Link ist nur einmal gültig; über das Banner können Sie einen neuen anfordern.`,
      },
      {
        id: 'project',
        title: '3. Projekt anlegen',
        body: `Öffnen Sie [Projekte](/projects) und wählen Sie **New Project**. Vergeben Sie einen Namen (z. B. *S/4HANA-2023-Upgrade-Preflight*) und wählen Sie das Ziel-Release. Mit **Enter Workspace** öffnen Sie das Projekt.

Ein Projekt ist die Arbeitseinheit: Artefakte, Analyseläufe, Befunde und Berichte gehören ausschließlich Ihrer Organisation.`,
      },
      {
        id: 'upload',
        title: '4. Artefakte hochladen',
        body: `Öffnen Sie im Projekt den Reiter **Artifact Dropzone** und ziehen Sie eine Datei hinein oder wählen Sie sie aus. Akzeptiert werden \`.xml\`, \`.json\`, \`.csv\`, \`.zip\` und \`.abap\` bis 100 MB (der Betreiber kann die Grenze ändern).

Jeder Upload wird geprüft, bevor eine Engine ihn sieht:

- der Dateityp wird am Inhalt (Magic Bytes) erkannt, nicht an der Endung;
- Archive werden auf Zip-Bomben, Pfad-Traversal und Verschachtelung geprüft;
- die Datei wird auf Malware gescannt und bleibt in Quarantäne, bis sie sauber ist;
- Geheimnisse wie Passwörter und API-Tokens werden vor dem Speichern geschwärzt.

Die Dateiliste zeigt den Scan-Status (z. B. *CLEAN*) und die SHA-256-Prüfsumme, die später in der Evidenz jedes Befunds erscheint. Welches Format jede Engine erwartet, steht unter [Dateiformate je Engine](/de/docs/file-formats).`,
      },
      {
        id: 'analyze',
        title: '5. Analyse starten',
        body: `Öffnen Sie den Reiter **Analysis Launcher**, wählen Sie die hochgeladenen Dateien und die gewünschten Engines und starten Sie den Lauf (**Execute Preflight Run**). Der Lauf wird eingereiht und im Hintergrund verarbeitet; das Projekt zeigt den Status, bis er *COMPLETED* ist (oder *FAILED* / *PARTIAL* mit Begründung).

Die Engines sind deterministisch: Dieselben Dateien mit demselben Wissens-Snapshot ergeben immer dieselben Befunde. Was jede Engine prüft, steht im [Engine-Katalog](/de/docs/engines).`,
      },
      {
        id: 'findings',
        title: '6. Befunde prüfen',
        body: `Der Reiter **Findings** fasst den letzten Lauf zusammen; **Open Full Findings Ledger** öffnet die vollständige Tabelle mit Filtern nach Schweregrad, Engine und Status. Ein ausgewählter Befund zeigt:

- Befundcode, Schweregrad (als Text und Symbol, nie nur über Farbe) und Konfidenzklasse (*VERIFIED*, *RULE_DERIVED*, *INFERRED* oder *UNKNOWN*);
- die Evidenz: Artefaktpfad, Zeile und Spalte, Code-Ausschnitt und SHA-256 des Artefakts;
- den Behebungstext der Regel.

Befunde gehören zu genau einem Lauf und Wissens-Snapshot; ein neuer Lauf erzeugt neue Befunde, statt alte zu überschreiben.`,
      },
      {
        id: 'export',
        title: '7. Bericht exportieren',
        body: `Unter **Run History** bietet jeder abgeschlossene Lauf **Reports**: Erzeugen Sie einen PDF-Bericht, Excel (XLSX), CSV-Matrix, JSON-Bundle, Offline-HTML oder alle Formate als ZIP und laden Sie die Dateien herunter. **Bundle (.zip)** lädt das Reproduzierbarkeits-Bundle des Laufs.

Exporte setzen eine bestätigte E-Mail-Adresse voraus und werden im Audit-Log protokolliert.`,
      },
      {
        id: 'next',
        title: 'Nächste Schritte',
        body: `- Laden Sie Kolleginnen und Kollegen unter **Settings → Members** ein.
- Legen Sie unter **Settings** einen API-Schlüssel an, um [API und CLI](/de/docs/api-cli) zu nutzen.
- Probieren Sie die [kostenlosen Tools](/de/tools) für Einzelfragen ohne Workspace.`,
      },
    ],
  },
  engines: {
    title: 'Engine-Katalog',
    description: 'Alle Analyse-Engines mit Eingabevertrag, Befundcodes und Behebungstexten — erzeugt aus dem Live-Engine-Katalog.',
    sections: [
      {
        id: 'how-engines-work',
        title: 'So arbeiten die Engines',
        body: `Jede Engine ist ein deterministisches Regelwerk über geparsten Artefakten. Sie prüft ihre Eingabe gegen einen deklarierten Vertrag, wertet ihre Regeln aus und liefert Befunde mit Evidenz (Artefaktpfad, Zeile und Spalte, Ausschnitt, SHA-256) und einer Konfidenzklasse. Keine Engine lässt ein Sprachmodell über einen Befund entscheiden; KI-gestützte Erläuterungen sind auf die Konfidenz *INFERRED* begrenzt.

Passt eine Eingabe nicht zum Vertrag, meldet die Engine einen ihrer Eingabeprüfungs-Codes (z. B. \`…_INVALID_INPUT\` oder \`…_PARSE_ERROR\`) statt eines Ergebnisses.`,
      },
    ],
  },
  'file-formats': {
    title: 'Dateiformate je Engine',
    description: 'Welche Exporte und Dateien jede Analyse-Engine akzeptiert — aus den deklarierten Eingabeverträgen der Engines.',
    sections: [
      {
        id: 'upload-rules',
        title: 'Upload-Regeln für alle Engines',
        body: `- Laden Sie \`.xml\`, \`.json\`, \`.csv\`, \`.zip\` oder \`.abap\` bis je 100 MB hoch (Betreibereinstellung).
- Archive: höchstens Kompressionsverhältnis 100:1, insgesamt 500 MB entpackt, 10 000 Einträge und 2 Ebenen verschachtelter Archive; Einträge mit absoluten Pfaden oder \`../\` werden abgewiesen.
- XML wird mit deaktivierten DTDs, Entity-Deklarationen und externen Referenzen geparst.
- Geheimnisse werden vor dem Speichern geschwärzt; die Anzahl der Schwärzungen wird beim Upload angezeigt.`,
      },
    ],
  },
  security: {
    title: 'Sicherheit & Datenverarbeitung',
    description: 'Wie Kundenartefakte isoliert, geprüft, gespeichert und gelöscht werden — und was die kostenlosen Tools sehen.',
    sections: [
      {
        id: 'isolation',
        title: 'Mandantentrennung',
        body: `Jede Organisation ist ein Mandant. Projekte, Artefakte, Analysen, Befunde und Berichte tragen die Organisations-ID, und PostgreSQL-Row-Level-Security stellt sicher, dass eine Anfrage nur Zeilen der angemeldeten Organisation sieht. Dateien liegen im Objektspeicher unter einem Pfad je Organisation und Projekt; Download-Links sind vorsigniert und laufen nach höchstens 15 Minuten ab.`,
      },
      {
        id: 'ingestion',
        title: 'Upload-Pipeline',
        body: `Uploads werden am Inhalt typgeprüft, archivgeprüft (Verhältnis, Größe, Verschachtelung, Pfad-Traversal), auf Malware gescannt und von Geheimnissen bereinigt, bevor eine Engine sie lesen kann. Dateien, die eine Prüfung nicht bestehen, bleiben in Quarantäne und werden nie analysiert.`,
      },
      {
        id: 'analysis',
        title: 'Analysedienst',
        body: `Der Analysedienst ist zustandslos: Er erhält die Artefakte eines Laufs, parst sie mit gehärteten Parsern, wertet die Regeln aus und liefert Befunde zurück. Auf Benutzer-, Abrechnungs- oder Mandantentabellen hat er keinen Zugriff.`,
      },
      {
        id: 'retention',
        title: 'Aufbewahrung, Export und Löschung',
        body: `Organisationsinhaber legen Aufbewahrungsfristen für Artefakte und Berichte unter **Settings → Data retention** fest; abgelaufene Daten löscht ein Hintergrundjob. Kontoinhaber können ihre personenbezogenen Daten unter **Settings → Account** exportieren und ihr Konto löschen. Sicherheitsrelevante Aktionen (Anmeldungen, Änderungen an API-Schlüsseln, Exporte, Mitgliederänderungen) stehen im Audit-Log unter **Settings → Audit log**.`,
      },
      {
        id: 'free-tools',
        title: 'Kostenlose Tools und öffentliche Seiten',
        body: `Die [kostenlosen Tools](/de/tools) und die öffentlichen SAP-Objektseiten lesen nur globales, geprüftes Wissen (offizielle SAP-Freigabedaten und geprüfte Artikel). Workspace-Daten lesen sie nie. Die XML-Feldprüfung parst das eingefügte Dokument nur im Speicher und speichert nichts.`,
      },
      {
        id: 'more',
        title: 'Mehr',
        body: `Siehe [Sicherheitsübersicht](/de/security), [Trust Center](/trust) und die [Liste der Unterauftragsverarbeiter](/de/legal/subprocessors).`,
      },
    ],
  },
  'api-cli': {
    title: 'API & CLI',
    description: 'ERP Preflight aus Skripten und CI nutzen: REST-API mit API-Schlüsseln, die CLI erp-preflight und der MCP-Endpunkt.',
    sections: [
      {
        id: 'api-keys',
        title: 'API-Schlüssel',
        body: `Organisationsinhaber und Security-Admins legen API-Schlüssel unter **Settings** an (bestätigte E-Mail-Adresse erforderlich). Ein Schlüssel wird einmal angezeigt, beginnt mit \`erppf_live_\` und trägt Scopes:

- \`projects:read\`, \`projects:write\`
- \`analysis:read\`, \`analysis:run\`
- \`findings:read\`, \`findings:write\`
- \`reports:read\`

Senden Sie den Schlüssel im Header \`x-api-key\`. Schlüssel sind an ihre Organisation gebunden; Leseanfragen brauchen mindestens einen Scope, ändernde Anfragen einen Write- oder Run-Scope. Konto-, Mitglieder-, Abrechnungs- und Schlüsselverwaltung erfordern immer eine interaktive Anmeldung.`,
      },
      {
        id: 'rest',
        title: 'REST-API',
        body: `Alle Endpunkte liegen unter \`/api/v1\`. Typischer Automatisierungsablauf:

\`\`\`
POST /api/v1/projects                              Projekt anlegen
POST /api/v1/projects/{projectId}/files            Artefakt hochladen (Multipart-Feld "file")
POST /api/v1/analyses                              {"projectId", "engineTypes": [...], "fileIds": [...]}
GET  /api/v1/analyses/{analysisId}                 abfragen bis COMPLETED / FAILED / PARTIAL
GET  /api/v1/findings?projectId={projectId}        Befunde mit Evidenz
POST /api/v1/projects/{projectId}/analyses/{analysisId}/export   {"format": "PDF"}
\`\`\`

Exportformate: \`PDF\`, \`XLSX\`, \`CSV\`, \`JSON_BUNDLE\`, \`HTML_OFFLINE\`, \`ZIP_ALL\`. Die vollständige, generierte OpenAPI-Referenz ist unten verlinkt.`,
      },
      {
        id: 'cli',
        title: 'CLI erp-preflight',
        body: `Die CLI (Paket \`@erppreflight/cli\`, Node.js 18 oder neuer) nutzt dieselbe API mit einem API-Schlüssel. Richten Sie sie mit \`ERP_PREFLIGHT_API_URL\` auf Ihre Instanz (z. B. \`https://api.example.com/api/v1\`) und speichern Sie den Schlüssel einmalig:

\`\`\`
erp-preflight login --key erppf_live_…
erp-preflight project list
erp-preflight project create --name "S/4HANA 2023 Upgrade" --release S4H_2023
erp-preflight report download <analysis-id> --out bundle.zip
erp-preflight matrix
erp-preflight status
\`\`\`

Der Schlüssel kann auch pro Aufruf über \`ERP_PREFLIGHT_API_KEY\` übergeben werden. \`report download\` speichert das Reproduzierbarkeits-Bundle eines Laufs und gibt dessen SHA-256 aus.

\`erp-preflight analyze clean-core <pfad>\`, \`analyze api-diff\` und \`analyze mfs\` sind **lokale Schnellprüfungen**, die auf Ihrem Rechner laufen und nichts hochladen; sie decken nur eine kleine Auswahl an Mustern ab und sind als CI-Vorprüfung gedacht. Die vollständige Analyse läuft in einem Projekt (Upload + Analysis Launcher oder \`POST /api/v1/analyses\`).`,
      },
      {
        id: 'mcp',
        title: 'MCP für Coding-Agenten',
        body: `\`POST /api/v1/mcp\` ist ein JSON-RPC-2.0-Endpunkt mit den Model-Context-Protocol-Methoden \`tools/list\` und \`tools/call\` (z. B. \`search_knowledge\`). \`erp-preflight mcp\` startet dieselben Tools als lokalen stdio-MCP-Server für Agenten, die einen Befehl erwarten.`,
      },
    ],
  },
  'local-agent': {
    title: 'Lokaler Agent',
    description: 'Was heute auf Ihrer Seite läuft und was für private Landschaften geplant ist.',
    sections: [
      {
        id: 'today',
        title: 'Heute verfügbar',
        body: `Einen separat zu installierenden Agent-Dienst gibt es noch nicht. Lokal läuft heute:

- die CLI \`erp-preflight\` mit ihrem stdio-MCP-Server, authentifiziert mit einem API-Schlüssel der Organisation — geeignet für CI-Pipelines und Entwicklerrechner;
- die lokalen Schnellprüfungen der CLI, die Dateien auf Ihrem Rechner lesen und nichts hochladen.

Daten aus SAP-Systemen gelangen als hochgeladene Exporte (Dateien, die Sie mit Standard-SAP-Transaktionen oder -Werkzeugen erzeugen) über Web-App, API oder CLI zu ERP Preflight.`,
      },
      {
        id: 'planned',
        title: 'Geplant',
        body: `Ein lokaler Agent, der neben privaten SAP-Landschaften läuft und planmäßig schreibgeschützte Extrakte abholt, ist auf der Roadmap. Bis dahin bleiben Uploads der unterstützte Weg; diese Seite beschreibt den Agenten, sobald er verfügbar ist.`,
      },
    ],
  },
  faq: {
    title: 'FAQ',
    description: 'Kurze Antworten auf die häufigsten Fragen.',
    sections: [],
    faq: [
      {
        question: 'Verbindet sich ERP Preflight mit meinem SAP-System?',
        answer:
          'Eine direkte Systemverbindung ist nicht nötig. Sie laden Exporte hoch (XML, JSON, CSV, ABAP-Quellen, ZIP-Archive), die Sie in SAP erzeugen; die Analyse arbeitet auf diesen Dateien.',
      },
      {
        question: 'Werden die Befunde von einer KI erzeugt?',
        answer:
          'Nein. Befunde stammen aus deterministischen Regeln mit zeilengenauer Evidenz. Wo KI bei Erläuterungen hilft, ist die Konfidenz dieser Inhalte auf INFERRED begrenzt und entsprechend gekennzeichnet.',
      },
      {
        question: 'Warum kann ich keine Analyse starten?',
        answer:
          'Analysen, Berichtsexporte und API-Schlüssel setzen eine bestätigte E-Mail-Adresse voraus. Öffnen Sie den Bestätigungslink aus der Registrierungs-E-Mail oder fordern Sie über das Banner einen neuen an.',
      },
      {
        question: 'Welche Datei braucht eine Engine?',
        answer:
          'Jede Engine dokumentiert ihren Eingabevertrag — akzeptierte Formate und erforderliche Inhalte. Siehe die Seite Dateiformate in dieser Dokumentation.',
      },
      {
        question: 'Können andere Kunden meine Daten sehen?',
        answer:
          'Nein. Jede Mandantentabelle ist durch Row-Level-Security geschützt, Dateien liegen unter Pfaden je Organisation und Download-Links laufen nach höchstens 15 Minuten ab. Die kostenlosen Tools lesen nur globales SAP-Wissen.',
      },
      {
        question: 'Woher stammen die Clean-Core-Freigabeinformationen?',
        answer:
          'Aus dem offiziellen SAP Cloudification Repository, synchronisiert in unveränderliche Wissens-Snapshots. Jede öffentliche Seite und jedes Tool zeigt den Snapshot und das Datum des letzten Abrufs.',
      },
    ],
  },
};
