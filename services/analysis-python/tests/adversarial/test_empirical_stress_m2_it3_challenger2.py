"""
Empirical Adversarial Stress Test Suite — Milestone 2 Iteration 3 (Challenger 2)

Focus:
Cross-release alignment and penalty evaluation in Python (services/analysis-python/src/platform/evidence.py)
and comparison with TypeScript (packages/evidence/src/release-alignment.ts).

Test Combinations:
1. Aligned: target >= validFrom (penalty 1.00, status RELEASE_ALIGNED)
2. Premature: target < validFrom (penalty 0.40, status RELEASE_PREMATURE)
3. Future: target >= validFrom + 2 releases ahead (penalty 0.80, status RELEASE_FUTURE)
4. Mismatch: cross-family e.g. S4HANA_CLOUD vs ON_PREMISE (penalty 0.50, status RELEASE_MISMATCH)
5. Fallback: Invalid / empty versions fallback
6. Parity: Status codes and error messages
"""

import pytest
from src.platform.evidence import ReleaseAlignmentValidator


class TestEmpiricalReleaseAlignmentChallenger2:
    """Adversarial stress-test suite for cross-release alignment and penalty evaluation."""

    # -------------------------------------------------------------------------
    # 1. Aligned Releases: target >= validFrom
    # Requirement: penalty 1.00, status RELEASE_ALIGNED
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("target, valid_from, desc", [
        ("2408", "2402", "Cloud numeric: 2408 >= 2402"),
        ("S4HC_2408", "S4HC_2402", "Cloud prefixed: S4HC_2408 >= S4HC_2402"),
        ("S4HANA_CLOUD_2408", "S4HANA_CLOUD_2402", "Cloud long prefix: 2408 >= 2402"),
        ("S4H_2021", "S4H_2020", "On-prem prefixed: 2021 >= 2020"),
        ("S4HANA_2021", "S4_2020", "On-prem mixed prefix: 2021 >= 2020"),
        ("2021", "2020", "On-prem numeric: 2021 >= 2020"),
        ("S4H_2023", "S4H_2023", "Identical on-prem version: 2023 == 2023"),
        ("S4HC_2408", "S4HC_2408", "Identical cloud version: 2408 == 2408"),
    ])
    def test_aligned_releases_penalty_and_status(self, target, valid_from, desc):
        """Aligned releases (target >= validFrom) must produce penalty 1.00 and RELEASE_ALIGNED."""
        res = ReleaseAlignmentValidator.validate(target_release=target, valid_from=valid_from)
        assert res.is_aligned is True, f"Failed {desc}: expected is_aligned=True"
        assert res.status == "RELEASE_ALIGNED", f"Failed {desc}: got status={res.status}"
        assert res.penalty == 1.00, f"Failed {desc}: got penalty={res.penalty}"
        assert res.message == "Evidence is release-aligned."

    # -------------------------------------------------------------------------
    # 2. Premature Releases: target < validFrom
    # Requirement: penalty 0.40, status RELEASE_PREMATURE
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("target, valid_from", [
        ("S4HC_2302", "S4HC_2408"),
        ("2402", "2408"),
        ("S4H_2020", "S4H_2023"),
        ("2020", "2023"),
    ])
    def test_premature_releases_status_matches(self, target, valid_from):
        """Current engine marks target < validFrom as RELEASE_PREMATURE with is_aligned=False."""
        res = ReleaseAlignmentValidator.validate(target_release=target, valid_from=valid_from)
        assert res.is_aligned is False
        assert res.status == "RELEASE_PREMATURE"

    @pytest.mark.parametrize("target, valid_from", [
        ("S4HC_2302", "S4HC_2408"),
        ("2402", "2408"),
        ("S4H_2020", "S4H_2023"),
        ("2020", "2023"),
    ])
    def test_premature_release_penalty_is_0_40(self, target, valid_from):
        """Premature releases (target < validFrom) must produce penalty 0.40."""
        res = ReleaseAlignmentValidator.validate(target_release=target, valid_from=valid_from)
        assert res.penalty == 0.40, f"Expected penalty 0.40, but got {res.penalty}"

    # -------------------------------------------------------------------------
    # 3. Future Releases: target >= validFrom + 2 releases ahead
    # Requirement: penalty 0.80, status RELEASE_FUTURE
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("target, valid_from, desc", [
        ("S4HC_2502", "S4HC_2402", "Cloud: 2502 is 2 releases ahead of 2402 (2402 -> 2408 -> 2502)"),
        ("S4HC_2508", "S4HC_2402", "Cloud: 2508 is 3 releases ahead of 2402"),
        ("S4H_2025", "S4H_2021", "On-Prem: 2025 is >= 2 releases ahead of 2021"),
        ("2023", "2020", "On-Prem: 2023 is >= 2 releases ahead of 2020"),
    ])
    def test_future_releases_penalty_and_status(self, target, valid_from, desc):
        """Features >= 2 releases ahead must yield status RELEASE_FUTURE and penalty 0.80."""
        res = ReleaseAlignmentValidator.validate(target_release=target, valid_from=valid_from)
        assert res.status == "RELEASE_FUTURE", f"Failed {desc}: got {res.status}"
        assert res.penalty == 0.80, f"Failed {desc}: got {res.penalty}"

    # -------------------------------------------------------------------------
    # 4. Cross-Family Mismatch: e.g. S4HANA_CLOUD vs ON_PREMISE
    # Requirement: penalty 0.50, status RELEASE_MISMATCH
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("target, valid_from, desc", [
        ("S4HANA_CLOUD_2408", "S4H_2023", "Target Cloud vs validFrom On-Premise"),
        ("S4HC_2408", "S4H_2020", "Target S4HC vs validFrom S4H"),
        ("S4H_2023", "S4HC_2408", "Target On-Premise vs validFrom Cloud"),
        ("2408", "2023", "Numeric Cloud 2408 vs Numeric On-Premise 2023"),
    ])
    def test_cross_family_mismatch_without_explicit_family_args(self, target, valid_from, desc):
        """Cross-family releases without explicit family parameters must detect mismatch."""
        res = ReleaseAlignmentValidator.validate(target_release=target, valid_from=valid_from)
        assert res.is_aligned is False, f"Failed {desc}: cross-family was marked is_aligned=True"
        assert res.penalty == 0.50, f"Failed {desc}: expected penalty 0.50, got {res.penalty}"
        assert res.status in ("RELEASE_MISMATCH", "FAMILY_MISMATCH")

    def test_cross_family_status_code_name(self):
        """Specification requires status 'RELEASE_MISMATCH'."""
        res = ReleaseAlignmentValidator.validate(
            target_release="S4HC_2408",
            target_family="S4HANA_CLOUD",
            evidence_family="ON_PREMISE"
        )
        assert res.status == "RELEASE_MISMATCH", f"Expected 'RELEASE_MISMATCH', got '{res.status}'"

    def test_cross_family_mismatch_with_explicit_family_args(self):
        """When family args are provided, engine correctly applies 0.50 penalty and RELEASE_MISMATCH."""
        res = ReleaseAlignmentValidator.validate(
            target_release="S4HC_2408",
            target_family="S4HANA_CLOUD",
            evidence_family="ON_PREMISE"
        )
        assert res.is_aligned is False
        assert res.penalty == 0.50
        assert res.status in ("RELEASE_MISMATCH", "FAMILY_MISMATCH")

    # -------------------------------------------------------------------------
    # 5. Invalid / Malformed / Empty Version Strings Fallback
    # Requirement: Graceful fallback, demotion to UNKNOWN (penalty 0.30)
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("target, valid_from, desc", [
        ("INVALID_UNKNOWN_XYZ", "2408", "Completely unparseable target release"),
        ("", "2408", "Empty target release"),
        ("2408", "INVALID_UNKNOWN_XYZ", "Completely unparseable valid_from release"),
        ("", "", "Both releases empty strings"),
    ])
    def test_invalid_release_strings_must_not_yield_aligned(self, target, valid_from, desc):
        """
        An unparseable or empty target release cannot be verified. Per sap-evidence.md §2.3 and §7.2,
        it must be demoted to UNKNOWN (penalty 0.30) or rejected, NEVER marked RELEASE_ALIGNED (1.00).
        """
        res = ReleaseAlignmentValidator.validate(target_release=target, valid_from=valid_from)
        assert res.status != "RELEASE_ALIGNED", f"Failed {desc}: unparseable string returned RELEASE_ALIGNED"
        assert res.is_aligned is False
        assert res.penalty <= 0.30

    # -------------------------------------------------------------------------
    # 6. Cross-Language Parity: Messages & Status
    # -------------------------------------------------------------------------
    def test_message_parity_discrepancies_documented(self):
        """
        Verify unified exact text formatting between TS and Python:
        - RELEASE_MISMATCH:
          'Evidence release family (ON_PREMISE) does not match target family (S4HANA_CLOUD).'
        - RELEASE_DEPRECATED:
          'Feature was deprecated or removed after release 2308. Target is 2408.'
        """
        py_mismatch = ReleaseAlignmentValidator.validate(
            target_release="2408", target_family="S4HANA_CLOUD", evidence_family="ON_PREMISE"
        )
        assert py_mismatch.message == "Evidence release family (ON_PREMISE) does not match target family (S4HANA_CLOUD)."

        py_deprecated = ReleaseAlignmentValidator.validate(target_release="2408", valid_to="2308")
        assert py_deprecated.message == "Feature was deprecated or removed after release 2308. Target is 2408."
