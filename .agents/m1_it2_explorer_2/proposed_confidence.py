from src.models.enums import ConfidenceClass, TrustLevel
from src.models.finding import Finding

CONFIDENCE_SCORE_MAP = {
    ConfidenceClass.VERIFIED: 1.0,
    ConfidenceClass.RULE_DERIVED: 0.85,
    ConfidenceClass.INFERRED: 0.60,
    ConfidenceClass.UNKNOWN: 0.30,
}


class ConfidenceClassifier:
    """Enforces epistemic reliability rules and non-negotiable demotion invariants.

    Hard Invariants (PROJECT.md line 30):
    1. Missing Evidence Precedence: If evidence is missing (missing_evidence=True or len(evidence) == 0),
       demote ALL findings (VERIFIED, RULE_DERIVED, INFERRED, UNKNOWN) to UNKNOWN (0.30).
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
        has_no_evidence = missing_evidence or not finding.evidence or len(finding.evidence) == 0
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
