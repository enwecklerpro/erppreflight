/**
 * Empirical Adversarial Stress Test Suite — Milestone 2 Iteration 4 (Challenger 1)
 *
 * Scope:
 * Cross-family detection and alignment matrices across TypeScript and Python:
 * 1. Test cross-family invocations without explicit family arguments.
 * 2. Verify that every cross-family combination strictly yields status 'RELEASE_MISMATCH',
 *    isAligned: false, penalty: 0.50, and zero trust leaks.
 * 3. Verify that intra-family aligned releases strictly yield status 'RELEASE_ALIGNED',
 *    isAligned: true, penalty: 1.00.
 * 4. Combinatorial 11x11 matrix (121 pairs) testing cross-family isolation and zero trust leaks.
 */

import { describe, it, expect } from 'vitest';
import { ReleaseAlignmentValidator, calculateCompositeTrustScore } from '@erppreflight/evidence';

describe('Empirical Stress Suite — Milestone 2 Iteration 4 (Challenger 1)', () => {
  describe('1. Cross-Family Invocations Without Explicit Family Arguments', () => {
    const requiredCrossCases = [
      { target: 'S4HC_2408', from: 'S4H_2023', desc: 'Target S4HC_2408 vs validFrom S4H_2023' },
      { target: '2408', from: '2023', desc: 'Target numeric 2408 vs validFrom numeric 2023' },
      { target: 'S4HANA_CLOUD_2402', from: 'S4_2022', desc: 'Target S4HANA_CLOUD_2402 vs validFrom S4_2022' },
      { target: 'ECC', from: '2408', desc: 'Target ECC vs validFrom numeric 2408' },
      { target: '2408', from: 'ECC', desc: 'Target numeric 2408 vs validFrom ECC' },
      { target: 'S4_2022', from: 'S4HANA_CLOUD_2402', desc: 'Target S4_2022 vs validFrom S4HANA_CLOUD_2402' },
      { target: 'S4H_2023', from: 'S4HC_2408', desc: 'Target S4H_2023 vs validFrom S4HC_2408' },
      { target: '2023', from: '2408', desc: 'Target numeric 2023 vs validFrom numeric 2408' },
      { target: 'ECC', from: '2023', desc: 'Target ECC vs validFrom numeric 2023' },
      { target: '2023', from: 'ECC', desc: 'Target numeric 2023 vs validFrom ECC' },
      { target: '2408', from: '1909', desc: 'Target Cloud 2408 vs validFrom On-Prem 1909' },
      { target: '1909', from: '2408', desc: 'Target On-Prem 1909 vs validFrom Cloud 2408' },
      { target: '  s4hc_2408  ', from: '  s4h_2023  ', desc: 'Whitespace and lowercase trimming' },
    ];

    for (const { target, from, desc } of requiredCrossCases) {
      it(`strictly enforces RELEASE_MISMATCH, isAligned:false, penalty:0.50 for ${desc}`, () => {
        const res = ReleaseAlignmentValidator.validate(target, from);
        expect(res.status).toBe('RELEASE_MISMATCH');
        expect(res.isAligned).toBe(false);
        expect(res.penalty).toBe(0.50);
        expect(res.message).toMatch(/does not match target family/);
      });
    }

    it('detects cross-family when specified via validTo instead of validFrom', () => {
      const res = ReleaseAlignmentValidator.validate('S4HC_2408', null, 'S4H_2023');
      expect(res.status).toBe('RELEASE_MISMATCH');
      expect(res.isAligned).toBe(false);
      expect(res.penalty).toBe(0.50);
    });
  });

  describe('2. Intra-Family Aligned Releases (Adjacent & Version-Aligned)', () => {
    const requiredAlignedCases = [
      { target: 'S4HC_2408', from: 'S4HC_2402', desc: 'Cloud semi-annual adjacent: 2408 >= 2402' },
      { target: '2021', from: '2020', desc: 'On-prem annual adjacent: 2021 >= 2020' },
      { target: '2408', from: '2402', desc: 'Numeric cloud adjacent: 2408 >= 2402' },
      { target: 'S4H_2021', from: 'S4H_2020', desc: 'On-prem prefixed adjacent: S4H_2021 >= S4H_2020' },
      { target: 'S4HANA_2021', from: 'S4_2020', desc: 'On-prem mixed prefix adjacent: 2021 >= 2020' },
      { target: 'S4HC_2408', from: '2402', desc: 'Cloud prefixed vs numeric: S4HC_2408 >= 2402' },
      { target: '2408', from: 'S4HC_2402', desc: 'Cloud numeric vs prefixed: 2408 >= S4HC_2402' },
      { target: 'S4HANA_CLOUD_2408', from: 'S4HC_2402', desc: 'Cloud long vs short prefix: 2408 >= 2402' },
      { target: '1909', from: '1809', desc: 'On-prem classic annual adjacent: 1909 >= 1809' },
      { target: '2023', from: '2022', desc: 'On-prem annual adjacent: 2023 >= 2022' },
    ];

    for (const { target, from, desc } of requiredAlignedCases) {
      it(`strictly enforces RELEASE_ALIGNED, isAligned:true, penalty:1.00 for ${desc}`, () => {
        const res = ReleaseAlignmentValidator.validate(target, from);
        expect(res.status).toBe('RELEASE_ALIGNED');
        expect(res.isAligned).toBe(true);
        expect(res.penalty).toBe(1.00);
        expect(res.message).toBe('Evidence is release-aligned.');
      });
    }
  });

  describe('3. Exhaustive 11x11 Release Combinatorial Matrix (121 Pairs)', () => {
    const releases = [
      'S4HC_2408', '2408', 'S4HANA_CLOUD_2402', '2402',
      'S4H_2023', '2023', 'S4_2022', '2021', '2020',
      'ECC', 'ECC 6.0'
    ];

    const familyMap: Record<string, 'S4HANA_CLOUD' | 'ON_PREMISE' | 'ECC'> = {
      'S4HC_2408': 'S4HANA_CLOUD',
      '2408': 'S4HANA_CLOUD',
      'S4HANA_CLOUD_2402': 'S4HANA_CLOUD',
      '2402': 'S4HANA_CLOUD',
      'S4H_2023': 'ON_PREMISE',
      '2023': 'ON_PREMISE',
      'S4_2022': 'ON_PREMISE',
      '2021': 'ON_PREMISE',
      '2020': 'ON_PREMISE',
      'ECC': 'ECC',
      'ECC 6.0': 'ECC'
    };

    it('evaluates all 121 pairs with 100% adherence to cross-family and alignment rules', () => {
      let mismatchCount = 0;
      let alignedCount = 0;
      let prematureCount = 0;
      let futureCount = 0;

      for (const target of releases) {
        for (const fromRel of releases) {
          const targetFam = familyMap[target];
          const fromFam = familyMap[fromRel];
          const res = ReleaseAlignmentValidator.validate(target, fromRel);

          if (targetFam !== fromFam) {
            mismatchCount++;
            expect(res.status).toBe('RELEASE_MISMATCH');
            expect(res.isAligned).toBe(false);
            expect(res.penalty).toBe(0.50);
          } else {
            if (res.status === 'RELEASE_ALIGNED') {
              alignedCount++;
              expect(res.isAligned).toBe(true);
              expect(res.penalty).toBe(1.00);
            } else if (res.status === 'RELEASE_PREMATURE') {
              prematureCount++;
              expect(res.isAligned).toBe(false);
              expect(res.penalty).toBe(0.40);
            } else if (res.status === 'RELEASE_FUTURE') {
              futureCount++;
              expect(res.isAligned).toBe(true);
              expect(res.penalty).toBe(0.80);
            }
          }
        }
      }

      expect(mismatchCount).toBe(76);
      expect(alignedCount).toBe(27);
      expect(prematureCount).toBe(13);
      expect(futureCount).toBe(5);
      expect(mismatchCount + alignedCount + prematureCount + futureCount).toBe(121);
    });
  });

  describe('4. Zero Trust Leaks Verification', () => {
    it('verifies cross-family penalty scales down authoritative metadata and prevents trust leaks', () => {
      const res = ReleaseAlignmentValidator.validate('S4HC_2408', 'S4H_2023');
      expect(res.isAligned).toBe(false);
      expect(res.penalty).toBe(0.50);

      // Official SAP metadata has baseline trust 1.00
      const officialMetadataTrust = 1.00;
      const penalizedScore = officialMetadataTrust * res.penalty;
      expect(penalizedScore).toBe(0.50);

      // Multiple corroborating cross-family evidence items must not exceed 0.70
      const corroboratingScores = [penalizedScore, penalizedScore, penalizedScore];
      const composite = calculateCompositeTrustScore(corroboratingScores);
      expect(composite).toBeLessThan(0.70);
      expect(composite).toBe(0.595);

      // LLM ceiling remains strictly enforced at 0.60
      const llmComposite = calculateCompositeTrustScore(corroboratingScores, { isLlmGenerated: true });
      expect(llmComposite).toBeLessThanOrEqual(0.60);
    });
  });
});
