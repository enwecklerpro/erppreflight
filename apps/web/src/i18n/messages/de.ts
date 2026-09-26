import type { Messages } from './en';
import { analyzeDe } from './analyze.de';

/**
 * Deutsches Wörterbuch. Typisiert als `Messages`: fehlende oder zusätzliche
 * Schlüssel sind Compile-Fehler. Inhalte sind redaktionell übersetzt, nicht maschinell.
 */
export const de: Messages = {
  common: {
    brand: 'ERP Preflight',
    tagline: 'Wissen, was bricht — bevor es die Produktion tut.',
    subheadline:
      'Prüfen Sie ERP-Ausgaben, Erweiterungen, Schnittstellen, Transporte, Migrationen und betriebliche Änderungen, bevor sie scheitern.',
    runPreflight: 'Preflight starten',
    exploreFreeTools: 'Demo-Sandbox ausprobieren',
    startFree: 'Kostenlos starten',
    learnMore: 'Mehr erfahren',
    contactSales: 'Vertrieb kontaktieren',
    backHome: 'Zur Startseite',
    retry: 'Erneut versuchen',
    lastReviewed: 'Zuletzt geprüft',
    version: 'Version',
    targetReleases: 'Ziel-Releases',
    sources: 'Quellen',
    relatedEngines: 'Zugehörige Engines',
    loading: 'Wird geladen …',
    skipToContent: 'Zum Inhalt springen',
    engineCount: '{count} Analyse-Engines',
    viewAll: 'Alle anzeigen',
  },
  nav: {
    primary: 'Hauptnavigation',
    dashboard: 'Dashboard',
    projects: 'Projekte',
    inspector: 'Analyse-Inspektor',
    templates: 'Vorlagen',
    artifacts: 'Artefakte',
    matrix: 'Release-Matrix',
    landscapes: 'Landschaften',
    agentGate: 'Agent Gate',
    settings: 'Einstellungen',
    admin: 'Administration',
    analyze: 'Analysieren',
    reports: 'Berichte',
    billing: 'Abrechnung',
    audit: 'Audit-Log',
    retention: 'Aufbewahrung',
    support: 'Support',
    knowledgeGraph: 'Wissensgraph',
    notifications: 'Benachrichtigungen',
    more: 'Mehr',
    secondary: 'Weitere Bereiche',
    solutions: 'Lösungen',
    pricing: 'Preise',
    knowledge: 'Wissen',
    security: 'Sicherheit',
    docs: 'Doku',
    demo: 'Demo-Sandbox',
    search: 'Suchen …',
    searchTitle: 'Suche & Befehle (Cmd+K)',
    login: 'Anmelden',
    signup: 'Registrieren',
    logout: 'Abmelden',
    logoutTitle: 'Abmelden',
    language: 'Sprache',
    switchTo: 'Sprache wechseln zu {language}',
  },
  footer: {
    product: 'Produkt',
    resources: 'Ressourcen',
    legal: 'Rechtliches',
    imprint: 'Impressum',
    privacy: 'Datenschutzerklärung',
    terms: 'Nutzungsbedingungen',
    cookies: 'Cookie-Richtlinie',
    cookieSettings: 'Cookie-Einstellungen',
    security: 'Sicherheit',
    trust: 'Trust Center',
    status: 'Systemstatus',
    changelog: 'Änderungsprotokoll',
    docs: 'Dokumentation',
    subprocessors: 'Unterauftragsverarbeiter',
    dpa: 'Auftragsverarbeitungsvertrag',
    disclaimer:
      'SAP, S/4HANA und andere hier genannte SAP-Produkte und -Dienstleistungen sind Marken oder eingetragene Marken der SAP SE (oder eines SAP-Konzernunternehmens) in Deutschland und anderen Ländern. ERP Preflight ist ein unabhängiges Produkt und steht in keiner Verbindung zur SAP SE; es wird von der SAP SE weder unterstützt noch gesponsert.',
    rights: 'Alle Rechte vorbehalten.',
  },
  home: {
    metaTitle: 'ERP Preflight — Wissen, was bricht, bevor es die Produktion tut',
    metaDescription:
      'Deterministische, belegbasierte Preflight-Analysen für SAP-Ausgaben, Erweiterungen, Schnittstellen, Transporte, Migrationen und Betrieb — bevor Änderungen die Produktion erreichen.',
    eyebrow: 'Preflight-Analysen für SAP-Landschaften',
    problemTitle: 'Änderungen scheitern in Produktion aus Gründen, die vorher sichtbar waren',
    problemBody:
      'Die meisten Produktionsstörungen nach einer SAP-Änderung sind kein Rätsel. Die fehlende Zeile in der Entscheidungstabelle, der Transport ohne seinen Vorgänger, das Zusatzfeld, das nie im Formular ankommt — die Belege lagen vor dem Go-live in Konfiguration und Code vor. Sie wurden nur nicht systematisch geprüft.',
    problems: [
      'Es entsteht keine Ausgabe, weil ein BRFplus-Findungsschritt keine passende Regel hat.',
      'Ein Transport wird vor der Dictionary-Änderung importiert, von der er abhängt.',
      'Eigenentwicklungen schreiben direkt in Standardtabellen und blockieren das Clean-Core-Ziel.',
      'Eine Fiori-App liefert 403, weil einer Rolle eine Service-Berechtigung fehlt.',
    ],
    howTitle: 'So funktioniert es',
    howSteps: [
      {
        title: 'Exporte hochladen',
        body: 'Stellen Sie Konfigurations-, Code- oder Log-Exporte aus Ihrem System bereit. Dateien werden geprüft, validiert und ausschließlich in Ihrem Mandanten gespeichert.',
      },
      {
        title: 'Deterministische Engines ausführen',
        body: 'Spezialisierte Engines lesen die Artefakte und werten explizite Regeln aus. Gleiche Eingaben liefern immer gleiche Befunde.',
      },
      {
        title: 'Auf Basis von Belegen handeln',
        body: 'Jeder Befund verweist auf Datei, Zeile und Hash, auf denen er beruht — mit Schweregrad, Konfidenzklasse und Hinweisen zur Behebung.',
      },
    ],
    solutionsTitle: 'Sechs Lösungsbereiche, eine Plattform',
    solutionsIntro:
      'Alle Engines teilen Ingestion, Belegmodell, Befund-Workflow und Reporting — es sind keine getrennten Einzeltools.',
    evidenceTitle: 'Belegbasiert statt geraten',
    evidenceBody:
      'Befunde entstehen durch deterministische Parser und Regeln. KI-Unterstützung beschränkt sich auf Erläuterungen und kann einen Befund nie über die Konfidenzklasse INFERRED heben.',
    evidencePoints: [
      'Artefaktpfad, Zeile, Spalte und Codeausschnitt für jeden Befund',
      'SHA-256-Hash des analysierten Artefakts',
      'Explizite Konfidenzklassen: VERIFIED, RULE_DERIVED, INFERRED, UNKNOWN',
      'Befunde ohne überprüfbaren Beleg werden auf UNKNOWN herabgestuft',
    ],
    projectTitle: 'Projektmodus für Programme, nicht nur Einzelprüfungen',
    projectBody:
      'Bündeln Sie Analysen in Projekt-Workspaces, halten Sie eine Baseline fest, vergleichen Sie Läufe über die Zeit und exportieren Sie Berichte für Lenkungsausschüsse und Prüfer.',
    releaseTitle: 'Release-Intelligenz',
    releaseBody:
      'Engines deklarieren die SAP-Releases, die sie unterstützen. Die Release-Matrix zeigt vor dem Lauf, welche Prüfungen für Ihr Ziel-Release gelten.',
    securityTitle: 'Von Anfang an für Kundendaten gebaut',
    securityBody:
      'Hochgeladene Artefakte können sensible Konfiguration enthalten. Die Plattform ist auf Mandantentrennung und minimale Offenlegung ausgelegt.',
    securityPoints: [
      'PostgreSQL Row-Level Security für jede Mandantentabelle',
      'Malware-Scan und Archivprüfungen vor der Analyse',
      'Schwärzung von Geheimnissen, bevor Ausschnitte als Beleg gespeichert werden',
      'Keine Nutzung von Kundenartefakten zum Training von KI-Modellen',
    ],
    integrationsTitle: 'Offene Schnittstellen',
    integrationsBody:
      'Nutzen Sie die Ergebnisse dort, wo Ihr Team bereits arbeitet: eine dokumentierte REST-API mit OpenAPI-Beschreibung, Webhooks, ein Model-Context-Protocol-Server (MCP) für KI-Agenten und Berichtsexporte.',
    fileFirstTitle: 'File-first: Starten Sie mit den Exporten, die Sie schon haben',
    fileFirstBody:
      'Jede Analyse läuft auf exportierten Artefakten — Konfigurations- und Entscheidungstabellenexporte, ABAP-Quellen, ATC- und Readiness-Check-Ergebnisse, Transportdaten, Protokolle. Für die ersten Befunde sind weder Systemzugriff noch Installation nötig.',
    connectorsTitle: 'Konnektoren, wo sie helfen',
    connectorsBody:
      'Befunde lassen sich mit Delivery-Tools wie Jira und SAP Cloud ALM synchronisieren. Direkte lesende Systemkonnektoren und ein lokaler Agent für private Bereitstellungen sind in Planung; bis dahin ist der Upload der unterstützte Weg.',
    knowledgeTitle: 'Aus der Wissensdatenbank',
    knowledgeBody: 'Fachlich geprüfte Erklärungen zu den SAP-Themen hinter typischen Änderungsfehlern.',
    knowledgeCta: 'Wissensdatenbank öffnen',
    docsTitle: 'Dokumentation',
    docsBody: 'Engine-Referenz, Belegmodell, API- und MCP-Integration.',
    demoTitle: 'Auf Beispieldaten ansehen',
    demoBody: 'Die Demo-Sandbox legt in Ihrem Workspace ein synthetisches Beispielprojekt an, in dem Sie Befunde und Belege erkunden können.',
    pricingTitle: 'Pläne für Einzelprojekte und ganze Landschaften',
    pricingBody:
      'Starten Sie mit einer kostenlosen Sandbox und wechseln Sie in einen Plan, wenn Ihr Programm mehr Projekte und Analysen braucht.',
    pricingCta: 'Preise ansehen',
    faqTitle: 'Häufige Fragen',
    faq: [
      {
        q: 'Muss ERP Preflight mit meinem SAP-System verbunden werden?',
        a: 'Nein. Die Engines analysieren exportierte Artefakte, die Sie hochladen, etwa Konfigurationsexporte, Code und Protokolle. Für einen Preflight ist keine Systemverbindung nötig.',
      },
      {
        q: 'Entscheidet eine KI, welche Befunde gemeldet werden?',
        a: 'Nein. Befunde stammen aus deterministischen Parsern und Regeln. KI wird nur für optionale Erläuterungen genutzt, und ihre Beiträge sind auf die Konfidenzklasse INFERRED begrenzt.',
      },
      {
        q: 'Welche SAP-Releases werden unterstützt?',
        a: 'Jede Engine deklariert ihre Ziel-Releases. Die öffentliche Release-Matrix listet sie je Engine auf.',
      },
      {
        q: 'Ist ERP Preflight ein SAP-Produkt?',
        a: 'Nein. ERP Preflight ist ein unabhängiges Produkt und steht in keiner Verbindung zur SAP SE; es wird von der SAP SE weder unterstützt noch gesponsert.',
      },
    ],
    finalTitle: 'Erfahren Sie, was bricht — vor dem Go-live',
    finalBody: 'Legen Sie einen Workspace an, laden Sie Ihren ersten Export hoch und prüfen Sie belegbasierte Befunde.',
  },
  solutions: {
    indexTitle: 'Lösungen',
    indexMetaTitle: 'Lösungen — ERP Preflight',
    indexMetaDescription:
      'Preflight-Engines für SAP-Ausgabe und Erweiterbarkeit, Migration und Clean Core, Integration, Release und Transport, Betrieb sowie Lagerautomatisierung.',
    indexIntro:
      'Jeder Lösungsbereich bündelt die Engines, die eine Art von Änderung analysieren. Alle teilen Ingestion, Belegmodell und Reporting.',
    painTitle: 'Das Problem',
    enginesTitle: 'Engines in diesem Bereich',
    examplesTitle: 'Beispiele für geprüfte Sachverhalte',
    knowledgeTitle: 'Passende Wissensartikel',
    noKnowledge: 'Für diesen Bereich sind noch keine Wissensartikel veröffentlicht.',
    knowledgeUnavailable: 'Die Wissensartikel konnten gerade nicht geladen werden.',
    ctaTitle: 'Diesen Preflight auf Ihren eigenen Exporten ausführen',
    ctaBody: 'Legen Sie einen kostenlosen Workspace an und laden Sie einen Export hoch, um Befunde mit Belegen zu sehen.',
    items: {
      'output-extensibility': {
        name: 'Output & Erweiterbarkeit',
        tagline: 'Ausgaben, Formulare und Erweiterungen, die nach einer Änderung weiter funktionieren.',
        metaDescription:
          'Preflight-Prüfungen für SAP-Ausgabeparameterfindung, Formulare, den Weg von Zusatzfeldern und die Auswirkungen auf Erweiterungen.',
        pain: 'Ausgabeprobleme zeigen sich spät: Die Faktura ist gesichert, aber keine E-Mail geht raus; das Zusatzfeld steht auf dem Bildschirm, aber nicht im PDF. Die Ursachen liegen in Findungsregeln, Formularvorlagen und Erweiterungseinstellungen, die selten gemeinsam geprüft werden.',
        examples: [
          'BRFplus-Findungsschritte ohne passende Regel für eine Belegkombination',
          'In der Findung referenzierte Formularvorlagen, die im Zielsystem fehlen',
          'Zusatzfelder, deren Verwendung für Formulare, APIs oder Folgebelege nicht aktiviert ist',
          'Erweiterungen, die von Änderungen an ihren Abhängigkeiten betroffen sind',
        ],
      },
      'migration-clean-core': {
        name: 'Migration & Clean Core',
        tagline: 'Wissen, welche Eigenentwicklungen und Konfiguration Ihr Ziel blockieren.',
        metaDescription:
          'Preflight-Prüfungen für Clean-Core-Konformität, die Migration von ECC in die Cloud, Konfigurationsabbildung und Lücken zum Standard.',
        pain: 'Migrationsbewertungen sind oft handgepflegte Tabellen. Eigenentwicklungen, die den Standard modifizieren, nicht freigegebene Objekte nutzen oder von veralteten Transaktionen abhängen, fallen zu spät auf — wenn das Zielsystem schon aufgebaut wird.',
        examples: [
          'Einordnung der Abhängigkeiten von Eigenentwicklungen nach Freigabestatus',
          'Direkte Schreibzugriffe auf SAP-Standardtabellen und klassische Modifikationen',
          'Konfigurationsaktivitäten ohne Entsprechung im Cloud-Zielsystem',
          'Eigenentwicklungen, die sich mit dem Standardumfang überschneiden',
        ],
      },
      integration: {
        name: 'Integration',
        tagline: 'Schnittstellen, die weiterhin liefern, was der Empfänger erwartet.',
        metaDescription:
          'Preflight-Prüfungen für die Abdeckung von SAP-Änderungszeigern und API-Kompatibilität, bevor Schnittstellenänderungen live gehen.',
        pain: 'Schnittstellen brechen still. Ein zum IDoc hinzugefügtes Feld wird nie verteilt, weil dafür kein Änderungszeiger geschrieben wird; ein Konsument ruft eine API-Version auf, die im nächsten Release veraltet ist.',
        examples: [
          'Von Empfängern benötigte Felder ohne Abdeckung in der Änderungszeiger-Konfiguration',
          'Nachrichtentypen ohne aktive Änderungszeiger oder Verarbeitung',
          'Nutzung veralteter oder geänderter OData-, SOAP- und RFC-Schnittstellen',
        ],
      },
      'release-transport': {
        name: 'Release & Transport',
        tagline: 'In der richtigen Reihenfolge importieren — mit allem, was zusammengehört.',
        metaDescription:
          'Preflight-Prüfungen für SAP-Transportabhängigkeiten und die Vollständigkeit von Softwaresammlungen vor dem Import.',
        pain: 'In falscher Reihenfolge importierte Transporte verursachen Aktivierungsfehler — oder schlimmer: Sie laufen durch und scheitern zur Laufzeit. Softwaresammlungen werden ohne ein Objekt exportiert, von dem sie abhängen.',
        examples: [
          'Transporte, deren referenzierte Objekte in einem anderen, noch nicht importierten Auftrag liegen',
          'Objekte in mehreren Aufträgen mit widersprüchlichen Versionen',
          'Softwaresammlungen, denen Elemente fehlen, von denen ihr Inhalt abhängt',
        ],
      },
      operations: {
        name: 'Betrieb',
        tagline: 'Betriebsstörungen mit Belegen erklären statt durch Ausprobieren.',
        metaDescription:
          'Preflight-Prüfungen für Fiori-Berechtigungen, hängende Workflows, Kontenfindung, Abweichungen nach Systemkopien und sichere Stilllegung.',
        pain: 'Betriebsprobleme — ein 403 in einer Fiori-App, ein hängender Workflow, eine Buchung auf das falsche Konto, ein kopiertes System, das noch auf die Produktion zeigt — kosten Stunden manueller Suche über Rollen, Konfiguration und Protokolle.',
        examples: [
          'Fehlende Service- oder Startberechtigungen hinter Fiori-403-Fehlern',
          'Workitems ohne Bearbeiter oder mit Warten auf nie eintreffende Ereignisse',
          'Fehlende Einträge der Kontenfindung für neue Kombinationen',
          'Nach einer Systemkopie nicht angepasste RFC-Destinationen und logische Systeme',
          'Objekte, die vor ihrer Stilllegung noch referenziert werden',
        ],
      },
      'warehouse-automation': {
        name: 'Lagerautomatisierung',
        tagline: 'Verstehen, was zwischen Lagerverwaltung und Automatisierung passiert ist.',
        metaDescription:
          'MFS BlackBox analysiert Telegrammfolgen des Material Flow System, um Störungen in der Lagerautomatisierung zu erklären.',
        pain: 'Wenn Fördertechnik stoppt oder Paletten am falschen Ort landen, steckt die Antwort im Telegrammaustausch zwischen Lagerverwaltung und speicherprogrammierbaren Steuerungen — verborgen in großen Protokollen.',
        examples: [
          'Telegrammfolgen mit fehlenden Quittungen oder Zeitüberschreitungen',
          'Unerwartete Sprünge in der Transporttopologie',
          'Puffer- und Ressourcenkonflikte im Telegrammstrom',
        ],
      },
    },
  },
  engines: {
    OPD_GUARD: 'S/4HANA-Ausgabeparameterfindung: Regeln und BRFplus',
    FORM_DOCTOR: 'Validierung der Migration von SAPscript/Smart Forms nach Adobe Forms',
    CUSTOM_FIELD_FLOW_DOCTOR: 'Herkunftskette von Zusatzfeldern von CDS-Views über BAPIs bis zur Oberfläche',
    EXTENSION_IMPACT_GUARD: 'Upgrade-Stabilität von Cloud-BAdIs und Key-User-Erweiterungen',
    SPRO2CLOUD: 'Abbildung von On-Premise-IMG/SPRO-Konfiguration auf Cloud-CBC',
    ECC2CLOUD_NAVIGATOR: 'Fahrplan für die Anpassung von Eigenentwicklungen und veralteten Transaktionen',
    SAP_GAP_RADAR: 'Fit-to-Standard-Abgleich mit Clean-Core-Empfehlungen',
    CLEAN_CORE_OBJECT_GUARD: 'Einordnung in Erweiterbarkeitsstufen 1/2/3 und Erkennung klassischer Modifikationen',
    CHANGE_POINTER_COVERAGE_AUDITOR: 'Prüfung von Änderungszeiger-Konfiguration (BD21/BD52) und Ereignisauslösern',
    API_CHANGE_GUARD: 'Kompatibilität und Veraltung von OData-, SOAP- und RFC-Schnittstellen',
    SOFTWARE_COLLECTION_DEPENDENCY_GUARD: 'Querverweise und Release-Prüfung exportierter Softwaresammlungen',
    TRANSPORT_DEPENDENCY_ANALYZER: 'CTS-Transportreihenfolge und Dictionary-Abhängigkeiten zwischen Transporten',
    SAFE_DECOMMISSION_PREFLIGHT: 'Preflight für die Stilllegung ungenutzter Z-Programme, Tabellen und Schnittstellen',
    FIORI_403_ROOT_CAUSE_DOCTOR: 'Prüfung von PFCG-Rollen, Berechtigungsobjekten (S_START, S_SERVICE) und ICF-Katalog',
    WORKFLOW_STUCK_EXPLAINER: 'Analyse blockierter Workitems (SWWWIHEAD / SWZAI)',
    IAM_COST_OPTIMIZER: 'Überlizenzierung durch Fiori-Kataloge und Minimierung der Lizenzstufe',
    ACCOUNT_DETERMINATION_PREFLIGHT: 'Validierung der automatischen Kontenfindung (OBYC, VKOA)',
    SYSTEM_REFRESH_DELTA_GUARD: 'Prüfung von BDLS, RFC-Destinationen und logischen Systemen nach einer Systemkopie',
    MFS_BLACKBOX: 'Prüfung von Telegrammfolgen und Telegrammpuffern im Material Flow System',
  },
  pricing: {
    metaTitle: 'Preise — ERP Preflight',
    metaDescription:
      'Pläne von ERP Preflight: eine kostenlose Community-Sandbox und kostenpflichtige Pläne für Projekte, Programme und Partner.',
    title: 'Preise',
    intro: 'Die Pläne unterscheiden sich in der Anzahl von Projekten, Analysen und Landschaften sowie in Enterprise-Funktionen.',
    perMonth: '/ Monat',
    free: 'Kostenlos',
    unlimited: 'Unbegrenzt',
    projects: 'Projekte',
    analyses: 'Analysen pro Monat',
    storage: 'Speicher für Artefakte',
    gigabytes: '{count} GB',
    exports: 'Berichtsexporte pro Monat',
    teamMembers: 'Teammitglieder',
    reportBranding: 'Berichte im eigenen Branding',
    pricesUnavailable: 'Die aktuellen Preise konnten nicht geladen werden — fragen Sie beim Vertrieb ein Angebot an.',
    landscapes: 'Systemlandschaften',
    retention: 'Aufbewahrung des Audit-Logs',
    days: '{count} Tage',
    support: 'Ziel-Reaktionszeit Support',
    hours: '{count} Std.',
    agentGate: 'Agentic Change Gate',
    whatIf: 'What-if-Simulation',
    airGapped: 'Berichtsexport für abgeschottete Umgebungen',
    cloudAlm: 'Synchronisation mit Delivery-Tools',
    included: 'Enthalten',
    notIncluded: 'Nicht enthalten',
    startFree: 'Kostenlos starten',
    choose: 'Jetzt starten',
    catalogNote: 'Limits und Preise stammen aus dem Plankatalog der Plattform, den die API durchsetzt.',
    tiers: {
      FREE: 'Zum Ausprobieren der Engines mit Ihren eigenen Exporten.',
      STARTER: 'Für ein erstes Clean-Core- oder Output-Projekt.',
      PROFESSIONAL: 'Für Programme mit mehreren Projekten und Teams.',
      ENTERPRISE: 'Für ganze Landschaften mit unbegrenzten Projekten.',
      PARTNER: 'Für Systemintegratoren mit mehreren Kunden.',
    },
  },
  security: {
    metaTitle: 'Sicherheit — ERP Preflight',
    metaDescription:
      'Wie ERP Preflight hochgeladene SAP-Artefakte schützt: Mandantentrennung, Malware-Scan, Schwärzung von Geheimnissen und deterministische Analyse.',
    title: 'Sicherheit bei ERP Preflight',
    intro:
      'Artefakte aus SAP-Systemen können Konfiguration, Code und personenbezogene Daten enthalten. Diese Maßnahmen sind in der Plattform umgesetzt.',
    controls: [
      {
        title: 'Mandantentrennung in der Datenbank',
        body: 'Jede Mandantentabelle ist durch PostgreSQL Row-Level Security geschützt. Mandantenabfragen laufen unter einer eigenen, nicht privilegierten Rolle — die Trennung wird von der Datenbank erzwungen, selbst wenn Anwendungscode fehlerhaft ist.',
      },
      {
        title: 'Sichere Dateiaufnahme',
        body: 'Uploads werden anhand der Dateisignatur statt der Endung geprüft, auf Malware gescannt und mit Grenzen für Größe, Entpackungsverhältnis, Verschachtelung und Pfade entpackt. XML wird mit deaktivierten externen Entitäten verarbeitet.',
      },
      {
        title: 'Schwärzung von Geheimnissen',
        body: 'Zugangsdaten und Geheimnisse werden geschwärzt, bevor Codeausschnitte als Beleg gespeichert werden.',
      },
      {
        title: 'Mandantenbezogene Ablage',
        body: 'Kundenartefakte liegen unter einem mandanten- und projektspezifischen Pfad; Download-Links sind nur kurz gültig.',
      },
      {
        title: 'Deterministische Analyse und KI-Grenzen',
        body: 'Befunde entstehen durch deterministische Regeln. Optionale KI-Unterstützung kann die Konfidenz nicht über INFERRED heben, und Kundenartefakte werden nicht zum Training von KI-Modellen verwendet.',
      },
      {
        title: 'Kontosicherheit',
        body: 'Passwörter werden mit Argon2id gehasht, Anmeldeendpunkte sind ratenbegrenzt und Sitzungen lassen sich durch Abmelden beenden.',
      },
    ],
    moreTitle: 'Weitere Details',
    trustLink: 'Trust Center mit Unterauftragsverarbeitern',
    statusLink: 'Aktueller Systemstatus',
    contact: 'Sicherheitslücken melden Sie bitte an die im Impressum genannte Adresse.',
  },
  knowledge: {
    metaTitle: 'Wissensdatenbank — ERP Preflight',
    metaDescription:
      'Fachlich geprüfte Erklärungen zu SAP-Themen hinter typischen Änderungsfehlern: Ausgabefindung, Clean Core, Änderungszeiger, Transporte, Fiori-Berechtigungen und mehr.',
    title: 'Wissensdatenbank',
    intro:
      'Fachlich geprüfte Erklärungen zu den SAP-Themen, die unsere Engines analysieren. Jeder Artikel nennt das Datum der letzten Prüfung und seine Quellen.',
    empty: 'In dieser Sprache sind noch keine Artikel veröffentlicht.',
    errorTitle: 'Die Wissensdatenbank ist vorübergehend nicht erreichbar',
    errorBody: 'Die Artikel konnten nicht geladen werden. Bitte versuchen Sie es gleich noch einmal.',
    readArticle: 'Artikel lesen',
    breadcrumbHome: 'Startseite',
    relatedSolutions: 'Passende Lösungsbereiche',
    sourcesTitle: 'Quellen',
    reviewNote:
      'Dieser Artikel enthält allgemeine Informationen zu SAP-Konzepten und ersetzt nicht die SAP-Dokumentation für Ihr konkretes Release.',
    notFoundTitle: 'Artikel nicht gefunden',
  },
  legal: {
    reviewNotice:
      'Diese Seite beschreibt die in der Software umgesetzte Verarbeitung. Der Betreiber muss sie vor dem Produktivbetrieb rechtlich prüfen und vervollständigen.',
    notConfiguredTitle: 'Betreiberangaben nicht konfiguriert',
    notConfiguredBody:
      'Der Betreiber dieser Installation hat seine rechtlichen Angaben noch nicht hinterlegt (Umgebungsvariablen NEXT_PUBLIC_LEGAL_*). Bis dahin werden keine Unternehmensdaten angezeigt.',
    fields: {
      company: 'Betreiber',
      address: 'Anschrift',
      representative: 'Vertreten durch',
      register: 'Handelsregister',
      vatId: 'Umsatzsteuer-Identifikationsnummer',
      email: 'E-Mail',
      phone: 'Telefon',
      responsible: 'Verantwortlich für den Inhalt',
    },
    imprint: {
      title: 'Impressum',
      metaDescription: 'Rechtliche Angaben zum Betreiber von ERP Preflight.',
      intro: 'Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz).',
      disputeTitle: 'Verbraucherstreitbeilegung',
      disputeBody:
        'Der Betreiber ist nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.',
    },
    privacy: {
      title: 'Datenschutzerklärung',
      metaDescription: 'Wie ERP Preflight personenbezogene Daten verarbeitet.',
      sections: [
        {
          heading: 'Verantwortlicher',
          body: 'Verantwortlich für die hier beschriebene Verarbeitung ist der im Impressum genannte Betreiber.',
        },
        {
          heading: 'Konto- und Organisationsdaten',
          body: 'Zur Bereitstellung des Dienstes verarbeiten wir Name, E-Mail-Adresse, Organisation und Rolle registrierter Benutzer. Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO).',
        },
        {
          heading: 'Hochgeladene Artefakte',
          body: 'Dateien, die Sie zur Analyse hochladen, werden in einem je Mandant und Projekt getrennten Speicher abgelegt und nur zur Erstellung von Befunden und Berichten verarbeitet. In Ausschnitten erkannte Geheimnisse werden geschwärzt, bevor sie als Beleg gespeichert werden. Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO).',
        },
        {
          heading: 'Serverprotokolle und Sicherheit',
          body: 'Zur Sicherheit und Fehleranalyse werden Anfragen mit technischen Daten wie Zeitpunkt, Pfad und einer Korrelations-ID protokolliert. Rechtsgrundlage: berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).',
        },
        {
          heading: 'Cookies und lokaler Speicher',
          body: 'Wir verwenden ausschließlich technisch notwendige Cookies und Browserspeicher für Anmeldung, Sprache und Ihre Cookie-Auswahl. Es sind keine Analyse- oder Werbewerkzeuge aktiv. Details finden Sie in der Cookie-Richtlinie.',
        },
        {
          heading: 'Auftragsverarbeiter',
          body: 'Hosting- und Speicheranbieter verarbeiten Daten in unserem Auftrag auf Grundlage von Auftragsverarbeitungsverträgen. Die aktuelle Liste ist auf der Seite der Unterauftragsverarbeiter veröffentlicht.',
        },
        {
          heading: 'Speicherdauer',
          body: 'Daten werden gespeichert, solange Ihr Konto besteht oder gesetzliche Aufbewahrungsfristen es erfordern. Die Aufbewahrung des Audit-Logs richtet sich nach Ihrem Plan.',
        },
        {
          heading: 'Ihre Rechte',
          body: 'Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO) sowie das Recht auf Beschwerde bei einer Aufsichtsbehörde.',
        },
      ],
    },
    terms: {
      title: 'Nutzungsbedingungen',
      metaDescription: 'Bedingungen für die Nutzung von ERP Preflight.',
      sections: [
        {
          heading: 'Geltungsbereich',
          body: 'Diese Bedingungen regeln die Nutzung des Software-as-a-Service-Angebots ERP Preflight durch Geschäftskunden. Individuelle Vereinbarungen haben Vorrang.',
        },
        {
          heading: 'Leistung',
          body: 'ERP Preflight analysiert vom Kunden hochgeladene Artefakte und meldet Befunde mit Belegen. Befunde unterstützen die eigenen Tests und Freigabeentscheidungen des Kunden, ersetzen sie aber nicht.',
        },
        {
          heading: 'Pflichten des Kunden',
          body: 'Kunden laden nur Daten hoch, zu deren Verarbeitung sie berechtigt sind, halten ihre Zugangsdaten vertraulich und nutzen den Dienst im Einklang mit geltendem Recht.',
        },
        {
          heading: 'Pläne und Limits',
          body: 'Der Nutzungsumfang richtet sich nach dem gebuchten Plan. Limits werden von der Plattform durchgesetzt und in den Workspace-Einstellungen angezeigt.',
        },
        {
          heading: 'Datenschutz',
          body: 'Personenbezogene Daten werden gemäß der Datenschutzerklärung und, soweit erforderlich, eines Auftragsverarbeitungsvertrags verarbeitet.',
        },
        {
          heading: 'Marken',
          body: 'SAP und andere SAP-Produktnamen sind Marken der SAP SE. ERP Preflight ist ein unabhängiges Produkt und steht in keiner Verbindung zur SAP SE; es wird von der SAP SE weder unterstützt noch gesponsert.',
        },
      ],
    },
    cookies: {
      title: 'Cookie-Richtlinie',
      metaDescription: 'Von ERP Preflight verwendete Cookies und Browserspeicher.',
      intro:
        'ERP Preflight verwendet ausschließlich technisch notwendige Cookies und Browserspeicher. Es werden keine Analyse- oder Werbe-Cookies gesetzt. Sollte eine optionale Analyse eingeführt werden, läuft sie nur nach Ihrer Einwilligung.',
      tableName: 'Name',
      tablePurpose: 'Zweck',
      tableType: 'Art',
      tableDuration: 'Dauer',
      necessary: 'Notwendig',
      items: [
        { name: 'erppreflight_session', purpose: 'Hält Sie angemeldet (von der API gesetzt, HTTP-only).', duration: '7 Tage' },
        { name: 'erp_auth', purpose: 'Kennzeichnet eine bestehende Anmeldung, damit private Seiten zur Anmeldung umleiten können.', duration: '7 Tage' },
        { name: 'erp_locale', purpose: 'Speichert Ihre bevorzugte Sprache.', duration: '1 Jahr' },
        { name: 'erp_consent', purpose: 'Speichert Ihre Cookie-Auswahl.', duration: '1 Jahr' },
        { name: 'erppreflight_token, erppreflight_tenant_id', purpose: 'Browserspeicher für das API-Sitzungstoken und die aktive Organisation.', duration: 'Bis zur Abmeldung' },
      ],
      manage: 'Auswahl ändern',
    },
    subprocessors: {
      title: 'Unterauftragsverarbeiter',
      metaDescription: 'Dienstleister, die im Auftrag des Betreibers von ERP Preflight Kundendaten verarbeiten.',
      intro: 'Der Betreiber setzt zur Erbringung des Dienstes die folgenden Unterauftragsverarbeiter ein.',
      name: 'Unterauftragsverarbeiter',
      purpose: 'Zweck',
      region: 'Standort',
      notConfigured:
        'Der Betreiber dieser Installation hat seine Liste der Unterauftragsverarbeiter noch nicht veröffentlicht (NEXT_PUBLIC_LEGAL_SUBPROCESSORS). Die aktuelle Liste erhalten Sie beim Betreiber.',
    },
    dpa: {
      title: 'Auftragsverarbeitungsvertrag',
      metaDescription: 'Auftragsverarbeitungsvertrag (Art. 28 DSGVO) für ERP Preflight anfordern.',
      intro:
        'Geschäftskunden, die Artefakte mit personenbezogenen Daten hochladen, benötigen einen Auftragsverarbeitungsvertrag nach Art. 28 DSGVO. Der Betreiber stellt ihn auf Anfrage bereit.',
      includesTitle: 'Der Vertrag regelt',
      includes: [
        'Gegenstand, Dauer, Art und Zweck der Verarbeitung',
        'Kategorien von Daten und betroffenen Personen',
        'Technische und organisatorische Maßnahmen',
        'Einsatz von Unterauftragsverarbeitern',
        'Unterstützung bei Betroffenenanfragen und Löschung zum Vertragsende',
      ],
      requestCta: 'Auftragsverarbeitungsvertrag anfordern',
      emailSubject: 'Anfrage Auftragsverarbeitungsvertrag',
    },
  },
  cookieConsent: {
    title: 'Cookies',
    body: 'Wir verwenden nur notwendige Cookies für Anmeldung, Sprache und diese Auswahl. Eine optionale Analyse ist nicht aktiv und würde nur mit Ihrer Einwilligung laufen.',
    acceptAll: 'Optionale Analyse erlauben',
    necessaryOnly: 'Nur notwendige',
    policy: 'Cookie-Richtlinie',
  },
  notFound: {
    title: 'Seite nicht gefunden',
    body: 'Die gesuchte Seite existiert nicht oder wurde verschoben.',
    home: 'Zur Startseite',
    knowledge: 'Wissensdatenbank durchsuchen',
  },
  ...analyzeDe,
};
