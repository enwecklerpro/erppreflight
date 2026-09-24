"""
ERP Preflight — Domain 1 Output & Extensibility Engines Pytest Suite
Engines Covered:
1. OPD Guard (OPD_GUARD)
2. FormDoctor (FORM_DOCTOR)
3. Custom Field Flow Doctor (CUSTOM_FIELD_FLOW_DOCTOR)
4. Extension Impact Guard (EXTENSION_IMPACT_GUARD)

Governing Standard: AGENTS.md, engine-authoring.md, sap-evidence.md
"""

import hashlib
import json
import os
from pathlib import Path
import pytest
import random
from typing import Dict, Any, List

from src.core.runner import EngineRunner
from src.core.registry import EngineRegistry
from src.models.enums import EngineType, AnalysisStatus, Severity, ConfidenceClass, ArtifactType, TrustLevel
from src.models.request import AnalysisRequest, ArtifactReference
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.platform.confidence import ConfidenceClassifier


FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "domain1"


# Helper function to read fixture file safely
def load_fixture(filename: str) -> str:
    fixture_path = FIXTURE_DIR / filename
    if fixture_path.exists():
        return fixture_path.read_text(encoding="utf-8")
    # Graceful fallback to inline defaults for isolated test runner environments
    return get_inline_fixture_fallback(filename)


def get_inline_fixture_fallback(filename: str) -> str:
    """Provides inline fallback if fixtures directory has not been populated on disk."""
    if filename == "opd_decision_table.csv":
        return (
            "Step,COND_DocumentType,COND_PurchasingOrg,COND_CompanyCode,COND_Supplier,COND_Channel,RESULT\n"
            "Output Type,NB,*,*,*,*,PURCHASE_ORDER\n"
            "Receiver,NB,*,*,*,*,SUPPLIER_100045\n"
            "Channel,NB,*,*,*,*,EMAIL\n"
            "Printer,NB,*,*,*,PRINT,LP01\n"
            "Email Recipient,*,DE01,*,100045,*,orders@supplier45.de\n"
            "Email Sender,*,*,1000,*,*,procurement@acme.corp\n"
            "Form Template,NB,*,*,*,*,MM_PURCHASE_ORDER_DEFAULT\n"
            "Output Relevance,NB,*,*,*,*,TRUE\n"
        )
    elif filename == "opd_scenario_valid.json":
        return json.dumps({
            "scenario": {"DocumentType": "NB", "CompanyCode": "1000", "PurchasingOrg": "DE01", "Supplier": "100045"},
            "tables": {
                "Output Type": [{"COND_DocumentType": "NB", "RESULT": "PURCHASE_ORDER"}],
                "Receiver": [{"COND_DocumentType": "NB", "RESULT": "SUPPLIER_100045"}],
                "Channel": [{"COND_DocumentType": "NB", "RESULT": "EMAIL"}],
                "Printer": [{"COND_DocumentType": "NB", "RESULT": "LP01"}],
                "Email Recipient": [{"COND_PurchasingOrg": "DE01", "COND_Supplier": "100045", "RESULT": "orders@supplier45.de"}],
                "Email Sender": [{"COND_CompanyCode": "1000", "RESULT": "procurement@acme.corp"}],
                "Form Template": [{"COND_DocumentType": "NB", "RESULT": "MM_PURCHASE_ORDER_DEFAULT"}],
                "Output Relevance": [{"COND_DocumentType": "NB", "RESULT": "TRUE"}]
            }
        })
    elif filename == "opd_scenario_shadowed.json":
        return json.dumps({
            "tables": {
                "Channel": [
                    {"COND_DocumentType": "*", "RESULT": "PRINT"},
                    {"COND_DocumentType": "NB", "RESULT": "EMAIL"},
                    {"COND_DocumentType": "FO", "RESULT": "EDI"}
                ]
            }
        })
    elif filename == "opd_scenario_missing_channel.json":
        return json.dumps({
            "scenario": {"DocumentType": "NB", "CompanyCode": "1000", "PurchasingOrg": "US01", "Supplier": "999999"},
            "tables": {
                "Output Type": [{"COND_DocumentType": "NB", "RESULT": "PURCHASE_ORDER"}],
                "Receiver": [{"COND_DocumentType": "NB", "RESULT": "SUPPLIER_999999"}],
                "Channel": [{"COND_DocumentType": "NB", "RESULT": "EMAIL"}],
                "Printer": [{"COND_DocumentType": "NB", "RESULT": "LP01"}],
                "Email Recipient": [{"COND_PurchasingOrg": "DE01", "COND_Supplier": "100045", "RESULT": "orders@supplier45.de"}],
                "Email Sender": [{"COND_CompanyCode": "1000", "RESULT": "procurement@acme.corp"}],
                "Form Template": [{"COND_DocumentType": "NB", "RESULT": "MM_PURCHASE_ORDER_DEFAULT"}],
                "Output Relevance": [{"COND_DocumentType": "NB", "RESULT": "TRUE"}]
            }
        })
    elif filename == "form_data_valid.xml":
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Invoice>\n'
            '    <Header>\n'
            '        <InvoiceID>90001234</InvoiceID>\n'
            '        <Supplier><ID>100045</ID><TaxNumber>DE123456789</TaxNumber></Supplier>\n'
            '        <TotalAmount Currency="EUR">14250.00</TotalAmount>\n'
            '    </Header>\n'
            '</Invoice>\n'
        )
    elif filename == "form_template_xdp.xml":
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">\n'
            '    <template>\n'
            '        <subform name="InvoiceForm" dataRef="$.Invoice">\n'
            '            <field name="InvoiceNum"><bind match="dataRef" ref="$.Header.InvoiceID"/></field>\n'
            '            <field name="SupplierTax"><bind match="dataRef" ref="$.Header.Supplier.TaxNumber"/></field>\n'
            '        </subform>\n'
            '    </template>\n'
            '</xdp:xdp>\n'
        )
    elif filename == "form_data_missing_field.xml":
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Invoice>\n'
            '    <Header>\n'
            '        <InvoiceID>90001234</InvoiceID>\n'
            '        <Supplier><ID>100045</ID></Supplier>\n'
            '    </Header>\n'
            '</Invoice>\n'
        )
    elif filename == "form_legacy_smartform.xml":
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<SMARTFORM name="/1BCDWB/SF00000042">\n'
            '    <HEADER><FORMNAME>Z_PURCHASE_ORDER_LEGACY</FORMNAME></HEADER>\n'
            '    <WINDOWS><WINDOW name="MAIN" type="MAIN"/></WINDOWS>\n'
            '</SMARTFORM>\n'
        )
    elif filename == "custom_field_registry.json":
        return json.dumps({
            "field_name": "YY1_PROJECT_CODE",
            "hops": [
                ["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"],
                ["MM_SUPPLIER_INVOICE_ITEM", "FI_JOURNAL_ENTRY_ITEM"]
            ],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 20},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 20},
                "FI_JOURNAL_ENTRY_ITEM": {"type": "CHAR", "length": 20}
            }
        })
    elif filename == "custom_field_type_mismatch.json":
        return json.dumps({
            "field_name": "YY1_LONG_DESC",
            "hops": [["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"]],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 50},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 20}
            }
        })
    elif filename == "extension_manifest.json":
        return json.dumps({
            "dependencies": {
                "YY1_PROJECT_CODE": ["CDS_PURCHASE_ORDERS", "FORM_PURCHASE_ORDER"],
                "CDS_PURCHASE_ORDERS": ["API_PURCHASING_ANALYTICS"],
                "FORM_PURCHASE_ORDER": [],
                "API_PURCHASING_ANALYTICS": [],
                "YY1_UNUSED_OBSOLETE_FIELD": []
            }
        })
    elif filename == "extension_cycle.json":
        return json.dumps({
            "dependencies": {
                "CDS_VIEW_HEADER": ["CDS_VIEW_ITEMS"],
                "CDS_VIEW_ITEMS": ["CDS_VIEW_BILLING"],
                "CDS_VIEW_BILLING": ["CDS_VIEW_HEADER"]
            }
        })
    return "{}"


# ==============================================================================
# 1. OPD Guard Engine Test Suite
# ==============================================================================

class TestOPDGuardEngine:
    """Test suite verifying S/4HANA Output Parameter Determination rules."""

    @pytest.mark.asyncio
    async def test_opd_guard_valid_scenario_success(self):
        """Positive Test: All 8 determination steps resolve cleanly."""
        payload_content = load_fixture("opd_scenario_valid.json")
        req = AnalysisRequest(
            job_id="11111111-1111-1111-1111-111111111111",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            target_release="S4HC_2408",
            raw_content=payload_content,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        assert res.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL)
        assert res.engine_type == EngineType.OPD_GUARD
        assert res.metrics.rules_evaluated >= 8
        assert res.metrics.execution_time_ms >= 0

        # Assert no BLOCKER or CRITICAL findings in clean golden scenario
        blockers = [f for f in res.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]
        assert len(blockers) == 0

    @pytest.mark.asyncio
    async def test_opd_guard_shadowed_rule_detected(self):
        """Negative/Edge Test: Wildcard condition shadows subsequent specific rules."""
        payload_content = load_fixture("opd_scenario_shadowed.json")
        req = AnalysisRequest(
            job_id="11111111-1111-1111-1111-111111111112",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            raw_content=payload_content,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        shadowed_findings = [f for f in res.findings if f.rule_id == "OPD_UNREACHABLE_RULE"]
        assert len(shadowed_findings) >= 1
        finding = shadowed_findings[0]
        assert finding.severity in (Severity.MAJOR, Severity.MINOR)
        assert finding.confidence == ConfidenceClass.RULE_DERIVED
        assert finding.confidence_score == 0.85
        assert "BRFplus" in finding.remediation or "Reorder" in finding.remediation

        # Assert evidence cryptographic hash is present and valid
        assert len(finding.evidence) >= 1
        ev = finding.evidence[0]
        assert len(ev.sha256) == 64
        assert ev.line_number is not None and ev.line_number >= 1

    @pytest.mark.asyncio
    async def test_opd_guard_missing_recipient_step_failed(self):
        """Negative Test: Unmatched scenario triggers OPD_STEP_FAILED."""
        payload_content = load_fixture("opd_scenario_missing_channel.json")
        req = AnalysisRequest(
            job_id="11111111-1111-1111-1111-111111111113",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            raw_content=payload_content,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        failed_findings = [f for f in res.findings if f.rule_id == "OPD_STEP_FAILED"]
        assert len(failed_findings) >= 1
        finding = failed_findings[0]
        assert finding.severity in (Severity.CRITICAL, Severity.MAJOR)
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert finding.confidence_score == 1.0
        assert "Email Recipient" in finding.title or "Email Recipient" in finding.description
        assert len(finding.remediation) > 0

    @pytest.mark.asyncio
    async def test_opd_guard_property_based_fuzz(self):
        """Property-Based Test: Arbitrary random condition keys fail closed without crash."""
        rng = random.Random(42)
        for i in range(15):
            random_key = f"COND_RND_{rng.randint(1000, 9999)}"
            random_val = f"VAL_{rng.choice(['NB', 'FO', 'UB', 'KR', '*'])}"
            fuzz_payload = json.dumps({
                "scenario": {"DocumentType": "NB"},
                "tables": {
                    "Output Type": [{random_key: random_val, "RESULT": "ORDER"}]
                }
            })

            req = AnalysisRequest(
                job_id=f"ffffffff-0000-0000-0000-{i:012x}",
                tenant_id="22222222-2222-2222-2222-222222222222",
                project_id="33333333-3333-3333-3333-333333333333",
                engine_type=EngineType.OPD_GUARD,
                raw_content=fuzz_payload,
            )
            res = await EngineRunner.execute(req)
            assert res.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL, AnalysisStatus.FAILED)

    def test_opd_guard_interval_subsumption(self):
        """Interval Subsumption: Numerical ranges [low..high] subsume sub-intervals and discrete values."""
        from src.engines.opd_guard import OPDGuardEngine

        # Subsumption of sub-range
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[2000..3000]") is True
        # Subsumption of discrete point inside
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "2500") is True
        # Subsumption of comma-separated numbers inside
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "1500, 3000, 4500") is True
        # Non-containment
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[500..3000]") is False
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "999") is False
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "5001") is False


# ==============================================================================
# 2. FormDoctor Engine Test Suite
# ==============================================================================

class TestFormDoctorEngine:
    """Test suite verifying Adobe Form XDP bindings and Clean Core compliance."""

    @pytest.mark.asyncio
    async def test_form_doctor_valid_bindings_success(self):
        """Positive Test: All bindings match XML payload paths cleanly."""
        xml_content = load_fixture("form_data_valid.xml")
        xdp_content = load_fixture("form_template_xdp.xml")

        req = AnalysisRequest(
            job_id="22222222-1111-1111-1111-111111111111",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=xml_content,
            configuration={"xdp_content": xdp_content},
            artifact_type=ArtifactType.XML,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        broken_bindings = [f for f in res.findings if f.rule_id in ("FORM_FIELD_MISSING_IN_XML", "FORM_BINDING_PATH_MISMATCH")]
        assert len(broken_bindings) == 0

    @pytest.mark.asyncio
    async def test_form_doctor_missing_field_in_xml(self):
        """Negative Test: Bound field missing in runtime XML payload."""
        xml_missing = load_fixture("form_data_missing_field.xml")
        xdp_content = load_fixture("form_template_xdp.xml")

        req = AnalysisRequest(
            job_id="22222222-1111-1111-1111-111111111112",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=xml_missing,
            configuration={"xdp_content": xdp_content},
            artifact_type=ArtifactType.XML,
        )

        res = await EngineRunner.execute(req)
        missing_findings = [f for f in res.findings if f.rule_id == "FORM_FIELD_MISSING_IN_XML"]
        assert len(missing_findings) >= 1
        finding = missing_findings[0]
        assert finding.severity == Severity.CRITICAL
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert "TaxNumber" in finding.title or "TaxNumber" in finding.description
        assert len(finding.evidence) >= 1
        assert finding.evidence[0].sha256 != ""

    @pytest.mark.asyncio
    async def test_form_doctor_legacy_smartform_detected(self):
        """Clean Core Test: Legacy SmartForm detected and blocked for Cloud migration."""
        smartform_xml = load_fixture("form_legacy_smartform.xml")

        req = AnalysisRequest(
            job_id="22222222-1111-1111-1111-111111111113",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=smartform_xml,
            target_release="S4HC_2502",
            artifact_type=ArtifactType.XML,
        )

        res = await EngineRunner.execute(req)
        legacy_findings = [f for f in res.findings if f.rule_id == "FORM_LEGACY_SMARTFORM_DETECTED"]
        assert len(legacy_findings) >= 1
        finding = legacy_findings[0]
        assert finding.severity == Severity.BLOCKER
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert "Adobe Forms" in finding.remediation or "XDP" in finding.remediation

    @pytest.mark.asyncio
    async def test_form_doctor_xxe_security_defense(self):
        """Security Invariant Test: DefusedXML rejects XML with DOCTYPE/Entity attacks."""
        malicious_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE test [\n'
            '  <!ENTITY xxe SYSTEM "file:///etc/passwd">\n'
            ']>\n'
            '<Invoice><Header><InvoiceID>&xxe;</InvoiceID></Header></Invoice>'
        )

        req = AnalysisRequest(
            job_id="22222222-1111-1111-1111-111111111114",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=malicious_xml,
        )

        # EngineRunner must fail closed or catch security error
        res = await EngineRunner.execute(req)
        assert res.status in (AnalysisStatus.FAILED, AnalysisStatus.COMPLETED)
        # In all cases, no unredacted system file contents leaked
        assert "/etc/passwd" not in str(res)

    @pytest.mark.asyncio
    async def test_form_doctor_txt_sapscript_success(self):
        """Plain text .txt with SAPscript must not fail XML parsing; completes and emits SAPscript finding."""
        sapscript_text = "/: DEFINE &MY_VAR& = 'VALUE'\n/: SET COUNTRY 'DE'"
        req = AnalysisRequest(
            job_id="22222222-1111-1111-1111-111111111115",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            artifact_type=ArtifactType.TXT,
            artifacts=[
                ArtifactReference(file_name="form_script.txt", artifact_type=ArtifactType.TXT, raw_content=sapscript_text)
            ],
            target_release="S4HC_2502",
        )
        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert res.error_message is None
        sapscript_findings = [f for f in res.findings if f.rule_id == "FORM_LEGACY_SAPSCRIPT_DETECTED"]
        assert len(sapscript_findings) >= 1
        assert sapscript_findings[0].severity == Severity.BLOCKER

    @pytest.mark.asyncio
    async def test_form_doctor_raw_content_abap_driver_detected(self):
        """ABAP driver code with SSF_FUNCTION_MODULE_NAME in raw_content is recognized and audited."""
        abap_driver = "REPORT Z_TEST.\nCALL FUNCTION 'SSF_FUNCTION_MODULE_NAME' EXPORTING form_name = 'Z_FORM'."
        req = AnalysisRequest(
            job_id="22222222-1111-1111-1111-111111111116",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=abap_driver,
            artifact_type=ArtifactType.TXT,
            target_release="S4HC_2502",
        )
        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        smartform_findings = [f for f in res.findings if f.rule_id == "FORM_LEGACY_SMARTFORM_DETECTED"]
        assert len(smartform_findings) >= 1

    def test_form_doctor_smartforms_percent_elements_pattern(self):
        """SmartForms internal elements regex matches %PAGE, %WINDOW, %TEXT with whitespace or tags."""
        from src.engines.form_doctor import FormDoctorEngine
        pattern = FormDoctorEngine.SMARTFORM_PATTERNS[4][0]
        assert pattern.search(" <node>%PAGE 1</node> ") is not None
        assert pattern.search(" %WINDOW MAIN ") is not None
        assert pattern.search("%TEXT 01") is not None



# ==============================================================================
# 3. Custom Field Flow Doctor Engine Test Suite
# ==============================================================================

class TestCustomFieldFlowDoctorEngine:
    """Test suite verifying key-user custom field document flow propagation."""

    @pytest.mark.asyncio
    async def test_custom_field_flow_requires_badi(self):
        """Standard Hop Test: PO -> Invoice is supported; Invoice -> GL requires BAdI."""
        payload = load_fixture("custom_field_registry.json")

        req = AnalysisRequest(
            job_id="33333333-1111-1111-1111-111111111111",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=payload,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        badi_findings = [f for f in res.findings if f.rule_id in ("FIELD_PROPAGATION_REQUIRES_BADI", "FIELD_BADI_REQUIRED_NOT_FOUND")]
        assert len(badi_findings) >= 1
        finding = badi_findings[0]
        assert finding.severity in (Severity.MAJOR, Severity.MINOR, Severity.INFO)
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert "BADI_FINS_ACDOC_EXT_PERSISTENCE" in finding.description or "BADI_FINS_ACDOC_EXT_PERSISTENCE" in finding.remediation

    @pytest.mark.asyncio
    async def test_custom_field_flow_type_truncation(self):
        """Negative Test: Length 50 -> Length 20 truncation triggers FIELD_TYPE_MISMATCH."""
        payload = load_fixture("custom_field_type_mismatch.json")

        req = AnalysisRequest(
            job_id="33333333-1111-1111-1111-111111111112",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=payload,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        truncation_findings = [f for f in res.findings if f.rule_id == "FIELD_TYPE_MISMATCH"]
        assert len(truncation_findings) >= 1
        finding = truncation_findings[0]
        assert finding.severity in (Severity.CRITICAL, Severity.MAJOR)
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert "length" in finding.description.lower() or "truncation" in finding.description.lower()
        assert len(finding.evidence) >= 1
        assert finding.evidence[0].sha256 != ""

    @pytest.mark.asyncio
    async def test_custom_field_flow_blocked_hop(self):
        """Negative Test: Architecturally separated contexts trigger FIELD_PROPAGATION_BLOCKED."""
        blocked_payload = json.dumps({
            "field_name": "YY1_DISCONNECTED",
            "hops": [["MM_PURCHASE_ORDER_ITEM", "HR_PERSONNEL_DATA"]],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 10},
                "HR_PERSONNEL_DATA": {"type": "CHAR", "length": 10}
            }
        })

        req = AnalysisRequest(
            job_id="33333333-1111-1111-1111-111111111113",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=blocked_payload,
        )

        res = await EngineRunner.execute(req)
        blocked_findings = [f for f in res.findings if f.rule_id == "FIELD_PROPAGATION_BLOCKED"]
        assert len(blocked_findings) >= 1
        assert blocked_findings[0].severity in (Severity.CRITICAL, Severity.MAJOR)


# ==============================================================================
# 4. Extension Impact Guard Engine Test Suite
# ==============================================================================

class TestExtensionImpactGuardEngine:
    """Test suite verifying blast radius and safe-to-delete dependency closure."""

    @pytest.mark.asyncio
    async def test_extension_impact_active_delete_blocked(self):
        """Negative Test: Active field consumed by CDS and Form blocks deletion."""
        manifest = load_fixture("extension_manifest.json")

        req = AnalysisRequest(
            job_id="44444444-1111-1111-1111-111111111111",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=manifest,
            configuration={"target_object": "YY1_PROJECT_CODE"},
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        blocked_findings = [f for f in res.findings if f.rule_id == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS"]
        assert len(blocked_findings) >= 1
        finding = blocked_findings[0]
        assert finding.severity == Severity.CRITICAL
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert "YY1_PROJECT_CODE" in finding.title or "YY1_PROJECT_CODE" in finding.description
        assert len(finding.evidence) >= 1
        assert finding.evidence[0].sha256 != ""

    @pytest.mark.asyncio
    async def test_extension_impact_isolated_safe_to_delete(self):
        """Positive Test: Isolated obsolete field with 0 consumers is safe to delete."""
        manifest = load_fixture("extension_manifest.json")

        req = AnalysisRequest(
            job_id="44444444-1111-1111-1111-111111111112",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=manifest,
            configuration={"target_object": "YY1_UNUSED_OBSOLETE_FIELD"},
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        # Must have zero blocker/critical deletion findings
        deletion_blockers = [f for f in res.findings if f.rule_id == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS"]
        assert len(deletion_blockers) == 0

    @pytest.mark.asyncio
    async def test_extension_impact_cyclic_dependency_detected(self):
        """Negative Test: Cyclic dependency between CDS views detected."""
        cycle_manifest = load_fixture("extension_cycle.json")

        req = AnalysisRequest(
            job_id="44444444-1111-1111-1111-111111111113",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=cycle_manifest,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        cycle_findings = [f for f in res.findings if f.rule_id == "EXT_CYCLIC_DEPENDENCY_DETECTED"]
        assert len(cycle_findings) >= 1
        finding = cycle_findings[0]
        assert finding.severity in (Severity.CRITICAL, Severity.BLOCKER)
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert "cycle" in finding.description.lower() or "circular" in finding.description.lower()


# ==============================================================================
# 5. Cross-Engine Epistemic & Evidence Invariants Quality Gate
# ==============================================================================

class TestDomain1EpistemicInvariants:
    """Verifies that all findings emitted across Domain 1 conform to Cardinal Axiom 2."""

    def test_missing_evidence_demotes_unconditionally_to_unknown(self):
        """Invariant: If evidence is missing, confidence is demoted to UNKNOWN (0.30)."""
        finding = Finding(
            rule_id="OPD_TEST_RULE",
            severity=Severity.MAJOR,
            category="OUTPUT",
            title="Finding without evidence",
            description="Lacks evidence pointer",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Add evidence",
            evidence=[],
        )

        classified = ConfidenceClassifier.classify(finding, missing_evidence=True)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score == 0.30

    def test_ai_generated_finding_cannot_exceed_inferred(self):
        """Invariant: AI involvement caps confidence at INFERRED (0.60)."""
        finding = Finding(
            rule_id="FORM_AI_EXPLANATION",
            severity=Severity.MINOR,
            category="EXPLANATION",
            title="AI generated explanation",
            description="Probabilistic note",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Review recommendation",
            evidence=[
                Evidence(
                    artifact_path="form.xdp",
                    line_number=10,
                    snippet="<subform>",
                    sha256="a" * 64,
                    provenance=ConfidenceClass.VERIFIED,
                    trust_score=1.0,
                )
            ],
            is_ai_generated=True,
        )

        classified = ConfidenceClassifier.classify(finding, is_ai_generated=True)
        assert classified.confidence == ConfidenceClass.INFERRED
        assert classified.confidence_score <= 0.60

    def test_evidence_sha256_reproducibility(self):
        """Invariant: Evidence SHA-256 matches exact hashlib digest of snippet."""
        snippet = '<field name="SupplierTax"><bind match="dataRef" ref="$.Header.Supplier.TaxNumber"/></field>'
        expected_hash = hashlib.sha256(snippet.encode("utf-8")).hexdigest()

        ev = Evidence(
            artifact_path="form_template_xdp.xml",
            line_number=8,
            column_number=13,
            snippet=snippet,
            sha256=expected_hash,
            provenance=ConfidenceClass.VERIFIED,
            trust_score=1.0,
        )

        assert ev.sha256 == expected_hash
        assert len(ev.sha256) == 64
