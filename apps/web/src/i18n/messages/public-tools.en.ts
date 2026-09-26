/**
 * English strings of the free tools (/tools), the programmatic SEO pages (/sap)
 * and the documentation chrome (/docs). Merged into `en.publicTools`; the German
 * file is typed against this one (key parity is also checked by i18n.test.ts).
 */
export const publicToolsEn = {
  nav: {
    tools: 'Free tools',
    docs: 'Docs',
  },
  common: {
    dataSource: 'Data source',
    snapshot: 'Knowledge snapshot #{seq}',
    snapshotPublished: 'published {date}',
    lastRetrieved: 'Last retrieved from the source',
    lastVerified: 'Last verified',
    trustLevel: 'Trust level',
    noSnapshot: 'No knowledge snapshot has been published yet.',
    sourcesTitle: 'Sources behind this tool',
    independence:
      'ERP Preflight is independent and not affiliated with SAP SE. SAP, ABAP, Fiori and S/4HANA are trademarks of SAP SE.',
    publicOnly: 'Only global, reviewed knowledge is shown. Customer data from workspaces is never used by the free tools.',
    ctaTitle: 'Create workspace → run full project analysis',
    ctaBody:
      'The free tools answer one question at a time. A workspace analyses your whole export or code base with the same knowledge and reports every finding with line-level evidence, confidence and remediation.',
    ctaButton: 'Create a free workspace',
    ctaDocs: 'How a project analysis works',
    retry: 'Try again',
    rateLimited: 'Too many requests from your network. Please wait a minute and try again.',
    unavailable: 'The tool is temporarily unavailable. Please try again in a moment.',
    loading: 'Loading…',
    results: '{count} results',
    showMore: 'Show more',
    previous: 'Previous',
    next: 'Next',
    pageOf: 'Page {page} of {pages}',
    openObjectPage: 'Open object page',
    noSlug: 'No public page for this key format',
    notFoundQuery: 'Nothing in the current snapshot matches “{query}”.',
    release: 'Release',
    edition: 'Edition',
    state: 'State',
    successors: 'Successor',
    none: 'none',
    classicApi: 'Classic API classification',
    level: 'Clean core level {level}',
    evidenceFrom: 'Evidence: {source}',
  },
  provenance: {
    'knowledge-graph': {
      source:
        'SAP Cloudification Repository (official SAP release data), synchronised into immutable ERP Preflight knowledge snapshots.',
      trust: 'Official SAP repository — facts are shown per release exactly as published; no successor is ever inferred.',
    },
    'document': {
      source:
        'The XML document you paste or load. It is parsed in memory by the analysis service and not stored.',
      trust: 'Deterministic parse of your document — the answer is exactly what the document contains.',
    },
    'decision-tree': {
      source:
        'Decision tree curated by ERP Preflight from the rule catalog of the Fiori 403 Root-Cause Doctor engine and SAP’s standard troubleshooting transactions.',
      trust: 'Curated rule — it narrows the cause category; it does not diagnose your system.',
    },
    'search': {
      source:
        'Reviewed ERP Preflight knowledge articles, the global SAP knowledge graph (Cloudification Repository) and the analysis engines’ rule catalog.',
      trust: 'Reviewed content and official SAP repository data; each result shows its own review or retrieval date.',
    },
  },
  trust: {
    OFFICIAL_REPOSITORY: 'Official SAP repository',
    OFFICIAL_DOCUMENTATION: 'Official SAP documentation',
    OFFICIAL_SUPPORT: 'Official SAP support content',
    OFFICIAL_COMMUNITY: 'Official SAP community content',
    CURATED_RULE: 'Curated rule',
    THIRD_PARTY: 'Third-party source',
    CUSTOMER_EVIDENCE: 'Customer evidence',
    INFERRED: 'Inferred',
  },
  states: {
    RELEASED: 'Released',
    DEPRECATED: 'Deprecated',
    NOT_RELEASED: 'Not released',
    NOT_TO_BE_RELEASED_STABLE: 'Not released (kept stable)',
    CLASSIC_API: 'Classic API',
    NO_API: 'No API',
    SUPPORTED: 'Supported',
    BLOCKED: 'Blocked',
    UNKNOWN: 'Unknown',
  },
  verdicts: {
    RELEASED: 'Released — no successor required',
    RELEASED_ELSEWHERE: 'Not released in this release, released in another edition',
    SUCCESSOR_AVAILABLE: 'Not released — use the official successor',
    CONCEPT_AVAILABLE: 'Not released — SAP names a successor concept',
    NOT_RELEASED_NO_SUCCESSOR: 'Not released — SAP names no successor',
    CLASSIC_API_ONLY: 'Only a classic API classification is published',
    NO_OFFICIAL_STATE: 'No official release state in the current snapshot',
  },
  verdictHelp: {
    RELEASED: 'The object is part of the released ABAP Cloud API contract for this release.',
    RELEASED_ELSEWHERE: 'Check the release table: the release state differs between editions.',
    SUCCESSOR_AVAILABLE: 'SAP lists the objects below as the replacement to use instead.',
    CONCEPT_AVAILABLE: 'SAP describes the replacement as a concept rather than a single object.',
    NOT_RELEASED_NO_SUCCESSOR:
      'No successor is published. Wrap the usage in a released API of your own or raise an influence request with SAP.',
    CLASSIC_API_ONLY: 'Classic APIs (clean core level B) remain usable in SAP Cloud ERP Private, but are not released for ABAP Cloud.',
    NO_OFFICIAL_STATE: 'We do not guess: without an official state there is no verdict.',
  },
  editions: {
    CLOUD_PRIVATE: 'SAP Cloud ERP Private',
    CLOUD_PUBLIC: 'SAP Cloud ERP',
    ABAP_ENVIRONMENT: 'SAP BTP ABAP environment',
  },
  relations: {
    SUCCESSOR: 'Successor',
    REPLACES: 'Replaced by this object',
    SHARES_SUCCESSOR: 'Same successor',
    CO_SUCCESSOR: 'Also a successor of the same object',
  },
  changeTypes: {
    ADDED: 'Added',
    REMOVED: 'Removed',
    NEWLY_RELEASED: 'Newly released',
    NEWLY_DEPRECATED: 'Newly deprecated',
    RELEASE_WITHDRAWN: 'Release withdrawn',
    STATE_CHANGED: 'State changed',
    SUCCESSOR_CHANGED: 'Successor changed',
    ATTRIBUTES_CHANGED: 'Attributes changed',
  },
  severity: {
    BLOCKER: 'Blocker',
    CRITICAL: 'Critical',
    MAJOR: 'Major',
    MEDIUM: 'Medium',
    MINOR: 'Minor',
    LOW: 'Low',
    INFO: 'Info',
  },
  hub: {
    metaTitle: 'Free SAP tools: Clean Core lookup, successor finder, API deprecations — ERP Preflight',
    metaDescription:
      'Free SAP tools based on official release data: Clean Core object lookup, legacy object to cloud successor, API deprecation lookup, form XML field checker, Fiori 403 decision tree and knowledge search.',
    title: 'Free SAP preflight tools',
    intro:
      'Answer one question at a time — every result names its data source, the knowledge snapshot and the trust level of the evidence. For a whole system, run a project analysis.',
    breadcrumb: 'Free tools',
    open: 'Open tool',
  },
  tools: {
    'clean-core-lookup': {
      name: 'Clean Core Object Lookup',
      short: 'Is a table, CDS view, class or function module released for ABAP Cloud?',
    },
    'cloud-successor': {
      name: 'Legacy object → cloud successor',
      short: 'Which released object replaces a classic table, BAPI or function module, per release?',
    },
    'api-deprecations': {
      name: 'API deprecation lookup',
      short: 'Released and deprecated APIs per release, their successors and a diff between two releases.',
    },
    'xml-field-checker': {
      name: 'Form XML field checker',
      short: 'Does a field path exist in your form data XML, what is its value, are namespaces the problem?',
    },
    'fiori-403': {
      name: 'Fiori 403 decision tree',
      short: 'Guided questions to the likely cause category of a Fiori “not authorized” error — and what evidence to collect.',
    },
    search: {
      name: 'Knowledge & error search',
      short: 'Search the reviewed knowledge base, SAP objects and the finding codes of the analysis engines.',
    },
  },
  cleanCore: {
    metaTitle: 'Clean Core Object Lookup — is this SAP object released for ABAP Cloud? | ERP Preflight',
    metaDescription:
      'Free lookup of SAP tables, CDS views, classes, function modules and BAdIs: release state per SAP Cloud ERP / Private edition release and the official successor, from the SAP Cloudification Repository.',
    label: 'SAP object name',
    placeholder: 'e.g. MARA, BSEG, I_PRODUCT, CL_ABAP_TYPEDESCR',
    hint: 'Type an object name. Exact, prefix and fuzzy matches are shown with their release state per edition and the successor to use instead.',
    emptyHint: 'Objects that SAP does not list in the Cloudification Repository are not released for ABAP Cloud. Check the spelling or search by prefix.',
    match: '{type} match',
  },
  successor: {
    metaTitle: 'Legacy SAP object → cloud successor finder | ERP Preflight',
    metaDescription:
      'Find the released successor of a classic SAP table, BAPI or function module per S/4HANA and SAP Cloud ERP release, from the official SAP Cloudification Repository.',
    label: 'Legacy object or transaction',
    placeholder: 'e.g. MARA, BSEG, BAPI_PO_CREATE1, VBAK',
    hint: 'Enter a table, BAPI, function module or other development object. The answer is the official successor per release — never a guess.',
    tcodeCoverage:
      'Transaction codes are not part of the current knowledge sources (the SAP Cloudification Repository lists development objects). For a transaction, look up the tables or BAPIs it uses — ERP Preflight does not invent a transaction mapping.',
    releaseTable: 'State and successor per release',
    successorState: 'Successor state in this release',
  },
  api: {
    metaTitle: 'SAP API deprecation lookup & release diff | ERP Preflight',
    metaDescription:
      'Released and deprecated SAP APIs (CDS views, classes, behavior definitions, BAPIs) per release with successors, plus a release-to-release diff — from official SAP release data.',
    modeSearch: 'Look up an API',
    modeDeprecated: 'Browse deprecated APIs',
    modeDiff: 'Compare two releases',
    label: 'API name',
    placeholder: 'e.g. I_PURCHASEORDERTP, CL_ABAP_TYPEDESCR, I_MAINTENANCENOTIFICATIONTP',
    hint: 'Search CDS views, classes, interfaces, behavior definitions, BAPIs and OData services.',
    deprecatedIntro: '{count} APIs are deprecated in the latest SAP Cloud ERP Private release.',
    firstReleased: 'First released in',
    firstDeprecated: 'Deprecated since',
    current: 'Current state',
    notYet: 'not deprecated',
    neverReleased: 'never released',
    diffIntro: 'Changes of the release contract between two releases (global SAP knowledge only).',
    from: 'From release',
    to: 'To release',
    changeType: 'Change type',
    allChanges: 'All changes',
    compare: 'Compare',
    sameRelease: 'Choose two different releases.',
    diffEmpty: 'No differences for this selection.',
    previousState: 'Before',
    currentState: 'After',
  },
  xml: {
    metaTitle: 'Form XML field checker — does my field path exist? | ERP Preflight',
    metaDescription:
      'Check a field path against your SAP form data XML: does it exist, what value does it carry and are namespaces the reason a binding stays empty? Parsed safely in memory, nothing stored.',
    xmlLabel: 'XML document',
    xmlHelp: 'Paste the form data / interface XML or load a file (max. 90 000 characters). It is parsed in memory and never stored.',
    upload: 'Load XML file',
    pathLabel: 'Field path',
    pathHelp: '/root/child, //any-depth, item[2] for a position, prefix:name for namespaces, @attr for attributes.',
    pathPlaceholder: '/data/Header/PurchaseOrder',
    nsLabel: 'Namespace prefixes (optional)',
    nsHelp: 'One per line: prefix=namespace-uri. Prefixes declared in the document are resolved automatically.',
    submit: 'Check field',
    checking: 'Checking…',
    reset: 'Clear',
    exists: 'The path exists — {count} match(es)',
    missing: 'The path does not exist in this document',
    notWellFormed: 'The document was not checked',
    value: 'Value',
    empty: '(empty)',
    truncated: 'truncated',
    location: 'Line {line}, column {column}',
    namespace: 'Namespace',
    noNamespace: 'no namespace',
    children: '{count} child elements',
    issues: 'Findings',
    document: 'Document',
    root: 'Root element',
    elements: '{count} elements, depth {depth}',
    declared: 'Declared prefixes',
    fileTooLarge: 'The file is larger than 90 000 characters.',
    fileUnreadable: 'The file could not be read as text.',
    severity: {
      ERROR: 'Error',
      WARNING: 'Warning',
      INFO: 'Note',
    },
    errors: {
      xmlRequired: 'Paste or upload an XML document.',
      xmlTooLarge: 'The XML document is larger than 90 000 characters.',
      pathRequired: 'Enter a field path.',
      pathTooLong: 'The field path is longer than 300 characters.',
      pathSlash: "The field path must start with '/' or '//'.",
      namespacesInvalid: 'Use one prefix=uri per line (at most 20).',
    },
    privacy: 'Deterministic check: the same document and path always give the same answer. Nothing is stored or logged.',
    unsaved: 'Your XML document and field path will be discarded. Leave this page?',
  },
  fiori: {
    metaTitle: 'Fiori 403 / “not authorized” decision tree | ERP Preflight',
    metaDescription:
      'Guided, deterministic questions that narrow a Fiori 403 or “not authorized” error down to a cause category — CSRF, Gateway service, authorization, ICF, UCON, Cloud Connector — and list the evidence to collect.',
    intro:
      'Answer a few questions. The tree narrows the problem to a likely cause category and tells you which evidence confirms or rules it out. It does not diagnose your system — the Fiori 403 Root-Cause Doctor does that from the evidence.',
    step: 'Question {n}',
    back: 'Back',
    restart: 'Start again',
    yourAnswers: 'Your answers',
    likelyCause: 'Likely cause category',
    collect: 'Evidence to collect',
    relatedFinding: 'Matching engine finding code',
    notDiagnosis:
      'This is a category, not a diagnosis. Confirm it with the evidence above — or upload that evidence to a workspace and let the Fiori 403 Root-Cause Doctor decide with line-level proof.',
    engineLink: 'Fiori 403 Root-Cause Doctor — input formats and rules',
    questions: {
      start: {
        text: 'Where do you see the problem?',
        options: {
          content: 'The app tile is missing, or the launchpad says the app cannot be opened',
          http: 'A request fails with HTTP 403 (error message or browser network trace)',
          btp: 'The app runs through SAP BTP (Build Work Zone / Cloud Connector) and fails there',
        },
      },
      method: {
        text: 'Which HTTP method does the failing request use (browser developer tools → Network)?',
        options: {
          modifying: 'POST, PUT, PATCH, MERGE or DELETE — saving or changing data',
          read: 'GET — reading data or loading the app',
        },
      },
      csrf: {
        text: 'Does the 403 response carry the header “x-csrf-token: Required” or mention CSRF token validation?',
        options: {
          yes: 'Yes',
          no: 'No, or I cannot tell',
        },
      },
      log: {
        text: 'What does transaction /IWFND/ERROR_LOG on the Gateway hub show for the time of the request?',
        options: {
          service: '“No service found”, the service is not active, or no system alias',
          auth: 'An authorization error (for example S_SERVICE or “no authorization”)',
          backend: 'An error raised in the backend system',
          nothing: 'Nothing is logged for that time',
        },
      },
      icf: {
        text: 'Is the ICF node of the request URL active in transaction SICF?',
        options: {
          inactive: 'No, or the node does not exist',
          active: 'Yes, the node is active',
        },
      },
      ucon: {
        text: 'Is Unified Connectivity (UCON, transaction UCONCOCKPIT) active with RFC or HTTP allowlists?',
        options: {
          yes: 'Yes, allowlists are in logging or final phase',
          no: 'No, or I do not know',
        },
      },
      btp: {
        text: 'Where is the request denied?',
        options: {
          connector: 'The SAP Cloud Connector access or audit log shows it as denied',
          backend: 'It reaches the backend (entry in /IWFND/ERROR_LOG or SU53)',
          unsure: 'I do not know yet',
        },
      },
    },
    outcomes: {
      content: {
        title: 'Launchpad content or role assignment',
        summary:
          'A missing tile or “app could not be opened” usually means the business catalog, space/page or target mapping is not assigned to the user — before any HTTP 403 happens.',
        evidence: [
          'The user’s PFCG roles and the launchpad catalogs, spaces and pages they contain',
          'The target mapping (semantic object and action) of the app in the launchpad content manager',
          'A screenshot of the launchpad error including the semantic object and action',
        ],
        code: 'FIORI_AUTH_OBJECT_MISSING',
      },
      csrf: {
        title: 'CSRF token missing or invalid',
        summary:
          'Modifying OData requests need a valid CSRF token fetched in the same session. Proxies, expired sessions or cross-origin setups frequently drop it.',
        evidence: [
          'A browser network trace (HAR) of the failing request and the preceding token fetch',
          'The request and response headers of the 403 (x-csrf-token, cookies)',
          'Reverse proxy or load balancer configuration for session stickiness and cookies',
        ],
        code: 'FIORI_CSRF_TOKEN_INVALID',
      },
      gateway: {
        title: 'Gateway service not activated or no system alias',
        summary:
          'The OData service is not registered on the Gateway hub, or the system alias to the backend is missing — the request never reaches business logic.',
        evidence: [
          '/IWFND/ERROR_LOG entry for the request',
          '/IWFND/MAINT_SERVICE: service registration, version and system alias',
          'SICF status of the service node',
        ],
        code: 'FIORI_GATEWAY_SERVICE_NOT_ACTIVATED',
      },
      auth: {
        title: 'Missing authorization',
        summary:
          'An authorization check failed — for the service start (S_SERVICE, S_START) or for a business authorization object checked in the backend.',
        evidence: [
          'SU53 of the user directly after the failure, on the system where the check failed',
          'An authorization trace (STAUTHTRACE) for the user during the failing request',
          '/IWFND/ERROR_LOG entry and the user’s role assignment',
        ],
        code: 'FIORI_AUTH_OBJECT_MISSING',
      },
      icf: {
        title: 'ICF service node inactive',
        summary: 'The ICF node that serves the URL is inactive or missing, so the web dispatcher or ICM answers before the application.',
        evidence: [
          'SICF: status of the node and of its parent nodes for the exact URL path',
          'The request URL and response from the browser network trace',
          'ICM / web dispatcher trace for the request if the node is active',
        ],
        code: 'FIORI_ICF_INACTIVE',
      },
      ucon: {
        title: 'Blocked by UCON allowlist',
        summary: 'Unified Connectivity rejects calls to function modules or HTTP services that are not on the allowlist of the scenario.',
        evidence: [
          'UCONCOCKPIT: phase and allowlist of the RFC/HTTP scenario',
          'The UCON log entries for the time of the request',
          'The name of the called function module or HTTP path',
        ],
        code: 'FIORI_UCON_DENIED',
      },
      connector: {
        title: 'Denied by the SAP Cloud Connector',
        summary: 'The Cloud Connector does not expose the backend resource path, or the principal propagation / access control rejects it.',
        evidence: [
          'Cloud Connector access control: virtual host, exposed resources and path prefixes',
          'Cloud Connector audit and trace log for the time of the request',
          'The BTP destination configuration (proxy type, authentication)',
        ],
        code: 'FIORI_CLOUD_CONNECTOR_DENIED',
      },
      unknown: {
        title: 'Not determinable from the answers',
        summary:
          'The answers do not point to one category. Collect the evidence below — together it covers every category the Fiori 403 Root-Cause Doctor evaluates.',
        evidence: [
          'A browser network trace (HAR) of the failing request',
          'SU53 and /IWFND/ERROR_LOG for the time of the request',
          'SICF status of the URL path and, if active, UCON and Cloud Connector logs',
        ],
        code: 'FIORI_403_INSUFFICIENT_TELEMETRY',
      },
    },
  },
  search: {
    metaTitle: 'SAP knowledge & error search | ERP Preflight',
    metaDescription:
      'Search reviewed SAP knowledge articles, SAP objects with their release state and the finding codes of the ERP Preflight analysis engines.',
    label: 'Search term',
    placeholder: 'e.g. output determination, 403, BD52, MARA',
    hint: 'At least 2 characters. Results come from reviewed articles, the global knowledge graph and the engine rule catalog.',
    articles: 'Knowledge articles',
    objects: 'SAP objects',
    rules: 'Engine finding codes',
    noArticles: 'No article matches.',
    noObjects: 'No SAP object matches.',
    noRules: 'No finding code matches.',
    rulesUnavailable: 'The engine catalog is temporarily unavailable.',
    updateRequired: 'Update in progress',
  },
  sap: {
    breadcrumb: 'SAP objects',
    cleanCoreTitle: '{key}: Clean Core status and successor',
    cleanCoreMetaTitle: '{key} ({type}) — {verdict} | Clean Core',
    cleanCoreMetaDescription:
      '{key} ({type}) release state per SAP S/4HANA and SAP Cloud ERP release{successorPart}, from the official SAP Cloudification Repository. Last verified {date}.',
    successorPart: ', successor {successors}',
    migrationTitle: '{key} in SAP Cloud ERP: what replaces it?',
    migrationMetaTitle: '{key} successor for SAP Cloud ERP migration: {successors}',
    migrationMetaDescription:
      'What replaces {key} ({type}) when moving to SAP Cloud ERP: {successors}. Release state per release and related objects, from official SAP release data.',
    answer: 'Answer',
    purpose: 'What this page answers',
    purposeCleanCore:
      'Whether {key} may be used in ABAP Cloud / clean core development, in which releases, and what to use instead.',
    purposeMigration:
      'What replaces {key} when custom code moves to SAP Cloud ERP or ABAP Cloud, and in which releases the successor is released.',
    type: 'Object type',
    component: 'Application component',
    swComponent: 'Software component',
    releasesTitle: 'Release state per release',
    successorsTitle: 'Successors',
    relatedTitle: 'Related objects from the knowledge graph',
    relatedMore: '+{count} more related objects',
    alternatesTitle: 'Same name, other object types',
    lifecycleTitle: 'Lifecycle per edition',
    evidenceTitle: 'Evidence and provenance',
    verifiedFrom: 'Retrieved {date} from {source}',
    howToAct: 'What to do',
    actReleased: 'Use {key} directly in ABAP Cloud code; it is part of the released API contract in the releases marked “Released”.',
    actSuccessor:
      'Replace reads and writes of {key} with the successor. Where several successors are listed, pick the one whose fields match your usage, and check that it is released in your target release.',
    actConcept: 'Follow the successor concept named by SAP: {concept}.',
    actNone:
      'SAP publishes no successor. Encapsulate the access in a wrapper you own (tier-2 in a clean core setup) or request a released API from SAP.',
    actUnknown: 'There is no official state for {key}; treat it as not released until SAP publishes one.',
    migrationLink: 'Migration view: what replaces {key}',
    cleanCoreLink: 'Clean Core view of {key}',
    lowInfo:
      'This page does not yet have enough verified information to be indexed by search engines (quality gate: {failed}).',
    gateChecks: {
      GLOBAL_REVIEWED: 'global reviewed knowledge',
      OBJECT_TYPE: 'object type',
      RELEASE_STATE: 'official release state',
      SUCCESSOR_OR_EXPLICIT_NONE: 'successor or explicit “none needed”',
      EVIDENCE_SOURCE: 'official evidence with retrieval date',
      RELATED_OBJECTS: 'related objects',
    },
    lookupAnother: 'Look up another object',
    notInGraph: '{key} is not in the public knowledge graph.',
    unavailableTitle: 'Knowledge service unavailable',
  },
  article: {
    provenance: 'Source provenance',
    provenanceValues: {
      OFFICIAL_SAP_DOCUMENTATION: 'Based on official SAP documentation',
      OFFICIAL_SAP_REPOSITORY: 'Based on official SAP repository data',
      CURATED_RULE: 'Curated ERP Preflight rule',
      EDITORIAL: 'Editorial content, technically reviewed',
    },
    technicalReview: 'Technical review',
    updateRequired: 'This article is being updated: {reason}',
    updateRequiredNoReason: 'This article is being updated.',
  },
  docs: {
    breadcrumb: 'Documentation',
    metaTitle: 'ERP Preflight documentation',
    metaDescription:
      'How to use ERP Preflight: getting started, engine catalog with input formats and rules, security and data handling, API & CLI, local agent and FAQ.',
    title: 'Documentation',
    intro: 'Everything described here is what the product does today. Where something is not available yet, the page says so.',
    onThisPage: 'Sections',
    allPages: 'All documentation pages',
    engineCatalogTitle: 'Engine catalog',
    engineCatalogIntro:
      'Generated from the live catalog of the analysis service: {count} engines. Each engine lists its accepted input, its finding codes and the remediation text shown with every finding.',
    catalogUnavailable: 'The engine catalog is temporarily unavailable. Please try again in a moment.',
    engine: 'Engine',
    domain: 'Domain',
    version: 'Version',
    rules: 'Finding codes',
    inputRules: 'Input validation codes',
    accepted: 'Accepted formats',
    required: 'Required input',
    targetReleases: 'Target releases',
    severity: 'Default severity',
    category: 'Category',
    remediation: 'Remediation',
    inputContract: 'Input contract',
    openEngine: 'Engine details',
    formatsTitle: 'File formats per engine',
    formatsIntro:
      'Formats each engine accepts (from its input contract). Uploads are additionally checked by magic bytes, archive limits and a malware scan before an engine sees them.',
    apiReference: 'API reference (OpenAPI)',
    lastUpdated: 'Content reviewed {date}',
    backToDocs: 'Back to the documentation',
  },
};

export type PublicToolsMessages = typeof publicToolsEn;
