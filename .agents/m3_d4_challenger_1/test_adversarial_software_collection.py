"""Adversarial Empirical Stress Test Suite for Software Collection Dependency Guard (Feature 28).

Author: m3_d4_challenger_1
Role: critic, specialist (EMPIRICAL CHALLENGER)
Target: services/analysis-python/src/engines/software_collection.py

Adversarial Stress Dimensions:
1. Complex Cyclic Topologies (multi-node rings, figure-8 dual cycles, nested sub-cycles, cliques, self-loops)
2. High-Volume Scalability & Stress (100+ collections/items, dense layered DAGs, linear/sub-second performance)
3. Corrupt/Adversarial Payloads (syntax errors, malformed root types, missing attributes, XXE injection, zip-slip)
4. Deterministic Topological Sorting (lexicographical tie-breaking, permutation invariance)
5. Cryptographic SHA-256 Evidence Integrity & Epistemic Confidence Bounds (demotion, UUID handling, coordinates)
6. Complex Edge Cases & Multi-Defect Composition (standard SAP prefixes exemption, simultaneous violations)
7. Randomized Graph Fuzzing (100 generated random DAGs and cyclic graphs proving 0% error rate)
8. Multibyte Unicode & Internationalization Resilience (Japanese, German umlauts, emojis)
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import io
import json
from pathlib import Path
import random
import sys
import time
from typing import Any, Dict, List, Optional
import zipfile

import pytest

# Ensure services/analysis-python is in python path
for p in Path(__file__).resolve().parents:
    cand_srv = p / "services" / "analysis-python"
    if cand_srv.is_dir() and str(cand_srv) not in sys.path:
        sys.path.insert(0, str(cand_srv))
        break

from src.core.registry import EngineRegistry
from src.engines.software_collection import (
    KeyUserItemType,
    SoftwareCollection,
    SoftwareCollectionEngine,
    SoftwareCollectionItem,
    SoftwareCollectionManifest,
)
from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
    TrustLevel,
)
from src.models.evidence import Evidence
from src.models.finding import Finding
from src.models.request import AnalysisRequest, ArtifactReference
from src.models.response import AnalysisResponse


# =============================================================================
# Helper Fixtures & Factories
# =============================================================================

def make_request(
    raw_content: str,
    artifact_type: ArtifactType = ArtifactType.JSON,
    file_name: str = "software_collections.json",
    target_release: str = "S4HC_2408",
    configuration: Optional[Dict[str, Any]] = None,
) -> AnalysisRequest:
    """Builds a strictly compliant AnalysisRequest for SoftwareCollectionEngine."""
    raw_bytes = raw_content.encode("utf-8")
    content_hash = hashlib.sha256(raw_bytes).hexdigest()
    return AnalysisRequest(
        job_id=f"job-adv-{content_hash[:8]}",
        tenant_id="tenant-stress-adversarial",
        project_id="proj-adversarial-audit",
        engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
        target_release=target_release,
        artifacts=[
            ArtifactReference(
                file_name=file_name,
                artifact_type=artifact_type,
                raw_content=raw_content,
                sha256=content_hash,
                size_bytes=len(raw_bytes),
            )
        ],
        raw_content=raw_content,
        configuration=configuration or {},
    )


# =============================================================================
# Suite 1: Complex Cyclic Graph Topologies
# =============================================================================

class TestComplexCyclicTopologies:
    """Adversarial stress-testing of cycle detection across pathological graph structures."""

    def test_multi_node_ring_four_nodes(self):
        """Stress 4-node directed cycle: A -> B -> C -> D -> A."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {"id": "SC_A", "dependencies": ["SC_B"]},
                {"id": "SC_B", "dependencies": ["SC_C"]},
                {"id": "SC_C", "dependencies": ["SC_D"]},
                {"id": "SC_D", "dependencies": ["SC_A"]},
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        cycle_findings = [f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY"]
        assert len(cycle_findings) >= 1
        assert cycle_findings[0].severity == Severity.CRITICAL
        assert cycle_findings[0].confidence == ConfidenceClass.VERIFIED
        assert resp.metrics.additional_metrics.get("circular_dependencies_count") >= 1
        assert resp.metrics.additional_metrics.get("recommended_sequence") == []

    def test_multi_node_ring_eight_nodes(self):
        """Stress 8-node directed cycle: C0 -> C1 -> ... -> C7 -> C0."""
        engine = SoftwareCollectionEngine()
        cols = [f"SC_{i:02d}" for i in range(8)]
        manifest = {
            "collections": [
                {"id": cols[i], "dependencies": [cols[(i + 1) % 8]]}
                for i in range(8)
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        cycle_findings = [f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY"]
        assert len(cycle_findings) >= 1
        assert resp.metrics.additional_metrics.get("recommended_sequence") == []

    def test_figure_eight_dual_cycle(self):
        """Stress figure-8 topology: Cycle 1 (A -> B -> C -> A) and Cycle 2 (A -> D -> E -> A) sharing node A."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {"id": "SC_A", "dependencies": ["SC_B", "SC_D"]},
                {"id": "SC_B", "dependencies": ["SC_C"]},
                {"id": "SC_C", "dependencies": ["SC_A"]},
                {"id": "SC_D", "dependencies": ["SC_E"]},
                {"id": "SC_E", "dependencies": ["SC_A"]},
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        cycle_findings = [f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY"]
        assert len(cycle_findings) >= 1
        assert resp.metrics.additional_metrics.get("recommended_sequence") == []
        affected = {obj for f in cycle_findings for obj in f.affected_objects}
        assert "SC_A" in affected

    def test_nested_sub_cycles(self):
        """Stress nested sub-cycles: Outer cycle (A -> B -> C -> D -> A) with inner cycle (B -> C -> B)."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {"id": "SC_A", "dependencies": ["SC_B"]},
                {"id": "SC_B", "dependencies": ["SC_C"]},
                {"id": "SC_C", "dependencies": ["SC_B", "SC_D"]},
                {"id": "SC_D", "dependencies": ["SC_A"]},
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        cycle_findings = [f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY"]
        assert len(cycle_findings) >= 1
        assert resp.metrics.additional_metrics.get("recommended_sequence") == []

    def test_self_referential_cycle(self):
        """Stress self-loop: Collection depending on itself (SC_SELF -> SC_SELF)."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {"id": "SC_SELF", "dependencies": ["SC_SELF"]},
                {"id": "SC_CLEAN", "dependencies": []},
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        cycle_findings = [f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY"]
        assert len(cycle_findings) >= 1
        assert resp.metrics.additional_metrics.get("recommended_sequence") == []

    def test_disconnected_components_with_independent_cycles(self):
        """Stress disconnected components: Component 1 has cycle (A <-> B), Component 2 has cycle (C <-> D), Component 3 is clean (E -> F)."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {"id": "SC_A", "dependencies": ["SC_B"]},
                {"id": "SC_B", "dependencies": ["SC_A"]},
                {"id": "SC_C", "dependencies": ["SC_D"]},
                {"id": "SC_D", "dependencies": ["SC_C"]},
                {"id": "SC_F", "dependencies": []},
                {"id": "SC_E", "dependencies": ["SC_F"]},
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        cycle_findings = [f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY"]
        assert len(cycle_findings) >= 2
        assert resp.metrics.additional_metrics.get("recommended_sequence") == []

    def test_complete_graph_clique(self):
        """Stress 4-node complete graph (K4): every node depends on every other node."""
        engine = SoftwareCollectionEngine()
        nodes = ["SC_1", "SC_2", "SC_3", "SC_4"]
        manifest = {
            "collections": [
                {"id": n, "dependencies": [other for other in nodes if other != n]}
                for n in nodes
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        cycle_findings = [f for f in resp.findings if f.rule_id == "SC_CIRCULAR_DEPENDENCY"]
        assert len(cycle_findings) >= 1
        assert resp.metrics.additional_metrics.get("recommended_sequence") == []


# =============================================================================
# Suite 2: High-Volume Collections & Scalability
# =============================================================================

class TestHighVolumeScalability:
    """Stress testing high-volume collections (100+ items, dense graphs) asserting linear and sub-second performance."""

    def test_linear_chain_120_collections_subsecond(self):
        """120 collections in a linear dependency chain: C0 <- C1 <- C2 <- ... <- C119."""
        engine = SoftwareCollectionEngine()
        count = 120
        collections = []
        for i in range(count):
            deps = [f"SC_{i - 1:03d}"] if i > 0 else []
            collections.append({"id": f"SC_{i:03d}", "dependencies": deps})

        manifest = {"collections": collections}
        req = make_request(json.dumps(manifest))

        t0 = time.perf_counter()
        resp = asyncio.run(engine.analyze(req))
        elapsed = time.perf_counter() - t0

        assert resp.status == AnalysisStatus.COMPLETED
        assert elapsed < 1.0, f"Execution took {elapsed:.3f}s, expected < 1.0s"
        assert len([f for f in resp.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]) == 0

        seq = resp.metrics.additional_metrics.get("recommended_sequence")
        assert len(seq) == count
        assert seq[0] == "SC_000"
        assert seq[-1] == f"SC_{count - 1:03d}"

    def test_dense_layered_dag_100_collections_subsecond(self):
        """100 collections structured into 10 layers of 10 nodes (900 cross-layer dependency edges)."""
        engine = SoftwareCollectionEngine()
        layers = 10
        width = 10
        total_nodes = layers * width

        collections = []
        for layer in range(layers):
            prereqs = [f"SC_L{layer - 1}_N{w}" for w in range(width)] if layer > 0 else []
            for w in range(width):
                collections.append({
                    "id": f"SC_L{layer}_N{w}",
                    "dependencies": prereqs,
                })

        manifest = {"collections": collections}
        req = make_request(json.dumps(manifest))

        t0 = time.perf_counter()
        resp = asyncio.run(engine.analyze(req))
        elapsed = time.perf_counter() - t0

        assert resp.status == AnalysisStatus.COMPLETED
        assert elapsed < 1.0, f"Dense DAG evaluation took {elapsed:.3f}s, expected < 1.0s"
        assert len([f for f in resp.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]) == 0

        seq = resp.metrics.additional_metrics.get("recommended_sequence")
        assert len(seq) == total_nodes

        # Verify topological ordering: every node in layer K appears before any node in layer K+1
        index_map = {node_id: idx for idx, node_id in enumerate(seq)}
        for layer in range(layers - 1):
            max_current_layer_idx = max(index_map[f"SC_L{layer}_N{w}"] for w in range(width))
            min_next_layer_idx = min(index_map[f"SC_L{layer + 1}_N{w}"] for w in range(width))
            assert max_current_layer_idx < min_next_layer_idx, (
                f"Layer {layer} elements not all ordered before Layer {layer + 1}"
            )

    def test_high_volume_items_200_items_subsecond(self):
        """20 collections containing 10 items each (200 items total) with inter-item dependencies."""
        engine = SoftwareCollectionEngine()
        col_count = 20
        items_per_col = 10
        collections = []

        for c in range(col_count):
            items = []
            for i in range(items_per_col):
                item_id = f"YY1_ITEM_C{c:02d}_I{i:02d}"
                deps = []
                if c > 0:
                    deps.append(f"YY1_ITEM_C{c - 1:02d}_I{i:02d}")
                items.append({
                    "id": item_id,
                    "type": "CUSTOM_FIELD",
                    "status": "PUBLISHED",
                    "dependencies": deps,
                })
            collections.append({
                "id": f"SC_COL_{c:02d}",
                "items": items,
            })

        manifest = {"collections": collections}
        req = make_request(json.dumps(manifest))

        t0 = time.perf_counter()
        resp = asyncio.run(engine.analyze(req))
        elapsed = time.perf_counter() - t0

        assert resp.status == AnalysisStatus.COMPLETED
        assert elapsed < 1.0, f"High-volume items evaluation took {elapsed:.3f}s, expected < 1.0s"
        assert resp.metrics.additional_metrics.get("total_items") == 200
        assert resp.metrics.additional_metrics.get("total_collections") == 20

    def test_evaluate_classmethod_500_nodes_subsecond(self):
        """Direct evaluate() classmethod stress test with 500 collections and 1,000 dependency edges."""
        count = 500
        cols = [f"SC_NODE_{i:04d}" for i in range(count)]
        deps = {
            cols[i]: [cols[i - 1], cols[i - 2]] if i >= 2 else ([cols[0]] if i == 1 else [])
            for i in range(count)
        }

        t0 = time.perf_counter()
        res = SoftwareCollectionEngine.evaluate(cols, deps)
        elapsed = time.perf_counter() - t0

        assert res["status"] == "COMPLETED"
        assert res["has_cycles"] is False
        assert len(res["recommended_sequence"]) == count
        assert elapsed < 1.0, f"500-node evaluate() took {elapsed:.3f}s, expected < 1.0s"


# =============================================================================
# Suite 3: Corrupt JSON / XML / Manifest Ingestion (Fail-Closed)
# =============================================================================

class TestCorruptManifestsAndFailClosed:
    """Stress testing parser resilience against hostile, corrupt, and malformed inputs."""

    def test_corrupt_json_syntax_error(self):
        """Corrupt JSON syntax fails closed with SC_SCHEMA_VALIDATION_FAILED and UNKNOWN confidence."""
        engine = SoftwareCollectionEngine()
        corrupt_payloads = [
            "{ unquoted_key: 123 }",
            '{"collections": [{"id": "SC_A", "dependencies": [}',  # Truncated
            "null",
            "12345",
            '"just a bare string"',
            "   ",
            "\x00\x00\x00",  # Null bytes
        ]

        for payload in corrupt_payloads:
            req = make_request(payload, ArtifactType.JSON)
            resp = asyncio.run(engine.analyze(req))
            assert resp.status == AnalysisStatus.COMPLETED
            schema_findings = [f for f in resp.findings if f.rule_id == "SC_SCHEMA_VALIDATION_FAILED"]
            assert len(schema_findings) == 1
            f = schema_findings[0]
            assert f.severity == Severity.BLOCKER
            assert f.confidence == ConfidenceClass.UNKNOWN
            assert f.confidence_score == 0.30

    def test_corrupt_json_non_dict_collections(self):
        """JSON with 'collections' as a string, integer, or null fails closed."""
        engine = SoftwareCollectionEngine()
        payloads = [
            json.dumps({"collections": "not-a-list"}),
            json.dumps({"collections": 42}),
            json.dumps({"collections": None}),
            json.dumps({"collections": [123, "string", None, True]}),
        ]

        for p in payloads:
            req = make_request(p, ArtifactType.JSON)
            resp = asyncio.run(engine.analyze(req))
            schema_findings = [f for f in resp.findings if f.rule_id == "SC_SCHEMA_VALIDATION_FAILED"]
            assert len(schema_findings) == 1
            assert schema_findings[0].severity == Severity.BLOCKER

    def test_item_with_missing_attributes_defaults_gracefully(self):
        """Item missing id, type, and status defaults safely without crash."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {
                    "id": "SC_EMPTY_ITEM",
                    "items": [{}]
                }
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))
        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.metrics.additional_metrics.get("total_items") == 1

    def test_item_with_unknown_item_type(self):
        """Unrecognized item_type string safely normalizes to KeyUserItemType.UNKNOWN."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {
                    "id": "SC_TEST",
                    "items": [
                        {
                            "id": "OBJ_UNKNOWN_TYPE",
                            "type": "TOTALLY_BOGUS_TYPE_12345",
                            "status": "PUBLISHED",
                        }
                    ]
                }
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))
        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.metrics.additional_metrics.get("total_items") == 1

    def test_item_with_invalid_dependencies_type(self):
        """Item with non-list non-string dependencies (e.g. integer or object) must fail closed or recover safely."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {
                    "id": "SC_TEST",
                    "items": [
                        {
                            "id": "ITEM_1",
                            "dependencies": 12345,  # Invalid type: integer instead of list/str
                        }
                    ]
                }
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))
        assert resp.status == AnalysisStatus.COMPLETED

    def test_collection_with_invalid_dependencies_type(self):
        """Collection with non-list non-string dependencies must fail closed or recover safely."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {
                    "id": "SC_TEST",
                    "dependencies": 99999,  # Invalid type: integer instead of list/str
                    "items": []
                }
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))
        assert resp.status == AnalysisStatus.COMPLETED

    def test_corrupt_xml_syntax_error(self):
        """Corrupt XML syntax fails closed with SC_SCHEMA_VALIDATION_FAILED."""
        engine = SoftwareCollectionEngine()
        corrupt_xmls = [
            "<manifest><collections><collection id='C1'>",
            "<?xml version='1.0'?><not_valid",
            "",
            "   \n\t  ",
        ]
        for xml in corrupt_xmls:
            req = make_request(xml, ArtifactType.XML, file_name="export.xml")
            resp = asyncio.run(engine.analyze(req))
            assert resp.status == AnalysisStatus.COMPLETED
            schema_findings = [f for f in resp.findings if f.rule_id == "SC_SCHEMA_VALIDATION_FAILED"]
            assert len(schema_findings) == 1
            assert schema_findings[0].severity == Severity.BLOCKER

    def test_xml_xxe_entity_injection_rejected(self):
        """SafeXmlParser rejects XML entity injection (XXE) and fails closed."""
        engine = SoftwareCollectionEngine()
        xxe_payload = (
            "<?xml version='1.0' encoding='UTF-8'?>\n"
            "<!DOCTYPE foo [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]>\n"
            "<manifest export_id='EXP_XXE'>\n"
            "  <collection id='SC_TEST'>\n"
            "    <item id='&xxe;' type='CUSTOM_FIELD'/>\n"
            "  </collection>\n"
            "</manifest>"
        )
        req = make_request(xxe_payload, ArtifactType.XML, file_name="xxe.xml")
        resp = asyncio.run(engine.analyze(req))
        assert resp.status == AnalysisStatus.COMPLETED
        schema_findings = [f for f in resp.findings if f.rule_id == "SC_SCHEMA_VALIDATION_FAILED"]
        assert len(schema_findings) == 1

    def test_zip_archive_security_traversal_rejected(self):
        """In-memory ZIP archive containing directory traversal filenames (Zip Slip) is rejected."""
        raw_json = json.dumps({"collections": [{"id": "SC_ZIP", "dependencies": []}]})
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("../../etc/manifest.json", raw_json)
        zip_bytes = zip_buf.getvalue()

        manifest = SoftwareCollectionEngine.parse_artifact(zip_bytes, ArtifactType.ZIP)
        assert len(manifest.collections) == 0


# =============================================================================
# Suite 4: Deterministic Topological Ordering & Tie-Breaking
# =============================================================================

class TestDeterministicTopologicalOrdering:
    """Stress testing deterministic lexicographical tie-breaking and permutation stability."""

    def test_independent_roots_lexicographical_tie_break(self):
        """Five independent root nodes with equal in-degree 0 must be ordered alphabetically."""
        engine = SoftwareCollectionEngine()
        roots = ["SC_Z", "SC_M", "SC_A", "SC_B", "SC_K"]
        manifest = {
            "collections": [
                {"id": r, "dependencies": []} for r in roots
            ] + [
                {"id": "SC_FINAL", "dependencies": roots}
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        seq = resp.metrics.additional_metrics.get("recommended_sequence")
        assert seq is not None
        expected_roots_order = sorted(roots)
        assert seq[:5] == expected_roots_order
        assert seq[5] == "SC_FINAL"

    def test_permutation_invariance(self):
        """Shuffling the input manifest collection order 10 times produces identical topological sequences."""
        engine = SoftwareCollectionEngine()
        base_collections = [
            {"id": "SC_BASE_A", "dependencies": []},
            {"id": "SC_BASE_B", "dependencies": []},
            {"id": "SC_MID_1", "dependencies": ["SC_BASE_A"]},
            {"id": "SC_MID_2", "dependencies": ["SC_BASE_A", "SC_BASE_B"]},
            {"id": "SC_TOP", "dependencies": ["SC_MID_1", "SC_MID_2"]},
        ]

        canonical_seq = None
        rng = random.Random(42)

        for _ in range(10):
            shuffled = copy.deepcopy(base_collections)
            rng.shuffle(shuffled)
            manifest = {"collections": shuffled}
            req = make_request(json.dumps(manifest))
            resp = asyncio.run(engine.analyze(req))
            seq = resp.metrics.additional_metrics.get("recommended_sequence")

            if canonical_seq is None:
                canonical_seq = seq
            else:
                assert seq == canonical_seq, "Topological sequence diverged across input permutations!"


# =============================================================================
# Suite 5: Cryptographic SHA-256 Evidence & Epistemic Confidence Bounds
# =============================================================================

class TestCryptographicEvidenceAndConfidence:
    """Stress testing cryptographic evidence integrity, exact coordinates, and confidence demotion."""

    def test_evidence_sha256_cryptographic_match(self):
        """Every finding's evidence sha256 strictly matches SHA-256 of the raw content."""
        engine = SoftwareCollectionEngine()
        raw_json = json.dumps({
            "collections": [
                {"id": "SC_ALPHA", "dependencies": ["SC_BETA"]},
                {"id": "SC_BETA", "dependencies": ["SC_ALPHA"]},
            ]
        }, indent=2)
        expected_hash = hashlib.sha256(raw_json.encode("utf-8")).hexdigest()

        req = make_request(raw_json)
        resp = asyncio.run(engine.analyze(req))

        assert len(resp.findings) > 0
        for f in resp.findings:
            assert len(f.evidence) > 0
            for ev in f.evidence:
                assert ev.sha256 == expected_hash
                assert ev.line_number >= 1
                assert ev.column_number >= 1

    def test_unresolved_uuid_demotes_to_unknown_confidence(self):
        """Per engines_spec.md §11.8: Dangling UUID reference demotes to UNKNOWN (0.30), whereas custom field is VERIFIED (1.0)."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {
                    "id": "SC_UUID_TEST",
                    "items": [
                        {
                            "id": "YY1_APP_VARIANT_1",
                            "type": "APP_VARIANT",
                            "status": "PUBLISHED",
                            "dependencies": [
                                "550e8400-e29b-41d4-a716-446655440000",
                                "YY1_MISSING_EXPLICIT_FIELD",
                            ]
                        }
                    ]
                }
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        dangling_findings = [f for f in resp.findings if f.rule_id == "SC_DANGLING_FIELD_REFERENCE"]
        assert len(dangling_findings) == 2

        uuid_f = next(f for f in dangling_findings if "550e8400" in f.title)
        field_f = next(f for f in dangling_findings if "YY1_MISSING_EXPLICIT_FIELD" in f.title)

        assert uuid_f.confidence == ConfidenceClass.UNKNOWN
        assert uuid_f.confidence_score == 0.30

        assert field_f.confidence == ConfidenceClass.VERIFIED
        assert field_f.confidence_score == 1.0

    def test_deleted_item_triggers_dangling_reference(self):
        """Reference to an item marked DELETED triggers SC_DANGLING_FIELD_REFERENCE with 'marked DELETED' reason."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {
                    "id": "SC_MAIN",
                    "items": [
                        {
                            "id": "YY1_DELETED_FIELD",
                            "type": "CUSTOM_FIELD",
                            "status": "DELETED",
                            "dependencies": []
                        },
                        {
                            "id": "YY1_CONSUMER_VIEW",
                            "type": "CDS_VIEW",
                            "status": "PUBLISHED",
                            "dependencies": ["YY1_DELETED_FIELD"]
                        }
                    ]
                }
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        dangling_findings = [f for f in resp.findings if f.rule_id == "SC_DANGLING_FIELD_REFERENCE"]
        assert len(dangling_findings) >= 1
        f = dangling_findings[0]
        assert "DELETED" in f.description or "DELETED" in f.technical_details.get("reason", "")
        assert f.confidence == ConfidenceClass.VERIFIED


# =============================================================================
# Suite 6: Complex Edge Cases & Multi-Defect Composition
# =============================================================================

class TestComplexEdgeCasesAndMultiDefect:
    """Stress testing simultaneous multi-rule violations, SAP standard exemptions, and variations."""

    def test_standard_sap_objects_exemption(self):
        """References to SAP standard prefixes (I_, C_, BAPI_, MARA, VBAP) are exempt from dangling references."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {
                    "id": "SC_SAP_STD_REFS",
                    "items": [
                        {
                            "id": "YY1_CUSTOM_VIEW",
                            "type": "CDS_VIEW",
                            "status": "PUBLISHED",
                            "dependencies": [
                                "I_SalesOrder",
                                "C_JournalEntryItem",
                                "BAPI_MATERIAL_GET_DETAIL",
                                "MARA",
                                "VBAP",
                                "S4_FIN_LEDGER",
                            ]
                        }
                    ]
                }
            ]
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        dangling_findings = [f for f in resp.findings if f.rule_id == "SC_DANGLING_FIELD_REFERENCE"]
        assert len(dangling_findings) == 0

    def test_simultaneous_multi_rule_violations(self):
        """Manifest exhibiting ALL four defect rules simultaneously evaluates all rules without short-circuiting."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {
                    "id": "SC_CYCLE_1",
                    "dependencies": ["SC_CYCLE_2"],
                    "items": [
                        {
                            "id": "YY1_DRAFT_LOGIC",
                            "type": "CUSTOM_LOGIC",
                            "status": "DRAFT",
                            "dependencies": []
                        },
                        {
                            "id": "YY1_CDS_CONSUMER",
                            "type": "CDS_VIEW",
                            "status": "PUBLISHED",
                            "dependencies": ["YY1_NON_EXISTENT_FIELD"]
                        },
                    ]
                },
                {
                    "id": "SC_CYCLE_2",
                    "dependencies": ["SC_CYCLE_1"],
                    "items": []
                },
                {
                    "id": "SC_MISSING_PREREQ_COL",
                    "dependencies": ["SC_UNEXPORTED_BASE"],
                    "items": []
                }
            ],
            "target_system_collections": ["SC_SYS_ALREADY_INSTALLED"],
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        rule_ids = {f.rule_id for f in resp.findings}
        assert "SC_CIRCULAR_DEPENDENCY" in rule_ids
        assert "SC_DRAFT_ITEM_INCLUDED" in rule_ids
        assert "SC_DANGLING_FIELD_REFERENCE" in rule_ids
        assert "SC_MISSING_PREREQUISITE" in rule_ids
        assert resp.metrics.rules_evaluated >= 5

    def test_target_system_collections_satisfies_prerequisite(self):
        """A prerequisite present in target_system_collections must NOT trigger SC_MISSING_PREREQUISITE."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "collections": [
                {
                    "id": "SC_APP_LOGIC",
                    "dependencies": ["SC_TARGET_SYS_FOUNDATION"],
                    "items": []
                }
            ],
            "target_system_collections": ["SC_TARGET_SYS_FOUNDATION"],
        }
        req = make_request(json.dumps(manifest))
        resp = asyncio.run(engine.analyze(req))

        missing_prereqs = [f for f in resp.findings if f.rule_id == "SC_MISSING_PREREQUISITE"]
        assert len(missing_prereqs) == 0

    def test_configuration_fallback_when_raw_content_empty(self):
        """Request with raw_content='' falls back to request.configuration cleanly."""
        engine = SoftwareCollectionEngine()
        config_payload = {
            "collections": [
                {"id": "SC_CONF_A", "dependencies": []},
                {"id": "SC_CONF_B", "dependencies": ["SC_CONF_A"]},
            ]
        }
        req = make_request("", configuration=config_payload)
        resp = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        seq = resp.metrics.additional_metrics.get("recommended_sequence")
        assert seq == ["SC_CONF_A", "SC_CONF_B"]

    def test_evaluate_classmethod_varied_input_types(self):
        """evaluate() handles dict input, set input, and missing dependencies robustly."""
        res_dict = SoftwareCollectionEngine.evaluate(
            collections={"COL_1": {}, "COL_2": {}},
            dependencies={"COL_2": ["COL_1"]}
        )
        assert res_dict["status"] == "COMPLETED"
        assert res_dict["recommended_sequence"] == ["COL_1", "COL_2"]

        res_str_dep = SoftwareCollectionEngine.evaluate(
            collections=["COL_A", "COL_B"],
            dependencies={"COL_B": "COL_A"}
        )
        assert res_str_dep["status"] == "COMPLETED"
        assert res_str_dep["recommended_sequence"] == ["COL_A", "COL_B"]

        res_empty = SoftwareCollectionEngine.evaluate([], {})
        assert res_empty["status"] == "COMPLETED"
        assert res_empty["has_cycles"] is False
        assert res_empty["recommended_sequence"] == []


# =============================================================================
# Suite 7: Randomized Graph Fuzzing & Stress Invariance
# =============================================================================

class TestRandomizedGraphFuzzing:
    """Randomized stress fuzzing generating valid DAGs and cyclic graphs to assert structural invariants."""

    def test_fuzz_random_acyclic_dags(self):
        """50 randomly generated DAGs must always report has_cycles=False and 100% valid topological order."""
        rng = random.Random(1337)
        for trial in range(50):
            node_count = rng.randint(5, 30)
            nodes = [f"N_{i:02d}" for i in range(node_count)]
            # Construct upper-triangular edges to guarantee DAG
            deps: Dict[str, List[str]] = {n: [] for n in nodes}
            for i in range(node_count):
                for j in range(i):
                    if rng.random() < 0.25:  # 25% edge probability
                        deps[nodes[i]].append(nodes[j])

            res = SoftwareCollectionEngine.evaluate(nodes, deps)
            assert res["status"] == "COMPLETED"
            assert res["has_cycles"] is False, f"Trial {trial}: Falsely detected cycle in a verified DAG!"
            seq = res["recommended_sequence"]
            assert len(seq) == node_count

            # Verify every dependency constraint is satisfied in output
            pos = {node: idx for idx, node in enumerate(seq)}
            for u, prereqs in deps.items():
                for p in prereqs:
                    assert pos[p] < pos[u], f"Topological sort order violated: {p} must precede {u}"

    def test_fuzz_random_cyclic_graphs(self):
        """50 randomly generated graphs with injected cycles must always detect has_cycles=True and return empty sequence."""
        rng = random.Random(7331)
        for trial in range(50):
            node_count = rng.randint(5, 25)
            nodes = [f"N_{i:02d}" for i in range(node_count)]
            deps: Dict[str, List[str]] = {n: [] for n in nodes}

            # Inject a cycle of length k (between 2 and node_count)
            cycle_len = rng.randint(2, node_count)
            cycle_nodes = rng.sample(nodes, cycle_len)
            for idx in range(cycle_len):
                u = cycle_nodes[idx]
                v = cycle_nodes[(idx + 1) % cycle_len]
                deps[u].append(v)

            res = SoftwareCollectionEngine.evaluate(nodes, deps)
            assert res["status"] == "COMPLETED"
            assert res["has_cycles"] is True, f"Trial {trial}: Failed to detect injected cycle: {cycle_nodes}"
            assert res["recommended_sequence"] == []
            assert len(res["findings"]) >= 1


# =============================================================================
# Suite 8: Multibyte Unicode & Internationalization Resilience
# =============================================================================

class TestMultibyteUnicodeResilience:
    """Stress testing international characters, German umlauts, Japanese kanji, and emojis in collection and item IDs."""

    def test_multibyte_unicode_manifest_parsed_cleanly(self):
        """Manifest containing German umlauts, Japanese kanji, and accents is parsed and evaluated with valid SHA-256."""
        engine = SoftwareCollectionEngine()
        manifest = {
            "export_id": "EXP_2026_MÜNCHEN_東京",
            "collections": [
                {
                    "id": "SC_VERKÄUFE_GRUNDLAGE",
                    "name": "Grundlegende Verkaufsfunktionen",
                    "dependencies": [],
                    "items": [
                        {
                            "id": "YY1_顧客分類コード",
                            "type": "CUSTOM_FIELD",
                            "status": "PUBLISHED",
                        }
                    ]
                },
                {
                    "id": "SC_AUFTRAGSVERWALTUNG_東京",
                    "name": "Auftragsverwaltung mit 東京 Analytics",
                    "dependencies": ["SC_VERKÄUFE_GRUNDLAGE"],
                    "items": [
                        {
                            "id": "YY1_売上レポート_VIEW",
                            "type": "CDS_VIEW",
                            "status": "PUBLISHED",
                            "dependencies": ["SC_VERKÄUFE_GRUNDLAGE:YY1_顧客分類コード"]
                        }
                    ]
                }
            ]
        }
        raw_json = json.dumps(manifest, ensure_ascii=False)
        req = make_request(raw_json)
        resp = asyncio.run(engine.analyze(req))

        assert resp.status == AnalysisStatus.COMPLETED
        seq = resp.metrics.additional_metrics.get("recommended_sequence")
        assert seq == ["SC_VERKÄUFE_GRUNDLAGE", "SC_AUFTRAGSVERWALTUNG_東京"]
        # No critical/blocker findings
        assert len([f for f in resp.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]) == 0
