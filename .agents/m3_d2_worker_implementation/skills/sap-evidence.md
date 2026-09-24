# SAP Evidence, Fact Verification, and Provenance Playbook

> **Playbook Identifier**: `sap-evidence`  
> **Authority**: Binding architectural specification for evidence extraction, Clean Core classification, trust scoring, and release alignment.  
> **Governing Standards**: Part 22.5, Part 17 Trust AI, SAP Clean Core Extensibility Model, packages/evidence.  
> **Anchored Cardinal Axiom**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Points 5, 6, 7 — Taxonomy, Cryptographic Evidence & Epistemic Confidence)  
> **Applicable Trigger**: Collecting evidence, establishing source citations, calculating confidence, classifying Clean Core tiers, or aligning releases.

---

## 1. Overview & Trust Philosophy

ERP Preflight is built on an uncompromising standard of technical truth: **every assertion about an SAP system, code artifact, or configuration must be backed by concrete evidence and verified against authoritative release metadata.**

In enterprise SAP migrations, vague warnings or unsubstantiated claims erode stakeholder confidence and lead to expensive architectural blunders. This playbook defines how evidence is extracted, cryptographically bound, classified under Clean Core principles, and scored for epistemic trust.

### 1.1 Cardinal Axiom 2 Anchoring: Cryptographic Grounding & Epistemic Honesty
This playbook operationalizes Points 5, 6, and 7 of **Cardinal Axiom 2** (`AGENTS.md` Section 1):
- **Point 5 (Finding Taxonomy)**: Every defect must map to a deterministic, structured finding code.
- **Point 6 (Cryptographic Evidence Chains)**: Every finding must reference concrete evidence items containing artifact path, exact line and column numbers, code snippet, artifact SHA-256 hash, and provenance score. Unsubstantiated warnings are strictly forbidden.
- **Point 7 (Confidence Classification)**: Explicit assignment to one of four strict classes: `VERIFIED` (1.0), `RULE_DERIVED` (0.85), `INFERRED` (0.60), or `UNKNOWN` (0.30). LLM assistance is strictly capped at `INFERRED` (0.60), and missing evidence triggers automatic demotion to `UNKNOWN` (0.30).
