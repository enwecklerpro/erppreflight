# Dispatch Assignment — m2_it4_explorer_2

## 2026-09-24T07:31:00Z
**Role**: Python Release Alignment Explorer
**Working Directory**: H:/erppreflight/.agents/m2_it4_explorer_2
**Parent Agent**: b18c0539-d6d7-4a41-968f-58324775ab38

### Mission:
Read H:/erppreflight/.agents/m2_it3_challenger_2/handoff.md and blueprint the exact Python remediation in:
`services/analysis-python/src/platform/evidence.py`:
1. In `ReleaseAlignmentValidator.validate(cls, target_release, valid_from, valid_to, target_family, evidence_family)`:
   - Cross-family inference: If `target_family` or `evidence_family` are None, infer them from `target_fam` and `from_fam`. If they mismatch, return `status="RELEASE_MISMATCH"`, `is_aligned=False`, `penalty=0.50`.
   - Unparseable fallback: If `target_fam == "UNKNOWN"` or `target_ver == 0` (or `from_fam == "UNKNOWN"` when valid_from provided), return `status="UNKNOWN"`, `is_aligned=False`, `penalty=0.30`.
   - Premature penalty: Return `status="RELEASE_PREMATURE"`, `is_aligned=False`, `penalty=0.40`.
   - Future release check: If `_is_same_family` and target is $\ge 2$ releases ahead of `valid_from` (in Cloud quarters YYMM or On-Premise year delta $\ge 2$), return `status="RELEASE_FUTURE"`, `is_aligned=True`, `penalty=0.80`.
   - Exact message parity with TypeScript.
2. Provide the full drop-in code in `H:/erppreflight/.agents/m2_it4_explorer_2/py_release_alignment_plan.md` and write `handoff.md`.
