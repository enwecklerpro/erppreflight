/**
 * German rule catalog: title + remediation for every finding code of the analysis engines.
 *
 * The key list is generated from the Python rule catalog (`rule-catalog.en.json`, written by
 * `scripts/generate-rule-catalog-i18n.py`); `src/__tests__/rule-catalog-i18n.test.ts` fails when a
 * code has no German entry here, so a new rule cannot ship without a translation.
 *
 * Display only: engine output (and therefore finding fingerprints, hashes and exports) stays
 * English and deterministic. Human-written, reviewed copy (Part 02 §2.7) — SAP transaction codes,
 * table names and technical identifiers are kept verbatim.
 */
export interface RuleTextDe {
  title: string;
  remediation: string;
}

export type InputRuleSuffix = 'INSUFFICIENT_INPUT' | 'PARSE_ERROR' | 'INVALID_INPUT' | 'PAYLOAD_TOO_LARGE' | 'ARCHIVE_REJECTED';

const RESUPPLY =
  'Es wurde kein Ergebnis erzeugt. Exportieren Sie das Artefakt erneut in einem der von {engineName} akzeptierten Formate ({formats}) und starten Sie die Analyse erneut.';

/** Runner-generated input-validation codes (`<PREFIX>_<SUFFIX>`), shared by every engine. */
export const INPUT_RULES_DE: Record<InputRuleSuffix, RuleTextDe> = {
  INSUFFICIENT_INPUT: {
    title: 'Erforderliche Eingabe fehlt',
    remediation: `Liefern Sie alle Eingaben, die der Engine-Vertrag als erforderlich kennzeichnet (siehe Eintrag im Engine-Katalog). ${RESUPPLY}`,
  },
  PARSE_ERROR: {
    title: 'Artefakt konnte nicht geparst werden',
    remediation: `Beheben Sie den Syntaxfehler an der gemeldeten Zeile/Spalte (oder exportieren Sie die Datei unverändert erneut aus SAP). ${RESUPPLY}`,
  },
  INVALID_INPUT: {
    title: 'Artefakt entspricht nicht dem Eingabevertrag der Engine',
    remediation: `Liefern Sie den für diese Engine dokumentierten Artefakttyp; fremde oder strukturell ungültige Dokumente werden abgewiesen. ${RESUPPLY}`,
  },
  PAYLOAD_TOO_LARGE: {
    title: 'Artefakt überschreitet die Größenbegrenzung',
    remediation: `Teilen Sie den Export auf (z. B. nach Paket, Buchungskreis oder Zeitraum), sodass jeder Upload unter der Nutzlastgrenze des Dienstes bleibt. ${RESUPPLY}`,
  },
  ARCHIVE_REJECTED: {
    title: 'Archiv durch Sicherheitsgrenzen der Datenaufnahme abgewiesen',
    remediation: `Das Archiv hat das Expansionsverhältnis von 100:1, die Gesamtgröße von 500 MB, die Eintragsanzahl oder die Verschachtelungstiefe von 2 Ebenen überschritten oder enthielt Pfadtraversierung bzw. verschlüsselte Einträge. Laden Sie ein flaches, unverschlüsseltes Archiv der Exportdateien hoch. ${RESUPPLY}`,
  },
};

/** Engine-declared finding codes. */
export const RULE_CATALOG_DE: Record<string, RuleTextDe> = {
  // ---------------------------------------------------------------- Account Determination
  ACCT_DET_ACCOUNT_BLOCKED_POSTING: {
    title: 'Ermitteltes Sachkonto ist für Buchungen gesperrt',
    remediation:
      'Heben Sie die Buchungssperre in FS00 auf (Kontenplan- oder Buchungskreisebene) oder verweisen Sie den Findungseintrag auf ein nicht gesperrtes Konto.',
  },
  ACCT_DET_ACCOUNT_NOT_IN_COMPANY_CODE: {
    title: 'Ermitteltes Konto ist im Buchungskreis nicht angelegt',
    remediation:
      'Legen Sie das Sachkonto vor dem Go-live im Buchungskreis an (FS00 / App „Sachkontenstammdaten verwalten“).',
  },
  ACCT_DET_CONFLICTING_RULES: {
    title: 'Widersprüchliche Findungseinträge für denselben Schlüssel',
    remediation:
      'Entfernen Sie doppelte bzw. widersprüchliche OBYC- oder VKOA-Einträge, sodass jeder Konditionsschlüssel auf genau ein Konto führt.',
  },
  ACCT_DET_MISSING_ACCOUNT: {
    title: 'Für eine erforderliche Kombination wird kein Sachkonto ermittelt',
    remediation:
      'Pflegen Sie den fehlenden Eintrag in OBYC (MM: Vorgangsschlüssel / Bewertungsklasse) oder VKOA (SD: Verkaufsorganisation / Kontierungsschlüssel) – in der Cloud über die entsprechende SSCUI –, damit Buchungen nicht mit „Fehler in der Kontenfindung“ abbrechen.',
  },
  // ---------------------------------------------------------------- API Change Guard
  API_BREAKING_ENDPOINT_REMOVED: {
    title: 'Endpunkt entfernt',
    remediation:
      'Stellen Sie den Pfad wieder her oder veröffentlichen Sie eine neue Major-Version der API; migrieren Sie alle Konsumenten aus dem Integrationsverzeichnis, bevor der alte Pfad stillgelegt wird.',
  },
  API_BREAKING_ENTITYSET_REMOVED: {
    title: 'OData-Entitätsmenge entfernt',
    remediation: 'Stellen Sie die Entitätsmenge in Service-Definition/-Binding wieder bereit oder versionieren Sie den OData-Service.',
  },
  API_BREAKING_ENTITY_REMOVED: {
    title: 'OData-Entitätstyp entfernt',
    remediation: 'Stellen Sie den Entitätstyp wieder her oder führen Sie eine neue Service-Version ein; passen Sie die Mappings der Konsumenten an.',
  },
  API_BREAKING_ENUM_RESTRICTED: {
    title: 'Enum-Werte entfernt',
    remediation: 'Akzeptieren Sie die entfernten Enum-Werte weiterhin (serverseitig abbilden) oder versionieren Sie die API.',
  },
  API_BREAKING_FIELD_REMOVED: {
    title: 'Eigenschaft / Feld entfernt',
    remediation:
      'Behalten Sie die Eigenschaft (als veraltet markiert), bis kein Konsument sie mehr liest, oder versionieren Sie die API.',
  },
  API_BREAKING_MAX_LENGTH_DECREASED: {
    title: 'Maximale Länge verringert',
    remediation: 'Behalten Sie die bisherige MaxLength bei; kürzere Grenzen weisen bestehende Daten der Konsumenten ab.',
  },
  API_BREAKING_OPERATION_REMOVED: {
    title: 'Operation entfernt',
    remediation:
      'Behalten Sie die HTTP-Operation (zunächst als veraltet markieren) oder versionieren Sie die API; aktualisieren Sie die Konsumenten vor dem Entfernen.',
  },
  API_BREAKING_REQUIRED_PARAM_ADDED: {
    title: 'Neuer Pflichtparameter',
    remediation: 'Machen Sie den neuen Parameter optional mit einem serverseitigen Standardwert oder versionieren Sie die Operation.',
  },
  API_BREAKING_REQUIRED_PROPERTY_ADDED: {
    title: 'Neue Pflichteigenschaft',
    remediation: 'Machen Sie die Eigenschaft optional (nullable / Standardwert), damit bestehende Nutzlasten gültig bleiben.',
  },
  API_BREAKING_TYPE_CHANGED: {
    title: 'Inkompatible Typänderung',
    remediation:
      'Stellen Sie den bisherigen Typ wieder her oder ergänzen Sie eine neue Eigenschaft mit dem neuen Typ; inkompatible Konvertierungen brechen die Deserialisierung bei Konsumenten.',
  },
  API_DEPRECATION_WARNING: {
    title: 'Element als veraltet markiert',
    remediation: 'Planen Sie die Migration der Konsumenten auf den Nachfolger vor dem angekündigten Entfernungsdatum.',
  },
  API_NON_BREAKING_ENDPOINT_ADDED: {
    title: 'Endpunkt hinzugefügt',
    remediation: 'Keine Aktion für bestehende Konsumenten erforderlich; dokumentieren Sie den neuen Endpunkt.',
  },
  API_NON_BREAKING_ENUM_EXPANDED: {
    title: 'Enum-Werte hinzugefügt',
    remediation: 'Prüfen Sie, dass Konsumenten unbekannte Enum-Werte robust behandeln.',
  },
  API_NON_BREAKING_MAX_LENGTH_INCREASED: {
    title: 'Maximale Länge erhöht',
    remediation: 'Prüfen Sie, dass Konsumenten, die den Wert speichern, über eine ausreichende Feldlänge verfügen.',
  },
  API_NON_BREAKING_OPERATION_ADDED: {
    title: 'Operation hinzugefügt',
    remediation: 'Keine Aktion für bestehende Konsumenten erforderlich; dokumentieren Sie die neue Operation.',
  },
  API_NON_BREAKING_OPTIONAL_PROPERTY_ADDED: {
    title: 'Optionale Eigenschaft hinzugefügt',
    remediation: 'Keine Aktion erforderlich; Konsumenten müssen unbekannte Eigenschaften tolerieren (Tolerant Reader).',
  },
  // ---------------------------------------------------------------- Clean Core Object Guard
  CLEAN_CORE_DIRECT_DB_ACCESS: {
    title: 'Direktes Lesen einer SAP-Standardtabelle',
    remediation:
      'Ersetzen Sie das SELECT auf die Standardtabelle durch die als Nachfolger genannte freigegebene (C1) CDS-View (z. B. MARA -> I_Product); ist keine freigegeben, beantragen Sie eine über das Customer-Influence-Portal oder lesen Sie über eine freigegebene API.',
  },
  CLEAN_CORE_DIRECT_DB_MUTATION: {
    title: 'Direktes Schreiben in eine SAP-Standardtabelle',
    remediation:
      'Schreiben Sie niemals mit INSERT/UPDATE/MODIFY/DELETE in SAP-Tabellen: Verwenden Sie das freigegebene RAP-Business-Objekt (EML MODIFY ENTITIES) oder die freigegebene API der besitzenden Anwendung; direkte Schreibzugriffe umgehen Validierungen und sind in ABAP Cloud gesperrt.',
  },
  CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE: {
    title: 'Dynamisches Aufrufziel nicht verifizierbar',
    remediation:
      'Dynamische Ziele (FROM (lv_tab), CALL FUNCTION lv_fm, CALL METHOD (…)) lassen sich nicht statisch prüfen. Ersetzen Sie sie durch statische Aufrufe oder beschränken Sie die möglichen Werte auf freigegebene Objekte und dokumentieren Sie die Positivliste; ABAP Cloud prüft dynamische Ziele erst zur Laufzeit.',
  },
  CLEAN_CORE_OBJECT_RELEASED: {
    title: 'Objekt ist für die Cloud-Entwicklung freigegeben',
    remediation: 'Keine Aktion erforderlich: Das Objekt ist im für diese Analyse verwendeten Wissens-Snapshot freigegeben (C1).',
  },
  CLEAN_CORE_OBSOLETE_SYNTAX: {
    title: 'Veraltete oder in der Cloud verbotene ABAP-Anweisung',
    remediation:
      'Refaktorieren Sie die Anweisung wie im Befund beschrieben; sie ist nicht Teil der ABAP-Sprachversion „ABAP for Cloud Development“.',
  },
  CLEAN_CORE_UNRELEASED_API: {
    title: 'Aufruf eines nicht für die Cloud-Entwicklung freigegebenen Funktionsbausteins',
    remediation:
      'Ersetzen Sie den Aufruf durch den im Befund genannten freigegebenen Nachfolger (Cloudification Repository). Funktionsbausteine, die nicht in der Freigabeliste stehen, gelten als nicht freigegeben, bis SAP sie freigibt.',
  },
  CLEAN_CORE_UNRELEASED_CLASS: {
    title: 'Verwendung einer nicht für die Cloud-Entwicklung freigegebenen Klasse',
    remediation:
      'Ersetzen Sie die Klasse durch den freigegebenen Nachfolger (z. B. CL_BCS -> CL_BCS_MAIL_MESSAGE); SAP-GUI-/ALV-Klassen haben kein ABAP-Cloud-Pendant und erfordern eine Fiori-Oberfläche.',
  },
  CLEAN_CORE_UNRELEASED_OBJECT: {
    title: 'Verweis auf ein Objekt außerhalb des Snapshots freigegebener Objekte',
    remediation:
      'Prüfen Sie den Freigabestatus des Objekts in ADT (Eigenschaften > API-Status) oder im Cloudification Repository; verwenden Sie den freigegebenen Nachfolger oder eine eigene CDS-View auf freigegebenen Views.',
  },
  // ---------------------------------------------------------------- Change Pointer Inspector
  CP_CUSTOM_FIELD_OMITTED_BD52: {
    title: 'Kundenfeld fehlt in BD52',
    remediation:
      'Nehmen Sie das Kundenfeld (YY1_/ZZ) für den Nachrichtentyp in BD52 auf und erweitern Sie das IDoc-Segment bzw. Mapping, damit der Wert verteilt wird.',
  },
  CP_FIELD_DD04L_CHGFLAG_MISSING: {
    title: 'Datenelement nicht änderungsbelegrelevant',
    remediation:
      'Setzen Sie in SE11 am Datenelement des Feldes das Kennzeichen „Änderungsbeleg“ (DD04L-LOGFLAG) und generieren Sie das Änderungsbelegobjekt (SCDO) neu.',
  },
  CP_FIELD_FILTERED_BD53: {
    title: 'Feld durch reduzierten Nachrichtentyp gefiltert (BD53)',
    remediation: 'Prüfen Sie den reduzierten Nachrichtentyp in BD53 und wählen Sie das Feld aus, wenn nachgelagerte Systeme es benötigen.',
  },
  CP_FIELD_NOT_CONFIGURED_BD52: {
    title: 'Erwartetes Feld in BD52 nicht zugeordnet',
    remediation:
      'Nehmen Sie Tabelle/Feld in BD52 in das Änderungsbelegobjekt des Nachrichtentyps auf (Tabelle TBD62); andernfalls erzeugen Änderungen am Feld niemals Änderungszeiger.',
  },
  CP_GLOBAL_DEACTIVATED: {
    title: 'Änderungszeiger global deaktiviert (BD61)',
    remediation:
      'Führen Sie BD61 im sendenden Mandanten aus, setzen Sie „Änderungszeiger generell aktiv“ und transportieren Sie das Customizing (Tabelle TBDA1).',
  },
  CP_MSG_TYPE_DEACTIVATED: {
    title: 'Änderungszeiger des Nachrichtentyps inaktiv (BD50)',
    remediation: 'Aktivieren Sie die Änderungszeiger für den Nachrichtentyp in BD50 (Tabelle TBDA2) und transportieren Sie den Eintrag.',
  },
  CP_RUNTIME_UNPROCESSED_BACKLOG: {
    title: 'Rückstau unverarbeiteter Änderungszeiger (BDCP2)',
    remediation:
      'Planen bzw. reparieren Sie den Report RBDMIDOC (BD21) für den Nachrichtentyp, prüfen Sie die Joblogs in SM37 und bereinigen Sie verarbeitete Zeiger mit RBDCPCLR2.',
  },
  // ---------------------------------------------------------------- Decommission Audit
  DECOM_ACTIVE_RFC_DEPENDENCY: {
    title: 'RFC-Destinationen melden sich mit dem Benutzer an',
    remediation:
      'Stellen Sie die aufgeführten Destinationen in SM59 vor der Deaktivierung auf einen eigenen Kommunikationsbenutzer mit minimalen Rollen um.',
  },
  DECOM_LOCKED_USER_CALL_FLOOD: {
    title: 'Gesperrter Benutzer erhält weiterhin Anmeldeversuche',
    remediation:
      'Ermitteln Sie das aufrufende System aus SM20/SM21 (Terminal / RFC-Aufrufer) und aktualisieren Sie dessen Zugangsdaten oder deaktivieren Sie die Schnittstelle vor der Archivierung.',
  },
  DECOM_RECENT_ACTIVITY_DETECTED: {
    title: 'Benutzer innerhalb der Karenzzeit aktiv',
    remediation: 'Sperren Sie die Dialoganmeldung und beobachten Sie 14–30 Tage (SM20 / ST03N), bevor Sie löschen oder archivieren.',
  },
  DECOM_SAFE_FOR_ARCHIVING: {
    title: 'In den gelieferten Extrakten keine Abhängigkeiten gefunden',
    remediation:
      'Folgen Sie dem Stilllegungs-Runbook: in SU01 sperren, Gültigkeitsende setzen, Rollen entziehen, mit SARA archivieren. Das Ergebnis gilt nur für die gelieferten Extrakte aus USR02/TBTCO/RFCDES/SWWWIHEAD und das Auswertungsdatum.',
  },
  DECOM_SCHEDULED_JOB_DEPENDENCY: {
    title: 'Hintergrundjobs laufen unter dem Benutzer',
    remediation:
      'Ändern Sie in SM37 den Step-Benutzer der aufgeführten Jobs auf einen technischen Benutzer (Typ System), bevor Sie das Konto sperren; freigegebene periodische Jobs brechen sonst ab.',
  },
  DECOM_USER_NOT_FOUND: {
    title: 'Kandidatenbenutzer fehlt in USR02',
    remediation: 'Prüfen Sie Benutzer-ID und Mandant; exportieren Sie die vollständige USR02 des Mandanten und starten Sie die Analyse erneut.',
  },
  DECOM_WORKFLOW_AGENT_DEPENDENCY: {
    title: 'Dem Benutzer sind offene Workitems zugeordnet',
    remediation:
      'Leiten Sie die offenen Workitems in SWIA / SBWP weiter und aktualisieren Sie die Bearbeiterfindung (Regeln / Organisationszuordnung).',
  },
  // ---------------------------------------------------------------- ECC2Cloud Navigator
  ECC_BAPI_RFC_MODERNIZATION_FOUND: {
    title: 'Freigegebener API-Nachfolger für BAPI-/RFC-Schnittstelle',
    remediation:
      'Stellen Sie die Integration vor dem Cut-over auf die aufgeführte freigegebene OData-/SOAP-API (Kommunikationsvereinbarung) um.',
  },
  ECC_BAPI_RFC_UNRELEASED_BLOCKER: {
    title: 'Nicht freigegebene BAPI-/RFC-Schnittstelle',
    remediation:
      'Nicht freigegebene RFC-/BAPI-Aufrufe von außen sind in S/4HANA Cloud nicht erlaubt; migrieren Sie den Aufrufer auf eine freigegebene API (api.sap.com) oder kapseln Sie die Logik in einem eigenen freigegebenen OData-Service.',
  },
  ECC_IDOC_MODERNIZATION_EVENT_MESH: {
    title: 'IDoc-Schnittstelle hat einen Event-/API-Nachfolger',
    remediation:
      'Ersetzen Sie das IDoc durch das aufgeführte Business Event (SAP Event Mesh / Advanced Event Mesh) oder die freigegebene API und passen Sie das Middleware-Mapping an.',
  },
  ECC_IDOC_UNSUPPORTED_BLOCKER: {
    title: 'IDoc-Typ im Cloud-Zielsystem nicht unterstützt',
    remediation:
      'Gestalten Sie die Integration mit einer freigegebenen API oder einem Event neu; der IDoc-Basistyp ist in der Zieledition nicht verwendbar.',
  },
  ECC_TCODE_CUSTOM_CODE_REVIEW: {
    title: 'Kundeneigene Z/Y-Transaktion erfordert Clean-Core-Prüfung',
    remediation:
      'Implementieren Sie das kundeneigene Dynpro als RAP-basierte Fiori-Elements-App in ABAP Cloud (Tier 1) oder als Side-by-Side-Erweiterung auf BTP neu; lassen Sie den Clean Core Object Guard auf den Quellcode laufen.',
  },
  ECC_TCODE_NO_EQUIVALENT_BLOCKER: {
    title: 'Klassische Transaktion in S/4HANA Cloud nicht zulässig',
    remediation:
      'Die Transaktion (z. B. SE38, SM30-basierte Pflege) hat kein Cloud-Pendant; verlagern Sie den Anwendungsfall in ADT / ABAP-Cloud-Entwicklung, Key-User-Apps oder SAP BTP.',
  },
  ECC_TCODE_OBSOLETE_REDESIGN: {
    title: 'Transaktion erfordert Prozess-Redesign oder fehlt im Cloud-Katalog',
    remediation:
      'Führen Sie für den Prozess hinter der Transaktion einen Fit-to-Standard-Workshop durch; bilden Sie ihn auf das genannte Nachfolgekonzept oder eine Standard-Fiori-App ab, andernfalls auf eine BTP-Erweiterung.',
  },
  ECC_TCODE_SUCCESSOR_FOUND: {
    title: 'Fiori-/Cloud-Nachfolger für die Transaktion verfügbar',
    remediation:
      'Planen Sie die Einführung der aufgeführten Fiori-Nachfolge-App, ordnen Sie Business-Rolle/Katalog zu und entfernen Sie die klassische Transaktion aus den Rollen.',
  },
  // ---------------------------------------------------------------- Extension Impact Guard
  EXT_CYCLIC_DEPENDENCY_DETECTED: {
    title: 'Zyklische Erweiterungsabhängigkeit',
    remediation:
      'Brechen Sie den Zyklus auf: Verlagern Sie gemeinsame Felder in eine separate Interface-CDS-View (oder erweitern Sie die freigegebene C1-View einmalig), lassen Sie die Konsumenten nur in eine Richtung davon abhängen und transportieren Sie die Collection in Abhängigkeitsreihenfolge.',
  },
  EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS: {
    title: 'Löschen durch aktive Konsumenten blockiert',
    remediation:
      'Entfernen oder verweisen Sie jeden aktiven Konsumenten (Formularvorlagen, CDS-Views, APIs, App-Varianten) um, bevor Sie das Objekt in „Benutzerdefinierte Felder“ / „Benutzerdefinierte CDS-Views“ löschen; zuerst die Konsumenten löschen, dann das Objekt.',
  },
  EXT_HIGH_BLAST_RADIUS_WARNING: {
    title: 'Große Auswirkungsbreite der Änderung',
    remediation:
      'Planen Sie Regressionstests für jedes betroffene Formular, jede CDS-View und API; geben Sie den Transport erst nach Test-Abnahme frei.',
  },
  EXT_MODIFICATION_BREAKING_CONSUMERS: {
    title: 'Änderung wirkt sich auf nachgelagerte Konsumenten aus',
    remediation:
      'Prüfen Sie die Feldzuordnungen aller nachgelagerten Konsumenten und passen Sie sie in derselben Software Collection an, bevor Sie die Änderung transportieren.',
  },
  EXT_SAFE_TO_DELETE: {
    title: 'Keine aktiven Konsumenten im gelieferten Graphen',
    remediation:
      'Das Löschen ist nur in Bezug auf das gelieferte Inventar sicher; bestätigen Sie, dass das Inventar für das Zielsystem vollständig ist, löschen Sie dann über die Key-User-Erweiterbarkeit und transportieren Sie die Löschung.',
  },
  EXT_TARGET_OBJECT_NOT_FOUND: {
    title: 'Angefordertes Erweiterungsobjekt fehlt im Abhängigkeitsgraphen',
    remediation:
      'Prüfen Sie den technischen Namen von „target_object“ (Groß-/Kleinschreibung beachten) und exportieren Sie das Erweiterungsinventar erneut, sodass es das Objekt und alle Konsumenten enthält; es wurde keine Auswirkungsbewertung erzeugt.',
  },
  // ---------------------------------------------------------------- Custom Field Flow Doctor
  FIELD_BADI_REQUIRED_NOT_FOUND: {
    title: 'Erforderliche Cloud-BAdI-Implementierung fehlt',
    remediation:
      'Implementieren und veröffentlichen Sie das aufgeführte Cloud-BAdI in der App „Benutzerdefinierte Logik“, damit der Feldwert in den Zielkontext kopiert wird (z. B. BADI_FINS_ACDOC_EXT_PERSISTENCE für Journalbuchungspositionen).',
  },
  FIELD_MISSING_TARGET_CONTEXT: {
    title: 'Kundenfeld im Ziel-Geschäftskontext nicht aktiviert',
    remediation:
      'Öffnen Sie das Feld in der App „Benutzerdefinierte Felder“, Registerkarte „UIs und Berichte“ / „Geschäftsszenarien“, aktivieren Sie es für den Ziel-Geschäftskontext und veröffentlichen Sie das Feld erneut.',
  },
  FIELD_NAME_INVALID_PREFIX: {
    title: 'Name des Kundenfelds verletzt die Key-User-Namenskonvention',
    remediation:
      'Key-User-Felder müssen das Präfix YY1_ verwenden (Entwicklererweiterbarkeit: ZZ1_). Legen Sie das Feld in der App „Benutzerdefinierte Felder“ mit einem konformen technischen Namen neu an und migrieren Sie die Daten vor dem Transport.',
  },
  FIELD_PROPAGATION_BLOCKED: {
    title: 'Kundenfeld kann über diesen Übergang nicht weitergegeben werden',
    remediation:
      'Aktivieren Sie das von SAP ausgelieferte Geschäftsszenario für den Übergang (Benutzerdefinierte Felder > Geschäftsszenarien) oder leiten Sie den Wert über die unterstützten Zwischen-Belegkontexte.',
  },
  FIELD_PROPAGATION_REQUIRES_BADI: {
    title: 'Weitergabe beruht auf kundeneigener BAdI-Logik',
    remediation: 'Halten Sie die BAdI-Implementierung unter Regressionstest; sie muss nach jedem Upgrade erneut validiert werden.',
  },
  FIELD_TYPE_MISMATCH: {
    title: 'Inkompatibler Feldtyp oder inkompatible Länge über einen Übergang',
    remediation:
      'Gleichen Sie Typ und Länge des Kundenfelds in beiden Geschäftskontexten an (ein Key-User-Feld kann seinen Typ nach der Veröffentlichung nicht ändern – neues Feld anlegen und migrieren), sonst werden Werte abgeschnitten oder abgewiesen.',
  },
  // ---------------------------------------------------------------- Fiori Auth Guard
  FIORI_403_INSUFFICIENT_TELEMETRY: {
    title: 'Ursache aus der gelieferten Telemetrie nicht bestimmbar',
    remediation:
      'Erfassen Sie für die fehlschlagende Anfrage einen SU53-Trace, den Eintrag in /IWFND/ERROR_LOG und den SICF-Status und starten Sie die Analyse erneut; die gelieferten Daten lassen keine Ursache erkennen.',
  },
  FIORI_AUTH_OBJECT_MISSING: {
    title: 'Berechtigungsprüfung fehlgeschlagen (SU53)',
    remediation:
      'Nehmen Sie die fehlenden Werte des Berechtigungsobjekts (z. B. S_SERVICE für den Service-Hash, S_START) in die PFCG-Rolle des Benutzers auf – in der Cloud über den Fiori-Business-Katalog / die IAM-App – und generieren Sie das Profil neu.',
  },
  FIORI_CLOUD_CONNECTOR_DENIED: {
    title: 'Vom SAP Cloud Connector abgelehnt',
    remediation:
      'Geben Sie den Ressourcenpfad des Backends in der Zugriffskontrolle des Cloud Connectors frei und korrigieren Sie die Principal Propagation (Vertrauensstellung / CN-Mapping).',
  },
  FIORI_CSRF_TOKEN_INVALID: {
    title: 'CSRF-Token fehlt oder ist bei ändernder Anfrage ungültig',
    remediation:
      'Holen Sie mit „X-CSRF-Token: Fetch“ bei einem GET/HEAD ein Token und senden Sie Token und Sitzungs-Cookies mit dem POST/PUT/PATCH/DELETE; prüfen Sie, dass Proxys / Web Dispatcher das Sitzungs-Cookie erhalten.',
  },
  FIORI_GATEWAY_SERVICE_NOT_ACTIVATED: {
    title: 'Gateway-Service nicht registriert / kein Systemalias',
    remediation:
      'Registrieren und aktivieren Sie den OData-Service in /IWFND/MAINT_SERVICE (V2) oder /IWFND/V4_ADMIN (V4) und ordnen Sie den korrekten Systemalias zu.',
  },
  FIORI_ICF_INACTIVE: {
    title: 'ICF-Serviceknoten inaktiv (SICF)',
    remediation:
      'Aktivieren Sie den Serviceknoten und seine übergeordneten Knoten in SICF (oder /IWFND/MAINT_SERVICE > ICF-Knoten > Aktivieren).',
  },
  FIORI_UCON_DENIED: {
    title: 'Durch UCON / RFC-Positivliste blockiert',
    remediation:
      'Nehmen Sie den Service bzw. RFC-Funktionsbaustein in die Positivliste der UCON-Kommunikationsbaugruppe (UCONCOCKPIT) auf oder überführen Sie ihn korrekt aus der Protokollierungsphase.',
  },
  // ---------------------------------------------------------------- FormDoctor
  FORM_BINDING_PATH_MISMATCH: {
    title: 'Feldbindungspfad passt nicht zum Laufzeit-XML',
    remediation:
      'Aktualisieren Sie die Datenbindung (dataRef) des Feldes in der XDP-Vorlage auf den vorgeschlagenen Laufzeit-XML-Pfad oder gleichen Sie Formularschnittstelle / CDS-Datenprovider an, sodass das Element unter dem gebundenen Pfad erscheint.',
  },
  FORM_FIELD_HIDDEN_IN_LAYOUT: {
    title: 'Gebundenes Feld im Layout ausgeblendet',
    remediation:
      'Setzen Sie im Adobe LiveCycle Designer die Präsenz des Feldes auf „Sichtbar“ (Objekt > Feld), wenn es gedruckt werden muss; andernfalls dokumentieren Sie die bewusste Unterdrückung.',
  },
  FORM_FIELD_MISSING_IN_XML: {
    title: 'Gebundenes Feld fehlt im Laufzeit-XML',
    remediation:
      'Stellen Sie das Element im Datenprovider des Formulars bereit (CDS-View bzw. Gateway-Formulardatenservice der Output-Verwaltung erweitern) oder entfernen Sie die unbelegte Bindung aus der XDP-Vorlage.',
  },
  FORM_LEGACY_SAPSCRIPT_DETECTED: {
    title: 'Veraltetes SAPscript erkannt',
    remediation:
      'SAPscript ist in ABAP Cloud / S/4HANA Cloud nicht verfügbar. Gestalten Sie das Dokument als Adobe-Formular (XDP) mit der Output-Verwaltung (BRFplus-Findung) neu oder verwenden Sie die von SAP ausgelieferte Formularvorlage.',
  },
  FORM_LEGACY_SMARTFORM_DETECTED: {
    title: 'Veraltetes Smart Form erkannt',
    remediation:
      'Smart Forms werden in S/4HANA Cloud Public Edition nicht unterstützt. Bauen Sie das Layout als Adobe-Formular (XDP) auf einem freigegebenen Formulardatenprovider neu auf oder übernehmen Sie die von SAP ausgelieferte Output-Formularvorlage.',
  },
  // ---------------------------------------------------------------- SAP Gap Radar
  GAP_RADAR_BLOCKED_CLEAN_CORE_VIOLATION: {
    title: 'Anforderung impliziert einen Clean-Core-Verstoß (Stufe 11)',
    remediation:
      'Direkte Tabellenschreibzugriffe / Modifikationen sind in der Cloud nicht möglich; gestalten Sie die Lösung auf Basis freigegebener APIs, RAP-Business-Objekte oder BAdIs neu.',
  },
  GAP_RADAR_KNOWN_PRODUCT_GAP: {
    title: 'Bekannte Produktlücke (Stufe 11)',
    remediation:
      'Verfolgen Sie den SAP-Roadmap-Eintrag, stellen Sie eine Influence-Anfrage oder schließen Sie die Lücke mit einer BTP-Erweiterung.',
  },
  GAP_RADAR_SUPPORTED_BUSINESS_EVENT: {
    title: 'Anforderung durch Business Events abgedeckt (Stufe 8)',
    remediation:
      'Abonnieren Sie das freigegebene Business Event über SAP Event Mesh / Advanced Event Mesh (Enterprise Event Enablement).',
  },
  GAP_RADAR_SUPPORTED_CONFIGURATION: {
    title: 'Anforderung durch Konfiguration abgedeckt (Stufe 2)',
    remediation:
      'Konfigurieren Sie über die SSCUI bzw. die Aktivität in Central Business Configuration; dokumentieren Sie sie im Konfigurationshandbuch.',
  },
  GAP_RADAR_SUPPORTED_DEVELOPER_EXTENSIBILITY: {
    title: 'Anforderung durch Entwicklererweiterbarkeit abgedeckt (Stufe 4/7)',
    remediation:
      'Implementieren Sie in ABAP Cloud (RAP / freigegebenes BAdI) in einer Tier-1-Softwarekomponente; keine klassischen Erweiterungen.',
  },
  GAP_RADAR_SUPPORTED_KEY_USER: {
    title: 'Anforderung durch Key-User-Erweiterbarkeit abgedeckt (Stufe 3)',
    remediation:
      'Setzen Sie die Anforderung mit den Apps „Benutzerdefinierte Felder“ / „Benutzerdefinierte Logik“ / „Benutzerdefinierte CDS-Views“ um und transportieren Sie über Software Collections.',
  },
  GAP_RADAR_SUPPORTED_RELEASED_API: {
    title: 'Anforderung durch freigegebene API abgedeckt (Stufe 6)',
    remediation: 'Verwenden Sie die freigegebene OData-/SOAP-API mit einer Kommunikationsvereinbarung.',
  },
  GAP_RADAR_SUPPORTED_RELEASED_CDS: {
    title: 'Anforderung durch freigegebene CDS-Views abgedeckt (Stufe 5)',
    remediation: 'Konsumieren Sie die freigegebene (C1) CDS-View; lesen Sie niemals die zugrunde liegenden Tabellen.',
  },
  GAP_RADAR_SUPPORTED_SIDE_BY_SIDE: {
    title: 'Anforderung Side-by-Side auf SAP BTP abgedeckt (Stufe 9)',
    remediation: 'Bauen Sie die Erweiterung auf SAP BTP (CAP / Build Apps) mit freigegebenen APIs und Events.',
  },
  GAP_RADAR_SUPPORTED_STANDARD: {
    title: 'Anforderung durch Standard-Scope-Item abgedeckt (Stufe 1)',
    remediation: 'Aktivieren Sie das SAP-Best-Practices-Scope-Item; bauen Sie für diese Anforderung keine kundeneigenen Objekte.',
  },
  GAP_RADAR_SUPPORTED_WORKAROUND: {
    title: 'Anforderung nur durch einen Workaround abgedeckt (Stufe 10)',
    remediation: 'Dokumentieren Sie den Workaround, seinen Verantwortlichen und einen Ausstiegsplan; prüfen Sie ihn bei jedem Release erneut.',
  },
  GAP_RADAR_UNKNOWN_REQUIREMENT: {
    title: 'Anforderung konnte nicht klassifiziert werden (Stufe 12)',
    remediation:
      'Präzisieren Sie die Anforderung (Prozess, Objekt, Integrationspunkt) und starten Sie die Analyse erneut oder bewerten Sie sie manuell.',
  },
  // ---------------------------------------------------------------- IAM Cost Guard
  IAM_LICENSE_TIER_INFLATION_DRIVER: {
    title: 'Einzelne App hebt die Lizenzstufe der Rolle an',
    remediation:
      'Verschieben Sie die App, die die Lizenzstufe anhebt, in eine separate, eng zugeordnete Rolle, damit die übrigen Benutzer auf der niedrigeren Stufe (Core / Self-Service) bleiben.',
  },
  IAM_PERMANENT_EMERGENCY_ROLE: {
    title: 'Notfallrolle ohne Enddatum zugeordnet',
    remediation:
      'Begrenzen Sie die Zuordnung der Notfall-/Firefighter-Rolle zeitlich (SU01 / Identity Provisioning) und gewähren Sie den Zugriff über einen genehmigten, protokollierten Notfallzugriffsprozess.',
  },
  IAM_REDUNDANT_CATALOG_DETECTED: {
    title: 'Katalog vollständig in einem anderen Katalog der Rolle enthalten',
    remediation:
      'Entfernen Sie den redundanten Business-Katalog aus der Rolle (PFCG / „Business-Rollen pflegen“); seine Apps werden bereits über den übergeordneten Katalog gewährt.',
  },
  IAM_UNUSED_CRITICAL_AUTHORIZATION: {
    title: 'Kritische Berechtigung nie verwendet',
    remediation:
      'Entziehen Sie der Rolle das ungenutzte kritische Berechtigungsobjekt oder stellen Sie es nur über Firefighter- / PAM-Zugriff bereit.',
  },
  // ---------------------------------------------------------------- MFS BlackBox
  MFS_CORRUPTED_TELEGRAM: {
    title: 'Fehlerhafter Telegrammsatz',
    remediation:
      'Prüfen Sie die Telegrammstruktur-Definition der SPS / MFS (/SCWM/MFS-Telegrammstrukturen) und den Log-Export; fehlerhafte Sätze wurden von der Rekonstruktion ausgeschlossen.',
  },
  MFS_DUPLICATE_TELEGRAM_SEND: {
    title: 'Doppelte Telegrammübertragung (Retry-Sturm)',
    remediation:
      'Untersuchen Sie fehlende bzw. verspätete ACKs, die Wiederholungen auslösen; passen Sie Wiederholintervall und maximale Wiederholungen in der Kanalkonfiguration an.',
  },
  MFS_FIRST_CAUSAL_DIVERGENCE: {
    title: 'Erste kausale Abweichung in der Vorfallzeitleiste',
    remediation: 'Beginnen Sie die Ursachenanalyse beim referenzierten Telegramm; spätere Auffälligkeiten sind wahrscheinlich Folgefehler.',
  },
  MFS_IMPOSSIBLE_TOPOLOGY_JUMP: {
    title: 'HU zwischen nicht benachbarten Fördertechnikpunkten bewegt',
    remediation:
      'Gleichen Sie die Definitionen der Fördersegmente / Kommunikationspunkte mit dem physischen Layout ab und prüfen Sie auf fehlende Scannerlesungen zwischen den beiden Punkten.',
  },
  MFS_MISSING_ACK_TIMEOUT: {
    title: 'Telegramm nicht innerhalb des Timeouts quittiert',
    remediation:
      'Prüfen Sie die SPS-Verbindung und den ACK-Timeout des Kanals; nicht quittierte Bewegungen lassen Lageraufgaben offen.',
  },
  MFS_OUT_OF_ORDER_SEQUENCE: {
    title: 'Telegrammfolge vertauscht oder lückenhaft',
    remediation:
      'Prüfen Sie die Sequenznummernbehandlung und den Wiederholpuffer des Kommunikationskanals (Monitoring /SCWM/MFS_CP_CHANNEL); verlorene Telegramme müssen mit der SPS resynchronisiert werden.',
  },
  // ---------------------------------------------------------------- OPD Guard
  OPD_CHANNEL_INACTIVE: {
    title: 'Ermittelter Ausgabekanal ist inaktiv oder nicht unterstützt',
    remediation:
      'Ändern Sie das Ergebnis der Entscheidungstabelle „Kanal“ auf einen unterstützten Kanal (EMAIL, PRINT, EDI, XML, IDOC, PORTAL) und stellen Sie sicher, dass der Kanal für die Ausgabeart unter SPRO > Output Control > Geschäftsregeln definieren aktiv ist.',
  },
  OPD_DETERMINATION_STEP_MISSING: {
    title: 'Ausgabefindungsschritt ohne passende Regel',
    remediation:
      'Ergänzen Sie in der Output Parameter Determination (BRFplus, App „Output Parameter Determination“) eine Zeile der Entscheidungstabelle für den fehlschlagenden Schritt, die zu den Konditionswerten des Belegs passt, oder eine abschließende Platzhalterzeile („*“). Wiederholen Sie die Findungssimulation für die Belegart.',
  },
  OPD_PRINTER_QUEUE_NOT_FOUND: {
    title: 'PRINT-Kanal ohne Druckwarteschlange',
    remediation:
      'Pflegen Sie eine Zeile der Entscheidungstabelle „Drucker“, die eine gültige Druckwarteschlange liefert (App „Druckwarteschlangen pflegen“ / SAP Cloud Print Manager oder SPAD-Ausgabegerät On-Premise).',
  },
  OPD_RELEVANCE_SUPPRESSED: {
    title: 'Ausgabeerzeugung durch Relevanzregel unterdrückt',
    remediation:
      'Bestätigen Sie, dass die Tabelle „Output Relevance“ für diesen Belegstatus bewusst FALSE liefert; andernfalls korrigieren Sie die Relevanzbedingung.',
  },
  OPD_UNREACHABLE_RULE: {
    title: 'Zeile der Entscheidungstabelle durch eine frühere Zeile verdeckt',
    remediation:
      'Ordnen Sie die Entscheidungstabelle so, dass spezifische Konditionszeilen vor allgemeineren Platzhalterzeilen stehen (BRFplus wertet den ersten Treffer aus), oder löschen Sie die redundante Zeile.',
  },
  // ---------------------------------------------------------------- System Refresh Guard
  REFRESH_CRITICAL_JOB_SCHEDULED: {
    title: 'Sensible Produktionsjobs in der Kopie freigegeben',
    remediation: 'Setzen Sie freigegebene Jobs nach der Kopie aus (BTCTRNS1) und geben Sie nur geprüfte Jobs wieder frei.',
  },
  REFRESH_INPUT_SID_MISMATCH: {
    title: 'SID des Extrakts weicht von der SID des aufgefrischten Zielsystems ab',
    remediation: 'Extrahieren Sie erneut aus dem aufgefrischten (Ziel-)System; Prüfungen gegen das falsche System sind wertlos.',
  },
  REFRESH_ISOLATION_VERIFIED: {
    title: 'Isolation für die gelieferten Bereiche verifiziert',
    remediation:
      'Keine Aktion erforderlich; das Ergebnis gilt genau für die gelieferten Extrakte zu RFC, SCOT, logischen Systemen, Jobs und Druckern.',
  },
  REFRESH_LOGICAL_SYSTEM_UNADJUSTED: {
    title: 'Namen logischer Systeme nicht umgesetzt (BDLS)',
    remediation:
      'Führen Sie BDLS für den Mandanten aus, um die logischen Systemnamen der Produktion umzusetzen, und prüfen Sie die ALE-Partnervereinbarungen (WE20) erneut.',
  },
  REFRESH_PRODUCTION_PRINTER_ACTIVE: {
    title: 'Produktionsdrucker in der Kopie aktiv',
    remediation: 'Sperren Sie Produktions-Ausgabegeräte in SPAD oder verweisen Sie sie auf Testgeräte.',
  },
  REFRESH_RFC_TARGETS_PRODUCTION: {
    title: 'RFC-Destinationen zeigen weiterhin auf die Produktion',
    remediation:
      'Verweisen Sie die aufgeführten SM59-Destinationen um oder sperren Sie sie (Post-Copy-Automatisierung / BDLS + RFC-Import), bevor Sie das System freigeben; Produktionsaufrufe aus einer Kopie verfälschen produktive Daten.',
  },
  REFRESH_SCOT_OUTBOUND_ACTIVE: {
    title: 'Ausgehender E-Mail-Versand ohne Umleitung aktiv',
    remediation:
      'Deaktivieren Sie den SMTP-Knoten oder konfigurieren Sie in SCOT/SOST eine Sammelumleitung, bevor Sie Jobs wieder starten.',
  },
  // ---------------------------------------------------------------- Software Collection Guard
  SC_CIRCULAR_DEPENDENCY: {
    title: 'Zirkuläre Abhängigkeit zwischen Software Collections',
    remediation:
      'Führen Sie die voneinander abhängigen Einträge in einer Collection zusammen oder verlagern Sie die gemeinsamen Voraussetzungsobjekte in eine zuerst importierte Basis-Collection; zirkuläre Collections lassen sich in keiner Reihenfolge importieren.',
  },
  SC_DANGLING_FIELD_REFERENCE: {
    title: 'Eintrag verweist auf ein nicht exportiertes oder nicht vorhandenes Feld',
    remediation:
      'Nehmen Sie das referenzierte Kundenfeld in eine exportierte Collection auf oder bestätigen Sie, dass es im Ziel-Tenant existiert; andernfalls schlägt die Aktivierung beim Import fehl.',
  },
  SC_DRAFT_ITEM_INCLUDED: {
    title: 'Unveröffentlichter Eintrag (Entwurf) in der Collection',
    remediation:
      'Veröffentlichen Sie den Eintrag vor dem Export in seiner Key-User-App (Benutzerdefinierte Felder / Logik / CDS-Views); Entwürfe werden nicht transportiert.',
  },
  SC_MISSING_PREREQUISITE: {
    title: 'Vorausgesetzte Collection weder exportiert noch im Zielsystem',
    remediation:
      'Nehmen Sie die vorausgesetzte Collection in den Export auf oder importieren Sie sie zuerst in den Ziel-Tenant („Collection importieren“) und starten Sie den Preflight erneut.',
  },
  SC_SCHEMA_VALIDATION_FAILED: {
    title: 'Collection- oder Eintragsdatensatz verletzt das Exportschema',
    remediation:
      'Exportieren Sie die Software Collection erneut über „Software Collection exportieren“; dem genannten Collection-/Eintragsdatensatz fehlen Pflichtattribute (id, type, status) und er wurde von der Abhängigkeitsanalyse ausgeschlossen.',
  },
  // ---------------------------------------------------------------- SPRO2Cloud
  SPRO_MAPPING_EXACT: {
    title: 'IMG-Aktivität hat ein exaktes Cloud-SSCUI-Pendant',
    remediation:
      'Legen Sie die Einstellung im Ziel-Tenant über die zugeordnete SSCUI unter „Manage Your Solution“ > „Configure Your Solution“ im aufgeführten Scope-Item an; kein Redesign erforderlich.',
  },
  SPRO_MAPPING_NEEDS_REVIEW: {
    title: 'Nicht katalogisierte / kundeneigene Konfiguration erfordert manuelle Prüfung',
    remediation:
      'Die Aktivität ist nicht im kuratierten SPRO→SSCUI-Katalog-Snapshot enthalten. Bewerten Sie sie manuell; kundeneigene Z/Y-Tabellen lassen sich als Custom Business Objects oder ABAP-Cloud-Tabellen mit Pflege-App nachbauen.',
  },
  SPRO_MAPPING_NOT_AVAILABLE: {
    title: 'IMG-Aktivität in S/4HANA Cloud Public Edition nicht verfügbar',
    remediation:
      'Behandeln Sie dies als Cloud-Paritätslücke: Übernehmen Sie den Standardprozess, verlagern Sie die Anforderung in eine Side-by-Side-Erweiterung auf SAP BTP oder ziehen Sie die Private Edition in Betracht.',
  },
  SPRO_MAPPING_PARTIAL: {
    title: 'IMG-Aktivität in der Cloud nur teilweise verfügbar',
    remediation:
      'Verwenden Sie die zugeordnete SSCUI für die unterstützten Parameter; implementieren Sie die eingeschränkten Unterparameter mit Key-User-Erweiterbarkeit neu oder dokumentieren Sie sie als Fit-to-Standard-Abweichung.',
  },
  SPRO_MAPPING_PROCESS_REDESIGN: {
    title: 'Altes Konfigurationskonzept erfordert Prozess-Redesign',
    remediation:
      'Gestalten Sie den Prozess auf Basis des im Befund genannten Cloud-Nachfolgekonzepts neu (z. B. Output-Verwaltung statt NACE); planen Sie ihn als Migrationsarbeitspaket mit fachlicher Abnahme.',
  },
  SPRO_MAPPING_SCOPE_DEPENDENT: {
    title: 'Cloud-Einstellung erfordert Aktivierung eines Scope-Items',
    remediation:
      'Aktivieren Sie die aufgeführten Scope-Items in Central Business Configuration, bevor Sie die SSCUI konfigurieren; prüfen Sie die Lizenzierung des Scope-Items.',
  },
  // ---------------------------------------------------------------- Transport Dependency Guard
  TR_CALL_DEPENDENCY_SEQUENCE_RISK: {
    title: 'Aufrufer wird vor dem referenzierten Objekt importiert',
    remediation:
      'Importieren Sie zuerst den Transport mit dem referenzierten Objekt (Importqueue in STMS / geplante Reihenfolge anpassen) oder bündeln Sie Aufrufer und Aufgerufenen in einem Transport von Kopien.',
  },
  TR_CIRCULAR_DEPENDENCY_DETECTED: {
    title: 'Zirkuläre Abhängigkeit zwischen Transporten',
    remediation:
      'Führen Sie die wechselseitig abhängigen Aufträge in einem Transport von Kopien zusammen; zirkuläre Aufträge haben keine gültige Importreihenfolge.',
  },
  TR_CUSTOMIZING_AHEAD_OF_STRUCTURE: {
    title: 'Customizing vor seiner DDIC-Struktur importiert',
    remediation:
      'Importieren Sie den Workbench-Auftrag, der die Tabellenstruktur anlegt bzw. ändert, vor dem Customizing-Auftrag mit den Tabelleneinträgen (E071K).',
  },
  TR_OBJECT_COLLISION: {
    title: 'Objekt in mehreren parallelen Transporten gesperrt',
    remediation:
      'Führen Sie die Änderungen des Objekts in einem Transport zusammen (oder nutzen Sie ChaRM / systemübergreifende Objektsperre, CSOL); andernfalls überschreibt der spätere Import die frühere Version stillschweigend.',
  },
  TR_OVERTAKER_DOWNGRADE_RISK: {
    title: 'Ältere Objektversion überholt eine neuere',
    remediation:
      'Importieren Sie den älteren Transport nicht nach dem neueren (Überholer); ordnen Sie die Queue neu oder entfernen Sie das Objekt aus dem älteren Auftrag.',
  },
  // ---------------------------------------------------------------- Workflow Deadlock Detective
  WF_BACKGROUND_TASK_FAILED: {
    title: 'Hintergrundschritt mit Fehler beendet',
    remediation:
      'Analysieren Sie die Ausnahme in SWI1 / SWWLOGHIST, korrigieren Sie Daten oder Methode und starten Sie das Workitem über SWPR / SWIA „Nach Fehler neu starten“ erneut.',
  },
  WF_CONTAINER_BINDING_ERROR: {
    title: 'Containerelement leer oder Datenfluss fehlgeschlagen',
    remediation:
      'Korrigieren Sie den Datenfluss im Workflow Builder (SWDD) oder im Aufgabencontainer, berichtigen Sie die Instanzdaten und starten Sie das Workitem erneut.',
  },
  WF_DEADLINE_BREACHED: {
    title: 'Termin / SLA überschritten',
    remediation:
      'Eskalieren Sie gemäß Terminkonfiguration, leiten Sie an eine Vertretung weiter und prüfen Sie den Terminüberwachungsjob (SWWDHEX / SWWDEADL).',
  },
  WF_DEADLOCK_DETECTED: {
    title: 'Zirkuläres Warten zwischen Workitems',
    remediation:
      'Brechen Sie den Wartezyklus auf: Schließen Sie ein Workitem ab oder löschen Sie es logisch (SWIA) und gestalten Sie Bedingungen / Verzweigung so um, dass die Schritte nicht aufeinander warten.',
  },
  WF_EVENT_LINKAGE_DEACTIVATED: {
    title: 'Ereignistyp-Kopplung deaktiviert',
    remediation:
      'Aktivieren Sie die Kopplung in SWE2 wieder (und prüfen Sie, warum sie deaktiviert wurde – Fehlerreaktion „Kopplung deaktivieren“).',
  },
  WF_STUCK_NO_AGENT: {
    title: 'Workitem im Status READY ohne möglichen Bearbeiter',
    remediation:
      'Leiten Sie das Workitem in SWIA weiter; korrigieren Sie anschließend die Bearbeiterregel (PFAC / Zuständigkeitsregeln in „Workflows verwalten“) und die Organisationszuordnung (PPOME), sodass sie mindestens einen aktiven Benutzer ergibt.',
  },
};
