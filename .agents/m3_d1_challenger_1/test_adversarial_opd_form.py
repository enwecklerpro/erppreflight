"""
ERP Preflight — Milestone 3 Domain 1 Empirical Stress Test Harness
Adversarial test suite for:
- OPD Guard (BRFplus decision tables, non-contiguous shadowing, intervals, corrupted tables, multi-step pipeline)
- SafeXmlParser (XXE, Billion Laughs, parameter entities, DTDs, deep nesting, line retention)
- FormDoctor (Clean Core legacy forms, XDP bindings, missing elements, release severity scaling, XML/XDP malformations)

This harness executes empirical tests against production implementations and documents all verified defects.
"""

import asyncio
import io
import json
import os
import re
import sys
import zipfile
import pytest

# Ensure services/analysis-python is on sys.path
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ANALYSIS_PY_DIR = os.path.join(BASE_DIR, "services", "analysis-python")
if ANALYSIS_PY_DIR not in sys.path:
    sys.path.insert(0, ANALYSIS_PY_DIR)

from src.parsers.safe_xml import SafeXmlParser, LineElement
from src.core.exceptions import SecurityViolationError
from src.engines.opd_guard import OPDGuardEngine
from src.engines.form_doctor import FormDoctorEngine
from src.models.request import AnalysisRequest, ArtifactReference
from src.models.enums import EngineType, ArtifactType, AnalysisStatus, Severity, ConfidenceClass
from src.core.runner import EngineRunner


# =============================================================================
# PART 1: SafeXmlParser Adversarial Security & Robustness Tests
# =============================================================================

class TestSafeXmlParserSecurity:
    """Empirical verification of XXE, Billion Laughs, and parser defenses in safe_xml.py"""

    def test_safe_xml_xxe_file_exfiltration_unix(self):
        """XXE Defense: Classic UNIX /etc/passwd entity injection must be rejected with SecurityViolationError."""
        payload = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE test [\n'
            '  <!ENTITY xxe SYSTEM "file:///etc/passwd">\n'
            ']>\n'
            '<root><data>&xxe;</data></root>'
        )
        with pytest.raises(SecurityViolationError) as exc_info:
            SafeXmlParser.parse_string(payload)
        assert "Malicious XML detected" in str(exc_info.value) or "Entities/DTD forbidden" in str(exc_info.value)

    def test_safe_xml_xxe_file_exfiltration_windows(self):
        """XXE Defense: Windows win.ini entity injection must be rejected with SecurityViolationError."""
        payload = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE test [\n'
            '  <!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">\n'
            ']>\n'
            '<root><data>&xxe;</data></root>'
        )
        with pytest.raises(SecurityViolationError) as exc_info:
            SafeXmlParser.parse_string(payload)
        assert "Malicious XML detected" in str(exc_info.value) or "Entities/DTD forbidden" in str(exc_info.value)

    def test_safe_xml_parameter_entity_injection(self):
        """XXE Defense: Parameter entity injection (%pe;) must be rejected."""
        payload = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE test [\n'
            '  <!ENTITY % pe SYSTEM "http://127.0.0.1:9999/evil.dtd">\n'
            '  %pe;\n'
            ']>\n'
            '<root><data>test</data></root>'
        )
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_safe_xml_external_dtd_inclusion(self):
        """XXE Defense: External DTD declaration must be rejected."""
        payload = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE root SYSTEM "http://127.0.0.1:9999/test.dtd">\n'
            '<root><data>test</data></root>'
        )
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_safe_xml_billion_laughs_exponential_dos(self):
        """DoS Defense: Billion Laughs recursive entity expansion must fail closed immediately."""
        payload = (
            '<?xml version="1.0"?>\n'
            '<!DOCTYPE lolz [\n'
            ' <!ENTITY lol "lol">\n'
            ' <!ELEMENT lolz (#PCDATA)>\n'
            ' <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">\n'
            ' <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">\n'
            ' <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">\n'
            ']>\n'
            '<lolz>&lol3;</lolz>'
        )
        with pytest.raises(SecurityViolationError):
            SafeXmlParser.parse_string(payload)

    def test_safe_xml_deeply_nested_payload(self):
        """Structure Stress: 120 levels of nesting must parse cleanly without recursion errors."""
        depth = 120
        open_tags = "".join(f"<level{i}>\n" for i in range(depth))
        close_tags = "".join(f"</level{i}>\n" for i in reversed(range(depth)))
        xml_text = f"<?xml version='1.0'?>\n{open_tags}<leaf>value</leaf>\n{close_tags}"

        root = SafeXmlParser.parse_string(xml_text)
        assert isinstance(root, LineElement)
        curr = root
        for i in range(1, depth):
            curr = curr[0]
        leaf = curr[0]
        assert leaf.tag == "leaf"
        assert leaf.text == "value"
        assert leaf.sourceline > depth
        assert leaf.get("line_number") == str(leaf.sourceline)

    def test_safe_xml_malformed_syntax_rejection(self):
        """Resilience: Malformed XML tags must raise ValueError with descriptive error message."""
        malformed = "<root><unclosed>text</root>"
        with pytest.raises(ValueError) as exc_info:
            SafeXmlParser.parse_string(malformed)
        assert "Invalid XML syntax" in str(exc_info.value)

    def test_safe_xml_empty_input_rejection(self):
        """Resilience: Completely empty or whitespace XML must raise ValueError."""
        with pytest.raises(ValueError):
            SafeXmlParser.parse_string("")
        with pytest.raises(ValueError):
            SafeXmlParser.parse_string("   \n\t   ")


# =============================================================================
# PART 2: OPD Guard BRFplus Decision Table Adversarial Tests
# =============================================================================

class TestOPDGuardDecisionTables:
    """Empirical verification of decision table parsing, non-contiguous shadowing, intervals, and errors."""

    @pytest.mark.asyncio
    async def test_opd_non_contiguous_shadowed_rules(self):
        """
        Adversarial Test: Multi-row non-contiguous rule shadowing.
        Rows:
          Row 0 (Line 2): Specific (ZINV, 1000)
          Row 1 (Line 3): Broad (ZINV, *)
          Row 2 (Line 4): Independent (ZORD, 2000)
          Row 3 (Line 5): Identical to Row 0 (ZINV, 1000) -> Shadowed by Row 0 (non-contiguous!)
          Row 4 (Line 6): Specific (ZINV, 3000) -> Shadowed by Row 1 (non-contiguous!)
          Row 5 (Line 7): Broad (ZORD, *)
          Row 6 (Line 8): Identical to Row 2 (ZORD, 2000) -> Shadowed by Row 2 (non-contiguous!)
          Row 7 (Line 9): Specific (ZORD, 5000) -> Shadowed by Row 5 (non-contiguous!)
        """
        csv_content = (
            "COND_DOCTYPE,COND_COMPANY,RESULT\n"
            "ZINV,1000,OUTPUT_A\n"
            "ZINV,*,OUTPUT_B\n"
            "ZORD,2000,OUTPUT_C\n"
            "ZINV,1000,OUTPUT_D\n"
            "ZINV,3000,OUTPUT_E\n"
            "ZORD,*,OUTPUT_F\n"
            "ZORD,2000,OUTPUT_G\n"
            "ZORD,5000,OUTPUT_H\n"
        )

        req = AnalysisRequest(
            job_id="11111111-2222-3333-4444-555555555551",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
            configuration={
                "default_step": "Output Type",
                "scenario": {"DOCTYPE": "ZINV", "COMPANY": "1000"},
            },
        )

        res = await EngineRunner.execute(req)
        # With matching scenario, pipeline succeeds
        assert res.status == AnalysisStatus.COMPLETED

        shadow_findings = [f for f in res.findings if f.rule_id == "OPD_UNREACHABLE_RULE"]
        shadowed_rows = [f.technical_details.get("shadowedRowIndex") for f in shadow_findings]

        # Verify exact non-contiguous shadowed rows: rows 4, 5, 7, 8
        assert len(shadow_findings) == 4
        assert 4 in shadowed_rows
        assert 5 in shadowed_rows
        assert 7 in shadowed_rows
        assert 8 in shadowed_rows

        # Verify finding metadata and evidence
        for f in shadow_findings:
            assert f.severity == Severity.MINOR
            assert f.confidence == ConfidenceClass.RULE_DERIVED
            assert f.confidence_score == 0.85
            assert len(f.evidence) == 1
            assert len(f.evidence[0].sha256) == 64
            assert f.evidence[0].line_number > 0

    @pytest.mark.asyncio
    async def test_opd_set_inclusion_shadowing_non_contiguous(self):
        """
        Adversarial Test: Comma-separated set subsumption across non-contiguous rows in standard CSV.
        Row 0: COND_PLANT="1000, 2000, 3000", COND_COUNTRY="*"
        Row 1: COND_PLANT="9999", COND_COUNTRY="*"
        Row 2: COND_PLANT="2000", COND_COUNTRY="US" (Shadowed by Row 0: "2000" in set, "*" covers "US")
        Row 3: COND_PLANT="8888", COND_COUNTRY="*"
        Row 4: COND_PLANT="1000, 3000", COND_COUNTRY="DE" (Shadowed by Row 0: subset in set, "*" covers "DE")
        """
        # Note: RFC 4180 requires double quotes around comma-containing fields in CSV
        csv_content = (
            'COND_PLANT,COND_COUNTRY,RESULT\n'
            '"1000, 2000, 3000",*,PRINT_ALL\n'
            '9999,*,PRINT_REMOTE\n'
            '2000,US,PRINT_US\n'
            '8888,*,PRINT_LOCAL\n'
            '"1000, 3000",DE,PRINT_DE\n'
        )

        req = AnalysisRequest(
            job_id="11111111-2222-3333-4444-555555555552",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
            configuration={"default_step": "Channel"},
        )

        res = await EngineRunner.execute(req)
        shadow_findings = [f for f in res.findings if f.rule_id == "OPD_UNREACHABLE_RULE"]
        shadowed_rows = [f.technical_details.get("shadowedRowIndex") for f in shadow_findings]

        # Row 2 (1-indexed: 3) and Row 4 (1-indexed: 5) must be shadowed
        assert 3 in shadowed_rows
        assert 5 in shadowed_rows
        assert len(shadow_findings) == 2

    def test_opd_matches_condition_interval_evaluation(self):
        """Empirical evaluation of numeric interval conditions in matches_condition."""
        # Standard range [1000..5000]
        assert OPDGuardEngine.matches_condition("[1000..5000]", "2500") is True
        assert OPDGuardEngine.matches_condition("[1000..5000]", "1000") is True
        assert OPDGuardEngine.matches_condition("[1000..5000]", "5000") is True
        assert OPDGuardEngine.matches_condition("[1000..5000]", "999") is False
        assert OPDGuardEngine.matches_condition("[1000..5000]", "5001") is False

        # Non-numeric input against range
        assert OPDGuardEngine.matches_condition("[1000..5000]", "ABCD") is False
        assert OPDGuardEngine.matches_condition("[1000..5000]", "") is False
        assert OPDGuardEngine.matches_condition("[1000..5000]", None) is False

        # Spaces inside range brackets: [ 1000 .. 5000 ]
        assert OPDGuardEngine.matches_condition("[ 1000 .. 5000 ]", "3000") is True

    def test_opd_matches_condition_negation_and_sets(self):
        """Empirical evaluation of negations (!=, <>, NOT) and comma-separated sets."""
        # Negation !=
        assert OPDGuardEngine.matches_condition("!= US", "DE") is True
        assert OPDGuardEngine.matches_condition("!= US", "US") is False
        assert OPDGuardEngine.matches_condition("!= US", "us") is False

        # Negation <>
        assert OPDGuardEngine.matches_condition("<> US", "CA") is True
        assert OPDGuardEngine.matches_condition("<> US", "US") is False

        # Negation NOT
        assert OPDGuardEngine.matches_condition("NOT US", "FR") is True
        assert OPDGuardEngine.matches_condition("NOT US", "US") is False

        # Comma separated sets
        assert OPDGuardEngine.matches_condition("US, DE, FR", "DE") is True
        assert OPDGuardEngine.matches_condition("US, DE, FR", "de") is True
        assert OPDGuardEngine.matches_condition("US, DE, FR", "IT") is False

        # Wildcards
        assert OPDGuardEngine.matches_condition("*", "ANYTHING") is True
        assert OPDGuardEngine.matches_condition("ALL", "ANYTHING") is True
        assert OPDGuardEngine.matches_condition("", "ANYTHING") is True

    def test_opd_condition_subsumes_missing_range_subsumption_defect(self):
        """
        Defect Verification: OPD Guard condition_subsumes fails to detect interval containment.
        Mathematical truth: [1000..5000] subsumes [2000..3000] and discrete value '2500'.
        Production implementation only checks *, exact match, and comma sets, so it returns False.
        """
        assert OPDGuardEngine.condition_subsumes("*", "[1000..5000]") is True
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[1000..5000]") is True

        # REMEDIATION VERIFICATION: condition_subsumes correctly handles interval and range subsumption
        subsumes_interval = OPDGuardEngine.condition_subsumes("[1000..5000]", "[2000..3000]")
        subsumes_discrete = OPDGuardEngine.condition_subsumes("[1000..5000]", "2500")

        assert subsumes_interval is True, "Remediation verified: [1000..5000] subsumes [2000..3000]"
        assert subsumes_discrete is True, "Remediation verified: [1000..5000] subsumes 2500"

    @pytest.mark.asyncio
    async def test_opd_malformed_corrupt_csv_resilience(self):
        """Resilience: Malformed CSV with unclosed quotes, ragged rows, and binary data must not crash."""
        ragged_csv = (
            'COL_A,COL_B,COL_C\n'
            'unclosed quote,"val1,val2\n'
            'val3\n'
            'row with,too,many,columns,here,extra\n'
            ',,\n'
            '\x00\x01\x02\n'
        )

        req = AnalysisRequest(
            job_id="11111111-2222-3333-4444-555555555553",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            raw_content=ragged_csv,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL)
        assert res.engine_type == EngineType.OPD_GUARD

    @pytest.mark.asyncio
    async def test_opd_malformed_json_resilience(self):
        """Resilience: Malformed JSON syntax must not crash the engine."""
        malformed_json = '{"tables": {"Output Type": [{"COND_DOCTYPE": "INV"}'

        req = AnalysisRequest(
            job_id="11111111-2222-3333-4444-555555555554",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            raw_content=malformed_json,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        assert res.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL)

    @pytest.mark.asyncio
    async def test_opd_corrupted_xlsx_resilience(self):
        """Resilience: Corrupted non-zip bytes submitted as XLSX must fail gracefully without unhandled crash."""
        corrupt_bytes = b"PK\x03\x04\x00\x00corrupted_payload_not_real_zip_stream"

        req = AnalysisRequest(
            job_id="11111111-2222-3333-4444-555555555555",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            artifact_type=ArtifactType.XLSX,
            artifacts=[
                ArtifactReference(
                    file_name="corrupt_decision_tables.xlsx",
                    artifact_type=ArtifactType.XLSX,
                    raw_content=corrupt_bytes.decode("latin1"),
                )
            ],
        )

        res = await EngineRunner.execute(req)
        assert res.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL)

    @pytest.mark.asyncio
    async def test_opd_full_pipeline_channel_and_printer_governance(self):
        """
        Integration: Full 8-step pipeline determination with intentional governance violations:
        1. Channel resolves to PRINT
        2. Print Queue is empty -> triggers OPD_PRINTER_QUEUE_NOT_FOUND (MAJOR)
        3. Relevance evaluates to 'FALSE' -> triggers OPD_RELEVANCE_SUPPRESSED (INFO)
        """
        pipeline_json = {
            "scenario": {
                "DOCTYPE": "BILLING_INV",
                "ROLE": "RE",
                "CHANNEL": "PRINT",
                "LANG": "EN",
            },
            "tables": {
                "Output Type": [{"COND_DOCTYPE": "BILLING_INV", "RESULT": "BILLING_DOC"}],
                "Receiver": [{"COND_DOCTYPE": "BILLING_INV", "RESULT": "RE"}],
                "Channel": [{"COND_DOCTYPE": "BILLING_INV", "RESULT": "PRINT"}],
                "Printer": [{"COND_DOCTYPE": "BILLING_INV", "RESULT": ""}],  # Empty print queue!
                "Email Recipient": [{"COND_DOCTYPE": "BILLING_INV", "RESULT": "test@corp.internal"}],
                "Email Sender": [{"COND_DOCTYPE": "BILLING_INV", "RESULT": "billing@corp.internal"}],
                "Form Template": [{"COND_DOCTYPE": "BILLING_INV", "RESULT": "SD_INVOICE_FORM"}],
                "Output Relevance": [{"COND_DOCTYPE": "BILLING_INV", "RESULT": "FALSE"}], # Suppressed!
            }
        }

        req = AnalysisRequest(
            job_id="11111111-2222-3333-4444-555555555556",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            raw_content=json.dumps(pipeline_json),
            artifact_type=ArtifactType.JSON,
            target_release="S4H_2023",
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        rule_ids = {f.rule_id for f in res.findings}
        assert "OPD_PRINTER_QUEUE_NOT_FOUND" in rule_ids
        assert "OPD_RELEVANCE_SUPPRESSED" in rule_ids

        printer_finding = next(f for f in res.findings if f.rule_id == "OPD_PRINTER_QUEUE_NOT_FOUND")
        assert printer_finding.severity == Severity.MAJOR

        rel_finding = next(f for f in res.findings if f.rule_id == "OPD_RELEVANCE_SUPPRESSED")
        assert rel_finding.severity == Severity.INFO


# =============================================================================
# PART 3: FormDoctor Engine Adversarial & Clean Core Tests
# =============================================================================

class TestFormDoctorAdversarial:
    """Empirical verification of FormDoctor XXE defense, Clean Core legacy detection, and XDP bindings."""

    @pytest.mark.asyncio
    async def test_form_doctor_xxe_payload_rejection(self):
        """Security Test: FormDoctor must reject XXE injection in XML payload and fail closed with FAILED status."""
        xxe_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE test [\n'
            '  <!ENTITY xxe SYSTEM "file:///etc/shadow">\n'
            ']>\n'
            '<Invoice><Header><InvoiceID>&xxe;</InvoiceID></Header></Invoice>'
        )

        req = AnalysisRequest(
            job_id="22222222-3333-4444-5555-666666666661",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=xxe_xml,
            artifact_type=ArtifactType.XML,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.FAILED
        assert res.error_message is not None
        assert "XML_PARSE_ERROR" in res.error_message
        assert "Malicious XML detected" in res.error_message or "Entities/DTD forbidden" in res.error_message

    @pytest.mark.asyncio
    async def test_form_doctor_xxe_in_xdp_template(self):
        """Security Test: FormDoctor must catch XXE inside XDP template and record FORM_XDP_PARSE_ERROR BLOCKER finding."""
        xxe_xdp = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE xdp:xdp [\n'
            '  <!ENTITY xxe SYSTEM "file:///etc/passwd">\n'
            ']>\n'
            '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template>&xxe;</template></xdp:xdp>'
        )

        req = AnalysisRequest(
            job_id="22222222-3333-4444-5555-666666666662",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            artifact_type=ArtifactType.XDP,
            artifacts=[
                ArtifactReference(file_name="malicious_template.xdp", artifact_type=ArtifactType.XDP, raw_content=xxe_xdp),
                ArtifactReference(file_name="valid_payload.xml", artifact_type=ArtifactType.XML, raw_content="<Invoice><ID>100</ID></Invoice>"),
            ],
        )

        res = await EngineRunner.execute(req)
        xdp_err_findings = [f for f in res.findings if f.rule_id == "FORM_XDP_PARSE_ERROR"]
        assert len(xdp_err_findings) == 1
        assert xdp_err_findings[0].severity == Severity.BLOCKER
        assert "Malicious XML detected" in xdp_err_findings[0].description

    @pytest.mark.asyncio
    async def test_form_doctor_deeply_nested_xml_and_binding_evaluation(self):
        """
        Structure Stress: Deeply nested XML (30 levels) and complex XDP bindings.
        Tests:
        1. Valid deep binding: $.Root.L1.L2...L29.TargetField
        2. Mismatched binding path (suggested match): $.WrongRoot.TargetField -> matches leaf TargetField
        3. Completely missing binding: $.Root.NonExistentLeaf
        4. Hidden field layout suppression: presence="hidden"
        """
        depth = 30
        xml_open = "".join(f"<Level{i}>\n" for i in range(depth))
        xml_close = "".join(f"</Level{i}>\n" for i in reversed(range(depth)))
        xml_payload = f"<Root>\n{xml_open}<TargetField>12345</TargetField>\n{xml_close}</Root>"

        valid_path = "$.Root." + ".".join(f"Level{i}" for i in range(depth)) + ".TargetField"

        xdp_template = f"""<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="RootForm">
      <field name="FldValid">
        <bind match="dataRef" ref="{valid_path}"/>
      </field>
      <field name="FldMismatch">
        <bind match="dataRef" ref="$.Alternative.TargetField"/>
      </field>
      <field name="FldMissing">
        <bind match="dataRef" ref="$.Root.CompletelyMissingField"/>
      </field>
      <field name="FldHidden" presence="hidden">
        <bind match="dataRef" ref="{valid_path}"/>
      </field>
    </subform>
  </template>
</xdp:xdp>"""

        req = AnalysisRequest(
            job_id="22222222-3333-4444-5555-666666666663",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            artifacts=[
                ArtifactReference(file_name="deep_template.xdp", artifact_type=ArtifactType.XDP, raw_content=xdp_template),
                ArtifactReference(file_name="deep_payload.xml", artifact_type=ArtifactType.XML, raw_content=xml_payload),
            ],
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        rule_ids = [f.rule_id for f in res.findings]
        assert "FORM_FIELD_HIDDEN_IN_LAYOUT" in rule_ids
        assert "FORM_BINDING_PATH_MISMATCH" in rule_ids
        assert "FORM_FIELD_MISSING_IN_XML" in rule_ids

        # Check metrics
        assert res.metrics.additional_metrics.get("totalBindingsChecked") == 4
        assert res.metrics.additional_metrics.get("validBindings") == 2
        assert res.metrics.additional_metrics.get("brokenBindings") == 2

        # Check mismatch finding technical details
        mismatch_f = next(f for f in res.findings if f.rule_id == "FORM_BINDING_PATH_MISMATCH")
        assert mismatch_f.technical_details.get("field") == "FldMismatch"
        assert mismatch_f.technical_details.get("suggestedBinding") == valid_path

    @pytest.mark.asyncio
    @pytest.mark.parametrize("pattern_text", [
        ("<smartform name='Z_INVOICE'><Header/></smartform>"),
        ("<?smartform format='xml'?><Root/>"),
    ])
    async def test_form_doctor_clean_core_smartforms_xml_detection(self, pattern_text):
        """Clean Core Test: XML-based SmartForms patterns trigger findings and scale severity on Cloud targets."""
        req_cloud = AnalysisRequest(
            job_id="22222222-3333-4444-5555-666666666664",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=pattern_text,
            artifact_type=ArtifactType.XML,
            target_release="S4HC_2502",
        )

        res_cloud = await EngineRunner.execute(req_cloud)
        findings = [f for f in res_cloud.findings if "Smart Form" in f.title or "SmartForm" in f.rule_id]
        assert len(findings) >= 1
        f = findings[0]
        assert f.severity == Severity.BLOCKER # On Cloud target
        assert f.confidence == ConfidenceClass.VERIFIED
        assert f.confidence_score == 1.0
        assert len(f.evidence) == 1
        assert len(f.evidence[0].sha256) == 64
        assert f.evidence[0].line_number >= 1

        # Test On-Premise severity scaling: Should be CRITICAL instead of BLOCKER
        req_onprem = AnalysisRequest(
            job_id="22222222-3333-4444-5555-666666666665",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=pattern_text,
            artifact_type=ArtifactType.XML,
            target_release="S4H_2023",
        )
        res_onprem = await EngineRunner.execute(req_onprem)
        f_onprem = [f for f in res_onprem.findings if "Smart Form" in f.title or "SmartForm" in f.rule_id][0]
        assert f_onprem.severity == Severity.CRITICAL

    @pytest.mark.asyncio
    @pytest.mark.parametrize("sapscript_line", [
        ("/: DEFINE &MY_VAR& = 'VALUE'"),
        ("/: INCLUDE &Z_HEADER_TEXT& OBJECT TEXT ID ST"),
        ("/: SET COUNTRY 'DE'"),
        ("/: NEW-PAGE"),
    ])
    async def test_form_doctor_clean_core_sapscript_command_detection(self, sapscript_line):
        """Clean Core Test: Verify classic SAPscript /: ITF commands trigger findings and scale severity."""
        raw_text = f"HEADER TEXT\n{sapscript_line}\nFOOTER TEXT"

        req = AnalysisRequest(
            job_id="22222222-3333-4444-5555-666666666666",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=raw_text,
            artifact_type=ArtifactType.TXT,
            target_release="S4HC_2502",
        )

        res = await EngineRunner.execute(req)
        sapscript_findings = [f for f in res.findings if "SAPscript" in f.title or "SAPSCRIPT" in f.rule_id]
        assert len(sapscript_findings) >= 1
        f = sapscript_findings[0]
        assert f.severity == Severity.BLOCKER # On Cloud target
        assert f.confidence == ConfidenceClass.VERIFIED
        assert f.confidence_score == 1.0
        assert f.technical_details.get("cleanCoreTier") == "TIER_3_PROHIBITED"
        assert len(f.evidence) == 1
        assert len(f.evidence[0].sha256) == 64


# =============================================================================
# PART 4: Empirical Defect Verification Tests (Proving Identified Bugs)
# =============================================================================

class TestEmpiricalDefectsVerification:
    """
    Empirical tests explicitly proving the 4 confirmed bugs/limitations in Domain 1 implementations.
    These tests demonstrate the exact failure mode under adversarial conditions.
    """

    @pytest.mark.asyncio
    async def test_defect_1_txt_artifact_causes_xml_parse_failure(self):
        """
        DEFECT 1 PROOF:
        FormDoctor Engine attempts to parse plain text .txt files as XML in step 4,
        causing status=FAILED with XML_PARSE_ERROR instead of completing cleanly.
        """
        sapscript_text = "/: DEFINE &MY_VAR& = 'VALUE'\n/: SET COUNTRY 'DE'"

        req = AnalysisRequest(
            job_id="33333333-1111-1111-1111-111111111111",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            artifact_type=ArtifactType.TXT,
            artifacts=[
                ArtifactReference(file_name="form_script.txt", artifact_type=ArtifactType.TXT, raw_content=sapscript_text)
            ],
            target_release="S4HC_2502",
        )

        res = await FormDoctorEngine().analyze(req)
        # REMEDIATION VERIFICATION: Plain text .txt is not fed to XML parser; status=COMPLETED
        assert res.status == AnalysisStatus.COMPLETED
        assert res.error_message is None
        assert len(res.findings) >= 1

    @pytest.mark.asyncio
    async def test_defect_2_raw_content_drops_driver_and_non_colon_sapscript(self):
        """
        DEFECT 2 PROOF:
        FormDoctor Engine _extract_payloads ignores raw_content if it lacks '<smartform', '/:', or leading '<'.
        Thus, driver ABAP programs ('CALL FUNCTION SSF_...') or SAPscript comments ('/*...') in raw_content
        are silently discarded with 0 findings emitted.
        """
        abap_driver = "REPORT Z_TEST.\nCALL FUNCTION 'SSF_FUNCTION_MODULE_NAME' EXPORTING form_name = 'Z_FORM'."

        req = AnalysisRequest(
            job_id="33333333-2222-2222-2222-222222222222",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=abap_driver,
            artifact_type=ArtifactType.TXT,
            target_release="S4HC_2502",
        )

        res = await FormDoctorEngine().analyze(req)
        # REMEDIATION VERIFICATION: raw_content ABAP driver is detected; findings emitted
        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) >= 1

    def test_defect_3_regex_word_boundary_percent_page_never_matches(self):
        r"""
        DEFECT 3 PROOF:
        In SMARTFORM_PATTERNS item 5:
        r"(?:^|[\s<>])(%PAGE|%WINDOW|%TEXT)\b"
        Verify the production pattern correctly matches %PAGE, %WINDOW, and %TEXT with preceding whitespace/tags.
        """
        pattern = FormDoctorEngine.SMARTFORM_PATTERNS[4][0]

        # Standard text with whitespace or tag before % now matches cleanly
        assert pattern.search(" <node>%PAGE 1</node> ") is not None
        assert pattern.search(" %WINDOW MAIN ") is not None
        assert pattern.search("%TEXT 01") is not None

    def test_defect_4_sapscript_finding_rule_id_taxonomy_mismatch(self):
        """
        DEFECT 4 PROOF:
        In form_doctor.py, SAPscript detection must emit:
          rule_id = 'FORM_LEGACY_SAPSCRIPT_DETECTED'
          title = 'Legacy SAPscript Form Detected (Clean Core Tier 3 Violation)'
        """
        sapscript_text = "/: DEFINE &VAR& = '1'"
        engine = FormDoctorEngine()
        findings = engine._audit_legacy_forms(sapscript_text, "", "script.txt", "S4HC_2502")

        assert len(findings) == 1
        finding = findings[0]
        # Title says SAPscript
        assert "SAPscript" in finding.title
        # REMEDIATION VERIFICATION: rule_id is correctly FORM_LEGACY_SAPSCRIPT_DETECTED
        assert finding.rule_id == "FORM_LEGACY_SAPSCRIPT_DETECTED"


# =============================================================================
# Standalone CLI Test Runner for Autonomous Execution & Diagnostics
# =============================================================================

def run_all_adversarial_tests() -> int:
    print("=" * 80)
    print("RUNNING ADVERSARIAL STRESS TEST SUITE FOR OPD GUARD & FORMDOCTOR")
    print("=" * 80)

    pytest_args = [
        __file__,
        "-v",
        "-s",
        "--tb=short",
    ]
    exit_code = pytest.main(pytest_args)
    print("\n" + "=" * 80)
    print(f"ADVERSARIAL STRESS SUITE COMPLETED WITH EXIT CODE: {exit_code}")
    print("=" * 80)
    return exit_code


if __name__ == "__main__":
    sys.exit(run_all_adversarial_tests())
