# ERP Preflight — TanStack-Only Implementation Prompt for GPT Astra Ultra

**Target repository:** `https://github.com/enwecklerpro/erppreflight`  
**Product:** ERP Preflight  
**Scope of this prompt:** TanStack only  
**Framework:** Next.js + React + TypeScript

---

# 0. Mission

Implement TanStack across ERP Preflight in a consistent, enterprise-grade way.

Use TanStack only where it is the correct tool. Do not introduce overlapping libraries that duplicate the same responsibility.

The required TanStack packages are:

- **TanStack Query**
- **TanStack Table**
- **TanStack Virtual**
- **TanStack Form**
- **TanStack Pacer**

Do **not** introduce:

- TanStack Router
- TanStack Start

because ERP Preflight uses **Next.js** as the application framework and router.

Do not introduce React Hook Form as a second global forms framework unless there is a documented exception.

Do not introduce Redux for server state.

---

# 1. Global TanStack Architecture

TanStack responsibilities:

```text
Server/API state
    ↓
TanStack Query

Enterprise data grids
    ↓
TanStack Table

Huge rows / logs / lists
    ↓
TanStack Virtual

Forms
    ↓
TanStack Form

Debounce / throttle / batching
    ↓
TanStack Pacer
```

The responsibilities must remain separated.

---

# 2. TanStack Query

Use TanStack Query as the canonical client-side server-state layer.

Use it for:

- projects
- analyses
- findings
- reports
- SAP objects
- knowledge records
- users
- organizations
- billing/usage data
- admin metrics
- connectors
- engine status
- release watches
- test runs
- notifications

Do not use it for simple local component UI state.

---

# 3. Query Client Setup

Create a centralized Query Client factory.

Requirements:

- safe Next.js App Router integration
- no global singleton leakage during SSR
- sensible defaults
- typed query keys
- centralized retry policy
- stale-time strategy
- error handling
- query cancellation
- devtools only in development

Create packages/modules such as:

```text
packages/query/
├── query-client.ts
├── query-keys.ts
├── query-options.ts
├── mutations.ts
├── errors.ts
└── hydration.ts
```

---

# 4. Query Keys

Never use ad-hoc string query keys throughout the codebase.

Use structured factories:

```ts
projectKeys.all
projectKeys.list(filters)
projectKeys.detail(projectId)

findingKeys.list(projectId, filters)
findingKeys.detail(findingId)

analysisKeys.detail(analysisId)
analysisKeys.progress(analysisId)
```

Query keys must include all inputs that affect server results.

---

# 5. Query Cache Policies

Define different stale times by data category.

Examples:

### Almost static metadata

```text
SAP release metadata
engine catalog
knowledge object classifications
```

Longer stale time.

### Normal SaaS data

```text
projects
findings
reports
```

Moderate stale time.

### Highly dynamic

```text
analysis progress
job status
notifications
connector health
```

Short stale time or real-time updates.

Do not globally set every query to refetch constantly.

---

# 6. Query Mutations

All important write actions use explicit mutations.

Examples:

- create project
- upload artifact metadata
- run analysis
- assign finding
- resolve finding
- create test
- update rule
- add connector
- create report

Every mutation must define:

- typed input
- typed output
- loading/pending state
- error state
- invalidation/update strategy
- audit-relevant UI behavior

---

# 7. Optimistic Updates

Use optimistic updates only where rollback is safe.

Good candidates:

- finding status
- tags
- comments
- notification read state

Avoid optimistic updates for:

- billing
- permission changes
- analysis results
- destructive admin actions
- production write approvals

---

# 8. Query Error Handling

Build a normalized API error model.

UI must distinguish:

- validation error
- permission denied
- plan/usage limit
- conflict
- transient server failure
- connector unavailable
- unknown error

Do not display raw backend stack traces.

---

# 9. Query Prefetching

Use intentional prefetching.

Examples:

When opening a project:
- prefetch project summary
- finding counts
- latest analysis

When hovering/opening object:
- prefetch object inspector data

Do not prefetch huge datasets unnecessarily.

---

# 10. Infinite Queries

Use `useInfiniteQuery` where it improves UX:

- activity feeds
- notifications
- very large finding lists
- knowledge search

For business tables that require deterministic pagination/export, normal server pagination is often preferable.

---

# 11. Real-Time Integration

TanStack Query remains the canonical cache even when using:

- Server-Sent Events
- WebSockets
- polling

Example:

```text
analysis worker
   ↓
SSE event
   ↓
update/invalidate TanStack Query cache
   ↓
UI updates
```

Do not build a second real-time state store duplicating Query data.

---

# 12. TanStack Table

TanStack Table is the canonical table engine.

Use it for:

- findings
- SAP object inventories
- migration inventories
- API differences
- transport dependencies
- change pointer coverage
- user/admin tables
- organization list
- audit logs
- billing usage
- release watches
- engine quality reports
- MFS incident summaries

---

# 13. Reusable DataTable Architecture

Build reusable table primitives.

Suggested structure:

```text
packages/ui/data-table/
├── data-table.tsx
├── columns.tsx
├── toolbar.tsx
├── filters.tsx
├── pagination.tsx
├── bulk-actions.tsx
├── column-visibility.tsx
├── export.tsx
├── empty-state.tsx
└── types.ts
```

Do not create a different table architecture per feature.

---

# 14. Server-Side Tables

For large datasets use server-side:

- pagination
- filtering
- sorting
- search

TanStack Table controls the state, but the backend executes the data operation.

Example URL/API state:

```text
?page=2
&pageSize=50
&severity=critical,high
&status=open
&sort=createdAt.desc
```

---

# 15. URL-Synchronized Table State

Important filters should be represented in the URL when safe.

Examples:

- severity
- finding status
- engine
- SAP release
- environment
- owner
- date range

Benefits:

- shareable links
- browser back/forward
- saved views
- support/debugging

Do not put private data or secrets into query parameters.

---

# 16. Column Features

Support:

- sort
- filter
- hide/show
- resize
- pin
- reorder where useful
- row selection
- bulk actions

Persist column preferences per user/table.

---

# 17. Table Accessibility

Tables must support:

- keyboard navigation
- meaningful headers
- selection labels
- screen-reader semantics
- non-color-only severity indicators

Virtualized tables require extra accessibility testing.

---

# 18. TanStack Virtual

Use TanStack Virtual for very large rendered collections.

Primary ERP Preflight use cases:

- MFS telegram logs
- SAP object inventories
- findings
- audit events
- knowledge search
- dependency search results
- very large tables

Never render tens of thousands of rows directly into the DOM.

---

# 19. Virtualization Strategy

Use virtualization only after the server query has produced the intended page/window.

Avoid:

```text
download 1 million rows
→ virtualize them in browser
```

Prefer:

```text
server filtering/pagination/window
→ browser receives manageable set
→ virtualize visible rows when needed
```

---

# 20. Dynamic Row Heights

Support dynamic sizes where needed, especially:

- expanded finding details
- multiline log entries

Prefer fixed/estimated row heights when possible for performance.

---

# 21. Virtualized MFS Logs

MFS BlackBox log viewer must support:

- hundreds of thousands of events
- virtualization
- timeline navigation
- filtering
- search
- selected event inspector
- jump to first divergence

Scrolling must remain responsive.

---

# 22. TanStack Form

TanStack Form is the canonical React forms library.

Use it for:

- onboarding
- project creation
- connector configuration
- analysis setup
- billing/company settings
- admin settings
- rule editor forms
- engine configuration
- support forms
- profile/security settings

---

# 23. Form + Zod Strategy

Use TanStack Form for form state.

Use Zod for shared validation schemas.

Avoid duplicating validation logic.

Architecture:

```text
Zod domain schema
    ↓
TanStack Form
    ↓
API request schema
```

Backend still validates independently.

Frontend validation is not a security boundary.

---

# 24. Complex Enterprise Forms

Support:

- nested fields
- dynamic arrays
- conditional fields
- multi-step wizard
- async validation
- dirty state
- autosave where appropriate

Examples:

### SAP Connector Wizard

```text
System
→ Authentication
→ Permissions
→ Test Connection
→ Capabilities
→ Confirm
```

### Project setup

```text
Source ERP
→ Target ERP
→ Release
→ Modules
→ Countries
→ Team
```

---

# 25. Form Error UX

Errors must be:

- next to field
- summarized for long forms
- focusable
- screen-reader accessible

Do not rely only on toast errors.

---

# 26. Unsaved Changes Protection

For critical configuration forms:

- detect dirty state
- warn before route leave
- offer save/discard

Do not interrupt users on trivial filter forms.

---

# 27. Autosave

Use controlled autosave only for suitable content:

- report notes
- project notes
- draft rules
- draft mappings

Combine TanStack Form with Pacer/debounced mutations.

Do not autosave destructive settings.

---

# 28. TanStack Pacer

Use TanStack Pacer for high-frequency UX behavior.

Use cases:

- global search
- object search
- table filter text
- autosave
- resize-heavy interactions
- repeated graph search
- API request pacing

---

# 29. Search Debouncing

Example:

```text
User types MARA
↓
Pacer waits appropriate debounce window
↓
Query executes once
```

Do not call backend on every keystroke.

---

# 30. Rate-Limited Client Actions

For interactions that may trigger costly operations, throttle:

- preview generation
- graph re-layout
- search suggestions
- analysis simulation preview

Server-side rate limiting remains mandatory.

Client pacing is UX optimization, not security.

---

# 31. Query + Form Integration

Example connector form:

```text
TanStack Form
   ↓ submit
TanStack Query mutation
   ↓
backend
   ↓ success
invalidate connector queries
```

Use a consistent pattern across the platform.

---

# 32. Table + Query Integration

Example findings table:

```text
URL filter state
   ↓
TanStack Table state
   ↓
TanStack Query
   ↓
GET /findings
   ↓
render rows
```

Avoid duplicate table/filter state in multiple stores.

---

# 33. Virtual + Table Integration

For very large tables:

```text
TanStack Table
   ↓
row model
   ↓
TanStack Virtual
   ↓
visible rows only
```

Benchmark before enabling virtualization on every small table.

---

# 34. Saved Views

Build reusable saved views on top of table/query state.

Examples:

- Critical open findings
- FI migration blockers
- PROD only
- No official evidence
- Newly introduced since baseline

Saved views persist:

- filters
- sorting
- visible columns
- grouping where supported

---

# 35. Bulk Actions

TanStack Table row selection powers bulk actions:

- assign
- resolve
- accept risk
- export
- tag
- generate tests

Destructive bulk operations require confirmation.

---

# 36. Export

Export should usually run server-side for large result sets.

Do not export only currently rendered virtualized rows unless explicitly requested.

Options:

- CSV
- XLSX
- JSON

---

# 37. Loading States

TanStack Query loading states must use intentional UX:

- skeleton on initial load
- subtle background refresh indicator
- preserve old data during pagination where useful
- no screen flashing

---

# 38. Suspense

Use React Suspense intentionally.

Do not enable Suspense everywhere blindly.

Use server components where they simplify initial data loading and Query where rich client interaction is required.

---

# 39. Next.js Boundaries

Next.js remains responsible for:

- routing
- layouts
- server rendering
- SEO/public pages

TanStack remains responsible for:

- server-state cache
- tables
- virtual lists
- forms
- pacing

Do not duplicate Next.js routing with TanStack Router.

---

# 40. Public SEO Pages

Do not ship unnecessary TanStack client bundles to static/public knowledge pages.

Public SEO page should be mostly server-rendered.

Only hydrate interactive pieces.

---

# 41. Admin Tables

Admin must use same table infrastructure for:

- tenants
- users
- subscriptions
- usage
- jobs
- knowledge
- rules
- engines
- source sync
- audit logs

Do not build a second admin data-grid stack.

---

# 42. Query Devtools

Enable TanStack Query Devtools only:

- local development
- optionally staging/admin-debug

Never expose them publicly in production.

---

# 43. Table Debug Tools

In development create optional debug panel showing:

- server filters
- table state
- selected rows
- column state

Do not ship developer debug UI to customers.

---

# 44. Performance Benchmarks

Benchmark pages such as:

### Findings
10k+ findings in project

### Object Inventory
100k objects with server search

### MFS
500k+ events loaded through server/windowed model

Track:

- initial render
- filter response
- scroll smoothness
- memory

---

# 45. Type Safety

Do not use `any` for TanStack configurations unless library limitations force it.

Create typed:

- columns
- rows
- query responses
- form values
- filters
- query keys

---

# 46. Generated API Types

Prefer generated API types from OpenAPI via Orval.

Example:

```text
NestJS OpenAPI
   ↓
Orval
   ↓
Generated client
   ↓
TanStack Query hooks
```

Avoid manually writing duplicate response interfaces.

---

# 47. Error Boundaries

Critical TanStack-powered pages should have React error boundaries.

A failed table query should not crash the whole dashboard.

---

# 48. Offline / Network Recovery

Where useful:

- retry transient requests
- show offline state
- preserve unsaved form draft locally for non-sensitive data

Do not cache sensitive SAP files in browser storage.

---

# 49. Tenant Switching

When organization/tenant changes:

- clear/invalidate tenant-scoped Query cache
- cancel pending requests
- prevent previous tenant flash
- reset tenant-scoped local state

This is mandatory for security.

---

# 50. Authentication State Changes

On logout:

- cancel queries
- clear Query cache
- clear sensitive local state

On role/permission change:
- invalidate authorization-sensitive queries

---

# 51. Query Persistence

Do not globally persist server query cache to localStorage.

Only persist explicitly safe non-sensitive state.

Sensitive project/findings data should be fetched after authentication.

---

# 52. Testing TanStack Query

Tests must cover:

- successful fetch
- validation failure
- server error
- retry
- cache invalidation
- mutation rollback if optimistic
- tenant switching

---

# 53. Testing TanStack Table

Tests:

- sorting
- filtering
- pagination
- URL sync
- row selection
- bulk action
- permissions
- hidden columns

---

# 54. Testing TanStack Virtual

Use browser E2E for:

- scroll
- row visibility
- jump to result
- dynamic height
- large MFS log

---

# 55. Testing TanStack Form

Test:

- valid submit
- invalid submit
- conditional field
- async validation
- nested arrays
- unsaved warning
- server validation errors

---

# 56. Testing Pacer

Use fake timers/unit tests for:

- debounce
- throttle
- cancellation
- latest-value behavior

---

# 57. TanStack Package Wrappers

Create ERP Preflight wrappers so feature teams do not directly reinvent setup.

Suggested packages:

```text
packages/
├── query/
├── data-table/
├── virtual-list/
├── forms/
└── pacing/
```

---

# 58. Query Package

Expose utilities:

```text
createAppQueryClient()
queryKeys
apiQueryOptions()
apiMutation()
invalidateProject()
invalidateAnalysis()
```

---

# 59. Data Table Package

Expose:

```text
<DataTable />
<DataTableToolbar />
<DataTableFilters />
<DataTablePagination />
<DataTableColumnMenu />
<DataTableBulkActions />
```

---

# 60. Form Package

Expose:

- standardized form field
- label
- description
- required marker
- field error
- form summary error
- save bar
- dirty-state helper

---

# 61. Pacer Package

Expose helpers:

- `useDebouncedSearch`
- `useAutosavePacer`
- `useThrottledAction`

Avoid arbitrary debounce implementations scattered throughout the repo.

---

# 62. Accessibility

All TanStack abstractions must satisfy WCAG 2.2 AA.

Especially:

- virtual rows
- keyboard table interaction
- error summaries
- form labels
- bulk actions
- command/search

---

# 63. Mobile Behavior

Desktop is primary.

On smaller screens:

- data table may switch to responsive card/list presentation
- essential actions remain accessible
- no horizontal-scroll-only critical experience when a responsive alternative is practical

---

# 64. Bundle Control

TanStack packages are generally modular, but still monitor bundle size.

Do not import unused adapters/framework packages.

---

# 65. Upgrade Policy

Track TanStack package versions independently.

Before major upgrade:

- read migration guide
- run Query/Table/Form/Virtual regression suites
- check generated Orval hooks
- update internal wrappers first

Feature code should rarely need direct migration if wrappers are designed well.

---

# 66. Forbidden Patterns

Do not:

- fetch server data with raw `useEffect` when Query is appropriate
- maintain a separate Redux copy of Query data
- render huge arrays without virtualization/pagination
- create manually inconsistent tables
- mix multiple form frameworks globally
- call backend on every keypress
- use TanStack Router in parallel with Next.js routing
- use TanStack Query cache as permanent business storage

---

# 67. Example — Findings Page

Architecture:

```text
Next.js Route
    ↓
URL filters
    ↓
TanStack Query
    ↓
Findings API
    ↓
TanStack Table
    ↓
TanStack Virtual if needed
```

Features:

- severity filter
- engine
- release
- environment
- status
- owner
- sorting
- saved views
- bulk selection
- export
- row inspector

---

# 68. Example — SAP Object Search

```text
Search box
    ↓
TanStack Pacer
    ↓
TanStack Query
    ↓
search API
    ↓
Virtualized results
```

Click object:

```text
prefetch object details
→ Object Inspector
```

---

# 69. Example — OPD Scenario Form

```text
TanStack Form
+ Zod schema

Fields:
Company Code
Purchasing Org
Supplier
Channel
etc.
```

Submit:

```text
TanStack Query mutation
→ OPD simulation
→ result query/cache
```

---

# 70. Example — Analysis Progress

Initial:

```text
POST analysis
→ mutation returns analysis ID
```

Then:

```text
TanStack Query analysis detail
+
SSE events
→ setQueryData/update cache
```

Result automatically becomes available.

---

# 71. Definition of Done

TanStack integration is complete only when:

- Query is the canonical client server-state layer
- Table is used through reusable ERP Preflight abstractions
- large tables/logs use Virtual where justified
- Form is the canonical form framework
- Pacer is used for high-frequency interactions
- Next.js remains the router/framework
- URL/filter state is consistent
- tenant cache isolation is tested
- accessibility tests pass
- performance tests cover large datasets
- there is no unnecessary duplicate form/table/query/router library
- feature teams have repository-local TanStack guidance
