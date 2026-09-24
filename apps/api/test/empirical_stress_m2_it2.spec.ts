import { describe, it, expect } from 'vitest';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  computeAuditChainHash,
  calculateCompositeTrustScore,
  ReleaseAlignmentValidator,
} from '@erppreflight/evidence';

describe('Empirical Adversarial Stress Harness — Milestone 2 Iteration 2 Challenger 2', () => {
  const auditService = new AuditService(null as any);
  const tenantId = 'c-stress-tenant-it2-ch2';
  const genesisPrev = '0'.repeat(64);

  // ==========================================================================
  // 1. AUDIT TRAIL SUB-MILLISECOND COLLISIONS & SEQUENCE MONOTONICITY
  // ==========================================================================
  describe('1. Audit Trail Sub-Millisecond Collisions & Sequence Monotonicity', () => {
    it('STRESS: 100 consecutive audit events with identical millisecond timestamp and inverted UUIDs', () => {
      const sharedTime = '2026-09-24T05:00:00.123Z';
      const events: any[] = [];
      let prevHash = genesisPrev;

      // Generate 100 events where UUID is descending (reverse lexicographical)
      for (let i = 0; i < 100; i++) {
        const reversedPrefix = (999 - i).toString(16).padStart(8, '0');
        const id = `${reversedPrefix}-0000-0000-0000-${i.toString(16).padStart(12, '0')}`;
        const seq = i + 1;
        const payload = { eventNum: i, batch: 'sub_milli_stress' };

        const currentHash = computeAuditChainHash(
          prevHash,
          id,
          tenantId,
          `BATCH_ACTION_${i}`,
          sharedTime,
          payload
        );

        events.push({
          id,
          sequenceNum: seq,
          organization_id: tenantId,
          action: `BATCH_ACTION_${i}`,
          created_at: sharedTime,
          payload,
          prev_hash: prevHash,
          current_hash: currentHash,
        });

        prevHash = currentHash;
      }

      // Assert UUID inversion
      expect(events[0].id > events[99].id).toBe(true);

      // Shuffle events array (reverse order)
      const reversedEvents = [...events].reverse();

      // verifyChain must sort by sequenceNum and succeed with 0 anomalies
      const res = auditService.verifyChain(reversedEvents);

      expect(res.isValid).toBe(true);
      expect(res.totalEventsVerified).toBe(100);
      expect(res.genesisEventId).toBe(events[0].id);
      expect(res.tipEventId).toBe(events[99].id);
      expect(res.anomalies).toHaveLength(0);
    });

    it('STRESS: sequenceNum starting at non-1 offset (e.g. 50000) passes without false anomalies', () => {
      const sharedTime = '2026-09-24T05:10:00.000Z';
      const events: any[] = [];
      let prevHash = genesisPrev;
      const startSeq = 50000;

      for (let i = 0; i < 20; i++) {
        const id = `00000000-0000-0000-0000-${i.toString(16).padStart(12, '0')}`;
        const seq = startSeq + i;
        const payload = { step: i };
        const currentHash = computeAuditChainHash(
          prevHash,
          id,
          tenantId,
          `STEP_${i}`,
          sharedTime,
          payload
        );
        events.push({
          id,
          sequenceNum: seq,
          organization_id: tenantId,
          action: `STEP_${i}`,
          created_at: sharedTime,
          payload,
          prev_hash: prevHash,
          current_hash: currentHash,
        });
        prevHash = currentHash;
      }

      const res = auditService.verifyChain(events);
      expect(res.isValid).toBe(true);
      expect(res.totalEventsVerified).toBe(20);
      expect(res.anomalies).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 2. AUDIT TRAIL GAP DETECTION
  // ==========================================================================
  describe('2. Audit Trail Gap Detection', () => {
    it('DETECTS: Single deleted event in middle even when prev_hash is re-chained', () => {
      const baseTime = '2026-09-24T05:20:00';
      const events: any[] = [];
      let prevHash = genesisPrev;

      // Create events 1..5
      for (let i = 1; i <= 5; i++) {
        const id = `00000000-0000-0000-0000-${i.toString(16).padStart(12, '0')}`;
        const t = `2026-09-24T05:20:${String(i).padStart(2, '0')}.000Z`;
        const h = computeAuditChainHash(prevHash, id, tenantId, `ACT_${i}`, t, { i });
        events.push({ id, sequenceNum: i, organization_id: tenantId, action: `ACT_${i}`, created_at: t, payload: { i }, prev_hash: prevHash, current_hash: h });
        prevHash = h;
      }

      const hash5 = prevHash;
      // Skip event 6, connect event 7 directly to hash5
      prevHash = hash5;
      for (let i = 7; i <= 10; i++) {
        const id = `00000000-0000-0000-0000-${i.toString(16).padStart(12, '0')}`;
        const t = `2026-09-24T05:20:${String(i).padStart(2, '0')}.000Z`;
        const h = computeAuditChainHash(prevHash, id, tenantId, `ACT_${i}`, t, { i });
        events.push({ id, sequenceNum: i, organization_id: tenantId, action: `ACT_${i}`, created_at: t, payload: { i }, prev_hash: prevHash, current_hash: h });
        prevHash = h;
      }

      const res = auditService.verifyChain(events);
      expect(res.isValid).toBe(false);
      const gaps = res.anomalies.filter((a) => a.anomalyType === 'GAP_DETECTED');
      expect(gaps).toHaveLength(1);
      expect(gaps[0].eventIndex).toBe(5);
      expect(gaps[0].expectedValue).toBe('6');
      expect(gaps[0].actualValue).toBe('7');
      expect(gaps[0].details?.gapSize).toBe(1);
    });

    it('DETECTS: Block deletion gap (sequence 1, 2, 8, 9)', () => {
      const time = '2026-09-24T05:30:00Z';
      const events: any[] = [];
      let prev = genesisPrev;

      for (const s of [1, 2, 8, 9]) {
        const id = `00000000-0000-0000-0000-${s.toString(16).padStart(12, '0')}`;
        const h = computeAuditChainHash(prev, id, tenantId, `ACT_${s}`, time, {});
        events.push({ id, sequenceNum: s, organization_id: tenantId, action: `ACT_${s}`, created_at: time, payload: {}, prev_hash: prev, current_hash: h });
        prev = h;
      }

      const res = auditService.verifyChain(events);
      expect(res.isValid).toBe(false);
      const gaps = res.anomalies.filter((a) => a.anomalyType === 'GAP_DETECTED');
      expect(gaps).toHaveLength(1);
      expect(gaps[0].eventIndex).toBe(2);
      expect(gaps[0].expectedValue).toBe('3');
      expect(gaps[0].actualValue).toBe('8');
      expect(gaps[0].details?.gapSize).toBe(5);
    });

    it('DETECTS: Multiple disjoint sequence gaps (sequence 1, 3, 6, 10)', () => {
      const time = '2026-09-24T05:35:00Z';
      const events: any[] = [];
      let prev = genesisPrev;

      for (const s of [1, 3, 6, 10]) {
        const id = `00000000-0000-0000-0000-${s.toString(16).padStart(12, '0')}`;
        const h = computeAuditChainHash(prev, id, tenantId, `ACT_${s}`, time, {});
        events.push({ id, sequenceNum: s, organization_id: tenantId, action: `ACT_${s}`, created_at: time, payload: {}, prev_hash: prev, current_hash: h });
        prev = h;
      }

      const res = auditService.verifyChain(events);
      expect(res.isValid).toBe(false);
      const gaps = res.anomalies.filter((a) => a.anomalyType === 'GAP_DETECTED');
      expect(gaps).toHaveLength(3);
      expect(gaps[0].expectedValue).toBe('2');
      expect(gaps[0].actualValue).toBe('3');
      expect(gaps[1].expectedValue).toBe('4');
      expect(gaps[1].actualValue).toBe('6');
      expect(gaps[2].expectedValue).toBe('7');
      expect(gaps[2].actualValue).toBe('10');
    });
  });

  // ==========================================================================
  // 3. COMPOSITE TRUST ACCUMULATOR MONOTONICITY & 0.60 CEILING
  // ==========================================================================
  describe('3. Composite Trust Accumulator Monotonicity & 0.60 Ceiling', () => {
    it('FUZZ MONOTONICITY: Adding corroborating evidence NEVER attenuates composite trust score', () => {
      for (let trial = 0; trial < 300; trial++) {
        const numItems = Math.floor(Math.random() * 8) + 1;
        const baseScores = Array.from({ length: numItems }, () => Number((Math.random()).toFixed(3)));

        const baseTrust = calculateCompositeTrustScore(baseScores);

        const newScore = Number((Math.random()).toFixed(3));
        const boostedTrust = calculateCompositeTrustScore([...baseScores, newScore]);

        expect(boostedTrust).toBeGreaterThanOrEqual(baseTrust - 1e-9);
      }
    });

    it('STRICT CEILING: 0.60 ceiling is enforced under all conditions when isLlmGenerated is true', () => {
      // 50 perfect 1.0 scores
      const perfect50 = Array.from({ length: 50 }, () => 1.0);
      expect(calculateCompositeTrustScore(perfect50, { isLlmGenerated: true })).toBe(0.60);

      // Single 1.0 score
      expect(calculateCompositeTrustScore([1.0], { isLlmGenerated: true })).toBe(0.60);

      // Single 0.85 score
      expect(calculateCompositeTrustScore([0.85], { isLlmGenerated: true })).toBe(0.60);

      // Low scores below 0.60: [0.30, 0.40] -> 0.436 <= 0.60
      const low = calculateCompositeTrustScore([0.30, 0.40], { isLlmGenerated: true });
      expect(low).toBeLessThanOrEqual(0.60);
      expect(low).toBe(0.436);

      // Randomized trials
      for (let i = 0; i < 100; i++) {
        const randomScores = Array.from({ length: 10 }, () => Math.random());
        const t = calculateCompositeTrustScore(randomScores, { isLlmGenerated: true });
        expect(t).toBeLessThanOrEqual(0.60);
      }
    });

    it('BOUNDS & CLAMPING: Trust score always stays within [0.0, 1.0]', () => {
      expect(calculateCompositeTrustScore([])).toBe(0.0);
      expect(calculateCompositeTrustScore([0.0])).toBe(0.0);
      expect(calculateCompositeTrustScore([0.0, 0.0])).toBe(0.0);
      expect(calculateCompositeTrustScore([1.5, 2.0])).toBe(1.0);
      expect(calculateCompositeTrustScore([-0.5, 0.85])).toBe(0.85);
    });
  });

  // ==========================================================================
  // 4. RELEASE ALIGNMENT VALIDATOR S/4HANA CLOUD CLASSIFICATION
  // ==========================================================================
  describe('4. ReleaseAlignmentValidator S/4HANA Cloud Classification', () => {
    it('CLASSIFIES: 2308, 2402, 2408, 2502 strictly as S4HANA_CLOUD', () => {
      const releases = ['2308', '2402', '2408', '2502'];
      for (const rel of releases) {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe('S4HANA_CLOUD');
        expect(res.version).toBe(parseInt(rel, 10));
      }
    });

    it('CLASSIFIES: Trimmed strings and whitespace handling', () => {
      const res = ReleaseAlignmentValidator.parseRelease('  2408  ');
      expect(res.family).toBe('S4HANA_CLOUD');
      expect(res.version).toBe(2408);
    });

    it('DISAMBIGUATES: On-Premise releases classify as ON_PREMISE', () => {
      const onPrem = ['2020', '2021', '2022', '2023', '2025', '1809', '1909', '1511', '1610', '1709'];
      for (const rel of onPrem) {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe('ON_PREMISE');
        expect(res.version).toBe(parseInt(rel, 10));
      }
    });

    it('VALIDATES: Release alignment logic (aligned, premature, deprecated, family mismatch)', () => {
      const res1 = ReleaseAlignmentValidator.validate('2408', '2402');
      expect(res1.isAligned).toBe(true);
      expect(res1.status).toBe('RELEASE_ALIGNED');
      expect(res1.penalty).toBe(1.0);

      const res2 = ReleaseAlignmentValidator.validate('2408', '2502');
      expect(res2.isAligned).toBe(false);
      expect(res2.status).toBe('RELEASE_PREMATURE');
      expect(res2.penalty).toBe(0.4);

      const res3 = ReleaseAlignmentValidator.validate('2408', null, '2308');
      expect(res3.isAligned).toBe(false);
      expect(res3.status).toBe('RELEASE_DEPRECATED');
      expect(res3.penalty).toBe(0.0);

      const res4 = ReleaseAlignmentValidator.validate('2408', null, null, 'S4HANA_CLOUD', 'ON_PREMISE');
      expect(res4.isAligned).toBe(false);
      expect(['RELEASE_MISMATCH', 'FAMILY_MISMATCH']).toContain(res4.status);
      expect(res4.penalty).toBe(0.5);
    });

    it('EMPIRICAL BUG REPRODUCTION: Demonstrates prefix version corruption in parseRelease and validate', () => {
      // Confirms that S4HC_2408 correctly parses to version 2408 without prefix digit corruption
      const resS4HC = ReleaseAlignmentValidator.parseRelease('S4HC_2408');
      expect(resS4HC.family).toBe('S4HANA_CLOUD');
      expect(resS4HC.version).toBe(2408);

      // Confirms that S4H_2023 correctly parses to version 2023 without prefix digit corruption
      const resS4H = ReleaseAlignmentValidator.parseRelease('S4H_2023');
      expect(resS4H.family).toBe('ON_PREMISE');
      expect(resS4H.version).toBe(2023);

      // Validating target 2408 against validFrom S4HC_2402 succeeds as RELEASE_ALIGNED
      const crossVal = ReleaseAlignmentValidator.validate('2408', 'S4HC_2402');
      expect(crossVal.isAligned).toBe(true);
      expect(crossVal.status).toBe('RELEASE_ALIGNED');
      expect(crossVal.penalty).toBe(1.0);
      expect(crossVal.message).toBe('Evidence is release-aligned.');
    });

    it('VERIFIED: Full prefix matrix parses correctly without prepending 4', () => {
      const cloudReleases = [
        'S4HC_2308', 'S4HC_2402', 'S4HC_2408', 'S4HC_2502',
        'S4HANA_CLOUD_2308', 'S4HANA_CLOUD_2402', 'S4HANA_CLOUD_2408', 'S4HANA_CLOUD_2502',
      ];
      for (const rel of cloudReleases) {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe('S4HANA_CLOUD');
        const expected = parseInt(rel.split('_').pop()!, 10);
        expect(res.version).toBe(expected);
      }

      const onPremReleases = [
        { rel: 'S4H_2023', ver: 2023 },
        { rel: 'S4_2022', ver: 2022 },
        { rel: 'S4HANA_2023', ver: 2023 },
      ];
      for (const { rel, ver } of onPremReleases) {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe('ON_PREMISE');
        expect(res.version).toBe(ver);
      }
    });
  });
});
