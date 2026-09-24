"""
Empirical Adversarial Test Suite for Milestone 2:
1. SecretRedactor Challenge: High-entropy detection boundaries, edge-case SAP RFC strings, RSA/private keys, mask irreversibility.
2. AuditTrailService Challenge: Hash chain verification, simulated tampering (corrupted payload, broken chain link, timestamp anachronism, missing genesis).
3. AIProblemRouter Challenge: Deterministic routing accuracy across all 19 engines, epistemic ceiling (0.60).
"""

import hashlib
import hmac
import math
import re
import uuid
import pytest

from src.models.enums import EngineType, ConfidenceClass
from src.platform.redaction import SecretRedactionEngine
from src.platform.audit import AuditTrailLedger, compute_audit_chain_hash, canonical_json_serialize
from src.platform.evidence import EvidenceEngine, ReleaseAlignmentValidator
from src.platform.router import AIProblemRouter, EngineRecommendation


# ============================================================================
# 1. SECRET REDACTION ENGINE ADVERSARIAL CHALLENGES
# ============================================================================

class TestSecretRedactorChallenges:
    """Stress-test SecretRedactionEngine against edge cases, entropy boundaries, and key formats."""

    @pytest.fixture
    def engine(self):
        return SecretRedactionEngine(tenant_id="tenant-audit-999", master_key="super-secret-master-key-32chars")

    # --- High-Entropy Secret Detection & Boundaries ---

    def test_remediation_length_calibrated_entropy_detection(self, engine):
        """Verify that length-calibrated thresholds reliably catch secrets of lengths 16, 20, 22, 24, 32, 64."""
        for secret in [
            "k9Z1mP4vL8wQ2xR7",                 # L=16 alnum
            "abcdefghijklmnopqrst",             # L=20 unique
            "abcdefghijklmnopqrstuv",           # L=22 unique
            "abcdefghijklmnopqrstuvwx",         # L=24 unique
            "4f9b8c2e1d0a3f5b7c8e9d0a",         # L=24 hex
            "k9Z1mP4vL8wQ2xR7jA3bC5dEfG8hI0jK", # L=32 alnum
            "4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e", # L=64 hex
        ]:
            assert engine.is_candidate_token(secret) is True, f"Failed to detect secret: {secret}"

    def test_preserves_sap_namespaces_and_architectural_prefixes(self, engine):
        """Namespaces (/COMPANY/..., /SDF/...) and CDS/ABAP prefixes must not be redacted."""
        for token in [
            "/COMPANY/ERP_MIGRATION_TOOL",
            "/SDF/RBE_METRIC_COLLECTOR",
            "/UI5/SAP_LIB_CORE",
            "I_PRODUCT_SALES_DELIVERY",
            "C_SALESORDERITEMQUERY",
            "CL_REST_HTTP_CLIENT_FACTORY",
            "ZCUSTOM_TABLE_01",
        ]:
            assert engine.is_candidate_token(token) is False, f"False positive on SAP object: {token}"

    def test_entropy_boundary_length_thresholds(self, engine):
        """Tokens <16 characters must NOT be redacted by entropy scanner, tokens >=23 with high entropy MUST be."""
        # 15 chars, high entropy: should NOT be redacted
        short_high_entropy = "aB3$zK9!pQ1#wX8"
        assert len(short_high_entropy) == 15
        res_short = engine.redact(f"var token = '{short_high_entropy}'")
        assert short_high_entropy in res_short.sanitized_text

        # 24 chars, high entropy (>4.5): MUST be redacted
        twenty_four_high_entropy = "aB3$zK9!pQ1#wX8&mN5*vY7?"
        assert len(twenty_four_high_entropy) == 24
        res_24 = engine.redact(f"var token = '{twenty_four_high_entropy}'")
        assert twenty_four_high_entropy not in res_24.sanitized_text
        assert "[REDACTED:SECRET:" in res_24.sanitized_text

    def test_entropy_hex_token_detection(self, engine):
        """32+ char hex tokens (e.g. MD5/SHA hashes or API tokens) must be detected at h >= 3.2."""
        hex_32 = "4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e"
        assert len(hex_32) == 32
        res_hex = engine.redact(f"api_hash = '{hex_32}'")
        assert hex_32 not in res_hex.sanitized_text
        assert "[REDACTED:SECRET:" in res_hex.sanitized_text

    def test_allowlist_preserves_sap_standard_tables_and_keywords(self, engine):
        """Critical SAP tables (BKPF, BSEG, MARA, SWWWIHEAD) and ABAP keywords must NEVER be redacted."""
        sap_payload = """
        SELECT * FROM BKPF INNER JOIN BSEG ON BKPF~BELNR = BSEG~BELNR
        WHERE BKPF~BUKRS = '1000' INTO TABLE @DATA(lt_bseg).
        ASSIGN COMPONENT 'DMBTR' OF STRUCTURE <fs_line> TO FIELD-SYMBOLS(<fs_val>).
        """
        res = engine.redact(sap_payload)
        assert "BKPF" in res.sanitized_text
        assert "BSEG" in res.sanitized_text
        assert "SELECT" in res.sanitized_text
        assert "FIELD-SYMBOLS" in res.sanitized_text
        assert res.redactions_count == 0

    def test_uuid_exclusion_from_redaction(self, engine):
        """Standard UUIDs must not be redacted even if they have moderate entropy."""
        sample_uuid = "c1234567-89ab-cdef-0123-456789abcdef"
        res = engine.redact(f"record_id: {sample_uuid}")
        assert sample_uuid in res.sanitized_text
        assert res.redactions_count == 0

    # --- Edge-Case SAP RFC Strings ---

    def test_sap_rfc_connection_strings(self, engine):
        """Standard SAP RFC connection string parameters must be redacted."""
        rfc_str = "ASHOST=sapdev01.corp.internal SYSNR=01 CLIENT=100 USER=RFC_BATCH PASSWD=SuperSecret2026!"
        res = engine.redact(rfc_str)
        assert "SuperSecret2026!" not in res.sanitized_text
        assert "[REDACTED:SECRET:" in res.sanitized_text

    def test_sap_rfc_case_insensitivity(self, engine):
        """RFC passwords with various capitalizations (pwd, PWD, passwd, Password) must all be masked."""
        cases = [
            "pwd = 'secret_pwd_val'",
            "PWD = 'secret_PWD_val'",
            "password = 'secret_password_val'",
            "RFC_PASS = 'secret_rfc_pass_val'",
        ]
        for c in cases:
            res = engine.redact(c)
            assert "[REDACTED:SECRET:" in res.sanitized_text

    def test_remediation_sap_rfc_password_quoted_with_semicolon_completely_redacted(self, engine):
        """RFC passwords enclosed in quotes with embedded semicolons must be completely redacted."""
        rfc_quoted = 'rfc_password = "Secret;Complex;Pass#123"'
        res = engine.redact(rfc_quoted)
        assert "Secret;Complex;Pass#123" not in res.sanitized_text
        assert ";Complex;Pass#123" not in res.sanitized_text
        assert "[REDACTED:SECRET:" in res.sanitized_text

    def test_remediation_sap_rfc_params_quoted_with_delimiters_completely_redacted(self, engine):
        """RFC connection strings with quoted parameters containing whitespace, commas, or semicolons."""
        payload = 'rfc_conn = "passwd=\'My;Secret,P@ss 99\';user=\'BAPI_USER\'"'
        res = engine.redact(payload)
        assert "My;Secret,P@ss 99" not in res.sanitized_text
        assert "[REDACTED:SECRET:" in res.sanitized_text

    def test_remediation_saprouter_string_with_port_and_destinations_completely_redacted(self, engine):
        """SAProuter route strings containing ports (/S/3299) and destinations must have password redacted."""
        router_str = "/H/router.corp/S/3299/W/SecretRouterPassword/H/target.corp/S/3200"
        res = engine.redact(router_str)
        assert "SecretRouterPassword" not in res.sanitized_text
        assert "[REDACTED:SECRET:" in res.sanitized_text

    def test_remediation_saprouter_multi_hop_route_string_completely_redacted(self, engine):
        """Multi-hop SAProuter strings with /P/ passwords must have password redacted."""
        router_str = "/H/gate1/S/3299/P/PassOne/H/gate2/W/PassTwo/H/app"
        res = engine.redact(router_str)
        assert "PassOne" not in res.sanitized_text
        assert "PassTwo" not in res.sanitized_text

    # --- Private Keys (RSA, EC, OPENSSH, PGP, CRLF) ---

    def test_rsa_private_key_with_crlf_newlines(self, engine):
        """Private keys formatted with Windows CRLF (\\r\\n) line endings must be cleanly redacted."""
        crlf_key = (
            "-----BEGIN RSA PRIVATE KEY-----\r\n"
            "MIIEowIBAAKCAQEA0Y1+g43hYjdQkI3+4W5\r\n"
            "Z1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8\r\n"
            "-----END RSA PRIVATE KEY-----"
        )
        res = engine.redact(crlf_key)
        assert res.redactions_count >= 1
        assert "MIIEowIBAAKCAQEA" not in res.sanitized_text
        assert "[REDACTED:SECRET:" in res.sanitized_text

    def test_ec_and_openssh_private_keys(self, engine):
        """EC and OPENSSH private key blocks must be redacted."""
        ec_key = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEI\n-----END EC PRIVATE KEY-----"
        res_ec = engine.redact(ec_key)
        assert "MHcCAQEEI" not in res_ec.sanitized_text

        openssh_key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA\n-----END OPENSSH PRIVATE KEY-----"
        res_ssh = engine.redact(openssh_key)
        assert "b3BlbnNzaC1rZXktdjEAAAA" not in res_ssh.sanitized_text

    # --- Irreversibility and Tenant Isolation ---

    def test_masked_tokens_irreversibility(self, engine):
        """
        Cryptographic One-Way Invariant:
        Mask tokens [REDACTED:SECRET:{64-hex}] are generated using HMAC-SHA256 with a tenant-salted key.
        Verify that:
        1. Mask token cannot be inverted back to plaintext without knowing the secret and key.
        2. Cross-tenant privacy: Two different tenants encrypting the same secret produce different masks.
        3. Deterministic referential integrity: Same tenant encrypting same secret produces identical mask.
        """
        secret = "SuperSecretDbPassword2026!"
        mask_t1 = engine.get_mask(secret)

        # Cross-tenant check
        engine_t2 = SecretRedactionEngine(tenant_id="tenant-audit-different", master_key="super-secret-master-key-32chars")
        mask_t2 = engine_t2.get_mask(secret)

        assert mask_t1 != mask_t2, "Cross-tenant privacy violated: identical masks across tenants!"
        assert mask_t1 == engine.get_mask(secret), "Referential integrity violated: non-deterministic mask!"

        # Extract HMAC hex
        hex_digest = mask_t1.replace("[REDACTED:SECRET:", "").replace("]", "")
        assert len(hex_digest) == 64
        # Verify digest is valid hex
        assert all(c in "0123456789abcdef" for c in hex_digest)


# ============================================================================
# 2. AUDIT TRAIL SERVICE ADVERSARIAL CHALLENGES
# ============================================================================

class TestAuditTrailChallenges:
    """Stress-test AuditTrailLedger hash chaining, tamper detection, and anomalies."""

    def test_multi_event_valid_chain_verification(self):
        """A linear sequence of 10 audit events must verify successfully."""
        tenant_id = "tenant-audit-ledger-test"
        events = []
        prev = None
        for i in range(10):
            ev = AuditTrailLedger.create_event(
                organization_id=tenant_id,
                action=f"STEP_{i}",
                payload={"index": i, "step_name": f"Validation step {i}"},
                prev_hash=prev,
                timestamp=f"2026-09-24T03:{i:02d}:00Z",
            )
            events.append(ev)
            prev = ev.current_hash

        result = AuditTrailLedger.verify_ledger(events)
        assert result.is_valid is True
        assert result.total_events_verified == 10
        assert len(result.anomalies) == 0

    def test_tamper_missing_genesis_prev_hash(self):
        """Genesis event with non-zero prev_hash must be flagged as MISSING_GENESIS_PREV_HASH."""
        ev = AuditTrailLedger.create_event(
            organization_id="tenant-1",
            action="GENESIS_ACTION",
            payload={"k": "v"},
            prev_hash="a" * 64,  # Corrupted genesis!
            timestamp="2026-09-24T03:00:00Z",
        )
        result = AuditTrailLedger.verify_ledger([ev])
        assert result.is_valid is False
        assert any(a.anomaly_type == "MISSING_GENESIS_PREV_HASH" for a in result.anomalies)

    def test_tamper_simulate_corrupted_past_event_payload(self):
        """Modifying a single field in a past event's payload must trigger CORRUPTED_PAYLOAD anomaly."""
        tenant_id = "tenant-tamper-test"
        ev0 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="FILE_UPLOAD",
            payload={"filename": "clean_code.abap", "lines": 150},
            timestamp="2026-09-24T03:00:00Z",
        )
        ev1 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ANALYSIS_RUN",
            payload={"status": "COMPLETED"},
            prev_hash=ev0.current_hash,
            timestamp="2026-09-24T03:01:00Z",
        )

        # Attacker tampers with ev0 payload (e.g. hides that lines were 1500)
        tampered_ev0 = {
            "id": ev0.id,
            "organization_id": ev0.organization_id,
            "action": ev0.action,
            "resource_type": ev0.resource_type,
            "resource_id": ev0.resource_id,
            "payload": {"filename": "clean_code.abap", "lines": 1500},  # Tampered!
            "prev_hash": ev0.prev_hash,
            "current_hash": ev0.current_hash,
            "created_at": ev0.created_at,
        }

        result = AuditTrailLedger.verify_ledger([tampered_ev0, ev1])
        assert result.is_valid is False
        corrupted_anomalies = [a for a in result.anomalies if a.anomaly_type == "CORRUPTED_PAYLOAD"]
        assert len(corrupted_anomalies) >= 1
        assert corrupted_anomalies[0].event_index == 0

    def test_tamper_simulate_broken_hash_link(self):
        """Corrupting prev_hash of a successor event must trigger BROKEN_CHAIN_LINK anomaly."""
        tenant_id = "tenant-link-test"
        ev0 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ACTION_0",
            payload={"seq": 0},
            timestamp="2026-09-24T03:00:00Z",
        )
        ev1 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ACTION_1",
            payload={"seq": 1},
            prev_hash="deadbeef" * 8,  # Broken link!
            timestamp="2026-09-24T03:01:00Z",
        )

        result = AuditTrailLedger.verify_ledger([ev0, ev1])
        assert result.is_valid is False
        broken_links = [a for a in result.anomalies if a.anomaly_type == "BROKEN_CHAIN_LINK"]
        assert len(broken_links) >= 1
        assert broken_links[0].event_index == 1

    def test_tamper_simulate_reordered_events_and_timestamp_anachronism(self):
        """Swapping two events in time must trigger both BROKEN_CHAIN_LINK and TIMESTAMP_ANACHRONISM."""
        tenant_id = "tenant-anachronism-test"
        ev0 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ACTION_0",
            payload={"seq": 0},
            timestamp="2026-09-24T03:00:00Z",
        )
        ev1 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ACTION_1",
            payload={"seq": 1},
            prev_hash=ev0.current_hash,
            timestamp="2026-09-24T03:05:00Z",
        )
        ev2 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ACTION_2",
            payload={"seq": 2},
            prev_hash=ev1.current_hash,
            timestamp="2026-09-24T03:10:00Z",
        )

        # Attacker swaps ev1 and ev2
        result = AuditTrailLedger.verify_ledger([ev0, ev2, ev1])
        assert result.is_valid is False
        types = {a.anomaly_type for a in result.anomalies}
        assert "BROKEN_CHAIN_LINK" in types
        assert "TIMESTAMP_ANACHRONISM" in types

    def test_remediation_timestamp_collision_resolved_by_sequence_num(self):
        """
        Timestamp collision resolved by sequence_num ordering.
        Events sharing identical timestamps remain strictly ordered by monotonic sequence_num.
        """
        genesis = "0" * 64
        shared_time = "2026-09-24T03:00:00.000Z"

        # Event A: sequence_num = 1, larger UUID
        id_a = "ffffffff-0000-0000-0000-000000000000"
        hash_a = compute_audit_chain_hash(genesis, id_a, "t1", "ACTION_A", shared_time, {}, sequence_num=1)
        ev_a = {
            "id": id_a,
            "sequence_num": 1,
            "organization_id": "t1",
            "action": "ACTION_A",
            "created_at": shared_time,
            "payload": {},
            "prev_hash": genesis,
            "current_hash": hash_a,
        }

        # Event B: sequence_num = 2, smaller UUID
        id_b = "00000000-0000-0000-0000-000000000000"
        hash_b = compute_audit_chain_hash(hash_a, id_b, "t1", "ACTION_B", shared_time, {}, sequence_num=2)
        ev_b = {
            "id": id_b,
            "sequence_num": 2,
            "organization_id": "t1",
            "action": "ACTION_B",
            "created_at": shared_time,
            "payload": {},
            "prev_hash": hash_a,
            "current_hash": hash_b,
        }

        # Query order sorted by sequence_num ASC:
        query_result = sorted([ev_b, ev_a], key=lambda x: x["sequence_num"])
        assert query_result[0]["id"] == id_a
        assert query_result[1]["id"] == id_b

        verification = AuditTrailLedger.verify_ledger(query_result)
        assert verification.is_valid is True
        assert verification.total_events_verified == 2
        assert len(verification.anomalies) == 0

    def test_audit_ledger_sequence_gap_detection(self):
        """Detects deleted or missing audit events via sequence_num gaps."""
        genesis = "0" * 64
        t0 = "2026-09-24T03:00:00.000Z"
        t1 = "2026-09-24T03:01:00.000Z"

        id1 = "11111111-1111-1111-1111-111111111111"
        h1 = compute_audit_chain_hash(genesis, id1, "t1", "ACT_1", t0, {}, sequence_num=1)
        ev1 = {"id": id1, "sequence_num": 1, "organization_id": "t1", "action": "ACT_1", "created_at": t0, "payload": {}, "prev_hash": genesis, "current_hash": h1}

        # Event 2 was deleted! Event 3 has sequence_num = 3 and links to h1
        id3 = "33333333-3333-3333-3333-333333333333"
        h3 = compute_audit_chain_hash(h1, id3, "t1", "ACT_3", t1, {}, sequence_num=3)
        ev3 = {"id": id3, "sequence_num": 3, "organization_id": "t1", "action": "ACT_3", "created_at": t1, "payload": {}, "prev_hash": h1, "current_hash": h3}

        res = AuditTrailLedger.verify_ledger([ev1, ev3])
        assert res.is_valid is False
        gaps = [a for a in res.anomalies if a.anomaly_type == "GAP_DETECTED"]
        assert len(gaps) == 1
        assert gaps[0].event_index == 1
        assert gaps[0].expected_value == "2"
        assert gaps[0].actual_value == "3"


# ============================================================================
# 3. AI PROBLEM ROUTER ADVERSARIAL CHALLENGES
# ============================================================================

class TestAIProblemRouterChallenges:
    """Test deterministic routing accuracy across all 19 engines and verify the epistemic ceiling."""

    ALL_19_ENGINES = [
        EngineType.OPD_GUARD,
        EngineType.FORM_DOCTOR,
        EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
        EngineType.EXTENSION_IMPACT_GUARD,
        EngineType.SPRO2CLOUD,
        EngineType.ECC2CLOUD_NAVIGATOR,
        EngineType.SAP_GAP_RADAR,
        EngineType.CLEAN_CORE_OBJECT_GUARD,
        EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        EngineType.API_CHANGE_GUARD,
        EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
        EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
        EngineType.SAFE_DECOMMISSION_PREFLIGHT,
        EngineType.FIORI_403_ROOT_CAUSE_DOCTOR,
        EngineType.WORKFLOW_STUCK_EXPLAINER,
        EngineType.IAM_COST_OPTIMIZER,
        EngineType.ACCOUNT_DETERMINATION_PREFLIGHT,
        EngineType.SYSTEM_REFRESH_DELTA_GUARD,
        EngineType.MFS_BLACKBOX,
    ]

    ENGINE_PROMPT_FIXTURES = {
        EngineType.OPD_GUARD: ("Output parameter determination brfplus rules for billing document", ["opd_rules.xml"]),
        EngineType.FORM_DOCTOR: ("Adobe forms xdp template syntax error in smartform migration", ["invoice.xdp"]),
        EngineType.CUSTOM_FIELD_FLOW_DOCTOR: ("Custom field yy1_ lineage flow error from CDS to UI", ["cfd.json"]),
        EngineType.EXTENSION_IMPACT_GUARD: ("Extension impact and blast radius analysis on abapgit repository", ["deps.json"]),
        EngineType.SPRO2CLOUD: ("IMG spro customizing migration to cloud sscui", ["spro_config.xml"]),
        EngineType.ECC2CLOUD_NAVIGATOR: ("ECC to Cloud readiness check analysis of st03n workload", ["st03n.csv"]),
        EngineType.SAP_GAP_RADAR: ("Clean core gap radar requirement analysis for scope item 1GA", ["gaps.csv"]),
        EngineType.CLEAN_CORE_OBJECT_GUARD: ("Clean core tier1 object guard checking classic_modification in abap", ["zcode.abap"]),
        EngineType.CHANGE_POINTER_COVERAGE_AUDITOR: ("Change pointer coverage bd52 bd61 configuration audit", ["bd52.json"]),
        EngineType.API_CHANGE_GUARD: ("API change guard analyzing edmx OData service deprecations", ["service.edmx"]),
        EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD: ("Export software collection dependency check", ["collection.json"]),
        EngineType.TRANSPORT_DEPENDENCY_ANALYZER: ("CTS transport dependency analyzer e070 sequence", ["e070.csv"]),
        EngineType.SAFE_DECOMMISSION_PREFLIGHT: ("Safe decommission preflight for retired usr02 programs", ["decom.csv"]),
        EngineType.FIORI_403_ROOT_CAUSE_DOCTOR: ("Fiori 403 forbidden error su53 s_service authorization check", ["su53.txt"]),
        EngineType.WORKFLOW_STUCK_EXPLAINER: ("Workflow stuck work item swwwihead error", ["swwwihead.csv"]),
        EngineType.IAM_COST_OPTIMIZER: ("IAM cost optimizer for fiori catalog pfcg license agr_1251", ["pfcg.json"]),
        EngineType.ACCOUNT_DETERMINATION_PREFLIGHT: ("Account determination preflight obyc vkoa configuration", ["obyc.xml"]),
        EngineType.SYSTEM_REFRESH_DELTA_GUARD: ("Post system refresh delta guard bdls and rfc destinations", ["bdls.json"]),
        EngineType.MFS_BLACKBOX: ("Material Flow System mfs telegram sequence buffer audit in ewm", ["telegram.log"]),
    }

    def test_all_19_engines_in_engine_keywords(self):
        """Every single engine from EngineType must have registered routing keywords."""
        registered_keys = set(AIProblemRouter.ENGINE_KEYWORDS.keys())
        expected_keys = {e.value for e in self.ALL_19_ENGINES}
        assert expected_keys == registered_keys, f"Mismatch in registered engines: {expected_keys ^ registered_keys}"

    def test_routing_accuracy_across_all_19_engines(self):
        """Each of the 19 engines must be accurately and uniquely identified with prompt fixtures."""
        for engine_type in self.ALL_19_ENGINES:
            problem_text, artifacts = self.ENGINE_PROMPT_FIXTURES[engine_type]
            result = AIProblemRouter.route_query(
                problem_text=problem_text,
                artifact_names=artifacts,
            )
            assert result.status == "SUCCESS", f"Routing failed for {engine_type}: status={result.status}"
            recommended = [r.engine_type for r in result.recommended_engines]
            assert engine_type.value in recommended, f"Engine {engine_type} not found in recommendations: {recommended}"

    def test_epistemic_ceiling_invariant_under_extreme_signal(self):
        """
        HARD EPISTEMIC CEILING INVARIANT:
        Even with multiple keyword and extension matches, Router recommendation confidence
        can NEVER exceed 0.60 (INFERRED).
        """
        # Over-saturated input with 5 keywords and extension
        saturated_input = "xdp adobe smartform sapscript form layout template invoice.xdp"
        result = AIProblemRouter.route_query(
            problem_text=saturated_input,
            artifact_names=["template.xdp"],
        )
        assert result.status == "SUCCESS"
        for rec in result.recommended_engines:
            assert rec.confidence <= 0.60, f"Epistemic ceiling violated: confidence {rec.confidence} > 0.60 for {rec.engine_type}"

    def test_engine_recommendation_dataclass_post_init_ceiling_clamp(self):
        """EngineRecommendation dataclass must clamp any confidence > 0.60 down to 0.60."""
        rec = EngineRecommendation(
            engine_type="FORM_DOCTOR",
            confidence=0.95,  # Attempting to elevate confidence
            rationale="Test rationale",
        )
        assert rec.confidence == 0.60, f"Dataclass failed to enforce epistemic ceiling: {rec.confidence}"


# ============================================================================
# 4. EVIDENCE PLATFORM REMEDIATIONS (TRUST SCORE & RELEASE ALIGNMENT)
# ============================================================================

class TestEvidencePlatformRemediations:
    """Test asymptotic corroboration Noisy-OR composite trust and S/4HANA Cloud YYMM classification."""

    def test_composite_trust_monotonic_booster(self):
        """Corroborating evidence must monotonically boost or maintain trust."""
        single = EvidenceEngine.calculate_composite_trust([0.85])
        assert single == 0.85

        corroborated_2 = EvidenceEngine.calculate_composite_trust([0.85, 0.85])
        assert corroborated_2 > 0.85
        assert corroborated_2 == 0.876

        corroborated_3 = EvidenceEngine.calculate_composite_trust([0.85, 0.85, 0.85])
        assert corroborated_3 > corroborated_2
        assert corroborated_3 == 0.897

        # 1.0 is anchored
        max_anchored = EvidenceEngine.calculate_composite_trust([1.0, 0.85])
        assert max_anchored == 1.0

        # LLM ceiling strictly capped at 0.60
        llm_capped = EvidenceEngine.calculate_composite_trust([0.85, 0.85], is_llm_generated=True)
        assert llm_capped == 0.60

    def test_s4hana_cloud_yymm_regex_classification(self):
        """Releases matching ^(2[0-9])(0[1-9]|1[0-2])$ classify as S4HANA_CLOUD."""
        for rel in ["2308", "2402", "2408", "2502"]:
            fam, ver = ReleaseAlignmentValidator._parse_release(rel)
            assert fam == "S4HANA_CLOUD"
            assert ver == int(rel)

        for rel in ["2020", "2021", "2022", "2023", "2025"]:
            fam, ver = ReleaseAlignmentValidator._parse_release(rel)
            assert fam == "ON_PREMISE"
            assert ver == int(rel)
