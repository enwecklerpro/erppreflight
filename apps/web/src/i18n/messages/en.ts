import { CANONICAL_ENGINES } from '../../lib/api-client';
import { analyzeEn } from './analyze.en';
import { publicToolsEn } from './public-tools.en';
import { findingLifecycleEn } from './finding-lifecycle.en';

/**
 * English dictionary — the reference key set. `de.ts` is typed as `Messages`,
 * so TypeScript rejects missing or extra keys; a unit test additionally checks
 * array lengths and interpolation placeholders. Content is human-written; do not
 * machine-translate (Part 02 §2.7).
 *
 * Interpolation: `{name}` placeholders, resolved by `t(key, { name })`.
 */
export const en = {
  common: {
    brand: 'ERP Preflight',
    tagline: 'Know what will break before production does.',
    subheadline:
      'Validate ERP outputs, extensions, integrations, transports, migrations and operational changes before they fail.',
    runPreflight: 'Run a Preflight',
    exploreFreeTools: 'Try the demo sandbox',
    startFree: 'Start free',
    learnMore: 'Learn more',
    contactSales: 'Contact sales',
    backHome: 'Back to home',
    retry: 'Try again',
    lastReviewed: 'Last reviewed',
    version: 'Version',
    targetReleases: 'Target releases',
    sources: 'Sources',
    relatedEngines: 'Related engines',
    loading: 'Loading…',
    skipToContent: 'Skip to content',
    engineCount: '{count} analysis engines',
    viewAll: 'View all',
  },
  nav: {
    primary: 'Main navigation',
    dashboard: 'Dashboard',
    projects: 'Projects',
    inspector: 'Analysis Inspector',
    templates: 'Templates',
    artifacts: 'Artifacts',
    matrix: 'Release Matrix',
    landscapes: 'Landscapes',
    agentGate: 'Agent Gate',
    integrations: 'Integrations',
    settings: 'Settings',
    admin: 'Admin',
    analyze: 'Analyze',
    reports: 'Reports',
    billing: 'Billing',
    audit: 'Audit log',
    retention: 'Data retention',
    support: 'Support',
    knowledgeGraph: 'Knowledge graph',
    notifications: 'Notifications',
    more: 'More',
    secondary: 'More areas',
    solutions: 'Solutions',
    pricing: 'Pricing',
    knowledge: 'Knowledge',
    security: 'Security',
    docs: 'Docs',
    demo: 'Demo Sandbox',
    search: 'Search…',
    searchTitle: 'Search & Commands (Cmd+K)',
    login: 'Login',
    signup: 'Sign Up',
    logout: 'Logout',
    logoutTitle: 'Sign out',
    language: 'Language',
    switchTo: 'Switch language to {language}',
  },
  footer: {
    product: 'Product',
    resources: 'Resources',
    legal: 'Legal',
    imprint: 'Imprint',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    cookies: 'Cookie Policy',
    cookieSettings: 'Cookie settings',
    security: 'Security',
    trust: 'Trust Center',
    status: 'System status',
    changelog: 'Changelog',
    docs: 'Documentation',
    subprocessors: 'Subprocessors',
    dpa: 'Data processing agreement',
    disclaimer:
      'SAP, S/4HANA and other SAP products and services mentioned herein are trademarks or registered trademarks of SAP SE (or an SAP affiliate company) in Germany and other countries. ERP Preflight is an independent product and is not affiliated with, endorsed or sponsored by SAP SE.',
    rights: 'All rights reserved.',
  },
  home: {
    metaTitle: 'ERP Preflight — Know what will break before production does',
    metaDescription:
      'Deterministic, evidence-backed preflight analysis for SAP outputs, extensions, integrations, transports, migrations and operations — before changes reach production.',
    eyebrow: 'Preflight analysis for SAP landscapes',
    problemTitle: 'Changes fail in production for reasons that were visible before',
    problemBody:
      'Most production incidents after an SAP change are not mysteries. The missing decision table row, the transport imported without its predecessor, the custom field that never reaches the form — the evidence existed in configuration and code before go-live. It was simply not checked systematically.',
    problems: [
      'Output is not created because a BRFplus determination step has no matching rule.',
      'A transport is imported before the dictionary change it depends on.',
      'Custom code writes directly to standard tables and blocks a clean core target.',
      'A Fiori app returns 403 because a service authorization is missing from a role.',
    ],
    howTitle: 'How it works',
    howSteps: [
      {
        title: 'Upload exports',
        body: 'Provide configuration, code or log exports from your system. Files are scanned, validated and stored in your tenant only.',
      },
      {
        title: 'Run deterministic engines',
        body: 'Specialised engines parse the artifacts and evaluate explicit rules. The same input always produces the same findings.',
      },
      {
        title: 'Act on evidence',
        body: 'Every finding points to the exact file, line and hash it is based on, with a severity, a confidence class and remediation guidance.',
      },
    ],
    solutionsTitle: 'Six solution areas, one platform',
    solutionsIntro:
      'All engines share the same ingestion, evidence model, findings workflow and reporting — they are not separate tools.',
    evidenceTitle: 'Evidence-backed, not guesswork',
    evidenceBody:
      'Findings are produced by deterministic parsers and rules. AI assistance is limited to explanations and can never raise a finding above the INFERRED confidence class.',
    evidencePoints: [
      'Artifact path, line, column and code snippet for every finding',
      'SHA-256 hash of the analysed artifact',
      'Explicit confidence classes: VERIFIED, RULE_DERIVED, INFERRED, UNKNOWN',
      'Findings without verifiable evidence are demoted to UNKNOWN',
    ],
    projectTitle: 'Project mode for programmes, not just single checks',
    projectBody:
      'Group analyses in project workspaces, keep a baseline, compare runs over time and export reports for steering committees and auditors.',
    releaseTitle: 'Release intelligence',
    releaseBody:
      'Engines declare the SAP releases they support. The release matrix shows which checks apply to your target release before you run them.',
    securityTitle: 'Built for customer data from day one',
    securityBody:
      'Uploaded artifacts can contain sensitive configuration. The platform is designed around tenant isolation and minimal exposure.',
    securityPoints: [
      'PostgreSQL row-level security for every tenant table',
      'Malware scanning and archive safety checks before analysis',
      'Secret redaction before snippets are stored as evidence',
      'No use of customer artifacts for AI model training',
    ],
    integrationsTitle: 'Open interfaces',
    integrationsBody:
      'Use the results where your team already works: a documented REST API with OpenAPI description, webhooks, a Model Context Protocol (MCP) server for AI agents and report exports.',
    fileFirstTitle: 'File-first: start with the exports you already have',
    fileFirstBody:
      'Every analysis runs on exported artifacts — configuration and decision table exports, ABAP sources, ATC and readiness check results, transport data, logs. No system access and no installation are needed to get the first findings.',
    connectorsTitle: 'Connectors where they help',
    connectorsBody:
      'Findings can be synchronised to delivery tools such as Jira and SAP Cloud ALM. Direct read-only system connectors and a local agent for private deployments are on the roadmap; until then, uploads remain the supported way in.',
    knowledgeTitle: 'From the knowledge base',
    knowledgeBody: 'Reviewed explanations of the SAP topics behind common change failures.',
    knowledgeCta: 'Open the knowledge base',
    docsTitle: 'Documentation',
    docsBody: 'Engine reference, evidence model, API and MCP integration.',
    demoTitle: 'See it on sample data',
    demoBody: 'The demo sandbox provisions a synthetic sample project in your workspace so you can explore findings and evidence.',
    pricingTitle: 'Plans for single projects and whole landscapes',
    pricingBody: 'Start with a free sandbox and move to a plan when your programme needs more projects and analyses.',
    pricingCta: 'See pricing',
    faqTitle: 'Frequently asked questions',
    faq: [
      {
        q: 'Do I need to connect ERP Preflight to my SAP system?',
        a: 'No. The engines analyse exported artifacts that you upload, such as configuration exports, code and logs. No system connection is required to run a preflight.',
      },
      {
        q: 'Does AI decide which findings are reported?',
        a: 'No. Findings come from deterministic parsers and rules. AI is only used for optional explanations and its contributions are capped at the INFERRED confidence class.',
      },
      {
        q: 'Which SAP releases are supported?',
        a: 'Each engine declares its target releases. The public release matrix lists them per engine.',
      },
      {
        q: 'Is ERP Preflight an SAP product?',
        a: 'No. ERP Preflight is an independent product and is not affiliated with, endorsed or sponsored by SAP SE.',
      },
    ],
    finalTitle: 'Find out what will break — before go-live',
    finalBody: 'Create a workspace, upload your first export and review evidence-backed findings.',
  },
  solutions: {
    indexTitle: 'Solutions',
    indexMetaTitle: 'Solutions — ERP Preflight',
    indexMetaDescription:
      'Preflight engines for SAP output and extensibility, migration and clean core, integration, release and transport, operations and warehouse automation.',
    indexIntro:
      'Each solution area groups the engines that analyse one class of change. All of them share ingestion, evidence and reporting.',
    painTitle: 'The problem',
    enginesTitle: 'Engines in this area',
    examplesTitle: 'Examples of what is checked',
    knowledgeTitle: 'Related knowledge articles',
    noKnowledge: 'No knowledge articles are published for this area yet.',
    knowledgeUnavailable: 'Knowledge articles could not be loaded right now.',
    ctaTitle: 'Run this preflight on your own exports',
    ctaBody: 'Create a free workspace and upload an export to see findings with evidence.',
    items: {
      'output-extensibility': {
        name: 'Output & Extensibility',
        tagline: 'Outputs, forms and extensions that keep working after a change.',
        metaDescription:
          'Preflight checks for SAP output parameter determination, forms, custom field flow and extension impact.',
        pain: 'Output problems surface late: the billing document is saved, but no email is sent; the custom field is on the screen, but not on the PDF. The causes sit in determination rules, form templates and extension settings that are rarely checked together.',
        examples: [
          'BRFplus determination steps without a matching rule for a document combination',
          'Form templates referenced in determination but missing in the target system',
          'Custom fields whose usage for forms, APIs or follow-on documents is not enabled',
          'Extensions affected by changes to the objects they depend on',
        ],
      },
      'migration-clean-core': {
        name: 'Migration & Clean Core',
        tagline: 'Know which custom code and configuration block your target.',
        metaDescription:
          'Preflight checks for clean core compliance, ECC to cloud migration, configuration mapping and fit-to-standard gaps.',
        pain: 'Migration assessments are often spreadsheets built by hand. Custom code that modifies standard, uses unreleased objects or depends on deprecated transactions is found too late, when the target system is already being built.',
        examples: [
          'Classification of custom code dependencies by release status',
          'Direct writes to SAP standard tables and classic modifications',
          'Configuration activities without a counterpart in the cloud target',
          'Custom functionality overlapping with standard scope',
        ],
      },
      integration: {
        name: 'Integration',
        tagline: 'Interfaces that still deliver what the receiver expects.',
        metaDescription:
          'Preflight checks for SAP change pointer coverage and API compatibility before interface changes go live.',
        pain: 'Interfaces break silently. A field added to an IDoc is never distributed because no change pointer is written for it; a consumer calls an API version that is deprecated in the next release.',
        examples: [
          'Fields required by receivers but not covered by change pointer configuration',
          'Message types without active change pointers or processing',
          'Use of deprecated or changed OData, SOAP and RFC interfaces',
        ],
      },
      'release-transport': {
        name: 'Release & Transport',
        tagline: 'Import in the right order, with everything that belongs together.',
        metaDescription:
          'Preflight checks for SAP transport dependencies and software collection completeness before imports.',
        pain: 'Transports imported in the wrong order cause activation errors or, worse, succeed and fail at runtime. Software collections are exported without an object they depend on.',
        examples: [
          'Transports whose referenced objects are in another, not yet imported request',
          'Objects contained in several requests with conflicting versions',
          'Software collections missing items their content depends on',
        ],
      },
      operations: {
        name: 'Operations',
        tagline: 'Explain operational failures with evidence instead of trial and error.',
        metaDescription:
          'Preflight checks for Fiori authorizations, stuck workflows, account determination, system refresh deltas and safe decommissioning.',
        pain: 'Operational issues — a 403 in a Fiori app, a stuck workflow, a posting to the wrong account, a refreshed system still pointing to production — cost hours of manual investigation across roles, configuration and logs.',
        examples: [
          'Missing service or start authorizations behind Fiori 403 errors',
          'Work items without agents or waiting for events that never arrive',
          'Account determination entries missing for new combinations',
          'RFC destinations and logical systems not adjusted after a refresh',
          'Objects that are still referenced before they are decommissioned',
        ],
      },
      'warehouse-automation': {
        name: 'Warehouse Automation',
        tagline: 'Understand what happened between the warehouse system and automation.',
        metaDescription:
          'MFS BlackBox analyses Material Flow System telegram sequences to explain warehouse automation incidents.',
        pain: 'When conveyors stop or pallets end up in the wrong place, the telegram exchange between the warehouse management system and the programmable logic controllers holds the answer — buried in large logs.',
        examples: [
          'Telegram sequences with missing acknowledgements or timeouts',
          'Unexpected jumps in the transport topology',
          'Buffer and resource conflicts in the telegram stream',
        ],
      },
    },
  },
  engines: Object.fromEntries(CANONICAL_ENGINES.map((e) => [e.id, e.description])) as Record<string, string>,
  pricing: {
    metaTitle: 'Pricing — ERP Preflight',
    metaDescription:
      'ERP Preflight plans: a free community sandbox and paid plans for projects, programmes and partners.',
    title: 'Pricing',
    intro: 'Plans differ in the number of projects, analyses and landscapes, and in enterprise capabilities.',
    perMonth: '/ month',
    free: 'Free',
    unlimited: 'Unlimited',
    projects: 'Projects',
    analyses: 'Analyses per month',
    storage: 'Artifact storage',
    gigabytes: '{count} GB',
    exports: 'Report exports per month',
    teamMembers: 'Team members',
    reportBranding: 'Branded reports',
    pricesUnavailable: 'Current prices could not be loaded — contact sales for a quote.',
    landscapes: 'System landscapes',
    retention: 'Audit log retention',
    days: '{count} days',
    support: 'Support response target',
    hours: '{count} h',
    agentGate: 'Agentic change gate',
    whatIf: 'What-if simulation',
    airGapped: 'Air-gapped report export',
    cloudAlm: 'Delivery tool synchronisation',
    included: 'Included',
    notIncluded: 'Not included',
    startFree: 'Start for free',
    choose: 'Get started',
    catalogNote: 'Plan limits and prices are taken from the platform plan catalog that is enforced by the API.',
    tiers: {
      FREE: 'For evaluating the engines on your own exports.',
      STARTER: 'For a first clean core or output project.',
      PROFESSIONAL: 'For programmes with several projects and teams.',
      ENTERPRISE: 'For whole landscapes with unlimited projects.',
      PARTNER: 'For system integrators serving several customers.',
    },
  },
  security: {
    metaTitle: 'Security — ERP Preflight',
    metaDescription:
      'How ERP Preflight protects uploaded SAP artifacts: tenant isolation, malware scanning, secret redaction and deterministic analysis.',
    title: 'Security at ERP Preflight',
    intro:
      'Artifacts from SAP systems can contain configuration, code and personal data. These are the controls implemented in the platform.',
    controls: [
      {
        title: 'Tenant isolation in the database',
        body: 'Every tenant table is protected by PostgreSQL row-level security. Tenant queries run as a dedicated non-privileged role, so isolation is enforced by the database even if application code is wrong.',
      },
      {
        title: 'Safe file ingestion',
        body: 'Uploads are checked by file signature rather than extension, scanned for malware and unpacked with limits on size, expansion ratio, nesting and paths. XML is parsed with external entities disabled.',
      },
      {
        title: 'Secret redaction',
        body: 'Credentials and secrets are redacted before code snippets are stored as evidence.',
      },
      {
        title: 'Tenant-scoped storage',
        body: 'Customer artifacts are stored under a tenant- and project-specific path; download links are short-lived.',
      },
      {
        title: 'Deterministic analysis and AI boundaries',
        body: 'Findings are produced by deterministic rules. Optional AI assistance cannot raise confidence above INFERRED, and customer artifacts are not used to train AI models.',
      },
      {
        title: 'Account security',
        body: 'Passwords are hashed with Argon2id, sign-in endpoints are rate limited and sessions can be revoked by signing out.',
      },
    ],
    moreTitle: 'More details',
    trustLink: 'Trust Center with subprocessors',
    statusLink: 'Live system status',
    contact: 'To report a vulnerability, contact the operator via the address in the imprint.',
  },
  knowledge: {
    metaTitle: 'Knowledge base — ERP Preflight',
    metaDescription:
      'Reviewed explanations of SAP topics behind common change failures: output determination, clean core, change pointers, transports, Fiori authorizations and more.',
    title: 'Knowledge base',
    intro:
      'Technically reviewed explanations of the SAP topics our engines analyse. Each article states when it was last reviewed and which sources it is based on.',
    empty: 'No articles are published in this language yet.',
    errorTitle: 'The knowledge base is temporarily unavailable',
    errorBody: 'The articles could not be loaded. Please try again in a moment.',
    readArticle: 'Read article',
    breadcrumbHome: 'Home',
    relatedSolutions: 'Related solution areas',
    sourcesTitle: 'Sources',
    reviewNote:
      'This article is general information about SAP concepts and does not replace SAP documentation for your specific release.',
    notFoundTitle: 'Article not found',
  },
  legal: {
    reviewNotice:
      'This page describes the processing implemented in the software. The operator must review and complete it legally before production use.',
    notConfiguredTitle: 'Operator details not configured',
    notConfiguredBody:
      'The operator of this installation has not configured its legal details yet (NEXT_PUBLIC_LEGAL_* environment variables). No company data is shown until it is configured.',
    fields: {
      company: 'Operator',
      address: 'Address',
      representative: 'Represented by',
      register: 'Commercial register',
      vatId: 'VAT identification number',
      email: 'Email',
      phone: 'Phone',
      responsible: 'Responsible for content',
    },
    imprint: {
      title: 'Imprint',
      metaDescription: 'Legal information about the operator of ERP Preflight.',
      intro: 'Information pursuant to § 5 DDG (German Digital Services Act).',
      disputeTitle: 'Consumer dispute resolution',
      disputeBody:
        'The operator is not willing or obliged to participate in dispute resolution proceedings before a consumer arbitration board.',
    },
    privacy: {
      title: 'Privacy Policy',
      metaDescription: 'How ERP Preflight processes personal data.',
      sections: [
        {
          heading: 'Controller',
          body: 'The controller for the processing described here is the operator named in the imprint.',
        },
        {
          heading: 'Account and organization data',
          body: 'To provide the service we process the name, email address, organization and role of registered users. Legal basis: performance of a contract (Art. 6(1)(b) GDPR).',
        },
        {
          heading: 'Uploaded artifacts',
          body: 'Files you upload for analysis are stored in storage that is isolated per tenant and project and processed only to produce findings and reports. Secrets detected in snippets are redacted before they are stored as evidence. Legal basis: performance of a contract (Art. 6(1)(b) GDPR).',
        },
        {
          heading: 'Server logs and security',
          body: 'For security and troubleshooting, requests are logged with technical data such as timestamp, request path and a correlation ID. Legal basis: legitimate interest in secure operation (Art. 6(1)(f) GDPR).',
        },
        {
          heading: 'Cookies and local storage',
          body: 'We use only technically necessary cookies and browser storage for sign-in, language and your cookie choice. No analytics or advertising tools are active. Details are listed in the cookie policy.',
        },
        {
          heading: 'Processors',
          body: 'Hosting and storage providers process data on our behalf under data processing agreements. The current list is published on the subprocessors page.',
        },
        {
          heading: 'Retention',
          body: 'Data is kept for as long as your account exists or as required by statutory retention periods. Audit log retention depends on your plan.',
        },
        {
          heading: 'Your rights',
          body: 'You have the right of access, rectification, erasure, restriction of processing, data portability and objection (Art. 15–21 GDPR), and the right to lodge a complaint with a supervisory authority.',
        },
      ],
    },
    terms: {
      title: 'Terms of Service',
      metaDescription: 'Terms governing the use of ERP Preflight.',
      sections: [
        {
          heading: 'Scope',
          body: 'These terms govern the use of the ERP Preflight software-as-a-service by business customers. Individual agreements take precedence.',
        },
        {
          heading: 'Service',
          body: 'ERP Preflight analyses artifacts uploaded by the customer and reports findings with evidence. Findings support, but do not replace, the customer’s own testing and release decisions.',
        },
        {
          heading: 'Customer obligations',
          body: 'Customers only upload data they are entitled to process, keep their credentials confidential and use the service in accordance with applicable law.',
        },
        {
          heading: 'Plans and limits',
          body: 'The scope of use depends on the booked plan. Limits are enforced by the platform and shown in the workspace settings.',
        },
        {
          heading: 'Data protection',
          body: 'Personal data is processed in accordance with the privacy policy and, where applicable, a data processing agreement.',
        },
        {
          heading: 'Trademarks',
          body: 'SAP and other SAP product names are trademarks of SAP SE. ERP Preflight is an independent product and is not affiliated with, endorsed or sponsored by SAP SE.',
        },
      ],
    },
    cookies: {
      title: 'Cookie Policy',
      metaDescription: 'Cookies and browser storage used by ERP Preflight.',
      intro:
        'ERP Preflight uses only technically necessary cookies and browser storage. No analytics or advertising cookies are set. Should optional analytics be introduced, it will only run after your consent.',
      tableName: 'Name',
      tablePurpose: 'Purpose',
      tableType: 'Type',
      tableDuration: 'Duration',
      necessary: 'Necessary',
      items: [
        { name: 'erppreflight_session', purpose: 'Keeps you signed in (set by the API, HTTP-only).', duration: '7 days' },
        { name: 'erp_auth', purpose: 'Marks that a sign-in exists so private pages can redirect to the login page.', duration: '7 days' },
        { name: 'erp_locale', purpose: 'Stores your preferred language.', duration: '1 year' },
        { name: 'erp_consent', purpose: 'Stores your cookie choice.', duration: '1 year' },
        { name: 'erppreflight_token, erppreflight_tenant_id', purpose: 'Browser storage for the API session token and the active organization.', duration: 'Until sign-out' },
      ],
      manage: 'Change your choice',
    },
    subprocessors: {
      title: 'Subprocessors',
      metaDescription: 'Service providers that process customer data on behalf of the operator of ERP Preflight.',
      intro:
        'The operator engages the following subprocessors to provide the service.',
      name: 'Subprocessor',
      purpose: 'Purpose',
      region: 'Location',
      notConfigured:
        'The operator of this installation has not published its subprocessor list yet (NEXT_PUBLIC_LEGAL_SUBPROCESSORS). Contact the operator for the current list.',
    },
    dpa: {
      title: 'Data processing agreement',
      metaDescription: 'Request a data processing agreement (Art. 28 GDPR) for ERP Preflight.',
      intro:
        'Business customers who upload artifacts containing personal data need a data processing agreement pursuant to Art. 28 GDPR. The operator provides it on request.',
      includesTitle: 'The agreement covers',
      includes: [
        'Subject matter, duration, nature and purpose of the processing',
        'Categories of data and data subjects',
        'Technical and organisational measures',
        'Use of subprocessors',
        'Support with data subject requests and deletion at the end of the contract',
      ],
      requestCta: 'Request a data processing agreement',
      emailSubject: 'Data processing agreement request',
    },
  },
  cookieConsent: {
    title: 'Cookies',
    body: 'We use only necessary cookies for sign-in, language and this choice. Optional analytics is not active and would only run with your consent.',
    acceptAll: 'Allow optional analytics',
    necessaryOnly: 'Necessary only',
    policy: 'Cookie policy',
  },
  notFound: {
    title: 'Page not found',
    body: 'The page you are looking for does not exist or has been moved.',
    home: 'Go to the homepage',
    knowledge: 'Browse the knowledge base',
  },
  ...analyzeEn,
  /** Free tools, programmatic SEO pages and documentation chrome (./public-tools.en.ts). */
  publicTools: publicToolsEn,
  findingLifecycle: findingLifecycleEn,
};

export type Messages = typeof en;
