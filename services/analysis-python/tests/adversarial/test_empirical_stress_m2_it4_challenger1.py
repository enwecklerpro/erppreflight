"""
Empirical Adversarial Stress Test Suite — Milestone 2 Iteration 4 (Challenger 1)

Scope:
Cross-family detection and alignment matrices across TypeScript and Python:
1. Test cross-family invocations without explicit family arguments.
2. Verify that every cross-family combination strictly yields status 'RELEASE_MISMATCH',
   is_aligned: False, penalty: 0.50, and zero trust leaks.
3. Verify that intra-family aligned releases strictly yield status 'RELEASE_ALIGNED',
   is_aligned: True, penalty: 1.00.
4. Combinatorial 11x11 matrix (121 pairs) testing cross-family isolation and zero trust leaks.
"""

import pytest
from src.platform.evidence import ReleaseAlignmentValidator, EvidenceEngine


class TestEmpiricalReleaseAlignmentChallenger1:
    """Empirical adversarial stress test suite for M2 Iteration 4 Challenger 1."""

    # -------------------------------------------------------------------------
    # 1. Cross-Family Invocations Without Explicit Family Arguments
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("target, from_rel, desc", [
        ("S4HC_2408", "S4H_2023", "Target S4HC_2408 vs validFrom S4H_2023"),
        ("2408", "2023", "Target numeric 2408 vs validFrom numeric 2023"),
        ("S4HANA_CLOUD_2402", "S4_2022", "Target S4HANA_CLOUD_2402 vs validFrom S4_2022"),
        ("ECC", "2408", "Target ECC vs validFrom numeric 2408"),
        ("2408", "ECC", "Target numeric 2408 vs validFrom ECC"),
        ("S4_2022", "S4HANA_CLOUD_2402", "Target S4_2022 vs validFrom S4HANA_CLOUD_2402"),
        ("S4H_2023", "S4HC_2408", "Target S4H_2023 vs validFrom S4HC_2408"),
        ("2023", "2408", "Target numeric 2023 vs validFrom numeric 2408"),
        ("ECC", "2023", "Target ECC vs validFrom numeric 2023"),
        ("2023", "ECC", "Target numeric 2023 vs validFrom ECC"),
        ("2408", "1909", "Target Cloud 2408 vs validFrom On-Prem 1909"),
        ("1909", "2408", "Target On-Prem 1909 vs validFrom Cloud 2408"),
        ("  s4hc_2408  ", "  s4h_2023  ", "Whitespace and lowercase trimming"),
    ])
    def test_cross_family_without_explicit_args(self, target, from_rel, desc):
        """Cross-family combinations must strictly return RELEASE_MISMATCH, is_aligned=False, penalty=0.50."""
        res = ReleaseAlignmentValidator.validate(target_release=target, valid_from=from_rel)
        assert res.status == "RELEASE_MISMATCH", f"Failed {desc}: got {res.status}"
        assert res.is_aligned is False, f"Failed {desc}: got is_aligned={res.is_aligned}"
        assert res.penalty == 0.50, f"Failed {desc}: got penalty={res.penalty}"
        assert "does not match target family" in res.message

    def test_cross_family_via_valid_to(self):
        """ValidTo alone must trigger cross-family mismatch when families differ."""
        res = ReleaseAlignmentValidator.validate(target_release="S4HC_2408", valid_to="S4H_2023")
        assert res.status == "RELEASE_MISMATCH"
        assert res.is_aligned is False
        assert res.penalty == 0.50

    # -------------------------------------------------------------------------
    # 2. Intra-Family Aligned Releases (Adjacent & Version-Aligned)
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("target, from_rel, desc", [
        ("S4HC_2408", "S4HC_2402", "Cloud semi-annual adjacent: 2408 >= 2402"),
        ("2021", "2020", "On-prem annual adjacent: 2021 >= 2020"),
        ("2408", "2402", "Numeric cloud adjacent: 2408 >= 2402"),
        ("S4H_2021", "S4H_2020", "On-prem prefixed adjacent: S4H_2021 >= S4H_2020"),
        ("S4HANA_2021", "S4_2020", "On-prem mixed prefix adjacent: 2021 >= 2020"),
        ("S4HC_2408", "2402", "Cloud prefixed vs numeric: S4HC_2408 >= 2402"),
        ("2408", "S4HC_2402", "Cloud numeric vs prefixed: 2408 >= S4HC_2402"),
        ("S4HANA_CLOUD_2408", "S4HC_2402", "Cloud long vs short prefix: 2408 >= 2402"),
        ("1909", "1809", "On-prem classic annual adjacent: 1909 >= 1809"),
        ("2023", "2022", "On-prem annual adjacent: 2023 >= 2022"),
    ])
    def test_intra_family_aligned_releases(self, target, from_rel, desc):
        """Intra-family adjacent releases must return RELEASE_ALIGNED, is_aligned=True, penalty=1.00."""
        res = ReleaseAlignmentValidator.validate(target_release=target, valid_from=from_rel)
        assert res.status == "RELEASE_ALIGNED", f"Failed {desc}: got {res.status}"
        assert res.is_aligned is True, f"Failed {desc}: got is_aligned={res.is_aligned}"
        assert res.penalty == 1.00, f"Failed {desc}: got penalty={res.penalty}"
        assert res.message == "Evidence is release-aligned."

    # -------------------------------------------------------------------------
    # 3. Exhaustive 11x11 Release Combinatorial Matrix (121 Pairs)
    # -------------------------------------------------------------------------
    def test_exhaustive_121_pairs_matrix(self):
        """Verify all 121 combinations across S/4HANA Cloud, On-Premise, and ECC families."""
        releases = [
            "S4HC_2408", "2408", "S4HANA_CLOUD_2402", "2402",
            "S4H_2023", "2023", "S4_2022", "2021", "2020",
            "ECC", "ECC 6.0"
        ]

        family_map = {
            "S4HC_2408": "S4HANA_CLOUD",
            "2408": "S4HANA_CLOUD",
            "S4HANA_CLOUD_2402": "S4HANA_CLOUD",
            "2402": "S4HANA_CLOUD",
            "S4H_2023": "ON_PREMISE",
            "2023": "ON_PREMISE",
            "S4_2022": "ON_PREMISE",
            "2021": "ON_PREMISE",
            "2020": "ON_PREMISE",
            "ECC": "ECC",
            "ECC 6.0": "ECC",
        }

        mismatch_count = 0
        aligned_count = 0
        premature_count = 0
        future_count = 0

        for target in releases:
            for from_rel in releases:
                target_fam = family_map[target]
                from_fam = family_map[from_rel]
                res = ReleaseAlignmentValidator.validate(target_release=target, valid_from=from_rel)

                if target_fam != from_fam:
                    mismatch_count += 1
                    assert res.status == "RELEASE_MISMATCH"
                    assert res.is_aligned is False
                    assert res.penalty == 0.50
                else:
                    if res.status == "RELEASE_ALIGNED":
                        aligned_count += 1
                        assert res.is_aligned is True
                        assert res.penalty == 1.00
                    elif res.status == "RELEASE_PREMATURE":
                        premature_count += 1
                        assert res.is_aligned is False
                        assert res.penalty == 0.40
                    elif res.status == "RELEASE_FUTURE":
                        future_count += 1
                        assert res.is_aligned is True
                        assert res.penalty == 0.80

        assert mismatch_count == 76
        assert aligned_count == 27
        assert premature_count == 13
        assert future_count == 5
        assert mismatch_count + aligned_count + premature_count + future_count == 121

    # -------------------------------------------------------------------------
    # 4. Zero Trust Leaks Verification
    # -------------------------------------------------------------------------
    def test_zero_trust_leaks(self):
        """Ensure cross-family mismatch prevents any un-discounted trust leakage."""
        res = ReleaseAlignmentValidator.validate("S4HC_2408", "S4H_2023")
        assert res.penalty == 0.50
        assert res.is_aligned is False

        # Official SAP metadata baseline trust = 1.00
        penalized_trust = 1.00 * res.penalty
        assert penalized_trust == 0.50

        # Corroborating multiple cross-family evidence items cannot exceed 0.70
        corroborating = [penalized_trust, penalized_trust, penalized_trust]
        composite = EvidenceEngine.calculate_composite_trust(corroborating)
        assert composite < 0.70
        assert composite == 0.595

        # Strict LLM ceiling at 0.60
        llm_composite = EvidenceEngine.calculate_composite_trust(corroborating, is_llm_generated=True)
        assert llm_composite <= 0.60
