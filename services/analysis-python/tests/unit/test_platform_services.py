import pytest
from src.platform.redaction import SecretRedactionEngine
from src.platform.audit import AuditTrailLedger, compute_audit_chain_hash, canonical_json_serialize
from src.platform.evidence import EvidenceEngine, ReleaseAlignmentValidator
from src.platform.router import AIProblemRouter, EngineRecommendation


class TestSecretRedactionEngine:
    def test_bearer_token_redacted_with_deterministic_hmac(self):
        engine1 = SecretRedactionEngine(tenant_id="tenant-alpha", master_key="unit-test-master-key")
        engine2 = SecretRedactionEngine(tenant_id="tenant-beta", master_key="unit-test-master-key")
        text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcnh5i_Imc"

        res1 = engine1.redact(text)
        assert res1.redactions_count >= 1
        assert "BEARER_TOKEN" in res1.redacted_categories or "JWT" in res1.redacted_categories
        assert "[REDACTED:SECRET:" in res1.sanitized_text

        # Different tenant produces different mask for cross-tenant privacy
        res2 = engine2.redact(text)
        assert res1.sanitized_text != res2.sanitized_text

        # Same tenant produces identical mask for referential integrity
        res1_repeat = engine1.redact(text)
        assert res1.sanitized_text == res1_repeat.sanitized_text

    def test_no_hardcoded_master_key_unkeyed_mask_when_env_absent(self, monkeypatch):
        for name in SecretRedactionEngine.MASTER_KEY_ENV_VARS:
            monkeypatch.delenv(name, raising=False)
        engine = SecretRedactionEngine(tenant_id="tenant-alpha")
        assert engine.keyed is False
        res = engine.redact("PASSWD = TopSecretRFC2026!;")
        assert "TopSecretRFC2026!" not in res.sanitized_text
        assert SecretRedactionEngine.UNKEYED_MASK in res.sanitized_text
        # Idempotent: re-redacting an already masked text does not re-mask
        assert engine.redact(res.sanitized_text).redactions_count == 0

    def test_master_key_read_from_environment(self, monkeypatch):
        for name in SecretRedactionEngine.MASTER_KEY_ENV_VARS:
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv("REDACTION_HMAC_KEY", "env-provided-key")
        engine = SecretRedactionEngine(tenant_id="tenant-alpha")
        assert engine.keyed is True
        explicit = SecretRedactionEngine(tenant_id="tenant-alpha", master_key="env-provided-key")
        assert engine.get_mask("s3cr3t") == explicit.get_mask("s3cr3t")
        assert "DEFAULT_SALT_FOR_DEV" not in open(__import__("src.platform.redaction", fromlist=["x"]).__file__).read()

    def test_private_key_redacted(self):
        engine = SecretRedactionEngine(tenant_id="tenant-alpha")
        fake_key = (
            "-----BEGIN RSA PRIVATE KEY-----\n"
            "MIIEowIBAAKCAQEA0Y1+g43hYj\n"
            "-----END RSA PRIVATE KEY-----"
        )
        res = engine.redact(fake_key)
        assert res.redactions_count == 1
        assert "PRIVATE_KEY" in res.redacted_categories
        assert "MIIEow" not in res.sanitized_text

    def test_sap_rfc_credentials_redacted(self):
        engine = SecretRedactionEngine(tenant_id="tenant-alpha")
        cfg = "RFC_DEST = S4H; USER = RFC_USER; PASSWD = TopSecretRFC2026!;"
        res = engine.redact(cfg)
        assert "TopSecretRFC2026!" not in res.sanitized_text
        assert "[REDACTED:SECRET" in res.sanitized_text

    def test_shannon_entropy_detection_and_allowlist(self):
        engine = SecretRedactionEngine(tenant_id="tenant-alpha")
        # High entropy random string
        text_with_entropy = "token = '8f3a9b1c7d2e4f0a9b8c7d6e5f4a3b2c1d0e9f8a'"
        res = engine.redact(text_with_entropy)
        assert "8f3a9b1c7d2e4f0a9b8c7d6e5f4a3b2c1d0e9f8a" not in res.sanitized_text

        # Allowlisted SAP table and keywords not redacted
        safe_code = "SELECT * FROM MARA INTO TABLE @DATA(lt_mara)."
        res_safe = engine.redact(safe_code)
        assert "MARA" in res_safe.sanitized_text
        assert "SELECT" in res_safe.sanitized_text
        assert res_safe.redactions_count == 0


class TestAuditTrailLedger:
    def test_ledger_creation_and_tamper_verification_success(self):
        tenant_id = "tenant-001"
        ev0 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="FILE_UPLOADED",
            payload={"file": "test.xml", "size": 1024},
            timestamp="2026-09-24T03:00:00Z",
        )
        ev1 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ANALYSIS_STARTED",
            payload={"engine": "OPD_GUARD"},
            prev_hash=ev0.current_hash,
            timestamp="2026-09-24T03:01:00Z",
        )
        ev2 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="FINDING_GENERATED",
            payload={"rule_id": "OPD_001", "severity": "BLOCKER"},
            prev_hash=ev1.current_hash,
            timestamp="2026-09-24T03:02:00Z",
        )

        verification = AuditTrailLedger.verify_ledger([ev0, ev1, ev2])
        assert verification.is_valid is True
        assert verification.total_events_verified == 3
        assert len(verification.anomalies) == 0

    def test_tamper_detection_broken_chain_link(self):
        tenant_id = "tenant-001"
        ev0 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ACTION_A",
            payload={"a": 1},
            timestamp="2026-09-24T03:00:00Z",
        )
        ev1 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ACTION_B",
            payload={"b": 2},
            prev_hash="f" * 64,  # Corrupted previous hash!
            timestamp="2026-09-24T03:01:00Z",
        )
        verification = AuditTrailLedger.verify_ledger([ev0, ev1])
        assert verification.is_valid is False
        assert any(a.anomaly_type == "BROKEN_CHAIN_LINK" for a in verification.anomalies)

    def test_tamper_detection_corrupted_payload(self):
        tenant_id = "tenant-001"
        ev0 = AuditTrailLedger.create_event(
            organization_id=tenant_id,
            action="ACTION_A",
            payload={"status": "INITIAL"},
            timestamp="2026-09-24T03:00:00Z",
        )
        # Tamper with payload after creation without updating current_hash
        tampered_dict = {
            "id": ev0.id,
            "organization_id": ev0.organization_id,
            "action": ev0.action,
            "resource_type": ev0.resource_type,
            "resource_id": ev0.resource_id,
            "payload": {"status": "TAMPERED_BY_ATTACKER"},
            "prev_hash": ev0.prev_hash,
            "current_hash": ev0.current_hash,
            "created_at": ev0.created_at,
        }
        verification = AuditTrailLedger.verify_ledger([tampered_dict])
        assert verification.is_valid is False
        assert any(a.anomaly_type == "CORRUPTED_PAYLOAD" for a in verification.anomalies)


class TestEvidenceEngine:
    def test_snippet_verification(self):
        artifact = "REPORT zorder.\nDATA lv_var TYPE i.\nSELECT * FROM mara INTO TABLE @DATA(lt_mara)."
        snippet = "SELECT * FROM mara INTO TABLE @DATA(lt_mara)."
        res = EvidenceEngine.verify_snippet(artifact, snippet)
        assert res["is_valid"] is True
        assert res["matched"] is True

        res_invalid = EvidenceEngine.verify_snippet(artifact, "NON_EXISTENT_CODE_SNIPPET")
        assert res_invalid["is_valid"] is False

    def test_release_alignment_validation(self):
        # Target S4H 2023 requires 2022 -> aligned (distance 1 < 2)
        aligned = ReleaseAlignmentValidator.validate(
            target_release="S4H_2023",
            valid_from="S4H_2022",
        )
        assert aligned.is_aligned is True
        assert aligned.status == "RELEASE_ALIGNED"

        # Premature: target 2020 requires 2023
        premature = ReleaseAlignmentValidator.validate(
            target_release="S4H_2020",
            valid_from="S4H_2023",
        )
        assert premature.is_aligned is False
        assert premature.status == "RELEASE_PREMATURE"

        # Deprecated: target 2023 removed in 2021
        deprecated = ReleaseAlignmentValidator.validate(
            target_release="S4H_2023",
            valid_to="S4H_2021",
        )
        assert deprecated.is_aligned is False
        assert deprecated.status == "RELEASE_DEPRECATED"

    def test_composite_trust_score(self):
        # Multiple evidence scores
        score = EvidenceEngine.calculate_composite_trust([1.0, 0.5])
        assert 0.0 <= score <= 1.0


class TestAIProblemRouter:
    def test_deterministic_intent_routing(self):
        res = AIProblemRouter.route_query(
            problem_text="Form template invoice layout fails in Adobe forms",
            artifact_names=["invoice.xdp"],
        )
        assert res.status == "SUCCESS"
        assert any(rec.engine_type == "FORM_DOCTOR" for rec in res.recommended_engines)
        # Verify strict 0.60 ceiling invariant
        for rec in res.recommended_engines:
            assert rec.confidence <= 0.60
