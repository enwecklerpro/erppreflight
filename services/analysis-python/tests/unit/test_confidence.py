from src.models.enums import Severity, ConfidenceClass, TrustLevel
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.platform.confidence import ConfidenceClassifier, CONFIDENCE_SCORE_MAP


def _create_evidence(
    artifact_path="doc.txt",
    provenance=ConfidenceClass.VERIFIED,
    source_type=TrustLevel.CUSTOMER_EVIDENCE,
) -> Evidence:
    return Evidence(
        artifact_path=artifact_path,
        line_number=1,
        sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        provenance=provenance,
        source_type=source_type,
    )


def test_llm_output_is_demoted_to_inferred():
    """AI-generated finding with valid evidence must be capped at INFERRED (0.60)."""
    ev = _create_evidence()
    finding = Finding(
        rule_id="AI_RULE_01",
        severity=Severity.MAJOR,
        category="CODE",
        title="AI suggested finding",
        description="Suggested by LLM",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Check manually",
        evidence=[ev],
    )
    classified = ConfidenceClassifier.classify(finding, is_ai_generated=True)
    assert classified.confidence == ConfidenceClass.INFERRED
    assert classified.confidence_score == 0.60


def test_missing_evidence_demoted_to_unknown():
    """Finding with explicit missing_evidence=True demotes to UNKNOWN (0.30)."""
    finding = Finding(
        rule_id="RULE_NO_EVIDENCE",
        severity=Severity.MINOR,
        category="GENERAL",
        title="No evidence finding",
        description="Lacks supporting artifact proof",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Verify manually",
        evidence=[],
    )
    classified = ConfidenceClassifier.classify(finding, missing_evidence=True)
    assert classified.confidence == ConfidenceClass.UNKNOWN
    assert classified.confidence_score == 0.30


def test_rule_derived_without_evidence_demotes_to_unknown():
    """RULE_DERIVED finding with empty evidence list MUST demote to UNKNOWN (0.30)."""
    finding = Finding(
        rule_id="RULE_EMPTY_EV",
        severity=Severity.MAJOR,
        category="CONFIG",
        title="Rule finding without evidence",
        description="Deterministic rule triggered but lacks evidence artifact",
        confidence=ConfidenceClass.RULE_DERIVED,
        confidence_score=0.85,
        remediation="Supply artifact proof",
        evidence=[],
    )
    # Called with default missing_evidence=False
    classified = ConfidenceClassifier.classify(finding, missing_evidence=False)
    assert classified.confidence == ConfidenceClass.UNKNOWN
    assert classified.confidence_score == 0.30


def test_ai_finding_without_evidence_demotes_to_unknown_not_inferred():
    """Missing evidence takes precedence over AI flag: must demote to UNKNOWN (0.30), NOT INFERRED (0.60)."""
    finding = Finding(
        rule_id="AI_EMPTY_EV",
        severity=Severity.CRITICAL,
        category="LLM",
        title="AI hallucination without evidence",
        description="AI produced finding without backing evidence",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Reject unbacked finding",
        evidence=[],
    )
    classified = ConfidenceClassifier.classify(finding, is_ai_generated=True, missing_evidence=False)
    assert classified.confidence == ConfidenceClass.UNKNOWN
    assert classified.confidence_score == 0.30


def test_ai_rule_derived_without_evidence_demotes_to_unknown():
    """AI finding claiming RULE_DERIVED with empty evidence must demote to UNKNOWN (0.30)."""
    finding = Finding(
        rule_id="AI_RULE_EMPTY_EV",
        severity=Severity.MAJOR,
        category="CONFIG",
        title="AI rule without evidence",
        description="AI claiming rule derivation with zero evidence",
        confidence=ConfidenceClass.RULE_DERIVED,
        confidence_score=0.85,
        remediation="Reject unbacked finding",
        evidence=[],
    )
    classified = ConfidenceClassifier.classify(finding, is_ai_generated=True)
    assert classified.confidence == ConfidenceClass.UNKNOWN
    assert classified.confidence_score == 0.30


def test_evidence_provenance_inferred_triggers_ai_demotion():
    """Finding backed by INFERRED evidence automatically demotes to INFERRED (0.60)."""
    ev_inferred = _create_evidence(
        provenance=ConfidenceClass.INFERRED,
        source_type=TrustLevel.INFERRED,
    )
    finding = Finding(
        rule_id="RULE_INFERRED_EV",
        severity=Severity.CRITICAL,
        category="INTEGRATION",
        title="Finding with inferred evidence",
        description="Evidence has inferred provenance",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Verify inferred evidence",
        evidence=[ev_inferred],
    )
    # Called without explicit is_ai_generated parameter
    classified = ConfidenceClassifier.classify(finding)
    assert classified.confidence == ConfidenceClass.INFERRED
    assert classified.confidence_score == 0.60


def test_finding_is_ai_generated_field_triggers_demotion():
    """Finding with is_ai_generated=True model attribute demotes to INFERRED (0.60)."""
    ev = _create_evidence()
    finding = Finding(
        rule_id="AI_FIELD_RULE",
        severity=Severity.MAJOR,
        category="SECURITY",
        title="Finding with is_ai_generated=True",
        description="Marked as AI via model field",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Review manually",
        evidence=[ev],
        is_ai_generated=True,
    )
    classified = ConfidenceClassifier.classify(finding)
    assert classified.confidence == ConfidenceClass.INFERRED
    assert classified.confidence_score == 0.60


def test_technical_details_ai_flag_triggers_demotion():
    """Finding with is_ai_generated in technical_details demotes to INFERRED (0.60)."""
    ev = _create_evidence()
    finding = Finding(
        rule_id="AI_TECH_DETAILS_RULE",
        severity=Severity.MAJOR,
        category="SECURITY",
        title="Finding with technical_details AI flag",
        description="Marked as AI via metadata dict",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Review manually",
        evidence=[ev],
        technical_details={"is_ai_generated": True},
    )
    classified = ConfidenceClassifier.classify(finding)
    assert classified.confidence == ConfidenceClass.INFERRED
    assert classified.confidence_score == 0.60


def test_deterministic_findings_with_evidence_retain_confidence():
    """Deterministic findings backed by valid customer evidence retain VERIFIED and RULE_DERIVED."""
    ev = _create_evidence()

    # VERIFIED retains 1.0
    f_verified = Finding(
        rule_id="DET_VERIFIED",
        severity=Severity.INFO,
        category="SYNTAX",
        title="Exact AST match",
        description="Verified syntax finding",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="No action",
        evidence=[ev],
    )
    c_verified = ConfidenceClassifier.classify(f_verified)
    assert c_verified.confidence == ConfidenceClass.VERIFIED
    assert c_verified.confidence_score == 1.0

    # RULE_DERIVED retains 0.85
    f_rule = Finding(
        rule_id="DET_RULE",
        severity=Severity.MINOR,
        category="CONFIG",
        title="Deterministic rule match",
        description="Rule derived finding",
        confidence=ConfidenceClass.RULE_DERIVED,
        confidence_score=0.85,
        remediation="Adjust config",
        evidence=[ev],
    )
    c_rule = ConfidenceClassifier.classify(f_rule)
    assert c_rule.confidence == ConfidenceClass.RULE_DERIVED
    assert c_rule.confidence_score == 0.85


def test_score_tampering_clamped():
    """Tampered confidence scores are bounded by canonical map."""
    ev = _create_evidence()

    # Elevated UNKNOWN score clamped to 0.30
    f_unknown = Finding(
        rule_id="TAMPER_UNKNOWN",
        severity=Severity.INFO,
        category="GENERAL",
        title="Tampered UNKNOWN",
        description="Claims UNKNOWN with 0.99 score",
        confidence=ConfidenceClass.UNKNOWN,
        confidence_score=0.99,
        remediation="None",
        evidence=[ev],
    )
    c_unknown = ConfidenceClassifier.classify(f_unknown, is_ai_generated=True)
    assert c_unknown.confidence == ConfidenceClass.UNKNOWN
    assert c_unknown.confidence_score == 0.30

    # Elevated INFERRED score clamped to 0.60
    f_inferred = Finding(
        rule_id="TAMPER_INFERRED",
        severity=Severity.INFO,
        category="GENERAL",
        title="Tampered INFERRED",
        description="Claims INFERRED with 0.95 score",
        confidence=ConfidenceClass.INFERRED,
        confidence_score=0.95,
        remediation="None",
        evidence=[ev],
    )
    c_inferred = ConfidenceClassifier.classify(f_inferred, is_ai_generated=True)
    assert c_inferred.confidence == ConfidenceClass.INFERRED
    assert c_inferred.confidence_score == 0.60


def test_classify_finding_backward_compatibility_alias():
    """classify_finding is an exact alias of classify."""
    ev = _create_evidence()
    f = Finding(
        rule_id="ALIAS_TEST",
        severity=Severity.INFO,
        category="GENERAL",
        title="Alias test",
        description="Testing alias equivalence",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="None",
        evidence=[ev],
    )
    res_direct = ConfidenceClassifier.classify(f.model_copy(), is_ai_generated=True)
    res_alias = ConfidenceClassifier.classify_finding(f.model_copy(), is_ai_generated=True)
    assert res_direct.confidence == res_alias.confidence
    assert res_direct.confidence_score == res_alias.confidence_score
