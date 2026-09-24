# Dispatch Assignment — m2_it4_explorer_1

## 2026-09-24T07:31:00Z
**Role**: TypeScript Release Alignment & Schemas Explorer
**Working Directory**: H:/erppreflight/.agents/m2_it4_explorer_1
**Parent Agent**: b18c0539-d6d7-4a41-968f-58324775ab38

### Mission:
Read H:/erppreflight/.agents/m2_it3_challenger_2/handoff.md and blueprint the exact TypeScript remediation in:
1. `packages/schemas/src/evidence.ts`:
   - Update `ReleaseAlignmentEnum` to include `'RELEASE_FUTURE'` and `'RELEASE_MISMATCH'` (keeping `'FAMILY_MISMATCH'` as an alias or union).
2. `packages/evidence/src/release-alignment.ts`:
   - In `ReleaseAlignmentValidator.validate(targetRelease, validFrom, validTo, targetFamily, evidenceFamily)`:
     * Cross-family inference: If `targetFamily` or `evidenceFamily` are not explicitly passed, infer them from `target.family` and `from.family` (or `to.family`). If they mismatch, return `status: 'RELEASE_MISMATCH'` (or `FAMILY_MISMATCH`), `isAligned: false`, `penalty: 0.50`.
     * Unparseable fallback: If `target.family === 'UNKNOWN'` or `target.version === 0` (or `from.family === 'UNKNOWN'` when validFrom provided), return `status: 'UNKNOWN'`, `isAligned: false`, `penalty: 0.30`.
     * Premature penalty: Return `status: 'RELEASE_PREMATURE'`, `isAligned: false`, `penalty: 0.40`.
     * Future release check: If `isSameFamily` and target is $\ge 2$ releases ahead of `validFrom` (in Cloud quarters YYMM e.g. delta $\ge 60$ or quarter distance $\ge 2$; in On-Premise year delta $\ge 2$), return `status: 'RELEASE_FUTURE'`, `isAligned: true`, `penalty: 0.80`.
     * Aligned: `status: 'RELEASE_ALIGNED'`, `isAligned: true`, `penalty: 1.00`.
3. Provide the full drop-in code in `H:/erppreflight/.agents/m2_it4_explorer_1/ts_release_alignment_plan.md` and write `handoff.md`.
