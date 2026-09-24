"""ERP Preflight - Tier 3: Cross-Feature Combinations Test Suite.

Authoritative Specification: PROJECT.md, engines_spec.md, platform_spec.md.
Scope: Pairwise cross-engine and cross-module end-to-end integration workflows.
"""

from __future__ import annotations
import json
import pytest
from pathlib import Path

from tests.e2e.contracts import (
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
    ExtensionImpactEvaluator,
    Fiori403DoctorEvaluator,
    FormDoctorEvaluator,
    IAMCostOptimizerEvaluator,
    IngestionEvaluator,
    MFSBlackBoxEvaluator,
    OPDGuardEvaluator,
    SafeDecommissionEvaluator,
    SAPGapRadarEvaluator,
    SecretRedactionEvaluator,
    SoftwareCollectionGuardEvaluator,
    SPRO2CloudEvaluator,
    SystemRefreshDeltaGuardEvaluator,
    TransportAnalyzerEvaluator,
    compute_sha256,
)


class TestTier3_CrossFeaturePipelines:
    """Verifies pairwise cross-engine and platform integration workflows."""

    def test_pipeline_ingestion_redaction_clean_core(self):
        """Pipeline 1: Ingestion -> Secret Redaction -> Clean Core static audit."""
        raw_code = (
            "REPORT zorder_transfer.\n"
            "RFC_PASS = 'ProdSecret123!'\n"
            "SELECT * FROM mara INTO TABLE @DATA(lt_mara).\n"
        )
        # Step 1: Validate MIME format
        ok, msg = IngestionEvaluator.validate_file_format("order.abap", raw_code.encode("utf-8"))
        assert ok is True

        # Step 2: Redact secrets
        redaction = SecretRedactionEvaluator.redact(raw_code)
        assert "[REDACTED_PASSWORD]" in redaction.sanitized_text
        assert "ProdSecret123!" not in redaction.sanitized_text

        # Step 3: Clean Core audit on sanitized code
        audit = CleanCoreObjectGuardEvaluator.evaluate(redaction.sanitized_text)
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" and f["table"] == "MARA" for f in audit["findings"])

    def test_pipeline_opd_to_form_doctor(self, fixtures_root):
        """Pipeline 2: OPD Guard determination feeding FormDoctor template validation."""
        # Step 1: Evaluate OPD decision tables
        opd_data = json.loads((fixtures_root / "opd" / "opd_po_valid.json").read_text(encoding="utf-8"))
        opd_res = OPDGuardEvaluator.evaluate(opd_data["tables"], opd_data["scenario"])
        assert opd_res["status"] == "COMPLETED"
        selected_template = opd_res["results"]["Form Template"]
        assert selected_template == "MM_PURCHASE_ORDER_DEFAULT"

        # Step 2: FormDoctor validates bindings for selected template
        xml_content = (fixtures_root / "forms" / "invoice_payload.xml").read_text(encoding="utf-8")
        bindings = [
            {"field": "InvoiceNum", "dataRef": "$.Invoice.Header.InvoiceID"},
            {"field": "Tax", "dataRef": "$.Invoice.Header.Supplier.TaxNumber"},
        ]
        form_res = FormDoctorEvaluator.evaluate(xml_content, bindings)
        assert form_res["status"] == "COMPLETED"
        assert len(form_res["findings"]) == 0

    def test_pipeline_custom_field_to_extension_impact(self):
        """Pipeline 3: Custom Field flow verification coupled with blast radius analysis."""
        # Step 1: Custom Field Flow Doctor
        hops = [("MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM")]
        defs = {"MM_PURCHASE_ORDER_ITEM": {"length": 20}, "MM_SUPPLIER_INVOICE_ITEM": {"length": 20}}
        flow_res = CustomFieldFlowEvaluator.evaluate("YY1_COST_CENTER", hops, defs)
        assert flow_res["hops"][0]["status"] == "SUPPORTED"

        # Step 2: Extension Impact Guard evaluates blast radius before field modification
        dep_graph = {
            "YY1_COST_CENTER": ["CDS_PO_REPORT", "FORM_PO_PRINT"],
            "CDS_PO_REPORT": ["API_ANALYTICS"],
        }
        impact_res = ExtensionImpactEvaluator.evaluate("YY1_COST_CENTER", dep_graph)
        assert impact_res["safe_to_delete"] is False
        assert len(impact_res["direct_consumers"]) == 2
        assert "API_ANALYTICS" in impact_res["transitive_consumers"]

    def test_pipeline_clean_core_to_transport_analyzer(self):
        """Pipeline 4: Clean Core violation detection coupled with Transport collision analysis."""
        # Transport contains a clean core violating object
        trs = {
            "DEVK900101": ["CLAS ZCL_ORDER_PROCESSOR", "TABL ZORDERS"],
            "DEVK900105": ["CLAS ZCL_ORDER_PROCESSOR"],  # Collision!
        }
        tr_res = TransportAnalyzerEvaluator.evaluate(trs)
        assert tr_res["collisions_count"] == 1

        abap_code = "SELECT * FROM vbak INTO TABLE @DATA(lt_vbak)."
        cc_res = CleanCoreObjectGuardEvaluator.evaluate(abap_code)
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" for f in cc_res["findings"])

    def test_pipeline_spro_to_account_determination(self):
        """Pipeline 5: SPRO2Cloud configuration mapping into Account Determination preflight."""
        # Step 1: Map SPRO activity
        spro_res = SPRO2CloudEvaluator.evaluate("SIMG_CFMENUOLSDVOFA")
        assert spro_res["mapping"]["status"] == "EXACT"

        # Step 2: Audit account determination rules for mapped billing types
        rules = [
            {"transaction_key": "KOFI", "valuation_class": "3000", "gl_account": "800000"},
            {"transaction_key": "KOF0", "valuation_class": "3000", "gl_account": ""},  # Missing
        ]
        coa = {"800000": {"blocked_for_posting": False}}
        acct_res = AccountDeterminationEvaluator.evaluate(rules, coa)
        assert any(f["code"] == "ACCT_DET_MISSING_ACCOUNT" for f in acct_res["findings"])

    def test_pipeline_fiori_403_to_iam_cost_optimizer(self):
        """Pipeline 6: Fiori 403 remediation coupled with IAM license tier impact."""
        # Step 1: Fiori 403 doctor flags missing auth object
        fiori_res = Fiori403DoctorEvaluator.evaluate(403, ["S_SERVICE"], [], False)
        assert fiori_res["root_cause"] == "AUTHORIZATION"

        # Step 2: Security admin adds catalog to fix 403, but IAM Cost Optimizer flags license escalation
        roles = {"Z_FIORI_USER": ["DISPLAY_SALES", "DISPLAY_INVOICE", "FB08"]}  # FB08 escalates!
        tiers = {"DISPLAY_SALES": "CORE", "DISPLAY_INVOICE": "CORE", "FB08": "ADVANCED"}
        iam_res = IAMCostOptimizerEvaluator.evaluate(roles, tiers)
        assert any(f["code"] == "IAM_LICENSE_TIER_ESCALATED" for f in iam_res["findings"])

    def test_pipeline_system_refresh_to_safe_decommission(self):
        """Pipeline 7: Refreshed QA system flags prod RFC, Safe Decommission checks dependencies."""
        # Step 1: System refresh flags prod host leakage
        pre = {"RFC_DEST": "prod-gateway.corp"}
        post = {"RFC_DEST": "prod-gateway.corp"}
        sr_res = SystemRefreshDeltaGuardEvaluator.evaluate(pre, post, False)
        assert any(f["code"] == "REFRESH_RFC_TARGETS_PRODUCTION" for f in sr_res["findings"])

        # Step 2: Safe decommission checks if associated technical user can be locked
        batch_jobs = [{"job_name": "SYNC_JOB", "auth_user": "RFC_TECH_USER", "status": "SCHEDULED"}]
        decom_res = SafeDecommissionEvaluator.evaluate("RFC_TECH_USER", batch_jobs, [])
        assert decom_res["safe_to_decommission"] is False
        assert any(f["code"] == "DECOM_SCHEDULED_JOB_DEPENDENCY" for f in decom_res["findings"])

    def test_pipeline_evidence_confidence_audit_trail(self):
        """Pipeline 8: Finding evidence hashing -> Confidence assignment -> Audit ledger chaining."""
        # Step 1: Calculate evidence hash
        finding_snippet = "SELECT * FROM mara WHERE matnr = 'MAT01'"
        snippet_hash = compute_sha256(finding_snippet)

        # Step 2: Assign confidence via rules
        conf, score = ConfidenceClassifierEvaluator.classify("AST_OR_SCHEMA", True, False, False)
        assert conf == ProvenanceConfidence.VERIFIED
        assert score == 1.0

        # Step 3: Record in cryptographically chained audit trail
        ev1 = AuditTrailEvaluator.create_event(
            tenant_id="tenant_alpha",
            action="FINDING_GENERATED",
            resource_type="finding",
            resource_id="find_001",
            details={"snippet_hash": snippet_hash, "confidence": conf.value, "score": score},
        )
        ev2 = AuditTrailEvaluator.create_event(
            tenant_id="tenant_alpha",
            action="REPORT_EXPORTED",
            resource_type="report",
            resource_id="rep_001",
            details={"format": "PDF"},
            previous_event_hash=ev1.event_hash,
        )
        assert AuditTrailEvaluator.verify_chain([ev1, ev2]) is True

    def test_pipeline_ai_router_to_multi_engine_dispatch(self):
        """Pipeline 9: AI Router multi-engine recommendation and verification."""
        problem = "Purchase order print layout broken and background workflow stuck in error"
        artifacts = ["po_layout.xdp", "workflow_trace.json"]
        recommended = AIProblemRouterEvaluator.route(problem, artifacts)
        assert "form_doctor" in recommended
        assert "workflow_stuck_explainer" in recommended

    def test_pipeline_change_pointer_to_api_change(self):
        """Pipeline 10: Change pointer trigger configuration aligned with API breaking diff."""
        # Step 1: Change pointer auditor verifies field configured
        cp_res = ChangePointerAuditorEvaluator.evaluate(
            bd61_active=True,
            bd50_msg_types={"MATMAS"},
            bd52_fields=[("MARA", "MATKL")],
            expected_fields=[("MARA", "MATKL")],
        )
        assert cp_res["coverage_percentage"] == 100.0

        # Step 2: API change guard checks if MATKL (MaterialGroup) property was removed from API
        base = {"paths": {}, "components": {"schemas": {"Material": {"properties": {"materialGroup": {"type": "string"}}}}}}
        cand = {"paths": {}, "components": {"schemas": {"Material": {"properties": {}}}}}
        api_res = APIChangeGuardEvaluator.evaluate(base, cand, [])
        assert any(f["code"] == "API_BREAKING_FIELD_REMOVED" for f in api_res["findings"])

    def test_pipeline_software_collection_to_extension_impact(self):
        """Pipeline 11: Circular software collection preflight coupled with extension blast radius."""
        cols = ["SC_CORE", "SC_CUSTOM"]
        deps = {"SC_CORE": ["SC_CUSTOM"], "SC_CUSTOM": ["SC_CORE"]}
        sc_res = SoftwareCollectionGuardEvaluator.evaluate(cols, deps)
        assert sc_res["has_cycles"] is True

        impact_res = ExtensionImpactEvaluator.evaluate("SC_CORE", deps)
        assert "SC_CUSTOM" in impact_res["direct_consumers"]

    def test_pipeline_mfs_blackbox_to_safe_decommission(self):
        """Pipeline 12: MFS telegram incident analysis coupled with operator user decommission."""
        telegrams = [
            {"type": "MOVE", "hu_id": "HU_99", "cp": "CP01", "time_sec": 1.0},
            {"type": "TIMEOUT", "hu_id": "HU_99", "cp": "CP01", "time_sec": 6.0},
        ]
        mfs_res = MFSBlackBoxEvaluator.evaluate(telegrams, set())
        assert mfs_res["first_causal_divergence"]["code"] == "MFS_MISSING_ACK_TIMEOUT"

        # Check operator user decommission
        decom_res = SafeDecommissionEvaluator.evaluate("PLC_OPERATOR", [], [])
        assert decom_res["safe_to_decommission"] is True

    def test_pipeline_ingestion_quarantine_to_audit_trail(self):
        """Pipeline 13: Ingestion quarantine security incident chained in audit ledger."""
        bad_xml = b'<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>'
        ok, msg = IngestionEvaluator.validate_file_format("xxe_payload.xml", bad_xml)
        assert ok is False
        assert msg == "SECURITY_XXE_DETECTED"

        # Record security audit event
        ev = AuditTrailEvaluator.create_event(
            tenant_id="tenant_beta",
            action="QUARANTINE_FILE_REJECTED",
            resource_type="quarantine_file",
            resource_id="qf_999",
            details={"file_name": "xxe_payload.xml", "reason": msg},
        )
        assert len(ev.event_hash) == 64
        assert AuditTrailEvaluator.verify_chain([ev]) is True

    def test_pipeline_multi_tenant_isolation(self):
        """Pipeline 14: Multi-tenant isolated analyses generating separate hash chains."""
        ev_t1 = AuditTrailEvaluator.create_event("org_tenant_1", "RUN", "job", "j1", {"data": 100})
        ev_t2 = AuditTrailEvaluator.create_event("org_tenant_2", "RUN", "job", "j2", {"data": 200})

        assert ev_t1.tenant_id != ev_t2.tenant_id
        assert ev_t1.event_hash != ev_t2.event_hash
        assert AuditTrailEvaluator.verify_chain([ev_t1]) is True
        assert AuditTrailEvaluator.verify_chain([ev_t2]) is True

    def test_pipeline_gap_radar_to_clean_core_guard(self):
        """Pipeline 15: Gap Radar recommendation validated against Clean Core rules."""
        gap_res = SAPGapRadarEvaluator.evaluate("Direct DB write into table BSEG without standard BAPI", "2023")
        assert gap_res["verdict"] == "BLOCKED_CLEAN_CORE_VIOLATION"

        # Clean core guard confirms the violation on the actual ABAP statement
        code = "UPDATE bseg SET dmbtr = 500 WHERE belnr = '1000'."
        cc_res = CleanCoreObjectGuardEvaluator.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" and f["table"] == "BSEG" for f in cc_res["findings"])
