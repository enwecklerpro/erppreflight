# Part 16 — Change Simulation, Extensibility Platform, Durable Orchestration and Enterprise Deployment

This part is binding and extends Parts 00–15.

---

## 16.1 Change Set as a First-Class Object

ERP Preflight must model a proposed change before it exists in SAP.

Create entity:

`ChangeSet`

Examples:
- modify OPD rules
- remove custom field
- move API V2 → V4
- change CDS dependency
- split transport
- upgrade SAP release
- replace legacy object
- lock technical user
- change form binding

ChangeSet stores:
- current/baseline state;
- proposed state;
- changed objects;
- reason;
- owner;
- related requirement/task;
- target environment;
- target release;
- approval status.

---

## 16.2 What-If Simulation Workspace

This is a strategic differentiator.

Flow:

1. select project baseline;
2. create proposed change;
3. apply change only to a virtual working graph/config snapshot;
4. run relevant engines against proposed state;
5. compare before vs after;
6. show newly introduced/resolved findings;
7. generate required regression tests;
8. approve/reject proposed change.

Example:

`What if we remove custom field YY1_CLASS?`

Result:
- 2 forms break
- 1 custom CDS breaks
- API payload loses field
- 3 regression tests need rerun
- software collection dependency changes

No SAP system is modified.

---

## 16.3 Change Simulation Diff

Every simulation shows:

### Before
- findings
- dependencies
- tests
- risk

### Proposed
- new findings
- resolved findings
- changed dependencies
- risk delta

Use exact graph/config diff.

Do not let an LLM invent a hypothetical impact not represented by evidence/rules.

---

## 16.4 Change Approval Workflow

Support:

Draft
→ Preflight Running
→ Failed Preflight
→ Ready for Review
→ Approved
→ Implemented
→ Verification Pending
→ Verified
→ Closed

Approvers can:
- approve;
- reject;
- request changes;
- accept specific risks.

Approval events are audited.

---

## 16.5 Digital Project Baseline

Projects can create immutable logical snapshots:

- system metadata;
- knowledge release;
- customer graph;
- rule versions;
- key artifacts.

A ChangeSet references a baseline.

This enables reproducible preflight even if global knowledge changes later.

---

## 16.6 Durable Workflow Orchestration

The product has long-running workflows:

- Full Project Preflight
- large MFS analysis
- source synchronization
- release reevaluation
- ChangeSet simulation
- Cloud ALM sync
- local-agent collection
- scheduled analyses
- report generation

Implement a `WorkflowOrchestrator` abstraction.

Evaluate using a durable workflow engine such as Temporal for complex, multi-step, retryable workflows.

Redis/BullMQ may remain for simple queue jobs.

Do not encode critical multi-step orchestration solely in fragile chained queue callbacks.

---

## 16.7 Transactional Outbox / Event Architecture

Use a transactional outbox pattern for important domain events.

Examples:
- finding.created
- finding.resolved
- change_set.approved
- analysis.completed
- knowledge.updated
- release_watch.changed
- test.failed

Ensure database state and emitted event cannot silently diverge.

Consumers must be idempotent.

---

## 16.8 Internal Schema Registry

Multiple squads and engines require stable internal data contracts.

Create versioned schemas for:

- AnalysisJob
- NormalizedArtifact
- Finding
- Evidence
- KnowledgeObject
- Relationship
- TestCase
- ConnectorEvent
- ChangeSet
- ReportModel

Rules:
- backwards compatibility policy;
- migration adapters;
- contract tests;
- explicit schema version.

Do not rely on undocumented JSON shapes.

---

## 16.9 Plugin / Engine SDK

Extend the internal Engine SDK into a documented plugin architecture.

A plugin declares:
- ID
- version
- publisher
- required input artifacts
- permissions
- output schemas
- finding codes
- configuration
- health check
- resource limits.

First-party engines use the same contract where practical.

---

## 16.10 Third-Party / Partner Engine Sandbox

Future consulting partners can build private engines.

Third-party engines must run isolated.

Controls:
- container sandbox
- CPU/memory/time limit
- no unrestricted network by default
- declared outbound domains
- read-only artifact access
- scoped tenant/project access
- no secret access unless explicitly granted
- signed packages
- vulnerability scan

Do not run arbitrary partner code inside the main API process.

---

## 16.11 Private Partner Engine Catalog

Partner organizations may have private checks such as:
- internal Clean Core rules
- internal migration mappings
- customer-specific output checks
- proprietary validation logic

Allow:
- publish to own organization;
- publish to selected client workspaces;
- version;
- deprecate;
- rollback.

Do not expose partner IP globally.

---

## 16.12 Future Public Marketplace Architecture

Do not launch a public marketplace until quality/governance is mature, but design for:

- publisher identity;
- review;
- versioning;
- compatibility;
- license metadata;
- security scan;
- ratings/usage;
- revocation.

ERP Preflight retains the right to disable unsafe plugins.

---

## 16.13 Custom Rule DSL

Organizations need custom checks without arbitrary code.

Provide a safe declarative DSL for:
- object match
- dependency condition
- field condition
- release condition
- severity
- message
- recommendation

Do not allow raw JavaScript/Python execution in user-created rules.

Version and test custom rules.

---

## 16.14 MCP Server

Provide an official ERP Preflight Model Context Protocol server.

Tools should include scoped operations such as:

- `search_knowledge`
- `lookup_object`
- `compare_releases`
- `run_preflight`
- `get_analysis`
- `get_findings`
- `explain_finding`
- `generate_test`
- `get_project_status`

MCP access:
- API key/OAuth
- tenant-scoped
- permission-scoped
- rate limited
- audited

Write/destructive actions require explicit tool permissions and user confirmation.

This allows safe use from AI coding/consulting environments.

---

## 16.15 IDE Extensions

Plan official clients:

### VS Code Extension
Functions:
- Clean Core object lookup
- run ABAP repo scan
- show findings inline
- API diff
- project link
- open finding in web

### Eclipse/ADT Extension
Functions:
- analyze selected ABAP object/package
- Clean Core/successor lookup
- transport preflight
- open related ERP Preflight project/finding

Keep heavy analysis server-side or in approved local agent.

---

## 16.16 Developer Experience Gateway

CLI, MCP, IDE and CI clients must all reuse the public versioned API.

Do not implement separate business logic inside each client.

---

## 16.17 Landscape Registry

Create a first-class enterprise landscape model:

- system ID/name
- product
- edition
- release
- client
- environment
- region
- URL (sanitized)
- connected BTP subaccount
- Cloud ALM tenant
- Integration Suite tenant
- business role
- data classification
- criticality

Relationships:
- DEV → TEST → PROD
- source → target
- connected-to
- replicated-to
- monitored-by

---

## 16.18 Landscape Discovery

Local Agent/connectors can discover read-only metadata such as:
- system/version
- configured connector identities
- selected technical capabilities
- installed components where permitted

Discovery results require user review before becoming canonical landscape data.

---

## 16.19 Business Criticality Registry

Allow organization to assign criticality to:
- process
- interface
- system
- object group
- project
- go-live wave

Levels:
- Low
- Medium
- High
- Critical

Risk calculations use this registry.

---

## 16.20 Usage and Business Impact Correlation

Where usage data exists, prioritize findings using:
- frequency;
- recency;
- business criticality;
- environment;
- process.

Example:

Unused custom report with Clean Core violation:
Lower immediate migration priority

Month-end FI integration used once/month:
Potentially critical despite low frequency

Never rely only on usage count.

---

## 16.21 SIEM / Security Export

Enterprise customers can forward ERP Preflight audit/security events to:
- generic syslog/CEF
- webhook
- Microsoft Sentinel-compatible endpoint
- Splunk-compatible HTTP event collector pattern where configured

Do not expose customer analysis contents by default.

---

## 16.22 Customer-Managed Encryption Key Readiness

Architecture must support future:
- customer-managed encryption keys
- key rotation
- per-region keys
- key revocation behavior

Do not claim CMEK support until actually enabled.

---

## 16.23 Private Edition / Self-Hosted Deployment

In addition to Local Agent, prepare an enterprise deployment profile.

Modes:

1. ERP Preflight SaaS
2. SaaS + Local Agent
3. Private Cloud deployment
4. fully self-hosted/private edition
5. future air-gapped deployment

Provide:
- Helm charts / container manifests
- external managed PostgreSQL support
- external S3 support
- external Redis
- external identity provider
- license/entitlement mechanism
- offline knowledge bundle update mechanism for restricted deployments

---

## 16.24 Air-Gapped Knowledge Bundles

For disconnected environments:
- signed knowledge bundle
- release metadata
- rule bundle
- checksums
- import UI/CLI
- rollback
- provenance

No hidden internet dependency.

---

## 16.25 Connector Credential Vault

All connector credentials use a dedicated vault abstraction.

Support:
- secret reference
- rotation
- last rotated
- expiration
- test connection
- disable/revoke

Never store plaintext connector credentials in normal application tables.

---

## 16.26 Content Rights / Source Governance Registry

Code licenses and knowledge-content rights are different concerns.

Create a registry for each external knowledge source:

- owner/publisher
- source URL
- access method
- authentication required
- allowed internal use
- allowed caching
- allowed public redistribution
- excerpt policy
- retention
- attribution requirement
- terms review date
- reviewer

The ingestion pipeline must honor source policy.

Do not republish restricted support content merely because the user/account can access it.

For restricted sources:
- store reference/metadata where permitted;
- access through customer's authorized connector if appropriate;
- avoid copying full protected text into public SEO pages.

---

## 16.27 Public Knowledge Publication Gate

A knowledge record may become public SEO content only if:

- source/publication rights permit it;
- record is reviewed;
- no customer-confidential data;
- no restricted support content;
- target release is explicit;
- provenance exists.

Admin must be able to revoke/unpublish quickly.

---

## 16.28 SAP Partner / Store Readiness Center

Create internal admin/commercial readiness area for future SAP partner journey.

Track:
- solution architecture
- security documentation
- test evidence
- business value description
- demo assets
- integration scenarios
- supported SAP products
- BTP usage
- support model
- data flow diagrams
- compliance answers
- release readiness

Generate an evidence package useful for:
- SAP PartnerEdge Build preparation
- Application Readiness Check
- Solution Hub
- integration certification preparation
- SAP Store listing preparation

Do not claim certification until obtained.

---

## 16.29 BTP-Compatible Deployment Profile

Because SAP partner programs may favor BTP-aligned solutions, maintain an optional deployment/integration profile compatible with SAP BTP components where useful.

Possible components:
- SAP Cloud SDK
- SAP Destination Service
- SAP Connectivity / Cloud Connector
- SAP IAS/OIDC
- SAP AI Core adapter
- Cloud Foundry/Kyma-compatible containers

The core product must remain cloud-portable.

---

## 16.30 SAP Store Entitlement Readiness

Abstract entitlements from Stripe billing.

Future entitlement sources may include:
- direct Stripe purchase
- enterprise contract
- SAP Store/partner transaction
- partner-issued license
- trial

Use an internal entitlement service so product access is not hardcoded to Stripe state.

---

## 16.31 Change Evidence Pack

When a ChangeSet is approved, generate:

- proposed change
- affected objects
- findings before/after
- accepted risks
- approvals
- regression tests
- external tasks
- transports
- evidence

This can be attached to ALM/change-management process.

---

## 16.32 Release Evidence Pack

Before go-live/release, generate:

- release status
- unresolved blockers
- accepted risks
- tests
- transport dependencies
- API changes
- migration gaps
- approvals
- evidence

Support digital sign-off metadata.

Do not market this as regulatory electronic signature unless requirements are actually met.

---

## 16.33 Notification and Approval Escalation

Support escalation policies:

Example:
Critical PROD finding open > 24h
→ notify owner
→ then project lead
→ then org admin

Avoid noisy escalation for low-severity findings.

---

## 16.34 Synthetic Fixture Generator

Test Lab can generate sanitized synthetic examples for:
- API payloads
- form XML
- OPD scenarios
- change-pointer field changes
- MFS telegram sequences

Synthetic data must be clearly labeled.

Use deterministic generators where possible.

---

## 16.35 Root Cause Correlation Across Engines

Create a correlation service that can suggest that multiple findings share one root cause only when graph/evidence supports the correlation.

Example:
- FormDoctor: no PDF generated
- OPD Guard: missing recipient
- project: same document type

Correlate:
`Likely shared root: Output determination`

Do not merge unrelated findings solely through semantic similarity.

---

## 16.36 Finding Deduplication

Same issue may arrive from:
- ATC import
- Clean Core Guard
- Readiness Check import
- manual analysis

Implement fingerprinting and source aggregation.

One canonical finding can have multiple evidence sources.

---

## 16.37 “Unknown” as a Valid Result

Every engine must be able to return:

`UNKNOWN / INSUFFICIENT_EVIDENCE`

This is preferred to hallucinating a confident answer.

UI should tell user exactly what additional artifact/evidence would resolve the unknown.

---

## 16.38 Definition of Done

This part is complete only when architecture/product supports:

- ChangeSet model
- what-if simulation
- approval workflow
- durable workflow orchestration abstraction
- transactional event delivery
- internal schema registry
- plugin/engine SDK
- third-party engine sandbox design
- MCP server
- IDE client architecture
- landscape registry
- business criticality
- SIEM export design
- private/self-hosted deployment path
- source rights registry
- SAP partner readiness evidence pack
- entitlement abstraction
- change/release evidence packs
- cross-engine deduplication/correlation.
