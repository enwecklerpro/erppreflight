"""
Empirical Challenger Test Suite — Milestone 2 Iteration 3
Exhaustive adversarial stress-testing of Release Alignment prefix parsing and validation.

Verifies:
1. All canonical SAP S/4HANA prefixes (S4HC_, S4HANA_CLOUD_, S4H_, S4_, S4HANA_).
2. Integer versions match the exact numeric target and NEVER prepend '4' (e.g. not 42408, not 42023).
3. 100% accurate Cloud vs On-Premise classification across all prefixes.
4. Robustness under lowercase, mixed case, leading/trailing whitespace, and tabs.
5. Edge cases: empty strings, missing version digits, non-numeric suffixes.
6. Cross-release compatibility validation across various prefixed and raw combinations.
"""

import pytest
from src.platform.evidence import ReleaseAlignmentValidator


class TestM2It3EmpiricalPrefixStress:
    """Adversarial stress-testing suite for S/4HANA release prefix parsing."""

    # -------------------------------------------------------------------------
    # 1. Cloud Prefixes Matrix
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("release_str, expected_ver", [
        ("S4HC_2408", 2408),
        ("S4HC_2402", 2402),
        ("S4HC_2308", 2308),
        ("S4HC_2302", 2302),
        ("S4HC_2502", 2502),
        ("S4HC_2508", 2508),
        ("S4HANA_CLOUD_2408", 2408),
        ("S4HANA_CLOUD_2402", 2402),
        ("S4HANA_CLOUD_2308", 2308),
        ("S4HANA_CLOUD_2302", 2302),
        ("S4HANA_CLOUD_2502", 2502),
        ("S4HANA_CLOUD_2508", 2508),
    ])
    def test_canonical_cloud_prefixes(self, release_str, expected_ver):
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "S4HANA_CLOUD", f"Expected S4HANA_CLOUD for {release_str}, got {fam}"
        assert ver == expected_ver, f"Expected version {expected_ver} for {release_str}, got {ver}"
        assert ver < 40000, f"Corruption detected: version {ver} prepended '4' for {release_str}"
        assert ver != (40000 + expected_ver)

    # -------------------------------------------------------------------------
    # 2. On-Premise Prefixes Matrix
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("release_str, expected_ver", [
        ("S4H_2023", 2023),
        ("S4H_2022", 2022),
        ("S4H_2021", 2021),
        ("S4H_2020", 2020),
        ("S4H_2025", 2025),
        ("S4H_1909", 1909),
        ("S4H_1809", 1809),
        ("S4H_1709", 1709),
        ("S4H_1610", 1610),
        ("S4H_1511", 1511),
        ("S4_2023", 2023),
        ("S4_2022", 2022),
        ("S4_2021", 2021),
        ("S4_2020", 2020),
        ("S4_2025", 2025),
        ("S4HANA_2023", 2023),
        ("S4HANA_2022", 2022),
        ("S4HANA_2021", 2021),
        ("S4HANA_2020", 2020),
        ("S4HANA_2025", 2025),
        ("S4HANA_1909", 1909),
        ("S4HANA_1809", 1809),
        ("S4HANA_1709", 1709),
    ])
    def test_canonical_on_premise_prefixes(self, release_str, expected_ver):
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "ON_PREMISE", f"Expected ON_PREMISE for {release_str}, got {fam}"
        assert ver == expected_ver, f"Expected version {expected_ver} for {release_str}, got {ver}"
        assert ver < 40000, f"Corruption detected: version {ver} prepended '4' for {release_str}"
        assert ver != (40000 + expected_ver)

    # -------------------------------------------------------------------------
    # 3. Raw Versions Disambiguation (No Prefix)
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("release_str, expected_fam, expected_ver", [
        ("2308", "S4HANA_CLOUD", 2308),
        ("2302", "S4HANA_CLOUD", 2302),
        ("2402", "S4HANA_CLOUD", 2402),
        ("2408", "S4HANA_CLOUD", 2408),
        ("2502", "S4HANA_CLOUD", 2502),
        ("2508", "S4HANA_CLOUD", 2508),
        ("2020", "ON_PREMISE", 2020),
        ("2021", "ON_PREMISE", 2021),
        ("2022", "ON_PREMISE", 2022),
        ("2023", "ON_PREMISE", 2023),
        ("2025", "ON_PREMISE", 2025),
        ("1909", "ON_PREMISE", 1909),
        ("1809", "ON_PREMISE", 1809),
        ("1709", "ON_PREMISE", 1709),
        ("1610", "ON_PREMISE", 1610),
        ("1511", "ON_PREMISE", 1511),
    ])
    def test_raw_versions_disambiguation(self, release_str, expected_fam, expected_ver):
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == expected_fam, f"Failed family for raw {release_str}: got {fam}"
        assert ver == expected_ver, f"Failed version for raw {release_str}: got {ver}"

    # -------------------------------------------------------------------------
    # 4. Whitespace, Lowercase, Mixed-Case Resilience
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("release_str, expected_fam, expected_ver", [
        ("s4hc_2408", "S4HANA_CLOUD", 2408),
        ("  s4hc_2408  ", "S4HANA_CLOUD", 2408),
        ("\tS4HC_2408\n", "S4HANA_CLOUD", 2408),
        ("s4hana_cloud_2402", "S4HANA_CLOUD", 2402),
        ("  S4HANA_CLOUD_2402  ", "S4HANA_CLOUD", 2402),
        ("s4h_2023", "ON_PREMISE", 2023),
        ("  s4h_2023  ", "ON_PREMISE", 2023),
        ("  S4_2022  ", "ON_PREMISE", 2022),
        ("s4hana_2020", "ON_PREMISE", 2020),
        ("  S4HANA_2020  ", "ON_PREMISE", 2020),
        ("  2308  ", "S4HANA_CLOUD", 2308),
        ("  2021  ", "ON_PREMISE", 2021),
        ("S4Hana_Cloud_2408", "S4HANA_CLOUD", 2408),
        ("S4h_2023", "ON_PREMISE", 2023),
    ])
    def test_case_and_whitespace_resilience(self, release_str, expected_fam, expected_ver):
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == expected_fam
        assert ver == expected_ver
        assert ver < 40000

    # -------------------------------------------------------------------------
    # 5. Prefix Collision & Priority Stress Testing
    # -------------------------------------------------------------------------
    def test_prefix_precedence_cloud_vs_on_premise(self):
        # S4HANA_CLOUD_ must win over S4HANA_ prefix
        fam_cloud, ver_cloud = ReleaseAlignmentValidator._parse_release("S4HANA_CLOUD_2408")
        assert fam_cloud == "S4HANA_CLOUD"
        assert ver_cloud == 2408

        # S4HANA_ must correctly classify as ON_PREMISE
        fam_onprem, ver_onprem = ReleaseAlignmentValidator._parse_release("S4HANA_2023")
        assert fam_onprem == "ON_PREMISE"
        assert ver_onprem == 2023

        # S4H_ must win over S4_ prefix
        fam_s4h, ver_s4h = ReleaseAlignmentValidator._parse_release("S4H_2023")
        assert fam_s4h == "ON_PREMISE"
        assert ver_s4h == 2023

        # S4_ matches S4_
        fam_s4, ver_s4 = ReleaseAlignmentValidator._parse_release("S4_2022")
        assert fam_s4 == "ON_PREMISE"
        assert ver_s4 == 2022

    # -------------------------------------------------------------------------
    # 6. Malformed & Boundary Inputs
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("release_str, expected_fam, expected_ver", [
        ("S4HC_", "S4HANA_CLOUD", 0),
        ("S4HANA_CLOUD_", "S4HANA_CLOUD", 0),
        ("S4H_", "ON_PREMISE", 0),
        ("S4_", "ON_PREMISE", 0),
        ("S4HANA_", "ON_PREMISE", 0),
        ("S4HC_abc", "S4HANA_CLOUD", 0),
        ("S4H_XYZ", "ON_PREMISE", 0),
        ("ECC", "ECC", 600),
        ("ECC_600", "ECC", 600),
        ("ecc_ehp8", "ECC", 600),
        ("", "UNKNOWN", 0),
        ("   ", "UNKNOWN", 0),
    ])
    def test_malformed_and_boundary_inputs(self, release_str, expected_fam, expected_ver):
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == expected_fam
        assert ver == expected_ver

    # -------------------------------------------------------------------------
    # 7. Cross-Release Validation with Prefixed Inputs
    # -------------------------------------------------------------------------
    @pytest.mark.parametrize("target, valid_from, valid_to, expected_status, expected_aligned, expected_penalty", [
        # Target >= valid_from (aligned)
        ("S4HC_2408", "S4HC_2402", None, "RELEASE_ALIGNED", True, 1.0),
        ("S4HC_2408", "S4HANA_CLOUD_2402", None, "RELEASE_ALIGNED", True, 1.0),
        ("2408", "S4HC_2402", None, "RELEASE_ALIGNED", True, 1.0),
        ("S4HC_2408", "2402", None, "RELEASE_ALIGNED", True, 1.0),
        # Target < valid_from (premature - penalty 0.40)
        ("S4HC_2402", "S4HC_2408", None, "RELEASE_PREMATURE", False, 0.40),
        ("2402", "S4HANA_CLOUD_2408", None, "RELEASE_PREMATURE", False, 0.40),
        # Target > valid_to (deprecated)
        ("S4HC_2408", None, "S4HC_2402", "RELEASE_DEPRECATED", False, 0.0),
        ("S4HANA_CLOUD_2408", None, "2402", "RELEASE_DEPRECATED", False, 0.0),
        # Target <= valid_to (aligned)
        ("S4HC_2408", None, "S4HC_2502", "RELEASE_ALIGNED", True, 1.0),
        # On-Premise matrix (adjacent aligned: 1 release ahead)
        ("S4H_2023", "S4H_2022", None, "RELEASE_ALIGNED", True, 1.0),
        ("2023", "2022", None, "RELEASE_ALIGNED", True, 1.0),
        # On-Premise matrix (future: >= 2 releases ahead)
        ("S4H_2023", "S4H_2020", None, "RELEASE_FUTURE", True, 0.80),
        ("S4HANA_2023", "S4_2020", None, "RELEASE_FUTURE", True, 0.80),
        ("S4H_2023", "2020", None, "RELEASE_FUTURE", True, 0.80),
        ("2023", "S4H_2020", None, "RELEASE_FUTURE", True, 0.80),
        # On-Premise premature & deprecated
        ("S4H_2020", "S4H_2023", None, "RELEASE_PREMATURE", False, 0.40),
        ("S4H_2023", None, "S4H_2021", "RELEASE_DEPRECATED", False, 0.0),
        ("S4_2022", None, "S4H_2025", "RELEASE_ALIGNED", True, 1.0),
    ])
    def test_cross_release_validation_matrix(
        self, target, valid_from, valid_to, expected_status, expected_aligned, expected_penalty
    ):
        res = ReleaseAlignmentValidator.validate(
            target_release=target,
            valid_from=valid_from,
            valid_to=valid_to,
        )
        assert res.status == expected_status, f"Validation status mismatch for target={target}, from={valid_from}, to={valid_to}: got {res.status}"
        assert res.is_aligned == expected_aligned
        assert res.penalty == expected_penalty
