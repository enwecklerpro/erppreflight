"""
Proposed Test Fix & Companion Test for Domain 2 Adversarial Suite
Target File: .agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py
Governing Standard: AGENTS.md, Cardinal Axiom 2, No-Test-Mirroring Rule

Author: m3_d2_it3_explorer_1
Role: teamwork_preview_explorer (Domain 2 Forensic Remediation Explorer)
"""

import pytest

# ==============================================================================
# SECTION 1: TARGET CODE IN .agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py
# Lines 544–561
# ==============================================================================

TARGET_LINES_BEFORE = '''    @pytest.mark.asyncio
    async def test_ecc_adversarial_header_detection_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #4):
        Demonstrates that a headerless CSV where the first transaction code contains
        'object' (e.g. Z_OBJECT_REPORT) or 'exec' (e.g. Z_EXEC_RUN) causes the parser
        to falsely drop the first transaction row as a header.
        """
        headerless_csv = "Z_OBJECT_REPORT,25000,200,10\\nVA01,50000,300,20\\n"
        items = EccArtifactParser.parse(headerless_csv, "headerless_ecc.csv")

        dropped_tcode = "Z_OBJECT_REPORT"
        parsed_names = [i.object_name for i in items]

        assert dropped_tcode not in parsed_names, (
            f"Vulnerability reproduction: Expected {dropped_tcode} to be dropped due to 'object' keyword match!"
        )
        assert len(items) == 1'''


# ==============================================================================
# SECTION 2: DROP-IN REPLACEMENT CODE (LINES 544–561)
# ==============================================================================

REPLACEMENT_LINES_AFTER = '''    @pytest.mark.asyncio
    async def test_ecc_adversarial_header_detection_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #4):
        Verifies that a headerless CSV where the first transaction code contains
        'object' (e.g. Z_OBJECT_REPORT) or 'exec' (e.g. Z_EXEC_RUN) is NOT falsely
        classified as a header and dropped. Both transaction items must be retained.
        """
        headerless_csv = "Z_OBJECT_REPORT,25000,200,10\\nVA01,50000,300,20\\n"
        items = EccArtifactParser.parse(headerless_csv, "headerless_ecc.csv")

        dropped_tcode = "Z_OBJECT_REPORT"
        parsed_names = [i.object_name for i in items]

        # Remediated: The parser retains all valid customer transactions
        assert dropped_tcode in parsed_names, (
            f"Remediated: Expected {dropped_tcode} to be parsed and retained!"
        )
        assert len(items) == 2, f"Expected 2 items after remediation, got {len(items)}"'''


# ==============================================================================
# SECTION 3: COMPANION ADVERSARIAL TEST FOR ECC COMMENT DELIMITER
# (Recommended addition to TestECC2CloudAdversarial suite, mirroring SPRO line 239)
# ==============================================================================

COMPANION_ECC_COMMENT_TEST = '''    @pytest.mark.asyncio
    async def test_ecc_adversarial_comment_line_delimiter_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #5):
        Verifies that when an ST03N CSV file starts with a '#' comment line
        (e.g. '# SAP ST03N Export'), the delimiter detection correctly identifies
        the comma or tab from subsequent lines, skips comment lines, and preserves
        both transaction names and execution counts rather than collapsing rows.
        """
        st03n_with_comment = (
            "# SAP ST03N Workload Export\\n"
            "VA01,50000,300,20\\n"
            "VL01N,20000,200,10\\n"
        )
        items = EccArtifactParser.parse(st03n_with_comment, "comment_ecc.csv")
        parsed_names = [i.object_name for i in items]

        # Remediated: Comment lines must be skipped and delimited columns must not collapse
        assert "# SAP ST03N Workload Export" not in parsed_names, (
            "Remediated: Comment line must be skipped and not parsed as an object name!"
        )
        assert "VA01,50000,300,20" not in parsed_names, (
            "Remediated: Comma-separated columns must not collapse into a single string!"
        )
        assert len(items) == 2, f"Expected 2 parsed items, got {len(items)}"
        assert items[0].object_name == "VA01"
        assert items[0].executions == 50000
        assert items[1].object_name == "VL01N"
        assert items[1].executions == 20000'''


# ==============================================================================
# SECTION 4: UNIFIED DIFF SPECIFICATION
# ==============================================================================

DIFF_PATCH = """--- a/.agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py
+++ b/.agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py
@@ -546,7 +546,8 @@ class TestECC2CloudAdversarial:
         \"\"\"
         ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #4):
-        Demonstrates that a headerless CSV where the first transaction code contains
-        'object' (e.g. Z_OBJECT_REPORT) or 'exec' (e.g. Z_EXEC_RUN) causes the parser
-        to falsely drop the first transaction row as a header.
+        Verifies that a headerless CSV where the first transaction code contains
+        'object' (e.g. Z_OBJECT_REPORT) or 'exec' (e.g. Z_EXEC_RUN) is NOT falsely
+        classified as a header and dropped. Both transaction items must be retained.
         \"\"\"
         headerless_csv = "Z_OBJECT_REPORT,25000,200,10\\nVA01,50000,300,20\\n"
         items = EccArtifactParser.parse(headerless_csv, "headerless_ecc.csv")
 
         dropped_tcode = "Z_OBJECT_REPORT"
         parsed_names = [i.object_name for i in items]
 
-        assert dropped_tcode not in parsed_names, (
-            f"Vulnerability reproduction: Expected {dropped_tcode} to be dropped due to 'object' keyword match!"
-        )
-        assert len(items) == 1
+        # Remediated: The parser retains all valid customer transactions
+        assert dropped_tcode in parsed_names, (
+            f"Remediated: Expected {dropped_tcode} to be parsed and retained!"
+        )
+        assert len(items) == 2, f"Expected 2 items after remediation, got {len(items)}"
"""
