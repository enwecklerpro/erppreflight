/**
 * Initial public knowledge base content (Part 02 §2.8/§2.13).
 *
 * These articles are general, factual explanations of SAP topics that the
 * preflight engines analyse. Wording rules:
 *  - no invented SAP note numbers, no statistics, no customer claims;
 *  - every article names the engines it relates to and links its solution page;
 *  - sources point to official SAP documentation portals only.
 *
 * Seeding is idempotent: rows are inserted with ON CONFLICT (slug, locale) DO NOTHING,
 * so edits made by a SUPER_ADMIN (or archived articles) are never overwritten.
 */

export type KnowledgeLocale = 'en' | 'de';

export interface KnowledgeSource {
  title: string;
  url: string;
}

export interface KnowledgeSeedTranslation {
  title: string;
  summary: string;
  body: string;
}

export interface KnowledgeSeedArticle {
  slug: string;
  relatedEngineTypes: string[];
  targetReleases: string[];
  sources: KnowledgeSource[];
  /** Date the content was last technically reviewed (ISO date, deterministic). */
  reviewedAt: string;
  translations: Record<KnowledgeLocale, KnowledgeSeedTranslation>;
}

const SAP_HELP: KnowledgeSource = {
  title: 'SAP Help Portal — official SAP product documentation',
  url: 'https://help.sap.com/',
};
const SAP_API_HUB: KnowledgeSource = {
  title: 'SAP Business Accelerator Hub — released APIs and their lifecycle status',
  url: 'https://api.sap.com/',
};

const REVIEWED = '2026-09-26';

export const KNOWLEDGE_SEED: KnowledgeSeedArticle[] = [
  {
    slug: 'brfplus-output-determination',
    relatedEngineTypes: ['OPD_GUARD', 'FORM_DOCTOR'],
    targetReleases: ['SAP S/4HANA', 'SAP S/4HANA Cloud'],
    sources: [SAP_HELP],
    reviewedAt: REVIEWED,
    translations: {
      en: {
        title: 'How output parameter determination with BRFplus works in SAP S/4HANA',
        summary:
          'Why a purchase order or billing document produces no output, and how the BRFplus decision tables of S/4HANA output management decide output type, recipient, channel and form.',
        body: `## What output parameter determination does

In SAP S/4HANA output management, the output of a business document (for example a purchase order or a billing document) is controlled by **output parameter determination**. Instead of the condition technique used by classic NAST-based output control, the parameters are determined by **BRFplus** decision tables that are maintained per application object type.

The determination is organised in steps. Typical steps are:

- **Output type** — which outputs are required for the document at all;
- **Receiver** — who receives the output;
- **Channel** — for example email, print or XML;
- **Printer settings** and **email settings**;
- **Form and output relevance** — which form template is used and whether an output is relevant at a given point in time.

## Why no output is created

When a document is saved without the expected output, the cause is usually one of these:

1. The decision table of a step has **no matching row** for the document's attributes (for example a new sales organisation or document type).
2. A step is **missing or inactive**, so the determination stops before a channel or receiver is found.
3. The **form template** referenced in the table does not exist in the target system or is not assigned to the output type.
4. The table content exists in the development system but was **not transported** consistently to test or production.

## How to analyse it

- Compare the attributes of the affected document with the conditions of every determination step, in order.
- Check that the rows are active and that a fallback row exists where one is intended.
- Verify that referenced form templates, email templates and output types exist in the target system.
- Treat decision table content as transportable configuration: review which transport carries which change.

ERP Preflight's OPD Guard parses exported BRFplus/decision table content and reports missing steps, unmatched combinations and dangling references with the exact artifact location as evidence. See [Output & Extensibility](/en/solutions/output-extensibility) for the related engines.`,
      },
      de: {
        title: 'So funktioniert die Ausgabeparameterfindung mit BRFplus in SAP S/4HANA',
        summary:
          'Warum eine Bestellung oder Faktura keine Ausgabe erzeugt und wie die BRFplus-Entscheidungstabellen des S/4HANA Output Managements Ausgabeart, Empfänger, Kanal und Formular bestimmen.',
        body: `## Was die Ausgabeparameterfindung leistet

Im Output Management von SAP S/4HANA wird die Ausgabe eines Geschäftsbelegs (zum Beispiel einer Bestellung oder einer Faktura) über die **Ausgabeparameterfindung** gesteuert. Anstelle der Konditionstechnik der klassischen NAST-basierten Nachrichtenfindung werden die Parameter über **BRFplus**-Entscheidungstabellen je Anwendungsobjekttyp ermittelt.

Die Findung ist in Schritte gegliedert. Typische Schritte sind:

- **Ausgabeart** — welche Ausgaben für den Beleg überhaupt benötigt werden;
- **Empfänger** — wer die Ausgabe erhält;
- **Kanal** — zum Beispiel E-Mail, Druck oder XML;
- **Druckereinstellungen** und **E-Mail-Einstellungen**;
- **Formular und Ausgaberelevanz** — welche Formularvorlage verwendet wird und ob eine Ausgabe zu einem Zeitpunkt relevant ist.

## Warum keine Ausgabe entsteht

Wird ein Beleg ohne die erwartete Ausgabe gesichert, liegt die Ursache meist in einem dieser Punkte:

1. Die Entscheidungstabelle eines Schritts enthält **keine passende Zeile** für die Merkmale des Belegs (etwa eine neue Verkaufsorganisation oder Belegart).
2. Ein Schritt **fehlt oder ist inaktiv**, sodass die Findung endet, bevor Kanal oder Empfänger bestimmt sind.
3. Die in der Tabelle referenzierte **Formularvorlage** existiert im Zielsystem nicht oder ist der Ausgabeart nicht zugeordnet.
4. Der Tabelleninhalt existiert im Entwicklungssystem, wurde aber **nicht konsistent transportiert**.

## Vorgehen bei der Analyse

- Vergleichen Sie die Merkmale des betroffenen Belegs der Reihe nach mit den Bedingungen jedes Findungsschritts.
- Prüfen Sie, ob die Zeilen aktiv sind und ob dort, wo gewünscht, eine Rückfallzeile existiert.
- Stellen Sie sicher, dass referenzierte Formularvorlagen, E-Mail-Vorlagen und Ausgabearten im Zielsystem vorhanden sind.
- Behandeln Sie Inhalte von Entscheidungstabellen als transportierbare Konfiguration und prüfen Sie, welcher Transport welche Änderung enthält.

Der OPD Guard von ERP Preflight liest exportierte BRFplus-/Entscheidungstabelleninhalte und meldet fehlende Schritte, nicht abgedeckte Kombinationen und ins Leere laufende Referenzen mit der genauen Fundstelle im Artefakt als Nachweis. Die zugehörigen Engines finden Sie unter [Output & Erweiterbarkeit](/de/solutions/output-extensibility).`,
      },
    },
  },
  {
    slug: 'clean-core-extensibility-tiers',
    relatedEngineTypes: ['CLEAN_CORE_OBJECT_GUARD', 'EXTENSION_IMPACT_GUARD', 'ECC2CLOUD_NAVIGATOR'],
    targetReleases: ['SAP S/4HANA', 'SAP S/4HANA Cloud Private Edition', 'SAP S/4HANA Cloud Public Edition'],
    sources: [SAP_HELP, SAP_API_HUB],
    reviewedAt: REVIEWED,
    translations: {
      en: {
        title: 'Clean core extensibility explained: tiers, released APIs and classic modifications',
        summary:
          'A practical overview of how SAP classifies extensions by their upgrade stability, from ABAP Cloud on released APIs to classic modifications, and how to assess existing custom code.',
        body: `## The idea behind clean core

A **clean core** means that the SAP standard is not modified and that extensions only use stable, documented interfaces. The benefit is predictable upgrades: when an extension depends only on **released** objects, a new release is far less likely to break it.

## The tier model

SAP has described extensions in a tiered model:

- **Tier 1 — cloud-ready extensions.** Developed with ABAP Cloud (restricted language version) or side-by-side, using only released APIs and extension points.
- **Tier 2 — cloud API enablement.** Wrappers around classic, not-yet-released functionality that expose it to tier 1 code in a controlled way.
- **Tier 3 — classic ABAP extensions.** Classic development that may access unreleased objects or modify standard code. This is where upgrade risk concentrates.

SAP has since refined this guidance into more granular clean core levels. Always check the current SAP documentation for the classification that applies to your release.

## Typical findings in existing code

- Direct database writes to SAP standard tables instead of using released APIs.
- Use of objects without a release contract, which can change without notice.
- Modifications and implicit enhancements in standard code.
- Dependencies on objects that are deprecated in the target release.

## How to assess your landscape

1. Build an inventory of custom objects and their dependencies on SAP objects.
2. Classify each dependency by release status (released, deprecated, not released).
3. Prioritise objects with direct table mutations and modifications.
4. Plan successors: released CDS views, released APIs or extension points.

ERP Preflight's Clean Core Object Guard classifies custom code and its dependencies deterministically and records each finding with file, line and hash evidence. See [Migration & Clean Core](/en/solutions/migration-clean-core).`,
      },
      de: {
        title: 'Clean-Core-Erweiterbarkeit erklärt: Stufen, freigegebene APIs und klassische Modifikationen',
        summary:
          'Ein praxisnaher Überblick, wie SAP Erweiterungen nach ihrer Upgrade-Stabilität einordnet — von ABAP Cloud auf freigegebenen APIs bis zu klassischen Modifikationen — und wie Sie bestehenden Eigenentwicklungscode bewerten.',
        body: `## Die Idee hinter Clean Core

**Clean Core** bedeutet, dass der SAP-Standard nicht modifiziert wird und Erweiterungen nur stabile, dokumentierte Schnittstellen nutzen. Der Vorteil sind planbare Upgrades: Hängt eine Erweiterung nur von **freigegebenen** Objekten ab, ist die Wahrscheinlichkeit deutlich geringer, dass ein neues Release sie bricht.

## Das Stufenmodell

SAP hat Erweiterungen in einem Stufenmodell beschrieben:

- **Stufe 1 — cloudfähige Erweiterungen.** Entwickelt mit ABAP Cloud (eingeschränkte Sprachversion) oder Side-by-Side, ausschließlich auf freigegebenen APIs und Erweiterungspunkten.
- **Stufe 2 — Cloud-API-Enablement.** Wrapper um klassische, noch nicht freigegebene Funktionalität, die diese kontrolliert für Code der Stufe 1 verfügbar machen.
- **Stufe 3 — klassische ABAP-Erweiterungen.** Klassische Entwicklung, die auf nicht freigegebene Objekte zugreifen oder Standardcode modifizieren kann. Hier konzentriert sich das Upgrade-Risiko.

SAP hat diese Leitlinien inzwischen zu feiner abgestuften Clean-Core-Levels weiterentwickelt. Prüfen Sie stets die aktuelle SAP-Dokumentation für die Einordnung, die für Ihr Release gilt.

## Typische Befunde in bestehendem Code

- Direkte Datenbankschreibzugriffe auf SAP-Standardtabellen statt freigegebener APIs.
- Verwendung von Objekten ohne Freigabevertrag, die sich ohne Ankündigung ändern können.
- Modifikationen und implizite Erweiterungen im Standardcode.
- Abhängigkeiten von Objekten, die im Zielrelease veraltet sind.

## So bewerten Sie Ihre Landschaft

1. Erstellen Sie ein Inventar der Eigenentwicklungen und ihrer Abhängigkeiten zu SAP-Objekten.
2. Ordnen Sie jede Abhängigkeit nach Freigabestatus ein (freigegeben, veraltet, nicht freigegeben).
3. Priorisieren Sie Objekte mit direkten Tabellenänderungen und Modifikationen.
4. Planen Sie Nachfolger: freigegebene CDS-Views, freigegebene APIs oder Erweiterungspunkte.

Der Clean Core Object Guard von ERP Preflight klassifiziert Eigenentwicklungen und ihre Abhängigkeiten deterministisch und belegt jeden Befund mit Datei, Zeile und Hash. Siehe [Migration & Clean Core](/de/solutions/migration-clean-core).`,
      },
    },
  },
  {
    slug: 'change-pointers-bd52',
    relatedEngineTypes: ['CHANGE_POINTER_COVERAGE_AUDITOR', 'API_CHANGE_GUARD'],
    targetReleases: ['SAP ECC 6.0', 'SAP S/4HANA'],
    sources: [SAP_HELP],
    reviewedAt: REVIEWED,
    translations: {
      en: {
        title: 'Change pointers and BD52: why master data changes are not distributed',
        summary:
          'How ALE change pointers work end to end — global activation, message type activation, BD52 field assignment and BD21 processing — and the configuration gaps that silently stop IDoc distribution.',
        body: `## How change pointers work

Change pointers are the mechanism with which ALE distributes **changes** to master data (for example material, customer or vendor data) as IDocs. When a relevant field changes, the system writes a change pointer. A report later reads the open pointers and creates IDocs for the configured message type.

For this chain to work, several settings must fit together:

- **BD61** — change pointers are activated globally;
- **BD50** — change pointers are activated for the message type (for example MATMAS);
- **BD52** — the fields whose changes should create change pointers are assigned to the message type;
- **BD64** — the distribution model contains the message type for the sender and receiver;
- **BD21** (report RBDMIDOC) — processes the open change pointers, usually as a scheduled job.

## Why changes are not distributed

- A field was added to the interface but **not assigned in BD52**, so its changes never create a pointer.
- The message type is **not activated in BD50**, or change pointers are globally inactive.
- The **BD21 job** is not scheduled, fails, or runs for a different message type.
- The distribution model has no **filter or receiver** for the changed object.
- Configuration differs between systems because a transport is missing.

## How to analyse it

1. Start from the business requirement: which fields must reach which receiver?
2. Compare that list with the BD52 field assignment for the message type.
3. Check activation (BD61, BD50) and the distribution model in the same system.
4. Verify that pointers are processed: job scheduling and processing status.

ERP Preflight's Change Pointer Coverage Auditor compares required fields with exported change pointer configuration and reports uncovered fields with evidence. See [Integration](/en/solutions/integration).`,
      },
      de: {
        title: 'Änderungszeiger und BD52: warum Stammdatenänderungen nicht verteilt werden',
        summary:
          'Wie ALE-Änderungszeiger durchgängig funktionieren — globale Aktivierung, Aktivierung je Nachrichtentyp, Feldzuordnung in BD52 und Verarbeitung mit BD21 — und welche Konfigurationslücken die IDoc-Verteilung unbemerkt stoppen.',
        body: `## So funktionieren Änderungszeiger

Änderungszeiger sind der Mechanismus, mit dem ALE **Änderungen** an Stammdaten (zum Beispiel Material-, Kunden- oder Lieferantendaten) als IDocs verteilt. Ändert sich ein relevantes Feld, schreibt das System einen Änderungszeiger. Ein Report liest später die offenen Zeiger und erzeugt IDocs für den konfigurierten Nachrichtentyp.

Damit diese Kette funktioniert, müssen mehrere Einstellungen zusammenpassen:

- **BD61** — Änderungszeiger sind global aktiviert;
- **BD50** — Änderungszeiger sind für den Nachrichtentyp aktiviert (zum Beispiel MATMAS);
- **BD52** — die Felder, deren Änderung einen Zeiger erzeugen soll, sind dem Nachrichtentyp zugeordnet;
- **BD64** — das Verteilungsmodell enthält den Nachrichtentyp für Sender und Empfänger;
- **BD21** (Report RBDMIDOC) — verarbeitet die offenen Änderungszeiger, meist als eingeplanter Job.

## Warum Änderungen nicht verteilt werden

- Ein Feld wurde in die Schnittstelle aufgenommen, aber **nicht in BD52 zugeordnet** — seine Änderungen erzeugen nie einen Zeiger.
- Der Nachrichtentyp ist **in BD50 nicht aktiviert**, oder Änderungszeiger sind global inaktiv.
- Der **BD21-Job** ist nicht eingeplant, bricht ab oder läuft für einen anderen Nachrichtentyp.
- Das Verteilungsmodell enthält für das geänderte Objekt **keinen Filter oder Empfänger**.
- Die Konfiguration unterscheidet sich zwischen den Systemen, weil ein Transport fehlt.

## Vorgehen bei der Analyse

1. Beginnen Sie mit der fachlichen Anforderung: Welche Felder müssen welchen Empfänger erreichen?
2. Vergleichen Sie diese Liste mit der BD52-Feldzuordnung des Nachrichtentyps.
3. Prüfen Sie Aktivierung (BD61, BD50) und Verteilungsmodell im selben System.
4. Stellen Sie sicher, dass Zeiger verarbeitet werden: Jobeinplanung und Verarbeitungsstatus.

Der Change Pointer Coverage Auditor von ERP Preflight vergleicht benötigte Felder mit der exportierten Änderungszeiger-Konfiguration und meldet nicht abgedeckte Felder mit Nachweis. Siehe [Integration](/de/solutions/integration).`,
      },
    },
  },
  {
    slug: 'transport-dependencies',
    relatedEngineTypes: ['TRANSPORT_DEPENDENCY_ANALYZER', 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD'],
    targetReleases: ['SAP ECC 6.0', 'SAP S/4HANA', 'SAP S/4HANA Cloud Public Edition'],
    sources: [SAP_HELP],
    reviewedAt: REVIEWED,
    translations: {
      en: {
        title: 'Transport dependencies: why imports fail or break production in the wrong order',
        summary:
          'How dependencies between transport requests arise, what happens when a transport is imported without its predecessors, and how to check sequencing before an import.',
        body: `## Where transport dependencies come from

In the Change and Transport System (CTS), a change is moved between systems as a **transport request**. Real changes rarely fit into a single request: a program change can depend on a new data element, a table field, a class or customizing that was released in a **different** request.

Dependencies typically arise when:

- dictionary objects (domains, data elements, tables, structures) are changed in one request and used in another;
- a development is split across several developers and requests;
- a correction is released before the change it corrects;
- customizing and workbench changes of the same feature are transported separately.

## What goes wrong

- A request is imported **before its predecessor**: activation or generation errors (return code 8) occur in the target system.
- Only **part of a feature** is imported: the import succeeds technically, but the program fails at runtime because an object is missing or outdated.
- An **older version** of an object overwrites a newer one because requests are imported out of sequence.

## How to check before importing

1. List the objects of each request and the objects they reference.
2. Determine which other open requests contain those referenced objects.
3. Check the import queue order against these dependencies.
4. Check whether the same object appears in several requests and which version is expected to win.

Software collections in cloud landscapes have the same problem at another level: an exported collection must contain everything its items depend on.

ERP Preflight's Transport Dependency Analyzer builds this dependency graph from exported transport data and reports missing predecessors and order conflicts with evidence. See [Release & Transport](/en/solutions/release-transport).`,
      },
      de: {
        title: 'Transportabhängigkeiten: warum Importe fehlschlagen oder in falscher Reihenfolge die Produktion stören',
        summary:
          'Wie Abhängigkeiten zwischen Transportaufträgen entstehen, was passiert, wenn ein Transport ohne seine Vorgänger importiert wird, und wie Sie die Reihenfolge vor dem Import prüfen.',
        body: `## Woher Transportabhängigkeiten kommen

Im Change and Transport System (CTS) wird eine Änderung als **Transportauftrag** zwischen Systemen bewegt. Reale Änderungen passen selten in einen einzigen Auftrag: Eine Programmänderung kann von einem neuen Datenelement, einem Tabellenfeld, einer Klasse oder von Customizing abhängen, das in einem **anderen** Auftrag freigegeben wurde.

Abhängigkeiten entstehen typischerweise, wenn:

- Dictionary-Objekte (Domänen, Datenelemente, Tabellen, Strukturen) in einem Auftrag geändert und in einem anderen verwendet werden;
- eine Entwicklung auf mehrere Entwickler und Aufträge verteilt ist;
- eine Korrektur vor der Änderung freigegeben wird, die sie korrigiert;
- Customizing- und Workbench-Änderungen desselben Features getrennt transportiert werden.

## Was schiefgeht

- Ein Auftrag wird **vor seinem Vorgänger** importiert: Im Zielsystem treten Aktivierungs- oder Generierungsfehler (Returncode 8) auf.
- Nur ein **Teil eines Features** wird importiert: Der Import ist technisch erfolgreich, aber das Programm scheitert zur Laufzeit, weil ein Objekt fehlt oder veraltet ist.
- Eine **ältere Version** eines Objekts überschreibt eine neuere, weil Aufträge außerhalb der Reihenfolge importiert werden.

## Prüfung vor dem Import

1. Listen Sie die Objekte jedes Auftrags und die von ihnen referenzierten Objekte auf.
2. Ermitteln Sie, welche anderen offenen Aufträge diese referenzierten Objekte enthalten.
3. Gleichen Sie die Reihenfolge der Importqueue mit diesen Abhängigkeiten ab.
4. Prüfen Sie, ob dasselbe Objekt in mehreren Aufträgen vorkommt und welche Version gelten soll.

Softwaresammlungen in Cloud-Landschaften haben dasselbe Problem auf anderer Ebene: Eine exportierte Sammlung muss alles enthalten, wovon ihre Elemente abhängen.

Der Transport Dependency Analyzer von ERP Preflight baut diesen Abhängigkeitsgraphen aus exportierten Transportdaten auf und meldet fehlende Vorgänger und Reihenfolgekonflikte mit Nachweis. Siehe [Release & Transport](/de/solutions/release-transport).`,
      },
    },
  },
  {
    slug: 'fiori-403-authorization-troubleshooting',
    relatedEngineTypes: ['FIORI_403_ROOT_CAUSE_DOCTOR', 'IAM_COST_OPTIMIZER'],
    targetReleases: ['SAP S/4HANA', 'SAP Fiori front-end server'],
    sources: [SAP_HELP],
    reviewedAt: REVIEWED,
    translations: {
      en: {
        title: 'Troubleshooting HTTP 403 Forbidden in SAP Fiori apps',
        summary:
          'The usual causes of a 403 error when a Fiori app loads or calls its OData service — missing service authorizations, incomplete roles, inactive ICF services — and a systematic way to find the one that applies.',
        body: `## What a 403 means in Fiori

HTTP **403 Forbidden** means the request reached the server and the user was authenticated, but access was refused. In Fiori scenarios the refusal can come from several layers, so the same error message has different root causes.

## Common causes

- **Missing authorization for the OData service.** Access to a service is checked with authorization object **S_SERVICE**; the service must be included in a role assigned to the user.
- **Incomplete role content.** The business catalog or app is assigned, but the back-end role with the underlying authorizations is missing, or the other way round.
- **Missing start authorization.** Some apps and services additionally check start authorizations such as **S_START**.
- **Inactive ICF service.** An inactive node in the Internet Communication Framework (transaction SICF) can also result in a 403 response.
- **Business authorizations.** The service call succeeds, but a business check (for example company code or sales organisation) rejects the specific data request.

## A systematic approach

1. Reproduce the error and note the exact service and entity set from the browser network trace.
2. Check the gateway error log and the authorization trace for the user at that time.
3. Compare the user's roles with the catalog, the OData service and the back-end authorizations the app needs.
4. Verify that the ICF service is active in every system of the landscape.
5. Fix the role design, not the individual user, so the fix is transportable.

ERP Preflight's Fiori 403 Root-Cause Doctor correlates role exports, service definitions and trace data to name the missing link with evidence. See [Operations](/en/solutions/operations).`,
      },
      de: {
        title: 'Fehlersuche bei HTTP 403 Forbidden in SAP-Fiori-Apps',
        summary:
          'Die üblichen Ursachen eines 403-Fehlers beim Laden einer Fiori-App oder beim Aufruf ihres OData-Service — fehlende Service-Berechtigungen, unvollständige Rollen, inaktive ICF-Services — und ein systematischer Weg zur tatsächlichen Ursache.',
        body: `## Was ein 403 in Fiori bedeutet

HTTP **403 Forbidden** bedeutet, dass die Anfrage den Server erreicht hat und der Benutzer authentifiziert ist, der Zugriff aber verweigert wurde. In Fiori-Szenarien kann die Ablehnung aus mehreren Schichten stammen — dieselbe Fehlermeldung hat daher unterschiedliche Ursachen.

## Häufige Ursachen

- **Fehlende Berechtigung für den OData-Service.** Der Zugriff auf einen Service wird über das Berechtigungsobjekt **S_SERVICE** geprüft; der Service muss in einer dem Benutzer zugeordneten Rolle enthalten sein.
- **Unvollständiger Rolleninhalt.** Der Business-Katalog oder die App ist zugeordnet, aber die Backend-Rolle mit den zugrunde liegenden Berechtigungen fehlt — oder umgekehrt.
- **Fehlende Startberechtigung.** Manche Apps und Services prüfen zusätzlich Startberechtigungen wie **S_START**.
- **Inaktiver ICF-Service.** Ein inaktiver Knoten im Internet Communication Framework (Transaktion SICF) kann ebenfalls zu einer 403-Antwort führen.
- **Fachliche Berechtigungen.** Der Serviceaufruf gelingt, aber eine fachliche Prüfung (zum Beispiel Buchungskreis oder Verkaufsorganisation) lehnt die konkrete Datenanfrage ab.

## Systematisches Vorgehen

1. Reproduzieren Sie den Fehler und notieren Sie Service und Entity Set aus dem Netzwerk-Trace des Browsers.
2. Prüfen Sie das Gateway-Fehlerprotokoll und den Berechtigungstrace des Benutzers zu diesem Zeitpunkt.
3. Vergleichen Sie die Rollen des Benutzers mit Katalog, OData-Service und den Backend-Berechtigungen, die die App benötigt.
4. Stellen Sie sicher, dass der ICF-Service in jedem System der Landschaft aktiv ist.
5. Korrigieren Sie das Rollendesign statt des einzelnen Benutzers, damit die Korrektur transportierbar ist.

Der Fiori 403 Root-Cause Doctor von ERP Preflight verknüpft Rollenexporte, Service-Definitionen und Tracedaten und benennt das fehlende Glied mit Nachweis. Siehe [Betrieb](/de/solutions/operations).`,
      },
    },
  },
  {
    slug: 'custom-field-flow-key-user-extensibility',
    relatedEngineTypes: ['CUSTOM_FIELD_FLOW_DOCTOR', 'EXTENSION_IMPACT_GUARD', 'FORM_DOCTOR'],
    targetReleases: ['SAP S/4HANA', 'SAP S/4HANA Cloud Public Edition'],
    sources: [SAP_HELP],
    reviewedAt: REVIEWED,
    translations: {
      en: {
        title: 'Custom fields with key user extensibility: why a field does not appear in the app, form or API',
        summary:
          'How custom fields created with key user extensibility reach UIs, reports, forms and APIs, and why a field that exists on one document is missing on the follow-on document.',
        body: `## How key user custom fields work

With key user extensibility, custom fields are created in the **Custom Fields** app. Each field belongs to a **business context** (for example a sales document header or item). Creating the field is only the first step: the field is available where its **usages** are enabled.

Typical usages are:

- **User interfaces** — the field can be added to a Fiori app through adaptation;
- **Reports and CDS views** — the field is exposed to analytical and data sources;
- **Form templates and email templates** — the field is available in output;
- **APIs / OData services** — the field is included in the relevant service.

## Why a field is missing

- The usage for the target (UI, form, API) was **not enabled** for the field.
- The field exists on the source document but **no business scenario** transfers it to the follow-on document (for example from a sales order to the billing document).
- The **form template** was not updated to print the field, or an outdated template is assigned.
- The field was created and published in one system but the extension was **not transported** to the next one.

## How to analyse it

1. Trace the path the value must travel: source document → follow-on documents → output or interface.
2. For each step, check that the field exists in the business context and that the required usage is enabled.
3. Check the business scenarios that copy the field between contexts.
4. Confirm that form templates and APIs actually reference the field.

ERP Preflight's Custom Field Flow Doctor reconstructs this lineage from exported extension metadata and reports the exact step where the field is lost. See [Output & Extensibility](/en/solutions/output-extensibility).`,
      },
      de: {
        title: 'Zusatzfelder mit Key-User-Erweiterbarkeit: warum ein Feld nicht in App, Formular oder API erscheint',
        summary:
          'Wie Zusatzfelder aus der Key-User-Erweiterbarkeit in Oberflächen, Berichte, Formulare und APIs gelangen und warum ein Feld, das auf einem Beleg existiert, im Folgebeleg fehlt.',
        body: `## So funktionieren Key-User-Zusatzfelder

Mit der Key-User-Erweiterbarkeit werden Zusatzfelder in der App **Benutzerdefinierte Felder** angelegt. Jedes Feld gehört zu einem **Geschäftskontext** (zum Beispiel Kopf oder Position eines Verkaufsbelegs). Das Anlegen ist nur der erste Schritt: Verfügbar ist das Feld dort, wo seine **Verwendungen** aktiviert sind.

Typische Verwendungen sind:

- **Benutzeroberflächen** — das Feld kann per Anpassung in eine Fiori-App aufgenommen werden;
- **Berichte und CDS-Views** — das Feld wird analytischen Datenquellen bereitgestellt;
- **Formular- und E-Mail-Vorlagen** — das Feld steht in der Ausgabe zur Verfügung;
- **APIs / OData-Services** — das Feld ist im jeweiligen Service enthalten.

## Warum ein Feld fehlt

- Die Verwendung für das Ziel (UI, Formular, API) wurde für das Feld **nicht aktiviert**.
- Das Feld existiert im Quellbeleg, aber **kein Business-Szenario** überträgt es in den Folgebeleg (zum Beispiel vom Kundenauftrag in die Faktura).
- Die **Formularvorlage** wurde nicht angepasst, um das Feld auszugeben, oder eine veraltete Vorlage ist zugeordnet.
- Das Feld wurde in einem System angelegt und veröffentlicht, die Erweiterung aber **nicht ins nächste System transportiert**.

## Vorgehen bei der Analyse

1. Verfolgen Sie den Weg des Wertes: Quellbeleg → Folgebelege → Ausgabe oder Schnittstelle.
2. Prüfen Sie für jeden Schritt, ob das Feld im Geschäftskontext existiert und die benötigte Verwendung aktiviert ist.
3. Prüfen Sie die Business-Szenarien, die das Feld zwischen Kontexten kopieren.
4. Stellen Sie sicher, dass Formularvorlagen und APIs das Feld tatsächlich referenzieren.

Der Custom Field Flow Doctor von ERP Preflight rekonstruiert diese Herkunftskette aus exportierten Erweiterungsmetadaten und meldet den genauen Schritt, an dem das Feld verloren geht. Siehe [Output & Erweiterbarkeit](/de/solutions/output-extensibility).`,
      },
    },
  },
  {
    slug: 'workflow-work-item-stuck',
    relatedEngineTypes: ['WORKFLOW_STUCK_EXPLAINER'],
    targetReleases: ['SAP ECC 6.0', 'SAP S/4HANA'],
    sources: [SAP_HELP],
    reviewedAt: REVIEWED,
    translations: {
      en: {
        title: 'Why SAP Business Workflow items get stuck and how to find the cause',
        summary:
          'The typical reasons a workflow does not continue — no agent found, failed background steps, missing events, configuration gaps — and the standard tools to diagnose them.',
        body: `## How a workflow moves forward

An SAP Business Workflow instance consists of steps. Each step creates a **work item**. Dialog work items wait for an agent to execute them; background work items are executed by the system; wait steps wait for an **event**. A workflow is "stuck" when one of these items can no longer progress.

## Typical causes

- **No agent determined.** The agent rule returns nobody, or the possible agents of the task do not include the determined users. The work item is then in nobody's inbox.
- **Error in a background step.** A method raised an exception; the work item is in status *Error* and needs a restart after the cause is fixed.
- **Missing event.** A wait step expects an event that is never raised, for example because event linkage is inactive or the triggering application does not raise it.
- **Incomplete runtime configuration.** Basic workflow customizing, the background user or the event queue is not set up consistently in the system.

## Standard diagnostics

- Workflow log of the instance: which step is active and in which status.
- Administration reports for work items with errors and for work items without agents.
- Diagnosis of the workflow runtime configuration and the event trace for missing events.
- Agent assignment of the task compared with the result of the agent rule.

## Prevention

Test agent rules with realistic organisational data, monitor work items in error status, and keep event linkages and workflow customizing aligned across the landscape.

ERP Preflight's Workflow Stuck Explainer analyses exported work item and configuration data and explains the blocking cause with evidence. See [Operations](/en/solutions/operations).`,
      },
      de: {
        title: 'Warum Workitems im SAP Business Workflow hängen bleiben und wie Sie die Ursache finden',
        summary:
          'Die typischen Gründe, warum ein Workflow nicht weiterläuft — kein Bearbeiter gefunden, fehlerhafte Hintergrundschritte, fehlende Ereignisse, Konfigurationslücken — und die Standardwerkzeuge zur Diagnose.',
        body: `## Wie ein Workflow fortschreitet

Eine Instanz des SAP Business Workflow besteht aus Schritten. Jeder Schritt erzeugt ein **Workitem**. Dialog-Workitems warten auf die Ausführung durch einen Bearbeiter; Hintergrund-Workitems führt das System aus; Warteschritte warten auf ein **Ereignis**. Ein Workflow „hängt“, wenn eines dieser Elemente nicht mehr weiterkommt.

## Typische Ursachen

- **Kein Bearbeiter ermittelt.** Die Bearbeiterregel liefert niemanden, oder die möglichen Bearbeiter der Aufgabe umfassen die ermittelten Benutzer nicht. Das Workitem liegt dann in keinem Eingang.
- **Fehler in einem Hintergrundschritt.** Eine Methode hat eine Ausnahme ausgelöst; das Workitem steht im Status *Fehler* und muss nach Behebung der Ursache neu gestartet werden.
- **Fehlendes Ereignis.** Ein Warteschritt erwartet ein Ereignis, das nie ausgelöst wird — etwa weil die Ereignisverknüpfung inaktiv ist oder die auslösende Anwendung es nicht erzeugt.
- **Unvollständige Laufzeitkonfiguration.** Das Workflow-Basis-Customizing, der Hintergrundbenutzer oder die Ereignis-Queue sind im System nicht konsistent eingerichtet.

## Standarddiagnose

- Workflow-Protokoll der Instanz: welcher Schritt aktiv ist und in welchem Status.
- Administrationsberichte für fehlerhafte Workitems und Workitems ohne Bearbeiter.
- Diagnose der Workflow-Laufzeitkonfiguration und Ereignistrace für fehlende Ereignisse.
- Bearbeiterzuordnung der Aufgabe im Vergleich zum Ergebnis der Bearbeiterregel.

## Vorbeugung

Testen Sie Bearbeiterregeln mit realistischen Organisationsdaten, überwachen Sie Workitems im Fehlerstatus und halten Sie Ereignisverknüpfungen und Workflow-Customizing landschaftsweit konsistent.

Der Workflow Stuck Explainer von ERP Preflight analysiert exportierte Workitem- und Konfigurationsdaten und erklärt die blockierende Ursache mit Nachweis. Siehe [Betrieb](/de/solutions/operations).`,
      },
    },
  },
];
