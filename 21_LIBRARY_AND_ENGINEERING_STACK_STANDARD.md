# Part 21 — Frontend, Backend and Engineering Library Standard

This part is binding and extends Parts 00–20.

The goal is not to install every popular package. ERP Preflight must use a **curated, non-overlapping library stack**. Prefer one strong library per concern. Every dependency must have a purpose.

Use current stable releases at implementation time unless a compatibility reason requires a pinned older version.

## 21.1 UI Foundation Decision

Use:
- Next.js
- React
- TypeScript strict mode
- Tailwind CSS
- shadcn/ui as the product component layer
- Base UI as the preferred headless primitive foundation for new shadcn components

Do not mix Base UI, Radix UI and Ark UI across the product without a documented exception.

Existing/third-party components using Radix may be accepted where migration provides no value, but the design system must expose one consistent ERP Preflight component API.

## 21.2 Design System Packages

Use/evaluate:
- class-variance-authority
- clsx
- tailwind-merge
- Lucide icons
- Motion (`motion/react`) for intentional micro-interactions only

Animation rules:
- accessibility first
- respect `prefers-reduced-motion`
- no excessive dashboard animation
- use CSS transitions for simple effects
- use Motion only when state/layout transitions materially improve usability

## 21.3 TanStack Stack

Use TanStack selectively.

### TanStack Query
For server state, caching, invalidation, mutations and background refresh.
Do not use it as a global client-state store.

### TanStack Table
For findings, SAP object inventories, migration inventories, admin tables, transport/API matrices.

### TanStack Virtual
For very large lists/tables such as SAP object catalogs, MFS event lists and findings.

### TanStack Form
Preferred complex form engine.
Do not add React Hook Form as a second default form framework unless a specific integration forces it.

### TanStack Pacer
Use for debounced global search, high-frequency filters and throttled UI interactions.

## 21.4 Schema Validation

Use **Zod 4** as the primary TypeScript runtime schema system.

Use it for:
- API boundaries
- environment configuration
- form schemas
- internal command schemas
- AI structured-output schemas
- event schemas where appropriate

Generate/reuse JSON Schema when useful.
Avoid duplicating validation in multiple incompatible systems.

## 21.5 API Client Generation

Backend OpenAPI is the contract.

Use **Orval** or a similarly mature generator to generate:
- TypeScript models
- typed API clients
- TanStack Query hooks where useful
- MSW-compatible mocks where useful

Do not hand-maintain duplicate frontend DTO interfaces that can drift from OpenAPI.
Generated code lives in a clearly marked generated package and is not manually edited.

## 21.6 Dependency Graph Visualization

Use **@xyflow/react (React Flow)** for interactive dependency/traceability/change graphs.

Use cases:
- dependency graph
- requirement → finding → task → test traceability
- custom field propagation
- transport relationships
- API relationships
- MFS causal flow
- what-if change visualization

Provide:
- zoom
- pan
- minimap
- keyboard navigation
- node filtering
- edge filtering
- selected-object inspector
- accessible table fallback

Do not use the graph canvas as the only way to access important data.

## 21.7 Automatic Graph Layout

Use **ELK.js** for deterministic automatic layouts, especially layered/directed dependency graphs.

Support:
- left-to-right
- top-to-bottom
- hierarchical dependencies
- ports/handles where useful

Keep layout computation separable from graph rendering.
For huge graphs, calculate layout in a Web Worker or server-side worker rather than blocking the main UI thread.

## 21.8 Charts and Analytics

Use **Apache ECharts** for advanced product/data visualizations.

Use cases:
- project readiness
- findings over time
- migration classification
- Clean Core distribution
- engine quality
- MFS latency/time series
- cost/usage analytics
- admin SaaS metrics

Import only required ECharts modules to control bundle size.
Do not use ECharts for simple numbers/cards where normal HTML is more accessible.
All charts require accessible textual/table alternatives.

## 21.9 Technical Editors and Diff Views

Use **Monaco Editor** for desktop technical workspaces that require:
- JSON/YAML/OpenAPI editing
- XML inspection
- code/diff views
- rule editing
- large technical text
- side-by-side diffs

Use Monaco's Diff Editor for API before/after, rule changes, normalized artifact differences and ChangeSet previews.
Lazy-load Monaco; do not add it to the initial page bundle.
For lightweight/mobile text editing, use normal textarea or a lighter editor rather than forcing Monaco everywhere.

## 21.10 Drag and Drop

Use current **dnd-kit** packages for dashboard/widget reorder, mapping UI, prioritized checklists and controlled workflow designers where required.

Do not use drag/drop as the only way to perform an action; provide accessible alternatives.

## 21.11 Internationalization

Use **next-intl** or a comparably mature App Router-compatible i18n solution.

Requirements:
- EN/DE at launch
- ICU messages
- localized dates/numbers
- locale routing
- hreflang
- translation namespaces
- canonical SAP technical names remain unchanged
- human-review workflow for SEO content

## 21.12 Date and Time

Use native Temporal API when broadly supported in the chosen runtime, or a documented polyfill strategy, and `date-fns` for lightweight utilities where needed.

Store canonical timestamps in UTC.
Display in user/org timezone.
Preserve original SAP source timezone/context where available.

## 21.13 Notifications / Toasts

Use the shadcn-supported toast layer behind an internal notification component.
Do not call a third-party toast API directly throughout feature code.
Critical findings remain visible in persistent UI rather than only toast notifications.

## 21.14 Command Palette

Provide a global command palette (`Cmd/Ctrl + K`) using the selected design-system primitives.

Commands:
- find project
- find object
- run engine
- navigate
- create project
- open finding
- open admin area when authorized

Search logic remains ERP Preflight-owned.

## 21.15 State Management

Priority:
1. server state → TanStack Query
2. URL/search/filter state → URL params / typed URL-state helpers
3. local component state → React
4. complex client workflow state → small scoped store such as Zustand only when justified

Do not introduce Redux globally unless a demonstrated need exists.

## 21.16 Frontend Accessibility Testing

Use axe-core / Playwright accessibility checks plus semantic HTML and keyboard tests.

Add CI tests for key pages:
- login
- project
- analysis result
- dependency graph controls
- dialogs/forms
- admin

## 21.17 Component Development Environment

Use **Storybook** or an equivalent isolated component workbench for the design system, states, accessibility, visual regression and documentation.

At minimum include stories for:
- buttons
- dialogs
- finding cards
- evidence blocks
- tables
- graph nodes
- upload states
- analysis progress
- empty/error states

## 21.18 Backend HTTP Framework

Keep NestJS as the main backend application framework.
Prefer NestJS Fastify adapter if compatibility is verified and it reduces overhead.
Do not introduce Fastify as a second independent business backend.

## 21.19 ORM and SQL

Use **Drizzle ORM + PostgreSQL**.

Rules:
- SQL remains visible/understandable
- migrations committed
- transaction boundaries explicit
- no N+1 query patterns
- indexes measured
- raw SQL allowed for advanced PostgreSQL features

Do not introduce Prisma alongside Drizzle.

## 21.20 Authorization Policy Engine

Authentication and authorization are separate.

Use/evaluate **Cerbos** for fine-grained contextual authorization when policy complexity justifies it.

Suitable concerns:
- tenant/resource/action permissions
- environment restrictions
- support-access grants
- agent policies
- production write gates
- ABAC conditions

Policies are deny-by-default.
If Cerbos is adopted, keep application permission names canonical and test policy changes.
Do not duplicate the same authorization rules independently in controllers, UI and Cerbos.

## 21.21 Authentication

Use a provider abstraction.

Recommended strategy:
- Better Auth can provide core authentication and standards-oriented capabilities
- enterprise SSO/SCIM can be implemented through Better Auth plugins or a WorkOS adapter depending product/commercial requirements

Do not tightly couple domain data models to one auth vendor.

## 21.22 Background Jobs

Use **BullMQ** for:
- simple async jobs
- notifications
- report generation
- short analysis jobs
- indexing
- standard scheduled work

Use Redis-backed queues with retries, exponential backoff, dead-letter handling, job IDs/idempotency and tenant-aware concurrency.

## 21.23 Durable Orchestration

Use/evaluate **Temporal** for critical long-running workflows:
- Full Project Preflight
- connector collection + analysis + sync
- Cloud ALM synchronization
- ChangeSet simulation/approval/execution
- release re-evaluation
- large multi-stage analyses

Do not use Temporal for every trivial background task.

## 21.24 Logging

Use **Pino** (and `nestjs-pino` where appropriate) for structured server logs.

Log:
- timestamp
- level
- service
- correlation ID
- tenant-safe ID
- analysis/job ID
- error code

Never log raw secrets or private artifacts.

## 21.25 Telemetry

Use **OpenTelemetry** as the vendor-neutral instrumentation standard.

Instrument HTTP, DB, queues, workers, AI gateway, connectors, knowledge sync and analyses.

## 21.26 Error Tracking

Use Sentry or an interchangeable error-tracking adapter.
Attach release, environment, trace/correlation ID and safe tenant identifier.
Strip sensitive payloads.

## 21.27 Product Analytics and Feature Flags

Use PostHog or a provider abstraction for product analytics, funnels, retention, feature flags and experiments.
Do not send customer SAP artifacts/findings as analytics properties.

## 21.28 JSON Schema

Use **Ajv** where high-performance JSON Schema validation is needed, especially for plugin manifests, imported JSON schemas, engine contract JSON Schema and externally supplied JSON documents.

Use Zod for application TypeScript schemas and Ajv for JSON Schema-native workloads.

## 21.29 Python Analysis Standard

Preferred Python stack:
- FastAPI
- Pydantic / pydantic-settings
- Polars for large tabular/log processing
- Pandas only where compatibility requires it
- PyArrow for efficient columnar interchange
- lxml + defusedxml for XML
- openpyxl for XLSX
- orjson for large JSON serialization
- NetworkX for moderate in-memory graph algorithms
- jsonschema where needed
- PyMuPDF for PDF text extraction
- pytest
- Hypothesis for parser/rule property testing
- Ruff for lint/format
- Pyright for type checking

Avoid OCR as a normal path.

## 21.30 Large Data Interchange

For Node ↔ Python worker data, prefer:
- object storage references
- Arrow/Parquet for large tabular normalized data
- JSON for small control messages

Do not send millions of log rows through Redis job payloads.

## 21.31 Object Storage SDK

Use S3-compatible APIs.
Production adapter should support AWS S3, compatible enterprise object stores and MinIO for local development.
Use multipart upload for large files.

## 21.32 Email Templates

Use React Email or a provider-neutral typed template layer.
Providers can include SES, Postmark, Resend or another enterprise provider.
Do not scatter HTML email strings through backend code.

## 21.33 API Mocking

Use MSW or generated mocks for frontend/integration development where appropriate.
Mocks should derive from API schemas where possible and never substitute for backend integration tests.

## 21.34 Testing Libraries

TypeScript:
- Vitest for unit/package tests
- Playwright for browser E2E and critical component/browser behavior
- Testing Library where useful for component semantics

Python:
- pytest
- Hypothesis

API:
- OpenAPI contract tests
- property/fuzz testing for parsers and public APIs where appropriate

## 21.35 Load and Performance Testing

Use k6 or equivalent for public API, auth, upload initialization, project dashboard, analysis submission and connector/event bursts.
For engine benchmarks, use engine-specific benchmark harnesses rather than only HTTP load tests.

## 21.36 Security Toolchain

Continue to use:
- Gitleaks
- Trivy
- SBOM tooling such as Syft/CycloneDX
- Semgrep or equivalent SAST where it adds value

Integrate into CI.

## 21.37 Dependency Automation

Use Renovate or a similarly capable dependency-update bot.

Rules:
- group safe patch updates
- separate major updates
- auto-run compatibility suite
- no automatic production release

## 21.38 API Documentation UI

Generate API specification from source.
Use a polished OpenAPI documentation renderer such as Scalar if selected.
The OpenAPI document remains source of truth, not hand-written docs.

## 21.39 Product Documentation Framework

Use a Next.js-native documentation framework such as Fumadocs if it fits the main repo.

Requirements:
- MDX
- versioned developer docs
- full-text search
- code blocks
- i18n support where required
- generated API links

## 21.40 PDF / Report Rendering

Use structured HTML/CSS report rendering as canonical report format.
Generate PDF through a reliable headless-browser/server rendering pipeline where practical.
Avoid building reports by manually drawing PDF coordinates.
Machine-readable JSON remains the authoritative structured export.

## 21.41 Excel Import/Export

Use proven XLSX tooling on the backend.
For complex SAP XLSX imports, prefer Python/openpyxl/Polars pipeline.
Do not parse large Excel files entirely in the browser.

## 21.42 No-Dependency-Soup Rule

Do not install libraries because they appear in this list.
Before adding a dependency, record:
- purpose
- existing alternative
- maintenance status
- bundle/runtime impact
- license
- security
- owner

Forbidden duplication without ADR:
- Base UI + Radix + Ark UI as equal UI foundations
- TanStack Form + React Hook Form as two global form systems
- Drizzle + Prisma
- ECharts + multiple additional general chart frameworks
- React Flow + another full graph-editor library for the same use case
- BullMQ + another simple Redis queue for the same jobs

## 21.43 Frontend Bundle Boundaries

Heavy packages must be lazy loaded:
- Monaco
- React Flow routes
- ECharts analytics screens
- large file preview components

Do not ship analysis/admin dependencies to public marketing pages.
Use bundle analysis in CI/release review.

## 21.44 Library Upgrade Policy

For major dependencies:
- pin compatible ranges intentionally
- test upgrades in CI
- maintain adapter boundaries for external systems
- record major migration notes in ADR/changelog

Never blindly run “latest” in production deployment without tests.

## 21.45 Definition of Done

This part is complete when:
- library choices are implemented without unnecessary duplication
- design system uses one primitive foundation
- graphs/layouts/editors are standardized
- backend uses one ORM
- authorization is centralized
- queue vs durable workflow responsibilities are explicit
- Node/Python data interchange is efficient
- testing/security/dependency tooling is integrated
