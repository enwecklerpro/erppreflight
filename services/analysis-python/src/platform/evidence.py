import hashlib
import re
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass
from src.models.evidence import Evidence
from src.models.enums import ConfidenceClass, TrustLevel

# Backward-compatible status aliases
FAMILY_MISMATCH = "RELEASE_MISMATCH"
RELEASE_MISMATCH = "RELEASE_MISMATCH"


@dataclass
class ReleaseAlignmentResult:
    status: str
    is_aligned: bool
    penalty: float
    message: str


class ReleaseAlignmentValidator:
    """Validates release compatibility of evidence against target preflight release."""

    CLOUD_YYMM_REGEX = re.compile(r"^(2[0-9])(0[1-9]|1[0-2])$")
    CLOUD_FAMILIES = {"CLOUD", "S4HANA_CLOUD"}

    @classmethod
    def _is_same_family(cls, fam_a: Optional[str], fam_b: Optional[str]) -> bool:
        if not fam_a or not fam_b:
            return False
        if fam_a == fam_b:
            return True
        return fam_a in cls.CLOUD_FAMILIES and fam_b in cls.CLOUD_FAMILIES

    is_same_family = _is_same_family

    @classmethod
    def _is_future_release(cls, target_fam: str, target_ver: int, from_fam: str, from_ver: int) -> bool:
        if not cls._is_same_family(target_fam, from_fam):
            return False
        if target_ver < from_ver:
            return False

        # Cloud family comparison (YYMM semi-annual cadence)
        if target_fam in cls.CLOUD_FAMILIES and from_fam in cls.CLOUD_FAMILIES:
            t_yy = target_ver // 100
            t_mm = target_ver % 100
            f_yy = from_ver // 100
            f_mm = from_ver % 100

            month_delta = (t_yy - f_yy) * 12 + (t_mm - f_mm)
            # In SAP S/4HANA Cloud (semi-annual ~6 months cycle: 02 and 08):
            # >= 2 releases ahead means delta >= 10 months (e.g. 2402 -> 2502 is 12 months)
            return month_delta >= 10

        # On-Premise family comparison (Year delta >= 2)
        if target_fam == "ON_PREMISE" and from_fam == "ON_PREMISE":
            t_yr = target_ver if 2000 <= target_ver <= 2100 else (2000 + target_ver // 100 if 1500 <= target_ver < 2000 else target_ver)
            f_yr = from_ver if 2000 <= from_ver <= 2100 else (2000 + from_ver // 100 if 1500 <= from_ver < 2000 else from_ver)
            return (t_yr - f_yr) >= 2

        # Generic fallback
        return (target_ver - from_ver) >= 2

    is_future_release = _is_future_release

    @classmethod
    def _parse_release(cls, rel: str) -> Tuple[str, int]:
        if not rel or not isinstance(rel, str):
            return ("UNKNOWN", 0)

        clean = rel.strip().upper()
        if not clean:
            return ("UNKNOWN", 0)

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
        if clean.startswith("ECC"):
            return ("ECC", 600)

        digits = re.sub(r"[^0-9]", "", clean)

        # Match exact S/4HANA Cloud YYMM releases: 2308, 2402, 2408, 2502
        if cls.CLOUD_YYMM_REGEX.match(clean) or (digits and cls.CLOUD_YYMM_REGEX.match(digits)):
            return ("S4HANA_CLOUD", int(digits) if digits else 0)

        num = int(digits) if digits else 0
        if (1500 <= num <= 2100) or num == 2025:
            return ("ON_PREMISE", num)
        if 2200 <= num <= 2999:
            return ("S4HANA_CLOUD", num)
        return ("UNKNOWN", num)

    parse_release = _parse_release

    @classmethod
    def validate(
        cls,
        target_release: str,
        valid_from: Optional[str] = None,
        valid_to: Optional[str] = None,
        target_family: Optional[str] = None,
        evidence_family: Optional[str] = None,
    ) -> ReleaseAlignmentResult:
        # 1. Validate target release input
        if not target_release or not isinstance(target_release, str) or not target_release.strip():
            return ReleaseAlignmentResult(
                status="UNKNOWN",
                is_aligned=False,
                penalty=0.30,
                message="Target release is missing or empty.",
            )

        target_fam, target_ver = cls._parse_release(target_release)
        if target_fam == "UNKNOWN" or target_ver == 0:
            return ReleaseAlignmentResult(
                status="UNKNOWN",
                is_aligned=False,
                penalty=0.30,
                message=f"Target release '{target_release}' cannot be identified or parsed.",
            )

        # 2. Parse and validate valid_from if supplied
        from_fam: Optional[str] = None
        from_ver: Optional[int] = None
        if valid_from is not None:
            if not isinstance(valid_from, str) or not valid_from.strip():
                return ReleaseAlignmentResult(
                    status="UNKNOWN",
                    is_aligned=False,
                    penalty=0.30,
                    message="Evidence validFrom release is empty or invalid.",
                )
            from_fam, from_ver = cls._parse_release(valid_from)
            if from_fam == "UNKNOWN" or from_ver == 0:
                return ReleaseAlignmentResult(
                    status="UNKNOWN",
                    is_aligned=False,
                    penalty=0.30,
                    message=f"Evidence validFrom release '{valid_from}' cannot be identified or parsed.",
                )

        # 3. Parse and validate valid_to if supplied
        to_fam: Optional[str] = None
        to_ver: Optional[int] = None
        if valid_to is not None:
            if not isinstance(valid_to, str) or not valid_to.strip():
                return ReleaseAlignmentResult(
                    status="UNKNOWN",
                    is_aligned=False,
                    penalty=0.30,
                    message="Evidence validTo release is empty or invalid.",
                )
            to_fam, to_ver = cls._parse_release(valid_to)
            if to_fam == "UNKNOWN" or to_ver == 0:
                return ReleaseAlignmentResult(
                    status="UNKNOWN",
                    is_aligned=False,
                    penalty=0.30,
                    message=f"Evidence validTo release '{valid_to}' cannot be identified or parsed.",
                )

        # 4. Infer effective target and evidence families
        eff_target_fam = target_family if target_family is not None else target_fam
        eff_evidence_fam = (
            evidence_family
            or (from_fam if from_fam and from_fam != "UNKNOWN" else None)
            or (to_fam if to_fam and to_fam != "UNKNOWN" else None)
        )

        # 5. Cross-family check: If both families are known and mismatch
        if eff_evidence_fam and eff_target_fam and not cls._is_same_family(eff_evidence_fam, eff_target_fam):
            return ReleaseAlignmentResult(
                status="RELEASE_MISMATCH",
                is_aligned=False,
                penalty=0.50,
                message=f"Evidence release family ({eff_evidence_fam}) does not match target family ({eff_target_fam}).",
            )

        # 6. Premature release check: target < valid_from
        if valid_from and from_fam and from_ver is not None:
            if cls._is_same_family(eff_target_fam, eff_evidence_fam) and target_ver < from_ver:
                return ReleaseAlignmentResult(
                    status="RELEASE_PREMATURE",
                    is_aligned=False,
                    penalty=0.40,
                    message=f"Feature requires release >= {valid_from}, but target is {target_release}.",
                )

        # 7. Deprecated release check: target > valid_to
        if valid_to and to_fam and to_ver is not None:
            if cls._is_same_family(eff_target_fam, eff_evidence_fam) and target_ver > to_ver:
                return ReleaseAlignmentResult(
                    status="RELEASE_DEPRECATED",
                    is_aligned=False,
                    penalty=0.0,
                    message=f"Feature was deprecated or removed after release {valid_to}. Target is {target_release}.",
                )

        # 8. Future release check: target >= valid_from + 2 releases ahead
        # Applicable when valid_to is absent (open-ended validity) and target is 2+ releases ahead
        if valid_from and from_fam and from_ver is not None and not valid_to:
            if cls._is_same_family(eff_target_fam, eff_evidence_fam) and cls._is_future_release(target_fam, target_ver, from_fam, from_ver):
                return ReleaseAlignmentResult(
                    status="RELEASE_FUTURE",
                    is_aligned=True,
                    penalty=0.80,
                    message=f"Feature is valid from {valid_from}, but target {target_release} is 2 or more releases ahead.",
                )

        # 9. Fully release-aligned
        return ReleaseAlignmentResult(
            status="RELEASE_ALIGNED",
            is_aligned=True,
            penalty=1.00,
            message="Evidence is release-aligned.",
        )


class EvidenceEngine:
    """Computes cryptographic hashes and builds provenance evidence."""

    @staticmethod
    def compute_sha256(content: str | bytes) -> str:
        if isinstance(content, str):
            content = content.encode("utf-8")
        return hashlib.sha256(content).hexdigest()

    @classmethod
    def create_evidence(
        cls,
        artifact_path: str,
        content: str | bytes,
        line_number: Optional[int] = None,
        column_number: Optional[int] = None,
        snippet: Optional[str] = None,
        provenance: ConfidenceClass = ConfidenceClass.VERIFIED,
        source_type: TrustLevel = TrustLevel.CUSTOMER_EVIDENCE,
        source_url: Optional[str] = None,
    ) -> Evidence:
        sha256_hash = cls.compute_sha256(content)
        return Evidence(
            artifact_path=artifact_path,
            line_number=line_number,
            column_number=column_number,
            snippet=snippet,
            sha256=sha256_hash,
            provenance=provenance,
            source_type=source_type,
            source_url=source_url,
            trust_score=1.0 if provenance == ConfidenceClass.VERIFIED else 0.85,
        )

    @classmethod
    def verify_snippet(
        cls,
        artifact_content: str | bytes,
        snippet: str,
        expected_sha256: Optional[str] = None,
    ) -> Dict[str, Any]:
        text = artifact_content.decode("utf-8") if isinstance(artifact_content, bytes) else artifact_content
        norm_snippet = snippet.strip()
        matched = norm_snippet in text
        calculated_hash = cls.compute_sha256(norm_snippet)
        hash_matches = calculated_hash.lower() == expected_sha256.lower() if expected_sha256 else True

        return {
            "is_valid": matched and hash_matches,
            "matched": matched,
            "hash_matches": hash_matches,
            "calculated_hash": calculated_hash,
        }

    @classmethod
    def extract_line_context(
        cls,
        text: str,
        line_number: int,
        context_radius: int = 3,
    ) -> Dict[str, str]:
        lines = text.splitlines()
        target_idx = max(0, line_number - 1)
        snippet = lines[target_idx] if target_idx < len(lines) else ""
        start = max(0, target_idx - context_radius)
        end = min(len(lines), target_idx + context_radius + 1)
        context = "\n".join(lines[start:end])
        return {
            "snippet": snippet,
            "context_snippet": context,
        }

    @classmethod
    def validate_release_alignment(
        cls,
        target_release: str,
        valid_from: Optional[str] = None,
        valid_to: Optional[str] = None,
        target_family: Optional[str] = None,
        evidence_family: Optional[str] = None,
    ) -> ReleaseAlignmentResult:
        return ReleaseAlignmentValidator.validate(
            target_release=target_release,
            valid_from=valid_from,
            valid_to=valid_to,
            target_family=target_family,
            evidence_family=evidence_family,
        )

    @classmethod
    def calculate_composite_trust(
        cls,
        scores: List[float],
        is_llm_generated: bool = False,
        max_ceiling: Optional[float] = None
    ) -> float:
        """
        Calculates composite trust using the Noisy-OR corroboration formula:
        Trust = max(scores) + (1.0 - max(scores)) * (1.0 - prod_{corrob}(1.0 - 0.2 * s_k))
        Guarantees that additional corroborating evidence strictly increases or maintains trust.
        """
        if not scores:
            return 0.0

        clamped_scores = [max(0.0, min(1.0, float(s))) for s in scores]
        max_score = max(clamped_scores)
        if len(clamped_scores) == 1:
            return cls._clamp_trust(max_score, is_llm_generated, max_ceiling)

        max_idx = clamped_scores.index(max_score)
        corroborating = [s for idx, s in enumerate(clamped_scores) if idx != max_idx]

        prod = 1.0
        for s in corroborating:
            prod *= (1.0 - 0.20 * s)

        uncertainty_closed = 1.0 - prod
        composite = max_score + (1.0 - max_score) * uncertainty_closed
        return cls._clamp_trust(composite, is_llm_generated, max_ceiling)

    @classmethod
    def _clamp_trust(
        cls,
        value: float,
        is_llm_generated: bool = False,
        max_ceiling: Optional[float] = None
    ) -> float:
        ceiling = 1.0
        if is_llm_generated:
            ceiling = 0.60  # Epistemic ceiling for INFERRED
        if max_ceiling is not None and max_ceiling < ceiling:
            ceiling = max_ceiling
        return min(ceiling, max(0.0, round(value + 1e-9, 3)))
