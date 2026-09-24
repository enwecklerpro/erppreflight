"""
Adversarial Empirical Stress Harness — Milestone 2 Iteration 2 Challenger 2
Tests:
1. Audit Trail Sub-Millisecond Collisions (100 events, reverse UUIDs, shuffle order)
2. Audit Trail Gap Detection (single gap, block gap, re-chained gap, multi gap)
3. Composite Trust Accumulator (Monte Carlo monotonicity fuzzing, 0.60 LLM ceiling, boundary bounds)
4. ReleaseAlignmentValidator (2308, 2402, 2408, 2502 classification, on-prem disambiguation, alignment rules)
"""

import random
import uuid
import pytest
from src.platform.audit import (
    AuditTrailLedger,
    AuditEvent,
    compute_audit_chain_hash,
)
from src.platform.evidence import (
    EvidenceEngine,
    ReleaseAlignmentValidator,
    ReleaseAlignmentResult,
)


class TestEmpiricalAuditTrailCollisionsAndGaps:
    """Empirical challenge on audit trail sub-millisecond collisions and gap detection."""

    def test_audit_trail_100_submillisecond_collisions_with_inverted_uuids(self):
        """
        STRESS TEST: 100 consecutive audit events with IDENTICAL millisecond timestamp.
        UUIDs are deliberately assigned in REVERSE lexicographical order to guarantee
        that standard (timestamp, uuid) ordering would 100% fail.
        Verify that sequence_num ASC sorting guarantees 100% deterministic topological
        verification with ZERO false-positive tamper warnings.
        """
        genesis = "0" * 64
        shared_timestamp = "2026-09-24T05:00:00.123Z"
        tenant_id = "tenant-collision-stress-100"

        events = []
        prev_hash = genesis

        # Generate 100 events with descending UUIDs:
        # Event 0: UUID ffffffff-ffff-...
        # Event 99: UUID ffffffff-0000-...
        for i in range(100):
            # Reverse lexicographical UUID: higher index has smaller UUID
            reversed_hex = f"{(999 - i):08x}-0000-0000-0000-{i:012x}"
            event_id = reversed_hex
            sequence_num = i + 1
            payload = {"action_index": i, "batch_id": "sub_milli_batch_1"}

            curr_hash = compute_audit_chain_hash(
                prev_hash=prev_hash,
                event_id=event_id,
                tenant_id=tenant_id,
                action=f"BATCH_EVENT_{i}",
                timestamp=shared_timestamp,
                payload=payload,
                sequence_num=sequence_num,
            )

            ev = AuditEvent(
                id=event_id,
                sequence_num=sequence_num,
                organization_id=tenant_id,
                action=f"BATCH_EVENT_{i}",
                resource_type="BATCH_JOB",
                resource_id=None,
                payload=payload,
                prev_hash=prev_hash,
                current_hash=curr_hash,
                created_at=shared_timestamp,
            )
            events.append(ev)
            prev_hash = curr_hash

        # Confirm UUID inversion: event 0 has larger UUID than event 99
        assert events[0].id > events[99].id

        # Pass completely shuffled array into verify_ledger
        shuffled_events = list(events)
        random.seed(42)
        random.shuffle(shuffled_events)

        # Execution of verify_ledger must topologically sort by sequence_num
        result = AuditTrailLedger.verify_ledger(shuffled_events)

        assert result.is_valid is True, f"Ledger unexpectedly invalid! Anomalies: {result.anomalies}"
        assert result.total_events_verified == 100
        assert result.genesis_event_id == events[0].id
        assert result.tip_event_id == events[99].id
        assert len(result.anomalies) == 0, f"Found false positive anomalies: {result.anomalies}"

        # Verify verify_chain alias also works identically
        chain_result = AuditTrailLedger.verify_chain(shuffled_events)
        assert chain_result.is_valid is True
        assert chain_result.total_events_verified == 100
        assert len(chain_result.anomalies) == 0

    def test_audit_trail_non_one_based_sequence_monotonicity(self):
        """
        Verify that sequence_num starting at an arbitrary offset (e.g. 50000)
        verifies cleanly without false GAP_DETECTED on genesis.
        """
        genesis = "0" * 64
        shared_time = "2026-09-24T05:15:00.000Z"
        tenant_id = "tenant-offset-seq"

        events = []
        prev_hash = genesis
        start_seq = 50000

        for i in range(20):
            seq = start_seq + i
            ev_id = str(uuid.uuid4())
            curr_hash = compute_audit_chain_hash(
                prev_hash=prev_hash,
                event_id=ev_id,
                tenant_id=tenant_id,
                action=f"STEP_{i}",
                timestamp=shared_time,
                payload={"step": i},
                sequence_num=seq,
            )
            events.append(AuditEvent(
                id=ev_id,
                sequence_num=seq,
                organization_id=tenant_id,
                action=f"STEP_{i}",
                resource_type="SYSTEM",
                resource_id=None,
                payload={"step": i},
                prev_hash=prev_hash,
                current_hash=curr_hash,
                created_at=shared_time,
            ))
            prev_hash = curr_hash

        res = AuditTrailLedger.verify_ledger(events)
        assert res.is_valid is True
        assert res.total_events_verified == 20
        assert len(res.anomalies) == 0

    def test_audit_trail_single_gap_detection_with_rehashed_successor(self):
        """
        ADVERSARIAL ATTACK SCENARIO:
        Event 6 is deleted from a 10-event sequence (1..10).
        The adversary re-chains Event 7's prev_hash to point to Event 5's current_hash,
        attempting to conceal the deletion by preserving the cryptographic hash chain.
        GAP_DETECTED must still catch the missing sequence_num!
        """
        genesis = "0" * 64
        tenant_id = "tenant-gap-attack"
        base_time = "2026-09-24T05:20:00"

        events = []
        prev_hash = genesis

        # Create 1..5
        for i in range(1, 6):
            ev_id = f"00000000-0000-0000-0000-{i:012x}"
            t = f"{base_time}:{i:02d}Z"
            h = compute_audit_chain_hash(prev_hash, ev_id, tenant_id, f"ACT_{i}", t, {"idx": i}, sequence_num=i)
            events.append(AuditEvent(
                id=ev_id,
                sequence_num=i,
                organization_id=tenant_id,
                action=f"ACT_{i}",
                resource_type="SYSTEM",
                resource_id=None,
                payload={"idx": i},
                prev_hash=prev_hash,
                current_hash=h,
                created_at=t,
            ))
            prev_hash = h

        hash_5 = prev_hash

        # Event 6 is skipped!
        # Event 7 is created pointing directly to hash_5
        prev_hash = hash_5
        for i in range(7, 11):
            ev_id = f"00000000-0000-0000-0000-{i:012x}"
            t = f"{base_time}:{i:02d}Z"
            h = compute_audit_chain_hash(prev_hash, ev_id, tenant_id, f"ACT_{i}", t, {"idx": i}, sequence_num=i)
            events.append(AuditEvent(
                id=ev_id,
                sequence_num=i,
                organization_id=tenant_id,
                action=f"ACT_{i}",
                resource_type="SYSTEM",
                resource_id=None,
                payload={"idx": i},
                prev_hash=prev_hash,
                current_hash=h,
                created_at=t,
            ))
            prev_hash = h

        # Verification of the 9 events (with sequence numbers [1,2,3,4,5,7,8,9,10])
        res = AuditTrailLedger.verify_ledger(events)
        assert res.is_valid is False
        gaps = [a for a in res.anomalies if a.anomaly_type == "GAP_DETECTED"]
        assert len(gaps) == 1
        assert gaps[0].event_index == 5  # index 5 is Event 7
        assert gaps[0].expected_value == "6"
        assert gaps[0].actual_value == "7"
        assert gaps[0].event_id == events[5].id

    def test_audit_trail_block_deletion_gap_detection(self):
        """Verify gap detection when multiple contiguous events are deleted (e.g. 4, 5, 6, 7)."""
        genesis = "0" * 64
        tenant_id = "tenant-block-gap"
        time_str = "2026-09-24T05:30:00Z"

        # Event 1..3
        events = []
        prev = genesis
        for i in [1, 2, 3]:
            eid = f"00000000-0000-0000-0000-{i:012x}"
            h = compute_audit_chain_hash(prev, eid, tenant_id, f"ACT_{i}", time_str, {}, sequence_num=i)
            events.append({"id": eid, "sequence_num": i, "organization_id": tenant_id, "action": f"ACT_{i}", "created_at": time_str, "payload": {}, "prev_hash": prev, "current_hash": h})
            prev = h

        # Jump to Event 8 (missing 4, 5, 6, 7)
        for i in [8, 9]:
            eid = f"00000000-0000-0000-0000-{i:012x}"
            h = compute_audit_chain_hash(prev, eid, tenant_id, f"ACT_{i}", time_str, {}, sequence_num=i)
            events.append({"id": eid, "sequence_num": i, "organization_id": tenant_id, "action": f"ACT_{i}", "created_at": time_str, "payload": {}, "prev_hash": prev, "current_hash": h})
            prev = h

        res = AuditTrailLedger.verify_ledger(events)
        assert res.is_valid is False
        gaps = [a for a in res.anomalies if a.anomaly_type == "GAP_DETECTED"]
        assert len(gaps) == 1
        assert gaps[0].expected_value == "4"
        assert gaps[0].actual_value == "8"
        assert gaps[0].event_index == 3

    def test_audit_trail_multiple_disjoint_gaps_detection(self):
        """Verify multiple disjoint gaps (e.g. sequence 1, 3, 6, 10)."""
        genesis = "0" * 64
        tenant_id = "tenant-multi-gap"
        time_str = "2026-09-24T05:35:00Z"

        seqs = [1, 3, 6, 10]
        events = []
        prev = genesis
        for s in seqs:
            eid = f"00000000-0000-0000-0000-{s:012x}"
            h = compute_audit_chain_hash(prev, eid, tenant_id, f"ACT_{s}", time_str, {}, sequence_num=s)
            events.append({"id": eid, "sequence_num": s, "organization_id": tenant_id, "action": f"ACT_{s}", "created_at": time_str, "payload": {}, "prev_hash": prev, "current_hash": h})
            prev = h

        res = AuditTrailLedger.verify_ledger(events)
        assert res.is_valid is False
        gaps = [a for a in res.anomalies if a.anomaly_type == "GAP_DETECTED"]
        assert len(gaps) == 3
        assert gaps[0].expected_value == "2" and gaps[0].actual_value == "3"
        assert gaps[1].expected_value == "4" and gaps[1].actual_value == "6"
        assert gaps[2].expected_value == "7" and gaps[2].actual_value == "10"


class TestEmpiricalCompositeTrustAccumulator:
    """Empirical challenge on Composite Trust Accumulator monotonicity, bounds, and LLM ceiling."""

    def test_composite_trust_fuzz_monotonicity_property(self):
        """
        PROPERTY-BASED FUZZ TEST:
        For ANY initial collection of evidence scores and ANY new corroborating score,
        calculate_composite_trust(scores + [new_score]) MUST BE >= calculate_composite_trust(scores).
        Trust score can NEVER attenuate when corroborating evidence is added.
        """
        random.seed(1337)
        for trial in range(500):
            # Generate 1 to 10 random evidence scores in [0.0, 1.0]
            num_scores = random.randint(1, 10)
            base_scores = [round(random.uniform(0.0, 1.0), 3) for _ in range(num_scores)]

            base_trust = EvidenceEngine.calculate_composite_trust(base_scores)

            # Generate an additional corroborating score
            new_score = round(random.uniform(0.0, 1.0), 3)
            boosted_trust = EvidenceEngine.calculate_composite_trust(base_scores + [new_score])

            # Invariant: adding evidence never attenuates trust
            assert boosted_trust >= base_trust - 1e-9, (
                f"Monotonicity violation on trial {trial}: "
                f"Base scores={base_scores} -> Trust={base_trust}, "
                f"Added {new_score} -> Trust={boosted_trust} (< {base_trust})!"
            )

    def test_strict_060_ceiling_under_all_conditions_for_llm_generated(self):
        """
        HARD EPISTEMIC CEILING INVARIANT:
        When is_llm_generated is True, the composite trust score can NEVER exceed 0.60,
        regardless of how many corroborating pieces of evidence or how high individual scores are.
        """
        # Scenario A: 50 perfect 1.0 scores with LLM
        perfect_scores = [1.0] * 50
        trust = EvidenceEngine.calculate_composite_trust(perfect_scores, is_llm_generated=True)
        assert trust == 0.60, f"Expected 0.60 ceiling, got {trust}"

        # Scenario B: Single 1.0 score with LLM
        assert EvidenceEngine.calculate_composite_trust([1.0], is_llm_generated=True) == 0.60

        # Scenario C: Single 0.85 score with LLM
        assert EvidenceEngine.calculate_composite_trust([0.85], is_llm_generated=True) == 0.60

        # Scenario D: Scores naturally lower than 0.60 (e.g. 0.30, 0.40)
        low_scores = [0.30, 0.40]
        # Max is 0.40, corroborating 0.30 adds: (1 - 0.40) * (0.06) = 0.036 -> 0.436
        trust_low = EvidenceEngine.calculate_composite_trust(low_scores, is_llm_generated=True)
        assert trust_low <= 0.60
        assert trust_low == 0.436

        # Scenario E: Randomized Fuzzing with is_llm_generated=True
        random.seed(999)
        for _ in range(200):
            scores = [random.uniform(0.0, 1.0) for _ in range(random.randint(1, 20))]
            t = EvidenceEngine.calculate_composite_trust(scores, is_llm_generated=True)
            assert t <= 0.60, f"Ceiling breach: scores={scores} produced {t} > 0.60"

    def test_composite_trust_boundary_and_out_of_range_handling(self):
        """Verify behavior on empty list, zero scores, and out-of-range score clamping."""
        assert EvidenceEngine.calculate_composite_trust([]) == 0.0
        assert EvidenceEngine.calculate_composite_trust([0.0]) == 0.0
        assert EvidenceEngine.calculate_composite_trust([0.0, 0.0]) == 0.0

        # Scores > 1.0 are clamped to 1.0
        assert EvidenceEngine.calculate_composite_trust([1.5, 2.0]) == 1.0

        # Negative scores are clamped to 0.0
        assert EvidenceEngine.calculate_composite_trust([-0.5, 0.85]) == 0.85


class TestEmpiricalReleaseAlignmentValidator:
    """Empirical challenge on ReleaseAlignmentValidator for S/4HANA Cloud and On-Premise."""

    @pytest.mark.parametrize("release_str, expected_ver", [
        ("2308", 2308),
        ("2402", 2402),
        ("2408", 2408),
        ("2502", 2502),
        ("  2408  ", 2408),
    ])
    def test_required_raw_releases_classify_as_s4hana_cloud(self, release_str, expected_ver):
        """Raw strings 2308, 2402, 2408, 2502 classify as S4HANA_CLOUD with correct version."""
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "S4HANA_CLOUD", f"Failed for {release_str}: got family={fam}"
        assert ver == expected_ver, f"Failed for {release_str}: got version={ver}"

    @pytest.mark.parametrize("release_str, expected_ver", [
        ("S4HC_2308", 2308),
        ("S4HC_2402", 2402),
        ("S4HC_2408", 2408),
        ("S4HC_2502", 2502),
        ("S4HANA_CLOUD_2308", 2308),
        ("S4HANA_CLOUD_2402", 2402),
        ("S4HANA_CLOUD_2408", 2408),
        ("S4HANA_CLOUD_2502", 2502),
    ])
    def test_bug_prefixed_cloud_releases_version_corruption(self, release_str, expected_ver):
        """Prefixed S/4HANA Cloud releases currently fail due to '4' in 'S4'."""
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "S4HANA_CLOUD"
        assert ver == expected_ver

    @pytest.mark.parametrize("release_str, expected_ver", [
        ("2020", 2020),
        ("2021", 2021),
        ("2022", 2022),
        ("2023", 2023),
        ("2025", 2025),
        ("1809", 1809),
        ("1909", 1909),
        ("1511", 1511),
        ("1610", 1610),
        ("1709", 1709),
    ])
    def test_on_premise_raw_releases_properly_disambiguated(self, release_str, expected_ver):
        """On-Premise releases must classify as ON_PREMISE and not collide with Cloud YYMM."""
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "ON_PREMISE", f"Failed for {release_str}: got family={fam}"
        assert ver == expected_ver, f"Failed for {release_str}: got version={ver}"

    @pytest.mark.parametrize("release_str, expected_ver", [
        ("S4H_2023", 2023),
        ("S4_2022", 2022),
        ("S4HANA_2023", 2023),
    ])
    def test_bug_prefixed_on_premise_releases_version_corruption(self, release_str, expected_ver):
        """Prefixed S/4HANA On-Premise releases fail due to '4' in 'S4'."""
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "ON_PREMISE"
        assert ver == expected_ver

    def test_release_alignment_validation_scenarios(self):
        """Test release alignment rules: aligned, premature, deprecated, family mismatch."""
        # 1. Aligned: target 2408, valid_from 2402 -> ALIGNED
        res1 = ReleaseAlignmentValidator.validate(target_release="2408", valid_from="2402")
        assert res1.is_aligned is True
        assert res1.status == "RELEASE_ALIGNED"
        assert res1.penalty == 1.00

        # 2. Premature: target 2408, valid_from 2502 -> PREMATURE (penalty 0.40)
        res2 = ReleaseAlignmentValidator.validate(target_release="2408", valid_from="2502")
        assert res2.is_aligned is False
        assert res2.status == "RELEASE_PREMATURE"
        assert res2.penalty == 0.40

        # 3. Deprecated: target 2408, valid_to 2308 -> DEPRECATED
        res3 = ReleaseAlignmentValidator.validate(target_release="2408", valid_to="2308")
        assert res3.is_aligned is False
        assert res3.status == "RELEASE_DEPRECATED"
        assert res3.penalty == 0.0

        # 4. Family Mismatch: target 2408 (Cloud), evidence On-Premise
        res4 = ReleaseAlignmentValidator.validate(
            target_release="2408",
            target_family="S4HANA_CLOUD",
            evidence_family="ON_PREMISE"
        )
        assert res4.is_aligned is False
        assert res4.status in ("RELEASE_MISMATCH", "FAMILY_MISMATCH")
        assert res4.penalty == 0.50

    def test_bug_cross_release_validation_with_prefixed_valid_from(self):
        """Cross-release compatibility succeeds when valid_from has S4HC_ prefix."""
        res = ReleaseAlignmentValidator.validate(target_release="2408", valid_from="S4HC_2402")
        assert res.is_aligned is True, f"Expected 2408 to be aligned with S4HC_2402, got status={res.status}"
        assert res.status == "RELEASE_ALIGNED"
        assert res.penalty == 1.00
