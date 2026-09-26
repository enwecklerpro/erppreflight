import re
from typing import Iterable, Optional
from src.models.enums import ConfidenceClass, TrustLevel
from src.models.evidence import Evidence
from src.models.finding import Finding

_SHA256_HEX = re.compile(r"^[0-9a-fA-F]{64}$")


def is_verifiable_evidence(evidence: Optional[Evidence]) -> bool:
    """Evidence is verifiable only with a concrete artifact path, a 1-indexed line and a valid SHA-256."""
    if evidence is None:
        return False
    if not evidence.artifact_path or not str(evidence.artifact_path).strip():
        return False
    if not isinstance(evidence.line_number, int) or evidence.line_number < 1:
        return False
    return bool(evidence.sha256) and bool(_SHA256_HEX.match(evidence.sha256))


def lacks_verifiable_evidence(evidence: Optional[Iterable[Evidence]]) -> bool:
    """True when the evidence list is empty, any item carries a malformed SHA-256,
    or no item carries a verifiable file pointer (path + line + SHA-256)."""
    items = list(evidence or [])
    if not items:
        return True
    if any(not e.sha256 or not _SHA256_HEX.match(e.sha256) for e in items):
        return True
    return not any(is_verifiable_evidence(e) for e in items)

CONFIDENCE_SCORE_MAP = {
    ConfidenceClass.VERIFIED: 1.0,
    ConfidenceClass.RULE_DERIVED: 0.85,
    ConfidenceClass.INFERRED: 0.60,
    ConfidenceClass.UNKNOWN: 0.30,
}


class ConfidenceClassifier:
    """Enforces epistemic reliability rules and non-negotiable demotion invariants.

    Hard Invariants (PROJECT.md line 30):
    1. Missing Evidence Precedence: If evidence is missing (missing_evidence=True, len(evidence) == 0,
       no evidence item with a line number, or any malformed SHA-256), demote ALL findings (VERIFIED, RULE_DERIVED, INFERRED, UNKNOWN) to UNKNOWN (0.30).
    2. LLM / AI Boundary: AI-generated findings with evidence can NEVER exceed INFERRED (0.60).
    3. Score Synchronization: Confidence scores are bounded and synchronized to canonical values.
    """

    @classmethod
    def classify(
        cls,
        finding: Finding,
        is_ai_generated: bool = False,
        missing_evidence: bool = False,
    ) -> Finding:
        # Determine effective AI generation from explicit parameter, finding attributes, or evidence provenance
        effective_ai = (
            is_ai_generated
            or getattr(finding, "is_ai_generated", False)
            or bool(finding.technical_details.get("is_ai_generated"))
            or bool(finding.technical_details.get("ai_generated"))
            or any(
                e.provenance == ConfidenceClass.INFERRED or e.source_type == TrustLevel.INFERRED
                for e in (finding.evidence or [])
            )
        )

        # Invariant 1: Missing mandatory evidence demotes unconditionally to UNKNOWN (0.30).
        # Missing evidence takes strict precedence over AI classification.
        has_no_evidence = missing_evidence or lacks_verifiable_evidence(finding.evidence)
        if has_no_evidence:
            finding.confidence = ConfidenceClass.UNKNOWN
            finding.confidence_score = CONFIDENCE_SCORE_MAP[ConfidenceClass.UNKNOWN]
            return finding

        # Invariant 2: Non-negotiable LLM / AI Boundary
        # If an LLM, probabilistic model, or inferred evidence was involved, finding can NEVER exceed INFERRED (0.60)
        if effective_ai:
            if finding.confidence in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED):
                finding.confidence = ConfidenceClass.INFERRED
            finding.confidence_score = min(finding.confidence_score, CONFIDENCE_SCORE_MAP[ConfidenceClass.INFERRED])

        # Invariant 3: Score synchronization to canonical epistemic map
        default_score = CONFIDENCE_SCORE_MAP.get(finding.confidence, CONFIDENCE_SCORE_MAP[ConfidenceClass.UNKNOWN])
        if not effective_ai:
            finding.confidence_score = default_score
        else:
            finding.confidence_score = min(finding.confidence_score, default_score)

        return finding

    # Alias for backward compatibility with existing callers
    classify_finding = classify
