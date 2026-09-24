# BRIEFING — 2026-09-24T01:55:30Z

## Mission
Formulate technical fix strategy for ConfidenceClassifier and EngineRunner demotion logic and evidence handling.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigator, synthesizer
- Working directory: H:/erppreflight/.agents/m1_it2_explorer_2
- Original parent: b18c0539-d6d7-4a41-968f-58324775ab38
- Milestone: milestone_1

## 🔒 Key Constraints
- Read-only investigation — do NOT implement code changes directly in src/
- Deliverables: confidence_fix_plan.md and handoff.md in H:/erppreflight/.agents/m1_it2_explorer_2
- All coordination via send_message to parent

## Current Parent
- Conversation ID: b18c0539-d6d7-4a41-968f-58324775ab38
- Updated: 2026-09-24T01:55:30Z

## Investigation State
- **Explored paths**: `services/analysis-python/src/platform/confidence.py`, `src/core/runner.py`, `src/models/finding.py`, `tests/unit/test_confidence.py`, `tests/adversarial/test_m1_challenges.py`, `tests/unit/test_adversarial_challenge.py`, `packages/evidence/src/classifier.ts`, `tests/empirical_fuzz_stress.py`
- **Key findings**:
  - `confidence.py:25` only demoted `VERIFIED` on empty evidence, letting `RULE_DERIVED` and `INFERRED` escape demotion.
  - `confidence.py:19` checked `is_ai_generated` first, mutating `VERIFIED` to `INFERRED`, causing empty-evidence demotion to fail and leaving AI findings at `INFERRED (0.60)` instead of `UNKNOWN (0.30)`.
  - `runner.py:27` did not pass AI flags or check evidence provenance.
  - Inverted execution order and unconditional empty-evidence demotion resolves all bugs (verified via 12/12 matrix tests).
- **Unexplored areas**: None. Technical fix strategy is complete and empirically proven.

## Key Decisions Made
- Reordered rules: Missing evidence is evaluated first and unconditionally demotes all non-UNKNOWN findings to `UNKNOWN (0.30)`.
- Maintained backward compatibility: `ConfidenceClassifier.classify_finding = classify`.
- Defense-in-depth AI detection: inspect `is_ai_generated` param, `finding.is_ai_generated`, `finding.technical_details`, and `evidence[].provenance` / `evidence[].source_type`.
- Prepared drop-in replacement files, comprehensive test suite, and unified `.patch`.

## Artifact Index
- `DISPATCH.md` — Initial dispatch
- `BRIEFING.md` — Working memory
- `progress.md` — Liveness heartbeat
- `confidence_fix_plan.md` — Comprehensive technical fix blueprint
- `handoff.md` — Standard 5-component hard handoff report
- `proposed_confidence.py` — Drop-in replacement for `confidence.py`
- `proposed_runner.py` — Drop-in replacement for `runner.py`
- `proposed_finding.py` — Drop-in replacement for `finding.py`
- `proposed_test_confidence.py` — 11-test suite for `test_confidence.py`
- `proposed_test_runner.py` — Integration test suite for `test_runner.py`
- `confidence_runner_fixes.patch` — Unified git diff patch
