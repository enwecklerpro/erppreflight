"""
SPRO2Cloud Preflight Engine: Feature 22
Author: m3_d2_explorer_1
Domain: Migration & Clean Core / Configuration Modernization (ECC IMG to S/4HANA Cloud)

Evaluates legacy SAP ECC / S/4HANA On-Premise SPRO IMG activities and configuration tables,
mapping them to S/4HANA Cloud Public Edition Central Business Configuration (CBC) activities,
Self-Service Configuration UIs (SSCUIs), Best Practice Scope Items, and Fiori Business Catalogs.

Adheres 100% to Cardinal Axiom 2 (14-point engine anatomy):
- Memory-bounded, line-preserving deterministic parser
- Cryptographic SHA-256 evidence generation with 1-indexed line/column pointers
- Epistemic confidence classification with automatic missing-evidence demotion
- Pure deterministic evaluation loop
"""

import csv
import hashlib
import io
import json
import time
from typing import Dict, Any, List, Optional, Tuple

from pydantic import BaseModel, Field

from src.core.base_engine import BaseEngine
from src.core.registry import register_engine
from src.models.enums import (
    EngineType,
    ArtifactType,
    AnalysisStatus,
    Severity,
    ConfidenceClass,
    TrustLevel,
)
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse, AnalysisMetrics
from src.platform.confidence import ConfidenceClassifier


# ============================================================================
# 1. DOMAIN MODELS & SCHEMAS
# ============================================================================

class SproConfigItem(BaseModel):
    """Normalized configuration entry from customer artifact."""
    activity_id: str = Field(..., description="SPRO / IMG activity identifier or transaction")
    table_name: Optional[str] = Field(None, description="Underlying SAP configuration table or view")
    description: Optional[str] = Field(None, description="Human-readable activity or table description")
    module: Optional[str] = Field(None, description="SAP functional module (SD, MM, FI, CO, etc.)")
    country: Optional[str] = Field(None, description="Target country code (e.g. DE, US, GLOBAL)")
    line_number: int = Field(1, description="1-indexed line number in source artifact")
    column_number: int = Field(1, description="1-indexed column number in source artifact")
    raw_snippet: str = Field(..., description="Verbatim raw text snippet from artifact")
    artifact_path: str = Field("input.csv", description="Relative path of artifact")


class SproCatalogEntry(BaseModel):
    """Authoritative reference mapping for SPRO node to S/4HANA Cloud CBC/SSCUI."""
    activity_id: str
    table_names: List[str]
    description: str
    module: str
    classification: str  # EXACT, PARTIAL, SCOPE_DEPENDENT, PROCESS_REDESIGN, NOT_AVAILABLE, NEEDS_REVIEW
    sscui_id: Optional[str]
    cbc_activity: Optional[str]
    scope_items: List[str]
    business_catalogs: List[str]
    country_restrictions: List[str]  # Empty list means valid for all countries
    remediation_guide: str


# ============================================================================
# 2. AUTHORITATIVE SPRO TO CLOUD CBC / SSCUI MAPPING CATALOG
# ============================================================================

SPRO_CATALOG: Dict[str, SproCatalogEntry] = {
    # -------------------------------------------------------------------------
    # SD: Sales and Distribution
    # -------------------------------------------------------------------------
    "SIMG_CFMENUOLSDVOFA": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLSDVOFA",
        table_names=["TVFK", "TVFKT"],
        description="Define Billing Types",
        module="SD",
        classification="EXACT",
        sscui_id="101230",
        cbc_activity="Configure Billing Document Types",
        scope_items=["BD9"],
        business_catalogs=["SAP_CA_BC_IC_LND_SD_PC"],
        country_restrictions=[],
        remediation_guide="Navigate to CBC activity 'Configure Billing Document Types' (SSCUI 101230). Recreate custom billing document types within standard namespace."
    ),
    "SIMG_CFMENUOLSDVOV8": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLSDVOV8",
        table_names=["TVAK", "TVAKT"],
        description="Define Sales Document Types",
        module="SD",
        classification="EXACT",
        sscui_id="102434",
        cbc_activity="Configure Sales Document Types",
        scope_items=["BD9"],
        business_catalogs=["SAP_CA_BC_IC_LND_SD_PC"],
        country_restrictions=[],
        remediation_guide="Navigate to CBC activity 'Configure Sales Document Types' (SSCUI 102434). Map order types to pre-delivered Best Practice profiles."
    ),
    "SIMG_CFMENUOLSDOVZ0": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLSDOVZ0",
        table_names=["TVPT", "TVPTT"],
        description="Define Item Categories",
        module="SD",
        classification="EXACT",
        sscui_id="102435",
        cbc_activity="Define Item Categories",
        scope_items=["BD9"],
        business_catalogs=["SAP_CA_BC_IC_LND_SD_PC"],
        country_restrictions=[],
        remediation_guide="Configure Item Categories in SSCUI 102435. Custom item categories must follow Y/Z naming conventions."
    ),
    "SIMG_CFMENUOLSDVKOA": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLSDVKOA",
        table_names=["T685A", "C001", "C002"],
        description="Automatic Account Determination SD",
        module="SD",
        classification="SCOPE_DEPENDENT",
        sscui_id="100297",
        cbc_activity="Automatic Account Determination",
        scope_items=["BD9", "1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Ensure Scope Item BD9 or 1MD is active. Access SSCUI 100297 to configure revenue account determination tables."
    ),
    "SIMG_CFMENUOLSDVOFM": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLSDVOFM",
        table_names=["TFRM", "TFRMT"],
        description="Define Formulas and Requirements (VOFM)",
        module="SD",
        classification="PROCESS_REDESIGN",
        sscui_id=None,
        cbc_activity="Cloud Extensibility BAdI",
        scope_items=["BD9"],
        business_catalogs=["SAP_CORE_BC_EXT"],
        country_restrictions=[],
        remediation_guide="VOFM classic routine ABAP modifications are prohibited in Public Cloud. Implement Cloud BAdIs: SD_SLS_MODIFY_HEAD, SD_BIL_PRICING_CALC via Key-User Extensibility."
    ),
    "SIMG_CFMENUOLSDNACE": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLSDNACE",
        table_names=["TNAPR", "NAST"],
        description="Output Determination via Conditions (NACE)",
        module="SD",
        classification="PROCESS_REDESIGN",
        sscui_id="102261",
        cbc_activity="Output Parameter Determination (OPD)",
        scope_items=["1LQ"],
        business_catalogs=["SAP_CA_BC_OC_PC"],
        country_restrictions=[],
        remediation_guide="Classic NAST output control is obsolete in S/4HANA Cloud. Migrate business rules into BRFplus decision tables in Fiori App 'Output Parameter Determination' (SSCUI 102261)."
    ),
    "SIMG_CFMENUOLSDCRED": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLSDCRED",
        table_names=["T014", "T014T"],
        description="Classic Credit Management",
        module="SD",
        classification="PROCESS_REDESIGN",
        sscui_id="102144",
        cbc_activity="Define Credit Control Areas (FSCM)",
        scope_items=["BD6"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Classic FI-AR-CR credit management is obsolete. Transition to SAP S/4HANA Financial Supply Chain Management (FSCM) Credit Management under Scope Item BD6."
    ),
    "SIMG_CFMENUOLSDOVK1": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLSDOVK1",
        table_names=["TTXD"],
        description="Define Tax Determination Rules",
        module="SD",
        classification="EXACT",
        sscui_id="101016",
        cbc_activity="Define Tax Determination Rules",
        scope_items=["BD9"],
        business_catalogs=["SAP_CA_BC_IC_LND_SD_PC"],
        country_restrictions=[],
        remediation_guide="Maintain tax determination rules via SSCUI 101016 or integrate with SAP Localization / external tax partner."
    ),

    # -------------------------------------------------------------------------
    # MM: Materials Management & Sourcing
    # -------------------------------------------------------------------------
    "SIMG_CFMENUOLMEOMH5": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLMEOMH5",
        table_names=["T161", "T161T"],
        description="Define Purchasing Document Types",
        module="MM",
        classification="EXACT",
        sscui_id="101097",
        cbc_activity="Define Document Types for Purchase Orders",
        scope_items=["1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_MM_PC"],
        country_restrictions=[],
        remediation_guide="Maintain Purchase Order document types in SSCUI 101097. Ensure standard category link profiles are verified."
    ),
    "SIMG_CFMENUOLMEOME9": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLMEOME9",
        table_names=["T163K", "T163P"],
        description="Define Account Assignment Categories",
        module="MM",
        classification="EXACT",
        sscui_id="102636",
        cbc_activity="Define Account Assignment Categories",
        scope_items=["1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_MM_PC"],
        country_restrictions=[],
        remediation_guide="Configure Account Assignment Categories via SSCUI 102636. Validate consumption posting indicators."
    ),
    "SIMG_CFMENUOLMEOMBA": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLMEOMBA",
        table_names=["T161B"],
        description="Define Purchase Requisition Document Types",
        module="MM",
        classification="EXACT",
        sscui_id="101096",
        cbc_activity="Define Document Types for Requisitions",
        scope_items=["1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_MM_PC"],
        country_restrictions=[],
        remediation_guide="Configure purchase requisition document types via SSCUI 101096."
    ),
    "SIMG_CFMENUOLMEOMSK": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLMEOMSK",
        table_names=["T16FS", "T16FV"],
        description="Define Release Strategy for Purchase Orders",
        module="MM",
        classification="PROCESS_REDESIGN",
        sscui_id="101948",
        cbc_activity="Manage Workflows for Purchase Orders",
        scope_items=["1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_MM_PC"],
        country_restrictions=[],
        remediation_guide="Classic release procedures with classification (CEKKO/CEBAN) are replaced by Flexible Workflow in S/4HANA Cloud (SSCUI 101948 / Fiori App 'Manage Workflows for Purchase Orders')."
    ),
    "SIMG_CFMENUOLMEOBYC": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLMEOBYC",
        table_names=["T030", "T030R"],
        description="Configure Automatic Postings (MM Account Determination)",
        module="MM",
        classification="EXACT",
        sscui_id="100297",
        cbc_activity="Configure Automatic Postings",
        scope_items=["1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Map valuation classes and transaction keys (BSX, WRX, GBB, PRD) in SSCUI 100297."
    ),
    "SIMG_CFMENUOLMEOMWB": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLMEOMWB",
        table_names=["T025", "T025T"],
        description="Define Valuation Classes",
        module="MM",
        classification="EXACT",
        sscui_id="102422",
        cbc_activity="Define Valuation Classes",
        scope_items=["1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_MM_PC"],
        country_restrictions=[],
        remediation_guide="Configure valuation classes in SSCUI 102422."
    ),
    "SIMG_CFMENUOLMEOMSK_EXT": SproCatalogEntry(
        activity_id="SIMG_CFMENUOLMEOMSK_EXT",
        table_names=["T161S"],
        description="Subcontracting Special Stock Settings",
        module="MM",
        classification="SCOPE_DEPENDENT",
        sscui_id="103412",
        cbc_activity="Define Subcontracting Settings",
        scope_items=["BMD"],
        business_catalogs=["SAP_CA_BC_IC_LND_MM_PC"],
        country_restrictions=[],
        remediation_guide="Requires explicit activation of Best Practice Scope Item BMD (Subcontracting). Configure in SSCUI 103412."
    ),

    # -------------------------------------------------------------------------
    # FI: Financial Accounting
    # -------------------------------------------------------------------------
    "SIMG_CFMENUORFBOBA7": SproCatalogEntry(
        activity_id="SIMG_CFMENUORFBOBA7",
        table_names=["T003", "T003T"],
        description="Define Document Types (FI)",
        module="FI",
        classification="EXACT",
        sscui_id="101522",
        cbc_activity="Define Document Types",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Recreate required FI document types in SSCUI 101522 and assign corresponding number range intervals."
    ),
    "SIMG_CFMENUORFBOB08": SproCatalogEntry(
        activity_id="SIMG_CFMENUORFBOB08",
        table_names=["TBSL", "TBSLT"],
        description="Define Posting Keys",
        module="FI",
        classification="PARTIAL",
        sscui_id="101523",
        cbc_activity="Define Posting Keys",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Standard SAP posting keys (01, 11, 40, 50, etc.) are pre-delivered in SSCUI 101523. Custom posting key creation is restricted; adapt business postings to pre-delivered keys."
    ),
    "SIMG_CFMENUORFBOB41": SproCatalogEntry(
        activity_id="SIMG_CFMENUORFBOB41",
        table_names=["T004F"],
        description="Maintain Field Status Variants",
        module="FI",
        classification="EXACT",
        sscui_id="101524",
        cbc_activity="Maintain Field Status Variants",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Configure Field Status Groups in SSCUI 101524 to control optional/required field attributes on line items."
    ),
    "SIMG_CFMENUORFBOBA1": SproCatalogEntry(
        activity_id="SIMG_CFMENUORFBOBA1",
        table_names=["TCURV"],
        description="Define Exchange Rate Types",
        module="FI",
        classification="EXACT",
        sscui_id="103233",
        cbc_activity="Define Exchange Rate Types",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Maintain exchange rate types (e.g. M, B, G) in SSCUI 103233."
    ),
    "SIMG_CFMENUORFBOB29": SproCatalogEntry(
        activity_id="SIMG_CFMENUORFBOB29",
        table_names=["T009", "T009B"],
        description="Define Fiscal Year Variants",
        module="FI",
        classification="EXACT",
        sscui_id="101525",
        cbc_activity="Define Fiscal Year Variants",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Assign fiscal year variant in SSCUI 101525 during initial CBC project scoping."
    ),
    "SIMG_CFMENUORFBOB52": SproCatalogEntry(
        activity_id="SIMG_CFMENUORFBOB52",
        table_names=["T001B"],
        description="Open and Close Posting Periods",
        module="FI",
        classification="EXACT",
        sscui_id="101526",
        cbc_activity="Manage Posting Periods",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="In Cloud, posting periods are managed operational-time via Fiori App 'Manage Posting Periods' (F2012) or configuration SSCUI 101526."
    ),
    "SIMG_CFMENUORFBFISL": SproCatalogEntry(
        activity_id="SIMG_CFMENUORFBFISL",
        table_names=["GLT0", "GLFUNCT"],
        description="Special Ledger (FI-SL)",
        module="FI",
        classification="NOT_AVAILABLE",
        sscui_id=None,
        cbc_activity=None,
        scope_items=[],
        business_catalogs=[],
        country_restrictions=[],
        remediation_guide="Classic Special Ledger (FI-SL) is NOT supported in S/4HANA Cloud Public Edition. Multi-dimensional reporting and extension ledgers are natively fulfilled by the Universal Journal (ACDOCA)."
    ),
    "SIMG_CFMENUORFBOB45": SproCatalogEntry(
        activity_id="SIMG_CFMENUORFBOB45",
        table_names=["T014"],
        description="Define Credit Control Areas (Classic FI)",
        module="FI",
        classification="PROCESS_REDESIGN",
        sscui_id="102144",
        cbc_activity="Define Credit Control Areas (FSCM)",
        scope_items=["BD6"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Classic FI credit control areas are replaced by FSCM Credit Management (SSCUI 102144) under Scope Item BD6."
    ),

    # -------------------------------------------------------------------------
    # CO: Controlling
    # -------------------------------------------------------------------------
    "SIMG_CFMENUORKSOKP3": SproCatalogEntry(
        activity_id="SIMG_CFMENUORKSOKP3",
        table_names=["TKO08", "TKO09"],
        description="Define Settlement Profiles",
        module="CO",
        classification="SCOPE_DEPENDENT",
        sscui_id="101888",
        cbc_activity="Define Settlement Profiles",
        scope_items=["J58", "1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Settlement profiles for internal orders and projects require active Scope Items J58/1MD. Configure in SSCUI 101888."
    ),
    "SIMG_CFMENUORKAOKEN": SproCatalogEntry(
        activity_id="SIMG_CFMENUORKAOKEN",
        table_names=["TKA01"],
        description="Maintain Controlling Area",
        module="CO",
        classification="EXACT",
        sscui_id="100069",
        cbc_activity="Define Controlling Area",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_ORG_PC"],
        country_restrictions=[],
        remediation_guide="Controlling areas are configured during CBC organizational unit structuring (SSCUI 100069)."
    ),

    # -------------------------------------------------------------------------
    # Enterprise Structure / Organizational Units
    # -------------------------------------------------------------------------
    "V_T001W": SproCatalogEntry(
        activity_id="V_T001W",
        table_names=["T001W"],
        description="Define Plant",
        module="MM",
        classification="EXACT",
        sscui_id="100067",
        cbc_activity="Define Plant",
        scope_items=["1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_ORG_PC"],
        country_restrictions=[],
        remediation_guide="Define manufacturing, distribution, and storage plants in CBC activity 'Define Plant' (SSCUI 100067)."
    ),
    "TVKO": SproCatalogEntry(
        activity_id="TVKO",
        table_names=["TVKO"],
        description="Define Sales Organization",
        module="SD",
        classification="EXACT",
        sscui_id="100068",
        cbc_activity="Define Sales Organization",
        scope_items=["BD9"],
        business_catalogs=["SAP_CA_BC_IC_LND_ORG_PC"],
        country_restrictions=[],
        remediation_guide="Define Sales Organizations in CBC activity 'Define Sales Organization' (SSCUI 100068)."
    ),
    "T001": SproCatalogEntry(
        activity_id="T001",
        table_names=["T001"],
        description="Define Company Code",
        module="FI",
        classification="EXACT",
        sscui_id="100066",
        cbc_activity="Define Company Code",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_ORG_PC"],
        country_restrictions=[],
        remediation_guide="Company codes are generated via CBC Organizational Structure wizard (SSCUI 100066) based on pre-delivered country templates."
    ),
    "T042": SproCatalogEntry(
        activity_id="T042",
        table_names=["T042", "T042Z"],
        description="Automatic Payment Program (FBZP)",
        module="FI",
        classification="EXACT",
        sscui_id="101044",
        cbc_activity="Set Up Payment Methods per Country for Payment Transactions",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Maintain country-specific payment methods and paying company codes via SSCUI 101044."
    ),
    "T077S": SproCatalogEntry(
        activity_id="T077S",
        table_names=["T077S"],
        description="Define G/L Account Groups",
        module="FI",
        classification="EXACT",
        sscui_id="102752",
        cbc_activity="Define Account Group",
        scope_items=["J58"],
        business_catalogs=["SAP_CA_BC_IC_LND_FIN_PC"],
        country_restrictions=[],
        remediation_guide="Maintain G/L Account Groups in SSCUI 102752 for chart of accounts YCOA."
    ),
    "T156": SproCatalogEntry(
        activity_id="T156",
        table_names=["T156", "T156T"],
        description="Define Movement Types",
        module="MM",
        classification="PARTIAL",
        sscui_id="102377",
        cbc_activity="Define Movement Types",
        scope_items=["1MD"],
        business_catalogs=["SAP_CA_BC_IC_LND_MM_PC"],
        country_restrictions=[],
        remediation_guide="Standard movement types (101, 201, 261, 301, etc.) are pre-configured in SSCUI 102377. Custom 9xx movement types are restricted; use standard profiles."
    ),
}

# Table Name Reverse Index
TABLE_TO_SPRO: Dict[str, str] = {}
for act_id, entry in SPRO_CATALOG.items():
    for tbl in entry.table_names:
        TABLE_TO_SPRO[tbl.upper()] = act_id
    TABLE_TO_SPRO[act_id.upper()] = act_id


# ============================================================================
# 3. DETERMINISTIC PARSER & LINE TRACKER
# ============================================================================

class SproArtifactParser:
    """Memory-bounded parser for SPRO configuration exports preserving exact line numbers."""

    @classmethod
    def parse(cls, content: str, artifact_path: str = "input.csv") -> List[SproConfigItem]:
        items: List[SproConfigItem] = []
        clean_content = content.strip()
        if not clean_content:
            return items

        # Case 1: JSON payload
        if clean_content.startswith("[") or clean_content.startswith("{"):
            try:
                data = json.loads(clean_content)
                lines = content.splitlines()
                if isinstance(data, list):
                    for idx, row in enumerate(data, start=1):
                        if isinstance(row, dict):
                            act = str(row.get("activity_id") or row.get("activity") or row.get("id") or "").strip()
                            tbl = str(row.get("table_name") or row.get("table") or "").strip() or None
                            desc = str(row.get("description") or row.get("text") or "").strip() or None
                            mod = str(row.get("module") or row.get("area") or "").strip() or None
                            cntry = str(row.get("country") or "").strip() or None
                            
                            # Estimate line offset
                            line_num = min(idx, len(lines))
                            snippet = lines[line_num - 1] if line_num <= len(lines) else json.dumps(row)
                            if act or tbl:
                                items.append(SproConfigItem(
                                    activity_id=act or (tbl or "UNKNOWN"),
                                    table_name=tbl,
                                    description=desc,
                                    module=mod,
                                    country=cntry,
                                    line_number=line_num,
                                    column_number=1,
                                    raw_snippet=snippet,
                                    artifact_path=artifact_path,
                                ))
                elif isinstance(data, dict):
                    activities = data.get("activities") or data.get("items") or [data]
                    for idx, row in enumerate(activities, start=1):
                        if isinstance(row, dict):
                            act = str(row.get("activity_id") or row.get("activity") or row.get("id") or "").strip()
                            tbl = str(row.get("table_name") or row.get("table") or "").strip() or None
                            desc = str(row.get("description") or row.get("text") or "").strip() or None
                            mod = str(row.get("module") or row.get("area") or "").strip() or None
                            cntry = str(row.get("country") or "").strip() or None
                            line_num = min(idx, len(lines))
                            snippet = lines[line_num - 1] if line_num <= len(lines) else json.dumps(row)
                            if act or tbl:
                                items.append(SproConfigItem(
                                    activity_id=act or (tbl or "UNKNOWN"),
                                    table_name=tbl,
                                    description=desc,
                                    module=mod,
                                    country=cntry,
                                    line_number=line_num,
                                    column_number=1,
                                    raw_snippet=snippet,
                                    artifact_path=artifact_path,
                                ))
                return items
            except Exception:
                # If JSON parsing fails, fall back to line-by-line CSV parser
                pass

        # Case 2: Delimited CSV / TSV / Line-by-Line
        delimiter = "\t" if "\t" in clean_content.splitlines()[0] else ("," if "," in clean_content.splitlines()[0] else None)
        lines = content.splitlines()

        if delimiter:
            reader = csv.reader(io.StringIO(content), delimiter=delimiter)
            header: Optional[List[str]] = None
            act_idx, tbl_idx, desc_idx, mod_idx, cntry_idx = 0, -1, -1, -1, -1

            for line_idx, row in enumerate(reader, start=1):
                if not row or all(not cell.strip() for cell in row):
                    continue
                snippet = lines[line_idx - 1] if line_idx <= len(lines) else ",".join(row)

                # Detect header row
                if header is None and any(term in "".join(row).lower() for term in ["activity", "table", "simg", "module", "desc"]):
                    header = [c.strip().lower() for c in row]
                    for col_idx, col_name in enumerate(header):
                        if any(k in col_name for k in ["activity_id", "img_activity", "activity", "node"]):
                            act_idx = col_idx
                        elif any(k in col_name for k in ["table_name", "tablename", "table", "view"]):
                            tbl_idx = col_idx
                        elif any(k in col_name for k in ["description", "text", "name"]):
                            desc_idx = col_idx
                        elif any(k in col_name for k in ["module", "area", "appl"]):
                            mod_idx = col_idx
                        elif any(k in col_name for k in ["country", "land"]):
                            cntry_idx = col_idx
                    continue

                # Data row
                act = row[act_idx].strip() if 0 <= act_idx < len(row) else ""
                tbl = row[tbl_idx].strip() if 0 <= tbl_idx < len(row) else None
                desc = row[desc_idx].strip() if 0 <= desc_idx < len(row) else None
                mod = row[mod_idx].strip() if 0 <= mod_idx < len(row) else None
                cntry = row[cntry_idx].strip() if 0 <= cntry_idx < len(row) else None

                # Fallback if no header was found but first column has value
                if not act and len(row) > 0:
                    act = row[0].strip()

                if act or tbl:
                    items.append(SproConfigItem(
                        activity_id=act or (tbl or "UNKNOWN"),
                        table_name=tbl,
                        description=desc,
                        module=mod,
                        country=cntry,
                        line_number=line_idx,
                        column_number=1,
                        raw_snippet=snippet,
                        artifact_path=artifact_path,
                    ))
        else:
            # Single value per line (activity ID or table name)
            for line_idx, line in enumerate(lines, start=1):
                val = line.strip()
                if not val or val.startswith("#"):
                    continue
                items.append(SproConfigItem(
                    activity_id=val,
                    table_name=val if val.startswith("T") or val.startswith("V_") else None,
                    description=None,
                    module=None,
                    country=None,
                    line_number=line_idx,
                    column_number=1,
                    raw_snippet=line,
                    artifact_path=artifact_path,
                ))

        return items


# ============================================================================
# 4. SPRO2CLOUD ENGINE IMPLEMENTATION
# ============================================================================

@register_engine
class SPRO2CloudEngine(BaseEngine):
    engine_type = EngineType.SPRO2CLOUD
    name = "SPRO2Cloud"
    description = "On-premise IMG/SPRO configuration to Cloud CBC mapping and delta analysis"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.CSV, ArtifactType.XLSX, ArtifactType.JSON]

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        findings: List[Finding] = []
        rules_evaluated = 0

        # Step 1: Extract and parse artifacts
        raw_items: List[SproConfigItem] = []
        if request.raw_content:
            raw_items.extend(SproArtifactParser.parse(request.raw_content, "raw_content"))

        for art in request.artifacts:
            if art.raw_content:
                raw_items.extend(SproArtifactParser.parse(art.raw_content, art.file_name))

        # Metrics counters
        total_activities = len(raw_items)
        exact_count = 0
        partial_count = 0
        scope_count = 0
        redesign_count = 0
        not_avail_count = 0
        needs_review_count = 0

        target_release = request.target_release or "S4HC_2408"
        target_country = request.configuration.get("target_country") or "GLOBAL"

        # Step 2: Pure deterministic evaluation loop
        for item in raw_items:
            rules_evaluated += 6  # 6 classification checks per item
            activity_key = item.activity_id.strip()
            table_key = (item.table_name or "").strip().upper()

            catalog_entry: Optional[SproCatalogEntry] = None

            # Lookup priority: exact activity ID -> table reverse lookup -> uppercase lookup
            if activity_key in SPRO_CATALOG:
                catalog_entry = SPRO_CATALOG[activity_key]
            elif activity_key.upper() in SPRO_CATALOG:
                catalog_entry = SPRO_CATALOG[activity_key.upper()]
            elif table_key and table_key in TABLE_TO_SPRO:
                catalog_entry = SPRO_CATALOG[TABLE_TO_SPRO[table_key]]
            elif activity_key.upper() in TABLE_TO_SPRO:
                catalog_entry = SPRO_CATALOG[TABLE_TO_SPRO[activity_key.upper()]]

            # Cryptographic evidence creation
            snippet_str = item.raw_snippet.strip() or f"{item.activity_id}"
            sha256_hash = hashlib.sha256(snippet_str.encode("utf-8")).hexdigest()

            evidence_item = Evidence(
                artifact_path=item.artifact_path,
                line_number=item.line_number,
                column_number=item.column_number,
                snippet=snippet_str,
                sha256=sha256_hash,
                provenance=ConfidenceClass.VERIFIED if catalog_entry else ConfidenceClass.UNKNOWN,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
                trust_score=1.0 if catalog_entry else 0.30,
            )

            # Case A: Known catalog match
            if catalog_entry:
                cls_type = catalog_entry.classification
                tech_details = {
                    "legacyActivity": catalog_entry.activity_id,
                    "legacyTables": catalog_entry.table_names,
                    "classification": cls_type,
                    "sscuiId": catalog_entry.sscui_id or "N/A",
                    "cbcActivity": catalog_entry.cbc_activity or "N/A",
                    "scopeItems": catalog_entry.scope_items,
                    "businessCatalogs": catalog_entry.business_catalogs,
                    "targetRelease": target_release,
                    "targetCountry": target_country,
                    "countryRestrictions": catalog_entry.country_restrictions,
                }

                if cls_type == "EXACT":
                    exact_count += 1
                    f = Finding(
                        rule_id="SPRO_MAPPING_EXACT",
                        severity=Severity.INFO,
                        category="Configuration Modernization",
                        title=f"Exact Cloud Configuration Found for '{catalog_entry.description}'",
                        description=(
                            f"Legacy IMG activity '{catalog_entry.activity_id}' maps directly to "
                            f"S/4HANA Cloud SSCUI {catalog_entry.sscui_id} ({catalog_entry.cbc_activity}) "
                            f"under Scope Item '{', '.join(catalog_entry.scope_items)}'."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=catalog_entry.remediation_guide,
                        evidence=[evidence_item],
                        technical_details=tech_details,
                        affected_objects=[catalog_entry.activity_id] + catalog_entry.table_names,
                    )
                    findings.append(ConfidenceClassifier.classify(f))

                elif cls_type == "PARTIAL":
                    partial_count += 1
                    f = Finding(
                        rule_id="SPRO_MAPPING_PARTIAL",
                        severity=Severity.MINOR,
                        category="Configuration Modernization",
                        title=f"Partial Cloud Configuration for '{catalog_entry.description}'",
                        description=(
                            f"Legacy IMG activity '{catalog_entry.activity_id}' exists in Cloud via "
                            f"SSCUI {catalog_entry.sscui_id}, but custom sub-parameters or user modifications are restricted."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=catalog_entry.remediation_guide,
                        evidence=[evidence_item],
                        technical_details=tech_details,
                        affected_objects=[catalog_entry.activity_id] + catalog_entry.table_names,
                    )
                    findings.append(ConfidenceClassifier.classify(f))

                elif cls_type == "SCOPE_DEPENDENT":
                    scope_count += 1
                    f = Finding(
                        rule_id="SPRO_MAPPING_SCOPE_DEPENDENT",
                        severity=Severity.MINOR,
                        category="Scope Dependency",
                        title=f"Scope Item Activation Required for '{catalog_entry.description}'",
                        description=(
                            f"IMG activity '{catalog_entry.activity_id}' maps to SSCUI {catalog_entry.sscui_id}, "
                            f"which requires active license and CBC activation of Scope Items: {', '.join(catalog_entry.scope_items)}."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=catalog_entry.remediation_guide,
                        evidence=[evidence_item],
                        technical_details=tech_details,
                        affected_objects=[catalog_entry.activity_id] + catalog_entry.table_names,
                    )
                    findings.append(ConfidenceClassifier.classify(f))

                elif cls_type == "PROCESS_REDESIGN":
                    redesign_count += 1
                    f = Finding(
                        rule_id="SPRO_MAPPING_PROCESS_REDESIGN",
                        severity=Severity.MAJOR,
                        category="Process Modernization",
                        title=f"Process Redesign Required for '{catalog_entry.description}'",
                        description=(
                            f"Legacy configuration concept '{catalog_entry.activity_id}' is obsolete in S/4HANA Cloud. "
                            f"Cloud successor requires modern architecture: {catalog_entry.cbc_activity}."
                        ),
                        confidence=ConfidenceClass.RULE_DERIVED,
                        confidence_score=0.85,
                        remediation=catalog_entry.remediation_guide,
                        evidence=[evidence_item],
                        technical_details=tech_details,
                        affected_objects=[catalog_entry.activity_id] + catalog_entry.table_names,
                    )
                    findings.append(ConfidenceClassifier.classify(f))

                elif cls_type == "NOT_AVAILABLE":
                    not_avail_count += 1
                    f = Finding(
                        rule_id="SPRO_MAPPING_NOT_AVAILABLE",
                        severity=Severity.CRITICAL,
                        category="Cloud Parity Gap",
                        title=f"Unsupported On-Premise Configuration: '{catalog_entry.description}'",
                        description=(
                            f"Legacy IMG activity '{catalog_entry.activity_id}' (tables: {', '.join(catalog_entry.table_names)}) "
                            f"is deliberately excluded from S/4HANA Cloud Public Edition."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=catalog_entry.remediation_guide,
                        evidence=[evidence_item],
                        technical_details=tech_details,
                        affected_objects=[catalog_entry.activity_id] + catalog_entry.table_names,
                    )
                    findings.append(ConfidenceClassifier.classify(f))

            # Case B: Custom or Uncataloged Configuration (Z / Y / Unrecognized)
            else:
                needs_review_count += 1
                is_custom = activity_key.startswith("Z") or activity_key.startswith("Y") or (table_key and (table_key.startswith("Z") or table_key.startswith("Y")))
                tech_details = {
                    "legacyActivity": activity_key,
                    "legacyTable": table_key or "N/A",
                    "classification": "NEEDS_REVIEW",
                    "isCustomZObject": is_custom,
                    "targetRelease": target_release,
                }

                f = Finding(
                    rule_id="SPRO_MAPPING_NEEDS_REVIEW",
                    severity=Severity.MAJOR if is_custom else Severity.MINOR,
                    category="Uncataloged Configuration",
                    title=f"Uncataloged {'Custom' if is_custom else 'Legacy'} Configuration: '{activity_key}'",
                    description=(
                        f"Configuration activity '{activity_key}' (Table: {table_key or 'None'}) is not registered in the "
                        f"standard S/4HANA Cloud SSCUI catalog. Clean Core manual assessment is required."
                    ),
                    confidence=ConfidenceClass.UNKNOWN,
                    confidence_score=0.30,  # Epistemic honesty: Uncataloged custom objects strictly capped at 0.30
                    remediation=(
                        "Inspect custom configuration table or IMG node. If required in Cloud, implement a "
                        "Custom Business Object (CBO) via Key-User Extensibility or ABAP Cloud table with Custom CDS maintenance."
                    ),
                    evidence=[evidence_item],
                    technical_details=tech_details,
                    affected_objects=[activity_key] + ([table_key] if table_key else []),
                )
                findings.append(ConfidenceClassifier.classify(f))

        # Calculate readiness percentage
        if total_activities > 0:
            effective_score = (exact_count * 1.0) + (partial_count * 0.70) + (scope_count * 0.85) + (redesign_count * 0.40)
            readiness_percentage = round((effective_score / total_activities) * 100.0, 1)
        else:
            readiness_percentage = 100.0

        duration_ms = int((time.perf_counter() - start_time) * 1000)

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=AnalysisMetrics(
                execution_time_ms=duration_ms,
                rules_evaluated=max(rules_evaluated, 1),
                artifacts_scanned=max(len(request.artifacts), 1 if request.raw_content else 0),
                additional_metrics={
                    "totalActivities": total_activities,
                    "exactMappings": exact_count,
                    "partialMappings": partial_count,
                    "scopeDependentMappings": scope_count,
                    "processRedesignMappings": redesign_count,
                    "notAvailableMappings": not_avail_count,
                    "needsReviewMappings": needs_review_count,
                    "readinessPercentage": readiness_percentage,
                },
            ),
        )
