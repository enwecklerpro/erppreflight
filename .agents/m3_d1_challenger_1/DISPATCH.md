# Dispatch: Milestone 3.1 Domain 1 Challenger 1 (OPD Guard & FormDoctor Empirical Challenger)

**Agent**: `m3_d1_challenger_1`  
**Role**: OPD & FormDoctor Challenger  
**Working Directory**: `H:/erppreflight/.agents/m3_d1_challenger_1`  
**Timestamp**: 2026-09-24T08:30:00+02:00  

---

## Mission
Empirically stress-test the production implementations of **OPD Guard** (`opd_guard.py`) and **FormDoctor** (`form_doctor.py`):
1. Construct adversarial BRFplus decision tables:
   - Multiple shadowed rules across non-contiguous rows.
   - Complex wildcard and interval conditions (`[1000..5000]`, negations `!=`, comma-separated values).
   - Corrupt or malformed CSV/XLSX/JSON decision tables (assert graceful rejection without unhandled exceptions).
2. Construct adversarial Form payloads:
   - XML payloads with deep nesting, namespaces, attribute bindings, and malformed XDP templates.
   - Verify XXE injection defense via `SafeXmlParser` (`defusedxml`).
   - Verify Clean Core legacy form detection across SmartForms and SAPscript artifacts.
3. Write your empirical stress test script in `.agents/m3_d1_challenger_1/test_adversarial_opd_form.py` and execute it.

Conclude with explicit verdict: **APPROVE** or **REQUEST_CHANGES** in `handoff.md`.
When done, call `send_message` to parent (`b18c0539-d6d7-4a41-968f-58324775ab38`).

## 2026-09-24T06:29:03Z
You are m3_d1_challenger_1, working in directory H:/erppreflight/.agents/m3_d1_challenger_1.

MANDATORY: Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md before starting work.
Also read:
- H:/erppreflight/.agents/m3_d1_challenger_1/DISPATCH.md
- H:/erppreflight/.agents/orchestrator_main/PROJECT.md
- H:/erppreflight/services/analysis-python/src/parsers/safe_xml.py
- H:/erppreflight/services/analysis-python/src/engines/opd_guard.py
- H:/erppreflight/services/analysis-python/src/engines/form_doctor.py

Mission:
Write and execute an adversarial empirical stress test script in `.agents/m3_d1_challenger_1/test_adversarial_opd_form.py`:
- Test complex BRFplus tables with multiple non-contiguous shadowed rules, interval conditions, and malformed tables.
- Test deep XML payloads, XXE injection attempts (assert rejection via SafeXmlParser), and Clean Core legacy form detection.
Execute the stress test and analyze results.
Conclude with explicit verdict: APPROVE or REQUEST_CHANGES in handoff.md.
Maintain progress.md with timestamps.
When done, call send_message to parent (conversation ID: b18c0539-d6d7-4a41-968f-58324775ab38).
