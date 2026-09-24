# Handoff Report: Milestone 2 Shared Platform Services Technical Exploration

**Agent**: `m2_explorer_3`  
**Role**: Teamwork Explorer (Read-only investigation & synthesis)  
**Task**: Shared Platform Services (Evidence Engine, Tamper-Evident Audit Trail, and AI Problem Router with Pluggable LLM Gateway)  
**Target Blueprint**: `H:/erppreflight/.agents/m2_explorer_3/platform_services_plan.md`  
**Date**: 2026-09-24  
**Type**: Hard Handoff  

---

## 1. Observation

1. **Monorepo Contracts and Specifications**:
   - `H:/erppreflight/.agents/orchestrator_main/PROJECT.md` (lines 30, 54-57): Invariant 3 dictates that "Every finding MUST be backed by an immutable `Evidence` record with a cryptographic SHA-256 hash and classified into one of 4 strict confidence classes: `VERIFIED` (1.0), `RULE_DERIVED` (0.85), `INFERRED` (0.60), `UNKNOWN` (0.30). LLM outputs can NEVER exceed `INFERRED` (0.60)."
   - `H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md` (lines 32-35, 1470-1605): Section 20 specifies the Evidence Engine (trust scoring 1.0 vs 0.50, release alignment `validFromRelease` $\le$ Target Release $\le$ `validToRelease`, SHA-256 hashes); Section 22 defines the AI Problem Router (deterministic routing of XDP $\rightarrow$ FormDoctor, OPD $\rightarrow$ OPD Guard, ABAP $\rightarrow$ Clean Core); Section 23 defines the Audit Trail with cryptographic hash chaining $eventHash = \text{SHA256}(previousEventHash + eventId + tenantId + action + timestamp + details)$ and append-only database immutability.
   - `H:/erppreflight/17_TRUST_AI_KNOWLEDGE_RELEASE_GOVERNANCE.md` (lines 207-350): Mandates full data lineage, immutable artifact hashes, prompt registries, model registries, explicit distinction between engine verdict and AI explanation, and strict human vs AI actor attribution.

2. **Existing Implementation Status**:
   - `packages/evidence/src/chain.ts` (lines 6-15): Contains rudimentary `computeAuditNodeHash(prevHash, timestamp, tenantId, action, payloadHash)`.
   - `packages/evidence/src/classifier.ts` (lines 12-37): Contains initial `classifyProvenance()` checking `hasEvidence`, `isLlmGenerated`, `isExactParserOrAstMatch`, and `isDeterministicRule`.
   - `packages/evidence/src/hashing.ts` (lines 6-19): Contains `calculateSha256()` and `createFindingFingerprint()`.
   - `services/analysis-python/src/platform/confidence.py` (lines 12-64): Implements `ConfidenceClassifier.classify()` enforcing `UNKNOWN` (0.30) when evidence is missing and `INFERRED` (0.60) ceiling on AI-generated findings.
   - `services/analysis-python/src/platform/evidence.py` (lines 7-40): Implements basic `EvidenceEngine` computing SHA-256 for strings/bytes, but lacking granular offset tracking, release validation, and composite trust aggregation.
   - `packages/database/migrations/001_initial_schema.sql` (lines 130-173): Defines initial `evidence` table and `audit_events` table (`id`, `organization_id`, `actor_id`, `action`, `target_type`, `target_id`, `payload`, `prev_hash`, `current_hash`, `created_at`), but lacks trigger-enforced immutability, actor type attribution, and detailed offset coordinate fields.
   - `tests/e2e/evaluators.py` (lines 203-308): Contains `AuditTrailEvaluator` with `create_event` and `verify_chain`, and `AIProblemRouterEvaluator` with a keyword/extension map across 19 engines.

---

## 2. Logic Chain

1. **Evidence Integrity & Provenance**:
   - Observations 1 and 2 establish that preflight findings must be verifiable down to the exact source bytes.
   - Without exact line, column, and byte offsets, auditors and developers cannot verify findings in complex artifacts (e.g. 5,000-line ABAP programs or 20,000-cell BRFplus decision tables).
   - Therefore, a unified `EvidenceSourceOffset` model with format-specific extractors (`LINE_COLUMN` for ABAP/logs, `XPATH` for XML/XDP, `JSON_POINTER` for OpenAPI, and `TABLE_CELL` for OPD/SPRO) must be introduced in both TypeScript (`packages/schemas`) and Python (`src/platform/evidence.py`).
   - Furthermore, release alignment validation must be formalized using a normalized release taxonomy comparator to detect `EVIDENCE_RELEASE_MISALIGNED` before calculating trust scores.

2. **Official vs Customer Trust Stratification**:
   - Observation 1 specifies that official vendor metadata (Cloudification repo, C1 released contracts, AST tokens) has 1.00 trust, whereas customer configurations and logs have 0.50 baseline trust because customer exports may be incomplete, unverified, or sourced from non-production sandboxes.
   - The composite trust score of a finding must be bounded by the maximum trust of its supporting evidence items and penalized if customer assertions contradict official SAP release rules (`EVIDENCE_CONFLICT_DETECTED`).

3. **Tamper-Evident Append-Only Audit Ledger**:
   - Observation 1 and 2 specify that the audit trail must be mathematically tamper-evident.
   - If two runtimes (NestJS and Python) compute hashes over JSON payloads with divergent key ordering or whitespace, verification fails across services.
   - Therefore, RFC 8785 (JSON Canonicalization Scheme) must be strictly implemented in both TypeScript and Python.
   - To guarantee append-only immutability against database-level tampering, a PostgreSQL trigger `audit_events_immutable_guard()` must be deployed to raise SQLSTATE `55P02` on any `UPDATE` or `DELETE` attempt.
   - High-concurrency sequential chaining must be protected against race conditions via PostgreSQL transaction advisory locks scoped by tenant UUID (`pg_advisory_xact_lock(hashtext('audit_' || tenant_id))`).

4. **AI Problem Router & Epistemic Gateway**:
   - Observation 1 and 2 define the router's role as converting user artifacts and intents into candidate engine executions without ever fabricating findings.
   - A two-pass architecture satisfies both performance and accuracy: Pass 1 executes 100% deterministic file signature and content inspection (e.g. `<xdp:xdp>` $\rightarrow$ FormDoctor; `E070`/`E071` $\rightarrow$ Transport Dependency Analyzer); Pass 2 handles natural language problem text via the LLM Gateway only when inputs are ambiguous.
   - To maintain epistemic defensibility, all LLM outputs must be hard-capped at confidence class `INFERRED` / 0.60, rule IDs and engine names must be constrained by strict schemas to prevent hallucination, and a deterministic fallback provider must engage automatically if external LLM APIs fail.

---

## 3. Caveats

1. **Real Hardware Clocks**: Verification assumes synchronized NTP clocks across container hosts. To detect local clock tampering, the verification function checks monotonic timestamp ordering ($t_n \ge t_{n-1}$), but cannot guarantee absolute GPS-synchronized physical time without external RFC 3161 Time Stamp Authorities (TSA).
2. **Read-Only Scope**: In strict accordance with explorer constraints, no source code in `packages/` or `services/` was mutated during this investigation. All technical blueprints, schemas, algorithms, and migration SQL have been fully specified in `platform_services_plan.md` ready for worker implementation.
3. **External LLM Network Dependencies**: In isolated or air-gapped customer environments without internet access, external LLM providers (OpenAI/Anthropic) will be unreachable. The blueprint addresses this by providing `LocalOllamaProvider` and `DeterministicFallbackProvider` to guarantee 100% operational availability.

---

## 4. Conclusion

The technical exploration for Milestone 2 Shared Platform Services is complete. The comprehensive blueprint is formulated in `H:/erppreflight/.agents/m2_explorer_3/platform_services_plan.md`, covering:
1. **Evidence Engine**: SHA-256 evidence chain verification algorithm; unified source artifact offset tracking across ABAP, XML/XDP, JSON/OpenAPI, CSV tables, and telegram logs; canonical SAP release alignment validator; and 8-tier trust hierarchy (1.0 official vs 0.50 customer).
2. **Tamper-Evident Audit Trail**: Append-only cryptographic SHA-256 ledger chaining ($hash_n = \text{SHA256}(hash_{n-1} \mathbin{\Vert} \dots)$); RFC 8785 deterministic canonical JSON serialization; PostgreSQL trigger immutability (`55P02`); and full-ledger tamper-detection verification function with anomaly localization.
3. **AI Problem Router & Pluggable LLM Gateway**: Exhaustive 19-engine deterministic artifact routing matrix; two-pass classification; pluggable LLM provider abstraction; non-negotiable 0.60 confidence ceiling; zero hallucinated rules; and resilient deterministic circuit breaker.

---

## 5. Verification Method

Once implemented by worker agents, the platform services must be verified using the following commands:

1. **Python Analysis Engine Test Suite**:
   ```powershell
   pytest services/analysis-python/tests/unit/test_confidence.py -v
   pytest services/analysis-python/tests/unit/test_evidence_engine.py -v
   pytest services/analysis-python/tests/unit/test_audit_ledger.py -v
   pytest services/analysis-python/tests/unit/test_router_gateway.py -v
   ```
   *Expected result*: All unit tests pass with 100% success rate.

2. **TypeScript Monorepo Compilation & Tests**:
   ```powershell
   pnpm --filter @erppreflight/evidence test
   pnpm --filter @erppreflight/schemas build
   pnpm --filter @erppreflight/database build
   ```
   *Expected result*: Clean compilation with zero TypeScript errors.

3. **E2E Test Runner Verification**:
   ```powershell
   python tests/e2e/runner.py --tier 1
   ```
   *Expected result*: Tests 4 (Confidence Classifier), 5 (AI Problem Router), 6 (Audit Trail), and 7 (Evidence Engine) report status `PASSED`.

4. **Invalidation Conditions**:
   - Any LLM-derived finding outputting confidence $> 0.60$ or confidence class `VERIFIED` / `RULE_DERIVED` invalidates the implementation.
   - Any audit ledger record allowing `UPDATE` or `DELETE` in PostgreSQL invalidates the immutability guarantee.
   - Any SHA-256 mismatch between TypeScript and Python canonical JSON serialization invalidates cross-runtime audit verification.
