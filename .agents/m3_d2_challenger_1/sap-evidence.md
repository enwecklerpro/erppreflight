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


---

## 2. Release-Specific Scoping & Non-Generalization Axiom

### 2.1 Release Environment Taxonomy
SAP software architectures vary fundamentally across product families and release versions:
1. **SAP S/4HANA Cloud, Public Edition** (e.g. `S4HC_2402`, `S4HC_2408`, `S4HC_2502`): Strictly closed runtime. No direct classic ABAP, no table modification, only released Tier 1 C1 APIs and Key-User extensibility.
2. **SAP S/4HANA Cloud, Private Edition**: Allows Tier 1, Tier 2, and transitional Tier 3 extensions under controlled governance.
3. **SAP S/4HANA On-Premise** (e.g. `S4H_2020`, `S4H_2021`, `S4H_2022`, `S4H_2023`): Classic ABAP runtime with optional ABAP Cloud.
4. **SAP ECC 6.0** (EhP 0 through EhP 8): Legacy NetWeaver runtime. Direct database mutations and classic user exits standard.

### 2.2 The Non-Generalization Axiom
> **A capability, BAdI, API, database table, or configuration valid in SAP On-Premise or Private Cloud must NEVER be assumed to exist or be permitted in SAP S/4HANA Public Cloud.**

Every rule evaluation must explicitly check the target release. Extrapolating behavior across release boundaries without official Cloud Extensibility Directory verification is strictly forbidden.

### 2.3 Release Alignment States & Penalty Multipliers
- `RELEASE_ALIGNED` (Multiplier: `1.0`): Evidence explicitly verified for the target product release.
- `RELEASE_PREMATURE` (Multiplier: `0.0`): Feature requires a future release or uninstalled feature pack.
- `RELEASE_DEPRECATED` (Multiplier: `0.0`): Feature was deprecated or removed prior to or in the target release.
- `FAMILY_MISMATCH` (Multiplier: `0.5`): On-premise evidence applied to a Cloud target without cloud qualification.
- `UNKNOWN` (Multiplier: `0.3`): Release version cannot be verified.

---

## 3. Clean Core Extensibility Tiers (Tier 1 / Tier 2 / Tier 3)

All analyzed custom objects, enhancements, and preflight findings must be categorized according to SAP's Clean Core Extensibility Model:

```text
+-------------------------------------------------------------------------------+
| TIER 1: CLOUD EXTENSIBILITY                                                   |
| - Key-User Extensibility (Custom Fields & Logic, Custom Business Objects)     |
| - Developer Extensibility (ABAP Cloud, Released APIs: Contract C1)            |
| - Side-by-Side Extensibility on SAP BTP                                       |
| Clean Core Status: FULLY COMPLIANT                                            |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| TIER 2: CONTROLLED DEVELOPER EXTENSIBILITY                                    |
| - Custom wrappers around unreleased SAP standard APIs                         |
| - Decoupled ABAP custom code with clean interface isolation                   |
| Clean Core Status: TRANSITIONAL (Requires documented migration refactoring)   |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| TIER 3: CLASSIC EXTENSIBILITY                                                 |
| - Direct standard table mutations (INSERT/UPDATE/DELETE on BSEG, MARA, etc.)  |
| - Classic User Exits, BAdIs without release contract                          |
| - Modifications to standard SAP code via SSCR keys                            |
| Clean Core Status: PROHIBITED (Hard Migration Blocker)                        |
+-------------------------------------------------------------------------------+
```

---

## 4. Authoritative Source Trust Hierarchy & Numerical Scoring

The evidence subsystem assigns fixed trust weights ($T_k$) based on the epistemic authority of the source:

| Source Type | Trust Weight ($T_k$) | Description |
|---|---|---|
| **Official SAP Metadata** | `1.00` | Released CDS views, official BAPI contracts, C1 release state directory. |
| **Official SAP Documentation** | `0.95` | SAP Help Portal, official S/4HANA Cloud product documentation. |
| **Official SAP Support Notes / KBAs** | `0.90` | SAP Simplification List, Release notes, Central Support Notes. |
| **Curated ERP Preflight Rules** | `0.85` | Deterministic rules curated and regression-tested by domain specialists. |
| **Official SAP Community Articles** | `0.70` | Blogs authored by SAP product managers and verified community experts. |
| **Third-Party Technical References** | `0.60` | Verified external books, technical whitepapers, partner guides. |
| **Customer Uploaded Artifact Evidence**| `0.50` | Raw customer extracts (ABAP source, XML dumps, spool files). |
| **Inferred / Heuristic Analysis** | `0.30` | Statistical pattern detection or AI router recommendations. |

---

## 5. Composite Trust Score Formula & Multi-Evidence Synergy

When a finding is substantiated by evidence items $E_1, E_2, \dots, E_n$ with trust weights $T_k \in [0.10, 1.00]$, the composite trust score is calculated with single-source identity preservation and monotonic synergy compounding:

$$\text{Trust}_{\text{composite}} = \begin{cases} 
0.30 & \text{if } n = 0 \\
\max_k(T_k) & \text{if } n = 1 \\
\max_k(T_k) + (1.0 - \max_k(T_k)) \times \left(1 - \prod_{k=1}^n (1 - 0.20 \cdot T_k)\right) & \text{if } n \ge 2
\end{cases}$$

Subject to the strict bounds:
$$\max_k(T_k) \le \text{Trust}_{\text{composite}} \le 1.00$$

### 5.1 Multi-Evidence Synergy Property
- **Single Source Integrity**: An official SAP metadata finding ($T_1 = 1.00$) or curated rule ($T_1 = 0.85$) retains its authoritative weight without artificial discounting.
- **Corroborating Lift**: When raw customer evidence ($T_1 = 0.50$) is corroborated by a Curated Preflight Rule ($T_2 = 0.85$) and an official SAP Simplification Note ($T_3 = 0.90$), $\max(T_k) = 0.90$. The compound synergy factor ($S \approx 0.387$) elevates the confidence into the remaining $0.10$ headroom:
  $$0.90 + (1.0 - 0.90) \times 0.387 = 0.9387 \approx 0.94$$
- **Monotonicity Guarantee**: A composite score can **never** drop below the highest verified input score.

```typescript
// packages/evidence/src/classifier.ts
export function calculateCompositeTrustScore(sourceScores: number[]): number {
  if (!sourceScores || sourceScores.length === 0) return 0.30;

  const maxScore = Math.max(...sourceScores);
  // Invariant: Never slash or discount a single verified source
  if (sourceScores.length === 1) return maxScore;

  let compoundProduct = 1.0;
  for (const score of sourceScores) {
    compoundProduct *= (1.0 - 0.20 * score);
  }

  // Multi-source synergy: Corroboration elevates score into remaining headroom
  const synergy = 1.0 - compoundProduct;
  const composite = maxScore + (1.0 - maxScore) * synergy;

  return Math.min(1.0, Math.max(maxScore, Math.round(composite * 100) / 100));
}
```

---

## 6. Provenance Tracking & Cryptographic Snippet Verification

### 6.1 Cryptographic Pointer Integrity
Every evidence item must record:
1. `artifactPath`: Repository or project-relative path of the ingested file.
2. `lineNumber`: 1-indexed line where the defect or reference starts.
3. `columnNumber`: 1-indexed column offset.
4. `snippet`: Verbatim string extracted from the file.
5. `sha256`: Cryptographic SHA-256 hash of the exact snippet text.

### 6.2 Verification Function
```typescript
// packages/evidence/src/verifier.ts
import { createHash } from 'node:crypto';

export function verifyEvidenceSnippet(
  fileContent: string,
  snippet: string,
  expectedSha256?: string
): boolean {
  if (!fileContent.includes(snippet)) {
    return false;
  }
  if (expectedSha256) {
    const actualHash = createHash('sha256').update(snippet, 'utf-8').digest('hex');
    return actualHash === expectedSha256;
  }
  return true;
}
```

---

## 7. The UNKNOWN Confidence Rules & Absence Invariant

### 7.1 The Absence Invariant
> **The absence of an object, table, or configuration in an incomplete customer export does NOT prove that it does not exist in standard SAP.**

When analyzing customer extracts:
- If a customer upload contains custom ABAP calling a function module not found in the upload, the engine must **not** claim "Function module does not exist in SAP". It must verify against the official standard release metadata.
- If the target release metadata is missing or the customer export is partial, the finding must be marked `UNKNOWN` with confidence score `0.30`.

### 7.2 Automatic Demotion Triggers
A finding is unconditionally demoted to `UNKNOWN` when:
1. The evidence pointer lacks an exact line number or snippet.
2. The snippet cannot be verified against the ingested artifact.
3. The rule targets a release for which ERP Preflight lacks verified metadata.

---

## 8. TypeScript & Python Implementation Specifications

```typescript
// packages/evidence/src/classifier.ts
import { ConfidenceClass, ProvenanceClassificationOptions, ProvenanceResult } from './types';

export function classifyProvenance(options: ProvenanceClassificationOptions): ProvenanceResult {
  const { hasEvidence, isExactParserOrAstMatch, isDeterministicRule, isLlmAssisted } = options;

  // Rule 1: Missing evidence unconditionally demotes to UNKNOWN
  if (!hasEvidence) {
    return { confidence: 'UNKNOWN', score: 0.30 };
  }

  // Rule 2: LLM outputs are strictly capped at INFERRED
  if (isLlmAssisted) {
    return { confidence: 'INFERRED', score: 0.60 };
  }

  // Rule 3: Exact parser AST or DOM match yields VERIFIED
  if (isExactParserOrAstMatch) {
    return { confidence: 'VERIFIED', score: 1.0 };
  }

  // Rule 4: Deterministic rule combination yields RULE_DERIVED
  if (isDeterministicRule) {
    return { confidence: 'RULE_DERIVED', score: 0.85 };
  }

  return { confidence: 'INFERRED', score: 0.60 };
}
```

---

## 9. Non-Negotiable Evidence Invariants

1. **No Cross-Release Generalization**: Never assume On-Premise compatibility applies to Public Cloud.
2. **Mandatory Cryptographic Evidence**: Every finding must possess verifiable line numbers, code snippets, and SHA-256 hashes.
3. **Absence Rule**: Never assert standard SAP behavior based solely on missing customer extract data without cross-referencing official metadata.
4. **Mandatory Clean Core Tiering**: Every preflight finding affecting custom code or configuration must be tagged with its Clean Core tier (`TIER_1_CLOUD`, `TIER_2_DEVELOPER`, or `TIER_3_CLASSIC`).
5. **Epistemic Honesty**: Demote to `UNKNOWN` whenever release metadata is incomplete or evidence cannot be cryptographically verified.

### 9.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
Evidence representation and trust scoring must adhere to strict deterministic standards:
- ❌ **Schema Validation**: `joi`, `yup` for evidence structures (Standard: `@erppreflight/evidence` with `zod` 4 in TS and `pydantic` v2 in Python).
- ❌ **Non-Cryptographic Hashing**: MD5, SHA-1, or non-cryptographic hashes (`murmurhash`, `crc32`) for audit evidence (Standard: SHA-256 via standard Node `crypto` / Python `hashlib`).
- ❌ **Probabilistic Classifiers**: Probabilistic ML clustering or LLMs for `VERIFIED` or `RULE_DERIVED` confidence classification (Standard: Pure deterministic rule logic; AI is strictly capped at `INFERRED` 0.60).

---

## 10. Forbidden Anti-Patterns

- ❌ **Anti-Pattern**: Claiming that an ABAP report is "S/4HANA Cloud Compatible" without checking C1 release contracts of called APIs.  
  *Violation*: Direct violation of the Non-Generalization Axiom.  
  *Correction*: Inspect every called API against the Cloud Extensibility Directory before classifying as Tier 1.

- ❌ **Anti-Pattern**: Inventing SAP transaction codes or assuming GUI transactions exist in Fiori-only environments.  
  *Violation*: Recommending `SPRO` or `SE38` in S/4HANA Public Cloud where they are completely blocked.  
  *Correction*: Map legacy transactions to their Fiori app or CBC configuration equivalent.

- ❌ **Anti-Pattern**: Emitting a finding with `confidence: "VERIFIED"` based on an LLM inference.  
  *Violation*: Breaches the Trust AI policy and Part 17 confidence rules.  
  *Correction*: Cap LLM-assisted findings at `INFERRED` (`0.60`).
