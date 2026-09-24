# Dispatch Assignment — m2_it3_worker_remediation

## 2026-09-24T07:18:00Z
**Role**: Milestone 2 Iteration 3 Remediation Worker
**Working Directory**: H:/erppreflight/.agents/m2_it3_worker_remediation
**Parent Agent**: b18c0539-d6d7-4a41-968f-58324775ab38

### Mission:
Implement the Release Alignment prefix stripping remediation across TypeScript and Python and update test harnesses per blueprints:
1. `H:/erppreflight/.agents/m2_it3_explorer_1/ts_prefix_fix_plan.md`
2. `H:/erppreflight/.agents/m2_it3_explorer_2/py_prefix_fix_plan.md`
3. `H:/erppreflight/.agents/m2_it3_explorer_3/test_harness_fix_plan.md`

Write standard handoff to: `H:/erppreflight/.agents/m2_it3_worker_remediation/handoff.md`
Maintain `progress.md` with timestamps.
## 2026-09-24T05:17:20Z
User Request received:
You are m2_it3_worker_remediation, working in directory H:/erppreflight/.agents/m2_it3_worker_remediation.

MANDATORY: Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md before starting work.
Also read:
- H:/erppreflight/.agents/orchestrator_main/PROJECT.md
- H:/erppreflight/.agents/orchestrator_main/GATE_STATUS.md
- H:/erppreflight/.agents/m2_it3_explorer_1/ts_prefix_fix_plan.md
- H:/erppreflight/.agents/m2_it3_explorer_2/py_prefix_fix_plan.md
- H:/erppreflight/.agents/m2_it3_explorer_3/test_harness_fix_plan.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write Ownership:
You own and must implement changes across:
1. `packages/evidence/src/release-alignment.ts`
2. `services/analysis-python/src/platform/evidence.py`
3. `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py`
4. `apps/api/test/empirical_stress_m2_it2.spec.ts`

Implementation Details:
1. In `packages/evidence/src/release-alignment.ts`:
   Apply the prefix stripping fix in `ReleaseAlignmentValidator.parseRelease`:
   ```typescript
   // 1. Explicit S/4HANA prefixes (strip matching prefix before extracting digits to prevent 'S4' -> '4' corruption)
   const prefixes = ['S4HANA_CLOUD_', 'S4HANA_', 'S4HC_', 'S4H_', 'S4_'] as const;
   for (const prefix of prefixes) {
     if (clean.startsWith(prefix)) {
       const isCloud = prefix === 'S4HANA_CLOUD_' || prefix === 'S4HC_';
       const remainder = clean.substring(prefix.length);
       const numStr = remainder.replace(/[^0-9]/g, '');
       return {
         family: isCloud ? 'S4HANA_CLOUD' : 'ON_PREMISE',
         version: parseInt(numStr, 10) || 0,
       };
     }
   }
   ```
2. In `services/analysis-python/src/platform/evidence.py`:
   Apply the prefix stripping fix in `ReleaseAlignmentValidator._parse_release`:
   ```python
   for prefix, family in (
       ("S4HANA_CLOUD_", "S4HANA_CLOUD"),
       ("S4HC_", "S4HANA_CLOUD"),
       ("S4HANA_", "ON_PREMISE"),
       ("S4H_", "ON_PREMISE"),
       ("S4_", "ON_PREMISE"),
   ):
       if clean.startswith(prefix):
           remainder = clean[len(prefix):]
           digits = re.sub(r"[^0-9]", "", remainder)
           return (family, int(digits) if digits else 0)
   ```
3. In `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py`:
   Remove `@pytest.mark.xfail(strict=True)` from the 3 test methods:
   - `test_bug_prefixed_cloud_releases_version_corruption`
   - `test_bug_prefixed_on_premise_releases_version_corruption`
   - `test_bug_cross_release_validation_with_prefixed_valid_from`
4. In `apps/api/test/empirical_stress_m2_it2.spec.ts`:
   Update lines 294–309 to assert:
   - `ReleaseAlignmentValidator.parseRelease('S4HC_2408').version === 2408`
   - `ReleaseAlignmentValidator.parseRelease('S4H_2023').version === 2023`
   - `ReleaseAlignmentValidator.validate('2408', 'S4HC_2402').isAligned === true`
   - `ReleaseAlignmentValidator.validate('2408', 'S4HC_2402').status === 'RELEASE_ALIGNED'`
   - `ReleaseAlignmentValidator.validate('2408', 'S4HC_2402').penalty === 1.0`
