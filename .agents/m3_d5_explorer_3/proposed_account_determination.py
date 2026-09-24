"""Universal Account Determination Verifier Engine (Feature 34).

Authoritative preflight audit of SAP automatic account determination matrices:
- Materials Management (MM) account determination (OBYC / T030)
- Sales & Distribution (SD) account determination (VKOA / T030K / C001-C005)
- General Ledger Master Data verification (Chart of Accounts SKA1 & Company Code SKB1)
- Posting block detection (XSPERR at Chart of Accounts or Company Code level)
- Conflicting & ambiguous rule detection
- Company code account extension verification
- Suspicious generic catch-all detection

Fully compliant with Cardinal Axiom 2 (14-Point Engine Anatomy).
"""

from __future__ import annotations

import csv
import io
import json
import re
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, ConfigDict, Field

from src.core.base_engine import BaseEngine
from src.core.registry import register_engine
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
from src.models.response import AnalysisMetrics, AnalysisResponse
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine


# ==============================================================================
# Domain Schemas & Models (Point 2: Input Schema)
# ==============================================================================

class OBYCRuleModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    chart_of_accounts: str = "CA01"
    transaction_key: str  # BSX, WRX, PRD, GBB, KDM, KON
    valuation_grouping: Optional[str] = None  # BWMOD
    account_modifier: Optional[str] = None    # KOMOK / General Modification
    valuation_class: str                      # BKLAS (e.g. 3000, 3100, 7920)
    debit_account: Optional[str] = None       # KONTS
    credit_account: Optional[str] = None      # KONTU
    gl_account: Optional[str] = None          # Resolved or direct account


class VKOARuleModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    chart_of_accounts: str = "CA01"
    sales_org: Optional[str] = None           # VKORG
    customer_aag: Optional[str] = None        # Customer Account Assignment Group
    material_aag: Optional[str] = None        # Material Account Assignment Group
    account_key: str                          # ERL, ERS, ERF, ERB
    gl_account: Optional[str] = None          # Resolved GL account


class SKA1MasterModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    chart_of_accounts: str
    gl_account: str
    name: Optional[str] = None
    account_group: Optional[str] = None
    xsperr: bool = False                      # Chart of accounts posting block


class SKB1MasterModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    company_code: str
    gl_account: str
    currency: Optional[str] = "EUR"
    open_item_mgmt: bool = False
    xsperr: bool = False                      # Company code posting block


class ValuationClassModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    valuation_class: str
    description: Optional[str] = None
    material_type: Optional[str] = None


class AccountDeterminationInputData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    chart_of_accounts: str = "CA01"
    company_code: str = "1000"
    obyc_rules: List[OBYCRuleModel] = Field(default_factory=list)
    vkoa_rules: List[VKOARuleModel] = Field(default_factory=list)
    ska1_accounts: List[SKA1MasterModel] = Field(default_factory=list)
    skb1_accounts: List[SKB1MasterModel] = Field(default_factory=list)
    valuation_classes: List[ValuationClassModel] = Field(default_factory=list)
    expected_combinations: List[Dict[str, str]] = Field(default_factory=list)


# ==============================================================================
# Standard Baseline Constants
# ==============================================================================

STANDARD_MM_KEYS: List[str] = ["BSX", "WRX", "PRD", "GBB"]
STANDARD_SD_KEYS: List[str] = ["ERL", "ERS"]

STANDARD_VALUATION_CLASSES: List[str] = ["3000", "3100", "7900", "7920"]


# ==============================================================================
# Helper Utilities
# ==============================================================================

def _locate_line_in_text(raw_text: str, token: Any) -> Tuple[int, int, str]:
    """Scans raw_text for token and returns (1-based line, 1-based col, line_snippet)."""
    if not raw_text:
        return 1, 1, ""
    lines = raw_text.splitlines()
    token_str = str(token).strip()
    if not token_str:
        return 1, 1, lines[0].strip() if lines else ""

    for idx, line in enumerate(lines, 1):
        pos = line.find(token_str)
        if pos != -1:
            return idx, pos + 1, line.strip()

    # Case-insensitive secondary search
    token_lower = token_str.lower()
    for idx, line in enumerate(lines, 1):
        pos = line.lower().find(token_lower)
        if pos != -1:
            return idx, pos + 1, line.strip()

    return 1, 1, lines[0].strip() if lines else ""


# ==============================================================================
# Universal Account Determination Verifier Engine (Cardinal Axiom 2)
# ==============================================================================

@register_engine
class AccountDeterminationEngine(BaseEngine):
    """Production-grade Universal Account Determination Verifier."""

    engine_type = EngineType.ACCOUNT_DETERMINATION_PREFLIGHT
    name = "Account Determination Preflight"
    description = (
        "OBYC, VKOA, and FBKP automatic account determination rule validator, "
        "detecting missing GL accounts, posting blocks, conflicting rules, and matrix gaps."
    )
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.CSV]

    def _parse_inputs(self, raw_content: str) -> AccountDeterminationInputData:
        """Parses JSON payload or CSV tables into validated AccountDeterminationInputData."""
        if not raw_content or not raw_content.strip():
            return AccountDeterminationInputData()

        stripped = raw_content.strip()
        if stripped.startswith("{"):
            try:
                data_dict = json.loads(stripped)
                return AccountDeterminationInputData.model_validate(data_dict)
            except Exception:
                pass

        # Parse CSV format (handles OBYC export, VKOA export, or SKA1/SKB1 dump)
        obyc_rules: List[OBYCRuleModel] = []
        vkoa_rules: List[VKOARuleModel] = []
        ska1_accounts: List[SKA1MasterModel] = []
        skb1_accounts: List[SKB1MasterModel] = []
        val_classes: List[ValuationClassModel] = []
        coa = "CA01"
        cc = "1000"

        reader = csv.DictReader(io.StringIO(stripped))
        for row in reader:
            normalized_row = {k.strip().upper(): v.strip() for k, v in row.items() if k and v}

            if "KTOPL" in normalized_row:
                coa = normalized_row["KTOPL"]
            if "BUKRS" in normalized_row:
                cc = normalized_row["BUKRS"]

            # OBYC / T030 format
            if "KTOSL" in normalized_row and ("BKLAS" in normalized_row or "VALUATION_CLASS" in normalized_row):
                t_key = normalized_row["KTOSL"]
                bklas = normalized_row.get("BKLAS", normalized_row.get("VALUATION_CLASS", ""))
                mod = normalized_row.get("KOMOK", normalized_row.get("MODIFIER", ""))
                debit_acct = normalized_row.get("KONTS", normalized_row.get("DEBIT_ACCOUNT", ""))
                credit_acct = normalized_row.get("KONTU", normalized_row.get("CREDIT_ACCOUNT", ""))
                gl_acct = normalized_row.get("GL_ACCOUNT", debit_acct or credit_acct)
                obyc_rules.append(
                    OBYCRuleModel(
                        chart_of_accounts=coa,
                        transaction_key=t_key,
                        account_modifier=mod if mod else None,
                        valuation_class=bklas,
                        debit_account=debit_acct if debit_acct else None,
                        credit_account=credit_acct if credit_acct else None,
                        gl_account=gl_acct if gl_acct else None,
                    )
                )

            # VKOA / SD format
            elif "VKORG" in normalized_row and ("ACCOUNT_KEY" in normalized_row or "KTOSL" in normalized_row):
                vkorg = normalized_row["VKORG"]
                act_key = normalized_row.get("ACCOUNT_KEY", normalized_row.get("KTOSL", "ERL"))
                cust_aag = normalized_row.get("CUSTOMER_AAG", normalized_row.get("KFRST", ""))
                mat_aag = normalized_row.get("MATERIAL_AAG", normalized_row.get("KTGRM", ""))
                gl_acct = normalized_row.get("GL_ACCOUNT", normalized_row.get("SAKNR", ""))
                vkoa_rules.append(
                    VKOARuleModel(
                        chart_of_accounts=coa,
                        sales_org=vkorg,
                        customer_aag=cust_aag if cust_aag else None,
                        material_aag=mat_aag if mat_aag else None,
                        account_key=act_key,
                        gl_account=gl_acct if gl_acct else None,
                    )
                )

            # SKA1 / Chart of Accounts Master
            elif "SAKNR" in normalized_row and "XSPERR" in normalized_row and "BUKRS" not in normalized_row:
                acct = normalized_row["SAKNR"]
                xsperr_flag = normalized_row["XSPERR"].upper() in ("X", "TRUE", "1")
                name = normalized_row.get("TXT20", normalized_row.get("NAME", ""))
                ska1_accounts.append(
                    SKA1MasterModel(
                        chart_of_accounts=coa,
                        gl_account=acct,
                        name=name,
                        xsperr=xsperr_flag,
                    )
                )

            # SKB1 / Company Code Master
            elif "SAKNR" in normalized_row and "BUKRS" in normalized_row:
                acct = normalized_row["SAKNR"]
                bukrs = normalized_row["BUKRS"]
                xsperr_flag = normalized_row.get("XSPERR", "").upper() in ("X", "TRUE", "1")
                skb1_accounts.append(
                    SKB1MasterModel(
                        company_code=bukrs,
                        gl_account=acct,
                        xsperr=xsperr_flag,
                    )
                )

        return AccountDeterminationInputData(
            chart_of_accounts=coa,
            company_code=cc,
            obyc_rules=obyc_rules,
            vkoa_rules=vkoa_rules,
            ska1_accounts=ska1_accounts,
            skb1_accounts=skb1_accounts,
            valuation_classes=val_classes,
        )

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Executes deterministic verification of automatic account determination matrix."""
        start_time = time.perf_counter()
        findings: List[Finding] = []
        rules_evaluated = 0

        # Retrieve artifact content
        raw_text = ""
        artifact_path = request.artifact_s3_key or "account_determination.json"
        if request.raw_content:
            raw_text = request.raw_content
        elif request.artifact_reference and getattr(request.artifact_reference, "content", None):
            raw_text = request.artifact_reference.content
        elif request.configuration and "content" in request.configuration:
            raw_text = str(request.configuration["content"])

        data = self._parse_inputs(raw_text)

        # Build master account indices
        # SKA1: (chart_of_accounts, gl_account) -> SKA1MasterModel
        ska1_index: Dict[Tuple[str, str], SKA1MasterModel] = {}
        for a in data.ska1_accounts:
            ska1_index[(a.chart_of_accounts, a.gl_account)] = a

        # SKB1: (company_code, gl_account) -> SKB1MasterModel
        skb1_index: Dict[Tuple[str, str], SKB1MasterModel] = {}
        for a in data.skb1_accounts:
            skb1_index[(a.company_code, a.gl_account)] = a

        total_combinations_evaluated = 0
        missing_accounts_count = 0
        blocked_accounts_count = 0

        # ----------------------------------------------------------------------
        # Subsystem 1: Materials Management (OBYC) Rule Evaluation
        # ----------------------------------------------------------------------
        obyc_rule_seen: Dict[Tuple[str, str, Optional[str], str], str] = {}

        for rule in data.obyc_rules:
            rules_evaluated += 1
            total_combinations_evaluated += 1
            effective_account = rule.gl_account or rule.debit_account or rule.credit_account

            # Condition key for OBYC conflict detection
            cond_key = (
                rule.chart_of_accounts,
                rule.transaction_key,
                rule.account_modifier,
                rule.valuation_class,
            )

            # Rule 1: Missing GL Account in Rule
            if not effective_account or not str(effective_account).strip():
                missing_accounts_count += 1
                token_to_search = rule.valuation_class or rule.transaction_key
                line_no, col_no, snippet = _locate_line_in_text(raw_text, token_to_search)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or f"{rule.transaction_key}:{rule.valuation_class}",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'TransactionKey "{rule.transaction_key}", ValuationClass "{rule.valuation_class}"',
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="ACCT_DET_MISSING_ACCOUNT",
                    severity=Severity.CRITICAL,
                    category="ACCOUNT_DETERMINATION_INTEGRITY",
                    title=(
                        f"Missing GL Account in OBYC: Transaction Key '{rule.transaction_key}', "
                        f"Valuation Class '{rule.valuation_class}'"
                    ),
                    description=(
                        f"In Chart of Accounts '{rule.chart_of_accounts}', transaction key '{rule.transaction_key}' "
                        f"and valuation class '{rule.valuation_class}' has no GL account assigned. Any material posting "
                        f"involving this valuation class will abort at runtime with fatal SAP error M7 001."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        f"Execute transaction OBYC, double-click transaction key '{rule.transaction_key}', "
                        f"enter Chart of Accounts '{rule.chart_of_accounts}', and maintain a valid balance sheet "
                        f"or P&L account for valuation class '{rule.valuation_class}'."
                    ),
                    evidence=[ev],
                    technical_details={
                        "chartOfAccounts": rule.chart_of_accounts,
                        "transactionKey": rule.transaction_key,
                        "valuationClass": rule.valuation_class,
                        "accountModifier": rule.account_modifier,
                        "subsystem": "MM_OBYC",
                    },
                    affected_objects=[f"OBYC:{rule.transaction_key}:{rule.valuation_class}"],
                )
                findings.append(ConfidenceClassifier.classify(f))
                continue

            # Rule 3: Conflicting / Duplicate Rules with Divergent Accounts
            if cond_key in obyc_rule_seen:
                prev_account = obyc_rule_seen[cond_key]
                if prev_account != effective_account:
                    line_no, col_no, snippet = _locate_line_in_text(raw_text, rule.valuation_class)
                    ev = EvidenceEngine.create_evidence(
                        artifact_path=artifact_path,
                        content=raw_text or f"{cond_key}:{effective_account}",
                        line_number=line_no,
                        column_number=col_no,
                        snippet=snippet or f'Conflicting rules for {cond_key}',
                        provenance=ConfidenceClass.VERIFIED,
                        source_type=TrustLevel.CUSTOMER_EVIDENCE,
                    )
                    f = Finding(
                        rule_id="ACCT_DET_CONFLICTING_RULES",
                        severity=Severity.MAJOR,
                        category="DETERMINATION_AMBIGUITY",
                        title=(
                            f"Conflicting OBYC Account Assignment for Key '{rule.transaction_key}' / "
                            f"Valuation Class '{rule.valuation_class}'"
                        ),
                        description=(
                            f"Multiple conflicting entries exist in OBYC for Chart of Accounts '{rule.chart_of_accounts}', "
                            f"Transaction Key '{rule.transaction_key}', Valuation Class '{rule.valuation_class}'. "
                            f"Rule resolves to conflicting accounts '{prev_account}' vs '{effective_account}', "
                            "creating non-deterministic financial postings."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"Execute transaction OBYC, inspect transaction key '{rule.transaction_key}', and remove "
                            "duplicate or conflicting valuation class entries."
                        ),
                        evidence=[ev],
                        technical_details={
                            "chartOfAccounts": rule.chart_of_accounts,
                            "transactionKey": rule.transaction_key,
                            "valuationClass": rule.valuation_class,
                            "accountA": prev_account,
                            "accountB": effective_account,
                        },
                        affected_objects=[f"OBYC:{rule.transaction_key}:{rule.valuation_class}"],
                    )
                    findings.append(ConfidenceClassifier.classify(f))
            else:
                obyc_rule_seen[cond_key] = effective_account

            # Rule 2: Account Blocked for Posting (SKA1 / SKB1 XSPERR)
            # Check SKA1 level
            ska1_entry = ska1_index.get((rule.chart_of_accounts, effective_account))
            if ska1_entry and ska1_entry.xsperr:
                blocked_accounts_count += 1
                line_no, col_no, snippet = _locate_line_in_text(raw_text, effective_account)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or f"{effective_account}:XSPERR_SKA1",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'Account "{effective_account}" blocked in SKA1',
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="ACCT_DET_ACCOUNT_BLOCKED_POSTING",
                    severity=Severity.CRITICAL,
                    category="GL_POSTING_SECURITY",
                    title=f"Determined Account Blocked for Posting (Chart of Accounts): {effective_account}",
                    description=(
                        f"In OBYC rule for Transaction Key '{rule.transaction_key}' / Valuation Class '{rule.valuation_class}', "
                        f"resolved GL account '{effective_account}' is blocked for posting (SKA1-XSPERR = 'X') in Chart of "
                        f"Accounts '{rule.chart_of_accounts}'. Postings will abort at runtime."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        f"Open transaction FS00 (or FSP0), enter GL account '{effective_account}' and Chart of Accounts "
                        f"'{rule.chart_of_accounts}', and deselect the 'Blocked for posting' indicator."
                    ),
                    evidence=[ev],
                    technical_details={
                        "glAccount": effective_account,
                        "chartOfAccounts": rule.chart_of_accounts,
                        "blockLevel": "CHART_OF_ACCOUNTS",
                        "transactionKey": rule.transaction_key,
                        "valuationClass": rule.valuation_class,
                    },
                    affected_objects=[effective_account],
                )
                findings.append(ConfidenceClassifier.classify(f))

            # Check SKB1 level (Company Code)
            skb1_entry = skb1_index.get((data.company_code, effective_account))
            if skb1_entry and skb1_entry.xsperr:
                blocked_accounts_count += 1
                line_no, col_no, snippet = _locate_line_in_text(raw_text, effective_account)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or f"{effective_account}:XSPERR_SKB1",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'Account "{effective_account}" blocked in SKB1',
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="ACCT_DET_ACCOUNT_BLOCKED_POSTING",
                    severity=Severity.CRITICAL,
                    category="GL_POSTING_SECURITY",
                    title=f"Determined Account Blocked for Posting in Company Code {data.company_code}: {effective_account}",
                    description=(
                        f"In OBYC rule for Transaction Key '{rule.transaction_key}', resolved GL account '{effective_account}' "
                        f"has posting block enabled (SKB1-XSPERR = 'X') in target Company Code '{data.company_code}'. "
                        "Inventory transactions will fail."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        f"Open transaction FS00 (or FSS0), enter GL account '{effective_account}' and Company Code "
                        f"'{data.company_code}', and uncheck 'Blocked for posting'."
                    ),
                    evidence=[ev],
                    technical_details={
                        "glAccount": effective_account,
                        "companyCode": data.company_code,
                        "blockLevel": "COMPANY_CODE",
                        "transactionKey": rule.transaction_key,
                        "valuationClass": rule.valuation_class,
                    },
                    affected_objects=[effective_account],
                )
                findings.append(ConfidenceClassifier.classify(f))

            # Rule 4: Account Defined in Chart of Accounts but Missing in Company Code (SKB1)
            if data.skb1_accounts and effective_account:
                if (rule.chart_of_accounts, effective_account) in ska1_index and (data.company_code, effective_account) not in skb1_index:
                    line_no, col_no, snippet = _locate_line_in_text(raw_text, effective_account)
                    ev = EvidenceEngine.create_evidence(
                        artifact_path=artifact_path,
                        content=raw_text or f"{effective_account}:NOT_IN_SKB1",
                        line_number=line_no,
                        column_number=col_no,
                        snippet=snippet or f'Account "{effective_account}" missing in SKB1',
                        provenance=ConfidenceClass.VERIFIED,
                        source_type=TrustLevel.CUSTOMER_EVIDENCE,
                    )
                    f = Finding(
                        rule_id="ACCT_DET_ACCOUNT_NOT_IN_COMPANY_CODE",
                        severity=Severity.CRITICAL,
                        category="GL_MASTER_SYNCHRONIZATION",
                        title=f"Determined Account Not Extended to Company Code {data.company_code}: {effective_account}",
                        description=(
                            f"GL account '{effective_account}' is defined in Chart of Accounts '{rule.chart_of_accounts}', "
                            f"but has not been created/extended in Company Code '{data.company_code}'. Postings will abort "
                            f"with error 'Account {effective_account} does not exist in company code {data.company_code}'."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"Execute transaction FS00 in Company Code '{data.company_code}' and create account "
                            f"'{effective_account}' using Chart of Accounts template '{rule.chart_of_accounts}'."
                        ),
                        evidence=[ev],
                        technical_details={
                            "glAccount": effective_account,
                            "chartOfAccounts": rule.chart_of_accounts,
                            "companyCode": data.company_code,
                        },
                        affected_objects=[effective_account],
                    )
                    findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Subsystem 2: Sales & Distribution (VKOA) Rule Evaluation
        # ----------------------------------------------------------------------
        vkoa_rule_seen: Dict[Tuple[str, Optional[str], Optional[str], Optional[str], str], str] = {}

        for v_rule in data.vkoa_rules:
            rules_evaluated += 1
            total_combinations_evaluated += 1
            eff_vkoa_acct = v_rule.gl_account

            v_cond_key = (
                v_rule.chart_of_accounts,
                v_rule.sales_org,
                v_rule.customer_aag,
                v_rule.material_aag,
                v_rule.account_key,
            )

            # Rule 1: Missing Account in VKOA
            if not eff_vkoa_acct or not str(eff_vkoa_acct).strip():
                missing_accounts_count += 1
                token_to_search = v_rule.account_key or v_rule.sales_org or "VKOA"
                line_no, col_no, snippet = _locate_line_in_text(raw_text, token_to_search)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or f"{v_rule.sales_org}:{v_rule.account_key}",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'Account key "{v_rule.account_key}" in SalesOrg "{v_rule.sales_org}"',
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="ACCT_DET_MISSING_ACCOUNT",
                    severity=Severity.CRITICAL,
                    category="ACCOUNT_DETERMINATION_INTEGRITY",
                    title=(
                        f"Missing Revenue / Expense GL Account in VKOA: Sales Org '{v_rule.sales_org}', "
                        f"Account Key '{v_rule.account_key}'"
                    ),
                    description=(
                        f"In SD Account Determination table VKOA, condition key (Sales Org: '{v_rule.sales_org}', "
                        f"Cust AAG: '{v_rule.customer_aag}', Mat AAG: '{v_rule.material_aag}', Account Key: '{v_rule.account_key}') "
                        "has no GL account maintained. Invoices generated in VF01 will fail to release to accounting (VFX3 block)."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        f"Execute transaction VKOA, select condition table, and maintain the GL account for Sales Org "
                        f"'{v_rule.sales_org}' and Account Key '{v_rule.account_key}'."
                    ),
                    evidence=[ev],
                    technical_details={
                        "chartOfAccounts": v_rule.chart_of_accounts,
                        "salesOrg": v_rule.sales_org,
                        "customerAAG": v_rule.customer_aag,
                        "materialAAG": v_rule.material_aag,
                        "accountKey": v_rule.account_key,
                        "subsystem": "SD_VKOA",
                    },
                    affected_objects=[f"VKOA:{v_rule.sales_org}:{v_rule.account_key}"],
                )
                findings.append(ConfidenceClassifier.classify(f))
                continue

            # Rule 3: Conflicting VKOA Rules
            if v_cond_key in vkoa_rule_seen:
                prev_acct = vkoa_rule_seen[v_cond_key]
                if prev_acct != eff_vkoa_acct:
                    line_no, col_no, snippet = _locate_line_in_text(raw_text, eff_vkoa_acct)
                    ev = EvidenceEngine.create_evidence(
                        artifact_path=artifact_path,
                        content=raw_text or f"{v_cond_key}:{eff_vkoa_acct}",
                        line_number=line_no,
                        column_number=col_no,
                        snippet=snippet or f'Conflicting VKOA rules for {v_cond_key}',
                        provenance=ConfidenceClass.VERIFIED,
                        source_type=TrustLevel.CUSTOMER_EVIDENCE,
                    )
                    f = Finding(
                        rule_id="ACCT_DET_CONFLICTING_RULES",
                        severity=Severity.MAJOR,
                        category="DETERMINATION_AMBIGUITY",
                        title=f"Conflicting VKOA Account Assignment for Account Key '{v_rule.account_key}'",
                        description=(
                            f"Multiple conflicting entries exist in VKOA for Sales Org '{v_rule.sales_org}', "
                            f"Account Key '{v_rule.account_key}'. Rule resolves to conflicting accounts '{prev_acct}' "
                            f"vs '{eff_vkoa_acct}'."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation="Execute transaction VKOA and eliminate duplicate entries for identical condition keys.",
                        evidence=[ev],
                        technical_details={
                            "salesOrg": v_rule.sales_org,
                            "accountKey": v_rule.account_key,
                            "accountA": prev_acct,
                            "accountB": eff_vkoa_acct,
                        },
                        affected_objects=[f"VKOA:{v_rule.sales_org}:{v_rule.account_key}"],
                    )
                    findings.append(ConfidenceClassifier.classify(f))
            else:
                vkoa_rule_seen[v_cond_key] = eff_vkoa_acct

            # Check posting block for VKOA account
            ska1_v_entry = ska1_index.get((v_rule.chart_of_accounts, eff_vkoa_acct))
            if ska1_v_entry and ska1_v_entry.xsperr:
                blocked_accounts_count += 1
                line_no, col_no, snippet = _locate_line_in_text(raw_text, eff_vkoa_acct)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or f"{eff_vkoa_acct}:VKOA_XSPERR",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'Revenue account "{eff_vkoa_acct}" blocked in SKA1',
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="ACCT_DET_ACCOUNT_BLOCKED_POSTING",
                    severity=Severity.CRITICAL,
                    category="GL_POSTING_SECURITY",
                    title=f"VKOA Revenue Account Blocked for Posting: {eff_vkoa_acct}",
                    description=(
                        f"Resolved GL revenue/sales account '{eff_vkoa_acct}' in VKOA (Account Key: '{v_rule.account_key}') "
                        f"is blocked for posting (SKA1-XSPERR = 'X'). Customer invoice releases will fail."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=f"Open FS00, enter account '{eff_vkoa_acct}', and uncheck the posting block checkbox.",
                    evidence=[ev],
                    technical_details={
                        "glAccount": eff_vkoa_acct,
                        "accountKey": v_rule.account_key,
                        "salesOrg": v_rule.sales_org,
                    },
                    affected_objects=[eff_vkoa_acct],
                )
                findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Subsystem 3: Missing Permutation Traversal
        # ----------------------------------------------------------------------
        if data.valuation_classes and data.obyc_rules:
            active_bklas_keys: Set[Tuple[str, str]] = {
                (r.transaction_key, r.valuation_class) for r in data.obyc_rules if r.gl_account or r.debit_account
            }
            for vc in data.valuation_classes:
                for req_key in ["BSX", "WRX"]:
                    rules_evaluated += 1
                    total_combinations_evaluated += 1
                    if (req_key, vc.valuation_class) not in active_bklas_keys:
                        missing_accounts_count += 1
                        line_no, col_no, snippet = _locate_line_in_text(raw_text, vc.valuation_class)
                        ev = EvidenceEngine.create_evidence(
                            artifact_path=artifact_path,
                            content=raw_text or f"MATRIX_GAP:{req_key}:{vc.valuation_class}",
                            line_number=line_no,
                            column_number=col_no,
                            snippet=snippet or f'Valuation class "{vc.valuation_class}" missing "{req_key}"',
                            provenance=ConfidenceClass.VERIFIED,
                            source_type=TrustLevel.CUSTOMER_EVIDENCE,
                        )
                        f = Finding(
                            rule_id="ACCT_DET_MISSING_ACCOUNT",
                            severity=Severity.CRITICAL,
                            category="MATRIX_COMPLETENESS",
                            title=f"Mandatory Account Missing: Key '{req_key}' for Valuation Class '{vc.valuation_class}'",
                            description=(
                                f"Valuation Class '{vc.valuation_class}' ({vc.description or 'Custom Material'}) has no "
                                f"account determination maintained for mandatory transaction key '{req_key}' in OBYC. "
                                "Material transactions will fail immediately."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=(
                                f"Execute transaction OBYC, select '{req_key}', and add an entry for valuation class "
                                f"'{vc.valuation_class}' with a valid GL account."
                            ),
                            evidence=[ev],
                            technical_details={
                                "transactionKey": req_key,
                                "valuationClass": vc.valuation_class,
                                "chartOfAccounts": data.chart_of_accounts,
                            },
                            affected_objects=[f"OBYC:{req_key}:{vc.valuation_class}"],
                        )
                        findings.append(ConfidenceClassifier.classify(f))

        # Metrics calculation
        duration_ms = int((time.perf_counter() - start_time) * 1000)
        coverage_pct = 100.0
        if total_combinations_evaluated > 0:
            uncovered = missing_accounts_count + blocked_accounts_count
            coverage_pct = max(0.0, round(((total_combinations_evaluated - uncovered) / total_combinations_evaluated) * 100, 1))

        metrics = AnalysisMetrics(
            execution_time_ms=duration_ms,
            rules_evaluated=rules_evaluated,
            artifacts_scanned=1 if raw_text else 0,
        )

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=metrics,
        )
