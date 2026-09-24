"""Adversarial Empirical Stress Test Suite for Domain 1 Preflight Engines.

Engines Tested:
1. Custom Field Flow Doctor (CUSTOM_FIELD_FLOW_DOCTOR)
2. Extension Impact Guard (EXTENSION_IMPACT_GUARD)

Governing Axioms:
- Axiom 2: "An engine without deterministic logic/evidence/fixtures is not complete."
- 14-Point Engine Anatomy
- Strict Boundary Testing: CHAR 10 -> CHAR 9 truncation vs CHAR 10 -> CHAR 10
- Graph Stress: 2-node, 3-node, 10-node, entangled cycles
- Scalability & Bounds: 100+ node wide/deep DAGs, blast radius strictly in [0.0, 100.0]
- Active Consumer Deletion Gating: safe_to_delete=False vs safe_to_delete=True
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List
import pytest

import src.engines  # Registers all engines into EngineRegistry
from src.core.runner import EngineRunner
from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
    TrustLevel,
)
from src.models.finding import Finding
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse

DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_PROJECT_ID = "00000000-0000-0000-0000-000000000002"


def make_request(
    job_id: str,
    engine_type: EngineType,
    raw_content: str = "",
    configuration: Dict[str, Any] | None = None,
    target_release: str = "S4H_2023",
    artifact_type: ArtifactType = ArtifactType.JSON,
) -> AnalysisRequest:
    """Helper to build validated AnalysisRequest."""
    return AnalysisRequest(
        job_id=job_id,
        tenant_id=DEFAULT_TENANT_ID,
        project_id=DEFAULT_PROJECT_ID,
        engine_type=engine_type,
        target_release=target_release,
        artifact_type=artifact_type,
        raw_content=raw_content,
        configuration=configuration or {},
    )


# ==============================================================================
# PART 1: CUSTOM FIELD FLOW DOCTOR ADVERSARIAL STRESS TESTS
# ==============================================================================

class TestAdversarialCustomFieldFlow:
    """Adversarial stress harness for Custom Field Flow Doctor."""

    @pytest.mark.asyncio
    async def test_multi_hop_golden_full_chain_with_active_badi(self):
        """Happy Path Multi-hop: PREQ -> PO -> INV -> JE with active BAdI."""
        payload = {
            "field_name": "YY1_COST_CENTER_EXT",
            "hops": [
                ["MM_PURCHASE_REQUISITION_ITEM", "MM_PURCHASE_ORDER_ITEM"],
                ["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"],
                ["MM_SUPPLIER_INVOICE_ITEM", "FI_JOURNAL_ENTRY_ITEM"],
            ],
            "field_definitions": {
                "MM_PURCHASE_REQUISITION_ITEM": {"type": "CHAR", "length": 20},
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 20},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 20},
                "FI_JOURNAL_ENTRY_ITEM": {"type": "CHAR", "length": 20},
            },
            "active_badis": ["BADI_FINS_ACDOC_EXT_PERSISTENCE"],
        }

        req = make_request(
            job_id="11111111-cff0-0001-0000-000000000001",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload),
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert res.metrics.additional_metrics["total_hops"] == 3
        assert res.metrics.additional_metrics["supported_hops"] == 2
        assert res.metrics.additional_metrics["custom_logic_hops"] == 1
        assert res.metrics.additional_metrics["blocked_hops"] == 0

        # Assert no blockers or critical errors
        critical_or_blocker = [f for f in res.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]
        assert len(critical_or_blocker) == 0

        # Assert BAdI active info finding emitted
        badi_info = [f for f in res.findings if f.rule_id == "FIELD_PROPAGATION_REQUIRES_BADI"]
        assert len(badi_info) == 1
        assert badi_info[0].severity == Severity.INFO
        assert badi_info[0].confidence == ConfidenceClass.VERIFIED
        assert badi_info[0].confidence_score == 1.0

    @pytest.mark.asyncio
    async def test_multi_hop_missing_required_badi_triggers_major_finding(self):
        """Negative Test: INV -> JE hop missing BAdI implementation."""
        payload = {
            "field_name": "YY1_COST_CENTER_EXT",
            "hops": [
                ["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"],
                ["MM_SUPPLIER_INVOICE_ITEM", "FI_JOURNAL_ENTRY_ITEM"],
            ],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 20},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 20},
                "FI_JOURNAL_ENTRY_ITEM": {"type": "CHAR", "length": 20},
            },
            "active_badis": [],  # Required BADI_FINS_ACDOC_EXT_PERSISTENCE is missing
        }

        req = make_request(
            job_id="11111111-cff0-0001-0000-000000000002",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload),
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert res.metrics.additional_metrics["custom_logic_hops"] == 1

        missing_badi = [f for f in res.findings if f.rule_id == "FIELD_BADI_REQUIRED_NOT_FOUND"]
        assert len(missing_badi) == 1
        assert missing_badi[0].severity == Severity.MAJOR
        assert missing_badi[0].confidence == ConfidenceClass.VERIFIED
        assert "BADI_FINS_ACDOC_EXT_PERSISTENCE" in missing_badi[0].description
        assert len(missing_badi[0].evidence) >= 1
        assert len(missing_badi[0].evidence[0].sha256) == 64

    @pytest.mark.asyncio
    async def test_boundary_length_truncation_char10_to_char9_vs_char10(self):
        """Boundary Stress: Exact length CHAR 10 -> CHAR 10 vs Truncation CHAR 10 -> CHAR 9."""
        # 1. Truncation: CHAR 10 -> CHAR 9
        payload_trunc = {
            "field_name": "YY1_BOUNDARY_FIELD",
            "hops": [["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"]],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 10},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 9},  # 1 char smaller!
            },
        }

        req_trunc = make_request(
            job_id="11111111-cff0-0001-0000-000000000003",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload_trunc),
        )
        res_trunc = await EngineRunner.execute(req_trunc)
        trunc_findings = [f for f in res_trunc.findings if f.rule_id == "FIELD_TYPE_MISMATCH"]
        assert len(trunc_findings) == 1
        assert trunc_findings[0].severity == Severity.MAJOR
        assert "truncat" in trunc_findings[0].description.lower() or "truncat" in trunc_findings[0].title.lower()
        assert trunc_findings[0].technical_details["source_length"] == 10
        assert trunc_findings[0].technical_details["target_length"] == 9

        # 2. Exact Match: CHAR 10 -> CHAR 10
        payload_exact = {
            "field_name": "YY1_BOUNDARY_FIELD",
            "hops": [["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"]],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 10},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 10},  # Exactly identical
            },
        }

        req_exact = make_request(
            job_id="11111111-cff0-0001-0000-000000000004",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload_exact),
        )
        res_exact = await EngineRunner.execute(req_exact)
        mismatch_exact = [f for f in res_exact.findings if f.rule_id == "FIELD_TYPE_MISMATCH"]
        assert len(mismatch_exact) == 0  # Zero truncation errors on exact length

        # 3. Widening / Expansion: CHAR 9 -> CHAR 10 (Target is larger)
        payload_widen = {
            "field_name": "YY1_BOUNDARY_FIELD",
            "hops": [["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"]],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 9},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 10},  # Target has extra space
            },
        }

        req_widen = make_request(
            job_id="11111111-cff0-0001-0000-000000000005",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload_widen),
        )
        res_widen = await EngineRunner.execute(req_widen)
        mismatch_widen = [f for f in res_widen.findings if f.rule_id == "FIELD_TYPE_MISMATCH"]
        assert len(mismatch_widen) == 0  # Expansion is safe, no mismatch finding

    @pytest.mark.asyncio
    async def test_boundary_decimal_and_numc_truncation_and_type_mismatches(self):
        """Boundary Stress: Numeric truncations (NUMC, DEC) and cross-type mismatches."""
        # NUMC 10 -> NUMC 9
        payload_numc = {
            "field_name": "YY1_SERIAL_NUMC",
            "hops": [["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"]],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "NUMC", "length": 10},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "NUMC", "length": 9},
            },
        }
        res_numc = await EngineRunner.execute(make_request(
            job_id="11111111-cff0-0001-0000-000000000006",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload_numc),
        ))
        assert any(
            f.rule_id == "FIELD_TYPE_MISMATCH" and ("truncat" in f.description.lower() or "truncat" in f.title.lower())
            for f in res_numc.findings
        )

        # Type Mismatch: CHAR 10 -> DEC 10
        payload_type = {
            "field_name": "YY1_MIXED_TYPE",
            "hops": [["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"]],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 10},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "DEC", "length": 10},
            },
        }
        res_type = await EngineRunner.execute(make_request(
            job_id="11111111-cff0-0001-0000-000000000007",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload_type),
        ))
        type_mismatch = [f for f in res_type.findings if f.rule_id == "FIELD_TYPE_MISMATCH"]
        assert len(type_mismatch) == 1
        assert "incompatible" in type_mismatch[0].description.lower()
        assert type_mismatch[0].technical_details["source_type"] == "CHAR"
        assert type_mismatch[0].technical_details["target_type"] == "DEC"

    @pytest.mark.asyncio
    async def test_architecturally_blocked_non_standard_jumps(self):
        """Architectural Invariant Test: Direct PO -> JE and SO -> JE jumps are explicitly blocked."""
        payload = {
            "field_name": "YY1_ILLEGAL_JUMP",
            "hops": [
                ["MM_PURCHASE_ORDER_ITEM", "FI_JOURNAL_ENTRY_ITEM"],
                ["SD_SALES_ORDER_ITEM", "FI_JOURNAL_ENTRY_ITEM"],
            ],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 15},
                "SD_SALES_ORDER_ITEM": {"type": "CHAR", "length": 15},
                "FI_JOURNAL_ENTRY_ITEM": {"type": "CHAR", "length": 15},
            },
        }

        res = await EngineRunner.execute(make_request(
            job_id="11111111-cff0-0001-0000-000000000008",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload),
        ))

        blocked_findings = [f for f in res.findings if f.rule_id == "FIELD_PROPAGATION_BLOCKED"]
        assert len(blocked_findings) == 2
        for bf in blocked_findings:
            assert bf.severity == Severity.CRITICAL
            assert bf.confidence == ConfidenceClass.VERIFIED
            assert bf.confidence_score == 1.0
            assert "Clean Core" in bf.description or "architectural" in bf.description.lower()

        assert res.metrics.additional_metrics["blocked_hops"] == 2

    @pytest.mark.asyncio
    async def test_unrecognized_non_standard_context_jumps(self):
        """Negative Test: Unrecognized cross-domain hops fail closed with RULE_DERIVED CRITICAL finding."""
        payload = {
            "field_name": "YY1_UNKNOWN_JUMP",
            "hops": [
                ["MM_PURCHASE_ORDER_ITEM", "SD_BILLING_DOC_ITEM"],
                ["CUSTOM_CONTEXT_ALPHA", "CUSTOM_CONTEXT_BETA"],
            ],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 10},
                "SD_BILLING_DOC_ITEM": {"type": "CHAR", "length": 10},
                "CUSTOM_CONTEXT_ALPHA": {"type": "CHAR", "length": 10},
                "CUSTOM_CONTEXT_BETA": {"type": "CHAR", "length": 10},
            },
        }

        res = await EngineRunner.execute(make_request(
            job_id="11111111-cff0-0001-0000-000000000009",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload),
        ))

        unrec_findings = [f for f in res.findings if f.rule_id == "FIELD_PROPAGATION_BLOCKED"]
        assert len(unrec_findings) == 2
        for uf in unrec_findings:
            assert uf.severity == Severity.CRITICAL
            assert uf.confidence == ConfidenceClass.RULE_DERIVED
            assert uf.confidence_score == 0.85
            assert "unsupported document flow" in uf.description.lower()

        assert res.metrics.additional_metrics["blocked_hops"] == 2

    @pytest.mark.asyncio
    async def test_missing_target_context_definitions(self):
        """Negative Test: Propagation scheduled into a context that has no field definition."""
        payload = {
            "field_name": "YY1_ORPHAN_FLOW",
            "hops": [
                ["MM_PURCHASE_REQUISITION_ITEM", "MM_PURCHASE_ORDER_ITEM"],
                ["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"],  # Missing invoice def!
            ],
            "field_definitions": {
                "MM_PURCHASE_REQUISITION_ITEM": {"type": "CHAR", "length": 15},
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 15},
                # MM_SUPPLIER_INVOICE_ITEM omitted intentionally
            },
        }

        res = await EngineRunner.execute(make_request(
            job_id="11111111-cff0-0001-0000-000000000010",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload),
        ))

        missing_ctx = [f for f in res.findings if f.rule_id == "FIELD_MISSING_TARGET_CONTEXT"]
        assert len(missing_ctx) == 1
        assert missing_ctx[0].severity == Severity.CRITICAL
        assert missing_ctx[0].confidence == ConfidenceClass.VERIFIED
        assert "MM_SUPPLIER_INVOICE_ITEM" in missing_ctx[0].title
        assert res.metrics.additional_metrics["supported_hops"] == 1
        assert res.metrics.additional_metrics["blocked_hops"] == 1

    @pytest.mark.asyncio
    async def test_inactive_extension_scenario_governance(self):
        """Governance Test: Supported hop flagged when scenario is not in active_scenarios."""
        payload = {
            "field_name": "YY1_INACTIVE_SCENARIO",
            "hops": [["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"]],
            "field_definitions": {
                "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 10},
                "MM_SUPPLIER_INVOICE_ITEM": {"type": "CHAR", "length": 10},
            },
            "active_scenarios": ["BUS_SCENARIO_SO_TO_INV"],  # PO_TO_INV is omitted
        }

        res = await EngineRunner.execute(make_request(
            job_id="11111111-cff0-0001-0000-000000000011",
            engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
            raw_content=json.dumps(payload),
        ))

        scenario_blocked = [f for f in res.findings if f.rule_id == "FIELD_PROPAGATION_BLOCKED"]
        assert len(scenario_blocked) == 1
        assert scenario_blocked[0].severity == Severity.MAJOR
        assert "BUS_SCENARIO_PO_TO_INV" in scenario_blocked[0].title
        assert res.metrics.additional_metrics["blocked_hops"] == 1

    @pytest.mark.asyncio
    async def test_field_prefix_naming_adversarial_cases(self):
        """Adversarial Test: Various invalid naming schemes fail prefix validation."""
        invalid_names = [
            "Z_PO_CUSTOMER_REF",       # Classic on-prem Z prefix
            "YY1_",                     # Empty suffix
            "ZZ1_",                     # Empty suffix
            "yy1_lower_case_field",     # Lowercase characters
            "YY1_THIS_NAME_IS_OVER_THIRTY_CHARACTERS_LONG_FAIL",  # > 30 chars
            "MY_CUSTOM_FIELD",          # No SAP prefix
        ]

        for idx, inv_name in enumerate(invalid_names):
            payload = {
                "field_name": inv_name,
                "hops": [],
                "field_definitions": {},
            }
            res = await EngineRunner.execute(make_request(
                job_id=f"11111111-cff0-0001-0000-{idx:012x}",
                engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
                raw_content=json.dumps(payload),
            ))
            prefix_findings = [f for f in res.findings if f.rule_id == "FIELD_NAME_INVALID_PREFIX"]
            assert len(prefix_findings) == 1
            assert prefix_findings[0].severity == Severity.MAJOR
            assert prefix_findings[0].confidence == ConfidenceClass.VERIFIED

        # Valid names should not emit prefix finding
        for val_name in ["YY1_PO_REF_10", "ZZ1_INVOICE_DISPATCH_CODE"]:
            res_val = await EngineRunner.execute(make_request(
                job_id="11111111-cff0-0001-0000-ffffffffffff",
                engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
                raw_content=json.dumps({"field_name": val_name, "hops": []}),
            ))
            assert len([f for f in res_val.findings if f.rule_id == "FIELD_NAME_INVALID_PREFIX"]) == 0


# ==============================================================================
# PART 2: EXTENSION IMPACT GUARD ADVERSARIAL STRESS TESTS
# ==============================================================================

class TestAdversarialExtensionImpact:
    """Adversarial stress harness for Extension Impact Guard."""

    @pytest.mark.asyncio
    async def test_2_node_cycle_detection(self):
        """Negative Cycle Test: Direct 2-node mutual recursion A -> B -> A."""
        payload = {
            "target_object": "CDS_VIEW_A",
            "dependencies": {
                "CDS_VIEW_A": ["CDS_VIEW_B"],
                "CDS_VIEW_B": ["CDS_VIEW_A"],
            },
        }

        res = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000001",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload),
        ))

        cycles = [f for f in res.findings if f.rule_id == "EXT_CYCLIC_DEPENDENCY_DETECTED"]
        assert len(cycles) >= 1
        assert cycles[0].severity == Severity.BLOCKER
        assert cycles[0].confidence == ConfidenceClass.VERIFIED
        assert res.metrics.additional_metrics["cycles_count"] >= 1

    @pytest.mark.asyncio
    async def test_3_node_and_10_node_ring_cycle_detection(self):
        """Stress Cycle Test: 3-node cycle and large 10-node cycle ring."""
        # 1. 3-Node Cycle: A -> B -> C -> A
        payload_3 = {
            "target_object": "NODE_1",
            "dependencies": {
                "NODE_1": ["NODE_2"],
                "NODE_2": ["NODE_3"],
                "NODE_3": ["NODE_1"],
            },
        }
        res_3 = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000002",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload_3),
        ))
        assert any(f.rule_id == "EXT_CYCLIC_DEPENDENCY_DETECTED" for f in res_3.findings)

        # 2. 10-Node Cycle Ring: R0 -> R1 -> R2 -> ... -> R9 -> R0
        ring_deps: Dict[str, List[str]] = {}
        for i in range(10):
            nxt = f"RING_{(i + 1) % 10}"
            ring_deps[f"RING_{i}"] = [nxt]

        payload_ring = {
            "target_object": "RING_0",
            "dependencies": ring_deps,
        }
        res_ring = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000003",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload_ring),
        ))
        ring_cycles = [f for f in res_ring.findings if f.rule_id == "EXT_CYCLIC_DEPENDENCY_DETECTED"]
        assert len(ring_cycles) >= 1
        assert ring_cycles[0].severity == Severity.BLOCKER

    @pytest.mark.asyncio
    async def test_self_loop_and_entangled_multi_branch_cycles(self):
        """Stress Cycle Test: Self-loop A -> A and complex entangled multi-branch cycles."""
        # 1. Self Loop: CDS_SELF -> CDS_SELF
        payload_self = {
            "target_object": "CDS_SELF",
            "dependencies": {"CDS_SELF": ["CDS_SELF"]},
        }
        res_self = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000004",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload_self),
        ))
        assert any(f.rule_id == "EXT_CYCLIC_DEPENDENCY_DETECTED" for f in res_self.findings)

        # 2. Entangled Multi-Branch Cycles:
        # Cycle 1: A -> B -> C -> A
        # Cycle 2: B -> D -> C -> A
        # Cycle 3: D -> E -> D
        payload_entangled = {
            "target_object": "ENT_A",
            "dependencies": {
                "ENT_A": ["ENT_B"],
                "ENT_B": ["ENT_C", "ENT_D"],
                "ENT_C": ["ENT_A"],
                "ENT_D": ["ENT_C", "ENT_E"],
                "ENT_E": ["ENT_D"],
            },
        }
        res_ent = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000005",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload_entangled),
        ))
        assert res_ent.status == AnalysisStatus.COMPLETED
        assert res_ent.metrics.additional_metrics["cycles_count"] >= 2
        assert any(f.rule_id == "EXT_CYCLIC_DEPENDENCY_DETECTED" for f in res_ent.findings)

    @pytest.mark.asyncio
    async def test_disconnected_cycle_detected_while_evaluating_clean_target(self):
        """Adversarial Test: Target object has clean tree, but disconnected component has a cycle."""
        payload = {
            "target_object": "YY1_CLEAN_TARGET",
            "dependencies": {
                "YY1_CLEAN_TARGET": ["CDS_CLEAN_CONSUMER"],
                "CDS_CLEAN_CONSUMER": [],
                # Disconnected cyclic island:
                "ISLAND_X": ["ISLAND_Y"],
                "ISLAND_Y": ["ISLAND_X"],
            },
        }
        res = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000006",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload),
        ))
        # Cycle in disconnected island must still be caught!
        assert any(f.rule_id == "EXT_CYCLIC_DEPENDENCY_DETECTED" for f in res.findings)
        # And target object consumers are still evaluated
        assert res.metrics.additional_metrics["direct_consumers_count"] == 1

    @pytest.mark.asyncio
    async def test_large_dag_scaling_120_nodes_wide(self):
        """Scalability Stress: 1 target consumed by 120 direct consumers.

        Verifies:
        - Blast radius score is strictly clamped to 100.0 (does not overflow).
        - Bounds: 0.0 <= score <= 100.0.
        - Emits EXT_HIGH_BLAST_RADIUS_WARNING (MAJOR).
        - Execution finishes rapidly (< 500ms).
        """
        consumers = [f"CDS_CONSUMER_{i:03d}" for i in range(120)]
        payload = {
            "target_object": "YY1_CORE_MASTER_DATA",
            "dependencies": {
                "YY1_CORE_MASTER_DATA": consumers,
            },
        }
        for c in consumers:
            payload["dependencies"][c] = []

        start = time.perf_counter()
        res = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000007",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload),
        ))
        duration = time.perf_counter() - start

        assert res.status == AnalysisStatus.COMPLETED
        score = res.metrics.additional_metrics["blast_radius_score"]

        # Strict bound check: 0.0 <= score <= 100.0
        assert 0.0 <= score <= 100.0
        assert score == 100.0  # Clamped strictly at maximum
        assert res.metrics.additional_metrics["direct_consumers_count"] == 120
        assert res.metrics.additional_metrics["transitive_consumers_count"] == 120
        assert res.metrics.additional_metrics["safe_to_delete"] is False

        # Must emit high blast radius warning
        high_blast = [f for f in res.findings if f.rule_id == "EXT_HIGH_BLAST_RADIUS_WARNING"]
        assert len(high_blast) == 1
        assert high_blast[0].severity == Severity.MAJOR

        # Must emit delete blocked finding
        delete_blocked = [f for f in res.findings if f.rule_id == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS"]
        assert len(delete_blocked) == 1
        assert delete_blocked[0].severity == Severity.CRITICAL

        # Performance constraint: under 500ms
        assert duration < 0.50

    @pytest.mark.asyncio
    async def test_large_dag_deep_linear_chain_120_levels(self):
        """Scalability Stress: Deep 120-level transitive dependency chain.

        Verifies:
        - Depth attenuation (0.85 ** depth) dampens distant impact.
        - BFS handles 120 recursion levels without stack exhaustion.
        - Score strictly bounded in [0.0, 100.0].
        """
        chain_len = 120
        deps: Dict[str, List[str]] = {}
        for i in range(chain_len):
            src = f"NODE_L{i:03d}"
            dst = f"NODE_L{i+1:03d}"
            deps[src] = [dst]
        deps[f"NODE_L{chain_len:03d}"] = []

        payload = {
            "target_object": "NODE_L000",
            "dependencies": deps,
        }

        start = time.perf_counter()
        res = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000008",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload),
        ))
        duration = time.perf_counter() - start

        assert res.status == AnalysisStatus.COMPLETED
        assert res.metrics.additional_metrics["direct_consumers_count"] == 1
        assert res.metrics.additional_metrics["transitive_consumers_count"] == 120

        score = res.metrics.additional_metrics["blast_radius_score"]
        assert 0.0 <= score <= 100.0
        assert duration < 0.50

    @pytest.mark.asyncio
    async def test_complex_multi_level_dag_200_nodes(self):
        """Scalability Stress: 200-node multi-tier layered DAG (5 layers of 40 nodes)."""
        num_layers = 5
        nodes_per_layer = 40
        deps: Dict[str, List[str]] = {"YY1_ROOT": []}

        # Layer 0 nodes consume YY1_ROOT
        for j in range(nodes_per_layer):
            l0_name = f"L0_N{j:02d}"
            deps["YY1_ROOT"].append(l0_name)
            deps[l0_name] = []

        # Layer i -> Layer i+1 edges
        for layer in range(num_layers - 1):
            for j in range(nodes_per_layer):
                curr = f"L{layer}_N{j:02d}"
                nxt = f"L{layer+1}_N{j:02d}"
                deps.setdefault(curr, []).append(nxt)
                deps.setdefault(nxt, [])

        payload = {
            "target_object": "YY1_ROOT",
            "dependencies": deps,
        }

        res = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000009",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload),
        ))

        assert res.status == AnalysisStatus.COMPLETED
        # No cycles in clean DAG
        assert res.metrics.additional_metrics["cycles_count"] == 0
        assert res.metrics.additional_metrics["transitive_consumers_count"] == num_layers * nodes_per_layer
        score = res.metrics.additional_metrics["blast_radius_score"]
        assert 0.0 <= score <= 100.0
        assert score == 100.0

    @pytest.mark.asyncio
    async def test_active_consumer_deletion_gating_boundary(self):
        """Security/Safety Gate: Deletion strictly blocked when consumers exist; safe when isolated or inactive."""
        # 1. Blocked Deletion with Active Consumer (Default manifest format)
        payload_blocked = {
            "target_object": "YY1_ACTIVE_FIELD",
            "action": "DELETE",
            "dependencies": {
                "YY1_ACTIVE_FIELD": ["CDS_VIEW_ACTIVE"],
                "CDS_VIEW_ACTIVE": [],
            },
        }
        res_blocked = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000010",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload_blocked),
        ))
        assert res_blocked.metrics.additional_metrics["safe_to_delete"] is False
        assert any(f.rule_id == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS" for f in res_blocked.findings)
        assert not any(f.rule_id == "EXT_SAFE_TO_DELETE" for f in res_blocked.findings)

        # 2. Safe Deletion with Isolated Object (0 consumers)
        payload_isolated = {
            "target_object": "YY1_ISOLATED_FIELD",
            "action": "DELETE",
            "dependencies": {
                "YY1_ISOLATED_FIELD": [],
                "OTHER_OBJECT": ["CDS_VIEW_OTHER"],
            },
        }
        res_isolated = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000011",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload_isolated),
        ))
        assert res_isolated.metrics.additional_metrics["safe_to_delete"] is True
        assert res_isolated.metrics.additional_metrics["blast_radius_score"] == 0.0
        assert any(f.rule_id == "EXT_SAFE_TO_DELETE" for f in res_isolated.findings)
        assert not any(f.rule_id == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS" for f in res_isolated.findings)

        # 3. Safe Deletion with INACTIVE Consumer via extensions manifest
        payload_inactive = {
            "target_object": "YY1_DEPRECATED_FIELD",
            "action": "DELETE",
            "extensions": [
                {
                    "id": "YY1_DEPRECATED_FIELD",
                    "type": "CUSTOM_FIELD",
                    "status": "ACTIVE",
                    "dependencies": [],
                },
                {
                    "id": "CDS_INACTIVE_CONSUMER",
                    "type": "CDS_VIEW",
                    "status": "INACTIVE",  # Consumer is decommissioned/inactive
                    "dependencies": ["YY1_DEPRECATED_FIELD"],
                },
            ],
        }
        res_inactive = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000012",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload_inactive),
        ))
        # Active consumers count is 0 because the sole consumer is INACTIVE!
        assert res_inactive.metrics.additional_metrics["active_consumers_count"] == 0
        assert res_inactive.metrics.additional_metrics["safe_to_delete"] is True
        assert any(f.rule_id == "EXT_SAFE_TO_DELETE" for f in res_inactive.findings)
        assert not any(f.rule_id == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS" for f in res_inactive.findings)

    @pytest.mark.asyncio
    async def test_action_modify_vs_delete_contract(self):
        """Action Contract Test: Action MODIFY triggers breaking changes warning; DELETE triggers block finding."""
        payload_base = {
            "target_object": "YY1_SHARED_FIELD",
            "dependencies": {
                "YY1_SHARED_FIELD": ["CDS_REPORTER"],
                "CDS_REPORTER": [],
            },
        }

        # Action: MODIFY
        req_mod = make_request(
            job_id="22222222-ext0-0002-0000-000000000013",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps({**payload_base, "action": "MODIFY"}),
        )
        res_mod = await EngineRunner.execute(req_mod)
        assert any(f.rule_id == "EXT_MODIFICATION_BREAKING_CONSUMERS" for f in res_mod.findings)
        assert not any(f.rule_id == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS" for f in res_mod.findings)

        # Action: DELETE
        req_del = make_request(
            job_id="22222222-ext0-0002-0000-000000000014",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps({**payload_base, "action": "DELETE"}),
        )
        res_del = await EngineRunner.execute(req_del)
        assert any(f.rule_id == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS" for f in res_del.findings)
        assert not any(f.rule_id == "EXT_MODIFICATION_BREAKING_CONSUMERS" for f in res_del.findings)

    @pytest.mark.asyncio
    async def test_nonexistent_target_object_epistemic_safety(self):
        """Epistemic Safety: Missing target object returns UNKNOWN finding without unhandled exception."""
        payload = {
            "target_object": "ZZ1_GHOST_OBJECT_DOES_NOT_EXIST",
            "dependencies": {
                "CDS_VIEW_1": ["CDS_VIEW_2"],
                "CDS_VIEW_2": [],
            },
        }

        res = await EngineRunner.execute(make_request(
            job_id="22222222-ext0-0002-0000-000000000015",
            engine_type=EngineType.EXTENSION_IMPACT_GUARD,
            raw_content=json.dumps(payload),
        ))

        assert res.status == AnalysisStatus.COMPLETED
        missing_target = [f for f in res.findings if f.rule_id == "EXT_TARGET_OBJECT_NOT_FOUND"]
        assert len(missing_target) == 1
        assert missing_target[0].severity == Severity.MAJOR
        assert missing_target[0].confidence == ConfidenceClass.UNKNOWN
        assert missing_target[0].confidence_score == 0.30

    @pytest.mark.asyncio
    async def test_deterministic_execution_byte_for_byte_identical(self):
        """Cardinal Axiom 2 Determinism: 10 repeated runs produce identical findings and hashes."""
        payload = {
            "target_object": "YY1_DETERMINISTIC_CHECK",
            "dependencies": {
                "YY1_DETERMINISTIC_CHECK": ["CDS_VIEW_M1", "FORM_INVOICE_T1"],
                "CDS_VIEW_M1": ["API_ODATA_SRV"],
                "FORM_INVOICE_T1": [],
                "API_ODATA_SRV": [],
            },
        }
        raw_json = json.dumps(payload)

        reference_findings: List[Dict[str, Any]] = []

        for i in range(10):
            res = await EngineRunner.execute(make_request(
                job_id=f"22222222-ext0-0002-0000-{i:012x}",
                engine_type=EngineType.EXTENSION_IMPACT_GUARD,
                raw_content=raw_json,
            ))
            current_findings = [
                {
                    "rule_id": f.rule_id,
                    "severity": f.severity.value,
                    "confidence": f.confidence.value,
                    "confidence_score": f.confidence_score,
                    "sha256": f.evidence[0].sha256 if f.evidence else "",
                }
                for f in res.findings
            ]
            if i == 0:
                reference_findings = current_findings
            else:
                assert current_findings == reference_findings, f"Drift detected on iteration {i}!"
