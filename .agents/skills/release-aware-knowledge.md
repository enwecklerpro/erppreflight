# Release-Aware Knowledge Base & Rule Lifecycle Governance Playbook

> **Playbook Identifier**: `release-aware-knowledge`  
> **Authority**: Binding architectural specification for knowledge base curation, SPRO/CBC catalogs, deprecation databases, rule bundles, and release lifecycle management.  
> **Governing Standards**: Part 22.6, Part 17 Trust AI, S/4HANA Cloud quarterly release governance.  
> **Anchored Cardinal Axiom**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Points 1, 4, 12 — Versioned Metadata, Pure Rule Reproducibility & Report Lineage)  
> **Applicable Trigger**: Ingesting SAP release notes, updating mapping databases, releasing new rule bundles, or modifying the support matrix.

---

## 1. Overview & Trust Lifecycle Principles

SAP ecosystems evolve continuously: SAP S/4HANA Cloud updates quarterly or semi-annually (e.g. `2402`, `2408`, `2502`), while On-Premise releases ship major versions annually. An architectural recommendation valid for `S4HC_2308` may be deprecated or superseded by a standard API in `S4HC_2408`.

To prevent silent audit degradation and guarantee audit reproducibility, ERP Preflight treats knowledge not as mutable database rows, but as **immutable, cryptographically signed knowledge snapshots**. Historical preflight assessments must remain reproducible for years.

### 1.1 Cardinal Axiom 2 Anchoring: Knowledge Immutability & Audit Defense
This playbook guarantees that **Cardinal Axiom 2** holds over multi-year enterprise migration timelines:
- Deterministic pure evaluation (Point 4) requires that identical inputs produce identical findings today, tomorrow, and years from now.
- By binding all analysis executions to an immutable, cryptographically signed knowledge snapshot (`snapshot_id`) with source checksums (Point 1), this playbook eliminates probabilistic drift and silent rule mutation.


---

## 2. Canonical Compatibility and Support Matrix Specification

The knowledge base maintains an authoritative compatibility matrix mapping enterprise SAP combinations to certification states:

$$\text{Product} \times \text{Edition} \times \text{Release} \times \text{Feature Pack} \times \text{Engine} \times \text{Artifact Type} \to \text{Support Status}$$

### 2.1 Standard Support Statuses
- `SUPPORTED_VERIFIED`: Certification pack passed; automated golden test fixtures verified for this specific target release.
- `SUPPORTED_BETA`: Core rules validated; edge-case coverage currently undergoing shadow evaluation.
- `PARTIAL`: Supported for specific sub-modules or artifact subsets (e.g. FI/CO supported, PP/DS unverified).
- `FILE_MODE_ONLY`: Analysis supported via manual archive/extract upload; live RFC/OData connector sync unsupported.
- `CONNECTOR_MODE_ONLY`: Supported via direct system connector; offline export parser unsupported.
- `NOT_SUPPORTED`: Verified incompatible; preflight analysis rejected gracefully with explanatory feedback.
- `UNKNOWN`: Target release uncertified; findings demoted to `UNKNOWN` confidence.

---

## 3. Immutable Knowledge Snapshot Versioning

### 3.1 Snapshot Immutability Axiom
Production engine executions **NEVER** query live mutable database rows. Analyses bind to an explicit, immutable `snapshot_id`:

```json
{
  "snapshot_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "build_timestamp": "2026-09-24T00:00:00Z",
  "source_checksums": {
    "simplification_list_2023": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "cloud_extensibility_2408": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    "cbc_business_catalog_2408": "9f83c6b12a5b678b87c12f4581290875e7a9128374f671239857129847129837"
  },
  "parser_versions": {
    "abap_ast": "1.4.0",
    "safe_xml": "2.0.1",
    "csv_tabular": "1.1.0"
  },
  "graph_version": "3.1.0",
  "signature": "MEQCIC3b...cryptographic_ecdsa_signature..."
}
```

---

## 4. Signed Rule Bundle Structure & Distribution

Preflight rules are bundled and published as signed, tamper-evident packages:
1. **Engine & Version**: Canonical engine type and semantic version (`v2.3.1`).
2. **Rule Contract**: Pre-compiled AST/DOM expressions with typed input/output constraints.
3. **Source Citations**: Curated list of SAP Note numbers, Help Portal URLs, and release applicability ranges.
4. **Golden Test Fixtures**: Packaged positive and negative test cases.
5. **SHA-256 Digest & Signature**: Signed by the ERP Preflight release key. Engines reject bundles with invalid signatures.

---

## 5. The 5-Stage Promotion Pipeline (Draft to Production)

No rule change or knowledge base update may bypass the 5-stage promotion pipeline:

```text
[ 1. DRAFT ] ----> [ 2. REVIEW ] ----> [ 3. STAGING ] ----> [ 4. CANARY ] ----> [ 5. PRODUCTION ]
Authoring &        Peer review &       Shadow eval          Internal &          Full GA rollout
local fixtures     SAP verification    against corpus       select beta orgs    with instant rollback
```

1. **Stage 1 (Draft)**: Author rule logic and construct local golden test fixtures.
2. **Stage 2 (Review)**: Peer review by SAP domain experts verifying official SAP documentation and Note citations.
3. **Stage 3 (Staging / Shadow Evaluation)**: Execute automated shadow runs across the entire historical preflight customer corpus.
4. **Stage 4 (Canary)**: Deploy to internal dogfood tenants and opt-in beta customers (5%–10% of workload).
5. **Stage 5 (Production)**: Automated worldwide deployment to all customer tenants.

---

## 6. Shadow Evaluation & Finding Stability Tracking

### 6.1 Shadow Evaluation Metrics
During Stage 3, the platform calculates regression deltas across the test corpus:
- **Finding Count Delta ($\Delta F$)**: Total change in findings emitted across all projects.
- **Severity Shifts ($\Delta S$)**: Number of existing findings that changed severity (e.g. `MAJOR` to `CRITICAL`).
- **Unknown Rate ($\Delta U$)**: Change in the proportion of findings marked `UNKNOWN`.
- **Runtime Impact ($\Delta T$)**: Shift in memory and CPU execution duration.

### 6.2 The Finding Stability Axiom
> **Historical preflight assessment findings are NEVER silently mutated in place.**

When a customer re-runs an analysis under a newer rule bundle, the platform records:
$$\text{"Finding updated: Rule bundle v2.3 replaced v2.2 — Rule OPD\_001 condition tightened."}$$
Both the original assessment and the delta report are preserved with complete audit trails.

---

## 7. Knowledge Impact Preview (Blast Radius Analysis)

Before promoting any knowledge snapshot or rule bundle from Staging to Production, the Admin Trust Center must compute the **Blast Radius**:
1. **Public SEO Pages**: Number of public SAP knowledge pages affected.
2. **Customer Projects**: Number of active migration projects referencing affected rules.
3. **Severity Escalations**: Number of findings that will transition to `BLOCKER` or `CRITICAL`.
4. **Authorization Threshold**: If blast radius exceeds 10% of active enterprise projects, deployment requires explicit sign-off from the Lead SAP Solution Architect.

---

## 8. End-to-End Cryptographic Data Lineage

Every finding links back to its complete epistemic lineage:
```text
Finding (UUID)
  ├── Rule ID: OPD_PRINTER_STEP_MISSING (v2.3.0)
  ├── Rule Bundle Hash: sha256:7b9a...
  ├── Knowledge Snapshot: 9b1deb4d-3b7d...
  │     ├── SAP Simplification Note 2267880 (sha256:a1b2...)
  │     └── Cloud Extensibility Directory 2408 (sha256:c3d4...)
  └── Ingested Artifact: opd_rules.xml (sha256:e5f6...)
```

---

## 9. Non-Negotiable Governance Invariants

1. **Snapshot Immutability**: Production analyses must bind to an immutable `snapshot_id`. Live database mutations during analysis are prohibited.
2. **No Silent Mutation**: Historical findings must never be overwritten in place when rules change.
3. **Certification Requirement**: A release status cannot be set to `SUPPORTED_VERIFIED` without passing its automated certification pack.
4. **Mandatory 5-Stage Pipeline**: All knowledge updates must progress through Draft, Review, Staging, Canary, and Production.
5. **Signed Bundles**: Rule bundles must carry a valid SHA-256 signature to be loaded by production engines.

### 9.1 Strictly Forbidden Competing Libraries & Patterns (Part 21.42 & AGENTS.md §4.2)
Knowledge curation and storage must adhere to strict reproducibility standards:
- ❌ **Database ORM**: `prisma`, `typeorm`, `sequelize`, or ad-hoc NoSQL/graph DB drivers (e.g. `neo4j-driver`) without an accepted ADR (Standard: PostgreSQL via `drizzle-orm`).
- ❌ **Mutable In-Place Updates**: Executing SQL `UPDATE` scripts directly against historical knowledge rows (Standard: Append-only immutable knowledge snapshots identified by cryptographic `snapshot_id`).
- ❌ **Dynamic Code Execution**: `eval()` or `exec()` for dynamically evaluating untrusted remote rule strings (Standard: Declarative AST/table rule schemas with version pinning).

---

## 10. Forbidden Anti-Patterns

- ❌ **Anti-Pattern**: Running SQL `UPDATE sap_knowledge_table SET description = ...` directly in production.  
  *Violation*: Destroys audit reproducibility for historical assessments.  
  *Correction*: Cut a new immutable knowledge snapshot and promote through the 5-stage pipeline.

- ❌ **Anti-Pattern**: Deploying a rule update without running shadow evaluation across the test corpus.  
  *Violation*: Risks massive false-positive spikes across thousands of customer projects.  
  *Correction*: Run Stage 3 shadow evaluation to calculate $\Delta F$ and $\Delta S$.

- ❌ **Anti-Pattern**: Silently re-running an old analysis and presenting different results to a customer without version delta indicators.  
  *Violation*: Violates audit defense standards.  
  *Correction*: Present comparison view showing findings under Snapshot A vs Snapshot B.
