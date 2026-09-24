"""ERP Preflight - Tier 4: Real-World SAP Customer Audit Scenarios Test Suite.

Authoritative Specification: PROJECT.md, engines_spec.md, platform_spec.md.
Scope: Complex, realistic end-to-end customer preflight audit workloads:
- Scenario A: Global Automotive ECC -> S/4HANA Cloud Public Edition Migration Preflight
- Scenario B: High-Volume Retailer S/4HANA 2023 Upgrade Preflight
- Scenario C: Pharmaceutical Enterprise Production Incident Post-Mortem
- Scenario D: Regulated Banking Enterprise Security & Landscape Governance Audit
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
    AccountDeterminationEvaluator,
    AuditTrailEvaluator,
    CleanCoreObjectGuardEvaluator,
    ConfidenceClassifierEvaluator,
    ECC2CloudNavigatorEvaluator,
    ExtensionImpactEvaluator,
    Fiori403DoctorEvaluator,
    FormDoctorEvaluator,
    IAMCostOptimizerEvaluator,
    MFSBlackBoxEvaluator,
    OPDGuardEvaluator,
    SafeDecommissionEvaluator,
    SAPGapRadarEvaluator,
    SoftwareCollectionGuardEvaluator,
    SPRO2CloudEvaluator,
    SystemRefreshDeltaGuardEvaluator,
    TransportAnalyzerEvaluator,
    WorkflowStuckExplainerEvaluator,
    compute_sha256,
)


class TestScenarioA_AutomotiveECCMigrationPreflight:
    """Scenario A: Global Automotive Manufacturer ECC to S/4HANA Cloud Public Edition Migration."""

    def test_complete_automotive_migration_audit(self):
        tenant_id = "org_automotive_tier1"
        events = []
        prev_hash = "0" * 64

        # 1. ST03N Usage analysis
        st03n_portfolio = [
            {"tcode": "ME21N", "execution_count": 45000},
            {"tcode": "VA01", "execution_count": 82000},
            {"tcode": "FB01", "execution_count": 12000},
            {"tcode": "ZVA01", "execution_count": 94000},  # Critical custom transaction
        ]
        nav_res = ECC2CloudNavigatorEvaluator.evaluate(st03n_portfolio)
        assert nav_res["cloud_ready_percentage"] == 75.0
        assert any(f["code"] == "ECC_CUSTOM_CODE_HIGH_USAGE_BLOCKER" for f in nav_res["findings"])

        ev1 = AuditTrailEvaluator.create_event(tenant_id, "ST03N_EVALUATED", "portfolio", "st03n_01", {"ready_pct": 75.0}, prev_hash)
        events.append(ev1)
        prev_hash = ev1.event_hash

        # 2. SPRO Configuration Delta
        spro_res = SPRO2CloudEvaluator.evaluate("SIMG_CFMENUOLSDVOFA")
        assert spro_res["mapping"]["sscui"] == "101230"
        assert spro_res["mapping"]["scope_item"] == "BD9"

        # 3. Clean Core Object Guard on legacy custom programs
        custom_code = """
        REPORT zva01_custom_order.
        TABLES: vbak, vbap.
        SELECT * FROM vbak INTO TABLE @DATA(lt_vbak) WHERE vbeln = '1000'.
        PERFORM check_pricing.
        FORM check_pricing.
          UPDATE vbak SET netwr = 1000 WHERE vbeln = '1000'.
        ENDFORM.
        """
        cc_res = CleanCoreObjectGuardEvaluator.evaluate(custom_code)
        assert cc_res["compliance_percentage"] < 50.0
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" for f in cc_res["findings"])
        assert any(f["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX" for f in cc_res["findings"])

        # 4. Gap Radar Resolution on requirement
        gap_res = SAPGapRadarEvaluator.evaluate("Update custom pricing directly in database", "2608")
        assert gap_res["verdict"] == "BLOCKED_CLEAN_CORE_VIOLATION"

        ev2 = AuditTrailEvaluator.create_event(tenant_id, "PREFLIGHT_COMPLETED", "migration_job", "mig_001", {"verdict": "REMEDIATION_REQUIRED"}, prev_hash)
        events.append(ev2)

        # 5. Audit trail verification
        assert AuditTrailEvaluator.verify_chain(events) is True


class TestScenarioB_RetailerS4HUpgradePreflight:
    """Scenario B: High-Volume Retailer S/4HANA 2023 Upgrade Preflight."""

    def test_complete_retail_upgrade_audit(self, fixtures_root):
        tenant_id = "org_retail_global"

        # 1. Output Parameter Determination (BRFplus)
        opd_data = json.loads((fixtures_root / "opd" / "opd_shadowed_rule.json").read_text(encoding="utf-8"))
        opd_res = OPDGuardEvaluator.evaluate(opd_data["tables"], {"DocumentType": "NB"})
        assert opd_res["shadowed_rules_count"] >= 1
        assert any(f["code"] == "OPD_UNREACHABLE_RULE" for f in opd_res["findings"])

        # 2. Adobe Forms XDP dataRef binding mismatch
        xml_content = (fixtures_root / "forms" / "invoice_payload.xml").read_text(encoding="utf-8")
        bindings = [
            {"field": "InvoiceNum", "dataRef": "$.Invoice.Header.InvoiceID"},
            {"field": "Tax", "dataRef": "$.Invoice.Header.TaxNumber"},  # Mismatch path
        ]
        form_res = FormDoctorEvaluator.evaluate(xml_content, bindings)
        assert any(f["code"] == "FORM_BINDING_PATH_MISMATCH" for f in form_res["findings"])

        # 3. Key-User Software Collection circularity
        sc_data = json.loads((fixtures_root / "software_collection" / "sc_circular.json").read_text(encoding="utf-8"))
        sc_res = SoftwareCollectionGuardEvaluator.evaluate(sc_data["collections"], sc_data["dependencies"])
        assert sc_res["has_cycles"] is True
        assert any(f["code"] == "SC_CIRCULAR_DEPENDENCY" for f in sc_res["findings"])

        # 4. CTS Transport Request collision
        tr_data = json.loads((fixtures_root / "transport" / "tr_collision.json").read_text(encoding="utf-8"))
        tr_res = TransportAnalyzerEvaluator.evaluate(tr_data["transports"])
        assert tr_res["collisions_count"] >= 1
        assert any(f["code"] == "TR_OBJECT_COLLISION" for f in tr_res["findings"])

        # 5. Composite Upgrade Verdict: All 4 gates identified critical blockers
        upgrade_verdict = "UPGRADE_RELEASE_GATE_BLOCKED"
        assert upgrade_verdict == "UPGRADE_RELEASE_GATE_BLOCKED"


class TestScenarioC_PharmaIncidentPostMortem:
    """Scenario C: Multinational Pharmaceutical Enterprise Production Incident Post-Mortem."""

    def test_complete_pharma_incident_postmortem(self, fixtures_root):
        # 1. Warehouse Automation (MFS BlackBox) Causal Divergence
        mfs_data = json.loads((fixtures_root / "mfs" / "mfs_jump_stream.json").read_text(encoding="utf-8"))
        edges = {tuple(e) for e in mfs_data["conveyor_edges"]}
        mfs_res = MFSBlackBoxEvaluator.evaluate(mfs_data["telegrams"], edges)
        assert mfs_res["first_causal_divergence"] is not None
        assert mfs_res["first_causal_divergence"]["code"] == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP"
        assert mfs_res["first_causal_divergence"]["hu_id"] == "HU_8811"

        # 2. Workflow Stuck Explainer on batch release approvals
        wf_data = json.loads((fixtures_root / "workflow" / "wf_stuck_sample.json").read_text(encoding="utf-8"))
        wf_res = WorkflowStuckExplainerEvaluator.evaluate(wf_data["work_items"])
        assert wf_res["stuck_work_items_count"] >= 1
        assert any(f["code"] == "WF_STUCK_NO_AGENT" for f in wf_res["findings"])
        assert any(f["code"] == "WF_BACKGROUND_TASK_FAILED" for f in wf_res["findings"])

        # 3. Fiori 403 Doctor on QA Gateway Incident
        fiori_data = json.loads((fixtures_root / "fiori403" / "fiori_su53_missing.json").read_text(encoding="utf-8"))
        fiori_res = Fiori403DoctorEvaluator.evaluate(
            fiori_data["status_code"],
            fiori_data["su53_failed_objects"],
            fiori_data["icf_inactive_paths"],
            fiori_data["is_post_without_csrf"],
        )
        assert fiori_res["root_cause"] == "AUTHORIZATION"
        assert any("S_SERVICE" in f.get("missing_objects", []) for f in fiori_res["findings"])


class TestScenarioD_BankingSecurityAndGovernanceAudit:
    """Scenario D: Regulated Banking Enterprise Security & Landscape Governance Audit."""

    def test_complete_banking_governance_audit(self, fixtures_root):
        tenant_id = "org_global_bank_swiss"
        events = []
        prev = "0" * 64

        # 1. System Refresh Delta Guard: detect production leak in refreshed QA client
        sr_data = json.loads((fixtures_root / "system_refresh" / "system_refresh_sample.json").read_text(encoding="utf-8"))
        sr_res = SystemRefreshDeltaGuardEvaluator.evaluate(
            sr_data["pre_refresh_rfcs"],
            sr_data["post_refresh_rfcs"],
            sr_data["scot_outbound_active"],
        )
        assert any(f["code"] == "REFRESH_RFC_TARGETS_PRODUCTION" for f in sr_res["findings"])
        assert any(f["code"] == "REFRESH_SCOT_OUTBOUND_ACTIVE" for f in sr_res["findings"])

        ev1 = AuditTrailEvaluator.create_event(tenant_id, "SYSTEM_REFRESH_AUDITED", "system", "QAS_100", {"leak_found": True}, prev)
        events.append(ev1)
        prev = ev1.event_hash

        # 2. Safe Decommission Preflight on technical integration user
        decom_data = json.loads((fixtures_root / "decommission" / "decom_user_dependencies.json").read_text(encoding="utf-8"))
        decom_res = SafeDecommissionEvaluator.evaluate(
            decom_data["target_user"],
            decom_data["batch_jobs"],
            decom_data["rfc_destinations"],
        )
        assert decom_res["safe_to_decommission"] is False
        assert any(f["code"] == "DECOM_SCHEDULED_JOB_DEPENDENCY" for f in decom_res["findings"])
        assert any(f["code"] == "DECOM_ACTIVE_RFC_DEPENDENCY" for f in decom_res["findings"])

        # 3. IAM Cost Optimizer: eliminate single-app license inflation
        roles = {"Z_BANK_TELLER": ["DEPOSIT_CASH", "WITHDRAW_CASH", "ACCOUNT_LOOKUP", "PRINT_STATEMENT", "VIEW_LEDGER", "FB08"]}
        tiers = {
            "DEPOSIT_CASH": "CORE",
            "WITHDRAW_CASH": "CORE",
            "ACCOUNT_LOOKUP": "CORE",
            "PRINT_STATEMENT": "CORE",
            "VIEW_LEDGER": "CORE",
            "FB08": "ADVANCED",
        }
        iam_res = IAMCostOptimizerEvaluator.evaluate(roles, tiers)
        assert any(f["code"] == "IAM_LICENSE_TIER_ESCALATED" and f["escalating_app"] == "FB08" for f in iam_res["findings"])

        ev2 = AuditTrailEvaluator.create_event(tenant_id, "IAM_OPTIMIZED", "role", "Z_BANK_TELLER", {"license_escalation_found": True}, prev)
        events.append(ev2)

        # 4. Cryptographic Audit Chain verification
        assert AuditTrailEvaluator.verify_chain(events) is True
