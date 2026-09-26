import type { PublicToolsMessages } from './public-tools.en';

/** Deutsche Texte der kostenlosen Tools, der SAP-Objektseiten und der Dokumentation. */
export const publicToolsDe: PublicToolsMessages = {
  nav: {
    tools: 'Kostenlose Tools',
    docs: 'Doku',
  },
  common: {
    dataSource: 'Datenquelle',
    snapshot: 'Wissens-Snapshot #{seq}',
    snapshotPublished: 'veröffentlicht am {date}',
    lastRetrieved: 'Zuletzt aus der Quelle abgerufen',
    lastVerified: 'Zuletzt verifiziert',
    trustLevel: 'Vertrauensstufe',
    noSnapshot: 'Es wurde noch kein Wissens-Snapshot veröffentlicht.',
    sourcesTitle: 'Quellen dieses Tools',
    independence:
      'ERP Preflight ist ein unabhängiges Produkt und steht in keiner Verbindung zur SAP SE. SAP, ABAP, Fiori und S/4HANA sind Marken der SAP SE.',
    publicOnly:
      'Angezeigt wird ausschließlich globales, geprüftes Wissen. Kundendaten aus Workspaces werden von den kostenlosen Tools nie verwendet.',
    ctaTitle: 'Workspace anlegen → vollständige Projektanalyse starten',
    ctaBody:
      'Die kostenlosen Tools beantworten jeweils eine Frage. Ein Workspace analysiert Ihren gesamten Export oder Code mit demselben Wissen und belegt jeden Befund mit zeilengenauer Evidenz, Konfidenz und Behebungshinweis.',
    ctaButton: 'Kostenlosen Workspace anlegen',
    ctaDocs: 'So funktioniert eine Projektanalyse',
    retry: 'Erneut versuchen',
    rateLimited: 'Zu viele Anfragen aus Ihrem Netzwerk. Bitte warten Sie eine Minute und versuchen Sie es erneut.',
    unavailable: 'Das Tool ist vorübergehend nicht verfügbar. Bitte versuchen Sie es gleich noch einmal.',
    loading: 'Wird geladen…',
    results: '{count} Treffer',
    showMore: 'Mehr anzeigen',
    previous: 'Zurück',
    next: 'Weiter',
    pageOf: 'Seite {page} von {pages}',
    openObjectPage: 'Objektseite öffnen',
    noSlug: 'Für dieses Schlüsselformat gibt es keine öffentliche Seite',
    notFoundQuery: 'Im aktuellen Snapshot passt nichts zu „{query}“.',
    release: 'Release',
    edition: 'Edition',
    state: 'Status',
    successors: 'Nachfolger',
    none: 'keiner',
    classicApi: 'Klassifizierung als Classic API',
    level: 'Clean-Core-Level {level}',
    evidenceFrom: 'Evidenz: {source}',
  },
  provenance: {
    'knowledge-graph': {
      source:
        'SAP Cloudification Repository (offizielle SAP-Freigabedaten), synchronisiert in unveränderliche ERP-Preflight-Wissens-Snapshots.',
      trust: 'Offizielles SAP-Repository — Fakten je Release genau wie veröffentlicht; ein Nachfolger wird nie abgeleitet.',
    },
    'document': {
      source:
        'Das XML-Dokument, das Sie einfügen oder laden. Es wird vom Analysedienst nur im Speicher geparst und nicht gespeichert.',
      trust: 'Deterministisches Parsen Ihres Dokuments — die Antwort ist genau das, was das Dokument enthält.',
    },
    'decision-tree': {
      source:
        'Von ERP Preflight kuratierter Entscheidungsbaum auf Basis des Regelkatalogs der Engine Fiori 403 Root-Cause Doctor und der SAP-Standardtransaktionen zur Fehleranalyse.',
      trust: 'Kuratierte Regel — grenzt die Ursachenkategorie ein, diagnostiziert Ihr System aber nicht.',
    },
    'search': {
      source:
        'Geprüfte ERP-Preflight-Wissensartikel, der globale SAP-Wissensgraph (Cloudification Repository) und der Regelkatalog der Analyse-Engines.',
      trust: 'Geprüfte Inhalte und offizielle SAP-Repository-Daten; jeder Treffer zeigt sein eigenes Prüf- bzw. Abrufdatum.',
    },
  },
  trust: {
    OFFICIAL_REPOSITORY: 'Offizielles SAP-Repository',
    OFFICIAL_DOCUMENTATION: 'Offizielle SAP-Dokumentation',
    OFFICIAL_SUPPORT: 'Offizielle SAP-Support-Inhalte',
    OFFICIAL_COMMUNITY: 'Offizielle SAP-Community-Inhalte',
    CURATED_RULE: 'Kuratierte Regel',
    THIRD_PARTY: 'Drittquelle',
    CUSTOMER_EVIDENCE: 'Kundenevidenz',
    INFERRED: 'Abgeleitet',
  },
  states: {
    RELEASED: 'Freigegeben',
    DEPRECATED: 'Veraltet (deprecated)',
    NOT_RELEASED: 'Nicht freigegeben',
    NOT_TO_BE_RELEASED_STABLE: 'Nicht freigegeben (stabil gehalten)',
    CLASSIC_API: 'Classic API',
    NO_API: 'Keine API',
    SUPPORTED: 'Unterstützt',
    BLOCKED: 'Gesperrt',
    UNKNOWN: 'Unbekannt',
  },
  verdicts: {
    RELEASED: 'Freigegeben — kein Nachfolger nötig',
    RELEASED_ELSEWHERE: 'In diesem Release nicht freigegeben, in einer anderen Edition freigegeben',
    SUCCESSOR_AVAILABLE: 'Nicht freigegeben — offiziellen Nachfolger verwenden',
    CONCEPT_AVAILABLE: 'Nicht freigegeben — SAP nennt ein Nachfolgekonzept',
    NOT_RELEASED_NO_SUCCESSOR: 'Nicht freigegeben — SAP nennt keinen Nachfolger',
    CLASSIC_API_ONLY: 'Nur eine Classic-API-Klassifizierung ist veröffentlicht',
    NO_OFFICIAL_STATE: 'Kein offizieller Freigabestatus im aktuellen Snapshot',
  },
  verdictHelp: {
    RELEASED: 'Das Objekt gehört in diesem Release zum freigegebenen ABAP-Cloud-API-Vertrag.',
    RELEASED_ELSEWHERE: 'Siehe Release-Tabelle: Der Freigabestatus unterscheidet sich zwischen den Editionen.',
    SUCCESSOR_AVAILABLE: 'SAP nennt die folgenden Objekte als Ersatz.',
    CONCEPT_AVAILABLE: 'SAP beschreibt den Ersatz als Konzept statt als einzelnes Objekt.',
    NOT_RELEASED_NO_SUCCESSOR:
      'Es ist kein Nachfolger veröffentlicht. Kapseln Sie die Verwendung in einer eigenen freigegebenen API oder stellen Sie eine Influence-Anfrage bei SAP.',
    CLASSIC_API_ONLY:
      'Classic APIs (Clean-Core-Level B) bleiben in SAP Cloud ERP Private nutzbar, sind aber nicht für ABAP Cloud freigegeben.',
    NO_OFFICIAL_STATE: 'Wir raten nicht: Ohne offiziellen Status gibt es keine Aussage.',
  },
  editions: {
    CLOUD_PRIVATE: 'SAP Cloud ERP Private',
    CLOUD_PUBLIC: 'SAP Cloud ERP',
    ABAP_ENVIRONMENT: 'SAP BTP ABAP Environment',
  },
  relations: {
    SUCCESSOR: 'Nachfolger',
    REPLACES: 'Wird durch dieses Objekt ersetzt',
    SHARES_SUCCESSOR: 'Gleicher Nachfolger',
    CO_SUCCESSOR: 'Ebenfalls Nachfolger desselben Objekts',
  },
  changeTypes: {
    ADDED: 'Hinzugefügt',
    REMOVED: 'Entfernt',
    NEWLY_RELEASED: 'Neu freigegeben',
    NEWLY_DEPRECATED: 'Neu als veraltet markiert',
    RELEASE_WITHDRAWN: 'Freigabe zurückgezogen',
    STATE_CHANGED: 'Status geändert',
    SUCCESSOR_CHANGED: 'Nachfolger geändert',
    ATTRIBUTES_CHANGED: 'Attribute geändert',
  },
  severity: {
    BLOCKER: 'Blocker',
    CRITICAL: 'Kritisch',
    MAJOR: 'Hoch',
    MEDIUM: 'Mittel',
    MINOR: 'Gering',
    LOW: 'Niedrig',
    INFO: 'Info',
  },
  hub: {
    metaTitle: 'Kostenlose SAP-Tools: Clean-Core-Lookup, Nachfolger-Suche, API-Deprecations — ERP Preflight',
    metaDescription:
      'Kostenlose SAP-Tools auf Basis offizieller Freigabedaten: Clean-Core-Objekt-Lookup, Nachfolger für Legacy-Objekte, API-Deprecation-Lookup, Formular-XML-Feldprüfung, Fiori-403-Entscheidungsbaum und Wissenssuche.',
    title: 'Kostenlose SAP-Preflight-Tools',
    intro:
      'Jeweils eine Frage beantworten — jedes Ergebnis nennt Datenquelle, Wissens-Snapshot und Vertrauensstufe der Evidenz. Für ein ganzes System starten Sie eine Projektanalyse.',
    breadcrumb: 'Kostenlose Tools',
    open: 'Tool öffnen',
  },
  tools: {
    'clean-core-lookup': {
      name: 'Clean-Core-Objekt-Lookup',
      short: 'Ist eine Tabelle, CDS-View, Klasse oder ein Funktionsbaustein für ABAP Cloud freigegeben?',
    },
    'cloud-successor': {
      name: 'Legacy-Objekt → Cloud-Nachfolger',
      short: 'Welches freigegebene Objekt ersetzt eine klassische Tabelle, BAPI oder einen Funktionsbaustein — je Release?',
    },
    'api-deprecations': {
      name: 'API-Deprecation-Lookup',
      short: 'Freigegebene und veraltete APIs je Release, ihre Nachfolger und ein Vergleich zweier Releases.',
    },
    'xml-field-checker': {
      name: 'Formular-XML-Feldprüfung',
      short: 'Existiert ein Feldpfad in Ihren Formulardaten, welchen Wert hat er, liegt es an Namespaces?',
    },
    'fiori-403': {
      name: 'Fiori-403-Entscheidungsbaum',
      short: 'Geführte Fragen zur wahrscheinlichen Ursachenkategorie eines Fiori-Fehlers „nicht berechtigt“ — und welche Evidenz Sie sammeln sollten.',
    },
    search: {
      name: 'Wissens- & Fehlersuche',
      short: 'Durchsucht die geprüfte Wissensdatenbank, SAP-Objekte und die Befundcodes der Analyse-Engines.',
    },
  },
  cleanCore: {
    metaTitle: 'Clean-Core-Objekt-Lookup — ist dieses SAP-Objekt für ABAP Cloud freigegeben? | ERP Preflight',
    metaDescription:
      'Kostenloser Lookup für SAP-Tabellen, CDS-Views, Klassen, Funktionsbausteine und BAdIs: Freigabestatus je Release von SAP Cloud ERP / Private Edition und offizieller Nachfolger, aus dem SAP Cloudification Repository.',
    label: 'Name des SAP-Objekts',
    placeholder: 'z. B. MARA, BSEG, I_PRODUCT, CL_ABAP_TYPEDESCR',
    hint: 'Geben Sie einen Objektnamen ein. Exakte, Präfix- und unscharfe Treffer werden mit Freigabestatus je Edition und dem zu verwendenden Nachfolger angezeigt.',
    emptyHint:
      'Objekte, die SAP nicht im Cloudification Repository führt, sind nicht für ABAP Cloud freigegeben. Prüfen Sie die Schreibweise oder suchen Sie nach dem Präfix.',
    match: 'Treffer: {type}',
  },
  successor: {
    metaTitle: 'Legacy-SAP-Objekt → Cloud-Nachfolger finden | ERP Preflight',
    metaDescription:
      'Finden Sie den freigegebenen Nachfolger einer klassischen SAP-Tabelle, BAPI oder eines Funktionsbausteins je Release von S/4HANA und SAP Cloud ERP — aus dem offiziellen SAP Cloudification Repository.',
    label: 'Legacy-Objekt oder Transaktion',
    placeholder: 'z. B. MARA, BSEG, BAPI_PO_CREATE1, VBAK',
    hint: 'Geben Sie eine Tabelle, BAPI, einen Funktionsbaustein oder ein anderes Entwicklungsobjekt ein. Die Antwort ist der offizielle Nachfolger je Release — nie eine Vermutung.',
    tcodeCoverage:
      'Transaktionscodes sind nicht Teil der aktuellen Wissensquellen (das SAP Cloudification Repository führt Entwicklungsobjekte). Schlagen Sie für eine Transaktion die verwendeten Tabellen oder BAPIs nach — ERP Preflight erfindet keine Transaktionszuordnung.',
    releaseTable: 'Status und Nachfolger je Release',
    successorState: 'Status des Nachfolgers in diesem Release',
  },
  api: {
    metaTitle: 'SAP-API-Deprecation-Lookup & Release-Vergleich | ERP Preflight',
    metaDescription:
      'Freigegebene und veraltete SAP-APIs (CDS-Views, Klassen, Behavior Definitions, BAPIs) je Release mit Nachfolgern sowie ein Vergleich zwischen Releases — aus offiziellen SAP-Freigabedaten.',
    modeSearch: 'API nachschlagen',
    modeDeprecated: 'Veraltete APIs durchsuchen',
    modeDiff: 'Zwei Releases vergleichen',
    label: 'Name der API',
    placeholder: 'z. B. I_PURCHASEORDERTP, CL_ABAP_TYPEDESCR, I_MAINTENANCENOTIFICATIONTP',
    hint: 'Sucht CDS-Views, Klassen, Interfaces, Behavior Definitions, BAPIs und OData-Services.',
    deprecatedIntro: '{count} APIs sind im neuesten Release von SAP Cloud ERP Private als veraltet markiert.',
    firstReleased: 'Erstmals freigegeben in',
    firstDeprecated: 'Veraltet seit',
    current: 'Aktueller Status',
    notYet: 'nicht veraltet',
    neverReleased: 'nie freigegeben',
    diffIntro: 'Änderungen des Freigabevertrags zwischen zwei Releases (nur globales SAP-Wissen).',
    from: 'Von Release',
    to: 'Nach Release',
    changeType: 'Art der Änderung',
    allChanges: 'Alle Änderungen',
    compare: 'Vergleichen',
    sameRelease: 'Wählen Sie zwei unterschiedliche Releases.',
    diffEmpty: 'Keine Unterschiede für diese Auswahl.',
    previousState: 'Vorher',
    currentState: 'Nachher',
  },
  xml: {
    metaTitle: 'Formular-XML-Feldprüfung — existiert mein Feldpfad? | ERP Preflight',
    metaDescription:
      'Prüfen Sie einen Feldpfad gegen Ihr SAP-Formulardaten-XML: Existiert er, welchen Wert hat er, und sind Namespaces der Grund für eine leere Bindung? Sicher im Speicher geparst, nichts wird gespeichert.',
    xmlLabel: 'XML-Dokument',
    xmlHelp:
      'Fügen Sie das Formulardaten- bzw. Schnittstellen-XML ein oder laden Sie eine Datei (max. 90 000 Zeichen). Es wird nur im Speicher geparst und nie gespeichert.',
    upload: 'XML-Datei laden',
    pathLabel: 'Feldpfad',
    pathHelp: '/root/kind, //beliebige-Tiefe, item[2] für eine Position, präfix:name für Namespaces, @attr für Attribute.',
    pathPlaceholder: '/data/Header/PurchaseOrder',
    nsLabel: 'Namespace-Präfixe (optional)',
    nsHelp: 'Eines pro Zeile: präfix=namespace-uri. Im Dokument deklarierte Präfixe werden automatisch aufgelöst.',
    submit: 'Feld prüfen',
    checking: 'Wird geprüft…',
    reset: 'Leeren',
    exists: 'Der Pfad existiert — {count} Treffer',
    missing: 'Der Pfad existiert in diesem Dokument nicht',
    notWellFormed: 'Das Dokument wurde nicht geprüft',
    value: 'Wert',
    empty: '(leer)',
    truncated: 'gekürzt',
    location: 'Zeile {line}, Spalte {column}',
    namespace: 'Namespace',
    noNamespace: 'kein Namespace',
    children: '{count} Unterelemente',
    issues: 'Befunde',
    document: 'Dokument',
    root: 'Wurzelelement',
    elements: '{count} Elemente, Tiefe {depth}',
    declared: 'Deklarierte Präfixe',
    fileTooLarge: 'Die Datei ist größer als 90 000 Zeichen.',
    fileUnreadable: 'Die Datei konnte nicht als Text gelesen werden.',
    severity: {
      ERROR: 'Fehler',
      WARNING: 'Warnung',
      INFO: 'Hinweis',
    },
    errors: {
      xmlRequired: 'Fügen Sie ein XML-Dokument ein oder laden Sie eines hoch.',
      xmlTooLarge: 'Das XML-Dokument ist größer als 90 000 Zeichen.',
      pathRequired: 'Geben Sie einen Feldpfad ein.',
      pathTooLong: 'Der Feldpfad ist länger als 300 Zeichen.',
      pathSlash: "Der Feldpfad muss mit '/' oder '//' beginnen.",
      namespacesInvalid: 'Ein präfix=uri pro Zeile (höchstens 20).',
    },
    privacy: 'Deterministische Prüfung: dasselbe Dokument mit demselben Pfad ergibt immer dieselbe Antwort. Nichts wird gespeichert oder protokolliert.',
    unsaved: 'Ihr XML-Dokument und der Feldpfad gehen verloren. Seite trotzdem verlassen?',
  },
  fiori: {
    metaTitle: 'Fiori 403 / „nicht berechtigt“ — Entscheidungsbaum | ERP Preflight',
    metaDescription:
      'Geführte, deterministische Fragen grenzen einen Fiori-403- oder „nicht berechtigt“-Fehler auf eine Ursachenkategorie ein — CSRF, Gateway-Service, Berechtigung, ICF, UCON, Cloud Connector — und nennen die zu sammelnde Evidenz.',
    intro:
      'Beantworten Sie einige Fragen. Der Baum grenzt das Problem auf eine wahrscheinliche Ursachenkategorie ein und sagt, welche Evidenz sie bestätigt oder ausschließt. Er diagnostiziert Ihr System nicht — das übernimmt der Fiori 403 Root-Cause Doctor anhand der Evidenz.',
    step: 'Frage {n}',
    back: 'Zurück',
    restart: 'Neu beginnen',
    yourAnswers: 'Ihre Antworten',
    likelyCause: 'Wahrscheinliche Ursachenkategorie',
    collect: 'Zu sammelnde Evidenz',
    relatedFinding: 'Passender Befundcode der Engine',
    notDiagnosis:
      'Dies ist eine Kategorie, keine Diagnose. Bestätigen Sie sie mit der Evidenz oben — oder laden Sie diese Evidenz in einen Workspace und lassen Sie den Fiori 403 Root-Cause Doctor mit zeilengenauem Nachweis entscheiden.',
    engineLink: 'Fiori 403 Root-Cause Doctor — Eingabeformate und Regeln',
    questions: {
      start: {
        text: 'Wo tritt das Problem auf?',
        options: {
          content: 'Die App-Kachel fehlt oder das Launchpad meldet, dass die App nicht geöffnet werden kann',
          http: 'Eine Anfrage scheitert mit HTTP 403 (Fehlermeldung oder Netzwerk-Trace im Browser)',
          btp: 'Die App läuft über SAP BTP (Build Work Zone / Cloud Connector) und scheitert dort',
        },
      },
      method: {
        text: 'Welche HTTP-Methode verwendet die fehlerhafte Anfrage (Entwicklertools des Browsers → Netzwerk)?',
        options: {
          modifying: 'POST, PUT, PATCH, MERGE oder DELETE — Daten speichern oder ändern',
          read: 'GET — Daten lesen oder die App laden',
        },
      },
      csrf: {
        text: 'Enthält die 403-Antwort den Header „x-csrf-token: Required“ oder einen Hinweis auf die CSRF-Token-Prüfung?',
        options: {
          yes: 'Ja',
          no: 'Nein, oder ich kann es nicht erkennen',
        },
      },
      log: {
        text: 'Was zeigt die Transaktion /IWFND/ERROR_LOG auf dem Gateway-Hub zum Zeitpunkt der Anfrage?',
        options: {
          service: '„No service found“, der Service ist nicht aktiv oder es fehlt ein Systemalias',
          auth: 'Einen Berechtigungsfehler (z. B. S_SERVICE oder „keine Berechtigung“)',
          backend: 'Einen Fehler aus dem Backend-System',
          nothing: 'Für diesen Zeitpunkt ist nichts protokolliert',
        },
      },
      icf: {
        text: 'Ist der ICF-Knoten der Anfrage-URL in der Transaktion SICF aktiv?',
        options: {
          inactive: 'Nein, oder der Knoten existiert nicht',
          active: 'Ja, der Knoten ist aktiv',
        },
      },
      ucon: {
        text: 'Ist Unified Connectivity (UCON, Transaktion UCONCOCKPIT) mit RFC- oder HTTP-Allowlists aktiv?',
        options: {
          yes: 'Ja, Allowlists sind in der Protokoll- oder Endphase',
          no: 'Nein, oder ich weiß es nicht',
        },
      },
      btp: {
        text: 'Wo wird die Anfrage abgewiesen?',
        options: {
          connector: 'Das Zugriffs- oder Audit-Log des SAP Cloud Connector zeigt sie als abgewiesen',
          backend: 'Sie erreicht das Backend (Eintrag in /IWFND/ERROR_LOG oder SU53)',
          unsure: 'Das weiß ich noch nicht',
        },
      },
    },
    outcomes: {
      content: {
        title: 'Launchpad-Inhalt oder Rollenzuordnung',
        summary:
          'Eine fehlende Kachel oder „App konnte nicht geöffnet werden“ bedeutet meist, dass Business-Katalog, Space/Page oder Target Mapping dem Benutzer nicht zugeordnet sind — noch bevor ein HTTP 403 entsteht.',
        evidence: [
          'Die PFCG-Rollen des Benutzers und die darin enthaltenen Launchpad-Kataloge, Spaces und Pages',
          'Das Target Mapping (semantisches Objekt und Aktion) der App im Launchpad Content Manager',
          'Ein Screenshot der Launchpad-Fehlermeldung inklusive semantischem Objekt und Aktion',
        ],
        code: 'FIORI_AUTH_OBJECT_MISSING',
      },
      csrf: {
        title: 'CSRF-Token fehlt oder ist ungültig',
        summary:
          'Ändernde OData-Anfragen brauchen ein gültiges CSRF-Token aus derselben Session. Proxys, abgelaufene Sessions oder Cross-Origin-Setups verlieren es häufig.',
        evidence: [
          'Ein Netzwerk-Trace (HAR) der fehlerhaften Anfrage und des vorangehenden Token-Abrufs',
          'Request- und Response-Header des 403 (x-csrf-token, Cookies)',
          'Konfiguration von Reverse Proxy oder Load Balancer zu Session-Stickiness und Cookies',
        ],
        code: 'FIORI_CSRF_TOKEN_INVALID',
      },
      gateway: {
        title: 'Gateway-Service nicht aktiviert oder kein Systemalias',
        summary:
          'Der OData-Service ist auf dem Gateway-Hub nicht registriert oder der Systemalias zum Backend fehlt — die Anfrage erreicht die Geschäftslogik nie.',
        evidence: [
          'Eintrag in /IWFND/ERROR_LOG zur Anfrage',
          '/IWFND/MAINT_SERVICE: Service-Registrierung, Version und Systemalias',
          'SICF-Status des Service-Knotens',
        ],
        code: 'FIORI_GATEWAY_SERVICE_NOT_ACTIVATED',
      },
      auth: {
        title: 'Fehlende Berechtigung',
        summary:
          'Eine Berechtigungsprüfung ist fehlgeschlagen — beim Service-Start (S_SERVICE, S_START) oder für ein fachliches Berechtigungsobjekt im Backend.',
        evidence: [
          'SU53 des Benutzers direkt nach dem Fehler, auf dem System, auf dem die Prüfung scheiterte',
          'Ein Berechtigungstrace (STAUTHTRACE) für den Benutzer während der fehlerhaften Anfrage',
          'Eintrag in /IWFND/ERROR_LOG und die Rollenzuordnung des Benutzers',
        ],
        code: 'FIORI_AUTH_OBJECT_MISSING',
      },
      icf: {
        title: 'ICF-Service-Knoten inaktiv',
        summary: 'Der ICF-Knoten für die URL ist inaktiv oder fehlt, daher antwortet Web Dispatcher bzw. ICM vor der Anwendung.',
        evidence: [
          'SICF: Status des Knotens und seiner Elternknoten für den exakten URL-Pfad',
          'Anfrage-URL und Antwort aus dem Netzwerk-Trace des Browsers',
          'ICM- bzw. Web-Dispatcher-Trace der Anfrage, falls der Knoten aktiv ist',
        ],
        code: 'FIORI_ICF_INACTIVE',
      },
      ucon: {
        title: 'Durch UCON-Allowlist blockiert',
        summary:
          'Unified Connectivity weist Aufrufe von Funktionsbausteinen oder HTTP-Services ab, die nicht auf der Allowlist des Szenarios stehen.',
        evidence: [
          'UCONCOCKPIT: Phase und Allowlist des RFC-/HTTP-Szenarios',
          'Die UCON-Protokolleinträge zum Zeitpunkt der Anfrage',
          'Name des aufgerufenen Funktionsbausteins bzw. HTTP-Pfad',
        ],
        code: 'FIORI_UCON_DENIED',
      },
      connector: {
        title: 'Vom SAP Cloud Connector abgewiesen',
        summary:
          'Der Cloud Connector gibt den Backend-Ressourcenpfad nicht frei, oder Principal Propagation bzw. Zugriffskontrolle lehnen ihn ab.',
        evidence: [
          'Cloud-Connector-Zugriffskontrolle: virtueller Host, freigegebene Ressourcen und Pfadpräfixe',
          'Audit- und Trace-Log des Cloud Connector zum Zeitpunkt der Anfrage',
          'Die BTP-Destination-Konfiguration (Proxy-Typ, Authentifizierung)',
        ],
        code: 'FIORI_CLOUD_CONNECTOR_DENIED',
      },
      unknown: {
        title: 'Aus den Antworten nicht bestimmbar',
        summary:
          'Die Antworten zeigen auf keine einzelne Kategorie. Sammeln Sie die folgende Evidenz — zusammen deckt sie alle Kategorien ab, die der Fiori 403 Root-Cause Doctor auswertet.',
        evidence: [
          'Ein Netzwerk-Trace (HAR) der fehlerhaften Anfrage',
          'SU53 und /IWFND/ERROR_LOG zum Zeitpunkt der Anfrage',
          'SICF-Status des URL-Pfads und, falls aktiv, UCON- und Cloud-Connector-Protokolle',
        ],
        code: 'FIORI_403_INSUFFICIENT_TELEMETRY',
      },
    },
  },
  search: {
    metaTitle: 'SAP-Wissens- & Fehlersuche | ERP Preflight',
    metaDescription:
      'Durchsuchen Sie geprüfte SAP-Wissensartikel, SAP-Objekte mit Freigabestatus und die Befundcodes der ERP-Preflight-Analyse-Engines.',
    label: 'Suchbegriff',
    placeholder: 'z. B. Output-Findung, 403, BD52, MARA',
    hint: 'Mindestens 2 Zeichen. Treffer stammen aus geprüften Artikeln, dem globalen Wissensgraphen und dem Regelkatalog der Engines.',
    articles: 'Wissensartikel',
    objects: 'SAP-Objekte',
    rules: 'Befundcodes der Engines',
    noArticles: 'Kein Artikel passt.',
    noObjects: 'Kein SAP-Objekt passt.',
    noRules: 'Kein Befundcode passt.',
    rulesUnavailable: 'Der Engine-Katalog ist vorübergehend nicht verfügbar.',
    updateRequired: 'Aktualisierung in Arbeit',
  },
  sap: {
    breadcrumb: 'SAP-Objekte',
    cleanCoreTitle: '{key}: Clean-Core-Status und Nachfolger',
    cleanCoreMetaTitle: '{key} ({type}) — {verdict} | Clean Core',
    cleanCoreMetaDescription:
      'Freigabestatus von {key} ({type}) je Release von SAP S/4HANA und SAP Cloud ERP{successorPart}, aus dem offiziellen SAP Cloudification Repository. Zuletzt verifiziert am {date}.',
    successorPart: ', Nachfolger {successors}',
    migrationTitle: '{key} in SAP Cloud ERP: Was ersetzt es?',
    migrationMetaTitle: 'Nachfolger von {key} für die Migration nach SAP Cloud ERP: {successors}',
    migrationMetaDescription:
      'Was {key} ({type}) beim Wechsel nach SAP Cloud ERP ersetzt: {successors}. Freigabestatus je Release und verwandte Objekte, aus offiziellen SAP-Freigabedaten.',
    answer: 'Antwort',
    purpose: 'Was diese Seite beantwortet',
    purposeCleanCore:
      'Ob {key} in ABAP-Cloud- bzw. Clean-Core-Entwicklung verwendet werden darf, in welchen Releases, und was stattdessen zu verwenden ist.',
    purposeMigration:
      'Was {key} ersetzt, wenn Eigenentwicklungen nach SAP Cloud ERP oder ABAP Cloud wechseln, und in welchen Releases der Nachfolger freigegeben ist.',
    type: 'Objekttyp',
    component: 'Anwendungskomponente',
    swComponent: 'Softwarekomponente',
    releasesTitle: 'Freigabestatus je Release',
    successorsTitle: 'Nachfolger',
    relatedTitle: 'Verwandte Objekte aus dem Wissensgraphen',
    relatedMore: '+{count} weitere verwandte Objekte',
    alternatesTitle: 'Gleicher Name, andere Objekttypen',
    lifecycleTitle: 'Lebenszyklus je Edition',
    evidenceTitle: 'Evidenz und Herkunft',
    verifiedFrom: 'Abgerufen am {date} aus {source}',
    howToAct: 'Was zu tun ist',
    actReleased:
      '{key} kann direkt in ABAP-Cloud-Code verwendet werden; es gehört in den als „Freigegeben“ markierten Releases zum freigegebenen API-Vertrag.',
    actSuccessor:
      'Ersetzen Sie Lese- und Schreibzugriffe auf {key} durch den Nachfolger. Bei mehreren Nachfolgern wählen Sie den, dessen Felder zu Ihrer Verwendung passen, und prüfen Sie, dass er in Ihrem Ziel-Release freigegeben ist.',
    actConcept: 'Folgen Sie dem von SAP genannten Nachfolgekonzept: {concept}.',
    actNone:
      'SAP veröffentlicht keinen Nachfolger. Kapseln Sie den Zugriff in einem eigenen Wrapper (Tier 2 in einem Clean-Core-Setup) oder fordern Sie bei SAP eine freigegebene API an.',
    actUnknown: 'Für {key} gibt es keinen offiziellen Status; behandeln Sie es als nicht freigegeben, bis SAP einen veröffentlicht.',
    migrationLink: 'Migrationssicht: Was ersetzt {key}?',
    cleanCoreLink: 'Clean-Core-Sicht auf {key}',
    lowInfo:
      'Diese Seite hat noch nicht genug verifizierte Informationen, um von Suchmaschinen indexiert zu werden (Qualitätsprüfung: {failed}).',
    gateChecks: {
      GLOBAL_REVIEWED: 'globales geprüftes Wissen',
      OBJECT_TYPE: 'Objekttyp',
      RELEASE_STATE: 'offizieller Freigabestatus',
      SUCCESSOR_OR_EXPLICIT_NONE: 'Nachfolger oder ausdrücklich „keiner nötig“',
      EVIDENCE_SOURCE: 'offizielle Evidenz mit Abrufdatum',
      RELATED_OBJECTS: 'verwandte Objekte',
    },
    lookupAnother: 'Weiteres Objekt nachschlagen',
    notInGraph: '{key} ist nicht im öffentlichen Wissensgraphen.',
    unavailableTitle: 'Wissensdienst nicht verfügbar',
  },
  article: {
    provenance: 'Herkunft der Inhalte',
    provenanceValues: {
      OFFICIAL_SAP_DOCUMENTATION: 'Auf Basis offizieller SAP-Dokumentation',
      OFFICIAL_SAP_REPOSITORY: 'Auf Basis offizieller SAP-Repository-Daten',
      CURATED_RULE: 'Kuratierte ERP-Preflight-Regel',
      EDITORIAL: 'Redaktioneller Inhalt, fachlich geprüft',
    },
    technicalReview: 'Fachliche Prüfung',
    updateRequired: 'Dieser Artikel wird gerade aktualisiert: {reason}',
    updateRequiredNoReason: 'Dieser Artikel wird gerade aktualisiert.',
  },
  docs: {
    breadcrumb: 'Dokumentation',
    metaTitle: 'ERP-Preflight-Dokumentation',
    metaDescription:
      'So nutzen Sie ERP Preflight: Einstieg, Engine-Katalog mit Eingabeformaten und Regeln, Sicherheit und Datenverarbeitung, API & CLI, lokaler Agent und FAQ.',
    title: 'Dokumentation',
    intro: 'Alles, was hier beschrieben ist, macht das Produkt heute. Wo etwas noch nicht verfügbar ist, sagt die Seite das.',
    onThisPage: 'Abschnitte',
    allPages: 'Alle Dokumentationsseiten',
    engineCatalogTitle: 'Engine-Katalog',
    engineCatalogIntro:
      'Erzeugt aus dem Live-Katalog des Analysedienstes: {count} Engines. Jede Engine nennt ihre akzeptierten Eingaben, ihre Befundcodes und den Behebungstext, der mit jedem Befund angezeigt wird.',
    catalogUnavailable: 'Der Engine-Katalog ist vorübergehend nicht verfügbar. Bitte versuchen Sie es gleich noch einmal.',
    engine: 'Engine',
    domain: 'Domäne',
    version: 'Version',
    rules: 'Befundcodes',
    inputRules: 'Codes der Eingabeprüfung',
    accepted: 'Akzeptierte Formate',
    required: 'Erforderliche Eingabe',
    targetReleases: 'Ziel-Releases',
    severity: 'Standard-Schweregrad',
    category: 'Kategorie',
    remediation: 'Behebung',
    inputContract: 'Eingabevertrag',
    openEngine: 'Engine-Details',
    formatsTitle: 'Dateiformate je Engine',
    formatsIntro:
      'Formate, die jede Engine laut Eingabevertrag akzeptiert. Uploads werden zusätzlich anhand von Magic Bytes, Archivgrenzen und einem Malware-Scan geprüft, bevor eine Engine sie sieht.',
    apiReference: 'API-Referenz (OpenAPI)',
    lastUpdated: 'Inhalt geprüft am {date}',
    backToDocs: 'Zurück zur Dokumentation',
  },
};
