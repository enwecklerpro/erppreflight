"""
Empirical Adversarial Test Suite for R7:
Python OPD Guard XML Parsing & Fixture Integrity Stress Test

Targets:
1. services/analysis-python/src/engines/opd_guard.py
2. services/analysis-python/src/parsers/safe_xml.py
3. tests/fixtures/known_bad_billing_opd.xml

Verifications:
- Malformed XML syntax handling
- Missing <Row> tags resilience
- Missing <Table> handling
- Non-ASCII & UTF-8 multi-byte character handling
- Entity expansion / XXE safety via SafeXmlParser
- Deterministic evaluation of known_bad_billing_opd.xml triggering OPD_DETERMINATION_STEP_MISSING
  with exact line > 1 and valid 64-char SHA-256 hash.
"""

import hashlib
import os
import pytest
from pathlib import Path

from src.engines.opd_guard import OPDGuardEngine
from src.parsers.safe_xml import SafeXmlParser
from src.core.exceptions import SecurityViolationError
from src.models.enums import EngineType, ArtifactType, AnalysisStatus, Severity, ConfidenceClass
from src.models.request import AnalysisRequest, ArtifactReference
from src.platform.evidence import EvidenceEngine
from src.core.runner import EngineRunner


# ============================================================================
# 1. SafeXmlParser ADVERSARIAL STRESS TESTS
# ============================================================================

class TestSafeXmlParserAdversarial:
    """Stress-test SafeXmlParser against XXE, DTDs, malformed syntax, and non-ASCII."""

    def test_safe_xml_blocks_classic_xxe_file_disclosure(self):
        """External entity expansion must be blocked with SecurityViolationError."""
        payload = """<?xml version="1.0" encoding="utf-8"?>
        <!DOCTYPE doc [
            <!ENTITY xxe SYSTEM "file:///etc/passwd">
        ]>
        <doc><data>&xxe;</data></doc>"""
        with pytest.raises(SecurityViolationError) as exc_info:
            SafeXmlParser.parse_string(payload)
        assert "Malicious XML detected" in str(exc_info.value) or "forbidden" in str(exc_info.value).lower()

    def test_safe_xml_blocks_parameter_entity_ssrf(self):
        """Parameter entities used for out-of-band SSRF must be blocked."""
        payload = """<?xml version="1.0" encoding="utf-8"?>
        <!DOCTYPE doc [
            <!ENTITY % dtd SYSTEM "http://127.0.0.1:8080/evil.dtd">
            %dtd;
        ]>
        <doc><data>test</data></doc>"""
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_safe_xml_blocks_billion_laughs_quadratic_blowup(self):
        """Exponential / recursive entity expansion (Billion Laughs) must be blocked."""
        payload = """<?xml version="1.0"?>
        <!DOCTYPE lolz [
            <!ENTITY lol "lol">
            <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
            <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
            <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
        ]>
        <lolz>&lol3;</lolz>"""
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_safe_xml_rejects_malformed_syntax_gracefully(self):
        """Malformed XML syntax must raise ValueError, not crash the process."""
        malformed_cases = [
            "<root><open>unclosed</root>",
            "<root attr=noquotes>test</root>",
            "<<<<invalid>>>",
            "",
            "   \n\t   ",
            "<root>&undefined_entity;</root>",
            "<root>\x00nullbyte</root>",
        ]
        for bad_xml in malformed_cases:
            with pytest.raises((ValueError, SecurityViolationError)):
                SafeXmlParser.parse_string(bad_xml)

    def test_safe_xml_preserves_line_coordinates(self):
        """Parser must retain accurate 1-indexed source line numbers."""
        xml = (
            "<?xml version=\"1.0\"?>\n"
            "<Root>\n"
            "  <Level1>\n"
            "    <Level2 line_test=\"true\">\n"
            "      <Item>Value</Item>\n"
            "    </Level2>\n"
            "  </Level1>\n"
            "</Root>"
        )
        root = SafeXmlParser.parse_string(xml)
        assert root.sourceline == 2
        level1 = root.find("Level1")
        assert level1.sourceline == 3
        level2 = root.find(".//Level2")
        assert level2.sourceline == 4
        item = root.find(".//Item")
        assert item.sourceline == 5

    def test_safe_xml_supports_non_ascii_multibyte_characters(self):
        """SafeXmlParser must correctly parse non-ASCII Unicode (German umlauts, CJK, Emoji)."""
        xml = (
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
            "<InvoiceDoc>\n"
            "  <Location>München / Zürich / Malmö</Location>\n"
            "  <Client>東京商事株式会社</Client>\n"
            "  <Invoice>فاتورة_الكترونية_2026</Invoice>\n"
            "  <EmojiTag>🧾</EmojiTag>\n"
            "</InvoiceDoc>"
        )
        root = SafeXmlParser.parse_string(xml)
        assert root.find("Location").text == "München / Zürich / Malmö"
        assert root.find("Client").text == "東京商事株式会社"
        assert root.find("Invoice").text == "فاتورة_الكترونية_2026"
        assert root.find("EmojiTag").text == "🧾"


# ============================================================================
# 2. OPD Guard Engine ADVERSARIAL INPUT STRESS TESTS
# ============================================================================

class TestOPDGuardEngineAdversarial:
    """Stress-test OPDGuardEngine against edge cases in XML structure."""

    @pytest.fixture
    def engine(self):
        return OPDGuardEngine()

    @pytest.mark.asyncio
    async def test_opd_guard_handles_malformed_xml_without_crash(self, engine):
        """Passing malformed XML in raw_content must not raise unhandled exceptions."""
        request = AnalysisRequest(
            job_id="test-malformed-xml",
            tenant_id="tenant-stress",
            project_id="proj-stress",
            engine_type=EngineType.OPD_GUARD,
            artifact_type=ArtifactType.XML,
            raw_content="<OutputParameterDetermination><UnclosedTag>",
            target_release="S4H_2023",
        )
        # M4: malformed XML must not crash and must not be reported as a clean COMPLETED run.
        response = await EngineRunner.execute(request)
        assert response.status == AnalysisStatus.FAILED
        assert [f.rule_id for f in response.findings] == ["OPD_PARSE_ERROR"]
        assert response.findings[0].confidence == ConfidenceClass.UNKNOWN

    @pytest.mark.asyncio
    async def test_opd_guard_handles_missing_row_tags_safely(self, engine):
        """Decision table with missing <Row> tags must trigger missing step finding cleanly."""
        xml_content = """<?xml version="1.0" encoding="utf-8"?>
        <OutputParameterDetermination>
          <Scenario>
            <BillingType>F2</BillingType>
          </Scenario>
          <DecisionTables>
            <Table name="Output Type">
              <!-- Empty table: zero rows -->
            </Table>
          </DecisionTables>
        </OutputParameterDetermination>"""

        request = AnalysisRequest(
            job_id="test-empty-table",
            tenant_id="tenant-stress",
            project_id="proj-stress",
            engine_type=EngineType.OPD_GUARD,
            artifact_type=ArtifactType.XML,
            raw_content=xml_content,
            target_release="S4H_2023",
        )
        response = await engine.analyze(request)
        assert len(response.findings) >= 1
        finding = response.findings[0]
        assert finding.rule_id == "OPD_DETERMINATION_STEP_MISSING"
        assert "zero configured rules" in finding.technical_details.get("missingCondition", "")
        assert finding.evidence[0].line_number >= 7  # Line of the Table tag

    @pytest.mark.asyncio
    async def test_opd_guard_handles_missing_tables_container(self, engine):
        """XML with scenario but missing <Table> / <DecisionTables> must not crash."""
        xml_content = """<?xml version="1.0" encoding="utf-8"?>
        <OutputParameterDetermination>
          <Scenario>
            <BillingType>F2</BillingType>
            <SalesOrganization>1000</SalesOrganization>
          </Scenario>
        </OutputParameterDetermination>"""

        request = AnalysisRequest(
            job_id="test-no-tables",
            tenant_id="tenant-stress",
            project_id="proj-stress",
            engine_type=EngineType.OPD_GUARD,
            artifact_type=ArtifactType.XML,
            raw_content=xml_content,
            target_release="S4H_2023",
        )
        response = await engine.analyze(request)
        assert len(response.findings) >= 1
        finding = response.findings[0]
        assert finding.rule_id == "OPD_DETERMINATION_STEP_MISSING"
        assert finding.evidence[0].line_number >= 1

    @pytest.mark.asyncio
    async def test_opd_guard_supports_non_ascii_in_rules_and_scenario(self, engine):
        """OPD Guard must match non-ASCII condition criteria (e.g. SalesOrg with umlauts/kanji)."""
        xml_content = """<?xml version="1.0" encoding="utf-8"?>
        <OutputParameterDetermination>
          <Scenario>
            <BillingType>F2</BillingType>
            <SalesOrgName>München_HQ</SalesOrgName>
          </Scenario>
          <DecisionTables>
            <Table name="Output Type">
              <Row>
                <COND_SalesOrgName>München_HQ</COND_SalesOrgName>
                <RESULT>BILLING_DOC_DE</RESULT>
              </Row>
            </Table>
          </DecisionTables>
        </OutputParameterDetermination>"""

        request = AnalysisRequest(
            job_id="test-non-ascii",
            tenant_id="tenant-stress",
            project_id="proj-stress",
            engine_type=EngineType.OPD_GUARD,
            artifact_type=ArtifactType.XML,
            raw_content=xml_content,
            target_release="S4H_2023",
        )
        response = await engine.analyze(request)
        # Output Type matches successfully
        results = response.metrics.additional_metrics.get("results", {})
        assert results.get("Output Type") == "BILLING_DOC_DE"


# ============================================================================
# 3. KNOWN BAD BILLING OPD FIXTURE VERIFICATION
# ============================================================================

class TestKnownBadBillingOpdFixture:
    """Verifies tests/fixtures/known_bad_billing_opd.xml deterministically triggers OPD_DETERMINATION_STEP_MISSING."""

    @pytest.fixture
    def fixture_path(self):
        # Monorepo root: services/analysis-python/tests/adversarial/<file> -> parents[4]
        path = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "known_bad_billing_opd.xml"
        assert path.exists(), f"Fixture file not found at: {path}"
        return path

    @pytest.fixture
    def fixture_content(self, fixture_path):
        with open(fixture_path, "r", encoding="utf-8") as f:
            return f.read()

    @pytest.mark.asyncio
    async def test_known_bad_billing_opd_triggers_step_missing(self, fixture_content, fixture_path):
        """
        Verify known_bad_billing_opd.xml triggers OPD_DETERMINATION_STEP_MISSING at Channel step:
        - Line number must be > 1 (specifically line 23 where <Table name="Channel"> begins)
        - Evidence SHA-256 must be a valid 64-char lowercase hexadecimal string matching file content
        - Confidence must be VERIFIED (1.0)
        - Affected object must be OPD_STEP_CHANNEL
        """
        engine = OPDGuardEngine()
        raw_content = fixture_content

        # Expected SHA-256 hash of the exact fixture content
        expected_sha256 = hashlib.sha256(raw_content.strip().encode("utf-8")).hexdigest()
        assert len(expected_sha256) == 64

        request = AnalysisRequest(
            job_id="test-known-bad-opd",
            tenant_id="tenant-audit-golden",
            project_id="proj-s4h-2023",
            engine_type=EngineType.OPD_GUARD,
            artifact_type=ArtifactType.XML,
            raw_content=raw_content,
            artifact_s3_key="artifacts/known_bad_billing_opd.xml",
            target_release="S4H_2023",
        )

        response = await engine.analyze(request)

        # 1. Assert response status
        assert response.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL)
        assert len(response.findings) >= 1

        # 2. Locate the OPD_DETERMINATION_STEP_MISSING finding
        missing_findings = [f for f in response.findings if f.rule_id == "OPD_DETERMINATION_STEP_MISSING"]
        assert len(missing_findings) == 1, f"Expected 1 missing step finding, got {len(missing_findings)}"

        finding = missing_findings[0]

        # 3. Assert rule ID, severity, category, confidence
        assert finding.rule_id == "OPD_DETERMINATION_STEP_MISSING"
        assert finding.severity == Severity.MAJOR  # Channel is MAJOR severity per opd_guard.py line 749
        assert finding.category == "Output Determination"
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert finding.confidence_score == 1.0
        assert "Channel" in finding.title
        assert "Channel" in finding.technical_details.get("step", "")

        # 4. Assert affected objects
        assert finding.affected_objects == ["OPD_STEP_CHANNEL"]

        # 5. Assert evidence integrity
        assert len(finding.evidence) >= 1
        ev = finding.evidence[0]
        assert ev.artifact_path == "artifacts/known_bad_billing_opd.xml#Channel"

        # Line number must be > 1 and match the line of <Table name="Channel"> (line 23)
        assert ev.line_number > 1, f"Expected line_number > 1, got {ev.line_number}"
        assert ev.line_number == 23, f"Expected line_number 23 for <Table name='Channel'>, got {ev.line_number}"

        # SHA-256 hash verification
        assert len(ev.sha256) == 64, f"Expected 64-char sha256 hash, got {len(ev.sha256)}: '{ev.sha256}'"
        assert all(c in "0123456789abcdef" for c in ev.sha256), f"Invalid hex hash: {ev.sha256}"
        assert ev.sha256 == expected_sha256, f"Hash mismatch: expected {expected_sha256}, got {ev.sha256}"

        # 6. Verify pipeline metrics
        metrics = response.metrics.additional_metrics
        assert metrics.get("firstFailedStep") == "Channel"
        assert metrics.get("successfulSteps") == 2  # "Output Type" and "Receiver" succeeded before "Channel"
        assert metrics.get("results", {}).get("Output Type") == "BILLING_DOCUMENT"
        assert metrics.get("results", {}).get("Receiver") == "BP_100045"

    @pytest.mark.asyncio
    async def test_known_bad_billing_opd_determinism_loop(self, fixture_content):
        """Verify byte-for-byte deterministic reproducibility across 10 consecutive runs."""
        engine = OPDGuardEngine()
        baseline_findings = None

        for iteration in range(10):
            request = AnalysisRequest(
                job_id=f"test-determinism-{iteration}",
                tenant_id="tenant-audit-golden",
                project_id="proj-s4h-2023",
                engine_type=EngineType.OPD_GUARD,
                artifact_type=ArtifactType.XML,
                raw_content=fixture_content,
                target_release="S4H_2023",
            )
            response = await engine.analyze(request)
            findings_repr = [
                (
                    f.rule_id,
                    f.severity,
                    f.evidence[0].line_number,
                    f.evidence[0].sha256,
                    f.technical_details,
                )
                for f in response.findings
            ]

            if baseline_findings is None:
                baseline_findings = findings_repr
            else:
                assert findings_repr == baseline_findings, (
                    f"Non-deterministic finding drift on iteration {iteration}!"
                )
