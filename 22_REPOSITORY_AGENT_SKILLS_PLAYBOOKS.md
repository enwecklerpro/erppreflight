# Part 22 — Repository-Local Agent Skills and Engineering Playbooks

This part is binding and extends Parts 00–21.

ERP Preflight will be built and maintained by humans plus coding agents. The repository must contain explicit reusable engineering skills/playbooks so every agent works with the same product rules rather than inventing architecture per task.

Implement canonical Markdown skill files under:

`/.agents/skills/`

Also maintain a root `AGENTS.md` that tells any coding agent which skill to load for each task.

If GPT Astra Ultra supports another native skill format, generate compatible wrappers while keeping the Markdown source canonical.

## 22.1 Skill: `frontend-design-system`

Covers shadcn/Base UI, design tokens, typography, tables, finding severity UI, light/dark, accessibility, responsive behavior, TanStack usage, Motion restraint, React Flow/ECharts usage and visual regression.

Trigger: any frontend/page/component work.

## 22.2 Skill: `data-table-and-large-list`

Rules:
- TanStack Table
- server pagination/filtering for truly large datasets
- TanStack Virtual where applicable
- URL-backed filters
- stable row IDs
- bulk selection
- accessible keyboard selection
- export path
- never render 100k rows in the DOM

Trigger: findings, objects, migration inventory, admin tables, MFS logs.

## 22.3 Skill: `dependency-graph`

Rules:
- React Flow rendering
- ELK layout
- canonical backend graph IDs
- accessible table fallback
- node inspector
- filters
- no business logic hidden in UI edge rendering
- large graph strategy

Trigger: impact, traceability, transport, custom fields, MFS, ChangeSet visualization.

## 22.4 Skill: `engine-authoring`

Every engine requires:
1. metadata
2. input schema
3. parser/normalizer
4. deterministic analysis
5. finding codes
6. evidence
7. confidence
8. fixtures
9. tests
10. generated tests
11. metrics
12. project/report integration
13. admin visibility
14. docs

Never create an engine that is only an LLM prompt.

## 22.5 Skill: `sap-evidence`

Rules:
- exact edition/release
- official sources preferred
- do not generalize on-prem behavior to Public Cloud
- do not call absence “unsupported” without sufficient evidence
- store provenance
- distinguish SAP standard from customer customization
- distinguish recommendation from 1:1 replacement
- mark UNKNOWN when necessary

## 22.6 Skill: `release-aware-knowledge`

Every support/mapping fact must carry product/edition/release, immutable snapshot, source checksum, last verified and reevaluation behavior.

## 22.7 Skill: `secure-file-parser`

Mandatory:
- MIME/content validation
- size limits
- zip bomb defense
- path traversal defense
- XXE defense
- nested archive limits
- secret scan
- sanitized errors
- fuzz/property tests
- streaming for large data

## 22.8 Skill: `multi-tenant-security`

Every new data/resource endpoint checks:
- tenant scope
- authorization
- RLS where applicable
- audit
- object storage prefix
- cache key tenant isolation
- queue tenant isolation
- search isolation
- cross-tenant denial test

## 22.9 Skill: `authorization-policy`

Rules:
- deny by default
- canonical permission name
- central policy integration
- backend enforcement mandatory
- frontend hiding is not authorization
- test allow/deny
- production write approval

## 22.10 Skill: `ai-feature`

Checklist:
- deterministic alternative?
- data classification
- provider eligibility
- prompt registry
- structured schema
- injection defense
- eval corpus
- human oversight
- actor attribution
- cost
- fallback
- audit

## 22.11 Skill: `agentic-change-gate`

Any AI/automation that proposes or executes ERP change must use ChangeProposal, What-If, policy, approval, proposal hash, execution token, audit and post-execution verification.

No direct autonomous production write.

## 22.12 Skill: `oss-integration`

Checklist:
- exact repo/package
- license
- version
- adapter boundary
- tests
- notices
- SBOM
- security scan
- upstream update process
- avoid copying when package/API is cleaner

## 22.13 Skill: `connector-development`

Checklist:
- least privilege
- read/write declaration
- capability handshake
- secret vault
- health
- timeout/retry
- rate limit
- idempotency
- sync conflicts
- audit
- mocked contract tests
- no engine-specific raw connector dependency

## 22.14 Skill: `cloud-alm-integration`

Guidance:
- external IDs
- sync direction
- Requirements/Tasks/Test Cases/Process Hierarchy
- system of record
- conflict handling
- finding → task
- test sync
- no silent overwrites

## 22.15 Skill: `seo-knowledge-page`

Checklist:
- reviewed global knowledge only
- source publication rights
- sufficient unique content
- explicit target release
- last verified
- internal graph links
- canonical
- hreflang
- noindex if thin
- valid structured data
- real user value
- relevant tool CTA

## 22.16 Skill: `accessibility`

Checklist:
- keyboard
- focus
- semantics
- labels
- non-color severity
- reduced motion
- screen reader
- graph/table alternative
- axe/Playwright tests

## 22.17 Skill: `testing-golden-fixture`

Every meaningful engine defect should result in a minimized regression fixture with input, expected finding, evidence, negative cases and engine/rule version.

## 22.18 Skill: `database-migration`

Rules:
- migration reviewed
- backwards-compatible deployment where needed
- no destructive migration without backup/plan
- index impact
- RLS impact
- rollback strategy
- production scale consideration

## 22.19 Skill: `background-workflow`

Decision tree:
- normal request if fast/bounded
- BullMQ for simple async/retry/schedule
- durable orchestrator if multi-stage, long-running, waits for external event/human, or must survive crashes for days

Do not mix responsibilities.

## 22.20 Skill: `admin-feature`

Any user-facing capability that requires operations must consider admin visibility, usage metrics, support diagnostics, feature flags, tenant overrides, quality status, audit and cost.

## 22.21 Skill: `billing-entitlement`

Rules:
- entitlement service controls product access
- billing provider is not authorization
- webhook idempotency
- trial/credit
- enterprise override
- usage meter
- billing state transition tests

## 22.22 Skill: `performance`

Checklist:
- dataset size assumption
- query plan/index
- streaming
- virtualization
- bundle impact
- worker memory
- benchmark
- avoid full in-memory load of giant file/graph

## 22.23 Skill: `incident-debugging`

When fixing production issue:
- correlation ID
- exact release
- logs/traces
- reproduce
- root cause
- fix
- regression test
- postmortem if material
- no suppression-only “fix”

## 22.24 Skill: `docs-and-runbook`

Any operational feature requires user docs, admin docs, troubleshooting, config, security considerations and rollback/runbook.

## 22.25 Skill: `code-review`

Reviewer checks architecture fit, security, tenancy, tests, deterministic/evidence rule, performance, accessibility, observability, dependencies, docs and migration compatibility.

## 22.26 Root `AGENTS.md`

Create `AGENTS.md` with:
- product principles
- monorepo map
- commands
- quality gates
- skill routing table
- forbidden shortcuts
- definition of done
- test commands
- local services

It must explicitly state:

`A page that renders is not a completed feature.`

and:

`An engine without deterministic logic/evidence/fixtures is not complete.`

## 22.27 Architecture Decision Skill

When an agent wants to change framework, add database, add queue, add graph engine, replace auth, change API style or add a major dependency, it must create/update an ADR first.

## 22.28 Skills Quality

Each skill must be concrete, checklist-driven, version-controlled and concise enough to use.
Do not create hundreds of vague skills.

## 22.29 Definition of Done

This part is complete when:
- repository contains `AGENTS.md`
- repository contains the defined skill/playbook set
- CI/docs reference them where relevant
- agents can identify which skill applies to a task
- product and architecture principles are encoded outside the giant master prompt
