"""
Empirical Adversarial Challenge & Stress-Testing Suite for Redaction & Entropy.
Directly tests Python SecretRedactionEngine against all 6 requirement dimensions:
1. Candidate tokens across lengths 16, 20, 22, 24, 32, 64 (Hex, Alphanumeric, Base64).
2. Quoted RFC passwords with semicolons, commas, spaces, hashes.
3. SAProuter connection strings (with /S/3299, multi-hop, /P/, terminal).
4. SAP technical objects & DDIC (MARA, BKPF, SWWWIHEAD, ZCUSTOM_TABLE_01, /COMPANY/..., I_PRODUCT...).
5. Boundary conditions, sub-threshold tokens, low-entropy repetitions.
6. End-to-end redaction pipeline integration and deterministic mask verification.
"""

import math
import random
import re
import string
import os
import sys
import pytest

# Ensure analysis-python is in pythonpath
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "services", "analysis-python"))

from src.platform.redaction import SecretRedactionEngine, RedactionResult


@pytest.fixture
def engine():
    return SecretRedactionEngine(
        tenant_id="c1111111-1111-1111-1111-111111111111",
        master_key="adversarial-challenge-master-key-32chars"
    )


# ==============================================================================
# 1. CANDIDATE TOKENS ACROSS LENGTHS 16, 20, 22, 24, 32, 64 (Hex, Alnum, Base64)
# ==============================================================================

class TestCandidateTokensAcrossLengthsAndTypes:
    """Stress-test token scanner across lengths 16, 20, 22, 24, 32, 64 for Hex, Alphanumeric, and Base64."""

    CANDIDATE_VECTORS = [
        # --- Length 16 ---
        ("hex_16", "4f9b8c2e1d0a3f5b", 16, True),
        ("alnum_16", "k9Z1mP4vL8wQ2xR7", 16, True),
        ("base64_16", "u7V/k9LmP2wQ4xR1", 16, True),

        # --- Length 20 ---
        ("hex_20", "4f9b8c2e1d0a3f5b7c8e", 20, True),
        ("alnum_unique_20", "abcdefghijklmnopqrst", 20, True),
        ("alnum_crypto_20", "k9Z1mP4vL8wQ2xR7jA3b", 20, True),
        ("base64_20", "c2VjcmV0L3Rva2VuKzEy", 20, True),

        # --- Length 22 ---
        ("hex_22", "4f9b8c2e1d0a3f5b7c8e9d", 22, True),
        ("alnum_unique_22", "abcdefghijklmnopqrstuv", 22, True),
        ("alnum_crypto_22", "k9Z1mP4vL8wQ2xR7jA3bC5", 22, True),
        ("base64_22", "YWJjL2RlZjEya2xtbm9wK3", 22, True),

        # --- Length 24 ---
        ("hex_24", "4f9b8c2e1d0a3f5b7c8e9d0a", 24, True),
        ("alnum_unique_24", "abcdefghijklmnopqrstuvwx", 24, True),
        ("alnum_crypto_24", "k9Z1mP4vL8wQ2xR7jA3bC5dE", 24, True),
        ("base64_24", "ZXhwZWN0L3NlY3JldCsyNHh5", 24, True),

        # --- Length 32 ---
        ("hex_32", "4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e", 32, True),
        ("alnum_32", "k9Z1mP4vL8wQ2xR7jA3bC5dEfG8hI0jK", 32, True),
        ("base64_32", "dGVzdC9zZWNyZXQvdG9rZW4rMzJfYnl0", 32, True),

        # --- Length 64 ---
        ("hex_64", "4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e", 64, True),
        ("alnum_64", "k9Z1mP4vL8wQ2xR7jA3bC5dEfG8hI0jK1mP4vL8wQ2xR7jA3bC5dEfG8hI0jKabC", 64, True),
        ("base64_64", "dGVzdC9zZWNyZXQvdG9rZW4rMzJfYnl0ZXNfZm9yX2FkdmVyc2FyaWFsX3ZhbGlk", 64, True),
    ]

    @pytest.mark.parametrize("name,token,expected_len,expected_candidate", CANDIDATE_VECTORS)
    def test_candidate_token_scanner_accuracy(self, engine, name, token, expected_len, expected_candidate):
        """Verify that token candidate scanner correctly classifies each vector."""
        assert len(token) == expected_len, f"Token {name} length mismatch: {len(token)} != {expected_len}"
        is_cand = engine.is_candidate_token(token)
        h = engine.shannon_entropy(token)
        assert is_cand == expected_candidate, (
            f"Token '{name}' ({token}, L={len(token)}, H={h:.4f}) expected candidate={expected_candidate}, got {is_cand}"
        )

    @pytest.mark.parametrize("name,token,expected_len,expected_candidate", CANDIDATE_VECTORS)
    def test_end_to_end_redaction_of_candidate_tokens(self, engine, name, token, expected_len, expected_candidate):
        """Verify that candidate tokens embedded in realistic code contexts are redacted by engine.redact()."""
        raw_text = f"const authSecret = '{token}';\nlet header = \"Bearer \" + authSecret;"
        result = engine.redact(raw_text)

        # The raw token must NOT appear in the sanitized output
        assert token not in result.sanitized_text, f"Token '{name}' leaked unredacted in sanitized text!"
        assert "[REDACTED:SECRET:" in result.sanitized_text
        assert result.redactions_count >= 1

    def test_randomized_high_entropy_secret_generators(self, engine):
        """Generate high-entropy secrets matching candidate thresholds and assert detection."""
        rng = random.Random(42)
        hex_chars = "0123456789abcdef"
        alnum_chars = string.ascii_letters + string.digits
        b64_chars = string.ascii_letters + string.digits + "+/"

        test_matrix = [
            (16, hex_chars, "hex"),
            (16, alnum_chars, "alnum"),
            (20, hex_chars, "hex"),
            (20, alnum_chars, "alnum"),
            (22, hex_chars, "hex"),
            (22, alnum_chars, "alnum"),
            (24, hex_chars, "hex"),
            (24, alnum_chars, "alnum"),
            (32, hex_chars, "hex"),
            (32, alnum_chars, "alnum"),
            (64, hex_chars, "hex"),
            (64, alnum_chars, "alnum"),
        ]

        detected = 0
        total = 0

        for length, charset, kind in test_matrix:
            for _ in range(25):
                # Sample high entropy candidate tokens (unique chars where possible)
                if length <= len(charset):
                    token = "".join(rng.sample(charset, length))
                else:
                    # For hex of length > 16, ensure balanced distribution so H >= 3.00 (or 3.20 for L>=32)
                    token = "".join(rng.sample(charset, 16)) + "".join(rng.choices(charset, k=length - 16))

                total += 1
                is_cand = engine.is_candidate_token(token)
                h = engine.shannon_entropy(token)

                assert is_cand is True, (
                    f"Generated {kind} token of length {length} (H={h:.4f}) failed candidate detection: {token}"
                )
                detected += 1

        assert detected == total == 300


# ==============================================================================
# 2. QUOTED SAP RFC PASSWORDS WITH SEMICOLONS, COMMAS, SPACES
# ==============================================================================

class TestQuotedRfcPasswordsAndParams:
    """Stress-test SAP RFC password and parameter parsing against embedded delimiters."""

    def test_quoted_rfc_password_semicolons_commas_spaces(self, engine):
        """rfc_password = "Secret;Complex;Pass#123" must be completely redacted without tail leak."""
        input_str = 'rfc_password = "Secret;Complex;Pass#123"'
        result = engine.redact(input_str)

        assert "Secret;Complex;Pass#123" not in result.sanitized_text
        assert ";Complex;Pass#123" not in result.sanitized_text
        assert "Pass#123" not in result.sanitized_text
        assert "[REDACTED:SECRET:" in result.sanitized_text
        assert re.search(r'rfc_password\s*=\s*"\[REDACTED:SECRET:[a-f0-9]{64}\]"', result.sanitized_text)

    def test_rfc_params_connection_string_with_delimiters(self, engine):
        """ASHOST=sapdev;PASSWD="my;complex,pwd 123";USER=BWUSER must redact password completely."""
        input_str = 'ASHOST=sapdev;PASSWD="my;complex,pwd 123";USER=BWUSER'
        result = engine.redact(input_str)

        assert "my;complex,pwd 123" not in result.sanitized_text
        assert ";complex,pwd 123" not in result.sanitized_text
        assert "pwd 123" not in result.sanitized_text
        assert "[REDACTED:SECRET:" in result.sanitized_text
        assert re.search(r'PASSWD="\[REDACTED:SECRET:[a-f0-9]{64}\]"', result.sanitized_text)

    def test_single_quoted_rfc_password_with_spaces_and_symbols(self, engine):
        """Single-quoted RFC password: PASSWD='Secret;Single,Quoted 456#'."""
        input_str = "ASHOST=sapdev;PASSWD='Secret;Single,Quoted 456#';CLIENT=100"
        result = engine.redact(input_str)

        assert "Secret;Single,Quoted 456#" not in result.sanitized_text
        assert ";Single,Quoted 456#" not in result.sanitized_text
        assert "[REDACTED:SECRET:" in result.sanitized_text
        assert re.search(r"PASSWD='\[REDACTED:SECRET:[a-f0-9]{64}\]'", result.sanitized_text)

    def test_unquoted_rfc_password(self, engine):
        """Unquoted RFC password ending at semicolon: PASSWD=SuperSecret2026!;USER=BWUSER."""
        input_str = "ASHOST=sapdev;PASSWD=SuperSecret2026!;USER=BWUSER"
        result = engine.redact(input_str)

        assert "SuperSecret2026!" not in result.sanitized_text
        assert "[REDACTED:SECRET:" in result.sanitized_text
        assert "PASSWD=[REDACTED:SECRET:" in result.sanitized_text

    def test_password_name_identity_integrity(self, engine):
        """Key 'password' must NOT be mangled or replaced when value is 'pass' or 'password'."""
        input_str = 'password = "pass"'
        result = engine.redact(input_str)

        assert result.sanitized_text.startswith("password = \"[REDACTED:SECRET:")
        assert "pass\"" not in result.sanitized_text or "[REDACTED:" in result.sanitized_text
        assert "password" in result.sanitized_text, "Key name 'password' was corrupted!"

    def test_rfc_case_insensitivity_variants(self, engine):
        """Variants like PWD, pwd, Passwd, PASSWD, rfc_pass, RFC_PASS must all trigger."""
        variants = [
            'PWD="Secret123;abc"',
            'pwd="Secret123;abc"',
            'Passwd="Secret123;abc"',
            'PASSWD="Secret123;abc"',
            'rfc_pass="Secret123;abc"',
            'RFC_PASS="Secret123;abc"',
            'rfc_password="Secret123;abc"',
        ]
        for v in variants:
            res = engine.redact(v)
            assert "Secret123;abc" not in res.sanitized_text, f"Failed for variant: {v}"
            assert "[REDACTED:SECRET:" in res.sanitized_text


# ==============================================================================
# 3. SAPROUTER STRINGS (PORT /S/3299, MULTI-HOP, /P/, TERMINAL)
# ==============================================================================

class TestSaprouterStrings:
    """Stress-test SAProuter connection strings across single, multi-hop, port, and password formats."""

    def test_saprouter_with_port_and_target(self, engine):
        """/H/router.corp/S/3299/W/SecretRouterPassword/H/target.corp/S/3200."""
        router_str = "/H/router.corp/S/3299/W/SecretRouterPassword/H/target.corp/S/3200"
        result = engine.redact(router_str)

        assert "SecretRouterPassword" not in result.sanitized_text
        assert "/H/router.corp/S/3299/W/[REDACTED:SECRET:" in result.sanitized_text
        assert "/H/target.corp/S/3200" in result.sanitized_text, "Target host/port was corrupted!"

    def test_saprouter_multi_hop_route(self, engine):
        """/H/r1/S/3299/W/p1/H/r2/S/3299/W/p2/H/dest."""
        multi_hop = "/H/r1/S/3299/W/p1/H/r2/S/3299/W/p2/H/dest"
        result = engine.redact(multi_hop)

        assert "p1" not in result.sanitized_text
        assert "p2" not in result.sanitized_text
        assert "/H/r1/S/3299/W/[REDACTED:SECRET:" in result.sanitized_text
        assert "/H/r2/S/3299/W/[REDACTED:SECRET:" in result.sanitized_text
        assert "/H/dest" in result.sanitized_text

    def test_saprouter_three_hops(self, engine):
        """Three consecutive router hops: /H/r1/W/p1/H/r2/W/p2/H/r3/W/p3/H/app."""
        three_hop = "/H/r1/W/p1/H/r2/W/p2/H/r3/W/p3/H/app"
        result = engine.redact(three_hop)

        assert "p1" not in result.sanitized_text
        assert "p2" not in result.sanitized_text
        assert "p3" not in result.sanitized_text
        assert "/H/app" in result.sanitized_text

    def test_saprouter_legacy_p_password(self, engine):
        """Legacy /P/ destination password: /H/router/S/3299/P/DestSecretPass/H/target."""
        p_router = "/H/router/S/3299/P/DestSecretPass/H/target"
        result = engine.redact(p_router)

        assert "DestSecretPass" not in result.sanitized_text
        assert "/H/router/S/3299/P/[REDACTED:SECRET:" in result.sanitized_text
        assert "/H/target" in result.sanitized_text

    def test_saprouter_terminal_password(self, engine):
        """Terminal password with no trailing /H/ hop: /H/router.corp/S/3299/W/TerminalPass."""
        term_router = "/H/router.corp/S/3299/W/TerminalPass"
        result = engine.redact(term_router)

        assert "TerminalPass" not in result.sanitized_text
        assert "/H/router.corp/S/3299/W/[REDACTED:SECRET:" in result.sanitized_text

    def test_saprouter_port_only_prefix(self, engine):
        """Router starting with /S/: /S/3299/W/router_secret/H/dest."""
        s_router = "/S/3299/W/router_secret/H/dest"
        result = engine.redact(s_router)

        assert "router_secret" not in result.sanitized_text
        assert "/S/3299/W/[REDACTED:SECRET:" in result.sanitized_text
        assert "/H/dest" in result.sanitized_text

    def test_saprouter_negative_url(self, engine):
        """Standard web URL containing /W/ must NOT be matched or redacted."""
        url = "https://example.com/W/index.html"
        result = engine.redact(url)

        assert result.sanitized_text == url
        assert result.redactions_count == 0


# ==============================================================================
# 4. SAP TECHNICAL OBJECTS & DDIC PRESERVATION (CONFIRM 0 FALSE POSITIVES)
# ==============================================================================

class TestSapObjectPreservation:
    """Stress-test SAP tables, namespaces, CDS views, and ABAP syntax. Confirm 0 false positives."""

    MANDATORY_SAP_OBJECTS = [
        "MARA",
        "BKPF",
        "SWWWIHEAD",
        "ZCUSTOM_TABLE_01",
        "/COMPANY/ERP_MIGRATION_TOOL",
        "I_PRODUCT_SALES_DELIVERY",
    ]

    ADDITIONAL_SAP_OBJECTS = [
        "BSEG",
        "ACDOCA",
        "C_SALESORDERITEMQUERY",
        "CL_REST_HTTP_CLIENT_FACTORY",
        "ZCL_PREFLIGHT_CONTROLLER_V2",
        "ZCX_CUSTOM_EXCEPTION_HANDLER",
        "BAPI_USER_GET_DETAIL",
        "/SDF/RBE_METRIC_COLLECTOR",
        "/UI5/SAP_LIB_CORE",
        "/SCWM/MFS_TELEGRAM_QUEUE",
    ]

    @pytest.mark.parametrize("sap_obj", MANDATORY_SAP_OBJECTS + ADDITIONAL_SAP_OBJECTS)
    def test_sap_objects_is_candidate_token_returns_false(self, engine, sap_obj):
        """Each SAP object must return False from is_candidate_token."""
        is_cand = engine.is_candidate_token(sap_obj)
        h = engine.shannon_entropy(sap_obj)
        assert is_cand is False, f"False positive: SAP object '{sap_obj}' (H={h:.4f}) flagged as secret candidate!"

    @pytest.mark.parametrize("sap_obj", MANDATORY_SAP_OBJECTS + ADDITIONAL_SAP_OBJECTS)
    def test_sap_objects_in_code_context_zero_redactions(self, engine, sap_obj):
        """SAP objects in realistic ABAP/SQL code statements must produce 0 redactions."""
        code_snippet = f"SELECT SINGLE * FROM {sap_obj} INTO @DATA(ls_record) WHERE obj_key = 'TEST'."
        result = engine.redact(code_snippet)

        assert sap_obj in result.sanitized_text
        assert result.redactions_count == 0
        assert "[REDACTED:" not in result.sanitized_text

    def test_abap_sql_and_keywords_zero_redactions(self, engine):
        """Complex ABAP syntax statements with keywords, symbols, and standard tables must not be redacted."""
        abap_code = """
        SELECT * FROM BKPF INNER JOIN BSEG ON BKPF~BELNR = BSEG~BELNR
        WHERE BKPF~BUKRS = '1000' INTO TABLE @DATA(lt_bseg).
        ASSIGN COMPONENT 'DMBTR' OF STRUCTURE <fs_line> TO FIELD-SYMBOLS(<fs_val>).
        """
        result = engine.redact(abap_code)

        assert "BKPF" in result.sanitized_text
        assert "BSEG" in result.sanitized_text
        assert "SELECT" in result.sanitized_text
        assert "FIELD-SYMBOLS" in result.sanitized_text
        assert "<fs_val>" in result.sanitized_text
        assert result.redactions_count == 0

    def test_uuid_zero_false_positives(self, engine):
        """Standard UUIDs must not be redacted by entropy scanner."""
        sample_uuid = "c1234567-89ab-cdef-0123-456789abcdef"
        result = engine.redact(f"session_id: {sample_uuid}")

        assert sample_uuid in result.sanitized_text
        assert result.redactions_count == 0


# ==============================================================================
# 5. SUB-THRESHOLD & BOUNDARY STRESS TESTS
# ==============================================================================

class TestBoundaryConditions:
    """Test boundary lengths and repetitive low-entropy patterns."""

    def test_sub_threshold_length_15(self, engine):
        """Tokens with length 15 (even with maximal entropy) must NOT be candidate tokens."""
        short_unique = "abcdefghijklmno"  # len 15
        assert len(short_unique) == 15
        assert engine.is_candidate_token(short_unique) is False

    def test_low_entropy_repetitive_tokens(self, engine):
        """Repetitive tokens of length 16, 24, 32 must NOT be candidate tokens."""
        assert engine.is_candidate_token("a" * 16) is False
        assert engine.is_candidate_token("ab" * 8) is False
        assert engine.is_candidate_token("a" * 32) is False
        assert engine.is_candidate_token("1234" * 8) is False  # hex repeated: H=2.0 < 3.2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
