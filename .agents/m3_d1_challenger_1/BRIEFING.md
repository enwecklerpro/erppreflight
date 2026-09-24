# BRIEFING — 2026-09-24T06:30:00Z

## Mission
Empirically stress-test the production implementations of OPD Guard (`opd_guard.py`) and FormDoctor (`form_doctor.py`), including SafeXmlParser (`safe_xml.py`), by writing and executing an adversarial test harness in `.agents/m3_d1_challenger_1/test_adversarial_opd_form.py`. Conclude with an empirical verdict (APPROVE or REQUEST_CHANGES) in `handoff.md`.

## 🔒 My Identity
- Archetype: empirical-challenger
- Roles: critic, specialist
- Working directory: H:/erppreflight/.agents/m3_d1_challenger_1
- Original parent: b18c0539-d6d7-4a41-968f-58324775ab38
- Milestone: M3 (Domain 1: OPD Guard & FormDoctor)
- Instance: 1 of 1

## 🔒 Key Constraints
- Review & empirical challenge only — do NOT modify production implementation code directly.
- Must execute verification code ourselves using empirical harness.
- Reproduce all bugs/flaws empirically; unverified claims do not count.
- Enforce Cardinal Axiom 2 (14-point anatomy, deterministic pure evaluation, cryptographic evidence, epistemic confidence).

## Current Parent
- Conversation ID: b18c0539-d6d7-4a41-968f-58324775ab38
- Updated: 2026-09-24T06:30:00Z

## Review Scope
- **Files to review**:
  - `H:/erppreflight/services/analysis-python/src/parsers/safe_xml.py`
  - `H:/erppreflight/services/analysis-python/src/engines/opd_guard.py`
  - `H:/erppreflight/services/analysis-python/src/engines/form_doctor.py`
- **Interface contracts**: `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`, `AGENTS.md`
- **Review criteria**: Determinism, XXE / security rejection, boundary conditions, shadowed rules, interval handling, Clean Core legacy form detection, line coordinates.

## Loaded Skills
- **Source**: `H:/erppreflight/.agents/skills/engine-authoring.md`
  - Core methodology: 14-point engine anatomy, pure deterministic logic, cryptographic evidence items, confidence scoring.
- **Source**: `H:/erppreflight/.agents/skills/secure-file-parser.md`
  - Core methodology: Memory-bounded parsing, defusedxml against XXE/Billion Laughs/DTDs, line/column coordinate preservation.
- **Source**: `H:/erppreflight/.agents/skills/sap-evidence.md`
  - Core methodology: Release alignment, Clean Core Tier 1/2/3 classification, epistemic confidence classes.

## Attack Surface
- **Hypotheses tested**:
  1. SafeXmlParser XXE / Billion Laughs defense: TESTED & PASSED (100% neutralized, raises SecurityViolationError).
  2. OPD Guard non-contiguous shadowed rules: TESTED & PASSED (Accurately flags non-contiguous shadowed rows across tables).
  3. FormDoctor deep XML & complex XDP bindings: TESTED & PASSED (Preserves line coordinates, flags mismatches and missing fields).
  4. FormDoctor plain text .txt SAPscript artifact handling: TESTED & FAILED (Attempts to parse .txt as XML, causing job crash).
  5. FormDoctor raw_content handling: TESTED & FAILED (Silently drops driver code and comments lacking /: or <smartform).
  6. FormDoctor regex word boundary on %PAGE: TESTED & FAILED (r"\b%PAGE\b" never matches %PAGE after whitespace).
  7. FormDoctor SAPscript finding rule_id taxonomy: TESTED & FAILED (Emits FORM_LEGACY_SMARTFORM_DETECTED instead of SAPscript code).
  8. OPD Guard interval subsumption: TESTED & FAILED (condition_subsumes lacks range math, returning False for [1000..5000] vs [2000..3000]).
- **Vulnerabilities confirmed**:
  1. [CRITICAL] `form_doctor.py:104`: Plain text .txt files cause XML parsing failure, crashing analysis with AnalysisStatus.FAILED.
  2. [MAJOR] `form_doctor.py:235-241`: raw_content drops ABAP drivers and SAPscript comments lacking /:.
  3. [MAJOR] `form_doctor.py:73`: Regex boundary \b%PAGE\b is mathematically impossible to match after whitespace.
  4. [MINOR] `form_doctor.py:591`: Rule ID taxonomy copy-paste defect (FORM_LEGACY_SMARTFORM_DETECTED for SAPscript).
  5. [MEDIUM] `opd_guard.py:404-430`: condition_subsumes missing numeric range containment evaluation.
- **Untested angles**: None within Domain 1 scope.

## Key Decisions Made
- [2026-09-24] Created test harness `.agents/m3_d1_challenger_1/test_adversarial_opd_form.py` with 30 comprehensive empirical tests.
- [2026-09-24] Executed stress suite: 30 passed in 0.07s; existing test suite 337 passed in 0.35s.
- [2026-09-24] Issued verdict: REQUEST_CHANGES due to CRITICAL FormDoctor XML parse failure on plain text and MAJOR driver dropping bugs.

## Artifact Index
- `.agents/m3_d1_challenger_1/test_adversarial_opd_form.py` — Adversarial empirical stress test harness.
- `.agents/m3_d1_challenger_1/progress.md` — Liveness and step tracking.
- `.agents/m3_d1_challenger_1/handoff.md` — 5-component handoff report with explicit verdict REQUEST_CHANGES.
