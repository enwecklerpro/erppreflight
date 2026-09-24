# Dispatch Assignment: m3_d6_worker_implementation

- **Agent**: `m3_d6_worker_implementation`
- **Archetype**: `teamwork_preview_worker`
- **Role**: Domain 6 Warehouse Automation (MFS BlackBox) Worker
- **Working Directory**: `H:/erppreflight/.agents/m3_d6_worker_implementation`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`
- **Timestamp**: 2026-09-24T12:38:00+02:00

## Objective
Author and deploy production-grade implementation of Feature 36: **MFS BlackBox Preflight Engine** in `services/analysis-python/src/engines/mfs_blackbox.py`, along with curated golden fixtures in `services/analysis-python/tests/fixtures/domain6/` and comprehensive automated unit tests in `services/analysis-python/tests/unit/test_domain6_engines.py`.

## Authoritative Inputs
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md` (§19)
- Reference E2E evaluator: `H:/erppreflight/tests/e2e/evaluators.py:1201-1255` (`MFSBlackBoxEvaluator`)
- Reference E2E tests: `H:/erppreflight/tests/e2e/test_tier1_features.py:1075-1119`

## Mandatory Architecture Requirements (Cardinal Axiom 2)
1. **14-Point Engine Anatomy**:
   - Canonical engine metadata: `EngineType.MFS_BLACKBOX`, name: "MFS BlackBox", version: "1.0.0", supported artifacts: `[ArtifactType.CSV, ArtifactType.TXT, ArtifactType.JSON]`.
   - Strict Pydantic input models (`MFSAnalysisRequest`, `MFSTelegram`, `ConveyorTopology`).
   - Deterministic parser supporting:
     - CSV telegram logs (headers: `timestamp`, `type`, `hu_id`, `cp`, `seq_no`, `sender_plc`, `receiver_plc`, `status`, etc.).
     - JSON streams (`{"telegrams": [...], "conveyor_edges": [...]}`).
     - Plaintext telegram logs (delimiter detection: comma, tab, semicolon, pipe).
   - Pure rule evaluation and state machine reconstruction:
     - Track active Handling Units (HUs), Warehouse Tasks (WTs), physical communication points (CPs), and pending moves.
     - Detect `MFS_IMPOSSIBLE_TOPOLOGY_JUMP`: HU moves between CPs with no valid conveyor edge connecting them.
     - Detect `MFS_MISSING_ACK_TIMEOUT`: Telegram sent to PLC with no matching ACK within configured timeout (or explicit TIMEOUT telegram).
     - Detect `MFS_OUT_OF_ORDER_SEQUENCE`: Telegram sequence numbers jump or arrive inverted.
     - Detect `MFS_DUPLICATE_TELEGRAM_SEND`: Identical telegram resent prematurely, indicating PLC retry storm.
   - **First Causal Divergence Pinpointing**:
     - Identify the chronologically earliest invariant violation in the stream.
     - Set `first_causal_divergence` in response / metrics detailing the root cause and downstream cascade.
   - Cryptographic SHA-256 evidence chain:
     - Every finding must contain `Evidence` with exact 1-based line numbers, column numbers, snippet, artifact SHA-256 hash, and provenance.
   - Epistemic confidence classification:
     - Verified log invariant violation -> `VERIFIED` (1.0).
     - Inferred topology / missing intermediate steps -> `RULE_DERIVED` (0.85).
     - Missing evidence / corrupted log line -> `UNKNOWN` (0.30).
   - Compatibility classmethod:
     - Implement `@classmethod evaluate(cls, telegrams: List[Dict[str, Any]], conveyor_edges: Set[Tuple[str, str]]) -> Dict[str, Any]` to match `MFSBlackBoxEvaluator.evaluate`, ensuring 100% interoperability with all existing E2E tiers.

2. **Fixtures**:
   Create `services/analysis-python/tests/fixtures/domain6/`:
   - `mfs_normal_flow.json`: Normal sequential flow with timely ACKs.
   - `mfs_jump_stream.json`: HU jumping between non-connected communication points.
   - `mfs_ack_retry_storm.json`: Missing ACK leading to retry storm.
   - `mfs_telegram_log.csv`: CSV log format with mixed telegram types.

3. **Automated Unit Tests**:
   Create `services/analysis-python/tests/unit/test_domain6_engines.py`:
   - At least 15 comprehensive unit tests covering:
     - Normal telegram flow without findings
     - Topology jump detection (`MFS_IMPOSSIBLE_TOPOLOGY_JUMP`)
     - Missing ACK timeout detection (`MFS_MISSING_ACK_TIMEOUT`)
     - First causal divergence pinpointing
     - CSV parsing and JSON parsing
     - Corrupted logs and fail-closed handling
     - Cryptographic SHA-256 evidence integrity
     - Backward-compatible `evaluate()` classmethod

4. **Engine Registration**:
   - Register in `services/analysis-python/src/engines/__init__.py` and `EngineRegistry`.

5. **Verification Commands**:
   ```powershell
   $env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH
   py -3.13 -m pytest services/analysis-python/tests/unit/test_domain6_engines.py -v
   py -3.13 -m pytest tests/e2e/ -k "mfs" -v
   py -3.13 -m pytest services/analysis-python/tests -q
   py -3.13 -m ruff check services/analysis-python/src/engines/mfs_blackbox.py
   pnpm test
   pnpm run build
   pnpm run typecheck
   ```

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A forensic auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Deliver `handoff.md` with verification commands and output, and call `send_message` to parent (`b18c0539-d6d7-4a41-968f-58324775ab38`).
