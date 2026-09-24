# Dispatch Assignment — m2_it4_worker_remediation

## 2026-09-24T07:38:00Z
**Role**: Cross-Release & Future Gradient Remediation Worker
**Working Directory**: H:/erppreflight/.agents/m2_it4_worker_remediation
**Parent Agent**: b18c0539-d6d7-4a41-968f-58324775ab38

### Mission:
Implement the complete cross-release alignment and penalty gradient remediation across TypeScript, Python, and the test suites, strictly adhering to the 3 Explorer blueprints:
1. `H:/erppreflight/.agents/m2_it4_explorer_1/ts_release_alignment_plan.md`
2. `H:/erppreflight/.agents/m2_it4_explorer_2/py_release_alignment_plan.md`
3. `H:/erppreflight/.agents/m2_it4_explorer_3/test_alignment_plan.md`

### Write Ownership:
You own and must modify:
- `packages/schemas/src/evidence.ts` (add `RELEASE_FUTURE` and `RELEASE_MISMATCH`, keep `FAMILY_MISMATCH`)
- `packages/evidence/src/release-alignment.ts` (cross-family inference, UNKNOWN fallback 0.30, premature 0.40, future 0.80)
- `services/analysis-python/src/platform/evidence.py` (cross-family inference, UNKNOWN fallback 0.30, premature 0.40, future 0.80)
- Test files to un-fail and align per `test_alignment_plan.md`:
  * `apps/api/test/empirical_stress_m2_it3_challenger2.spec.ts` (convert 17 it.fails to it, adjust section 1 adjacent on-prem releases)
  * `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it3_challenger2.py` (remove 17 xfails, adjust section 1 adjacent on-prem releases)
  * `apps/api/test/platform_services.spec.ts`
  * `services/analysis-python/tests/unit/test_platform_services.py`
  * `apps/api/test/empirical_stress_m2_it2.spec.ts`
  * `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py`
  * `apps/api/test/empirical_stress_m2_it3.spec.ts`
  * `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it3.py`

### Required Verifications:
1. `pnpm --filter @erppreflight/schemas build`
2. `pnpm --filter @erppreflight/evidence build`
3. `pnpm run typecheck` (must pass with 0 errors)
4. `pnpm --filter api exec vitest run test/empirical_stress_m2_it3_challenger2.spec.ts` (all 31 pass without it.fails)
5. `py -m pytest services/analysis-python/tests/adversarial/test_empirical_stress_m2_it3_challenger2.py -v` (all 31 pass without xfail)
6. `pnpm test` (all packages and API test suites pass 100%)
7. `py -m pytest services/analysis-python/tests -v` (100% pass)
8. `py -m pytest tests/e2e/ -v` (175/175 pass)
9. `pnpm run lint` (0 errors)

Document all changes and test outputs in H:/erppreflight/.agents/m2_it4_worker_remediation/handoff.md.
