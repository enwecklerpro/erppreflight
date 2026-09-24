# Part 17 — Trust Platform: Knowledge, Rule and AI Release Governance

This part is binding and extends Parts 00–16.

ERP Preflight's competitive advantage depends on trust. The product must treat code, rules, SAP knowledge and AI behavior as independently versioned production assets with controlled promotion, rollback and evidence.

---

## 17.1 Compatibility and Support Matrix

Create a canonical support matrix covering:

- ERP/SAP product
- edition
- release
- feature pack/support package where relevant
- engine
- connector
- artifact type
- operation
- support status

Support statuses:

- `SUPPORTED_VERIFIED`
- `SUPPORTED_BETA`
- `PARTIAL`
- `FILE_MODE_ONLY`
- `CONNECTOR_MODE_ONLY`
- `NOT_SUPPORTED`
- `UNKNOWN`

Example:

| Engine | Product | Edition | Release | Input | Status |
|---|---|---|---|---|---|
| OPD Guard | S/4HANA Cloud | Public | 2608 | XLSX export | Supported Verified |
| Clean Core Guard | S/4HANA | Private | 2025 | abapGit | Supported Verified |
| MFS BlackBox | EWM | On-Prem | target versions | CSV log | Partial |

Never imply support for a release that has not been validated.

Expose support matrix publicly where useful.

---

## 17.2 Engine Certification Packs

Every supported combination should have a certification/verification pack:

- fixture set;
- expected outputs;
- parser compatibility;
- rule compatibility;
- integration test result;
- last verified date;
- reviewer;
- source system/release used.

Admin can mark a combination “verified” only after the pack passes.

---

## 17.3 Knowledge Snapshot Versioning

Global SAP knowledge must be immutable by snapshot.

Each snapshot contains:

- snapshot ID
- build time
- source versions/checksums
- parser versions
- reviewed knowledge changes
- graph version
- release metadata
- signature/checksum

An analysis references an exact knowledge snapshot.

This ensures a 2026 analysis can be reproduced later even after knowledge updates.

---

## 17.4 Rule Bundle Versioning

Rules are released in signed/versioned bundles.

Bundle includes:

- engine
- bundle version
- rules
- tests
- source evidence
- compatibility matrix
- changelog
- checksum/signature

Production analysis records exact bundle version.

---

## 17.5 Knowledge / Rule Promotion Pipeline

Use environments:

`Draft → Review → Staging → Canary → Production`

Before promotion:
- run full regression corpus;
- compare finding deltas;
- inspect unexpected severity changes;
- verify public SEO impact;
- verify release watches;
- verify customer overrides are unaffected.

No direct edit to production knowledge.

---

## 17.6 Shadow Evaluation

Before new rules/knowledge become active:

Run them in shadow mode against:
- regression corpus;
- recent sanitized analyses where policy allows;
- synthetic fixtures.

Compare:
- new findings
- missing previous findings
- severity changes
- unknown-rate changes
- runtime changes

Do not expose shadow results to customers as active findings.

---

## 17.7 Canary Rollout

Allow controlled release by:
- internal tenants
- selected beta organizations
- percentage
- engine
- region

Monitor:
- false-positive reports
- failure rate
- latency
- finding churn

Automatic rollback threshold can be configured.

---

## 17.8 Rollback

Support immediate rollback of:
- engine version
- rule bundle
- knowledge snapshot
- AI prompt version
- AI model route

Rollback must not erase the history of analyses already run.

---

## 17.9 Finding Stability

When a rule/knowledge update changes a finding:

show:

`Finding changed because rule bundle v2.3 replaced v2.2`

Track:
- previous verdict
- new verdict
- reason
- affected evidence
- migration status

Do not silently mutate historical findings.

---

## 17.10 Knowledge Impact Preview

Before publishing a global knowledge change, show:

- number of public pages affected
- number of saved watches affected
- number of open findings potentially affected
- number of projects potentially requiring reevaluation
- engines affected

Require explicit confirmation for high-blast-radius changes.

---

## 17.11 End-to-End Data Lineage

Every finding must be traceable:

Original Artifact
→ file hash
→ parser/version
→ normalized record
→ rule/version
→ knowledge snapshot
→ graph traversal
→ finding
→ evidence
→ explanation

Provide internal lineage inspector and user-facing simplified trace.

---

## 17.12 Immutable Artifact Hashes

Store cryptographic hashes for:
- original upload
- sanitized upload
- normalized artifact
- report
- reproducibility bundle

This enables audit and tamper detection.

---

## 17.13 Prompt Registry

All AI prompts/templates are versioned assets.

For each:
- purpose
- owner
- model compatibility
- system instructions
- input/output schema
- privacy class
- eval suite
- version
- release status

Never hide prompt changes inside untracked code.

---

## 17.14 Model Registry

Maintain approved AI model registry:

- provider
- model
- version
- region availability
- data handling policy
- supported tasks
- cost
- latency
- benchmark result
- approval status
- deprecation date

Tasks may only call models approved for that data class.

---

## 17.15 AI Change Management

A model upgrade is treated like a production release.

Before switching:
- run eval corpus;
- compare routing accuracy;
- extraction accuracy;
- unsupported-claim rate;
- explanation quality;
- cost/latency;
- security red-team tests.

Roll out via canary.

---

## 17.16 AI Explanation Boundaries

AI explanations may summarize deterministic results, but must not override them.

UI must distinguish:

- `Engine Verdict`
- `AI Explanation`

If they conflict:
- engine verdict wins;
- flag internal quality issue;
- never expose conflicting explanation without warning.

---

## 17.17 AI Output Schema Enforcement

All AI structured responses:
- strict schema
- validation
- retry with constrained correction
- reject malformed outputs
- no direct database write without validated domain command

---

## 17.18 AI Red Team Suite

Create automated adversarial tests for:

- prompt injection
- hidden instructions in XML/PDF/logs
- exfiltration attempts
- role confusion
- cross-tenant data request
- tool escalation
- malicious URL
- instruction to ignore evidence
- fabricated SAP object

Run against important AI workflow changes.

---

## 17.19 AI Agent / Human Identity Attribution

Every analysis/action stores actor type:

- Human User
- API Key
- Service Account
- ERP Preflight Scheduler
- ERP Preflight AI Assistant
- External AI Agent / MCP Client
- Connector

Store:
- actor ID
- delegated user/org
- authentication method
- scopes
- correlation ID

Do not attribute agent activity to a human unless the delegation is explicit.

---

## 17.20 AI Activity Ledger

Maintain append-only ledger for AI-assisted actions:

- request purpose
- model/provider
- tool calls
- data classes accessed
- external systems called
- decisions requiring human approval
- final outcome
- cost
- correlation ID

Raw prompts containing customer secrets should not be retained unless policy permits.

---

## 17.21 Human Oversight Controls

Organization AI policies can require:

- human review for inferred findings
- human approval for externally synchronized task
- human approval for any production write
- dual approval for critical production changes
- deterministic-only mode

---

## 17.22 AI Transparency Center

In product/settings show:

- where AI is used
- what AI does
- what AI does not decide
- providers enabled
- data policy
- model versions
- deterministic alternatives where available

---

## 17.23 Compliance Control Registry

Maintain internal control catalog mapping product controls to evidence.

Examples:
- access control
- audit logging
- encryption
- backup
- incident response
- vulnerability management
- secure SDLC
- AI oversight
- data retention
- supplier management

Use it to prepare for future SOC 2 / ISO 27001 / ISO 42001-style assessments.

Do not claim certification until obtained.

---

## 17.24 Security Evidence Vault

Store internal compliance evidence:

- penetration-test reports
- backup restore test
- access review
- dependency scan
- incident exercise
- policy approvals
- training records
- key rotation evidence

Strict admin access only.

---

## 17.25 Legal Hold

Enterprise admin can place selected:
- project
- audit logs
- reports
- analysis evidence

under legal hold so retention deletion does not remove it until released.

Audit all holds.

---

## 17.26 Data Classification

Classify artifacts/data:

- Public
- Internal
- Confidential
- Restricted

Customer organization can override default classification.

Classification affects:
- AI provider eligibility
- retention
- download permission
- connector mode
- export
- logging

---

## 17.27 Sensitive Data Preview

Before AI-assisted processing of sensitive uploads, optionally show:

- secrets detected
- personal data categories detected
- fields to be redacted
- provider/data-region choice

Allow user to cancel.

---

## 17.28 Quality Release Gate

An engine release cannot reach production if configured minimums fail:

- regression tests
- precision/recall benchmark where applicable
- unknown-rate threshold
- security tests
- performance budget
- compatibility packs

Allow justified override only with privileged approval and audit.

---

## 17.29 Trust Dashboard

Admin dashboard:

- engine quality
- knowledge freshness
- evidence conflicts
- AI eval results
- unsupported claim reports
- stale sources
- canary health
- rollback history
- customer correctness feedback

This dashboard is as important as infrastructure health.

---

## 17.30 Definition of Done

This part is complete only when:
- compatibility matrix exists;
- analysis points to immutable knowledge/rule versions;
- release pipeline supports staging/canary/rollback;
- prompt/model registries exist;
- AI changes run eval gates;
- full data lineage exists;
- historical findings do not silently mutate;
- trust/quality admin dashboards exist.
