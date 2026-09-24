# Dispatch Assignment — m2_it4_challenger_2

## 2026-09-24T07:46:00Z
**Role**: Future Distance & Penalty Gradient Challenger
**Working Directory**: H:/erppreflight/.agents/m2_it4_challenger_2
**Parent Agent**: b18c0539-d6d7-4a41-968f-58324775ab38

### Mission:
Empirically stress-test future release distance calculation, premature release penalty, and unparseable fallback across TypeScript and Python:
1. Future release distance matrix:
   - Cloud: test `2408` vs `2402` (aligned, 1.0), `2502` vs `2402` (future, 0.80), `2508` vs `2402` (future, 0.80), `2402` vs `2408` (premature, 0.40).
   - On-Premise: test `2021` vs `2020` (aligned, 1.0), `2023` vs `2020` (future, 0.80), `2025` vs `2021` (future, 0.80), `2020` vs `2023` (premature, 0.40).
   - Validity windows: verify that when `validTo` is present (e.g. `validFrom='2020', validTo='2025'`), `target='2023'` returns `RELEASE_ALIGNED` (1.00) because it is within the closed window.
2. Premature penalty: verify that all premature cases strictly return `penalty: 0.40` (not `0.0`).
3. Unparseable strings: test `''`, `'   '`, `'INVALID_XYZ'`, `'UNKNOWN'`, non-string inputs. Verify that all return `status: 'UNKNOWN'`, `isAligned: false`, `penalty: 0.30`.
4. Conclude with explicit verdict: APPROVE or REQUEST_CHANGES in handoff.md.
