# ERP Preflight — GPT Astra Ultra Master Build Prompt

**Target repository:** `https://github.com/enwecklerpro/erppreflight`

**Production domain:** `https://erppreflight.com`

Read this entire specification before implementation. All sections are binding.

---

# Part 00 — Execution Contract for GPT Astra Ultra

You are the principal engineering team responsible for building **ERP Preflight** end-to-end inside the repository:

`https://github.com/enwecklerpro/erppreflight`

The repository is intentionally empty. Initialize it professionally and build the complete product described in the remaining prompt files.

## 0.1 Mission

Build a production-grade, multi-tenant, enterprise-ready SaaS platform at `erppreflight.com` that offers a coherent set of SAP-focused preflight, migration, extensibility, integration, release, operations and warehouse-analysis engines.

The product must look and behave like a serious B2B SaaS company from day one.

Do not produce a demo that only looks finished. Build working flows, real persistence, real background jobs, robust validation, reports, tests, observability, admin controls, billing abstractions and deployment artifacts.

## 0.2 Work style

Operate autonomously. Do not stop after scaffolding. Do not stop after making the homepage. Do not stop after implementing one engine.

Maintain these files during execution:

- `IMPLEMENTATION_STATUS.md`
- `ARCHITECTURE_DECISIONS.md`
- `KNOWN_LIMITATIONS.md`
- `SECURITY_REVIEW.md`
- `THIRD_PARTY_NOTICES.md`
- `docs/runbooks/*`

For each major phase:

1. inspect existing state;
2. implement;
3. run linters/type checks;
4. run unit tests;
5. run integration tests;
6. run end-to-end tests where relevant;
7. fix failures;
8. update documentation;
9. commit with a meaningful message.

Do not claim something works unless you have executed the relevant test or can clearly mark it as requiring external credentials/infrastructure.

## 0.3 No superficial placeholders

Avoid “TODO: implement later” for core requirements.

Allowed placeholders are limited to integrations that require credentials not present in the environment. For those:

- implement the complete interface;
- provide a working local/mock adapter;
- provide validation;
- provide configuration screens;
- add integration tests against a test double;
- document the exact production configuration.

Do not use fake hard-coded analysis results in product flows.

## 0.4 Reliability hierarchy

When a finding can be proven deterministically, do not use an LLM to decide it.

Use this hierarchy:

1. exact parser/schema/config evidence;
2. deterministic rule engine;
3. static analysis / graph analysis;
4. official versioned knowledge record;
5. probabilistic semantic matching;
6. LLM reasoning only where the prior approaches cannot determine the answer.

Every finding must expose its provenance.

Supported confidence classes:

- `VERIFIED`
- `RULE_DERIVED`
- `INFERRED`
- `UNKNOWN`

Do not label an LLM guess as verified.

## 0.5 Security defaults

All customer content is private by default.

Never send uploaded data to an AI provider before:

- file validation;
- malware/quarantine stage;
- secret scanning/redaction;
- tenant authorization verification;
- configured AI privacy policy check.

Never log raw credentials, API tokens, private documents or sensitive payloads.

Implement short-lived signed download URLs.

## 0.6 Git discipline

Use:

- `main` as protected production-ready branch;
- feature branches or clearly separated commits during implementation;
- Conventional Commit style where practical;
- no committed secrets;
- `.env.example` with complete variable documentation;
- reproducible database migrations;
- lock files;
- pinned container bases.

Set up CI early, not at the end.

## 0.7 Product scope

The complete product includes these major user-facing modules:

### Output & Extensibility
- OPD Guard / Output Determination Doctor
- FormDoctor / OutputPath
- Custom Field Flow Doctor
- Extension Impact Guard

### Migration & Clean Core
- SPRO2Cloud
- ECC2Cloud Navigator
- SAP Gap Radar
- Clean Core Object Guard

### Integration
- Change Pointer Coverage Auditor
- API Change Guard

### Release & Transport
- Software Collection Dependency Guard
- Transport Dependency Analyzer

### Operations
- Safe Decommission Preflight
- Fiori 403 Root-Cause Doctor
- Workflow Stuck Explainer
- IAM Cost Optimizer
- Account Determination Preflight
- System Refresh Delta Guard

### Warehouse Automation
- MFS BlackBox

### Shared platform engines
- AI Problem Router
- Evidence Engine
- SAP Knowledge Graph
- Customer Dependency Graph
- Release Intelligence
- Scenario / Regression Test Lab
- Full Project Preflight
- File Ingestion & Sanitization
- Reporting
- Notifications
- Search
- Connectors / Local Agent
- Usage metering
- Audit trail

All of them must share infrastructure and data models rather than being separate mini-apps.

## 0.8 Product identity

Brand: **ERP Preflight**

Primary line:

> **Know what will break before production does.**

Secondary product description:

> Validate ERP outputs, extensions, integrations, transports, migrations and operational changes before they fail.

When referring to SAP products, use SAP names descriptively and include an independent-product disclaimer in the public site footer/legal pages. Do not visually imitate SAP’s brand.

## 0.9 Definition of “finished”

The project is not complete until:

- public website works;
- auth works;
- organizations/tenants work;
- project creation works;
- file upload works;
- core analyses run asynchronously;
- findings persist;
- evidence is visible;
- reports export;
- admin console works;
- billing plan abstractions work;
- localization works for English and German;
- SEO pages render server-side/static as appropriate;
- all engines at least have real parsers/rule logic and sample fixtures;
- tests cover critical paths;
- local Docker environment starts from documented commands;
- production deployment documentation exists;
- monitoring/health endpoints work;
- security checks run in CI;
- no obvious broken links or empty primary screens remain.

At the end, produce a release-readiness report listing what was tested, what passed, what requires external credentials and what remains intentionally limited.

---

# Part 01 — Product Vision, Personas, Workflows and Information Architecture

## 1.1 Product positioning

ERP Preflight is a **preflight intelligence platform for ERP change**.

The platform should answer questions such as:

- “Will this output configuration actually produce the expected email/form?”
- “Can this custom field reach the target document and form?”
- “What replaces this ECC IMG/SPRO configuration in S/4HANA Cloud Public Edition?”
- “Which legacy objects will not survive a Clean Core target?”
- “Will changing this field create the expected change pointer?”
- “Will this API migration introduce breaking changes?”
- “What will this software collection/transport break or miss?”
- “What uses this custom extension before I delete it?”
- “What will stop working if I lock this technical user?”
- “Why does this Fiori request return 403?”
- “Where did this workflow get stuck?”
- “Which account-determination combinations have no valid result?”
- “What changed after system refresh?”
- “What was the first causal divergence in an SAP EWM/MFS incident?”

The platform must support both **single-problem mode** and **project mode**.

## 1.2 Primary personas

Design explicit experiences for:

1. SAP consultant
2. SAP solution architect
3. SAP developer / ABAP Cloud developer
4. SAP integration consultant
5. SAP Public Cloud consultant
6. SAP Basis / operations engineer
7. SAP security / IAM administrator
8. SAP EWM/MFS consultant
9. Project manager / migration lead
10. Consulting partner / delivery manager
11. Enterprise reviewer/auditor
12. Platform owner/admin

Different personas should see relevant recommendations but use one consistent product.

## 1.3 Main navigation

Keep the primary product navigation simple:

- Home
- Projects
- Analyze
- Knowledge
- Reports

Secondary areas:

- Notifications
- Integrations
- Settings
- Billing
- Admin (authorized only)

Do not expose 18 modules as 18 unrelated top-level navigation items.

## 1.4 Analyze experience

The Analyze page starts with:

> **What do you want to check?**

Support:

- natural-language problem description;
- file upload;
- direct object identifier;
- project-scoped context;
- manual engine selection for experts.

The AI Problem Router classifies the request and proposes one or more engines.

Example:

Input:
`Purchase order is created but supplier email is not sent.`

Routing:
- primary: OPD Guard
- secondary: FormDoctor only if form/output artifact evidence indicates it

Input:
`I need supplier VAT number in purchase order PDF.`

Routing:
- FormDoctor
- Custom Field Flow Doctor if the field is not present in standard form data

Input:
`We are moving ECC EHP8 FI/MM/SD to S/4HANA Cloud Public Edition.`

Routing:
- ECC2Cloud
- SPRO2Cloud
- Gap Radar
- Clean Core Guard

## 1.5 Project mode

A project stores stable context such as:

- name;
- customer/organization;
- source ERP/version;
- target ERP/version;
- countries;
- modules;
- cloud/on-prem/private/public target;
- selected SAP release;
- integration landscape;
- uploaded artifacts;
- findings;
- accepted exceptions;
- tests;
- reports;
- release watches.

Example project:

- `ACME S/4HANA Cloud Migration`
- source: ECC EHP8
- target: S/4HANA Cloud Public Edition 2608
- countries: DE, FR
- modules: FI, MM, SD

Then users should not repeatedly re-enter target release or target environment.

## 1.6 Full Project Preflight

Provide an action:

> **Run Full Preflight**

It should orchestrate all relevant engines based on available artifacts and project context.

Output example:

- Objects analyzed: 1,827
- Critical: 31
- High: 74
- Medium: 119
- Passed: 1,603

Categories:
- Migration blockers
- Output problems
- Form/data-path problems
- Unsupported APIs
- Transport dependencies
- Extension dependencies
- Integration coverage gaps
- Operational risks

The user can drill from project summary → engine → finding → evidence → affected objects → suggested action → generated test.

## 1.7 Finding lifecycle

Every finding supports:

- open;
- acknowledged;
- accepted risk;
- false positive;
- resolved;
- regression test created;
- suppressed with expiry;
- assigned owner;
- due date;
- comments;
- attachments.

Persist status history.

## 1.8 Evidence-first experience

Each finding card must clearly show:

- title;
- severity;
- engine;
- status;
- verified/inferred state;
- why it matters;
- exact evidence;
- affected objects;
- target SAP release;
- suggested next action;
- official/reference source if available;
- first detected;
- last evaluated;
- “show only evidence” mode.

## 1.9 Reports

Support:

- project readiness report;
- executive report;
- technical finding report;
- migration blocker report;
- Clean Core report;
- output readiness report;
- integration readiness report;
- transport readiness report;
- audit report.

Export formats:

- PDF
- HTML
- CSV/XLSX where structured data matters
- JSON machine-readable export

Reports must be tenant-branded for Team/Enterprise plans.

## 1.10 Product differentiation

Do not compete by saying “we have AI”.

Differentiate on:

- project memory;
- exact dependency graph;
- release-aware knowledge;
- deterministic engines;
- evidence;
- cross-engine correlation;
- regression tests;
- re-evaluation on future releases;
- ability to work file-first and later connector-first;
- transparent confidence and provenance.

## 1.11 Free acquisition tools

Build lightweight public tools that generate SEO and lead acquisition without exposing the full platform:

- Clean Core Object Lookup
- T-Code / legacy object cloud lookup
- basic Fiori 403 decision tree
- public SAP error/knowledge search
- API deprecation lookup
- basic form/XML field checker

Free tools should lead naturally to:
`Create workspace → run full project analysis`.

Do not allow public tools to leak private customer knowledge.

---

# Part 02 — Brand, UX, Visual Design, Public Website and SEO

## 2.1 Brand

Name: **ERP Preflight**

Primary domain:
`https://erppreflight.com`

Brand promise:
> **Know what will break before production does.**

Alternative marketing line:
> Preflight your ERP changes before they become production incidents.

The product should feel:
- precise;
- calm;
- technical;
- trustworthy;
- enterprise-grade;
- modern;
- fast;
- not flashy;
- not visually derivative of SAP.

## 2.2 Visual system

Create a proprietary visual identity.

Suggested palette:

- Midnight: `#0B1220`
- Deep surface: `#111A2D`
- Primary blue: `#2F6BFF`
- Cyan accent: `#2BB7FF`
- Mint/success accent: `#18C6A3`
- Success: `#16A34A`
- Warning: `#F59E0B`
- Critical: `#E5484D`
- Light background: `#F7F9FC`
- White: `#FFFFFF`
- Muted text: accessible slate tones

Use accessible contrast and verify WCAG AA.

Typography:
- UI: Geist or Inter
- technical/code: JetBrains Mono or a similarly legible monospace

Provide both light and dark mode.

## 2.3 Logo

Create original SVG logo assets:
- full horizontal mark;
- icon-only;
- monochrome;
- dark/light versions;
- favicon.

Visual concept should suggest:
- preflight check;
- dependency graph;
- verification/gate;
- forward motion.

Avoid literal copying of aviation or SAP visual assets.

## 2.4 Product UI

Use a polished design system based on:
- React
- Tailwind CSS
- shadcn/ui or equivalent accessible primitives
- consistent design tokens
- responsive layouts
- keyboard accessibility
- command palette
- tooltips for SAP terminology
- dense/comfortable data table modes

Important UI components:
- severity badges;
- evidence chips;
- dependency graph visualization;
- file drop zones;
- analysis progress stepper;
- project health summary;
- rule diff viewer;
- object inspector;
- finding drawer;
- report preview;
- timeline view;
- test-run console;
- audit timeline;
- admin metric cards.

Never make dashboard screens look like generic template SaaS.

## 2.5 Core homepage

Hero:

**ERP Preflight**

> Know what will break before production does.

Subheadline:
> Validate ERP outputs, extensions, integrations, transports, migrations and operational changes before they fail.

CTAs:
- `Run a Preflight`
- `Explore free tools`

Sections:
1. problem statement;
2. how it works;
3. six solution areas;
4. evidence-backed analysis;
5. project mode;
6. release intelligence;
7. security/privacy;
8. integrations/open standards;
9. pricing;
10. FAQ;
11. final CTA.

## 2.6 Solution pages

Create high-quality pages for:

- `/solutions/output-forms`
- `/solutions/cloud-migration`
- `/solutions/clean-core`
- `/solutions/integration`
- `/solutions/release-transport`
- `/solutions/operations`
- `/solutions/warehouse-automation`

Each page:
- explains the pain;
- shows relevant engines;
- includes examples;
- links to relevant knowledge pages;
- contains strong CTA;
- avoids unverifiable ROI claims.

## 2.7 Internationalization

Launch with:
- English
- German

URL strategy:
- `/en/...`
- `/de/...`

Use proper `hreflang`.

Do not use machine-translated low-quality content for SEO. Translation keys and content workflow must support human review.

## 2.8 SEO architecture

SEO is a first-class product capability.

Create server-rendered/static indexable pages for high-intent problem/object queries.

Examples:

### Output
- `/en/sap/output/purchase-order-email-not-sent`
- `/en/sap/output/opd-no-rule-match`
- `/en/sap/forms/custom-field-not-showing-in-pdf`
- `/en/sap/forms/adobe-form-xml-binding`

### Migration
- `/en/sap/cloud/migration/f-59`
- `/en/sap/cloud/migration/va01`
- `/en/sap/cloud/migration/me21n`

### Clean Core
- `/en/sap/clean-core/mara`
- `/en/sap/clean-core/bseg`
- `/en/sap/clean-core/i-product`

### Integration
- `/en/sap/change-pointers/matmas`
- `/en/sap/api/deprecations/...`

## 2.9 Programmatic SEO quality controls

Never publish thin pages solely because an object exists in the database.

A page is indexable only if it has enough verified information:
- object name/type;
- purpose;
- relevant release;
- status;
- successor/alternative if applicable;
- evidence/source;
- related objects;
- actionable explanation;
- last verified date.

Low-information pages should be `noindex` until enriched.

Generate:
- sitemap indexes split by content type;
- image sitemap when relevant;
- RSS/Atom for release knowledge updates where useful.

## 2.10 Structured data

Use appropriate Schema.org:
- Organization
- SoftwareApplication
- WebApplication
- TechArticle
- FAQPage where content genuinely matches FAQ
- BreadcrumbList

## 2.11 Technical SEO

Implement:
- canonical URLs;
- clean semantic HTML;
- strong Core Web Vitals;
- optimized fonts;
- SSR/SSG where appropriate;
- no blocking client-only content for critical SEO pages;
- robots.txt;
- dynamic sitemap;
- 404/410 handling;
- redirects registry;
- Open Graph/Twitter metadata;
- metadata templates;
- search-friendly internal linking.

## 2.12 Internal linking from the knowledge graph

Object relationships should also power SEO links.

Example:
MARA page links to:
- I_PRODUCT
- Product Master
- ABAP Cloud
- ECC2Cloud
- relevant API pages.

Use related-content modules that are actually graph-derived.

## 2.13 Content system

Provide a content/knowledge publishing workflow:
- draft;
- technical review;
- SEO review;
- publish;
- update required;
- deprecated.

Public pages must show:
- last reviewed;
- target release;
- source provenance.

## 2.14 Analytics

Integrate privacy-aware analytics:
- product events;
- conversion funnel;
- free-tool usage;
- signup;
- activation;
- first analysis;
- report export;
- subscription conversion.

Support PostHog or an abstraction that can use PostHog.

Consent must be respected for non-essential tracking.

## 2.15 Legal/public pages

Include:
- Privacy Policy
- Terms
- Imprint/Impressum
- Cookie settings
- Security page
- Subprocessors page
- DPA request page
- Status page link
- Trademark/independence disclaimer

Use wording indicating the product is independent and not affiliated with or endorsed by SAP SE. Final legal copy can be reviewed later, but the pages, CMS and placeholders must be structurally complete.

---

# Part 03 — Technical Architecture, Stack and Repository Structure

## 3.1 Architecture goals

The architecture must support:
- multi-tenant SaaS;
- large file analyses;
- background workers;
- deterministic engine execution;
- pluggable AI providers;
- pluggable SAP connectors;
- file-first usage;
- optional enterprise local agent;
- versioned SAP knowledge;
- dependency graph;
- release re-evaluation;
- high-quality admin;
- later horizontal scaling.

Avoid premature microservice fragmentation. Build clear module boundaries so services can be extracted later.

## 3.2 Preferred stack

### Frontend
- current stable Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui or equivalent accessible primitives
- TanStack Query where useful
- server components/SSR/SSG used intentionally

### Main backend
- current Node.js LTS
- NestJS
- TypeScript
- REST APIs
- generated OpenAPI documentation
- structured validation

### Analysis
- Python 3 current stable
- FastAPI for analysis service interfaces
- Pydantic
- Polars/Pandas depending workload
- lxml/defusedxml for safe XML work
- dedicated parsers per artifact type

### Persistence
- PostgreSQL as canonical source of truth
- pgvector for semantic retrieval
- Redis for cache, locks and job coordination
- S3-compatible object storage
- OpenSearch for large-scale public/private search when enabled
- optional Neo4j as derived graph projection, never canonical source of truth

### Queues
- BullMQ or equivalent robust Node queue
- Python workers invoked through job contracts
- idempotent job execution

### Infrastructure
- Docker
- Docker Compose for local development
- Terraform for production infrastructure
- Kubernetes/ECS/Container Apps-compatible containers
- Coolify-compatible deployment for early environments

## 3.3 Monorepo

Use pnpm workspaces + Turborepo or Nx. Select one and document the decision.

Recommended structure:

```text
erppreflight/
├─ apps/
│  ├─ web/
│  ├─ api/
│  ├─ admin/
│  ├─ docs/
│  └─ local-agent/
├─ services/
│  ├─ analysis-python/
│  ├─ ai-gateway/
│  ├─ search-indexer/
│  └─ knowledge-sync/
├─ engines/
│  ├─ opd/
│  ├─ forms/
│  ├─ custom-fields/
│  ├─ spro2cloud/
│  ├─ ecc2cloud/
│  ├─ gap-radar/
│  ├─ clean-core/
│  ├─ change-pointer/
│  ├─ api-change/
│  ├─ transport/
│  ├─ extension-impact/
│  ├─ decommission/
│  ├─ fiori403/
│  ├─ workflow/
│  ├─ iam-cost/
│  ├─ account-determination/
│  ├─ system-refresh/
│  └─ mfs/
├─ packages/
│  ├─ ui/
│  ├─ schemas/
│  ├─ database/
│  ├─ auth/
│  ├─ tenancy/
│  ├─ audit/
│  ├─ billing/
│  ├─ evidence/
│  ├─ jobs/
│  ├─ logging/
│  └─ config/
├─ integrations/
│  ├─ rosa/
│  ├─ cloudification/
│  ├─ abaplint/
│  ├─ abapgit/
│  ├─ oasdiff/
│  ├─ odata/
│  ├─ gitleaks/
│  ├─ sap-cloud-sdk/
│  └─ mfs-simulator/
├─ infra/
│  ├─ docker/
│  ├─ terraform/
│  ├─ k8s/
│  └─ monitoring/
└─ docs/
```

## 3.4 Service boundaries

Start with a small number of runtime services:
1. web;
2. API;
3. Node worker;
4. Python analysis service/worker;
5. PostgreSQL;
6. Redis;
7. object storage.

Do not create 30 deployment units simply because there are 18 engines.

Each engine must conform to a common internal contract.

## 3.5 Analysis engine contract

Every engine receives normalized job context:

```json
{
  "tenantId": "...",
  "projectId": "...",
  "analysisId": "...",
  "engine": "...",
  "targetRelease": "2608",
  "artifacts": [],
  "options": {}
}
```

Every engine returns:

```json
{
  "status": "completed",
  "findings": [],
  "metrics": {},
  "evidence": [],
  "artifacts": [],
  "tests": []
}
```

Create strict shared schemas.

## 3.6 Main backend owns business state

Analysis services should not arbitrarily mutate SaaS tables.

Preferred flow:
- worker sends normalized input;
- engine returns typed result;
- backend persists results transactionally.

This keeps tenancy, billing, audit and business invariants centralized.

## 3.7 File pipeline

Uploads must follow:

```text
Upload
→ tenant authorization
→ temporary quarantine
→ MIME/content validation
→ size validation
→ malware scan
→ secret scan
→ optional PII classification
→ checksum
→ encrypted object storage
→ parser
→ normalized artifact
→ analysis
```

Store original and normalized artifact metadata separately.

## 3.8 Async analysis

Never hold a normal HTTP request open for a large analysis.

Flow:
- `POST /analyses`
- return analysis/job id
- queue work
- publish progress
- persist result
- notify frontend via SSE/WebSocket/poll fallback

Frontend progress example:
- Upload validated
- Parsing artifacts
- Building dependency graph
- Running rules
- Matching evidence
- Generating tests
- Finalizing report

## 3.9 AI gateway

All model calls go through a provider abstraction.

Support:
- OpenAI
- Anthropic
- Google
- local/OpenAI-compatible endpoint
- future SAP AI Core adapter

AI gateway functions:
- routing;
- semantic mapping;
- extraction;
- explanation;
- summarization;
- document interpretation;
- translation.

Record:
- model;
- provider;
- tokens;
- latency;
- cost;
- purpose;
- tenant;
- data policy used.

Never call AI directly from browser code.

## 3.10 Search

Support:
- exact object lookup;
- fuzzy object lookup;
- full-text knowledge search;
- semantic search;
- evidence search;
- project-scoped search.

Use PostgreSQL full text + pgvector initially, and OpenSearch when scale justifies it.

## 3.11 Connector abstraction

Define connectors independently from engines:

- file connector;
- OData connector;
- HTTP/OpenAPI connector;
- SAP Public Cloud connector;
- SAP Private/On-Prem connector;
- BTP connector;
- RFC connector through local agent where appropriate;
- Git connector;
- future Cloud Connector adapter.

Engines should consume normalized data, not raw connector-specific protocols.

## 3.12 Local Agent

Build a Docker-packaged local agent for enterprise use.

Responsibilities:
- read-only collection inside customer network;
- local parsing where configured;
- secret redaction;
- optional anonymization;
- outbound-only secure connection;
- signed job instructions;
- tenant/device enrollment;
- automatic update support;
- health reporting.

Allow “analysis stays local” mode later.

## 3.13 API

Use versioned REST APIs:
- `/api/v1/...`

Generate OpenAPI.

Expose webhook events for enterprise automation later.

## 3.14 Idempotency

Uploads, jobs, webhooks and billing events must be idempotent.

Use idempotency keys.

## 3.15 Feature flags

Implement centralized feature flags from early stages:
- by environment;
- plan;
- tenant;
- user percentage;
- beta cohort.

Admin can enable modules without redeploying.

## 3.16 Configuration

Use typed config validation.

No silent fallback for critical secrets.

Provide:
- `.env.example`
- local defaults
- production config docs
- secrets-manager integration guidance.

---

# Part 04 — PostgreSQL Model, Knowledge Graph, Dependency Graph and Release Intelligence

## 4.1 Canonical database

PostgreSQL is the canonical system of record.

Use migrations and explicit constraints.

Every tenant-owned business table must be safely tenant-scoped.

Use PostgreSQL Row Level Security where practical as defense in depth in addition to application authorization.

## 4.2 Core SaaS entities

Implement at minimum:

- users
- identities
- organizations
- organization_members
- roles
- permissions
- plans
- subscriptions
- billing_customers
- usage_events
- usage_limits
- projects
- project_members
- project_environments
- sap_system_profiles
- uploaded_files
- normalized_artifacts
- analyses
- analysis_runs
- findings
- finding_status_history
- finding_comments
- finding_assignments
- evidence_items
- recommendations
- test_cases
- test_runs
- reports
- notifications
- release_watches
- audit_events

## 4.3 Knowledge entities

Represent SAP/ERP knowledge with version-aware records:

- knowledge_objects
- knowledge_object_versions
- object_aliases
- object_relationships
- sap_releases
- product_editions
- application_components
- business_objects
- fields
- cds_views
- APIs
- API_versions
- BAdIs
- business_contexts
- business_scenarios
- SSCUIs
- CBC_activities
- scope_items
- Fiori_apps
- business_catalogs
- IAM_apps
- form_data_sources
- form_templates
- output_types
- change_pointer_message_types
- tables
- function_modules
- BAPIs
- IDoc_types
- transaction_codes
- IMG_activities
- known_gaps
- known_limitations
- deprecations
- successor_mappings
- evidence_sources

Do not force every type into one enormous JSON blob. Use a base object model plus typed extensions.

## 4.4 Relationship graph

Core relationship examples:

- `DEPENDS_ON`
- `USED_BY`
- `EXPOSED_BY`
- `SUCCESSOR_OF`
- `REPLACES`
- `RELATED_TO`
- `MAPPED_TO`
- `EXTENDS`
- `PROPAGATES_TO`
- `CONTROLLED_BY`
- `TRANSPORTED_IN`
- `REQUIRES`
- `BLOCKED_BY`
- `AVAILABLE_IN_RELEASE`
- `DEPRECATED_IN_RELEASE`
- `SUPPORTED_BY`
- `CONSUMES`
- `PRODUCES`

Each edge stores:
- source object;
- target object;
- relationship;
- valid from/to release;
- confidence;
- evidence source;
- reviewed status;
- tenant/global scope;
- created/updated timestamps.

## 4.5 Customer dependency graph

Customer-specific objects are separate from global SAP knowledge.

Examples:
- YY1 custom field;
- Z class;
- custom form;
- software collection;
- custom API;
- job;
- technical user;
- RFC destination.

Customer edge data must never become public/global knowledge automatically.

Provide an explicit anonymized/approved contribution workflow only if desired later.

## 4.6 Graph projection

PostgreSQL remains canonical.

If Neo4j is enabled:
- project selected nodes/edges to Neo4j;
- rebuild projection from canonical data;
- never make Neo4j the only source of truth;
- use it for deep traversal/impact visualization.

## 4.7 Evidence model

Every knowledge fact/finding can have multiple evidence records.

Evidence fields:
- source type;
- source URL/reference;
- source title;
- publisher;
- publication/update date;
- retrieved date;
- target release;
- excerpt hash;
- internal note;
- trust level;
- reviewer;
- status;
- superseded-by.

Trust levels:
- official product metadata/repository
- official product documentation
- official support knowledge
- official community content
- curated internal rule
- third-party reference
- customer evidence
- inferred

The UI must distinguish these.

## 4.8 Release-aware facts

Do not store:
`Object X is supported = true`

Store:
`Object X support state for product/edition/release Y`.

The same requirement may be:
- blocked in 2602;
- supported in 2608.

Create a reusable release comparison service.

## 4.9 Release Watch

Users can watch:
- object;
- requirement;
- finding;
- API;
- successor mapping;
- unsupported gap.

When knowledge sync updates:
- re-evaluate affected watches;
- generate change event;
- notify tenant;
- show “gap closed”, “new deprecation”, “successor changed”, etc.

## 4.10 Finding model

A finding must contain:
- engine;
- code;
- title;
- severity;
- confidence class;
- message;
- technical details;
- affected objects;
- evidence;
- recommendations;
- project context;
- release;
- first seen;
- last evaluated;
- engine version;
- rule version;
- AI explanation model/version if used.

This allows reproducibility.

## 4.11 Suppression and accepted risk

Support suppression:
- permanent;
- until date;
- until release;
- until object changes.

Require a reason and audit it.

## 4.12 Knowledge review workflow

Admin/curators:
- draft knowledge item;
- attach evidence;
- request review;
- approve;
- publish;
- deprecate;
- supersede.

Do not let an unreviewed LLM-generated fact silently enter verified global knowledge.

## 4.13 Search indexing

Create search documents from:
- objects;
- aliases;
- descriptions;
- evidence;
- related business concepts;
- user questions;
- release metadata.

Keep index rebuild scripts deterministic.

## 4.14 Public knowledge pages

Only global reviewed knowledge can generate public SEO pages.

Tenant/customer objects are never public.

---

# Part 05 — Shared Platform Engines

## 5.1 AI Problem Router

Purpose:
convert user intent into one or more engine recommendations.

Input:
- natural-language description;
- current project context;
- artifact metadata;
- optional selected object.

Output:
- suggested engines;
- confidence;
- why;
- additional required inputs.

The router must never fabricate a finding. It only routes.

## 5.2 Evidence Engine

Responsibilities:
- attach provenance;
- verify release alignment;
- rank trust;
- detect stale evidence;
- show conflicting evidence;
- expose “evidence-only” view.

Every user-facing technical verdict should attempt to attach evidence.

## 5.3 Release Intelligence

Responsibilities:
- ingest versioned SAP metadata;
- track deprecations;
- track successors;
- track release availability;
- reevaluate saved findings;
- notify users.

Provide release-diff views.

## 5.4 Dependency Graph Engine

Common graph services:
- direct dependencies;
- transitive dependencies;
- impact radius;
- cycle detection;
- missing dependencies;
- change blast radius;
- release-order derivation;
- edge provenance.

Use it across:
- extension impact;
- transports;
- ECC2Cloud;
- forms;
- APIs;
- decommission;
- MFS where applicable.

## 5.5 Test Lab

Any finding can generate a test.

Test types:
- rule scenario test;
- schema contract test;
- API breaking-change test;
- form XML field test;
- output determination test;
- change pointer test;
- transport dependency test;
- MFS sequence test.

Test case fields:
- preconditions;
- inputs;
- expected outcome;
- source finding;
- engine;
- fixture version;
- target release.

Support:
- manual run;
- batch run;
- scheduled re-run;
- compare baseline;
- export machine-readable fixture.

## 5.6 Full Project Preflight Orchestrator

Given project context and artifacts:
- detect relevant engines;
- build dependency order;
- run safe parallel stages;
- deduplicate correlated findings;
- assign cross-engine root cause where supportable;
- produce unified report.

Example:
FormDoctor says data exists but output not generated.
OPD Guard finds missing recipient rule.
Project report should correlate rather than show two unrelated incidents.

## 5.7 File Ingestion Engine

Supported artifact families:
- CSV
- XLSX
- JSON
- XML
- XSD
- XDP
- YAML
- OpenAPI JSON/YAML
- EDMX
- ZIP
- TXT/log
- abapGit repository export
- ABAP files
- SAP metadata exports
- selected PDFs as supporting documentation

Build parsers with normalized schemas.

Never use OCR unless absolutely required. Prefer machine-readable artifacts.

## 5.8 Secret Sanitization

Detect and redact:
- Authorization headers;
- bearer tokens;
- API keys;
- passwords;
- client secrets;
- cookies;
- private keys;
- common connection strings.

Store redaction metadata so analysis can explain that values were redacted.

## 5.9 Report Engine

Use structured report definitions, not ad-hoc HTML.

Reports include:
- title;
- scope;
- release;
- summary;
- statistics;
- findings;
- evidence;
- remediation;
- tests;
- appendices;
- tool versions.

Generate PDF/HTML/JSON/CSV as appropriate.

## 5.10 Notification Engine

Channels:
- in-app;
- email;
- webhook;
- later Teams/Slack adapters.

Events:
- analysis complete;
- critical finding;
- release watch changed;
- test failed;
- connector unhealthy;
- subscription/usage threshold.

## 5.11 Rules Platform

Rules must be:
- versioned;
- testable;
- reviewable;
- tenant-overridable where safe;
- publishable.

Rule lifecycle:
Draft → Review → Approved → Published → Deprecated.

Never edit active rules without a version.

## 5.12 Engine SDK

Create an internal SDK so new engines can implement:
- metadata;
- input schema;
- supported file types;
- execution;
- finding codes;
- test generation;
- health checks;
- metrics.

This keeps future modules consistent.

---

# Part 06 — Output & Extensibility Suite

## 6.1 OPD Guard / Output Determination Doctor

### Goal
Evaluate output-parameter rules before production and explain why expected output is or is not determined.

### Inputs
Support normalized imports from:
- CSV/XLSX exports;
- JSON;
- manually entered scenario/rules;
- future connector.

Model steps such as:
- Output Type
- Receiver
- Channel
- Printer/Print Queue
- Email Recipient
- Form Template
- Output Relevance

### Core functions
- exact scenario simulation;
- first failed step;
- matched rule;
- rule trace;
- wildcard/blank handling;
- priority/order handling;
- conflicting rules;
- overlapping rules;
- unreachable/shadowed rules;
- missing default;
- incomplete coverage;
- duplicate outcome;
- batch scenario testing;
- before/after rule diff;
- generated regression matrix.

### Example output
For scenario:
- company code 1000
- purchasing org DE01
- purchasing group 001
- supplier 100045

Show:
- Output Type matched row 12
- Receiver matched row 4
- Channel matched row 19 = EMAIL
- Email Recipient = no rule match
- first failed step = Email Recipient
- exact missing condition

### Important
Implement SAP-specific semantics on top of a generic deterministic rules engine. Do not ask an LLM to decide which row wins.

## 6.2 FormDoctor / OutputPath

### Goal
Trace a desired field from business data to output payload to form binding.

### Inputs
- XML
- XSD
- XDP
- metadata
- form-data-source information
- custom field metadata
- user requirement

### Core questions
- Is the field in the business source?
- Is it in the output XML/XSD?
- Is a data-source extension needed?
- Is a custom field needed?
- Is a BAdI needed to populate it?
- Does the XDP bind to the correct path?
- Does the layout hide/format it incorrectly?
- Is the requested behavior unsupported?

### Deterministic checks
- XML node existence;
- XSD path existence;
- namespace resolution;
- XDP binding path resolution;
- mismatched path;
- duplicate bindings;
- data present but bound elsewhere;
- data absent from XML;
- type/format mismatch.

### Output
- data path visualization;
- exact break point;
- supported route;
- evidence;
- action checklist.

## 6.3 Custom Field Flow Doctor

### Goal
Determine whether a custom field can propagate from one business process stage to another.

Example:
Purchase Order Item → Supplier Invoice → Journal Entry → output form.

### Capabilities
- source context;
- target context;
- standard propagation scenario;
- missing propagation;
- relevant BAdI/custom logic requirement;
- API exposure;
- form exposure;
- analytics exposure;
- UI usage;
- known release limitations.

Visualize the flow and mark:
- supported;
- partial;
- custom logic;
- blocked;
- unknown.

## 6.4 Extension Impact Guard

### Goal
Before changing/deleting an extension, show the blast radius.

Objects:
- custom field;
- custom CDS;
- custom logic/BAdI;
- app variant;
- custom API;
- form;
- extension item;
- software collection.

### Output
Direct and indirect consumers:
- forms;
- APIs;
- CDS;
- UI;
- analytics;
- collections;
- business logic;
- integrations.

Actions:
- “Can I delete this?”
- “Can I change type/length?”
- “What must be transported with it?”
- “Which tests must rerun?”

Generate regression test recommendations.

## 6.5 Shared Output Suite UX

A user should be able to move seamlessly:

FormDoctor finding:
`Field exists and binding is correct, but no output document is produced`

CTA:
`Check Output Determination`

OPD Guard:
`Channel is EMAIL but recipient rule does not match`

This cross-engine handoff is mandatory.

## 6.6 Output Suite test fixtures

Create realistic fixtures:
- valid PO output;
- missing email recipient;
- conflicting rules;
- unreachable rule;
- missing XML field;
- wrong XDP binding;
- custom field requiring custom logic;
- unsupported scenario.

Include deterministic expected outcomes.

---

# Part 07 — Migration & Clean Core Suite

## 7.1 SPRO2Cloud

### Goal
Map ECC/S/4 legacy IMG/SPRO configuration to S/4HANA Cloud Public Edition configuration concepts.

Inputs:
- IMG activity id/name;
- SPRO path;
- uploaded inventory;
- source release;
- target release;
- country;
- module.

Output status:
- EXACT
- PARTIAL
- SCOPE_DEPENDENT
- PROCESS_REDESIGN
- NOT_AVAILABLE
- NEEDS_REVIEW

For mapped targets include:
- SSCUI/CBC activity;
- scope item;
- country dependencies;
- relevant catalogs/roles where known;
- evidence;
- release;
- differences from legacy.

Support bulk XLSX/CSV assessment.

## 7.2 ECC2Cloud Navigator

### Goal
Perform broad legacy artifact assessment.

Inputs:
- T-Code usage;
- IMG inventory;
- ABAP source/abapGit;
- tables/fields;
- FMs/BAPIs;
- IDocs;
- custom objects;
- interfaces;
- business requirements.

Outputs:
- directly supported;
- successor available;
- extension required;
- process redesign;
- no equivalent;
- needs review.

Aggregate blockers by:
- module;
- severity;
- object type;
- business process;
- owner.

Do not pretend every legacy object has a 1:1 cloud replacement.

## 7.3 SAP Gap Radar

### Goal
Answer:
“Can the target SAP cloud release do this requirement using a supported approach?”

Input:
natural-language business/technical requirement plus project context.

Resolution pipeline:
1. standard functionality;
2. configuration;
3. key-user extensibility;
4. developer extensibility;
5. released CDS;
6. released API;
7. BAdI/extension point;
8. event;
9. side-by-side extension;
10. supported workaround;
11. known product gap;
12. unknown/review required.

Verdicts:
- SUPPORTED_STANDARD
- SUPPORTED_CONFIGURATION
- SUPPORTED_EXTENSION
- PARTIAL
- WORKAROUND
- BLOCKED
- UNKNOWN

Attach evidence and target release.

Allow:
`Watch this requirement`

Release Intelligence re-evaluates later.

## 7.4 Clean Core Object Guard

### Inputs
- one object;
- object list;
- ABAP code;
- abapGit repo.

### Functions
- released status;
- Clean Core classification;
- successor mapping;
- deprecated object detection;
- unreleased dependency detection;
- code-level usage inventory;
- compliance percentage;
- migration suggestions.

Combine deterministic ABAP parsing with released-object repositories.

## 7.5 ABAP inventory

Use AST/static analysis rather than regex for:
- tables;
- fields;
- classes;
- interfaces;
- FMs;
- methods;
- type references;
- SQL access;
- dynamic calls where detectable.

Flag dynamic/reflection cases as uncertain.

## 7.6 Migration project report

Create:
- executive summary;
- migration blocker count;
- exact mappings;
- partial mappings;
- unknowns;
- unsupported requirements;
- Clean Core risks;
- extensions;
- priority order;
- owner assignment;
- evidence appendix.

## 7.7 Public SEO hooks

Reviewed migration mappings can generate public pages such as:
- T-Code cloud replacement pages;
- Clean Core object pages;
- SPRO/SSCUI knowledge pages.

Never expose customer-specific inventory publicly.

---

# Part 08 — Integration, Release, Transport and Impact Suite

## 8.1 Change Pointer Coverage Auditor

### Goal
Answer not only “which change pointers exist?” but:
“Which business changes are expected to create a pointer, and which of those are not actually covered?”

Inputs:
- message type;
- expected triggering fields;
- BD61/BD50/BD52-style configuration exports;
- change-document metadata where available;
- runtime sample/pointer exports;
- reduced message type configuration;
- distribution data.

Checks:
- global activation;
- message-type activation;
- field coverage;
- change-document eligibility;
- custom field support;
- expected vs observed pointer;
- runtime missing pointer;
- duplicate/retry anomalies.

Output:
coverage matrix with VERIFIED / AT_RISK / NOT_COVERED.

Generate test cases:
“Change field X → expect message type Y pointer”.

## 8.2 API Change Guard

### Goal
Compare API/contract versions and show breaking impact for saved integrations.

Inputs:
- OpenAPI 2/3 JSON/YAML;
- OData EDMX metadata;
- normalized API snapshots;
- project field/operation usage.

Checks:
- removed endpoint;
- removed field;
- required/optional changes;
- type changes;
- length/enum changes;
- renamed navigation/property;
- changed operation;
- deprecation;
- successor API;
- coverage gaps.

Output:
- breaking/non-breaking changes;
- affected project mappings;
- migration readiness percentage;
- exact affected tests;
- successor guidance.

Support baseline snapshots and release watches.

## 8.3 Software Collection Dependency Guard

### Goal
Preflight key-user/public-cloud collection dependencies before export/import.

Analyze:
- custom fields;
- CDS;
- forms;
- app variants;
- custom logic;
- APIs;
- collection relationships;
- prerequisite artifacts.

Output:
- missing dependency;
- cross-collection dependency;
- circular dependency;
- wrong order;
- unresolved object;
- suggested grouping;
- recommended import/release order.

## 8.4 Transport Dependency Analyzer

Support classic/private/on-prem and cloud-aware transport concepts through adapters.

Analyze:
- object conflicts;
- inheritance/implementation;
- type references;
- function calls;
- same object in multiple tasks/TRs;
- release order;
- missing prerequisites.

Output graph + recommended release sequence.

## 8.5 Extension Impact Guard reuse

Transport/release suite must reuse Extension Impact edges.

If a collection contains a form that uses a custom field in another collection, the system should detect it from the common dependency graph.

## 8.6 API/project integration registry

Projects can register an integration:
- source;
- target;
- APIs;
- endpoints;
- fields consumed;
- operations used;
- auth type;
- owner;
- criticality.

API Change Guard uses this registry to report real impact rather than generic diffs.

## 8.7 Release gate

Provide project-level status:

- CLEAR
- CLEAR_WITH_WARNINGS
- BLOCKED

A release gate can consider:
- open critical findings;
- failed regression tests;
- missing transport dependencies;
- breaking API changes.

Do not automatically deploy to SAP; this is a validation gate unless a future explicit deployment integration is configured.

---

# Part 09 — Operations, IAM, Troubleshooting and Warehouse Specialist Suite

## 9.1 Safe Decommission Preflight

### Goal
Before locking/deleting a user, technical user, RFC destination, job identity or service account, identify what can break.

Analyze where data is available:
- background jobs;
- job steps;
- RFC destinations;
- workflows/work items;
- interfaces;
- scheduled integrations;
- technical ownership;
- last activity;
- roles.

Output:
- risk;
- direct dependencies;
- last observed usage;
- reassignment checklist;
- re-run preflight after remediation.

Support file-based inventory first and connector-based collection later.

## 9.2 Fiori 403 Root-Cause Doctor

Inputs may include:
- HTTP response;
- `/IWFND/ERROR_LOG` export;
- SU53 trace;
- ICF service state;
- Gateway logs;
- UCON information;
- CSRF request details;
- BTP destination;
- Cloud Connector status;
- browser/network export.

Decision tree/rules:
- authorization;
- ICF inactive;
- OData activation;
- UCON blocked;
- CSRF/auth;
- destination;
- Cloud Connector;
- session/browser issue;
- unknown.

Output:
- likely root area;
- evidence;
- next diagnostic action;
- what data is missing.

Never present a guess as proven.

## 9.3 Workflow Stuck Explainer

Inputs:
- workflow/work item export;
- error text;
- agent resolution data;
- event trace;
- container data where safe.

Functions:
- stuck step;
- no agent;
- failed task;
- missing event;
- dead-end;
- overdue;
- restart candidate;
- manual intervention candidate.

Output safe diagnostics. Do not auto-cancel/forward without a future explicit privileged connector and user confirmation.

## 9.4 IAM Cost Optimizer

Purpose:
model authorization design and cost/privilege impact.

Inputs:
- business roles;
- catalogs;
- IAM apps;
- actual usage where available;
- price-category metadata/configuration supplied by customer/knowledge;
- read-only alternatives.

Functions:
- least-privilege suggestions;
- redundant catalogs;
- unused role content;
- alternative role composition;
- modeled price-category impact;
- role-risk comparison.

Clearly label cost estimates and assumptions. Do not present contract/licensing interpretation as legal fact.

## 9.5 Account Determination Preflight

Do not duplicate standard one-document analysis only.

Focus on **bulk coverage before go-live/change**.

Inputs:
- valuation classes;
- movement types;
- account modifiers;
- plants/company codes;
- relevant config combinations;
- expected account rules.

Output:
- combinations with no account;
- conflicting combinations;
- suspicious catch-all/default;
- coverage matrix;
- regression scenarios.

Support SD/FI/MM variants through separate rule models.

## 9.6 System Refresh Delta Guard

Purpose:
compare system-specific configuration before and after refresh/copy.

Track examples:
- RFC destinations;
- logical systems;
- printers;
- jobs;
- endpoints;
- email settings;
- integration destinations;
- environment-specific URLs;
- queues;
- selected custom config.

Flow:
1. capture baseline;
2. capture post-refresh;
3. compare;
4. apply allow/ignore policy;
5. generate repair checklist.

Do not attempt destructive automatic repair by default.

## 9.7 MFS BlackBox

### Goal
Analyze SAP EWM/MFS incident logs and identify the first causal divergence, not only the final visible error.

Inputs:
- CSV/XLSX/TXT MFS logs;
- optional telegram specification;
- route/communication-point model;
- optional simulator fixture.

Core:
- parse telegrams;
- reconstruct HU/WT state;
- ACK/retry timing;
- sequence handling;
- source/destination;
- communication point;
- channel;
- PLC;
- life telegram;
- missing completion;
- impossible jump;
- duplicate;
- out-of-order;
- wrong confirmation;
- retry storm.

### Key result
- visible failure;
- first divergence;
- root event;
- subsequent consequences;
- evidence chain.

### Advanced
- incident clustering;
- fingerprint recurrence;
- minimal reproduction;
- regression test generation;
- before/after PLC software-release behavior.

The AI can explain the result but does not determine the state-machine violation.

## 9.8 MFS simulator integration

Keep simulator integration behind an adapter.

Support:
- export reproduction scenario;
- invoke compatible external simulator when configured;
- import simulator result.

Do not tightly couple the platform’s entire architecture to one simulator implementation.

---

# Part 10 — SaaS, Admin Console, Billing, Security, Compliance and Customer Management

## 10.1 Multi-tenancy

Organization-based tenancy.

Roles:
- Platform Owner
- Platform Admin
- Organization Owner
- Organization Admin
- Project Manager
- Architect
- Consultant
- Developer
- Reviewer
- Viewer
- Billing Admin
- Security Admin

Implement granular permissions, not only role-name checks.

## 10.2 Authentication

Support:
- email/password with strong hashing;
- magic link;
- OAuth/OIDC providers;
- TOTP 2FA;
- recovery codes;
- session/device management.

Enterprise:
- SAML/OIDC SSO;
- SCIM provisioning;
- enforce MFA;
- IP allowlists where applicable.

Abstract identity provider to avoid hard lock-in.

## 10.3 Plans

Create configurable plans:
- Free
- Pro
- Consultant
- Team
- Enterprise

Feature/limit examples:
- analyses/month;
- project count;
- storage;
- file size;
- AI credits;
- team members;
- report branding;
- release watches;
- connectors;
- local agent;
- SSO/SCIM;
- retention;
- private AI.

Plan definitions must be admin-configurable.

## 10.4 Billing

Integrate Stripe behind a billing provider abstraction.

Implement:
- checkout;
- customer portal;
- subscriptions;
- upgrades/downgrades;
- trials;
- coupons;
- credits;
- invoices;
- failed-payment handling;
- webhooks;
- idempotency;
- tax metadata.

Maintain internal entitlement state derived from verified billing events.

## 10.5 Usage metering

Meter:
- analyses;
- engine runs;
- AI tokens/cost;
- storage;
- API calls;
- connector activity;
- report generation;
- large-log processing.

Show usage to user and admin.

## 10.6 Super Admin dashboard

Provide operational and business overview:
- MRR;
- ARR;
- trials;
- conversion;
- churn;
- active orgs;
- active users;
- analyses/day;
- storage;
- AI spend;
- infrastructure cost;
- gross margin estimate;
- error rate;
- queue depth;
- source sync freshness.

## 10.7 Organization admin

Platform admins can:
- inspect organization;
- suspend/reactivate;
- change plan;
- extend trial;
- grant credits;
- adjust limits;
- manage feature flags;
- view usage;
- view billing state;
- view support history.

## 10.8 Safe impersonation

Admin impersonation:
- requires privileged permission;
- requires reason;
- banner during session;
- fully audited;
- cannot access decrypted secrets unnecessarily.

## 10.9 Knowledge Admin

Screens for:
- object records;
- mappings;
- sources;
- evidence;
- release validity;
- last verification;
- conflicts;
- review queue;
- publish/deprecate.

## 10.10 Rule Admin

Manage:
- engine;
- rule id;
- version;
- status;
- tests;
- coverage;
- author;
- reviewer.

Publishing requires tests to pass.

## 10.11 AI Admin

Configure per task:
- primary model;
- fallback;
- max tokens;
- temperature where applicable;
- provider;
- privacy mode;
- cost ceiling.

Global kill switch per provider.

## 10.12 Source Sync Admin

Manage:
- source adapters;
- last sync;
- freshness;
- errors;
- item counts;
- changed records;
- retry.

Alert if a critical knowledge source becomes stale.

## 10.13 OSS / Third-party Admin

Maintain:
- dependency;
- version;
- repository;
- license identifier;
- attribution;
- modified/not modified;
- update available;
- security advisory;
- deployment mode.

Generate SBOM and third-party notices.

Do not let licensing questions block implementation; maintain accurate inventory so commercial/legal review is straightforward.

## 10.14 Support console

Ticket contains:
- org;
- project;
- engine;
- finding;
- analysis run;
- engine version;
- rule version;
- sanitized input metadata;
- logs;
- user report.

Allow “report incorrect result” from finding UI.

## 10.15 Audit logs

Audit:
- login/security event;
- file upload/download/delete;
- rule/knowledge edits;
- admin actions;
- impersonation;
- connector creation;
- billing overrides;
- report export;
- secret changes;
- permission changes.

Audit records should be tamper-evident and immutable from normal application roles.

## 10.16 File retention

Tenant-configurable:
- delete immediately after analysis;
- 24 hours;
- 7 days;
- 30 days;
- enterprise custom.

Knowledge derived from files must respect deletion policy and privacy mode.

## 10.17 Encryption and secrets

- TLS everywhere;
- encrypted storage;
- encrypted secrets;
- KMS/provider abstraction;
- rotate credentials;
- no secrets in logs;
- no secrets in Git.

## 10.18 Security pipeline

Upload:
- MIME sniff;
- archive bomb protection;
- malware scan;
- secret scan;
- XML entity protection;
- path traversal protection;
- file-size limits;
- zip nesting limits.

App:
- CSP;
- CSRF protection;
- rate limiting;
- brute-force protection;
- secure cookies;
- CORS policy;
- tenant boundary tests.

## 10.19 Privacy/GDPR

Implement:
- consent controls;
- data export request flow;
- account deletion request;
- organization retention policy;
- subprocessors registry;
- DPA workflow placeholder;
- EU-friendly data-region abstraction.

## 10.20 Enterprise security page

Provide public `/security` with:
- encryption;
- privacy;
- tenant isolation;
- backups;
- responsible disclosure;
- subprocessor link;
- contact.

Do not claim certifications not actually obtained.

---

# Part 11 — Open Source Integrations, Adapters and Connector Strategy

The platform should actively reuse strong open-source foundations instead of rebuilding generic infrastructure.

Keep each integration behind an adapter.

## 11.1 ROSA

Repository:
`ClementRingot/ROSA`

Use for:
- released SAP object lookup;
- Clean Core classification;
- successor lookup;
- compliance checks.

Integrate via:
- package/API/MCP adapter as appropriate;
- cache normalized results;
- store source/version provenance.

Do not make the rest of the product depend directly on ROSA response shapes.

## 11.2 SAP Cloudification Repository

Repository:
`SAP/abap-atc-cr-cv-s4hc`

Use as official versioned source for:
- released APIs;
- unreleased objects;
- successors;
- Clean Core classifications.

Build scheduled ingestion:
- fetch;
- checksum;
- parse;
- diff;
- persist version;
- trigger impacted release watches.

## 11.3 abaplint

Repository:
`abaplint/abaplint`

Use for:
- ABAP syntax/AST;
- code inventory;
- dependency extraction;
- table/field/class/FM references where supported.

Pin known-good versions and create compatibility tests.

## 11.4 abapGit

Repository:
`abapGit/abapGit`

Use understanding/file conventions to ingest exported ABAP repositories.

Do not require customers to run abapGit if they provide equivalent supported files.

## 11.5 SAP ABAP File Formats

Repositories:
- `SAP/abap-file-formats`
- `SAP/abap-file-formats-tools`

Use for standardized object-file representations and schemas where applicable.

## 11.6 Transport Dependency Analyzer

Repository:
`Mayur175/tr-dependency-analyser-v2`

Use/adapt:
- dependency extraction concepts;
- cross-TR conflicts;
- release-order logic.

Wrap in a platform-specific adapter and test against fixtures.

## 11.7 oasdiff

Repository:
`oasdiff/oasdiff`

Use in API Change Guard:
- breaking changes;
- contract diffs;
- OpenAPI comparison.

Normalize output to ERP Preflight finding codes.

## 11.8 SAP OData parser

Repository:
`ChrisWhealy/parse-sap-odata`

Evaluate for EDMX/OData V2 parsing support.

If Rust integration is inconvenient, either expose it as a small service or implement a compatible safe parser while preserving the same normalized schema.

## 11.9 json-rules-engine

Repository:
`CacheControl/json-rules-engine`

Use as a deterministic foundation for OPD rules where semantics fit.

Build SAP-specific rule normalization on top.

## 11.10 SAP Cloud SDK

Repository:
`SAP/cloud-sdk-js`

Use in future read-only SAP connectivity:
- destinations;
- HTTP;
- OData;
- resilience.

Keep connection credentials inside secure connector/local-agent architecture.

## 11.11 Gitleaks

Repository:
`gitleaks/gitleaks`

Use in file ingestion to detect secrets.

Normalize findings:
- detected secret type;
- location;
- redacted replacement;
- whether analysis can continue.

## 11.12 MFS PLC simulator

Repository:
`dominik-tylczynski/mfs-plc-sim`

Use as:
- protocol behavior reference;
- external simulator integration target;
- optional isolated component depending deployment/legal decision.

Keep it isolated behind `MfsSimulatorAdapter`.

## 11.13 Additional infrastructure OSS

Evaluate and use strong maintained projects where helpful:
- OpenTelemetry
- Prometheus
- Grafana
- ClamAV
- Trivy
- Syft/CycloneDX for SBOM
- MinIO for local S3-compatible storage
- Keycloak/Zitadel or standards-compatible identity components if selected
- PostHog for product analytics

Do not add dependencies only for fashion. Every dependency needs an owner, version policy and security update path.

## 11.14 Adapter conventions

Each external dependency integration should have:
- interface;
- adapter;
- version;
- health check;
- timeout;
- retry policy;
- circuit breaker where relevant;
- structured error;
- metrics;
- test fixture;
- fallback behavior.

## 11.15 Third-party update automation

Create scheduled dependency update workflow:
- detect release;
- run compatibility tests;
- open automated PR;
- require CI pass;
- update notices/SBOM.

Do not auto-deploy major-version dependency upgrades to production.

---

# Part 12 — Testing, QA, CI/CD, Observability and Production Operations

## 12.1 Testing pyramid

### Unit
- parsers;
- rules;
- graph functions;
- billing calculations;
- permissions;
- redaction;
- normalization.

### Contract tests
- engine contracts;
- external OSS adapter output;
- connector interfaces;
- AI gateway schemas.

### Integration
- PostgreSQL;
- Redis;
- object storage;
- queue;
- API;
- knowledge ingestion.

### End-to-end
Critical flows:
- signup;
- create org;
- create project;
- upload;
- run analysis;
- see finding/evidence;
- generate test;
- export report;
- subscription;
- admin review.

Use Playwright for browser E2E.

## 12.2 Golden fixtures

Each engine needs versioned golden test fixtures.

Examples:
OPD:
- valid;
- no recipient;
- overlap;
- unreachable;
- default rule.

Forms:
- field in XML and correctly bound;
- in XML but wrong binding;
- missing from XML;
- namespace issue.

SPRO2Cloud:
- exact mapping;
- partial;
- unsupported;
- unknown.

Clean Core:
- released;
- successor;
- no successor;
- mixed repo.

Change Pointer:
- covered;
- configured but no runtime;
- custom field missing.

API:
- non-breaking addition;
- required field added;
- type changed;
- endpoint removed.

MFS:
- normal;
- missing ACK;
- duplicate;
- wrong CP;
- out of order;
- retry storm.

## 12.3 AI evaluation

LLM-assisted tasks need evaluation datasets.

Track:
- routing accuracy;
- extraction accuracy;
- explanation factuality;
- unsupported claims.

The deterministic finding remains source of truth.

## 12.4 CI

GitHub Actions:
- install;
- lint;
- type check;
- unit test;
- integration test;
- Python lint/type/test;
- DB migration check;
- OpenAPI compatibility;
- dependency vulnerability scan;
- secret scan;
- container scan;
- build;
- E2E smoke where feasible.

Block merge on failures.

## 12.5 Preview environments

Create per-PR preview for web/API when infrastructure permits.

Use sanitized test data only.

## 12.6 Database migrations

- forward migrations;
- migration tests;
- backup before risky production migration;
- no manual schema drift.

## 12.7 Backups

Document and automate:
- PostgreSQL backups;
- point-in-time recovery target;
- object-storage versioning;
- configuration backup.

Run restore drills.

## 12.8 Observability

Use OpenTelemetry.

Collect:
- traces;
- metrics;
- structured logs.

Dashboards:
- API latency;
- engine duration;
- queue lag;
- job failures;
- DB pool;
- Redis;
- storage;
- search;
- AI provider latency/cost;
- connector health;
- source sync freshness.

## 12.9 Sentry/error tracking

Integrate frontend/backend error tracking with:
- release;
- environment;
- tenant-safe identifiers;
- no raw private payloads.

## 12.10 Health endpoints

Provide:
- liveness;
- readiness;
- dependency health;
- knowledge source freshness;
- worker health.

## 12.11 Runbooks

Write runbooks for:
- database outage;
- queue stuck;
- AI provider outage;
- object storage outage;
- source sync failure;
- connector compromise;
- billing webhook failure;
- leaked secret;
- corrupted knowledge import.

## 12.12 Performance

Targets should be measured, not guessed.

Implement load tests for:
- concurrent project dashboards;
- large OPD scenario batches;
- API diff;
- ABAP inventory;
- large MFS logs.

Use streaming/chunked parsers where necessary.

## 12.13 Large file strategy

Never load multi-GB logs fully into memory.

Use:
- streaming;
- chunking;
- columnar processing;
- temporary files;
- bounded memory.

## 12.14 Reliability

Background jobs:
- idempotent;
- retryable;
- dead-letter queue;
- timeout;
- cancellation;
- progress.

## 12.15 Security CI

Run:
- Gitleaks;
- dependency audit;
- Trivy/container scan;
- SAST where useful;
- SBOM generation.

## 12.16 Release process

Environments:
- local;
- dev;
- staging;
- production.

Production releases:
- tagged;
- changelog;
- database migration plan;
- rollback plan;
- smoke test;
- health verification.

## 12.17 Status page

Provide public operational status endpoint/page.

Do not expose sensitive internal details.

---

# Part 13 — Delivery Plan, Team Workstreams, Milestones and Definition of Done

The owner has stated that a large team can work in parallel. Structure the project accordingly, but maintain shared architecture and integration gates.

## 13.1 Workstreams

### Squad A — Platform/SaaS
- auth;
- tenancy;
- projects;
- billing;
- reports;
- usage;
- admin.

### Squad B — Output
- OPD Guard;
- FormDoctor;
- Custom Field Flow;
- Extension Impact.

### Squad C — Migration
- SPRO2Cloud;
- ECC2Cloud;
- Gap Radar;
- Clean Core Guard.

### Squad D — Integration/Release
- Change Pointer;
- API Change;
- Software Collection;
- Transport dependencies.

### Squad E — Operations
- Safe Decommission;
- Fiori 403;
- Workflow;
- IAM;
- Account Determination;
- Refresh.

### Squad F — MFS
- parsing;
- state model;
- causal replay;
- reproduction;
- test generation.

### Squad G — Knowledge/Data
- Cloudification;
- ROSA;
- release model;
- evidence;
- knowledge curation;
- SEO knowledge pages.

### Squad H — Infrastructure/Security
- deployment;
- CI/CD;
- monitoring;
- backups;
- local agent;
- secret management.

## 13.2 Milestone 1 — Foundation

Deliver:
- monorepo;
- design system;
- auth;
- organizations;
- projects;
- PostgreSQL;
- Redis;
- storage;
- queues;
- admin shell;
- public site;
- i18n EN/DE;
- CI;
- observability;
- file pipeline.

Exit criteria:
all foundation tests green and local environment reproducible.

## 13.3 Milestone 2 — Shared intelligence

Deliver:
- engine SDK;
- evidence engine;
- dependency graph;
- knowledge graph;
- release intelligence;
- AI router;
- test lab.

Exit:
a demo engine can run end-to-end and produce a versioned finding with evidence and test.

## 13.4 Milestone 3 — Output Suite

Deliver full working:
- OPD Guard;
- FormDoctor;
- Custom Field Flow;
- Extension Impact.

Exit:
golden fixtures pass and cross-engine handoff works.

## 13.5 Milestone 4 — Migration Suite

Deliver:
- SPRO2Cloud;
- ECC2Cloud;
- Gap Radar;
- Clean Core Guard;
- ROSA/Cloudification ingestion;
- ABAP inventory.

## 13.6 Milestone 5 — Integration/Release

Deliver:
- Change Pointer;
- API Change;
- Transport/Software Collection;
- project release gate.

## 13.7 Milestone 6 — Operations/MFS

Deliver remaining modules with real fixture-based logic, not empty screens.

## 13.8 Milestone 7 — Commercial readiness

Deliver:
- Stripe;
- plan enforcement;
- pricing page;
- trials;
- email;
- admin analytics;
- support flow;
- security pages;
- audit;
- retention;
- feature flags;
- legal pages;
- SEO content engine.

## 13.9 Milestone 8 — Production hardening

- load tests;
- restore drill;
- penetration/security review checklist;
- accessibility audit;
- SEO crawl;
- Lighthouse/Core Web Vitals;
- dependency/SBOM review;
- error-budget dashboards;
- runbooks.

## 13.10 Definition of Done per engine

An engine is “done” only if:
1. documented purpose;
2. input schema;
3. parser/normalizer;
4. real deterministic logic;
5. finding codes;
6. evidence support;
7. fixtures;
8. unit tests;
9. integration test;
10. UI;
11. project integration;
12. report integration;
13. usage metering;
14. audit event;
15. admin visibility;
16. error handling;
17. localization;
18. docs.

## 13.11 Definition of Done for public launch

Must have:
- no broken core navigation;
- no dead primary CTA;
- no placeholder pricing;
- no unauthenticated data leak;
- no cross-tenant access;
- no public indexation of private routes;
- no critical failing test;
- working backups;
- working password/2FA flows;
- working email verification;
- working billing lifecycle;
- working cancel/export/delete account flows;
- valid sitemap/robots/canonicals;
- real SEO pages;
- working analytics consent;
- production health check;
- admin incident visibility.

## 13.12 Final handover from Astra

At the end produce:

1. `FINAL_IMPLEMENTATION_REPORT.md`
2. `DEPLOYMENT_GUIDE.md`
3. `ADMIN_GUIDE.md`
4. `USER_GUIDE.md`
5. `ENGINE_CATALOG.md`
6. `SECURITY_REVIEW.md`
7. `THIRD_PARTY_NOTICES.md`
8. `KNOWN_LIMITATIONS.md`
9. `GO_LIVE_CHECKLIST.md`
10. `ROADMAP_AFTER_V1.md`

The final report must include exact commands run and test results.

## 13.13 Final instruction to the coding agent

Do not optimize for appearing finished.

Optimize for:
- correctness;
- maintainability;
- evidence;
- coherent product UX;
- useful analysis;
- measurable quality;
- robust operations.

When you encounter ambiguity, prefer the architecture principles in this specification:
- deterministic before AI;
- evidence before assertion;
- project context over stateless chat;
- one shared graph over siloed tools;
- one coherent platform over unrelated utilities;
- secure multi-tenancy by default.

Continue until the repository contains a working end-to-end implementation and all feasible acceptance criteria have been verified.

---
