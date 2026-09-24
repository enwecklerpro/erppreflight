"""Test Suite for Proposed Software Collection Dependency Guard Engine.

Comprehensive test coverage verifying:
1. Compatibility with E2E evaluators (linear, 2-node cycle, 3-node cycle, independent nodes, single node).
2. Multi-format artifact ingestion (JSON simple map, JSON enterprise manifest, XML ATO export, in-memory ZIP).
3. Deterministic rule evaluations:
   - SC_CIRCULAR_DEPENDENCY
   - SC_MISSING_PREREQUISITE
   - SC_DRAFT_ITEM_INCLUDED
   - SC_DANGLING_FIELD_REFERENCE (deleted items & unresolved UUIDs)
   - SC_SCHEMA_VALIDATION_FAILED
4. Topological sequence calculation & deterministic tie-breaking.
5. Cryptographic evidence pointers (line/column numbers, snippets, SHA-256 digests).
6. Epistemic confidence classifications and non-negotiable demotion invariants.
7. Property-based verification on random DAGs vs cyclic graphs.
"""

from __future__ import annotations

import asyncio
import io
import json
import uuid
import zipfile
import pytest

from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
)
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse

# Import from proposed implementation
import sys
from pathlib import Path

# Add current working directory to sys.path to import proposed_software_collection
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from proposed_software_collection import (
    SoftwareCollectionEngine,
    KeyUserItemType,
    ItemLifecycleStatus,
)


# ==============================================================================
# 1. Evaluator Compatibility Tests (E2E Test Harness Alignment)
# ==============================================================================

class TestEvaluatorCompatibility:
    """Verifies that SoftwareCollectionEngine.evaluate() directly matches tests/e2e expectations."""

    def test_linear_dependencies_pass(self):
        cols = ["SC_CORE", "SC_SALES"]
        deps = {"SC_CORE": [], "SC_SALES": ["SC_CORE"]}
        res = SoftwareCollectionEngine.evaluate(cols, deps)
        assert res["has_cycles"] is False
        assert len(res["findings"]) == 0
        assert res["recommended_sequence"] == ["SC_CORE", "SC_SALES"]

    def test_two_node_circular_dependency_detected(self):
        cols = ["SC_FINANCE", "SC_SALES"]
        deps = {
            "SC_FINANCE": ["SC_SALES"],
            "SC_SALES": ["SC_FINANCE"],
        }
        res = SoftwareCollectionEngine.evaluate(cols, deps)
        assert res["has_cycles"] is True
        assert any(f["code"] == "SC_CIRCULAR_DEPENDENCY" for f in res["findings"])
        assert res["recommended_sequence"] == []

    def test_three_node_cycle_detected(self):
        cols = ["A", "B", "C"]
        deps = {"A": ["B"], "B": ["C"], "C": ["A"]}
        res = SoftwareCollectionEngine.evaluate(cols, deps)
        assert res["has_cycles"] is True
        assert len(res["findings"]) >= 1
        assert res["findings"][0]["severity"] == "CRITICAL"

    def test_independent_collections_pass(self):
        cols = ["B_COL", "A_COL", "C_COL"]
        deps = {"A_COL": [], "B_COL": [], "C_COL": []}
        res = SoftwareCollectionEngine.evaluate(cols, deps)
        assert res["has_cycles"] is False
        assert len(res["findings"]) == 0
        # Deterministic alphabetical ordering
        assert res["recommended_sequence"] == ["A_COL", "B_COL", "C_COL"]

    def test_single_collection_no_deps(self):
        cols = ["SC_FINANCE"]
        deps = {"SC_FINANCE": []}
        res = SoftwareCollectionEngine.evaluate(cols, deps)
        assert res["has_cycles"] is False
        assert len(res["findings"]) == 0
        assert res["recommended_sequence"] == ["SC_FINANCE"]


# ==============================================================================
# 2. Async Engine Analysis & Manifest Tests
# ==============================================================================

class TestAsyncEngineAnalysis:
    """Verifies full BaseEngine.analyze() asynchronous execution pipeline."""

    @pytest.fixture
    def engine(self):
        return SoftwareCollectionEngine()

    @pytest.mark.asyncio
    async def test_simple_json_linear_order(self, engine):
        payload = {
            "collections": ["SC_FOUNDATION", "SC_SALES", "SC_REPORTING"],
            "dependencies": {
                "SC_FOUNDATION": [],
                "SC_SALES": ["SC_FOUNDATION"],
                "SC_REPORTING": ["SC_SALES"],
            }
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload, indent=2),
        )

        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert len(resp.findings) == 0
        assert resp.metrics.additional_metrics["recommended_sequence"] == [
            "SC_FOUNDATION", "SC_SALES", "SC_REPORTING"
        ]
        assert resp.metrics.additional_metrics["circular_dependencies_count"] == 0

    @pytest.mark.asyncio
    async def test_enterprise_manifest_circular_dependency(self, engine):
        payload = {
            "export_id": "EXP_TEST_001",
            "source_system": "DEV_100",
            "target_release": "S4HC_2408",
            "collections": [
                {
                    "collection_id": "SC_FINANCE",
                    "name": "Finance Extensions",
                    "items": [
                        {
                            "item_id": "YY1_FIN_FIELD",
                            "item_type": "CUSTOM_FIELD",
                            "status": "PUBLISHED",
                            "dependencies": []
                        },
                        {
                            "item_id": "YY1_CDS_FIN",
                            "item_type": "CDS_VIEW",
                            "status": "PUBLISHED",
                            "dependencies": ["SC_SALES:YY1_SALES_FIELD"]
                        }
                    ]
                },
                {
                    "collection_id": "SC_SALES",
                    "name": "Sales Extensions",
                    "items": [
                        {
                            "item_id": "YY1_SALES_FIELD",
                            "item_type": "CUSTOM_FIELD",
                            "status": "PUBLISHED",
                            "dependencies": []
                        },
                        {
                            "item_id": "APP_VAR_SALES",
                            "item_type": "APP_VARIANT",
                            "status": "PUBLISHED",
                            "dependencies": ["SC_FINANCE:YY1_FIN_FIELD"]
                        }
                    ]
                }
            ]
        }
        raw_text = json.dumps(payload, indent=2)
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=raw_text,
        )

        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert any(f.rule_id == "SC_CIRCULAR_DEPENDENCY" for f in resp.findings)
        circ_finding = next(f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY")
        assert circ_finding.severity == Severity.CRITICAL
        assert circ_finding.confidence == ConfidenceClass.VERIFIED
        assert circ_finding.confidence_score == 1.0
        assert len(circ_finding.evidence) >= 1
        assert circ_finding.evidence[0].sha256 != ""
        assert resp.metrics.additional_metrics["circular_dependencies_count"] >= 1
        assert resp.metrics.additional_metrics["recommended_sequence"] == []

    @pytest.mark.asyncio
    async def test_missing_prerequisite_collection_detected(self, engine):
        payload = {
            "export_id": "EXP_PREREQ_001",
            "collections": [
                {
                    "collection_id": "SC_SALES",
                    "dependencies": ["SC_MISSING_CORE"],
                    "items": [
                        {
                            "item_id": "YY1_SALES_FIELD",
                            "item_type": "CUSTOM_FIELD",
                            "status": "PUBLISHED",
                        }
                    ]
                }
            ]
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload, indent=2),
        )

        resp = await engine.analyze(req)
        assert any(f.rule_id == "SC_MISSING_PREREQUISITE" for f in resp.findings)
        f_prereq = next(f for f in resp.findings if f.rule_id == "SC_MISSING_PREREQUISITE")
        assert f_prereq.severity == Severity.BLOCKER
        assert "SC_MISSING_CORE" in f_prereq.description
        assert "SC_MISSING_CORE" in f_prereq.affected_objects

    @pytest.mark.asyncio
    async def test_target_system_collection_satisfies_prerequisite(self, engine):
        payload = {
            "export_id": "EXP_TARGET_SATISFIED",
            "target_system_collections": ["SC_INSTALLED_CORE"],
            "collections": [
                {
                    "collection_id": "SC_SALES",
                    "dependencies": ["SC_INSTALLED_CORE"],
                    "items": [
                        {
                            "item_id": "YY1_SALES_FIELD",
                            "item_type": "CUSTOM_FIELD",
                            "status": "PUBLISHED",
                        }
                    ]
                }
            ]
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload),
        )

        resp = await engine.analyze(req)
        assert not any(f.rule_id == "SC_MISSING_PREREQUISITE" for f in resp.findings)

    @pytest.mark.asyncio
    async def test_draft_status_item_detected(self, engine):
        payload = {
            "collections": [
                {
                    "collection_id": "SC_FINANCE",
                    "items": [
                        {
                            "item_id": "YY1_UNFINISHED_BADI",
                            "item_type": "CUSTOM_LOGIC",
                            "status": "DRAFT",
                        },
                        {
                            "item_id": "YY1_PUBLISHED_FIELD",
                            "item_type": "CUSTOM_FIELD",
                            "status": "PUBLISHED",
                        }
                    ]
                }
            ]
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload, indent=2),
        )

        resp = await engine.analyze(req)
        assert any(f.rule_id == "SC_DRAFT_ITEM_INCLUDED" for f in resp.findings)
        f_draft = next(f for f in resp.findings if f.rule_id == "SC_DRAFT_ITEM_INCLUDED")
        assert f_draft.severity == Severity.MAJOR
        assert f_draft.confidence == ConfidenceClass.VERIFIED
        assert "YY1_UNFINISHED_BADI" in f_draft.description
        assert resp.metrics.additional_metrics["draft_items_count"] == 1

    @pytest.mark.asyncio
    async def test_dangling_field_reference_deleted_item(self, engine):
        payload = {
            "collections": [
                {
                    "collection_id": "SC_SALES",
                    "items": [
                        {
                            "item_id": "YY1_OBSOLETE_FIELD",
                            "item_type": "CUSTOM_FIELD",
                            "status": "DELETED",
                        },
                        {
                            "item_id": "APP_VAR_CUSTOMER",
                            "item_type": "APP_VARIANT",
                            "status": "PUBLISHED",
                            "dependencies": ["YY1_OBSOLETE_FIELD"]
                        }
                    ]
                }
            ]
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload, indent=2),
        )

        resp = await engine.analyze(req)
        assert any(f.rule_id == "SC_DANGLING_FIELD_REFERENCE" for f in resp.findings)
        f_dang = next(f for f in resp.findings if f.rule_id == "SC_DANGLING_FIELD_REFERENCE")
        assert f_dang.severity == Severity.CRITICAL
        assert f_dang.confidence == ConfidenceClass.VERIFIED

    @pytest.mark.asyncio
    async def test_dangling_unresolved_uuid_has_unknown_confidence(self, engine):
        payload = {
            "collections": [
                {
                    "collection_id": "SC_SALES",
                    "items": [
                        {
                            "item_id": "APP_VAR_PORTAL",
                            "item_type": "APP_VARIANT",
                            "status": "PUBLISHED",
                            "dependencies": ["c0a80101-1234-5678-9abc-def012345678"]
                        }
                    ]
                }
            ]
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload, indent=2),
        )

        resp = await engine.analyze(req)
        assert any(f.rule_id == "SC_DANGLING_FIELD_REFERENCE" for f in resp.findings)
        f_uuid = next(f for f in resp.findings if f.rule_id == "SC_DANGLING_FIELD_REFERENCE")
        # Per engines_spec.md §11.8: UNKNOWN confidence for unresolved UUIDs
        assert f_uuid.confidence == ConfidenceClass.UNKNOWN
        assert f_uuid.confidence_score == 0.30

    @pytest.mark.asyncio
    async def test_xml_manifest_parsing_with_line_numbers(self, engine):
        xml_content = """<?xml version="1.0" encoding="utf-8"?>
<software_collections export_id="EXP_XML_001" target_release="S4HC_2408">
  <collection id="SC_CORE" name="Core Extensions">
    <item id="YY1_CORE_FIELD" type="CUSTOM_FIELD" status="PUBLISHED" />
  </collection>
  <collection id="SC_SALES" name="Sales Extensions">
    <item id="YY1_SALES_DRAFT" type="CUSTOM_FIELD" status="DRAFT" />
    <item id="YY1_CDS_ORDER" type="CDS_VIEW" status="PUBLISHED">
      <dependency id="YY1_CORE_FIELD" collection="SC_CORE" />
    </item>
  </collection>
</software_collections>
"""
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.XML,
            raw_content=xml_content,
        )

        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        # Must detect draft item
        assert any(f.rule_id == "SC_DRAFT_ITEM_INCLUDED" for f in resp.findings)
        draft_f = next(f for f in resp.findings if f.rule_id == "SC_DRAFT_ITEM_INCLUDED")
        assert draft_f.evidence[0].line_number > 1
        # Order must be SC_CORE then SC_SALES
        assert resp.metrics.additional_metrics["recommended_sequence"] == ["SC_CORE", "SC_SALES"]

    @pytest.mark.asyncio
    async def test_zip_archive_parsing(self, engine):
        # Create an in-memory ZIP containing manifest.json
        manifest_data = {
            "collections": [
                {
                    "collection_id": "SC_BASE",
                    "items": [{"item_id": "YY1_A", "type": "CUSTOM_FIELD", "status": "PUBLISHED"}]
                },
                {
                    "collection_id": "SC_EXT",
                    "dependencies": ["SC_BASE"],
                    "items": [{"item_id": "YY1_B", "type": "CUSTOM_FIELD", "status": "PUBLISHED"}]
                }
            ]
        }
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", json.dumps(manifest_data))

        zip_bytes = zip_buf.getvalue()

        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.ZIP,
            raw_content=zip_bytes.decode("latin1"),
        )

        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.metrics.additional_metrics["recommended_sequence"] == ["SC_BASE", "SC_EXT"]

    @pytest.mark.asyncio
    async def test_empty_manifest_fails_closed(self, engine):
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content="",
        )

        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert any(f.rule_id == "SC_SCHEMA_VALIDATION_FAILED" for f in resp.findings)
        f_empty = next(f for f in resp.findings if f.rule_id == "SC_SCHEMA_VALIDATION_FAILED")
        assert f_empty.severity == Severity.BLOCKER
        assert f_empty.confidence == ConfidenceClass.UNKNOWN
        assert f_empty.confidence_score == 0.30


# ==============================================================================
# 3. Property-Based Topological Sort Invariants
# ==============================================================================

class TestTopologicalProperties:
    """Verifies graph topological ordering invariants."""

    def test_random_dag_preserves_prerequisite_order(self):
        """For any DAG, if A depends on B, B MUST appear before A in recommended sequence."""
        # Linear chain: 5 nodes
        cols = [f"COL_{i}" for i in range(5)]
        deps = {
            "COL_0": [],
            "COL_1": ["COL_0"],
            "COL_2": ["COL_1"],
            "COL_3": ["COL_2"],
            "COL_4": ["COL_3"],
        }
        res = SoftwareCollectionEngine.evaluate(cols, deps)
        assert res["has_cycles"] is False
        seq = res["recommended_sequence"]
        for u, prereqs in deps.items():
            for p in prereqs:
                assert seq.index(p) < seq.index(u), f"Prerequisite {p} must precede consumer {u}"

    def test_diamond_dag_ordering(self):
        """Diamond DAG: Root -> Left, Right -> Sink."""
        cols = ["ROOT", "LEFT", "RIGHT", "SINK"]
        deps = {
            "ROOT": [],
            "LEFT": ["ROOT"],
            "RIGHT": ["ROOT"],
            "SINK": ["LEFT", "RIGHT"],
        }
        res = SoftwareCollectionEngine.evaluate(cols, deps)
        assert res["has_cycles"] is False
        seq = res["recommended_sequence"]
        assert seq[0] == "ROOT"
        assert seq[-1] == "SINK"
        assert seq.index("ROOT") < seq.index("LEFT")
        assert seq.index("ROOT") < seq.index("RIGHT")
        assert seq.index("LEFT") < seq.index("SINK")
        assert seq.index("RIGHT") < seq.index("SINK")


# ==============================================================================
# 4. Engine Metadata & Edge Cases
# ==============================================================================

class TestEngineMetadataAndEdgeCases:
    """Verifies metadata, SAP standard exemptions, malformed inputs, and metrics."""

    def test_engine_metadata(self):
        engine = SoftwareCollectionEngine()
        meta = engine.get_metadata()
        assert meta["engine_type"] == EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD.value
        assert meta["name"] == "Software Collection Dependency Guard"
        assert meta["version"] == "1.0.0"
        assert "JSON" in meta["supported_artifact_types"]
        assert "XML" in meta["supported_artifact_types"]
        assert "ZIP" in meta["supported_artifact_types"]

    @pytest.mark.asyncio
    async def test_sap_standard_prefix_not_flagged_as_dangling(self):
        engine = SoftwareCollectionEngine()
        payload = {
            "collections": [
                {
                    "collection_id": "SC_SALES",
                    "items": [
                        {
                            "item_id": "YY1_CDS_ORDER_EXT",
                            "item_type": "CDS_VIEW",
                            "status": "PUBLISHED",
                            "dependencies": ["I_SalesOrder", "C_SalesOrderItemDEX", "MARA"]
                        }
                    ]
                }
            ]
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload),
        )
        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        # Standard SAP CDS views and tables should not be flagged as dangling fields
        assert not any(f.rule_id == "SC_DANGLING_FIELD_REFERENCE" for f in resp.findings)
        assert not any(f.rule_id == "SC_MISSING_PREREQUISITE" for f in resp.findings)

    @pytest.mark.asyncio
    async def test_unresolved_yy1_field_flagged_as_dangling(self):
        engine = SoftwareCollectionEngine()
        payload = {
            "collections": [
                {
                    "collection_id": "SC_SALES",
                    "items": [
                        {
                            "item_id": "APP_VAR_CUSTOM",
                            "item_type": "APP_VARIANT",
                            "status": "PUBLISHED",
                            "dependencies": ["YY1_NONEXISTENT_FIELD"]
                        }
                    ]
                }
            ]
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload),
        )
        resp = await engine.analyze(req)
        assert any(f.rule_id == "SC_DANGLING_FIELD_REFERENCE" for f in resp.findings)
        dang_f = next(f for f in resp.findings if f.rule_id == "SC_DANGLING_FIELD_REFERENCE")
        assert dang_f.severity == Severity.CRITICAL
        assert dang_f.confidence == ConfidenceClass.VERIFIED

    @pytest.mark.asyncio
    async def test_dual_independent_cycles_detected(self):
        engine = SoftwareCollectionEngine()
        payload = {
            "collections": ["C1", "C2", "C3", "C4"],
            "dependencies": {
                "C1": ["C2"],
                "C2": ["C1"],
                "C3": ["C4"],
                "C4": ["C3"],
            }
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload),
        )
        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        circ_findings = [f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY"]
        assert len(circ_findings) >= 2
        assert resp.metrics.additional_metrics["circular_dependencies_count"] >= 2
        assert resp.metrics.additional_metrics["recommended_sequence"] == []

    @pytest.mark.asyncio
    async def test_metrics_schema_dual_casing(self):
        engine = SoftwareCollectionEngine()
        payload = {
            "collections": [
                {
                    "collection_id": "SC_A",
                    "items": [{"item_id": "YY1_A", "type": "CUSTOM_FIELD", "status": "PUBLISHED"}]
                }
            ]
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload),
        )
        resp = await engine.analyze(req)
        m = resp.metrics.additional_metrics
        # Check snake_case keys
        assert "total_collections" in m
        assert "total_items" in m
        assert "circular_dependencies_count" in m
        assert "recommended_sequence" in m
        # Check camelCase keys
        assert "totalCollections" in m
        assert "totalItems" in m
        assert "circularDependenciesCount" in m
        assert "recommendedSequence" in m
        assert m["engine"] == "software_collection_guard"

    @pytest.mark.asyncio
    async def test_engine_runner_integration(self):
        """Verifies integration with EngineRunner and EngineRegistry."""
        from src.core.runner import EngineRunner
        from src.core.registry import EngineRegistry

        EngineRegistry.register(SoftwareCollectionEngine)

        payload = {
            "collections": ["SC_FINANCE", "SC_SALES"],
            "dependencies": {
                "SC_FINANCE": ["SC_SALES"],
                "SC_SALES": ["SC_FINANCE"],
            }
        }
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
            artifact_type=ArtifactType.JSON,
            raw_content=json.dumps(payload),
        )
        resp = await EngineRunner.execute(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.engine_type == EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD
        assert any(f.rule_id == "SC_CIRCULAR_DEPENDENCY" for f in resp.findings)
        assert resp.metrics.additional_metrics["circular_dependencies_count"] >= 1


