/**
 * Empirical Adversarial Stress Test Suite — Milestone 2 Iteration 3 (Challenger 2)
 *
 * Focus:
 * Cross-release alignment and penalty evaluation in TypeScript (@erppreflight/evidence)
 * and parity with Python (services/analysis-python/src/platform/evidence.py).
 *
 * Test Combinations:
 * 1. Aligned: target >= validFrom (penalty 1.00, status RELEASE_ALIGNED)
 * 2. Premature: target < validFrom (penalty 0.40, status RELEASE_PREMATURE)
 * 3. Future: target >= validFrom + 2 releases ahead (penalty 0.80, status RELEASE_FUTURE)
 * 4. Mismatch: cross-family e.g. S4HANA_CLOUD vs ON_PREMISE (penalty 0.50, status RELEASE_MISMATCH)
 * 5. Fallback: Invalid / empty versions fallback
 * 6. Parity: Status codes and error messages
 */

import { describe, it, expect } from 'vitest';
import { ReleaseAlignmentValidator } from '@erppreflight/evidence';

describe('Empirical Adversarial Stress Suite — Milestone 2 Iteration 3 (Challenger 2)', () => {
  describe('1. Aligned Releases (target >= validFrom)', () => {
    const alignedCases = [
      { target: '2408', from: '2402', desc: 'Cloud numeric: 2408 >= 2402' },
      { target: 'S4HC_2408', from: 'S4HC_2402', desc: 'Cloud prefixed: S4HC_2408 >= S4HC_2402' },
      { target: 'S4HANA_CLOUD_2408', from: 'S4HANA_CLOUD_2402', desc: 'Cloud long prefix: 2408 >= 2402' },
      { target: 'S4H_2021', from: 'S4H_2020', desc: 'On-prem prefixed: 2021 >= 2020' },
      { target: 'S4HANA_2021', from: 'S4_2020', desc: 'On-prem mixed prefix: 2021 >= 2020' },
      { target: '2021', from: '2020', desc: 'On-prem numeric: 2021 >= 2020' },
      { target: 'S4H_2023', from: 'S4H_2023', desc: 'Identical on-prem version: 2023 == 2023' },
      { target: 'S4HC_2408', from: 'S4HC_2408', desc: 'Identical cloud version: 2408 == 2408' },
    ];

    for (const { target, from, desc } of alignedCases) {
      it(`evaluates aligned release correctly: ${desc}`, () => {
        const res = ReleaseAlignmentValidator.validate(target, from);
        expect(res.isAligned).toBe(true);
        expect(res.status).toBe('RELEASE_ALIGNED');
        expect(res.penalty).toBe(1.0);
        expect(res.message).toBe('Evidence is release-aligned.');
      });
    }
  });

  describe('2. Premature Releases (target < validFrom)', () => {
    const prematureCases = [
      { target: 'S4HC_2302', from: 'S4HC_2408' },
      { target: '2402', from: '2408' },
      { target: 'S4H_2020', from: 'S4H_2023' },
      { target: '2020', from: '2023' },
    ];

    for (const { target, from } of prematureCases) {
      it(`marks premature release ${target} < ${from} as RELEASE_PREMATURE`, () => {
        const res = ReleaseAlignmentValidator.validate(target, from);
        expect(res.isAligned).toBe(false);
        expect(res.status).toBe('RELEASE_PREMATURE');
      });

      it(`evaluates premature penalty as 0.40 (${target} < ${from})`, () => {
        const res = ReleaseAlignmentValidator.validate(target, from);
        expect(res.penalty).toBe(0.4);
      });
    }
  });

  describe('3. Future Releases (target >= validFrom + 2 releases ahead)', () => {
    const futureCases = [
      { target: 'S4HC_2502', from: 'S4HC_2402', desc: 'Cloud: 2502 is 2 releases ahead of 2402' },
      { target: 'S4HC_2508', from: 'S4HC_2402', desc: 'Cloud: 2508 is 3 releases ahead of 2402' },
      { target: 'S4H_2025', from: 'S4H_2021', desc: 'On-Prem: 2025 is >= 2 releases ahead of 2021' },
      { target: '2023', from: '2020', desc: 'On-Prem: 2023 is >= 2 releases ahead of 2020' },
    ];

    for (const { target, from, desc } of futureCases) {
      it(`evaluates future release as RELEASE_FUTURE (0.80): ${desc}`, () => {
        const res = ReleaseAlignmentValidator.validate(target, from);
        expect(res.status).toBe('RELEASE_FUTURE');
        expect(res.penalty).toBe(0.8);
      });
    }
  });

  describe('4. Cross-Family Mismatch (e.g. S4HANA_CLOUD vs ON_PREMISE)', () => {
    const crossFamilyCases = [
      { target: 'S4HANA_CLOUD_2408', from: 'S4H_2023', desc: 'Target Cloud vs validFrom On-Premise' },
      { target: 'S4HC_2408', from: 'S4H_2020', desc: 'Target S4HC vs validFrom S4H' },
      { target: 'S4H_2023', from: 'S4HC_2408', desc: 'Target On-Premise vs validFrom Cloud' },
      { target: '2408', from: '2023', desc: 'Numeric Cloud 2408 vs Numeric On-Premise 2023' },
    ];

    for (const { target, from, desc } of crossFamilyCases) {
      it(`identifies cross-family mismatch without explicit family args: ${desc}`, () => {
        const res = ReleaseAlignmentValidator.validate(target, from);
        expect(res.isAligned).toBe(false);
        expect(res.penalty).toBe(0.5);
      });
    }

    it('evaluates status name as RELEASE_MISMATCH', () => {
      const res = ReleaseAlignmentValidator.validate('S4HC_2408', 'S4H_2023', null, 'S4HANA_CLOUD', 'ON_PREMISE');
      expect(res.status).toBe('RELEASE_MISMATCH');
    });

    it('evaluates cross-family mismatch when explicit family args are provided', () => {
      const res = ReleaseAlignmentValidator.validate('S4HC_2408', 'S4H_2023', null, 'S4HANA_CLOUD', 'ON_PREMISE');
      expect(res.isAligned).toBe(false);
      expect(res.penalty).toBe(0.5);
      expect(res.status).toBe('RELEASE_MISMATCH');
    });
  });

  describe('5. Invalid / Malformed / Empty Version Strings Fallback', () => {
    const invalidCases = [
      { target: 'INVALID_UNKNOWN_XYZ', from: '2408', desc: 'Completely unparseable target release' },
      { target: '', from: '2408', desc: 'Empty target release' },
      { target: '2408', from: 'INVALID_UNKNOWN_XYZ', desc: 'Completely unparseable valid_from release' },
      { target: '', from: '', desc: 'Both releases empty strings' },
    ];

    for (const { target, from, desc } of invalidCases) {
      it(`must not return RELEASE_ALIGNED for unparseable input: ${desc}`, () => {
        const res = ReleaseAlignmentValidator.validate(target, from);
        expect(res.status).not.toBe('RELEASE_ALIGNED');
        expect(res.isAligned).toBe(false);
        expect(res.penalty).toBeLessThanOrEqual(0.3);
      });
    }
  });

  describe('6. Cross-Language Parity: Messages and Codes', () => {
    it('documents exact message differences between TS and Python', () => {
      const tsMismatch = ReleaseAlignmentValidator.validate('2408', null, null, 'S4HANA_CLOUD', 'ON_PREMISE');
      expect(tsMismatch.message).toBe('Evidence release family (ON_PREMISE) does not match target family (S4HANA_CLOUD).');

      const tsDeprecated = ReleaseAlignmentValidator.validate('2408', null, '2308');
      expect(tsDeprecated.message).toBe('Feature was deprecated or removed after release 2308. Target is 2408.');
    });
  });
});
