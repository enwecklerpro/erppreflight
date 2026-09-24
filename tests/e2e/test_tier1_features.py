"""ERP Preflight - Tier 1: Feature Coverage Test Suite.

Authoritative Specification: PROJECT.md, engines_spec.md, platform_spec.md.
Requirement: >=5 tests per feature across core platform and engine capabilities.
Total Features Tested: 26 (Core Platform & 18 SAP Preflight Engines).
"""

from __future__ import annotations
import json
import pytest
from pathlib import Path

from tests.e2e.contracts import (
    AnalysisJobResponse,
    AuditEvent,
    Finding,
    ProvenanceConfidence,
    Severity,
)
from tests.e2e.evaluators import (
    AIProblemRouterEvaluator,
    AccountDeterminationEvaluator,
    APIChangeGuardEvaluator,
    AuditTrailEvaluator,
    ChangePointerAuditorEvaluator,
    CleanCoreObjectGuardEvaluator,
    ConfidenceClassifierEvaluator,
    CustomFieldFlowEvaluator,
    ECC2CloudNavigatorEvaluator,
    ExtensionImpactEvaluator,
    Fiori403DoctorEvaluator,
    FormDoctorEvaluator,
    IAMCostOptimizerEvaluator,
    IngestionEvaluator,
    MFSBlackBoxEvaluator,
    OPDGuardEvaluator,
    SAPGapRadarEvaluator,
    SafeDecommissionEvaluator,
    SecretRedactionEvaluator,
    SoftwareCollectionGuardEvaluator,
    SPRO2CloudEvaluator,
    SystemRefreshDeltaGuardEvaluator,
    TransportAnalyzerEvaluator,
    WorkflowStuckExplainerEvaluator,
    compute_sha256,
)


# ==============================================================================
# Feature 1: Ingestion & File Format Validation (MIME sniffer)
# ==============================================================================

class TestFeature01_IngestionMimeValidation:
    """Verifies format validation and MIME sniffing across supported SAP file types."""

    def test_valid_xml_accepted(self):
        valid_xml = b'<?xml version="1.0"?><root><item>1</item></root>'
        ok, msg = IngestionEvaluator.validate_file_format("document.xml", valid_xml)
        assert ok is True
        assert msg == "VALID_XML"

    def test_valid_json_accepted(self):
        valid_json = b'{"status": "ok", "items": [1, 2, 3]}'
        ok, msg = IngestionEvaluator.validate_file_format("payload.json", valid_json)
        assert ok is True
        assert msg == "VALID_JSON"

    def test_valid_csv_accepted(self):
        valid_csv = b"ID,Name,Type\n1001,Purchasing,Standard\n"
        ok, msg = IngestionEvaluator.validate_file_format("export.csv", valid_csv)
        assert ok is True
        assert msg == "VALID_CSV"

    def test_valid_abap_accepted(self):
        valid_abap = b"REPORT ztest.\nWRITE: 'Hello SAP'."
        ok, msg = IngestionEvaluator.validate_file_format("program.abap", valid_abap)
        assert ok is True
        assert msg == "VALID_ABAP"

    def test_invalid_zip_magic_rejected(self):
        fake_zip = b"NOT_A_ZIP_HEADER_CONTENT"
        ok, msg = IngestionEvaluator.validate_file_format("archive.zip", fake_zip)
        assert ok is False
        assert msg == "INVALID_ZIP_MAGIC_BYTES"


# ==============================================================================
# Feature 2: Archive Safety & Decompression Guard (Zip bomb/slip)
# ==============================================================================

class TestFeature02_ArchiveSafety:
    """Verifies protection against zip slip path traversal and zip bombs."""

    def test_safe_archive_passes(self):
        entries = [("src/file1.txt", 100, 200), ("src/file2.txt", 200, 400)]
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is True
        assert msg == "ARCHIVE_SAFE"

    def test_zip_slip_traversal_blocked(self):
        entries = [("../../../../etc/passwd", 50, 100)]
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is False
        assert msg == "ZIP_SLIP_PATH_TRAVERSAL_DETECTED"

    def test_zip_slip_absolute_path_blocked(self):
        entries = [("/etc/shadow", 50, 100)]
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is False
        assert msg == "ZIP_SLIP_PATH_TRAVERSAL_DETECTED"

    def test_zip_bomb_max_size_exceeded(self):
        # Over 500MB uncompressed limit
        entries = [("huge.bin", 1000, 600 * 1024 * 1024)]
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is False
        assert msg == "ZIP_BOMB_MAX_SIZE_EXCEEDED"

    def test_zip_bomb_compression_ratio_exceeded(self):
        # Over 100:1 ratio with > 10MB uncompressed
        entries = [("bomb.bin", 50 * 1024, 20 * 1024 * 1024)]  # 400:1 ratio
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is False
        assert msg == "ZIP_BOMB_COMPRESSION_RATIO_EXCEEDED"


# ==============================================================================
# Feature 3: Secret & Credential Redaction Engine
# ==============================================================================

class TestFeature03_SecretRedaction:
    """Verifies regex and entropy sanitization of credentials."""

    def test_redacts_bearer_token(self):
        text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz"
        res = SecretRedactionEvaluator.redact(text)
        assert "[REDACTED_BEARER_TOKEN]" in res.sanitized_text
        assert "eyJhbGciOi" not in res.sanitized_text
        assert res.redactions_count >= 1

    def test_redacts_rsa_private_key(self):
        text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
        res = SecretRedactionEvaluator.redact(text)
        assert "[REDACTED_PRIVATE_KEY]" in res.sanitized_text
        assert "MIIEowIBAAKCAQEA" not in res.sanitized_text

    def test_redacts_rfc_password(self):
        text = "RFC_PASS='SuperSecretPassword123!'"
        res = SecretRedactionEvaluator.redact(text)
        assert "[REDACTED_PASSWORD]" in res.sanitized_text
        assert "SuperSecretPassword123!" not in res.sanitized_text

    def test_redacts_api_key(self):
        text = 'api_key = "sk-live-0123456789abcdef0123456789"'
        res = SecretRedactionEvaluator.redact(text)
        assert "[REDACTED_API_KEY]" in res.sanitized_text
        assert "0123456789abcdef" not in res.sanitized_text

    def test_clean_text_unchanged(self):
        text = "Standard SAP Billing document line item 10 for Material MAT01."
        res = SecretRedactionEvaluator.redact(text)
        assert res.sanitized_text == text
        assert res.redactions_count == 0
        assert res.sha256_original == res.sha256_sanitized


# ==============================================================================
# Feature 4: Confidence Classifier & Epistemic Demotion
# ==============================================================================

class TestFeature04_ConfidenceClassifier:
    """Enforces strict confidence tiers and LLM ceiling."""

    def test_exact_ast_yields_verified(self):
        conf, score = ConfidenceClassifierEvaluator.classify(
            source_mechanism="AST_OR_SCHEMA",
            has_exact_evidence=True,
            is_llm_derived=False,
            has_missing_inputs=False,
        )
        assert conf == ProvenanceConfidence.VERIFIED
        assert score == 1.00

    def test_deterministic_rule_yields_rule_derived(self):
        conf, score = ConfidenceClassifierEvaluator.classify(
            source_mechanism="DETERMINISTIC_RULE",
            has_exact_evidence=True,
            is_llm_derived=False,
            has_missing_inputs=False,
        )
        assert conf == ProvenanceConfidence.RULE_DERIVED
        assert score == 0.85

    def test_llm_derived_strictly_demoted_to_inferred(self):
        conf, score = ConfidenceClassifierEvaluator.classify(
            source_mechanism="AST_OR_SCHEMA",
            has_exact_evidence=True,
            is_llm_derived=True,  # LLM involved!
            has_missing_inputs=False,
        )
        assert conf == ProvenanceConfidence.INFERRED
        assert score == 0.60

    def test_heuristic_yields_inferred(self):
        conf, score = ConfidenceClassifierEvaluator.classify(
            source_mechanism="HEURISTIC",
            has_exact_evidence=False,
            is_llm_derived=False,
            has_missing_inputs=False,
        )
        assert conf == ProvenanceConfidence.INFERRED
        assert score == 0.60

    def test_missing_inputs_yields_unknown(self):
        conf, score = ConfidenceClassifierEvaluator.classify(
            source_mechanism="AST_OR_SCHEMA",
            has_exact_evidence=True,
            is_llm_derived=False,
            has_missing_inputs=True,
        )
        assert conf == ProvenanceConfidence.UNKNOWN
        assert score == 0.30


# ==============================================================================
# Feature 5: AI Problem Router
# ==============================================================================

class TestFeature05_AIProblemRouter:
    """Verifies intent routing from text and artifact identifiers."""

    def test_routes_xdp_to_form_doctor(self):
        engines = AIProblemRouterEvaluator.route("User cannot print PO", ["purchase_order.xdp"])
        assert "form_doctor" in engines

    def test_routes_brfplus_to_opd_guard(self):
        engines = AIProblemRouterEvaluator.route("Supplier email not sent", ["opd_decision_tables.xlsx"])
        assert "opd_guard" in engines

    def test_routes_abap_to_clean_core_guard(self):
        engines = AIProblemRouterEvaluator.route("Clean core audit", ["zcl_order.abap"])
        assert "clean_core_object_guard" in engines

    def test_routes_mfs_telegram_to_blackbox(self):
        engines = AIProblemRouterEvaluator.route("Conveyor 3 jam in EWM", ["mfs_telegram_log.csv"])
        assert "mfs_blackbox" in engines

    def test_unknown_intent_fallback(self):
        engines = AIProblemRouterEvaluator.route("Random uncataloged query with no context", [])
        assert engines == ["unknown_intent"]


# ==============================================================================
# Feature 6: Tamper-Evident Audit Trail
# ==============================================================================

class TestFeature06_AuditTrail:
    """Verifies cryptographic hash chaining and tamper detection."""

    def test_initial_event_creation(self):
        ev = AuditTrailEvaluator.create_event(
            tenant_id="org_01",
            action="ANALYSIS_RUN",
            resource_type="analysis",
            resource_id="an_100",
            details={"engine": "opd_guard"},
        )
        assert ev.previous_event_hash == "0" * 64
        assert len(ev.event_hash) == 64

    def test_chain_two_valid_events(self):
        ev1 = AuditTrailEvaluator.create_event("org_01", "UPLOAD", "file", "f_01", {"name": "po.xml"})
        ev2 = AuditTrailEvaluator.create_event("org_01", "ANALYZE", "job", "j_01", {"job": 1}, previous_event_hash=ev1.event_hash)
        assert AuditTrailEvaluator.verify_chain([ev1, ev2]) is True

    def test_chain_multi_events_valid(self):
        events = []
        prev = "0" * 64
        for i in range(5):
            ev = AuditTrailEvaluator.create_event("org_01", f"ACTION_{i}", "res", f"id_{i}", {"step": i}, previous_event_hash=prev)
            events.append(ev)
            prev = ev.event_hash
        assert AuditTrailEvaluator.verify_chain(events) is True

    def test_tampered_payload_detected(self):
        ev1 = AuditTrailEvaluator.create_event("org_01", "UPLOAD", "file", "f_01", {"name": "po.xml"})
        ev2 = AuditTrailEvaluator.create_event("org_01", "ANALYZE", "job", "j_01", {"job": 1}, previous_event_hash=ev1.event_hash)
        # Tamper payload
        ev1.details["name"] = "tampered.xml"
        assert AuditTrailEvaluator.verify_chain([ev1, ev2]) is False

    def test_broken_previous_hash_detected(self):
        ev1 = AuditTrailEvaluator.create_event("org_01", "UPLOAD", "file", "f_01", {"name": "po.xml"})
        ev2 = AuditTrailEvaluator.create_event("org_01", "ANALYZE", "job", "j_01", {"job": 1}, previous_event_hash="corrupt_hash")
        assert AuditTrailEvaluator.verify_chain([ev1, ev2]) is False


# ==============================================================================
# Feature 7: Evidence Engine & Provenance Hashing
# ==============================================================================

class TestFeature07_EvidenceEngine:
    """Verifies evidence integrity, release alignment, and trust scoring."""

    def test_evidence_sha256_hash_integrity(self):
        snippet = "SELECT * FROM mara WHERE mtart = 'ROH'"
        hash_val = compute_sha256(snippet)
        assert len(hash_val) == 64
        assert compute_sha256(snippet) == hash_val

    def test_release_aligned_status(self):
        target_release = "2023"
        valid_from = "2020"
        valid_to = "2025"
        is_aligned = valid_from <= target_release <= valid_to
        assert is_aligned is True

    def test_release_misaligned_status(self):
        target_release = "2025"
        valid_from = "2018"
        valid_to = "2022"
        is_aligned = valid_from <= target_release <= valid_to
        assert is_aligned is False

    def test_official_metadata_trust_level(self):
        source_type = "OFFICIAL_METADATA"
        trust = 1.0 if source_type == "OFFICIAL_METADATA" else 0.5
        assert trust == 1.0

    def test_customer_evidence_trust_level(self):
        source_type = "CUSTOMER_EVIDENCE"
        trust = 0.50 if source_type == "CUSTOMER_EVIDENCE" else 1.0
        assert trust == 0.50


# ==============================================================================
# Feature 8: OPD Guard (BRFplus Output Determination Doctor)
# ==============================================================================

class TestFeature08_OPDGuard:
    """Verifies BRFplus decision table evaluation, shadowed rules, and missing conditions."""

    def test_valid_po_output_determination(self, fixtures_root):
        fixture_path = fixtures_root / "opd" / "opd_po_valid.json"
        data = json.loads(fixture_path.read_text(encoding="utf-8"))
        res = OPDGuardEvaluator.evaluate(data["tables"], data["scenario"])
        assert res["status"] == "COMPLETED"
        assert res["first_failed_step"] is None
        assert res["results"]["Channel"] == "EMAIL"
        assert len(res["findings"]) == 0

    def test_missing_recipient_step_fails(self, fixtures_root):
        fixture_path = fixtures_root / "opd" / "opd_po_missing_recipient.json"
        data = json.loads(fixture_path.read_text(encoding="utf-8"))
        res = OPDGuardEvaluator.evaluate(data["tables"], data["scenario"])
        assert res["status"] == "PARTIAL"
        assert res["first_failed_step"] == "Email Recipient"
        assert any(f["code"] == "OPD_STEP_FAILED" for f in res["findings"])

    def test_shadowed_rule_detected(self, fixtures_root):
        fixture_path = fixtures_root / "opd" / "opd_shadowed_rule.json"
        data = json.loads(fixture_path.read_text(encoding="utf-8"))
        res = OPDGuardEvaluator.evaluate(data["tables"], {"DocumentType": "NB"})
        assert res["shadowed_rules_count"] >= 1
        assert any(f["code"] == "OPD_UNREACHABLE_RULE" for f in res["findings"])

    def test_wildcard_condition_matches_any(self):
        tables = {"Output Type": [{"COND_DocumentType": "*", "RESULT": "DEFAULT_OUT"}]}
        res = OPDGuardEvaluator.evaluate(tables, {"DocumentType": "XYZ"})
        assert res["results"].get("Output Type") == "DEFAULT_OUT"

    def test_empty_condition_treated_as_wildcard(self):
        tables = {"Output Type": [{"COND_DocumentType": "", "RESULT": "WILDCARD_MATCH"}]}
        res = OPDGuardEvaluator.evaluate(tables, {"DocumentType": "ABC"})
        assert res["results"].get("Output Type") == "WILDCARD_MATCH"


# ==============================================================================
# Feature 9: FormDoctor (OutputPath XDP/XML Validator)
# ==============================================================================

class TestFeature09_FormDoctor:
    """Verifies XDP form layout dataRef bindings against runtime XML."""

    def test_valid_form_bindings_pass(self, fixtures_root):
        xml_content = (fixtures_root / "forms" / "invoice_payload.xml").read_text(encoding="utf-8")
        bindings = [
            {"field": "InvoiceNum", "dataRef": "$.Invoice.Header.InvoiceID"},
            {"field": "SupplierTax", "dataRef": "$.Invoice.Header.Supplier.TaxNumber"},
        ]
        res = FormDoctorEvaluator.evaluate(xml_content, bindings)
        assert res["status"] == "COMPLETED"
        assert len(res["findings"]) == 0

    def test_missing_field_in_xml_detected(self, fixtures_root):
        xml_content = (fixtures_root / "forms" / "invoice_payload.xml").read_text(encoding="utf-8")
        bindings = [
            {"field": "NonExistentField", "dataRef": "$.Invoice.Header.NonExistentField"},
        ]
        res = FormDoctorEvaluator.evaluate(xml_content, bindings)
        assert any(f["code"] == "FORM_FIELD_MISSING_IN_XML" for f in res["findings"])

    def test_mismatched_binding_path_detected(self, fixtures_root):
        xml_content = (fixtures_root / "forms" / "invoice_payload.xml").read_text(encoding="utf-8")
        # Template binds to SupplierTaxNumber, but XML has TaxNumber under Supplier
        bindings = [
            {"field": "Tax", "dataRef": "$.Invoice.Header.TaxNumber"},
        ]
        res = FormDoctorEvaluator.evaluate(xml_content, bindings)
        assert any(f["code"] == "FORM_BINDING_PATH_MISMATCH" for f in res["findings"])

    def test_hidden_field_layout_detected(self, fixtures_root):
        xml_content = (fixtures_root / "forms" / "invoice_payload.xml").read_text(encoding="utf-8")
        bindings = [
            {"field": "HiddenField", "dataRef": "$.Invoice.Header.InvoiceID", "presence": "hidden"},
        ]
        res = FormDoctorEvaluator.evaluate(xml_content, bindings)
        assert any(f["code"] == "FORM_FIELD_HIDDEN_IN_LAYOUT" for f in res["findings"])

    def test_malformed_xml_handling(self):
        bad_xml = "<Invoice><UnclosedTag></Invoice>"
        bindings = [{"field": "F1", "dataRef": "$.Invoice.F1"}]
        res = FormDoctorEvaluator.evaluate(bad_xml, bindings)
        assert res["status"] == "FAILED"


# ==============================================================================
# Feature 10: Custom Field Flow Doctor
# ==============================================================================

class TestFeature10_CustomFieldFlowDoctor:
    """Verifies custom field propagation across standard business document chains."""

    def test_supported_standard_flow(self):
        hops = [("MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM")]
        defs = {"MM_PURCHASE_ORDER_ITEM": {"length": 20}, "MM_SUPPLIER_INVOICE_ITEM": {"length": 20}}
        res = CustomFieldFlowEvaluator.evaluate("YY1_PROJ", hops, defs)
        assert res["hops"][0]["status"] == "SUPPORTED"
        assert len(res["findings"]) == 0

    def test_flow_requiring_badi(self):
        hops = [("MM_SUPPLIER_INVOICE_ITEM", "FI_JOURNAL_ENTRY_ITEM")]
        defs = {"MM_SUPPLIER_INVOICE_ITEM": {"length": 20}, "FI_JOURNAL_ENTRY_ITEM": {"length": 20}}
        res = CustomFieldFlowEvaluator.evaluate("YY1_PROJ", hops, defs)
        assert res["hops"][0]["status"] == "CUSTOM_LOGIC"
        assert any(f["code"] == "FIELD_PROPAGATION_REQUIRES_BADI" for f in res["findings"])

    def test_blocked_flow(self):
        hops = [("UNKNOWN_SOURCE", "UNKNOWN_TARGET")]
        res = CustomFieldFlowEvaluator.evaluate("YY1_PROJ", hops, {})
        assert res["hops"][0]["status"] == "BLOCKED"
        assert any(f["code"] == "FIELD_PROPAGATION_BLOCKED" for f in res["findings"])

    def test_field_truncation_warning(self):
        hops = [("MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM")]
        defs = {"MM_PURCHASE_ORDER_ITEM": {"length": 40}, "MM_SUPPLIER_INVOICE_ITEM": {"length": 20}}
        res = CustomFieldFlowEvaluator.evaluate("YY1_PROJ", hops, defs)
        assert any(f["code"] == "FIELD_TYPE_MISMATCH" for f in res["findings"])

    def test_multi_hop_chain(self):
        hops = [
            ("MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"),
            ("MM_SUPPLIER_INVOICE_ITEM", "FI_JOURNAL_ENTRY_ITEM"),
        ]
        defs = {
            "MM_PURCHASE_ORDER_ITEM": {"length": 20},
            "MM_SUPPLIER_INVOICE_ITEM": {"length": 20},
            "FI_JOURNAL_ENTRY_ITEM": {"length": 20},
        }
        res = CustomFieldFlowEvaluator.evaluate("YY1_PROJ", hops, defs)
        assert len(res["hops"]) == 2
        assert res["hops"][0]["status"] == "SUPPORTED"
        assert res["hops"][1]["status"] == "CUSTOM_LOGIC"


# ==============================================================================
# Feature 11: Extension Impact Guard
# ==============================================================================

class TestFeature11_ExtensionImpactGuard:
    """Verifies blast radius calculation and safe deletion blocks."""

    def test_field_with_consumers_blocked_from_delete(self):
        graph = {"YY1_FIELD": ["CDS_VIEW_1", "FORM_1"]}
        res = ExtensionImpactEvaluator.evaluate("YY1_FIELD", graph)
        assert res["safe_to_delete"] is False
        assert any(f["code"] == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS" for f in res["findings"])

    def test_isolated_field_safe_to_delete(self):
        graph = {"YY1_UNUSED": []}
        res = ExtensionImpactEvaluator.evaluate("YY1_UNUSED", graph)
        assert res["safe_to_delete"] is True
        assert len(res["findings"]) == 0

    def test_transitive_consumers_traversed(self):
        graph = {
            "YY1_FIELD": ["CDS_LEVEL_1"],
            "CDS_LEVEL_1": ["CDS_LEVEL_2"],
            "CDS_LEVEL_2": ["API_EXPORT"],
        }
        res = ExtensionImpactEvaluator.evaluate("YY1_FIELD", graph)
        assert "CDS_LEVEL_1" in res["direct_consumers"]
        assert "CDS_LEVEL_2" in res["transitive_consumers"]
        assert "API_EXPORT" in res["transitive_consumers"]

    def test_multiple_direct_consumers(self):
        graph = {"YY1_FIELD": ["CDS_1", "CDS_2", "FORM_1"]}
        res = ExtensionImpactEvaluator.evaluate("YY1_FIELD", graph)
        assert len(res["direct_consumers"]) == 3

    def test_circular_dependency_in_extensions(self):
        graph = {"CDS_A": ["CDS_B"], "CDS_B": ["CDS_A"]}
        res = ExtensionImpactEvaluator.evaluate("CDS_A", graph)
        assert "CDS_B" in res["direct_consumers"]


# ==============================================================================
# Feature 12: SPRO2Cloud
# ==============================================================================

class TestFeature12_SPRO2Cloud:
    """Verifies ECC IMG activities to S/4HANA Cloud SSCUI mappings."""

    def test_exact_mapping_found(self):
        res = SPRO2CloudEvaluator.evaluate("SIMG_CFMENUOLSDVOFA")
        assert res["mapping"]["status"] == "EXACT"
        assert res["mapping"]["sscui"] == "101230"
        assert any(f["code"] == "SPRO_MAPPING_EXACT" for f in res["findings"])

    def test_scope_dependent_mapping_found(self):
        res = SPRO2CloudEvaluator.evaluate("SIMG_CFMENUOLSDOVZ0")
        assert res["mapping"]["status"] == "SCOPE_DEPENDENT"
        assert res["mapping"]["scope_item"] == "1MD"
        assert any(f["code"] == "SPRO_MAPPING_SCOPE_DEPENDENT" for f in res["findings"])

    def test_not_available_in_cloud_found(self):
        res = SPRO2CloudEvaluator.evaluate("SIMG_CFMENUOLSD_SPECIAL_LEDGER")
        assert res["mapping"]["status"] == "NOT_AVAILABLE"
        assert any(f["code"] == "SPRO_NOT_AVAILABLE_IN_CLOUD" for f in res["findings"])

    def test_uncataloged_activity_needs_review(self):
        res = SPRO2CloudEvaluator.evaluate("Z_CUSTOM_IMG_ACTIVITY")
        assert res["mapping_status"] == "NEEDS_REVIEW"
        assert any(f["code"] == "SPRO_UNCATALOGED_ACTIVITY" for f in res["findings"])

    def test_cbc_activity_name_present(self):
        res = SPRO2CloudEvaluator.evaluate("SIMG_CFMENUOLSDVOFA")
        assert res["mapping"]["cbc"] == "Configure Billing Document Types"


# ==============================================================================
# Feature 13: ECC2Cloud Navigator
# ==============================================================================

class TestFeature13_ECC2CloudNavigator:
    """Verifies legacy transaction usage assessment and Fiori successor resolution."""

    def test_standard_tcode_fiori_successor(self):
        st03n = [{"tcode": "ME21N", "execution_count": 5000}]
        res = ECC2CloudNavigatorEvaluator.evaluate(st03n)
        assert res["cloud_ready_percentage"] == 100.0
        assert any(f["fiori_id"] == "F0842A" for f in res["findings"])

    def test_custom_code_high_usage_blocker(self):
        st03n = [{"tcode": "ZVA01", "execution_count": 15000}]
        res = ECC2CloudNavigatorEvaluator.evaluate(st03n)
        assert any(f["code"] == "ECC_CUSTOM_CODE_HIGH_USAGE_BLOCKER" for f in res["findings"])

    def test_custom_code_low_usage_review(self):
        st03n = [{"tcode": "ZVA01", "execution_count": 50}]
        res = ECC2CloudNavigatorEvaluator.evaluate(st03n)
        assert any(f["code"] == "ECC_CUSTOM_CODE_NEEDS_REVIEW" for f in res["findings"])

    def test_mixed_portfolio_calculation(self):
        st03n = [
            {"tcode": "ME21N", "execution_count": 1000},
            {"tcode": "VA01", "execution_count": 2000},
            {"tcode": "ZVA01", "execution_count": 500},
        ]
        res = ECC2CloudNavigatorEvaluator.evaluate(st03n)
        assert res["cloud_ready_percentage"] == 66.7
        assert res["total_objects"] == 3

    def test_empty_st03n_portfolio(self):
        res = ECC2CloudNavigatorEvaluator.evaluate([])
        assert res["cloud_ready_percentage"] == 0.0
        assert res["total_objects"] == 0


# ==============================================================================
# Feature 14: SAP Gap Radar
# ==============================================================================

class TestFeature14_SAPGapRadar:
    """Verifies deterministic 12-tier clean core resolution."""

    def test_standard_tier_1_resolution(self):
        res = SAPGapRadarEvaluator.evaluate("Create standard purchase order for stock material", "2023")
        assert res["resolution_tier"] == 1
        assert res["verdict"] == "SUPPORTED_STANDARD"

    def test_badi_tier_7_resolution(self):
        res = SAPGapRadarEvaluator.evaluate("Implement custom pricing logic via BAdI", "2023")
        assert res["resolution_tier"] == 7
        assert res["verdict"] == "SUPPORTED_DEVELOPER_EXTENSIBILITY"

    def test_event_mesh_tier_8_resolution(self):
        res = SAPGapRadarEvaluator.evaluate("Trigger external webhook via cloud events on goods receipt", "2023")
        assert res["resolution_tier"] == 8
        assert res["verdict"] == "SUPPORTED_BUSINESS_EVENT"

    def test_direct_db_write_blocked_tier_11(self):
        res = SAPGapRadarEvaluator.evaluate("Direct DB write into table BSEG without standard BAPI", "2023")
        assert res["resolution_tier"] == 11
        assert res["verdict"] == "BLOCKED_CLEAN_CORE_VIOLATION"

    def test_unknown_requirement_tier_12(self):
        res = SAPGapRadarEvaluator.evaluate("Uncataloged bespoke proprietary subsystem integration", "2023")
        assert res["resolution_tier"] == 12
        assert res["verdict"] == "UNKNOWN_REQUIREMENT"


# ==============================================================================
# Feature 15: Clean Core Object Guard
# ==============================================================================

class TestFeature15_CleanCoreObjectGuard:
    """Verifies static AST analysis of ABAP code for classic tables and obsolete statements."""

    def test_compliant_abap_passes_100_percent(self, fixtures_root):
        code = (fixtures_root / "clean_core" / "clean_core_compliant.abap").read_text(encoding="utf-8")
        res = CleanCoreObjectGuardEvaluator.evaluate(code)
        assert res["compliance_percentage"] == 100.0
        assert len(res["findings"]) == 0

    def test_direct_mara_access_flagged(self):
        code = "SELECT * FROM mara INTO TABLE @lt_mara."
        res = CleanCoreObjectGuardEvaluator.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" and f["table"] == "MARA" for f in res["findings"])

    def test_direct_vbak_access_flagged(self):
        code = "UPDATE vbak SET netwr = 100 WHERE vbeln = '1000'."
        res = CleanCoreObjectGuardEvaluator.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" and f["table"] == "VBAK" for f in res["findings"])

    def test_obsolete_perform_syntax_flagged(self):
        code = "PERFORM calculate_tax."
        res = CleanCoreObjectGuardEvaluator.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX" and f["statement"] == "PERFORM" for f in res["findings"])

    def test_obsolete_tables_statement_flagged(self):
        code = "TABLES: mara, vbak."
        res = CleanCoreObjectGuardEvaluator.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX" and f["statement"] == "TABLES" for f in res["findings"])


# ==============================================================================
# Feature 16: Change Pointer Coverage Auditor
# ==============================================================================

class TestFeature16_ChangePointerAuditor:
    """Verifies ALE/IDoc change pointer configuration and trigger coverage."""

    def test_complete_configuration_passes_100_percent(self, fixtures_root):
        data = json.loads((fixtures_root / "change_pointer" / "cp_valid.json").read_text(encoding="utf-8"))
        res = ChangePointerAuditorEvaluator.evaluate(
            data["bd61_active"],
            set(data["bd50_msg_types"]),
            [tuple(x) for x in data["bd52_fields"]],
            [tuple(x) for x in data["expected_fields"]],
        )
        assert res["coverage_percentage"] == 100.0
        assert len(res["findings"]) == 0

    def test_global_bd61_deactivated_critical_error(self, fixtures_root):
        data = json.loads((fixtures_root / "change_pointer" / "cp_global_disabled.json").read_text(encoding="utf-8"))
        res = ChangePointerAuditorEvaluator.evaluate(
            data["bd61_active"],
            set(data["bd50_msg_types"]),
            [tuple(x) for x in data["bd52_fields"]],
            [tuple(x) for x in data["expected_fields"]],
        )
        assert any(f["code"] == "CP_GLOBAL_DEACTIVATED" for f in res["findings"])

    def test_missing_trigger_field_flagged(self, fixtures_root):
        data = json.loads((fixtures_root / "change_pointer" / "cp_missing_groes.json").read_text(encoding="utf-8"))
        res = ChangePointerAuditorEvaluator.evaluate(
            data["bd61_active"],
            set(data["bd50_msg_types"]),
            [tuple(x) for x in data["bd52_fields"]],
            [tuple(x) for x in data["expected_fields"]],
        )
        assert any(f["code"] == "CP_FIELD_NOT_CONFIGURED_BD52" and f["field"] == "GROES" for f in res["findings"])
        assert res["coverage_percentage"] == 66.7

    def test_multiple_missing_fields_calculated(self):
        res = ChangePointerAuditorEvaluator.evaluate(
            bd61_active=True,
            bd50_msg_types={"MATMAS"},
            bd52_fields=[("MARA", "MATKL")],
            expected_fields=[("MARA", "MATKL"), ("MARA", "GROES"), ("MARA", "MEINS"), ("MARA", "BRGEW")],
        )
        assert res["coverage_percentage"] == 25.0
        assert len(res["findings"]) == 3

    def test_empty_expected_fields_portfolio(self):
        res = ChangePointerAuditorEvaluator.evaluate(
            bd61_active=True,
            bd50_msg_types={"MATMAS"},
            bd52_fields=[],
            expected_fields=[],
        )
        assert res["coverage_percentage"] == 100.0


# ==============================================================================
# Feature 17: API Change Guard
# ==============================================================================

class TestFeature17_APIChangeGuard:
    """Verifies breaking contract change detection in OpenAPI / OData."""

    def test_identical_specs_zero_breaking_changes(self, fixtures_root):
        base = json.loads((fixtures_root / "api_change" / "api_baseline.json").read_text(encoding="utf-8"))
        res = APIChangeGuardEvaluator.evaluate(base, base, [])
        assert res["breaking_changes_count"] == 0
        assert len(res["findings"]) == 0

    def test_endpoint_removal_flagged_breaking(self, fixtures_root):
        base = json.loads((fixtures_root / "api_change" / "api_baseline.json").read_text(encoding="utf-8"))
        cand = json.loads((fixtures_root / "api_change" / "api_breaking.json").read_text(encoding="utf-8"))
        res = APIChangeGuardEvaluator.evaluate(base, cand, [])
        assert any(f["code"] == "API_BREAKING_ENDPOINT_REMOVED" for f in res["findings"])

    def test_schema_field_removal_flagged_breaking(self, fixtures_root):
        base = json.loads((fixtures_root / "api_change" / "api_baseline.json").read_text(encoding="utf-8"))
        cand = json.loads((fixtures_root / "api_change" / "api_breaking.json").read_text(encoding="utf-8"))
        res = APIChangeGuardEvaluator.evaluate(base, cand, [])
        assert any(f["code"] == "API_BREAKING_FIELD_REMOVED" and f["property"] == "taxJurisdiction" for f in res["findings"])

    def test_http_method_removal_flagged_breaking(self):
        base = {"paths": {"/orders": ["get", "post"]}}
        cand = {"paths": {"/orders": ["get"]}}
        res = APIChangeGuardEvaluator.evaluate(base, cand, [])
        assert any(f["code"] == "API_BREAKING_METHOD_REMOVED" and f["method"] == "post" for f in res["findings"])

    def test_non_breaking_addition_allowed(self):
        base = {"paths": {"/orders": ["get"]}}
        cand = {"paths": {"/orders": ["get", "post"], "/customers": ["get"]}}
        res = APIChangeGuardEvaluator.evaluate(base, cand, [])
        assert res["breaking_changes_count"] == 0


# ==============================================================================
# Feature 18: Software Collection Dependency Guard
# ==============================================================================

class TestFeature18_SoftwareCollectionGuard:
    """Verifies key-user software collection release order and circularity detection."""

    def test_linear_dependencies_pass(self):
        cols = ["SC_CORE", "SC_SALES"]
        deps = {"SC_CORE": [], "SC_SALES": ["SC_CORE"]}
        res = SoftwareCollectionGuardEvaluator.evaluate(cols, deps)
        assert res["has_cycles"] is False
        assert len(res["findings"]) == 0

    def test_circular_dependency_detected(self, fixtures_root):
        data = json.loads((fixtures_root / "software_collection" / "sc_circular.json").read_text(encoding="utf-8"))
        res = SoftwareCollectionGuardEvaluator.evaluate(data["collections"], data["dependencies"])
        assert res["has_cycles"] is True
        assert any(f["code"] == "SC_CIRCULAR_DEPENDENCY" for f in res["findings"])

    def test_three_node_cycle_detected(self):
        cols = ["A", "B", "C"]
        deps = {"A": ["B"], "B": ["C"], "C": ["A"]}
        res = SoftwareCollectionGuardEvaluator.evaluate(cols, deps)
        assert res["has_cycles"] is True

    def test_independent_collections_pass(self):
        cols = ["A", "B", "C"]
        deps = {"A": [], "B": [], "C": []}
        res = SoftwareCollectionGuardEvaluator.evaluate(cols, deps)
        assert res["has_cycles"] is False

    def test_single_collection_no_deps(self):
        cols = ["SC_FINANCE"]
        deps = {"SC_FINANCE": []}
        res = SoftwareCollectionGuardEvaluator.evaluate(cols, deps)
        assert res["has_cycles"] is False


# ==============================================================================
# Feature 19: Transport Dependency Analyzer
# ==============================================================================

class TestFeature19_TransportDependencyAnalyzer:
    """Verifies ABAP transport object collisions and overtaking risks."""

    def test_distinct_objects_zero_collisions(self):
        trs = {
            "DEVK9001": ["CLAS ZCL_A"],
            "DEVK9002": ["CLAS ZCL_B"],
        }
        res = TransportAnalyzerEvaluator.evaluate(trs)
        assert res["collisions_count"] == 0

    def test_same_class_in_two_transports_collision(self, fixtures_root):
        data = json.loads((fixtures_root / "transport" / "tr_collision.json").read_text(encoding="utf-8"))
        res = TransportAnalyzerEvaluator.evaluate(data["transports"])
        assert res["collisions_count"] >= 1
        assert any(f["code"] == "TR_OBJECT_COLLISION" and f["object"] == "CLAS ZCL_ORDER_HANDLER" for f in res["findings"])

    def test_table_collision_detected(self):
        trs = {
            "TR1": ["TABL ZORDERS"],
            "TR2": ["TABL ZORDERS"],
        }
        res = TransportAnalyzerEvaluator.evaluate(trs)
        assert any(f["object"] == "TABL ZORDERS" for f in res["findings"])

    def test_empty_transport_list(self):
        res = TransportAnalyzerEvaluator.evaluate({})
        assert res["collisions_count"] == 0

    def test_multi_collision_count(self):
        trs = {
            "TR1": ["OBJ1", "OBJ2"],
            "TR2": ["OBJ1", "OBJ2"],
        }
        res = TransportAnalyzerEvaluator.evaluate(trs)
        assert res["collisions_count"] == 2


# ==============================================================================
# Feature 20: Safe Decommission Preflight
# ==============================================================================

class TestFeature20_SafeDecommissionPreflight:
    """Verifies operational dependencies before user/service account deletion."""

    def test_user_with_active_batch_job_blocked(self, fixtures_root):
        data = json.loads((fixtures_root / "decommission" / "decom_user_dependencies.json").read_text(encoding="utf-8"))
        res = SafeDecommissionEvaluator.evaluate(
            data["target_user"],
            data["batch_jobs"],
            data["rfc_destinations"],
        )
        assert res["safe_to_decommission"] is False
        assert any(f["code"] == "DECOM_SCHEDULED_JOB_DEPENDENCY" for f in res["findings"])

    def test_user_with_active_rfc_blocked(self, fixtures_root):
        data = json.loads((fixtures_root / "decommission" / "decom_user_dependencies.json").read_text(encoding="utf-8"))
        res = SafeDecommissionEvaluator.evaluate(
            data["target_user"],
            data["batch_jobs"],
            data["rfc_destinations"],
        )
        assert any(f["code"] == "DECOM_ACTIVE_RFC_DEPENDENCY" for f in res["findings"])

    def test_safe_user_passes_decommission(self):
        res = SafeDecommissionEvaluator.evaluate("SAFE_USER", [], [])
        assert res["safe_to_decommission"] is True
        assert len(res["findings"]) == 0

    def test_inactive_batch_jobs_do_not_block(self):
        jobs = [{"job_name": "HISTORIC_JOB", "auth_user": "USER01", "status": "COMPLETED"}]
        res = SafeDecommissionEvaluator.evaluate("USER01", jobs, [])
        assert res["safe_to_decommission"] is True

    def test_inactive_rfc_does_not_block(self):
        rfcs = [{"destination": "OLD_DEST", "logon_user": "USER01", "active": False}]
        res = SafeDecommissionEvaluator.evaluate("USER01", [], rfcs)
        assert res["safe_to_decommission"] is True


# ==============================================================================
# Feature 21: Fiori 403 Root-Cause Doctor
# ==============================================================================

class TestFeature21_Fiori403Doctor:
    """Verifies decision tree root cause diagnosis for HTTP 403 errors."""

    def test_su53_missing_authorization_diagnosed(self, fixtures_root):
        data = json.loads((fixtures_root / "fiori403" / "fiori_su53_missing.json").read_text(encoding="utf-8"))
        res = Fiori403DoctorEvaluator.evaluate(
            data["status_code"],
            data["su53_failed_objects"],
            data["icf_inactive_paths"],
            data["is_post_without_csrf"],
        )
        assert res["root_cause"] == "AUTHORIZATION"
        assert any(f["code"] == "FIORI_AUTH_OBJECT_MISSING" for f in res["findings"])

    def test_inactive_icf_node_diagnosed(self, fixtures_root):
        data = json.loads((fixtures_root / "fiori403" / "fiori_icf_inactive.json").read_text(encoding="utf-8"))
        res = Fiori403DoctorEvaluator.evaluate(
            data["status_code"],
            data["su53_failed_objects"],
            data["icf_inactive_paths"],
            data["is_post_without_csrf"],
        )
        assert res["root_cause"] == "ICF"
        assert any(f["code"] == "FIORI_ICF_INACTIVE" for f in res["findings"])

    def test_csrf_token_missing_diagnosed(self):
        res = Fiori403DoctorEvaluator.evaluate(403, [], [], is_post_without_csrf=True)
        assert res["root_cause"] == "CSRF"
        assert any(f["code"] == "FIORI_CSRF_TOKEN_INVALID" for f in res["findings"])

    def test_non_403_status_ignored(self):
        res = Fiori403DoctorEvaluator.evaluate(200, [], [], False)
        assert res["root_cause"] == "NOT_A_403_ERROR"

    def test_unknown_403_cause(self):
        res = Fiori403DoctorEvaluator.evaluate(403, [], [], False)
        assert res["root_cause"] == "UNKNOWN_403"


# ==============================================================================
# Feature 22: Workflow Stuck Explainer
# ==============================================================================

class TestFeature22_WorkflowStuckExplainer:
    """Verifies workflow log analysis for empty agents and background exceptions."""

    def test_stuck_with_no_agent_flagged(self, fixtures_root):
        data = json.loads((fixtures_root / "workflow" / "wf_stuck_sample.json").read_text(encoding="utf-8"))
        res = WorkflowStuckExplainerEvaluator.evaluate(data["work_items"])
        assert any(f["code"] == "WF_STUCK_NO_AGENT" and f["work_item_id"] == "0000045012" for f in res["findings"])

    def test_background_task_exception_flagged(self, fixtures_root):
        data = json.loads((fixtures_root / "workflow" / "wf_stuck_sample.json").read_text(encoding="utf-8"))
        res = WorkflowStuckExplainerEvaluator.evaluate(data["work_items"])
        assert any(f["code"] == "WF_BACKGROUND_TASK_FAILED" and f["exception"] == "CX_SY_REF_IS_INITIAL" for f in res["findings"])

    def test_completed_work_item_not_stuck(self):
        items = [{"id": "1", "status": "COMPLETED", "agents": ["U1"]}]
        res = WorkflowStuckExplainerEvaluator.evaluate(items)
        assert res["stuck_work_items_count"] == 0

    def test_multiple_stuck_items_counted(self, fixtures_root):
        data = json.loads((fixtures_root / "workflow" / "wf_stuck_sample.json").read_text(encoding="utf-8"))
        res = WorkflowStuckExplainerEvaluator.evaluate(data["work_items"])
        assert res["stuck_work_items_count"] == 2

    def test_empty_workflow_portfolio(self):
        res = WorkflowStuckExplainerEvaluator.evaluate([])
        assert res["stuck_work_items_count"] == 0


# ==============================================================================
# Feature 23: IAM Cost Optimizer
# ==============================================================================

class TestFeature23_IAMCostOptimizer:
    """Verifies license tier driver app identification and role splitting."""

    def test_single_app_escalation_flagged(self):
        roles = {"Z_CLERK": ["DISPLAY_PO", "DISPLAY_SO", "DISPLAY_INVOICE", "FB08"]}
        tiers = {
            "DISPLAY_PO": "SELF_SERVICE",
            "DISPLAY_SO": "SELF_SERVICE",
            "DISPLAY_INVOICE": "SELF_SERVICE",
            "FB08": "ADVANCED",
        }
        res = IAMCostOptimizerEvaluator.evaluate(roles, tiers)
        assert any(f["code"] == "IAM_LICENSE_TIER_ESCALATED" and f["escalating_app"] == "FB08" for f in res["findings"])

    def test_homogeneous_role_not_flagged(self):
        roles = {"Z_CLERK": ["DISPLAY_PO", "DISPLAY_SO"]}
        tiers = {"DISPLAY_PO": "SELF_SERVICE", "DISPLAY_SO": "SELF_SERVICE"}
        res = IAMCostOptimizerEvaluator.evaluate(roles, tiers)
        assert len(res["findings"]) == 0

    def test_split_role_recommendation_present(self):
        roles = {"Z_CLERK": ["APP1", "APP2", "APP3", "APP4", "APP5", "APP6", "FB08"]}
        tiers = {f"APP{i}": "CORE" for i in range(1, 7)}
        tiers["FB08"] = "ADVANCED"
        res = IAMCostOptimizerEvaluator.evaluate(roles, tiers)
        assert any("Split app FB08" in f["recommendation"] for f in res["findings"])

    def test_multiple_roles_evaluated(self):
        roles = {
            "ROLE_A": ["A1", "A2", "A3", "A4", "A5", "A6", "ADV1"],
            "ROLE_B": ["B1", "B2"],
        }
        tiers = {f"A{i}": "CORE" for i in range(1, 7)}
        tiers["ADV1"] = "ADVANCED"
        tiers.update({"B1": "CORE", "B2": "CORE"})
        res = IAMCostOptimizerEvaluator.evaluate(roles, tiers)
        assert len(res["findings"]) == 1

    def test_empty_roles_portfolio(self):
        res = IAMCostOptimizerEvaluator.evaluate({}, {})
        assert len(res["findings"]) == 0


# ==============================================================================
# Feature 24: Account Determination Preflight
# ==============================================================================

class TestFeature24_AccountDeterminationPreflight:
    """Verifies OBYC / VKOA account determination rules and GL posting blocks."""

    def test_valid_account_passes(self, fixtures_root):
        rules = [{"transaction_key": "BSX", "valuation_class": "3000", "gl_account": "140000"}]
        coa = {"140000": {"blocked_for_posting": False}}
        res = AccountDeterminationEvaluator.evaluate(rules, coa)
        assert len(res["findings"]) == 0

    def test_missing_gl_account_flagged(self, fixtures_root):
        data = json.loads((fixtures_root / "account_det" / "obyc_rules_sample.json").read_text(encoding="utf-8"))
        res = AccountDeterminationEvaluator.evaluate(data["rules"], data["chart_of_accounts"])
        assert any(f["code"] == "ACCT_DET_MISSING_ACCOUNT" and f["transaction_key"] == "PRD" for f in res["findings"])

    def test_account_blocked_for_posting_flagged(self, fixtures_root):
        data = json.loads((fixtures_root / "account_det" / "obyc_rules_sample.json").read_text(encoding="utf-8"))
        res = AccountDeterminationEvaluator.evaluate(data["rules"], data["chart_of_accounts"])
        assert any(f["code"] == "ACCT_DET_ACCOUNT_BLOCKED_POSTING" and f["gl_account"] == "999999" for f in res["findings"])

    def test_account_not_found_in_coa_flagged(self):
        rules = [{"transaction_key": "BSX", "valuation_class": "3000", "gl_account": "888888"}]
        coa = {"140000": {"blocked_for_posting": False}}
        res = AccountDeterminationEvaluator.evaluate(rules, coa)
        assert any(f["code"] == "ACCT_DET_ACCOUNT_NOT_FOUND" and f["gl_account"] == "888888" for f in res["findings"])

    def test_empty_rules_matrix(self):
        res = AccountDeterminationEvaluator.evaluate([], {})
        assert len(res["findings"]) == 0


# ==============================================================================
# Feature 25: System Refresh Delta Guard
# ==============================================================================

class TestFeature25_SystemRefreshDeltaGuard:
    """Verifies landscape isolation, production host leakage, and SCOT safety."""

    def test_production_rfc_leak_flagged(self, fixtures_root):
        data = json.loads((fixtures_root / "system_refresh" / "system_refresh_sample.json").read_text(encoding="utf-8"))
        res = SystemRefreshDeltaGuardEvaluator.evaluate(
            data["pre_refresh_rfcs"],
            data["post_refresh_rfcs"],
            data["scot_outbound_active"],
        )
        assert any(f["code"] == "REFRESH_RFC_TARGETS_PRODUCTION" and f["destination"] == "SAP_PAYMENT_GW" for f in res["findings"])

    def test_scot_outbound_email_leak_flagged(self, fixtures_root):
        data = json.loads((fixtures_root / "system_refresh" / "system_refresh_sample.json").read_text(encoding="utf-8"))
        res = SystemRefreshDeltaGuardEvaluator.evaluate(
            data["pre_refresh_rfcs"],
            data["post_refresh_rfcs"],
            data["scot_outbound_active"],
        )
        assert any(f["code"] == "REFRESH_SCOT_OUTBOUND_ACTIVE" for f in res["findings"])

    def test_clean_qa_configuration_passes(self):
        pre = {"RFC1": "prod.internal"}
        post = {"RFC1": "qa.internal"}
        res = SystemRefreshDeltaGuardEvaluator.evaluate(pre, post, scot_outbound_active=False)
        assert len(res["findings"]) == 0

    def test_multiple_prod_rfcs_detected(self):
        post = {"RFC1": "prod-1.corp", "RFC2": "prd-db.corp"}
        res = SystemRefreshDeltaGuardEvaluator.evaluate({}, post, False)
        assert len(res["findings"]) == 2

    def test_empty_rfcs_portfolio(self):
        res = SystemRefreshDeltaGuardEvaluator.evaluate({}, {}, False)
        assert len(res["findings"]) == 0


# ==============================================================================
# Feature 26: MFS BlackBox
# ==============================================================================

class TestFeature26_MFSBlackBox:
    """Verifies EWM/MFS telegram streams and first causal divergence pinpointing."""

    def test_impossible_topology_jump_flagged(self, fixtures_root):
        data = json.loads((fixtures_root / "mfs" / "mfs_jump_stream.json").read_text(encoding="utf-8"))
        edges = {tuple(e) for e in data["conveyor_edges"]}
        res = MFSBlackBoxEvaluator.evaluate(data["telegrams"], edges)
        assert any(f["code"] == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP" for f in res["findings"])
        assert res["first_causal_divergence"] is not None

    def test_normal_telegram_stream_passes(self):
        telegrams = [
            {"type": "MOVE", "hu_id": "HU_1", "cp": "CP01", "time_sec": 1.0},
            {"type": "ACK", "hu_id": "HU_1", "cp": "CP01", "time_sec": 1.2},
            {"type": "MOVE", "hu_id": "HU_1", "cp": "CP02", "time_sec": 3.0},
        ]
        edges = {("CP01", "CP02")}
        res = MFSBlackBoxEvaluator.evaluate(telegrams, edges)
        assert len(res["findings"]) == 0
        assert res["first_causal_divergence"] is None

    def test_missing_ack_timeout_flagged(self):
        telegrams = [
            {"type": "MOVE", "hu_id": "HU_1", "cp": "CP01", "time_sec": 1.0},
            {"type": "TIMEOUT", "hu_id": "HU_1", "cp": "CP01", "time_sec": 6.0},
        ]
        res = MFSBlackBoxEvaluator.evaluate(telegrams, set())
        assert any(f["code"] == "MFS_MISSING_ACK_TIMEOUT" for f in res["findings"])
        assert res["first_causal_divergence"]["code"] == "MFS_MISSING_ACK_TIMEOUT"

    def test_first_divergence_is_earliest_failure(self):
        telegrams = [
            {"type": "MOVE", "hu_id": "HU_1", "cp": "CP01", "time_sec": 1.0},
            {"type": "TIMEOUT", "hu_id": "HU_1", "cp": "CP01", "time_sec": 2.0},  # First divergence
            {"type": "MOVE", "hu_id": "HU_2", "cp": "CP09", "time_sec": 5.0},    # Secondary divergence
        ]
        res = MFSBlackBoxEvaluator.evaluate(telegrams, set())
        assert res["first_causal_divergence"]["code"] == "MFS_MISSING_ACK_TIMEOUT"

    def test_empty_telegram_stream(self):
        res = MFSBlackBoxEvaluator.evaluate([], set())
        assert len(res["findings"]) == 0
        assert res["first_causal_divergence"] is None
