import { describe, it, expect } from 'vitest';
import { ReleaseAlignmentValidator } from '@erppreflight/evidence';

describe('Empirical Challenger Test Suite — Milestone 2 Iteration 3', () => {
  describe('Canonical S/4HANA Cloud Prefixes Matrix', () => {
    const cloudReleases = [
      { rel: 'S4HC_2408', ver: 2408 },
      { rel: 'S4HC_2402', ver: 2402 },
      { rel: 'S4HC_2308', ver: 2308 },
      { rel: 'S4HC_2302', ver: 2302 },
      { rel: 'S4HC_2502', ver: 2502 },
      { rel: 'S4HC_2508', ver: 2508 },
      { rel: 'S4HANA_CLOUD_2408', ver: 2408 },
      { rel: 'S4HANA_CLOUD_2402', ver: 2402 },
      { rel: 'S4HANA_CLOUD_2308', ver: 2308 },
      { rel: 'S4HANA_CLOUD_2302', ver: 2302 },
      { rel: 'S4HANA_CLOUD_2502', ver: 2502 },
      { rel: 'S4HANA_CLOUD_2508', ver: 2508 },
    ];

    for (const { rel, ver } of cloudReleases) {
      it(`parses ${rel} accurately to S4HANA_CLOUD and version ${ver} without prepending 4`, () => {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe('S4HANA_CLOUD');
        expect(res.version).toBe(ver);
        expect(res.version).toBeLessThan(40000);
        expect(res.version).not.toBe(40000 + ver);
      });
    }
  });

  describe('Canonical S/4HANA On-Premise Prefixes Matrix', () => {
    const onPremReleases = [
      { rel: 'S4H_2023', ver: 2023 },
      { rel: 'S4H_2022', ver: 2022 },
      { rel: 'S4H_2021', ver: 2021 },
      { rel: 'S4H_2020', ver: 2020 },
      { rel: 'S4H_2025', ver: 2025 },
      { rel: 'S4H_1909', ver: 1909 },
      { rel: 'S4H_1809', ver: 1809 },
      { rel: 'S4H_1709', ver: 1709 },
      { rel: 'S4H_1610', ver: 1610 },
      { rel: 'S4H_1511', ver: 1511 },
      { rel: 'S4_2023', ver: 2023 },
      { rel: 'S4_2022', ver: 2022 },
      { rel: 'S4_2021', ver: 2021 },
      { rel: 'S4_2020', ver: 2020 },
      { rel: 'S4_2025', ver: 2025 },
      { rel: 'S4HANA_2023', ver: 2023 },
      { rel: 'S4HANA_2022', ver: 2022 },
      { rel: 'S4HANA_2021', ver: 2021 },
      { rel: 'S4HANA_2020', ver: 2020 },
      { rel: 'S4HANA_2025', ver: 2025 },
      { rel: 'S4HANA_1909', ver: 1909 },
      { rel: 'S4HANA_1809', ver: 1809 },
      { rel: 'S4HANA_1709', ver: 1709 },
    ];

    for (const { rel, ver } of onPremReleases) {
      it(`parses ${rel} accurately to ON_PREMISE and version ${ver} without prepending 4`, () => {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe('ON_PREMISE');
        expect(res.version).toBe(ver);
        expect(res.version).toBeLessThan(40000);
        expect(res.version).not.toBe(40000 + ver);
      });
    }
  });

  describe('Raw Versions Disambiguation (No Prefix)', () => {
    const rawReleases = [
      { rel: '2308', fam: 'S4HANA_CLOUD', ver: 2308 },
      { rel: '2302', fam: 'S4HANA_CLOUD', ver: 2302 },
      { rel: '2402', fam: 'S4HANA_CLOUD', ver: 2402 },
      { rel: '2408', fam: 'S4HANA_CLOUD', ver: 2408 },
      { rel: '2502', fam: 'S4HANA_CLOUD', ver: 2502 },
      { rel: '2508', fam: 'S4HANA_CLOUD', ver: 2508 },
      { rel: '2020', fam: 'ON_PREMISE', ver: 2020 },
      { rel: '2021', fam: 'ON_PREMISE', ver: 2021 },
      { rel: '2022', fam: 'ON_PREMISE', ver: 2022 },
      { rel: '2023', fam: 'ON_PREMISE', ver: 2023 },
      { rel: '2025', fam: 'ON_PREMISE', ver: 2025 },
      { rel: '1909', fam: 'ON_PREMISE', ver: 1909 },
      { rel: '1809', fam: 'ON_PREMISE', ver: 1809 },
      { rel: '1709', fam: 'ON_PREMISE', ver: 1709 },
      { rel: '1610', fam: 'ON_PREMISE', ver: 1610 },
      { rel: '1511', fam: 'ON_PREMISE', ver: 1511 },
    ];

    for (const { rel, fam, ver } of rawReleases) {
      it(`disambiguates raw release ${rel} to family ${fam} and version ${ver}`, () => {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe(fam);
        expect(res.version).toBe(ver);
      });
    }
  });

  describe('Case-Insensitivity & Whitespace Resilience', () => {
    const variants = [
      { rel: 's4hc_2408', fam: 'S4HANA_CLOUD', ver: 2408 },
      { rel: '  s4hc_2408  ', fam: 'S4HANA_CLOUD', ver: 2408 },
      { rel: '\tS4HC_2408\n', fam: 'S4HANA_CLOUD', ver: 2408 },
      { rel: 's4hana_cloud_2402', fam: 'S4HANA_CLOUD', ver: 2402 },
      { rel: '  S4HANA_CLOUD_2402  ', fam: 'S4HANA_CLOUD', ver: 2402 },
      { rel: 's4h_2023', fam: 'ON_PREMISE', ver: 2023 },
      { rel: '  s4h_2023  ', fam: 'ON_PREMISE', ver: 2023 },
      { rel: '  S4_2022  ', fam: 'ON_PREMISE', ver: 2022 },
      { rel: 's4hana_2020', fam: 'ON_PREMISE', ver: 2020 },
      { rel: '  S4HANA_2020  ', fam: 'ON_PREMISE', ver: 2020 },
      { rel: '  2308  ', fam: 'S4HANA_CLOUD', ver: 2308 },
      { rel: '  2021  ', fam: 'ON_PREMISE', ver: 2021 },
      { rel: 'S4Hana_Cloud_2408', fam: 'S4HANA_CLOUD', ver: 2408 },
      { rel: 'S4h_2023', fam: 'ON_PREMISE', ver: 2023 },
    ];

    for (const { rel, fam, ver } of variants) {
      it(`handles case/whitespace variant "${rel.replace(/\t/g, '\\t').replace(/\n/g, '\\n')}" correctly`, () => {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe(fam);
        expect(res.version).toBe(ver);
        expect(res.version).toBeLessThan(40000);
      });
    }
  });

  describe('Prefix Precedence & Priority Collision Testing', () => {
    it('gives S4HANA_CLOUD_ precedence over S4HANA_ prefix', () => {
      const res = ReleaseAlignmentValidator.parseRelease('S4HANA_CLOUD_2408');
      expect(res.family).toBe('S4HANA_CLOUD');
      expect(res.version).toBe(2408);
    });

    it('correctly maps S4HANA_ without CLOUD to ON_PREMISE', () => {
      const res = ReleaseAlignmentValidator.parseRelease('S4HANA_2023');
      expect(res.family).toBe('ON_PREMISE');
      expect(res.version).toBe(2023);
    });

    it('gives S4H_ precedence over S4_', () => {
      const res = ReleaseAlignmentValidator.parseRelease('S4H_2023');
      expect(res.family).toBe('ON_PREMISE');
      expect(res.version).toBe(2023);
    });

    it('correctly maps S4_ to ON_PREMISE', () => {
      const res = ReleaseAlignmentValidator.parseRelease('S4_2022');
      expect(res.family).toBe('ON_PREMISE');
      expect(res.version).toBe(2022);
    });
  });

  describe('Malformed & Boundary Inputs', () => {
    const edgeCases = [
      { rel: 'S4HC_', fam: 'S4HANA_CLOUD', ver: 0 },
      { rel: 'S4HANA_CLOUD_', fam: 'S4HANA_CLOUD', ver: 0 },
      { rel: 'S4H_', fam: 'ON_PREMISE', ver: 0 },
      { rel: 'S4_', fam: 'ON_PREMISE', ver: 0 },
      { rel: 'S4HANA_', fam: 'ON_PREMISE', ver: 0 },
      { rel: 'S4HC_abc', fam: 'S4HANA_CLOUD', ver: 0 },
      { rel: 'S4H_XYZ', fam: 'ON_PREMISE', ver: 0 },
      { rel: 'ECC', fam: 'ECC', ver: 600 },
      { rel: 'ECC_600', fam: 'ECC', ver: 600 },
      { rel: 'ecc_ehp8', fam: 'ECC', ver: 600 },
      { rel: '', fam: 'UNKNOWN', ver: 0 },
      { rel: '   ', fam: 'UNKNOWN', ver: 0 },
    ];

    for (const { rel, fam, ver } of edgeCases) {
      it(`gracefully handles boundary case "${rel}"`, () => {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe(fam);
        expect(res.version).toBe(ver);
      });
    }
  });

  describe('Cross-Release Validation Matrix (validate)', () => {
    const matrix = [
      // Target >= validFrom (aligned)
      { target: 'S4HC_2408', from: 'S4HC_2402', to: null, status: 'RELEASE_ALIGNED', aligned: true, penalty: 1.0 },
      { target: 'S4HC_2408', from: 'S4HANA_CLOUD_2402', to: null, status: 'RELEASE_ALIGNED', aligned: true, penalty: 1.0 },
      { target: '2408', from: 'S4HC_2402', to: null, status: 'RELEASE_ALIGNED', aligned: true, penalty: 1.0 },
      { target: 'S4HC_2408', from: '2402', to: null, status: 'RELEASE_ALIGNED', aligned: true, penalty: 1.0 },
      // Target < validFrom (premature - penalty 0.40)
      { target: 'S4HC_2402', from: 'S4HC_2408', to: null, status: 'RELEASE_PREMATURE', aligned: false, penalty: 0.4 },
      { target: '2402', from: 'S4HANA_CLOUD_2408', to: null, status: 'RELEASE_PREMATURE', aligned: false, penalty: 0.4 },
      // Target > validTo (deprecated)
      { target: 'S4HC_2408', from: null, to: 'S4HC_2402', status: 'RELEASE_DEPRECATED', aligned: false, penalty: 0.0 },
      { target: 'S4HANA_CLOUD_2408', from: null, to: '2402', status: 'RELEASE_DEPRECATED', aligned: false, penalty: 0.0 },
      // Target <= validTo (aligned)
      { target: 'S4HC_2408', from: null, to: 'S4HC_2502', status: 'RELEASE_ALIGNED', aligned: true, penalty: 1.0 },
      // On-Premise matrix (adjacent aligned: 1 release ahead)
      { target: 'S4H_2023', from: 'S4H_2022', to: null, status: 'RELEASE_ALIGNED', aligned: true, penalty: 1.0 },
      { target: '2023', from: '2022', to: null, status: 'RELEASE_ALIGNED', aligned: true, penalty: 1.0 },
      // On-Premise matrix (future: >= 2 releases ahead)
      { target: 'S4H_2023', from: 'S4H_2020', to: null, status: 'RELEASE_FUTURE', aligned: true, penalty: 0.8 },
      { target: 'S4HANA_2023', from: 'S4_2020', to: null, status: 'RELEASE_FUTURE', aligned: true, penalty: 0.8 },
      { target: 'S4H_2023', from: '2020', to: null, status: 'RELEASE_FUTURE', aligned: true, penalty: 0.8 },
      { target: '2023', from: 'S4H_2020', to: null, status: 'RELEASE_FUTURE', aligned: true, penalty: 0.8 },
      // On-Premise premature & deprecated
      { target: 'S4H_2020', from: 'S4H_2023', to: null, status: 'RELEASE_PREMATURE', aligned: false, penalty: 0.4 },
      { target: 'S4H_2023', from: null, to: 'S4H_2021', status: 'RELEASE_DEPRECATED', aligned: false, penalty: 0.0 },
      { target: 'S4_2022', from: null, to: 'S4H_2025', status: 'RELEASE_ALIGNED', aligned: true, penalty: 1.0 },
    ];

    for (const { target, from, to, status, aligned, penalty } of matrix) {
      it(`validates ${target} against from=${from} to=${to} -> ${status}`, () => {
        const res = ReleaseAlignmentValidator.validate(target, from, to);
        expect(res.status).toBe(status);
        expect(res.isAligned).toBe(aligned);
        expect(res.penalty).toBe(penalty);
      });
    }
  });
});
