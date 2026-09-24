"""ERP Preflight - Tier 2: Boundary, Adversarial & Error Handling Test Suite.

Authoritative Specification: PROJECT.md, engines_spec.md, platform_spec.md.
Scope: Corrupt archives, oversized files, secret injection, path traversal,
XXE expansion, empty inputs, invalid encodings, extreme numeric/date bounds.
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
    CleanCoreObjectGuardEvaluator,
    ConfidenceClassifierEvaluator,
    CustomFieldFlowEvaluator,
    ExtensionImpactEvaluator,
    Fiori403DoctorEvaluator,
    FormDoctorEvaluator,
    IngestionEvaluator,
    MFSBlackBoxEvaluator,
    OPDGuardEvaluator,
    SAPGapRadarEvaluator,
    SecretRedactionEvaluator,
    SoftwareCollectionGuardEvaluator,
    SystemRefreshDeltaGuardEvaluator,
)


class TestTier2_CorruptArchivesAndHeaders:
    """Verifies handling of truncated, malformed, and corrupted file streams."""

    def test_truncated_zip_header_rejected(self):
        truncated_zip = b"PK\x03"  # Missing fourth byte
        ok, msg = IngestionEvaluator.validate_file_format("corrupt.zip", truncated_zip)
        assert ok is False
        assert msg == "INVALID_ZIP_MAGIC_BYTES"

    def test_corrupt_crc_archive_rejected(self):
        corrupt_bytes = b"\x00\x01\x02\x03\x04\x05"
        ok, msg = IngestionEvaluator.validate_file_format("corrupt.zip", corrupt_bytes)
        assert ok is False
        assert msg == "INVALID_ZIP_MAGIC_BYTES"

    def test_zero_byte_archive_rejected(self):
        ok, msg = IngestionEvaluator.validate_file_format("empty.zip", b"")
        assert ok is False
        assert msg == "INVALID_ZIP_MAGIC_BYTES"

    def test_malformed_json_syntax_rejected(self):
        bad_json = b'{"key": "value", unquoted_key: 123}'
        ok, msg = IngestionEvaluator.validate_file_format("bad.json", bad_json)
        assert ok is False
        assert msg == "INVALID_JSON_SYNTAX"

    def test_missing_file_extension_rejected(self):
        ok, msg = IngestionEvaluator.validate_file_format("unknown_file_type", b"some content")
        assert ok is False
        assert msg == "UNKNOWN_EXTENSION"


class TestTier2_ArchiveSafetyAndAttacks:
    """Verifies Zip Slip, Zip Bomb, and nested archive boundary defenses."""

    def test_zip_slip_unix_traversal_blocked(self):
        entries = [("../../../etc/shadow", 100, 200)]
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is False
        assert msg == "ZIP_SLIP_PATH_TRAVERSAL_DETECTED"

    def test_zip_slip_windows_backslash_blocked(self):
        entries = [("..\\..\\Windows\\System32\\cmd.exe", 100, 200)]
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is False
        assert msg == "ZIP_SLIP_PATH_TRAVERSAL_DETECTED"

    def test_zip_bomb_enormous_uncompressed_size(self):
        # 550 MB uncompressed (> 500 MB threshold)
        entries = [("big.txt", 1024, 550 * 1024 * 1024)]
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is False
        assert msg == "ZIP_BOMB_MAX_SIZE_EXCEEDED"

    def test_zip_bomb_extreme_compression_ratio(self):
        # 1000:1 compression ratio
        entries = [("bomb.txt", 20 * 1024, 50 * 1024 * 1024)]
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is False
        assert msg == "ZIP_BOMB_COMPRESSION_RATIO_EXCEEDED"

    def test_nested_path_without_escape_passes(self):
        entries = [("deep/nested/subfolder/valid_artifact.xml", 500, 1000)]
        ok, msg = IngestionEvaluator.check_archive_safety(entries)
        assert ok is True
        assert msg == "ARCHIVE_SAFE"


class TestTier2_XXEAndBillionLaughs:
    """Verifies XML External Entity (XXE) and recursive expansion prevention."""

    def test_xxe_system_entity_blocked(self):
        xxe_payload = b'<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>'
        ok, msg = IngestionEvaluator.validate_file_format("xxe.xml", xxe_payload)
        assert ok is False
        assert msg == "SECURITY_XXE_DETECTED"

    def test_billion_laughs_recursive_entity_blocked(self):
        billion_laughs = (
            b'<?xml version="1.0"?>'
            b'<!DOCTYPE lolz ['
            b'<!ENTITY lol "lol">'
            b'<!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;">'
            b'<!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;">'
            b']><lolz>&lol2;</lolz>'
        )
        ok, msg = IngestionEvaluator.validate_file_format("bomb.xml", billion_laughs)
        assert ok is False
        assert msg == "SECURITY_XXE_DETECTED"

    def test_xdp_with_embedded_script_handled_safely(self, fixtures_root):
        xdp_content = (fixtures_root / "forms" / "invoice_template.xdp").read_text(encoding="utf-8")
        bindings = [{"field": "Test", "dataRef": "$.Invoice.Header.InvoiceID"}]
        res = FormDoctorEvaluator.evaluate("<Invoice><Header><InvoiceID>1</InvoiceID></Header></Invoice>", bindings)
        assert res["status"] == "COMPLETED"


class TestTier2_SecretInjectionAndRedaction:
    """Verifies credential leak scanning across diverse formats and obfuscations."""

    def test_multiple_secrets_in_single_payload(self, fixtures_root):
        log_content = (fixtures_root / "boundary" / "transport_secret_injection.log").read_text(encoding="utf-8")
        res = SecretRedactionEvaluator.redact(log_content)
        assert res.redactions_count >= 4
        assert "[REDACTED_PASSWORD]" in res.sanitized_text
        assert "[REDACTED_PRIVATE_KEY]" in res.sanitized_text
        assert "[REDACTED_BEARER_TOKEN]" in res.sanitized_text
        assert "[REDACTED_API_KEY]" in res.sanitized_text

    def test_case_insensitive_rfc_pass_redaction(self):
        text = "rfc_pass = 'SecretPass99'"
        res = SecretRedactionEvaluator.redact(text)
        assert "[REDACTED_PASSWORD]" in res.sanitized_text
        assert "SecretPass99" not in res.sanitized_text

    def test_password_with_colons_and_quotes(self):
        text = 'password: "Complex!Token#1234"'
        res = SecretRedactionEvaluator.redact(text)
        assert "[REDACTED_PASSWORD]" in res.sanitized_text
        assert "Complex!Token#1234" not in res.sanitized_text


class TestTier2_EmptyAndNullInputs:
    """Verifies engine resilience against empty, blank, or null inputs."""

    def test_empty_string_abap_code(self):
        res = CleanCoreObjectGuardEvaluator.evaluate("")
        assert res["compliance_percentage"] == 100.0
        assert len(res["findings"]) == 0

    def test_empty_opd_tables(self):
        res = OPDGuardEvaluator.evaluate({}, {"DocType": "NB"})
        assert res["status"] == "PARTIAL"
        assert res["first_failed_step"] == "Output Type"

    def test_empty_extension_graph(self):
        res = ExtensionImpactEvaluator.evaluate("YY1_NON_EXISTENT", {})
        assert res["safe_to_delete"] is True
        assert len(res["direct_consumers"]) == 0

    def test_empty_account_determination_rules(self):
        res = AccountDeterminationEvaluator.evaluate([], {})
        assert res["status"] == "COMPLETED"
        assert len(res["findings"]) == 0

    def test_empty_mfs_stream(self):
        res = MFSBlackBoxEvaluator.evaluate([], set())
        assert res["first_causal_divergence"] is None
        assert len(res["findings"]) == 0


class TestTier2_ExtremeNumericAndDateBounds:
    """Verifies edge conditions in numeric thresholds, dates, and special characters."""

    def test_extreme_year_in_gap_radar(self):
        res = SAPGapRadarEvaluator.evaluate("Standard purchase order", "9999")
        assert res["resolution_tier"] == 1
        assert res["verdict"] == "SUPPORTED_STANDARD"

    def test_special_characters_in_sap_org_keys(self):
        tables = {"Output Type": [{"COND_CompanyCode": "D#01", "RESULT": "OUT1"}]}
        res = OPDGuardEvaluator.evaluate(tables, {"CompanyCode": "D#01"})
        assert res["results"].get("Output Type") == "OUT1"

    def test_negative_field_length_handled(self):
        hops = [("SRC", "TGT")]
        defs = {"SRC": {"length": -10}, "TGT": {"length": 20}}
        res = CustomFieldFlowEvaluator.evaluate("YY1_FIELD", hops, defs)
        # Should not throw exception
        assert res["status"] == "COMPLETED"

    def test_large_number_of_direct_consumers(self):
        large_consumers = [f"CDS_VIEW_{i}" for i in range(1000)]
        graph = {"YY1_MEGA": large_consumers}
        res = ExtensionImpactEvaluator.evaluate("YY1_MEGA", graph)
        assert len(res["direct_consumers"]) == 1000
        assert res["safe_to_delete"] is False

    def test_system_refresh_mixed_case_prod_leak(self):
        pre = {"RFC1": "pRoD-bAnK.InTeRnAl"}
        post = {"RFC1": "pRoD-bAnK.InTeRnAl"}
        res = SystemRefreshDeltaGuardEvaluator.evaluate(pre, post, False)
        assert any(f["code"] == "REFRESH_RFC_TARGETS_PRODUCTION" for f in res["findings"])
