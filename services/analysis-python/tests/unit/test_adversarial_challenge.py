import pytest
from src.models.enums import Severity, ConfidenceClass, EngineType, AnalysisStatus
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse
from src.platform.confidence import ConfidenceClassifier
from src.parsers.safe_xml import SafeXmlParser
from src.core.registry import EngineRegistry
from src.core.exceptions import SecurityViolationError, EngineNotFoundError


class TestConfidenceClassifierInvariants:
    """Stress tests epistemic confidence invariants."""

    def test_bug_rule_derived_without_evidence_fails_demotion(self):
        """RESOLVED: RULE_DERIVED finding with empty evidence is unconditionally demoted to UNKNOWN (0.30)."""
        f = Finding(
            rule_id="RULE_001",
            severity=Severity.MAJOR,
            category="CONFIG",
            title="Rule without evidence",
            description="Testing missing evidence demotion",
            confidence=ConfidenceClass.RULE_DERIVED,
            remediation="Provide evidence",
            evidence=[],
        )
        
        # When classify_finding runs with defaults:
        result = ConfidenceClassifier.classify_finding(f)
        
        assert result.confidence == ConfidenceClass.UNKNOWN
        assert result.confidence_score == 0.30

    def test_bug_ai_generated_without_evidence_gets_inferred_instead_of_unknown(self):
        """RESOLVED: AI generated finding with empty evidence demotes to UNKNOWN (0.30) via missing evidence precedence."""
        f = Finding(
            rule_id="AI_001",
            severity=Severity.MAJOR,
            category="LLM",
            title="AI finding without evidence",
            description="Testing AI demotion without evidence",
            confidence=ConfidenceClass.VERIFIED,
            remediation="Fix it",
            evidence=[],
        )

        result = ConfidenceClassifier.classify_finding(f, is_ai_generated=True)
        assert result.confidence == ConfidenceClass.UNKNOWN
        assert result.confidence_score == 0.30

    def test_verified_finding_with_evidence_retains_verified(self):
        ev = Evidence(
            artifact_path="test.xml",
            line_number=10,
            sha256="a" * 64,
            provenance=ConfidenceClass.VERIFIED,
        )
        f = Finding(
            rule_id="VERIFIED_001",
            severity=Severity.INFO,
            category="SYNTAX",
            title="Valid Finding",
            description="Has proper evidence",
            confidence=ConfidenceClass.VERIFIED,
            remediation="None",
            evidence=[ev],
        )

        result = ConfidenceClassifier.classify_finding(f)
        assert result.confidence == ConfidenceClass.VERIFIED
        assert result.confidence_score == 1.0


class TestSafeXmlParserAdversarial:
    """Stress tests XML parser against malicious XML payloads."""

    def test_billion_laughs_dos_blocked(self):
        """Exponential entity expansion (Billion Laughs) must raise SecurityViolationError."""
        xml_payload = """<?xml version="1.0"?>
        <!DOCTYPE lolz [
         <!ENTITY lol "lol">
         <!ELEMENT lolz (#PCDATA)>
         <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
         <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
         <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
        ]>
        <lolz>&lol3;</lolz>"""

        with pytest.raises(SecurityViolationError) as excinfo:
            SafeXmlParser.parse_string(xml_payload)
        assert "Malicious XML detected" in str(excinfo.value)

    def test_external_file_xxe_blocked(self):
        """External entity expansion pointing to system file must raise SecurityViolationError."""
        xxe_payload = """<?xml version="1.0" encoding="ISO-8859-1"?>
        <!DOCTYPE foo [
          <!ELEMENT foo ANY >
          <!ENTITY xxe SYSTEM "file:///etc/passwd" >]>
        <foo>&xxe;</foo>"""

        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(xxe_payload)

    def test_malformed_xml_syntax(self):
        """Malformed XML syntax must be caught cleanly as ValueError."""
        with pytest.raises(ValueError, match="Invalid XML syntax"):
            SafeXmlParser.parse_string("<root><unclosed_tag></root>")

    def test_deeply_nested_xml(self):
        """Deeply nested XML (100 levels) parses without stack overflow."""
        depth = 100
        open_tags = "".join(f"<node_{i}>" for i in range(depth))
        close_tags = "".join(f"</node_{i}>" for i in reversed(range(depth)))
        payload = f"{open_tags}leaf{close_tags}"
        root = SafeXmlParser.parse_string(payload)
        assert root is not None


class TestEngineRegistryRobustness:
    """Tests EngineRegistry handling of boundary cases."""

    def test_unregistered_engine_raises_engine_not_found_error(self):
        with pytest.raises(EngineNotFoundError, match="not registered"):
            EngineRegistry.get("NON_EXISTENT_ENGINE")

    def test_engine_count_is_at_least_19(self):
        assert len(EngineRegistry.list_all()) >= 19
