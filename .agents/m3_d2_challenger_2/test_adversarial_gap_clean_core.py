"""
Adversarial Empirical Stress Test Suite: SAP Gap Radar & Clean Core Object Guard
Agent: m3_d2_challenger_2
Mission: Empirically stress-test Gap Radar (gap_radar.py) and Clean Core Object Guard (clean_core.py).

Standards:
- AGENTS.md: Cardinal Axiom 2 (14-Point Engine Anatomy, Epistemic Confidence, Evidence Chains)
- .agents/skills/sap-evidence.md: Confidence hierarchy (VERIFIED=1.0, RULE_DERIVED=0.85, INFERRED=0.60, UNKNOWN=0.30)
- .agents/skills/engine-authoring.md: Deterministic rules, pure engine logic, boundary assertions

Test Execution:
  py -3 -m pytest .agents/m3_d2_challenger_2/test_adversarial_gap_clean_core.py -v
  or
  py -3 .agents/m3_d2_challenger_2/test_adversarial_gap_clean_core.py
"""

from __future__ import annotations

import asyncio
import json
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pytest

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ANALYSIS_PYTHON_DIR = REPO_ROOT / "services" / "analysis-python"
if str(ANALYSIS_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(ANALYSIS_PYTHON_DIR))

from src.engines.clean_core import (
    CleanCoreEngine,
    CLASSIC_TABLE_SUCCESSOR_MAP,
    OBSOLETE_STATEMENTS_MAP,
    UNRELEASED_API_CATALOG,
)
from src.engines.gap_radar import (
    GapRadarEngine,
    ResolutionTier,
    TIER_METADATA,
    RequirementItem,
)
from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
    TrustLevel,
)
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse
from src.platform.confidence import ConfidenceClassifier


# ==============================================================================
# 1. SAP Gap Radar Adversarial Tests
# ==============================================================================

class TestSAPGapRadarAdversarial:
    """Adversarial stress tests for SAP Gap Radar engine."""

    # 1.1 Contradictory Requirements: Absolute Precedence of Tier 11 Blocked
    @pytest.mark.parametrize(
        "contradictory_requirement,expected_matched_token",
        [
            (
                "Activate standard purchase order 18J but execute update bseg directly in database",
                "update bseg",
            ),
            (
                "Standard sales order processing BD9 combined with direct db access to sales tables",
                "direct db",
            ),
            (
                "Standard billing document generation with modify standard table VBRK",
                "modify standard table",
            ),
            (
                "Configure payment terms via standard SSCUI and execute update bkpf",
                "update bkpf",
            ),
            (
                "Key-user extensibility custom field YY1_REGION with classic user exit invocation",
                "classic user exit",
            ),
            (
                "Develop managed RAP business object with core modification to standard classes",
                "core modification",
            ),
            (
                "Consume released CDS view I_Product along with direct database write to MARA",
                "direct database write",
            ),
            (
                "Integrate with released API API_BUSINESS_PARTNER and execute update mara directly",
                "update mara",
            ),
            (
                "BAdI BADI_PRICING_COMPLETE implemented with direct db updates",
                "direct db",
            ),
            (
                "Trigger cloud events webhook pub/sub with update vbak in background",
                "update vbak",
            ),
            (
                "Side-by-side SAP BTP CAP application performing core modification on ERP",
                "core modification",
            ),
            (
                "Supported workaround batch job emulation with directly in database updates",
                "directly in database",
            ),
            (
                "Use best practice scope item BNZ and select * from bseg into table",
                "select * from",
            ),
        ],
    )
    def test_contradictory_requirements_tier11_precedence(
        self, contradictory_requirement: str, expected_matched_token: str
    ):
        """Stress: Tier 11 BLOCKED_CLEAN_CORE_VIOLATION must take absolute precedence

        over any standard or legitimate extensibility keywords.
        """
        tier, verdict, score, severity, token = GapRadarEngine.resolve_tier(
            contradictory_requirement
        )

        assert tier == ResolutionTier.TIER_11_BLOCKED_OR_GAP, (
            f"Failed precedence! Expected Tier 11 for contradictory input: '{contradictory_requirement}', "
            f"but got Tier {tier} ({verdict})"
        )
        assert verdict == "BLOCKED_CLEAN_CORE_VIOLATION", (
            f"Expected BLOCKED_CLEAN_CORE_VIOLATION, got {verdict}"
        )
        assert score == 0.00, f"Expected feasibility_score 0.00, got {score}"
        assert severity == Severity.CRITICAL, f"Expected CRITICAL, got {severity}"

        # Evaluate method check
        eval_result = GapRadarEngine.evaluate(contradictory_requirement)
        assert eval_result["resolution_tier"] == 11
        assert eval_result["verdict"] == "BLOCKED_CLEAN_CORE_VIOLATION"
        assert eval_result["feasibility_score"] == 0.00

    # 1.2 Ambiguous Requirements: Fallback to Tier 12
    @pytest.mark.parametrize(
        "ambiguous_text",
        [
            "Synergize enterprise alignment across multidisciplinary stakeholders",
            "Enhance holistic performance metrics and elevate business velocity",
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit",
            "X1Y2Z3 arbitrary non-sap functional description",
            "User interface should look more modern and intuitive",
            "    ",
            "",
        ],
    )
    def test_ambiguous_requirements_fallback_tier12(self, ambiguous_text: str):
        """Stress: Requirements lacking recognizable keywords must fallback to Tier 12."""
        tier, verdict, score, severity, token = GapRadarEngine.resolve_tier(
            ambiguous_text
        )

        assert tier == ResolutionTier.TIER_12_UNKNOWN, (
            f"Expected TIER_12_UNKNOWN, got Tier {tier} ({verdict})"
        )
        assert verdict == "UNKNOWN_REQUIREMENT", (
            f"Expected UNKNOWN_REQUIREMENT, got {verdict}"
        )
        assert score == 0.40, f"Expected feasibility_score 0.40, got {score}"
        assert severity == Severity.MINOR, f"Expected MINOR, got {severity}"

    # 1.3 Epistemic Confidence Invariant on Ambiguous Requirements (Axiom 2 Point 7)
    @pytest.mark.asyncio
    async def test_ambiguous_requirement_epistemic_confidence_invariant(self):
        """Axiom 2 Point 7 & DISPATCH.md Invariant:

        Ambiguous requirements falling back to Tier 12 (UNKNOWN_REQUIREMENT)
        MUST be classified with confidence UNKNOWN and score 0.30.
        """
        engine = GapRadarEngine()
        req = AnalysisRequest(
            job_id="11111111-2222-3333-4444-555555555555",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SAP_GAP_RADAR,
            raw_content="Synergize holistic paradigm shifts across business silos",
            artifact_type=ArtifactType.TXT,
        )

        res: AnalysisResponse = await engine.analyze(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) >= 1

        finding = res.findings[0]
        assert finding.technical_details["tier"] == 12
        assert finding.technical_details["verdict"] == "UNKNOWN_REQUIREMENT"

        # Hard Epistemic Invariant Check:
        # A finding for an UNKNOWN requirement should have confidence UNKNOWN (0.30).
        # We empirically assert this invariant as specified in DISPATCH.md.
        assert finding.confidence == ConfidenceClass.UNKNOWN, (
            f"Epistemic Invariant Violation: Finding for UNKNOWN_REQUIREMENT has confidence "
            f"'{finding.confidence}' instead of '{ConfidenceClass.UNKNOWN}'. "
            f"Root Cause: gap_radar.py hardcodes ConfidenceClass.RULE_DERIVED."
        )
        assert finding.confidence_score == 0.30, (
            f"Epistemic Invariant Violation: Finding for UNKNOWN_REQUIREMENT has confidence_score "
            f"{finding.confidence_score} instead of 0.30."
        )

    # 1.4 Feasibility Score Gradient Across All 12 Tiers
    def test_feasibility_score_gradient_all_12_tiers(self):
        """Stress: Verify feasibility score mapping and values for each resolution tier."""
        tier_test_corpus: Dict[ResolutionTier, str] = {
            ResolutionTier.TIER_1_STANDARD: "Implement standard purchase order processing with scope item 18J",
            ResolutionTier.TIER_2_CONFIGURATION: "Configure payment terms in SSCUI central business configuration",
            ResolutionTier.TIER_3_KEY_USER: "Add custom field YY1_PROD_CAT via key-user extensibility",
            ResolutionTier.TIER_4_DEVELOPER_EXTENSIBILITY: "Build custom managed RAP business object with abap cloud",
            ResolutionTier.TIER_5_RELEASED_CDS: "Query released CDS view I_Product with contract C1",
            ResolutionTier.TIER_6_RELEASED_API: "Consume released API API_BUSINESS_PARTNER via OData",
            ResolutionTier.TIER_7_RELEASED_BADI: "Implement released BAdI BADI_PRICING_COMPLETE for custom pricing logic",
            ResolutionTier.TIER_8_BUSINESS_EVENT: "Subscribe to SAP Event Mesh cloud events webhook for business event",
            ResolutionTier.TIER_9_SIDE_BY_SIDE: "Deploy side-by-side CAP application on SAP BTP Kyma",
            ResolutionTier.TIER_10_WORKAROUND: "Implement supported workaround using staging table and batch job emulation",
            ResolutionTier.TIER_11_BLOCKED_OR_GAP: "Direct database write into database table",
            ResolutionTier.TIER_12_UNKNOWN: "Completely unrecognizable business statement without technical keywords",
        }

        for expected_tier, text in tier_test_corpus.items():
            resolved_tier, verdict, score, severity, token = GapRadarEngine.resolve_tier(text)
            meta = TIER_METADATA[expected_tier]

            assert resolved_tier == expected_tier, (
                f"For text '{text}', expected Tier {expected_tier.name} ({expected_tier.value}), "
                f"got Tier {resolved_tier.name} ({resolved_tier.value})"
            )
            assert score == meta["feasibility_score"], (
                f"For Tier {expected_tier.name}, expected score {meta['feasibility_score']}, got {score}"
            )
            assert 0.00 <= score <= 1.00, f"Feasibility score {score} out of bounds [0.0, 1.0]"

    # 1.5 Batch Multi-Requirement Feasibility Average
    @pytest.mark.asyncio
    async def test_batch_requirements_average_feasibility(self):
        """Stress: Verify multi-requirement payload correctly computes average feasibility."""
        engine = GapRadarEngine()
        payload = {
            "requirements": [
                {"requirement": "Standard purchase order scope item 18j"},  # Tier 1 (1.00)
                {"requirement": "Side-by-side application on SAP BTP"},       # Tier 9 (0.85)
                {"requirement": "Direct database write to BSEG"},             # Tier 11 (0.00)
            ]
        }
        req = AnalysisRequest(
            job_id="11111111-3333-3333-3333-111111111111",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SAP_GAP_RADAR,
            raw_content=json.dumps(payload),
            artifact_type=ArtifactType.JSON,
        )

        res = await engine.analyze(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) == 3

        # Expected average: (1.00 + 0.85 + 0.00) / 3 = 0.61666... -> 0.62
        avg_score = res.metrics.additional_metrics["feasibility_score"]
        assert avg_score == 0.62, f"Expected average feasibility 0.62, got {avg_score}"


# ==============================================================================
# 2. Clean Core Object Guard Adversarial Tests
# ==============================================================================

class TestCleanCoreObjectGuardAdversarial:
    """Adversarial stress tests for Clean Core Object Guard engine."""

    # 2.1 Classic Table Access Across ALL 26 Tables
    def test_all_26_classic_tables_detection_and_successors(self):
        """Stress: Verify detection and official C1 successor mapping for all 26 classic tables."""
        all_tables = list(CLASSIC_TABLE_SUCCESSOR_MAP.keys())
        assert len(all_tables) == 26, f"Expected exactly 26 classic tables, found {len(all_tables)}"

        for table in all_tables:
            meta = CLASSIC_TABLE_SUCCESSOR_MAP[table]
            abap_code = f"SELECT * FROM {table} INTO TABLE @DATA(lt_{table.lower()})."
            eval_res = CleanCoreEngine.evaluate(abap_code)

            assert eval_res["violations_count"] == 1, (
                f"Failed to detect classic table '{table}' in: {abap_code}"
            )
            assert len(eval_res["findings"]) == 1
            finding = eval_res["findings"][0]
            assert finding["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS"
            assert finding["table"] == table
            assert finding["severity"] == "CRITICAL"
            assert finding["successor"] == meta["successor"], (
                f"Wrong successor for {table}: expected {meta['successor']}, got {finding['successor']}"
            )

    # 2.2 Classic Table Access Verbs: FROM, INTO, UPDATE, MODIFY
    @pytest.mark.parametrize("verb", ["FROM", "INTO", "UPDATE", "MODIFY"])
    def test_classic_table_access_sql_verbs(self, verb: str):
        """Stress: Verify all SQL modification/query verbs trigger violation."""
        code = f"{verb} MARA"
        eval_res = CleanCoreEngine.evaluate(code)
        assert eval_res["violations_count"] == 1, f"Failed to detect {verb} MARA"

    # 2.3 Obsolete Syntax Triggers
    @pytest.mark.parametrize(
        "statement,expected_severity",
        [
            ("TABLES: mara.", "CRITICAL"),
            ("TABLES mara.", "CRITICAL"),
            ("FORM calculate_discount.", "CRITICAL"),
            ("PERFORM calculate_discount.", "CRITICAL"),
            ("CALL 'SYSTEM' ID 'COMMAND' FIELD lv_cmd.", "BLOCKER"),
            ("OPEN DATASET lv_file FOR INPUT IN TEXT MODE.", "CRITICAL"),
            ("READ DATASET lv_file INTO lv_buf.", "CRITICAL"),
            ("TRANSFER lv_buf TO lv_file.", "CRITICAL"),
            ("CLOSE DATASET lv_file.", "CRITICAL"),
            ("EXEC SQL.", "BLOCKER"),
            ("CALL TRANSACTION 'VA01'.", "CRITICAL"),
            ("SUBMIT z_legacy_report AND RETURN.", "HIGH"),
        ],
    )
    def test_obsolete_syntax_statements(self, statement: str, expected_severity: str):
        """Stress: Verify all obsolete statements trigger CLEAN_CORE_OBSOLETE_SYNTAX."""
        eval_res = CleanCoreEngine.evaluate(statement)
        assert eval_res["violations_count"] >= 1, f"Failed to detect obsolete statement: '{statement}'"
        finding = eval_res["findings"][0]
        assert finding["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX"
        assert finding["severity"] == expected_severity, (
            f"Expected severity {expected_severity} for '{statement}', got {finding['severity']}"
        )

    # 2.4 Complex ABAP Sources: Comments, Indentation, and Safe Constructs
    def test_complex_abap_comments_and_safe_constructs(self):
        """Stress: Comments mentioning classic tables or obsolete statements must NOT trigger violations."""
        safe_abap = """
* Full line asterisk comment: SELECT * FROM MARA INTO TABLE @lt_mara.
* FORM calculate_tax.
    * Indented asterisk comment: TABLES: VBAK.
" Full line quote comment: CALL 'SYSTEM' ID 'CMD'.
CLASS zcl_safe_clean_core DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    METHODS safe_method.
ENDCLASS.

CLASS zcl_safe_clean_core IMPLEMENTATION.
  METHOD safe_method.
    SELECT Product FROM I_Product INTO TABLE @DATA(lt_prod). " Inline comment mentioning BSEG
    DATA(lv_msg) = 'Processing completed successfully.'.
  ENDMETHOD.
ENDCLASS.
"""
        eval_res = CleanCoreEngine.evaluate(safe_abap)
        assert eval_res["violations_count"] == 0, (
            f"Expected 0 violations in safe ABAP, got {eval_res['violations_count']}: {eval_res['findings']}"
        )
        assert eval_res["compliance_percentage"] == 100.0

    # 2.5 Compliance Score Boundary Invariants: 0.0% <= Compliance <= 100.0%
    @pytest.mark.parametrize(
        "abap_source,expected_min,expected_max",
        [
            ("", 100.0, 100.0),                               # Empty source -> 100.0%
            ("   \n\n\n* Just comments\n", 100.0, 100.0),     # Pure comments -> 100.0%
            (
                "SELECT * FROM MARA INTO TABLE @lt_m.\n"
                "UPDATE BSEG SET DMBTR = 0.\n"
                "CALL 'SYSTEM' ID 'CMD'.\n"
                "EXEC SQL.\n",
                0.0, 0.0,                                      # 100% violations -> 0.0%
            ),
            (
                "DATA lv_val TYPE i.\n"
                "lv_val = 42.\n"
                "SELECT Product FROM I_Product INTO TABLE @DATA(lt_p).\n"
                "SELECT * FROM MARA INTO TABLE @DATA(lt_m).\n",
                50.0, 80.0,                                    # Mixed -> bounded
            ),
        ],
    )
    def test_compliance_percentage_boundaries(
        self, abap_source: str, expected_min: float, expected_max: float
    ):
        """Stress: Compliance percentage must strictly obey mathematical boundary invariants."""
        eval_res = CleanCoreEngine.evaluate(abap_source)
        pct = eval_res["compliance_percentage"]

        assert 0.0 <= pct <= 100.0, f"Compliance percentage {pct} out of absolute bounds [0.0, 100.0]"
        assert expected_min <= pct <= expected_max, (
            f"Compliance percentage {pct} outside expected bounds [{expected_min}, {expected_max}]"
        )

    # 2.6 Property-Based Randomized Fuzz Testing for Mathematical Invariants
    def test_property_fuzz_compliance_percentage_invariants(self):
        """Fuzz: Randomized generation of mixed ABAP lines must NEVER violate 0.0 <= pct <= 100.0."""
        rng = random.Random(1337)
        clean_pool = [
            "DATA(lv_var) = 1.",
            "SELECT Product FROM I_Product INTO TABLE @DATA(lt_prod).",
            "out->write( |Completed successfully| ).",
            "TRY. cx_root = cx. CATCH cx_root. ENDTRY.",
            "TYPES: BEGIN OF ty_s, field TYPE string, END OF ty_s.",
        ]
        violation_pool = [
            "SELECT * FROM MARA INTO TABLE @DATA(lt_m).",
            "UPDATE BSEG SET DMBTR = 100.",
            "TABLES: VBAK.",
            "CALL 'SYSTEM' ID 'COMMAND' FIELD lv_c.",
            "OPEN DATASET lv_file FOR OUTPUT IN TEXT MODE.",
            "EXEC SQL.",
            "CALL FUNCTION 'RFC_READ_TABLE'.",
        ]

        for trial in range(50):
            n_clean = rng.randint(0, 20)
            n_viol = rng.randint(0, 20)
            lines = [rng.choice(clean_pool) for _ in range(n_clean)] + [
                rng.choice(violation_pool) for _ in range(n_viol)
            ]
            rng.shuffle(lines)
            fuzz_code = "\n".join(lines)

            eval_res = CleanCoreEngine.evaluate(fuzz_code)
            pct = eval_res["compliance_percentage"]
            total = eval_res["total_statements"]

            assert 0.0 <= pct <= 100.0, f"Trial {trial}: Fuzz compliance {pct} out of [0.0, 100.0]"
            assert eval_res["clean_statements"] + eval_res["violations_count"] == total, (
                f"Trial {trial}: Statement count conservation broken: clean={eval_res['clean_statements']} + "
                f"viol={eval_res['violations_count']} != total={total}"
            )
            if total == 0:
                assert pct == 100.0
            elif eval_res["clean_statements"] == 0 and eval_res["violations_count"] > 0:
                assert pct == 0.0

    # 2.7 Multi-Line Evasion Adversarial Challenge (Parser Robustness)
    def test_multiline_split_statement_evasion_challenge(self):
        """Adversarial Challenge: Does Clean Core Object Guard detect multi-line split statements?

        When an ABAP developer or code formatter splits:
          SELECT *
            FROM
            mara
            INTO TABLE @lt_mara.
        Does line-by-line regex miss the violation?
        """
        split_code = """
SELECT *
  FROM
  mara
  INTO TABLE @lt_mara.
"""
        eval_res = CleanCoreEngine.evaluate(split_code)
        # Note: If evaluate() processes strictly line-by-line, violations_count will be 0!
        # An enterprise audit engine MUST detect this violation.
        assert eval_res["violations_count"] >= 1, (
            "Vulnerability Confirmed: Clean Core Object Guard fails to detect multi-line split "
            "statements! Line-by-line regex is evadable by placing 'FROM' and table name on separate lines."
        )

    # 2.8 Dead Code / Double-Quote Handling in CALL 'SYSTEM'
    def test_call_system_double_quote_evasion_challenge(self):
        """Adversarial Challenge: Does Clean Core Object Guard detect CALL with double quotes?

        In clean_core.py line 310, the developer checked:
          if "CALL 'SYSTEM'" in line or 'CALL "SYSTEM"' in line:
        However, line 281 strips everything after double quotes as a comment:
          code_part = raw_line.split('"')[0].strip()
        Therefore, CALL "SYSTEM" can never be detected!
        """
        dq_code = 'CALL "SYSTEM" ID \'COMMAND\' FIELD lv_cmd.'
        eval_res = CleanCoreEngine.evaluate(dq_code)
        assert eval_res["violations_count"] >= 1, (
            "Vulnerability Confirmed: 'CALL \"SYSTEM\"' is evadable because raw_line.split('\"')[0] "
            "strips double quotes as comments before the obsolete check executes!"
        )


# ==============================================================================
# Standalone CLI Test Runner & Diagnostic Report
# ==============================================================================

def run_diagnostic_suite() -> Dict[str, Any]:
    """Executes all adversarial tests directly and compiles a structured findings report."""
    results: Dict[str, Any] = {
        "gap_radar": {"passed": 0, "failed": 0, "failures": []},
        "clean_core": {"passed": 0, "failed": 0, "failures": []},
    }

    # 1. Test Gap Radar Contradictory Requirements
    test_gr = TestSAPGapRadarAdversarial()
    contradictory_samples = [
        ("Activate standard purchase order 18J but execute update bseg directly in database", "update bseg"),
        ("Standard sales order BD9 combined with direct db write", "direct db"),
        ("Key-user extensibility custom field YY1_CAT with classic user exit", "classic user exit"),
        ("Managed RAP business object with core modification", "core modification"),
    ]
    for sample, token in contradictory_samples:
        try:
            test_gr.test_contradictory_requirements_tier11_precedence(sample, token)
            results["gap_radar"]["passed"] += 1
        except AssertionError as e:
            results["gap_radar"]["failed"] += 1
            results["gap_radar"]["failures"].append(str(e))

    # 2. Test Gap Radar Ambiguous Requirements Fallback
    ambiguous_samples = [
        "Synergize enterprise alignment across multidisciplinary stakeholders",
        "Lorem ipsum dolor sit amet",
        "",
    ]
    for sample in ambiguous_samples:
        try:
            test_gr.test_ambiguous_requirements_fallback_tier12(sample)
            results["gap_radar"]["passed"] += 1
        except AssertionError as e:
            results["gap_radar"]["failed"] += 1
            results["gap_radar"]["failures"].append(str(e))

    # 3. Test Gap Radar Epistemic Invariant (Async)
    try:
        asyncio.run(test_gr.test_ambiguous_requirement_epistemic_confidence_invariant())
        results["gap_radar"]["passed"] += 1
    except AssertionError as e:
        results["gap_radar"]["failed"] += 1
        results["gap_radar"]["failures"].append(str(e))

    # 4. Test Gap Radar 12 Tiers Gradient
    try:
        test_gr.test_feasibility_score_gradient_all_12_tiers()
        results["gap_radar"]["passed"] += 1
    except AssertionError as e:
        results["gap_radar"]["failed"] += 1
        results["gap_radar"]["failures"].append(str(e))

    # 5. Test Clean Core All 26 Tables
    test_cc = TestCleanCoreObjectGuardAdversarial()
    try:
        test_cc.test_all_26_classic_tables_detection_and_successors()
        results["clean_core"]["passed"] += 1
    except AssertionError as e:
        results["clean_core"]["failed"] += 1
        results["clean_core"]["failures"].append(str(e))

    # 6. Test Clean Core Obsolete Statements
    obsolete_samples = [
        ("TABLES: mara.", "CRITICAL"),
        ("FORM calc.", "CRITICAL"),
        ("PERFORM calc.", "CRITICAL"),
        ("CALL 'SYSTEM' ID 'CMD'.", "BLOCKER"),
        ("OPEN DATASET f FOR INPUT.", "CRITICAL"),
        ("EXEC SQL.", "BLOCKER"),
    ]
    for stmt, sev in obsolete_samples:
        try:
            test_cc.test_obsolete_syntax_statements(stmt, sev)
            results["clean_core"]["passed"] += 1
        except AssertionError as e:
            results["clean_core"]["failed"] += 1
            results["clean_core"]["failures"].append(str(e))

    # 7. Test Clean Core Safe Comments & Non-Violations
    try:
        test_cc.test_complex_abap_comments_and_safe_constructs()
        results["clean_core"]["passed"] += 1
    except AssertionError as e:
        results["clean_core"]["failed"] += 1
        results["clean_core"]["failures"].append(str(e))

    # 8. Test Clean Core Boundary Invariants
    try:
        test_cc.test_property_fuzz_compliance_percentage_invariants()
        results["clean_core"]["passed"] += 1
    except AssertionError as e:
        results["clean_core"]["failed"] += 1
        results["clean_core"]["failures"].append(str(e))

    # 9. Test Clean Core Multi-Line Evasion
    try:
        test_cc.test_multiline_split_statement_evasion_challenge()
        results["clean_core"]["passed"] += 1
    except AssertionError as e:
        results["clean_core"]["failed"] += 1
        results["clean_core"]["failures"].append(str(e))

    # 10. Test Clean Core Double Quote CALL "SYSTEM"
    try:
        test_cc.test_call_system_double_quote_evasion_challenge()
        results["clean_core"]["passed"] += 1
    except AssertionError as e:
        results["clean_core"]["failed"] += 1
        results["clean_core"]["failures"].append(str(e))

    return results


if __name__ == "__main__":
    print("=" * 80)
    print("RUNNING ADVERSARIAL STRESS TEST SUITE (m3_d2_challenger_2)")
    print("=" * 80)
    res = run_diagnostic_suite()
    print(f"\n[SAP GAP RADAR]: {res['gap_radar']['passed']} Passed, {res['gap_radar']['failed']} Failed")
    for f in res["gap_radar"]["failures"]:
        print(f"  [FAIL] {f}")

    print(f"\n[CLEAN CORE OBJECT GUARD]: {res['clean_core']['passed']} Passed, {res['clean_core']['failed']} Failed")
    for f in res["clean_core"]["failures"]:
        print(f"  [FAIL] {f}")
    print("=" * 80)
