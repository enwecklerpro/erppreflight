import sys
sys.path.insert(0, "services/analysis-python")
from src.models.enums import ConfidenceClass, Severity, TrustLevel
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.platform.confidence import ConfidenceClassifier

failures = []

# Test Invariant 1: Missing evidence demotion to UNKNOWN (0.30)
f1 = Finding(
    rule_id="TEST_VERIFIED_NO_EVIDENCE",
    severity=Severity.CRITICAL,
    category="Test",
    title="Verified finding with no evidence",
    description="Should demote to UNKNOWN 0.30",
    remediation="Remediation guidance",
    confidence=ConfidenceClass.VERIFIED,
    confidence_score=1.0,
    evidence=[],
)
classified_1 = ConfidenceClassifier.classify(f1)
if classified_1.confidence != ConfidenceClass.UNKNOWN or classified_1.confidence_score != 0.30:
    failures.append(f"Invariant 1 failed: expected UNKNOWN 0.30, got {classified_1.confidence} {classified_1.confidence_score}")

# Test Invariant 2: Explicit missing_evidence=True demotion
ev = Evidence(
    artifact_path="test.csv",
    line_number=1,
    column_number=1,
    snippet="test",
    sha256="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    provenance=ConfidenceClass.VERIFIED,
)
f2 = Finding(
    rule_id="TEST_EXPLICIT_MISSING_EVIDENCE",
    severity=Severity.CRITICAL,
    category="Test",
    title="Explicit missing evidence flag",
    description="Should demote to UNKNOWN 0.30",
    remediation="Remediation guidance",
    confidence=ConfidenceClass.VERIFIED,
    confidence_score=1.0,
    evidence=[ev],
)
classified_2 = ConfidenceClassifier.classify(f2, missing_evidence=True)
if classified_2.confidence != ConfidenceClass.UNKNOWN or classified_2.confidence_score != 0.30:
    failures.append(f"Invariant 2 failed: expected UNKNOWN 0.30, got {classified_2.confidence} {classified_2.confidence_score}")

# Test Invariant 3: AI-generated finding cannot exceed INFERRED (0.60)
f3 = Finding(
    rule_id="TEST_AI_VERIFIED",
    severity=Severity.CRITICAL,
    category="Test",
    title="AI generated finding claiming VERIFIED",
    description="Should cap at INFERRED 0.60",
    remediation="Remediation guidance",
    confidence=ConfidenceClass.VERIFIED,
    confidence_score=1.0,
    evidence=[ev],
)
classified_3 = ConfidenceClassifier.classify(f3, is_ai_generated=True)
if classified_3.confidence != ConfidenceClass.INFERRED or classified_3.confidence_score > 0.60:
    failures.append(f"Invariant 3 failed: expected INFERRED <=0.60, got {classified_3.confidence} {classified_3.confidence_score}")

# Test Invariant 4: AI evidence provenance caps at INFERRED (0.60)
ev_inferred = Evidence(
    artifact_path="test.csv",
    line_number=1,
    column_number=1,
    snippet="test",
    sha256="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    provenance=ConfidenceClass.INFERRED,
    source_type=TrustLevel.INFERRED,
)
f4 = Finding(
    rule_id="TEST_EVIDENCE_INFERRED",
    severity=Severity.MAJOR,
    category="Test",
    title="Finding with inferred evidence",
    description="Should cap at INFERRED 0.60",
    remediation="Remediation guidance",
    confidence=ConfidenceClass.RULE_DERIVED,
    confidence_score=0.85,
    evidence=[ev_inferred],
)
classified_4 = ConfidenceClassifier.classify(f4)
if classified_4.confidence != ConfidenceClass.INFERRED or classified_4.confidence_score > 0.60:
    failures.append(f"Invariant 4 failed: expected INFERRED <=0.60, got {classified_4.confidence} {classified_4.confidence_score}")

print("Epistemic confidence invariants check complete.")
print(f"Failures: {failures}")
