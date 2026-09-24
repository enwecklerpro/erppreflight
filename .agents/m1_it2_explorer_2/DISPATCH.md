## 2026-09-24T01:50:09Z
You are m1_it2_explorer_2, working in directory H:/erppreflight/.agents/m1_it2_explorer_2.

MANDATORY: Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md before starting work.
Also read:
- H:/erppreflight/.agents/orchestrator_main/PROJECT.md
- H:/erppreflight/.agents/orchestrator_main/GATE_STATUS.md
- H:/erppreflight/.agents/m1_challenger_2/handoff.md
- H:/erppreflight/.agents/m1_challenger_1/handoff.md

Problem Context (Milestone 1 Gate Failure - Confidence Demotion & EngineRunner):
1. In `services/analysis-python/src/platform/confidence.py`, lines 19-27:
   - When evidence is missing (`len(evidence) == 0`), `RULE_DERIVED` is NOT demoted to `UNKNOWN` because line 25 only checks `confidence == ConfidenceClass.VERIFIED`.
   - When an AI-generated finding has missing evidence, it gets demoted to `INFERRED (0.60)` instead of `UNKNOWN (0.30)` because the `is_ai_generated` check happens before the missing evidence check.
2. In `services/analysis-python/src/core/runner.py`:
   - `EngineRunner.execute` does not pass `is_ai_generated` or inspect evidence trust/provenance, allowing AI-generated findings to bypass demotion and output `VERIFIED (1.0)`.

Objective:
Formulate the exact technical fix strategy for `confidence.py` and `runner.py`:
1. Correct the classification order in `ConfidenceClassifier.classify`:
   - If missing evidence (`len(evidence) == 0`), demote ALL non-UNKNOWN findings (both `VERIFIED` and `RULE_DERIVED`) to `UNKNOWN (0.30)`.
   - Missing evidence takes precedence: an AI finding without evidence MUST be `UNKNOWN (0.30)`.
   - If AI-generated and has evidence, demote to `INFERRED (0.60)` ceiling.
2. In `EngineRunner.execute`, ensure `ConfidenceClassifier.classify` is invoked on all generated findings, respecting `is_ai_generated` flag and evidence provenance.
3. Update tests in `services/analysis-python/tests/test_confidence.py` to cover these exact edge cases.

Write your fix blueprint to H:/erppreflight/.agents/m1_it2_explorer_2/confidence_fix_plan.md and write a standard handoff.md.
Maintain progress.md with timestamps.
When done, call send_message to parent (conversation ID: b18c0539-d6d7-4a41-968f-58324775ab38).
