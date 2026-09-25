# Playbook: Golden Fixtures & Deterministic Test Suites

> **Binding Authority**: Cardinal Axiom 2, Part 14.22, Part 22.17 & AGENTS.md  
> **Scope**: Preflight engine test suites, golden fixtures, regression corpuses, and property-based tests.

---

## 1. 14-Point Architectural Requirement
Every preflight analysis engine in `services/analysis-python/src/engines/` must be paired with:
1. **Golden Positive Fixture**: Proves the rule triggers accurately on known defective code/configuration.
2. **Golden Negative Fixture**: Proves clean code/configuration passes with 0 false positives.
3. **Edge Case / Boundary Fixture**: Empty payloads, malformed structures, Unicode, extreme volumes.
4. **Cryptographic Integrity**: Emitted findings assert non-empty SHA-256 hashes, exact line/column pointers, and valid confidence classification (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`).

---

## 2. Invariant: 100% Pass Rate Mandatory
- `pytest services/analysis-python/tests -v` must execute with 100% pass rate.
- Zero flaky tests; zero probabilistic drift.
- Two identical artifact inputs must produce byte-for-byte identical findings.

---

## 3. Implementation Checklist
- [ ] Fixture files placed under `services/analysis-python/tests/fixtures/`.
- [ ] Synthetic fixtures sanitized to prevent customer data leakage.
- [ ] Pytest test file verifies AST parsing, rule evaluation, and evidence generation.
- [ ] Hypothesis or fast-check property test verifies memory bounds against hostile payloads.
