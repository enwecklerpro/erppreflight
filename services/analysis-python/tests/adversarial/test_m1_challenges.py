"""
Empirical Adversarial Test Suite for M1 Foundation:
1. SafeXmlParser Challenge: Malicious payloads (XXE entity expansion, Billion Laughs, external DTDs, malformed XML).
2. ConfidenceClassifier Challenge: LLM spoofing, missing evidence invariants, score tampering.
3. Engine Registry and Pydantic Validation: Malformed JSON/XML, invalid enums, concurrency.
"""

import math
import uuid
import pytest
from concurrent.futures import ThreadPoolExecutor
from pydantic import ValidationError
from httpx import AsyncClient, ASGITransport

from src.main import app
from src.parsers.safe_xml import SafeXmlParser
from src.platform.confidence import ConfidenceClassifier, CONFIDENCE_SCORE_MAP
from src.core.registry import EngineRegistry
from src.core.runner import EngineRunner
from src.core.exceptions import SecurityViolationError, EngineNotFoundError
from src.models.enums import EngineType, ArtifactType, Severity, ConfidenceClass, AnalysisStatus, TrustLevel
from src.models.evidence import Evidence
from src.models.finding import Finding
from src.models.request import AnalysisRequest


# ============================================================================
# 1. SAFEXMLPARSER CHALLENGES
# ============================================================================

class TestSafeXmlParserChallenges:
    """Stress-test SafeXmlParser against adversarial XML attack payloads."""

    def test_xxe_external_system_entity_local_file(self):
        """Challenge: Local file disclosure attempt via SYSTEM entity."""
        payload = """<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE root [
            <!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">
        ]>
        <root><data>&xxe;</data></root>"""
        with pytest.raises(SecurityViolationError) as exc_info:
            SafeXmlParser.parse_string(payload)
        assert "Entities/DTD forbidden" in str(exc_info.value) or "forbidden" in str(exc_info.value).lower()

    def test_xxe_external_system_entity_ssrf(self):
        """Challenge: Out-of-band SSRF attempt via SYSTEM HTTP URL."""
        payload = """<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE test [
            <!ENTITY xxe SYSTEM "http://127.0.0.1:8888/ssrf-canary">
        ]>
        <test><payload>&xxe;</payload></test>"""
        with pytest.raises(SecurityViolationError) as exc_info:
            SafeXmlParser.parse_string(payload)
        assert "forbidden" in str(exc_info.value).lower()

    def test_xxe_external_public_entity(self):
        """Challenge: External PUBLIC entity declaration."""
        payload = """<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE test [
            <!ENTITY pub PUBLIC "-//OASIS//DTD DocBook XML V4.1.2//EN" "http://127.0.0.1:8888/dtd">
        ]>
        <test>&pub;</test>"""
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_xxe_external_parameter_entity(self):
        """Challenge: Parameter entity inclusion (OOB extraction technique)."""
        payload = """<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE data [
            <!ENTITY % pe SYSTEM "http://127.0.0.1:8888/evil.dtd">
            %pe;
        ]>
        <data>value</data>"""
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_billion_laughs_attack(self):
        """Challenge: Exponential entity expansion (Billion Laughs / XML Bomb)."""
        payload = """<?xml version="1.0"?>
        <!DOCTYPE lolz [
         <!ENTITY lol "lol">
         <!ELEMENT lolz (#PCDATA)>
         <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
         <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
         <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
         <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
         <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
         <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
         <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
         <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
         <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
        ]>
        <lolz>&lol9;</lolz>"""
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_quadratic_blowup_attack(self):
        """Challenge: Quadratic entity expansion (single large entity repeated)."""
        large_chunk = "A" * 10000
        payload = f"""<?xml version="1.0"?>
        <!DOCTYPE root [
          <!ENTITY kb "{large_chunk}">
          <!ENTITY quad "&kb;&kb;&kb;&kb;&kb;&kb;&kb;&kb;&kb;&kb;">
        ]>
        <root>&quad;</root>"""
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_benign_dtd_rejected(self):
        """Challenge: Any DOCTYPE must be rejected even without entities (forbid_dtd=True)."""
        payload = """<?xml version="1.0"?>
        <!DOCTYPE root [
          <!ELEMENT root (#PCDATA)>
        ]>
        <root>Valid data</root>"""
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_malformed_xml_syntax(self):
        """Challenge: Syntax violations must be cleanly rejected with ValueError, not crash."""
        payloads = [
            "<root><unclosed>",
            "<root><item>test</other></root>",
            "not xml at all",
            "",
            "   ",
            "<root attr='unclosed>value</root>",
            "<?xml version='1.0'?><root><![CDATA[unclosed cdata</root>",
        ]
        for p in payloads:
            with pytest.raises(ValueError):
                SafeXmlParser.parse_string(p)

    def test_null_byte_in_xml(self):
        """Challenge: Null bytes in XML string."""
        payload = "<root><item>Null\x00Byte</item></root>"
        with pytest.raises(ValueError):
            SafeXmlParser.parse_string(payload)

    def test_deeply_nested_xml_tags(self):
        """Challenge: Deeply nested XML (500 levels) to verify recursion handling."""
        depth = 500
        open_tags = "".join(f"<tag_{i}>" for i in range(depth))
        close_tags = "".join(f"</tag_{i}>" for i in reversed(range(depth)))
        payload = f"{open_tags}deep_content{close_tags}"
        # Should either successfully parse or raise ValueError, must NEVER crash the Python process
        try:
            root = SafeXmlParser.parse_string(payload)
            assert root is not None
        except (ValueError, RecursionError):
            pass  # Clean rejection is acceptable

    def test_type_safety_non_string_inputs(self):
        """Challenge: Non-string inputs passed to parse_string."""
        with pytest.raises(ValueError):
            SafeXmlParser.parse_string(None)
        with pytest.raises(ValueError):
            SafeXmlParser.parse_string(12345)


# ============================================================================
# 2. CONFIDENCECLASSIFIER & LLM SPOOFING CHALLENGES
# ============================================================================

class TestConfidenceClassifierChallenges:
    """Challenge ConfidenceClassifier against LLM spoofing, score tampering, and evidence invariants."""

    def _create_sample_finding(
        self,
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        has_evidence=True,
    ):
        evidence_list = []
        if has_evidence:
            evidence_list = [
                Evidence(
                    artifact_path="manifest.xml",
                    line_number=1,
                    sha256="abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                    provenance=confidence,
                )
            ]
        return Finding(
            rule_id="RULE_TEST_01",
            severity=Severity.HIGH if hasattr(Severity, "HIGH") else Severity.CRITICAL,
            category="SECURITY",
            title="Sample test finding",
            description="Testing classifier invariants",
            confidence=confidence,
            confidence_score=confidence_score,
            remediation="Apply remediation",
            evidence=evidence_list,
        )

    def test_llm_spoof_verified_demoted_to_inferred(self):
        """Challenge: LLM attempts to claim 1.0 / VERIFIED."""
        finding = self._create_sample_finding(
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            has_evidence=True,
        )
        classified = ConfidenceClassifier.classify_finding(finding, is_ai_generated=True)
        assert classified.confidence == ConfidenceClass.INFERRED
        assert classified.confidence_score <= 0.60
        assert classified.confidence != ConfidenceClass.VERIFIED
        assert classified.confidence_score != 1.0

    def test_llm_spoof_rule_derived_demoted_to_inferred(self):
        """Challenge: LLM attempts to claim 0.85 / RULE_DERIVED."""
        finding = self._create_sample_finding(
            confidence=ConfidenceClass.RULE_DERIVED,
            confidence_score=0.85,
            has_evidence=True,
        )
        classified = ConfidenceClassifier.classify_finding(finding, is_ai_generated=True)
        assert classified.confidence == ConfidenceClass.INFERRED
        assert classified.confidence_score <= 0.60

    def test_llm_spoof_inferred_with_elevated_score(self):
        """Challenge: LLM claims INFERRED but with confidence_score = 0.99."""
        finding = self._create_sample_finding(
            confidence=ConfidenceClass.INFERRED,
            confidence_score=0.99,
            has_evidence=True,
        )
        classified = ConfidenceClassifier.classify_finding(finding, is_ai_generated=True)
        assert classified.confidence == ConfidenceClass.INFERRED
        assert classified.confidence_score <= 0.60

    def test_llm_spoof_unknown_with_elevated_score(self):
        """Challenge: LLM claims UNKNOWN but with confidence_score = 0.80."""
        finding = self._create_sample_finding(
            confidence=ConfidenceClass.UNKNOWN,
            confidence_score=0.80,
            has_evidence=True,
        )
        classified = ConfidenceClassifier.classify_finding(finding, is_ai_generated=True)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score <= 0.30

    def test_missing_evidence_demotes_verified_to_unknown(self):
        """Invariant: Finding claiming VERIFIED without evidence demotes to UNKNOWN (0.30)."""
        finding = self._create_sample_finding(
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            has_evidence=False,
        )
        classified = ConfidenceClassifier.classify_finding(finding, missing_evidence=False)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score == 0.30

    def test_challenge_missing_evidence_on_rule_derived_finding(self):
        """
        CRITICAL INVARIANT CHALLENGE:
        Contract (PROJECT.md line 30): 'Every finding MUST be backed by an immutable Evidence record'.
        Contract (@erppreflight/evidence classifier.ts): 'if (!options.hasEvidence) -> UNKNOWN (0.30)'.
        
        Empirical finding: When missing_evidence=False, Rule 2 only checks finding.confidence == VERIFIED.
        Therefore, RULE_DERIVED findings with empty evidence are NOT demoted to UNKNOWN.
        """
        finding = self._create_sample_finding(
            confidence=ConfidenceClass.RULE_DERIVED,
            confidence_score=0.85,
            has_evidence=False,
        )
        classified = ConfidenceClassifier.classify_finding(finding, missing_evidence=False)
        
        # Invariant verified: RULE_DERIVED without evidence demotes to UNKNOWN (0.30)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score == 0.30

    def test_challenge_ai_generated_with_missing_evidence_demotion_ordering(self):
        """
        CRITICAL ORDERING CHALLENGE:
        An LLM creates a finding with VERIFIED confidence and NO EVIDENCE.
        Missing evidence takes strict precedence over AI capping: must demote to UNKNOWN (0.30).
        """
        finding = self._create_sample_finding(
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            has_evidence=False,
        )
        classified = ConfidenceClassifier.classify_finding(finding, is_ai_generated=True, missing_evidence=False)
        
        # Invariant verified: Missing evidence precedence demotes to UNKNOWN (0.30)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score == 0.30

    def test_challenge_engine_runner_ai_flag_passthrough(self):
        """
        CHALLENGE:
        EngineRunner and ConfidenceClassifier inspect finding provenance and evidence trust level.
        """
        # Create an engine finding that has AI provenance in evidence
        ai_evidence = Evidence(
            artifact_path="ai_generated.txt",
            line_number=1,
            sha256="1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            provenance=ConfidenceClass.INFERRED,
            source_type=TrustLevel.INFERRED,
        )
        finding = Finding(
            rule_id="AI_INFERRED_RULE",
            severity=Severity.CRITICAL,
            category="AI",
            title="AI finding claiming verified",
            description="Generated by AI problem router",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Check AI result",
            evidence=[ai_evidence],
        )
        # Directly run classify_finding with defaults (as EngineRunner does)
        classified = ConfidenceClassifier.classify_finding(finding)
        # Auto-detected from evidence provenance: demotes to INFERRED (0.60)
        assert classified.confidence == ConfidenceClass.INFERRED
        assert classified.confidence_score <= 0.60


# ============================================================================
# 3. ENGINE REGISTRY & PYDANTIC VALIDATION CHALLENGES
# ============================================================================

class TestRegistryAndPydanticChallenges:
    """Stress-test EngineRegistry and Pydantic validation against corrupt, unexpected, and malformed inputs."""

    def test_unregistered_engine_lookup(self):
        """Challenge: Requesting non-existent engine."""
        with pytest.raises(EngineNotFoundError):
            EngineRegistry.get("NON_EXISTENT_ENGINE")

    def test_engine_registry_concurrency(self):
        """Challenge: 50 concurrent threads requesting engines from EngineRegistry."""
        def lookup_task(engine_type):
            return EngineRegistry.get(engine_type)

        engines = list(EngineType)
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [
                executor.submit(lookup_task, engines[i % len(engines)])
                for i in range(100)
            ]
            results = [f.result() for f in futures]
            assert len(results) == 100
            for r in results:
                assert r is not None

    def test_pydantic_rejects_missing_mandatory_fields(self):
        """Challenge: AnalysisRequest missing mandatory UUID fields."""
        with pytest.raises(ValidationError) as exc:
            AnalysisRequest()
        errors = exc.value.errors()
        missing_fields = {e["loc"][0] for e in errors if e["type"] == "missing"}
        assert "job_id" in missing_fields
        assert "tenant_id" in missing_fields
        assert "project_id" in missing_fields
        assert "engine_type" in missing_fields

    def test_pydantic_rejects_invalid_engine_type(self):
        """Challenge: AnalysisRequest with invalid engine enum string."""
        with pytest.raises(ValidationError):
            AnalysisRequest(
                job_id=str(uuid.uuid4()),
                tenant_id=str(uuid.uuid4()),
                project_id=str(uuid.uuid4()),
                engine_type="HACKER_ENGINE",
            )

    def test_pydantic_rejects_invalid_artifact_type(self):
        """Challenge: AnalysisRequest with invalid artifact enum."""
        with pytest.raises(ValidationError):
            AnalysisRequest(
                job_id=str(uuid.uuid4()),
                tenant_id=str(uuid.uuid4()),
                project_id=str(uuid.uuid4()),
                engine_type=EngineType.OPD_GUARD,
                artifact_type="EXE_BINARY",
            )

    def test_pydantic_rejects_invalid_confidence_score_range(self):
        """Challenge: Finding with confidence_score out of bounds (> 1.0 or < 0.0)."""
        with pytest.raises(ValidationError):
            Finding(
                rule_id="TEST",
                severity=Severity.INFO,
                category="TEST",
                title="T",
                description="D",
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.5,  # Invalid: > 1.0
                remediation="R",
            )
        with pytest.raises(ValidationError):
            Finding(
                rule_id="TEST",
                severity=Severity.INFO,
                category="TEST",
                title="T",
                description="D",
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=-0.1,  # Invalid: < 0.0
                remediation="R",
            )

    def test_pydantic_rejects_invalid_evidence_fields(self):
        """Challenge: Evidence missing sha256 or artifact_path."""
        with pytest.raises(ValidationError):
            Evidence(artifact_path="file.xml")  # missing sha256

        with pytest.raises(ValidationError):
            Evidence(sha256="abc")  # missing artifact_path


# ============================================================================
# 4. END-TO-END HTTP API ADVERSARIAL CHALLENGES
# ============================================================================

class TestApiAdversarialChallenges:
    """Test FastAPI endpoint behavior when exposed to malformed JSON, XXE payloads, and unregistered engines."""

    @pytest.mark.asyncio
    async def test_api_malformed_json_body(self):
        """Challenge: Sending syntactically broken JSON to /api/v1/analyze."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/analyze",
                content="{ broken json, 'unclosed': ",
                headers={"Content-Type": "application/json"},
            )
            assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_api_empty_body(self):
        """Challenge: Sending empty request body to /api/v1/analyze."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/analyze",
                content="",
                headers={"Content-Type": "application/json"},
            )
            assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_api_xxe_payload_handled_gracefully(self):
        """Challenge: End-to-end FormDoctor analysis with malicious XXE in raw_content."""
        xxe_payload = """<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE test [
            <!ENTITY xxe SYSTEM "file:///c:/boot.ini">
        ]>
        <form><name>&xxe;</name></form>"""

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            request_body = {
                "job_id": str(uuid.uuid4()),
                "tenant_id": str(uuid.uuid4()),
                "project_id": str(uuid.uuid4()),
                "engine_type": "FORM_DOCTOR",
                "artifact_type": "XML",
                "raw_content": xxe_payload,
            }
            response = await client.post("/api/v1/analyze", json=request_body)
            # Must return 200 OK with status="FAILED" and error message, without crashing the server
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "FAILED"
            assert "SecurityViolationError" in data["error_message"] or "Malicious XML" in data["error_message"]

    @pytest.mark.asyncio
    async def test_api_billion_laughs_handled_gracefully(self):
        """Challenge: End-to-end FormDoctor analysis with Billion Laughs XML bomb."""
        bomb_payload = """<?xml version="1.0"?>
        <!DOCTYPE lolz [
         <!ENTITY lol "lol">
         <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
         <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
         <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
        ]>
        <lolz>&lol3;</lolz>"""

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            request_body = {
                "job_id": str(uuid.uuid4()),
                "tenant_id": str(uuid.uuid4()),
                "project_id": str(uuid.uuid4()),
                "engine_type": "FORM_DOCTOR",
                "artifact_type": "XML",
                "raw_content": bomb_payload,
            }
            response = await client.post("/api/v1/analyze", json=request_body)
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "FAILED"
            assert "SecurityViolationError" in data["error_message"] or "Entities/DTD forbidden" in data["error_message"]

    @pytest.mark.asyncio
    async def test_api_unknown_engine_metadata_returns_404(self):
        """Challenge: Requesting metadata for unknown engine returns 404."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/engines/UNKNOWN_ENGINE")
            # Should be 422 (validation error on enum) or 404
            assert response.status_code in (404, 422)
