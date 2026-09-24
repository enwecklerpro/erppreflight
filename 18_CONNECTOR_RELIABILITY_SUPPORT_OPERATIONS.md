# Part 18 — Connector Governance, Multi-Tenant Reliability, Support and Commercial Operations

This part is binding and extends Parts 00–17.

---

## 18.1 Connector Capability Handshake

When connecting an SAP/external system, perform a capability handshake.

Detect/store:
- product
- edition
- release
- available APIs
- connector protocol
- granted scopes
- read/write capabilities
- supported ERP Preflight engines
- region
- connector health

Show:
`What ERP Preflight can read from this connection`

and:
`What ERP Preflight cannot access`

Do not discover/collect more than required.

---

## 18.2 Least-Privilege Connection Wizard

For each connector provide:

- exact permissions/scopes needed
- why each is needed
- read vs write
- optional scopes
- production risk
- test connection

Default to read-only.

Prefer:
- OAuth2
- certificate-based authentication
- short-lived tokens

Avoid long-lived username/password where stronger mechanisms exist.

---

## 18.3 Connector Permission Diff

When connector credentials/scopes change:

show:
- permissions added
- removed
- engine capabilities gained/lost
- risk increase

Alert on unexpected write scope.

---

## 18.4 Production Write Safety

ERP Preflight is analysis/read-first.

Any write-capable connector action requires:

1. feature enabled
2. correct role/scope
3. policy allows action
4. preview/dry run if possible
5. explicit user confirmation
6. audit event

Critical production writes can require dual approval.

No AI agent can bypass this.

---

## 18.5 Write Action Registry

Every possible external write action is declared:

- connector
- action
- target object
- required permission
- reversible?
- dry-run supported?
- approval policy
- risk class

Unregistered write actions are prohibited.

---

## 18.6 Certificate Lifecycle

For client certificates:
- expiration monitoring
- warning schedule
- rotation workflow
- health check
- issuer/subject metadata
- no private key display

---

## 18.7 Local Agent Device Management

Admin needs:

- enrolled devices
- version
- region
- last seen
- certificate
- health
- capabilities
- assigned org
- update channel
- revoke device

Local agent uses mTLS/device identity.

---

## 18.8 Signed Local Agent Updates

Local agent updates:
- signed artifacts
- checksum verification
- staged rollout
- rollback
- auto-update policy
- offline bundle option

Never execute unsigned updates.

---

## 18.9 Tenant Resource Isolation

Prevent noisy-neighbor behavior.

Implement:
- per-plan concurrency
- per-tenant queue limits
- CPU/memory limits for heavy jobs
- file size limits
- API rate limits
- fair scheduling
- enterprise priority lanes where sold

One customer's 50 GB MFS log must not block all other tenants.

---

## 18.10 Job Priority and Fairness

Priorities:
- interactive
- standard
- scheduled
- batch
- enterprise critical

Use fair scheduling.

Prevent one tenant from monopolizing workers.

---

## 18.11 Job Cancellation

Users can cancel supported jobs.

Workers must periodically honor cancellation.

Clean temporary files safely.

---

## 18.12 Capacity Planning

Admin forecasts:
- analysis volume
- queue wait time
- storage growth
- AI spend
- database growth
- search index
- graph size

Set capacity alerts before saturation.

---

## 18.13 SLOs

Define measurable internal SLOs:

Examples:
- web availability
- API availability
- queue start latency
- interactive analysis completion percentile
- notification delivery
- knowledge freshness

Track error budgets.

Do not publish SLA promises without operational evidence.

---

## 18.14 Customer SLA Plans

Enterprise contracts may configure:
- support hours
- response target
- uptime target
- data retention
- support channel
- named contacts

Product must support plan metadata without hardcoding legal commitments.

---

## 18.15 Incident Severity

Define:
- SEV1 Critical
- SEV2 High
- SEV3 Medium
- SEV4 Low

Runbook per severity.

SEV1 examples:
- cross-tenant data exposure
- production outage
- corrupted global knowledge producing systemic false results
- compromised connector secret

---

## 18.16 Customer Incident Communication

Support:
- in-app banner
- email
- status page
- incident timeline
- postmortem link

Keep technical internal details private while providing useful customer updates.

---

## 18.17 Support Access Grant

Support staff do not get permanent access to customer data.

Customer can grant:
- project access
- time window
- read-only
- specific artifacts

Grant expires automatically.

Audit every support access.

---

## 18.18 Diagnostic Bundle

Customer/admin can generate sanitized support bundle:

- app version
- engine versions
- analysis ID
- job state
- connector health
- sanitized logs
- artifact metadata/hashes
- no secrets

This reduces back-and-forth.

---

## 18.19 Support Entitlements

Support experience varies by plan:
- community/docs
- standard ticket
- priority
- enterprise

The product enforces entitlement but never blocks security vulnerability reporting.

---

## 18.20 Customer Success Workspace

For Team/Enterprise:
- onboarding checklist
- configured modules
- first-value milestones
- usage/adoption
- inactive features
- success goals
- upcoming renewal metadata

Useful for internal customer-success staff.

---

## 18.21 Organization Health Score

Internal admin-only health score can combine:
- activation
- project usage
- successful analyses
- support volume
- unresolved billing
- key feature adoption

Do not pretend this is an objective customer-quality score.

---

## 18.22 Pricing and Entitlement Experiments

Support controlled experiments for:
- trial length
- usage limits
- packaging
- onboarding
- CTA

Never change contracted enterprise entitlements through an experiment.

---

## 18.23 Quote / Enterprise Deal Metadata

Admin can track:
- negotiated plan
- seats
- usage credits
- start/end
- renewal
- PO number
- billing contact
- support tier

This is not a full CRM; integrate with CRM later.

---

## 18.24 Tax and Invoice Readiness

Billing architecture must support:
- VAT IDs
- tax location
- tax-exempt status
- invoice address
- currency
- credit notes
- invoice PDF/provider reference

Use billing/tax provider where appropriate.

Do not implement tax law manually.

---

## 18.25 Data Export Before Offboarding

Before organization deletion:
- offer export
- warn of irreversible deletion
- honor legal hold
- revoke connectors/API keys
- revoke local agents
- schedule deletion

Generate deletion audit receipt.

---

## 18.26 Tenant Deletion Workflow

Deletion must include:
- DB tenant data
- object storage
- search
- graph projection
- caches
- connector secrets
- webhooks
- local agent certs

Track completion across subsystems.

---

## 18.27 Chaos / Failure Testing

Regularly test:
- Redis unavailable
- worker crash
- AI provider timeout
- object storage unavailable
- search unavailable
- knowledge sync broken
- database failover
- connector endpoint down

Ensure graceful degradation.

---

## 18.28 Degraded Modes

Examples:
- AI unavailable → deterministic analyses continue
- semantic search unavailable → exact search remains
- Neo4j unavailable → use canonical PostgreSQL traversal with limits
- connector unavailable → file mode remains

Avoid whole-platform outage from optional subsystems.

---

## 18.29 Compatibility Lifecycle

When ERP Preflight drops support for an old artifact/version:

- announce
- mark deprecated
- give migration path
- maintain policy
- expose EOL date
- prevent silent breakage

---

## 18.30 Definition of Done

This part is complete only when:
- connector capability/permissions are transparent;
- write actions are registry-controlled;
- local agent/device lifecycle is secure;
- tenant resource isolation exists;
- SLO/support architecture exists;
- customer support access is time-bound;
- deletion/offboarding is complete across subsystems;
- degraded modes are tested.
