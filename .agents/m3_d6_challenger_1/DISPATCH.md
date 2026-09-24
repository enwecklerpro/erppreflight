# Dispatch Assignment: m3_d6_challenger_1

- **Agent**: `m3_d6_challenger_1`
- **Archetype**: `teamwork_preview_challenger`
- **Role**: Domain 6 MFS BlackBox Challenger
- **Working Directory**: `H:/erppreflight/.agents/m3_d6_challenger_1`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`
- **Timestamp**: 2026-09-24T13:05:00+02:00

## Objective
Author and execute an adversarial empirical stress test harness in `.agents/m3_d6_challenger_1/test_adversarial_mfs.py` to rigorously challenge the Feature 36: **MFS BlackBox Preflight Engine** (`services/analysis-python/src/engines/mfs_blackbox.py`).

## Authoritative Inputs
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/m3_d6_worker_implementation/handoff.md`
- `services/analysis-python/src/engines/mfs_blackbox.py`
- `services/analysis-python/tests/unit/test_domain6_engines.py`

## Adversarial Stress Vectors
1. Multi-artifact corruption: truncated CSVs, missing headers, empty streams, malformed JSON, and unexpected delimiters.
2. Boundary & Graph Stress:
   - High-volume telegram logs (10,000+ telegrams across 100+ concurrent HUs).
   - Complex conveyor topologies (directed graphs with branching divert lanes, merging lanes, loops, dead ends).
   - Out-of-order telegram timestamps and inverted sequence numbers.
   - Cascading failures: single missing ACK triggering retry storms and subsequent emergency conveyor halt.
   - First Causal Divergence pinpointing: exact earliest chronological violation must be identified accurately amidst hundreds of downstream secondary symptoms.
3. Cryptographic evidence verification: SHA-256 validity across all emitted findings, line/column veracity.
4. Epistemic confidence invariants: missing evidence demotion to UNKNOWN (0.30), verified logs to VERIFIED (1.0).
5. Backward compatibility: ensure `MFSBlackBoxEngine.evaluate` produces identical results to `MFSBlackBoxEvaluator.evaluate`.

## Execution Commands
```powershell
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH
py -3.13 -m pytest .agents/m3_d6_challenger_1/test_adversarial_mfs.py -v
py -3.13 -m pytest services/analysis-python/tests/unit/test_domain6_engines.py -v
py -3.13 -m pytest tests/e2e/ -k "mfs" -v
py -3.13 -m pytest services/analysis-python/tests -q
```
Conclude with explicit binary verdict (`APPROVE` or `REQUEST_CHANGES`) in `handoff.md`.
Maintain `progress.md` with timestamps.
When done, call `send_message` to parent (`b18c0539-d6d7-4a41-968f-58324775ab38`).
