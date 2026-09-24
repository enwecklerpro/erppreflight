# Part 20 — Secure Software Supply Chain, AI Regulatory Readiness and Enterprise Assurance

This part is binding and extends Parts 00–19.

ERP Preflight must be built so that enterprise customers can assess not only the product features, but also how the product itself is built, updated, governed and operated.

---

## 20.1 Secure SDLC Program

Maintain a documented secure software development lifecycle covering:

- architecture review
- threat modeling
- coding standards
- dependency review
- secret management
- peer review
- automated tests
- security scans
- release approval
- incident learning

Security-sensitive areas require explicit CODEOWNERS/reviewer ownership.

---

## 20.2 Branch Protection and Review Policy

Production branches require:

- passing CI
- required reviews
- no direct force push
- no unresolved critical security scan
- signed/provenance-aware release workflow where supported

Security-sensitive modules can require two reviewers.

---

## 20.3 Build Provenance

For each production release record:

- Git commit
- builder/workflow
- dependency lock state
- build timestamp
- container digest
- SBOM
- test summary
- security scan summary

Generate machine-readable provenance artifacts where practical.

---

## 20.4 Signed Release Artifacts

Sign:
- production container images
- local-agent installers/packages
- offline knowledge bundles
- rule bundles where practical

Verify signature before deployment/update.

Use modern signing tooling such as Sigstore/Cosign or an equivalent trusted mechanism.

---

## 20.5 SBOM

Generate CycloneDX or SPDX SBOM for every production release.

Track:
- package
- version
- license
- source
- known vulnerability state

Expose enterprise SBOM summary/request workflow.

---

## 20.6 Vulnerability Management

Maintain vulnerability lifecycle:

- detected
- triaged
- severity
- affected release
- owner
- remediation target
- fixed release
- customer communication if required

Define internal patch SLAs by severity.

Do not claim a public SLA until contractually approved.

---

## 20.7 Dependency Risk Policy

Block or require review for:
- unmaintained critical dependency
- package with unresolved critical CVE
- dependency with incompatible license
- package installed from untrusted source
- floating/unpinned production dependency

Maintain allow/deny exceptions with expiration.

---

## 20.8 Container Hardening

Production images:
- minimal base
- non-root user
- read-only filesystem where possible
- no build tools if unnecessary
- no embedded secrets
- pinned digest/base
- vulnerability scan
- healthcheck

---

## 20.9 Infrastructure Policy as Code

Validate Terraform/Kubernetes/container configuration in CI.

Checks:
- public exposure
- encryption
- overly permissive security groups
- privileged container
- missing resource limits
- secret misuse
- storage/public bucket settings

---

## 20.10 Threat Modeling

Maintain threat models for:

- multitenancy
- file upload
- AI gateway
- MCP server
- local agent
- SAP connector
- admin impersonation
- webhooks
- plugin sandbox
- object storage
- knowledge ingestion

Review threat model after material architecture changes.

---

## 20.11 Penetration Testing Program

Prepare for:
- periodic external pentest
- remediation tracking
- retest
- executive summary
- customer evidence under NDA where appropriate

Do not claim pentest status until performed.

---

## 20.12 Responsible Disclosure

Public security policy:
- reporting channel
- supported disclosure process
- encryption/contact options
- acknowledgement workflow

Do not require a paying account to report a vulnerability.

---

## 20.13 Security Incident Response

Maintain plan:
1. detect
2. contain
3. preserve evidence
4. assess tenant scope
5. eradicate
6. recover
7. notify as required
8. postmortem
9. preventive actions

Exercise via tabletop simulation.

---

## 20.14 AI System Inventory

Maintain internal inventory for every AI-assisted feature:

- feature
- purpose
- provider/model
- data classes processed
- user population
- automation level
- human oversight
- deterministic fallback
- deployment regions
- owner
- risk assessment
- last review

This inventory is distinct from the external-agent inventory.

---

## 20.15 AI System Card

For each material AI feature create a system/model-use card documenting:

- intended use
- prohibited use
- inputs
- outputs
- limitations
- evaluation results
- human oversight
- security controls
- privacy/data flow
- monitoring
- escalation

Make customer-facing summaries available where useful.

---

## 20.16 AI Risk Classification Workflow

Create internal process to classify AI features by applicable product/legal risk categories.

The platform must not automatically declare itself legally compliant.

Store:
- assessment
- reviewer
- jurisdiction
- date
- rationale
- next review

Flag legal review where needed.

---

## 20.17 AI Human Oversight Evidence

For AI-assisted decisions that matter operationally, record:

- whether human review was required
- reviewer
- decision
- override
- reason
- timestamp

Measure whether review controls are actually being used.

---

## 20.18 Automation-Bias UX

Design UI so users do not blindly accept AI output.

Requirements:
- show evidence before recommendation
- distinguish verified vs inferred
- easy reject/override
- do not visually overstate AI confidence
- require review for uncertain high-impact outputs

---

## 20.19 AI Incident Management

Track AI-specific incidents:

- materially incorrect recommendation
- prompt injection success
- cross-tenant exposure
- unsafe tool invocation
- provider policy violation
- hallucinated object causing customer impact

Link incident to:
- model
- prompt version
- engine
- affected analyses
- remediation

---

## 20.20 AI Literacy and Internal Training Records

For staff/admins who:
- approve AI changes
- curate knowledge
- operate support
- handle customer data

maintain internal training material and completion records.

This supports responsible operations and future assurance work.

---

## 20.21 AI Provider Due Diligence Registry

For every AI provider:

- contract/DPA status
- data retention
- training/data-use policy
- regions
- subprocessors
- security certifications
- model lifecycle/deprecation
- incident contact
- approved data classes

Provider cannot be enabled for Restricted data without approval.

---

## 20.22 AI Provider Exit Plan

Avoid provider lock-in.

Maintain:
- prompt portability
- schema portability
- eval corpus
- fallback provider
- model routing abstraction
- customer data export/delete process

Test fallback periodically.

---

## 20.23 Compliance Readiness Control Map

Maintain internal mapping to common enterprise frameworks where relevant:

- ISO/IEC 27001
- SOC 2 trust criteria
- ISO/IEC 42001
- GDPR controls
- NIST AI RMF-style governance
- customer security questionnaire topics

This is a readiness/evidence map, not a certification claim.

---

## 20.24 Trust Center

Public Trust Center page should provide verified current information about:

- security architecture
- data handling
- AI usage
- subprocessors
- privacy
- regions
- uptime/status
- certifications actually obtained
- penetration testing statement if true
- responsible disclosure
- DPA/security contact

Never show aspirational certifications as completed.

---

## 20.25 Security Questionnaire Library

Admin/commercial team can maintain reusable reviewed answers for common customer questionnaires.

Each answer:
- owner
- last reviewed
- evidence link
- approved wording

Do not generate unreviewed compliance answers directly with an LLM.

---

## 20.26 Customer Security Review Workspace

For enterprise deals, create shareable controlled workspace containing selected:

- architecture diagram
- data flow
- security overview
- DPA
- subprocessor list
- SBOM summary
- backup/DR statement
- AI data handling
- audit logging summary
- penetration test executive summary when available

Access can expire.

---

## 20.27 Records Retention Matrix

Define retention by record type:

- customer artifact
- analysis
- audit event
- AI activity
- security event
- billing
- support
- legal hold
- backup

Support tenant policy where legally/contractually appropriate.

---

## 20.28 Tamper-Evident Critical Audit

For critical audit categories:
- append-only design
- cryptographic hash chaining or equivalent tamper-detection strategy
- restricted deletion
- export verification

Do not claim immutable/WORM compliance unless technically and contractually implemented.

---

## 20.29 Time Synchronization

Distributed audit evidence requires reliable time.

Use:
- UTC canonical timestamps
- synchronized infrastructure clocks
- clear local-time display only at UI layer

Preserve timezone metadata where imported source timestamps matter.

---

## 20.30 Backup Integrity Verification

Backups are not considered successful only because a job returned success.

Periodically:
- restore
- verify integrity
- verify critical records
- record evidence

---

## 20.31 Secure Decommission of Infrastructure

When an environment/resource is removed:
- revoke secrets
- revoke certificates
- delete data according to policy
- remove DNS/routes
- update inventory
- audit completion

---

## 20.32 Vendor / Subprocessor Lifecycle

Track vendors:

- service
- data accessed
- region
- DPA
- risk review
- owner
- start/end
- replacement plan

Subprocessor changes feed customer notification workflow where required.

---

## 20.33 Business Continuity Exercise

Run periodic scenario exercises:

- primary cloud region unavailable
- AI provider unavailable
- database corruption
- leaked connector credential
- global bad knowledge release
- object storage incident

Record lessons and actions.

---

## 20.34 Knowledge Release as Security Event

A bad global knowledge/rule release can create systemic incorrect advice.

Treat high-blast-radius knowledge changes similarly to production software changes:
- approval
- canary
- rollback
- incident response

---

## 20.35 Public Accuracy Language

Marketing must not state:
- “100% accurate”
- “guaranteed SAP compliance”
- “zero-risk migration”

unless such a claim is objectively supportable, which is unlikely.

Use precise claims:
- evidence-backed
- deterministic where possible
- release-aware
- verified against supported fixtures

---

## 20.36 Definition of Done

This part is complete only when:
- software releases have provenance/SBOM/signing strategy;
- vulnerability/security governance is operational;
- AI inventory/system cards exist;
- AI provider due diligence exists;
- Trust Center architecture exists;
- compliance-readiness evidence is organized;
- critical audit/data-retention policies are implemented;
- business-continuity/security exercises have runbooks.
