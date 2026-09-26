"""
ECC2Cloud Navigator Preflight Engine: Feature 23
Author: m3_d2_explorer_1
Domain: Migration & Clean Core / Legacy Landscape Migration Feasibility

Assesses legacy ECC environments across:
- Transaction Codes (T-Codes) & ST03N execution usage logs
- Interface inventories (RFC, BAPI, IDoc, Web Services)
- Custom code objects (TADIR)

Maps legacy components to SAP S/4HANA Cloud Public Edition successors (Fiori apps,
released Contract C1 APIs, SAP Event Mesh CloudEvents), computes usage-weighted
blocker ranking, and assigns Clean Core extensibility tiers (Tier 1, Tier 2, Tier 3).

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
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

from src.core.base_engine import BaseEngine
from src.core.contracts import (
    ContractModel, InputContract, InputFormat, RuleSpec, insufficient, rule_catalog,
)
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
from src.core.exceptions import EngineInputError


# ============================================================================
# 1. DOMAIN MODELS & SCHEMAS
# ============================================================================

class EccUsageItem(BaseModel):
    """Normalized object usage or interface entry from customer artifact."""
    object_name: str = Field(..., description="Transaction code, BAPI name, RFC function, or IDoc type")
    object_type: str = Field(default="TCODE", description="TCODE, BAPI, RFC, IDOC, PROG")
    executions: int = Field(default=1, ge=0, description="ST03N dialog steps or execution count")
    response_time_ms: Optional[float] = Field(default=None, description="Average response time in milliseconds")
    user_count: Optional[int] = Field(default=None, description="Distinct active user count")
    line_number: int = Field(1, description="1-indexed line number in source artifact")
    column_number: int = Field(1, description="1-indexed column number in source artifact")
    raw_snippet: str = Field(..., description="Verbatim raw text snippet from artifact")
    artifact_path: str = Field("input.csv", description="Relative path of artifact")


class TCodeSuccessor(BaseModel):
    """Reference Fiori application or cloud successor for a legacy T-Code."""
    tcode: str
    fiori_app_id: Optional[str]
    fiori_app_name: Optional[str]
    status: str  # DIRECTLY_SUPPORTED, SUCCESSOR_AVAILABLE, EXTENSION_REQUIRED, PROCESS_REDESIGN, NO_EQUIVALENT
    clean_core_tier: str  # TIER_1_CLOUD, TIER_2_DEVELOPER, TIER_3_CLASSIC
    scope_item: Optional[str]
    business_role: Optional[str]
    remediation_guide: str


class InterfaceSuccessor(BaseModel):
    """Reference cloud successor for a legacy RFC, BAPI, or IDoc."""
    interface_name: str
    interface_type: str  # BAPI, RFC, IDOC
    cloud_successor: str  # OData API, SOAP Service, Event Mesh Topic
    successor_type: str  # ODATA_C1, SOAP, EVENT_MESH, NONE
    released_contract_c1: bool
    status: str  # SUCCESSOR_AVAILABLE, EXTENSION_REQUIRED, PROCESS_REDESIGN, NO_EQUIVALENT
    clean_core_tier: str  # TIER_1_CLOUD, TIER_2_DEVELOPER, TIER_3_CLASSIC
    remediation_guide: str


# ============================================================================
# 2. AUTHORITATIVE SUCCESSOR REFERENCE CATALOGS
# ============================================================================

TCODE_CATALOG: Dict[str, TCodeSuccessor] = {
    # SD Transactions
    "VA01": TCodeSuccessor(
        tcode="VA01",
        fiori_app_id="F1814",
        fiori_app_name="Create Sales Orders",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="BD9",
        business_role="SAP_BR_INTERNAL_SALES_REP",
        remediation_guide="Transition end users from GUI transaction VA01 to Fiori App F1814 (Create Sales Orders). Adapt screen customizations via Key-User UI adaptation."
    ),
    "VA02": TCodeSuccessor(
        tcode="VA02",
        fiori_app_id="F3893",
        fiori_app_name="Manage Sales Orders",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="BD9",
        business_role="SAP_BR_INTERNAL_SALES_REP",
        remediation_guide="Transition to Fiori App F3893 (Manage Sales Orders). Review custom pricing routines in Cloud BAdIs."
    ),
    "VA03": TCodeSuccessor(
        tcode="VA03",
        fiori_app_id="F3893",
        fiori_app_name="Manage Sales Orders",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="BD9",
        business_role="SAP_BR_INTERNAL_SALES_REP",
        remediation_guide="Utilize Fiori App F3893 (Manage Sales Orders) or Track Sales Orders."
    ),
    "VF01": TCodeSuccessor(
        tcode="VF01",
        fiori_app_id="F0798",
        fiori_app_name="Create Billing Documents",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="BD9",
        business_role="SAP_BR_BILLING_CLERK",
        remediation_guide="Replace VF01 with Fiori App F0798 (Create Billing Documents)."
    ),
    "VL01N": TCodeSuccessor(
        tcode="VL01N",
        fiori_app_id="F2587",
        fiori_app_name="Manage Outbound Deliveries",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="BD9",
        business_role="SAP_BR_SHIPPING_SPECIALIST",
        remediation_guide="Migrate shipping workflow to Fiori App F2587 (Manage Outbound Deliveries)."
    ),
    "VL02N": TCodeSuccessor(
        tcode="VL02N",
        fiori_app_id="F2587",
        fiori_app_name="Manage Outbound Deliveries",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="BD9",
        business_role="SAP_BR_SHIPPING_SPECIALIST",
        remediation_guide="Use Fiori App F2587 for outbound delivery modification and goods issue posting."
    ),

    # MM Transactions
    "ME21N": TCodeSuccessor(
        tcode="ME21N",
        fiori_app_id="F0842A",
        fiori_app_name="Manage Purchase Orders",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="1MD",
        business_role="SAP_BR_PURCHASER",
        remediation_guide="Replace ME21N with Fiori App F0842A (Manage Purchase Orders). User exit enhancements must transition to BAdI MM_PUR_S4_PO_MODIFY_ITEM."
    ),
    "ME22N": TCodeSuccessor(
        tcode="ME22N",
        fiori_app_id="F0842A",
        fiori_app_name="Manage Purchase Orders",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="1MD",
        business_role="SAP_BR_PURCHASER",
        remediation_guide="Use Fiori App F0842A for purchase order maintenance."
    ),
    "ME23N": TCodeSuccessor(
        tcode="ME23N",
        fiori_app_id="F0842A",
        fiori_app_name="Manage Purchase Orders",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="1MD",
        business_role="SAP_BR_PURCHASER",
        remediation_guide="Display purchase orders via Fiori App F0842A."
    ),
    "MIGO": TCodeSuccessor(
        tcode="MIGO",
        fiori_app_id="F1077",
        fiori_app_name="Post Goods Receipt for Purchasing Document",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="1MD",
        business_role="SAP_BR_WAREHOUSE_CLERK",
        remediation_guide="Replace classic MIGO with Fiori App F1077 or F2101 (Manage Stock)."
    ),
    "MIRO": TCodeSuccessor(
        tcode="MIRO",
        fiori_app_id="F0859",
        fiori_app_name="Create Supplier Invoices",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="1MD",
        business_role="SAP_BR_AP_ACCOUNTANT",
        remediation_guide="Replace classic MIRO with Fiori App F0859 (Create Supplier Invoices)."
    ),
    "MM01": TCodeSuccessor(
        tcode="MM01",
        fiori_app_id="F1602",
        fiori_app_name="Manage Product Master Data",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="1MD",
        business_role="SAP_BR_PRODMASTER_SPECIALIST",
        remediation_guide="Replace classic material master creation MM01 with Fiori App F1602 (Manage Product Master Data)."
    ),
    "MM02": TCodeSuccessor(
        tcode="MM02",
        fiori_app_id="F1602",
        fiori_app_name="Manage Product Master Data",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="1MD",
        business_role="SAP_BR_PRODMASTER_SPECIALIST",
        remediation_guide="Maintain product master via Fiori App F1602."
    ),

    # FI Transactions
    "FB01": TCodeSuccessor(
        tcode="FB01",
        fiori_app_id="F0718",
        fiori_app_name="Manage G/L Account Documents",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="J58",
        business_role="SAP_BR_GL_ACCOUNTANT",
        remediation_guide="Replace classic FB01 post document with Fiori App F0718."
    ),
    "FB50": TCodeSuccessor(
        tcode="FB50",
        fiori_app_id="F0718",
        fiori_app_name="Manage G/L Account Documents",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="J58",
        business_role="SAP_BR_GL_ACCOUNTANT",
        remediation_guide="Post G/L journal entries via Fiori App F0718 or F2217 (Post General Journal Entries)."
    ),
    "FB60": TCodeSuccessor(
        tcode="FB60",
        fiori_app_id="F0859",
        fiori_app_name="Create Supplier Invoices",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="J58",
        business_role="SAP_BR_AP_ACCOUNTANT",
        remediation_guide="Post direct supplier invoices using Fiori App F0859."
    ),
    "FB70": TCodeSuccessor(
        tcode="FB70",
        fiori_app_id="F0717",
        fiori_app_name="Create Customer Invoices",
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="J58",
        business_role="SAP_BR_AR_ACCOUNTANT",
        remediation_guide="Post direct customer invoices using Fiori App F0717."
    ),

    # Obsolete Classic Business Partner Transactions
    "XD01": TCodeSuccessor(
        tcode="XD01",
        fiori_app_id="F0850A",
        fiori_app_name="Manage Business Partner",
        status="PROCESS_REDESIGN",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="J58",
        business_role="SAP_BR_BUPA_MASTER_SPECIALIST",
        remediation_guide="Classic customer transaction XD01 is obsolete. In S/4HANA Cloud, customer master data is unified under the Business Partner (BP) model using Fiori App F0850A."
    ),
    "XD02": TCodeSuccessor(
        tcode="XD02",
        fiori_app_id="F0850A",
        fiori_app_name="Manage Business Partner",
        status="PROCESS_REDESIGN",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="J58",
        business_role="SAP_BR_BUPA_MASTER_SPECIALIST",
        remediation_guide="Obsolete: Transition to Fiori App F0850A (Manage Business Partner)."
    ),
    "XK01": TCodeSuccessor(
        tcode="XK01",
        fiori_app_id="F0850A",
        fiori_app_name="Manage Business Partner",
        status="PROCESS_REDESIGN",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="J58",
        business_role="SAP_BR_BUPA_MASTER_SPECIALIST",
        remediation_guide="Classic vendor transaction XK01 is obsolete. Replaced by Business Partner (BP) Fiori App F0850A."
    ),
    "XK02": TCodeSuccessor(
        tcode="XK02",
        fiori_app_id="F0850A",
        fiori_app_name="Manage Business Partner",
        status="PROCESS_REDESIGN",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="J58",
        business_role="SAP_BR_BUPA_MASTER_SPECIALIST",
        remediation_guide="Obsolete: Transition to Fiori App F0850A (Manage Business Partner)."
    ),

    # Classic Output & Middleware Redesign
    "NACE": TCodeSuccessor(
        tcode="NACE",
        fiori_app_id="F1481",
        fiori_app_name="Output Parameter Determination",
        status="PROCESS_REDESIGN",
        clean_core_tier="TIER_1_CLOUD",
        scope_item="1LQ",
        business_role="SAP_BR_ADMINISTRATOR",
        remediation_guide="Transaction NACE (NAST condition tables) is obsolete in S/4HANA Cloud. Output determination is orchestrated via BRFplus decision tables in Fiori App F1481 (Output Parameter Determination)."
    ),

    # Prohibited Developer / Admin Workbench Tools in Public Cloud
    "SE38": TCodeSuccessor(
        tcode="SE38",
        fiori_app_id=None,
        fiori_app_name=None,
        status="NO_EQUIVALENT",
        clean_core_tier="TIER_3_CLASSIC",
        scope_item=None,
        business_role=None,
        remediation_guide="Direct classic ABAP editor SE38 is strictly prohibited in S/4HANA Cloud Public Edition. Development must occur in ABAP Development Tools (ADT) in Eclipse using strictly released ABAP Cloud APIs."
    ),
    "SE80": TCodeSuccessor(
        tcode="SE80",
        fiori_app_id=None,
        fiori_app_name=None,
        status="NO_EQUIVALENT",
        clean_core_tier="TIER_3_CLASSIC",
        scope_item=None,
        business_role=None,
        remediation_guide="ABAP Workbench SE80 is strictly prohibited in Public Cloud. Use ADT in Eclipse."
    ),
    "SE16": TCodeSuccessor(
        tcode="SE16",
        fiori_app_id=None,
        fiori_app_name=None,
        status="NO_EQUIVALENT",
        clean_core_tier="TIER_3_CLASSIC",
        scope_item=None,
        business_role=None,
        remediation_guide="Direct data browser SE16 is prohibited in Public Cloud. Data querying must use released Core Data Services (CDS) Views exposed as Analytical Queries or OData APIs."
    ),
    "SE16N": TCodeSuccessor(
        tcode="SE16N",
        fiori_app_id=None,
        fiori_app_name=None,
        status="NO_EQUIVALENT",
        clean_core_tier="TIER_3_CLASSIC",
        scope_item=None,
        business_role=None,
        remediation_guide="General Table Display SE16N is strictly prohibited in Public Cloud. Use released CDS views."
    ),
    "SM30": TCodeSuccessor(
        tcode="SM30",
        fiori_app_id=None,
        fiori_app_name=None,
        status="NO_EQUIVALENT",
        clean_core_tier="TIER_3_CLASSIC",
        scope_item=None,
        business_role=None,
        remediation_guide="Direct table maintenance SM30 is prohibited in Public Cloud. Create a Custom Business Object (CBO) or ABAP Cloud RAP business object with dedicated Fiori maintenance UI."
    ),
}

INTERFACE_CATALOG: Dict[str, InterfaceSuccessor] = {
    # -------------------------------------------------------------------------
    # RFC / BAPIs
    # -------------------------------------------------------------------------
    "BAPI_SALESORDER_CREATEFROMDAT2": InterfaceSuccessor(
        interface_name="BAPI_SALESORDER_CREATEFROMDAT2",
        interface_type="BAPI",
        cloud_successor="API_SALES_ORDER_SRV (A_SalesOrder)",
        successor_type="ODATA_C1",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="Replace classic RFC BAPI with released OData service API_SALES_ORDER_SRV. Supports create, read, update, and deep entity structures."
    ),
    "BAPI_PO_CREATE1": InterfaceSuccessor(
        interface_name="BAPI_PO_CREATE1",
        interface_type="BAPI",
        cloud_successor="API_PURCHASEORDER_PROCESS_SRV (A_PurchaseOrder)",
        successor_type="ODATA_C1",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="Replace BAPI_PO_CREATE1 with released OData API API_PURCHASEORDER_PROCESS_SRV."
    ),
    "BAPI_MATERIAL_SAVEDATA": InterfaceSuccessor(
        interface_name="BAPI_MATERIAL_SAVEDATA",
        interface_type="BAPI",
        cloud_successor="API_PRODUCT_SRV (A_Product)",
        successor_type="ODATA_C1",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="Transition product master replication to released OData API API_PRODUCT_SRV."
    ),
    "BAPI_INCOMINGINVOICE_CREATE": InterfaceSuccessor(
        interface_name="BAPI_INCOMINGINVOICE_CREATE",
        interface_type="BAPI",
        cloud_successor="API_SUPPLIERINVOICE_PROCESS_SRV",
        successor_type="ODATA_C1",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="Replace invoice BAPI with released supplier invoice OData API."
    ),
    "BAPI_OUTBOUNDDELIVERY_CREATENOREF": InterfaceSuccessor(
        interface_name="BAPI_OUTBOUNDDELIVERY_CREATENOREF",
        interface_type="BAPI",
        cloud_successor="API_OUTBOUND_DELIVERY_SRV",
        successor_type="ODATA_C1",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="Replace with released delivery service API_OUTBOUND_DELIVERY_SRV."
    ),
    "RFC_READ_TABLE": InterfaceSuccessor(
        interface_name="RFC_READ_TABLE",
        interface_type="RFC",
        cloud_successor="Released CDS Views via OData / SQL Service",
        successor_type="NONE",
        released_contract_c1=False,
        status="NO_EQUIVALENT",
        clean_core_tier="TIER_3_CLASSIC",
        remediation_guide="RFC_READ_TABLE is a critical security risk and strictly prohibited in S/4HANA Cloud Public Edition. Extract data via released CDS views or SAP Datasphere."
    ),
    "ABAP4_CALL_TRANSACTION": InterfaceSuccessor(
        interface_name="ABAP4_CALL_TRANSACTION",
        interface_type="RFC",
        cloud_successor="Released OData / Business APIs",
        successor_type="NONE",
        released_contract_c1=False,
        status="NO_EQUIVALENT",
        clean_core_tier="TIER_3_CLASSIC",
        remediation_guide="Dynpro batch input via RFC is prohibited. Replace with released OData APIs or SOAP web services."
    ),

    # -------------------------------------------------------------------------
    # IDocs
    # -------------------------------------------------------------------------
    "ORDERS05": InterfaceSuccessor(
        interface_name="ORDERS05",
        interface_type="IDOC",
        cloud_successor="SOAP Service 'OrderRequest_In' / SAP Event Mesh",
        successor_type="EVENT_MESH",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="Modernize ORDERS05 IDoc interface using standard SOAP API OrderRequest_In or subscribe to CloudEvent 'sap.s4.beh.salesorder.v1.SalesOrder.Created.v1' on SAP Event Mesh."
    ),
    "INVOIC02": InterfaceSuccessor(
        interface_name="INVOIC02",
        interface_type="IDOC",
        cloud_successor="SOAP Service 'InvoiceRequest_In' / SAP Event Mesh",
        successor_type="EVENT_MESH",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="Replace INVOIC02 with standard EDI/SOAP service InvoiceRequest_In or Event Mesh billing events."
    ),
    "DESADV01": InterfaceSuccessor(
        interface_name="DESADV01",
        interface_type="IDOC",
        cloud_successor="SOAP Service 'DeliveryRequest_In' / SAP Event Mesh",
        successor_type="EVENT_MESH",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="Replace DESADV01 with DeliveryRequest_In or Event Mesh outbound delivery notifications."
    ),
    "DEBMAS06": InterfaceSuccessor(
        interface_name="DEBMAS06",
        interface_type="IDOC",
        cloud_successor="SOAP 'BusinessPartnerSUITEBulkReplicationRequest_In'",
        successor_type="SOAP",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="DEBMAS customer replication is obsolete. Replaced by Business Partner SOAP bulk replication."
    ),
    "CREMAS05": InterfaceSuccessor(
        interface_name="CREMAS05",
        interface_type="IDOC",
        cloud_successor="SOAP 'BusinessPartnerSUITEBulkReplicationRequest_In'",
        successor_type="SOAP",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="CREMAS vendor replication is obsolete. Replaced by Business Partner SOAP bulk replication."
    ),
    "MATMAS05": InterfaceSuccessor(
        interface_name="MATMAS05",
        interface_type="IDOC",
        cloud_successor="SOAP 'ProductMasterBulkReplicationRequest_In' / Event Mesh",
        successor_type="EVENT_MESH",
        released_contract_c1=True,
        status="SUCCESSOR_AVAILABLE",
        clean_core_tier="TIER_1_CLOUD",
        remediation_guide="Modernize MATMAS05 to ProductMaster SOAP service or Event Mesh topic sap.s4.beh.product.v1.Product.Created.v1."
    ),
}


# ============================================================================
# 3. DETERMINISTIC PARSER & LINE TRACKER
# ============================================================================

class EccArtifactParser:
    """Deterministic parser for ST03N usage logs, transaction inventories, and interface exports."""

    @classmethod
    def parse(cls, content: str, artifact_path: str = "input.csv") -> List[EccUsageItem]:
        items: List[EccUsageItem] = []
        clean = content.strip()
        if not clean:
            return items

        # Case 1: JSON payload
        if clean.startswith("[") or clean.startswith("{"):
            try:
                data = json.loads(clean)
                lines = content.splitlines()
                raw_list = data if isinstance(data, list) else (data.get("items") or data.get("usage") or data.get("objects") or [data])
                for idx, row in enumerate(raw_list, start=1):
                    if isinstance(row, dict):
                        name = str(row.get("object_name") or row.get("tcode") or row.get("transaction") or row.get("name") or row.get("interface") or "").strip()
                        obj_type = str(row.get("object_type") or row.get("type") or "TCODE").strip().upper()
                        execs = int(row.get("executions") or row.get("steps") or row.get("dialog_steps") or row.get("count") or 1)
                        resp_time = float(row.get("response_time_ms") or row.get("avg_resp_time") or 0.0) if ("response_time_ms" in row or "avg_resp_time" in row) else None
                        users = int(row.get("user_count") or row.get("users") or 0) if ("user_count" in row or "users" in row) else None
                        
                        line_num = min(idx, len(lines))
                        snippet = lines[line_num - 1] if line_num <= len(lines) else json.dumps(row)
                        if name:
                            items.append(EccUsageItem(
                                object_name=name,
                                object_type=obj_type,
                                executions=max(0, execs),
                                response_time_ms=resp_time,
                                user_count=users,
                                line_number=line_num,
                                column_number=1,
                                raw_snippet=snippet,
                                artifact_path=artifact_path,
                            ))
                return items
            except (ValueError, RecursionError, TypeError, AttributeError):
                # Malformed JSON is never re-read as CSV lines; the contract reports ECC_PARSE_ERROR.
                return []

        # Case 2: Delimited CSV / TSV
        sample_line = next((line_item for line_item in clean.splitlines() if not line_item.strip().startswith("#") and line_item.strip()), (clean.splitlines()[0] if clean.splitlines() else ""))
        delimiter = "\t" if "\t" in sample_line else ("," if "," in sample_line else None)
        lines = content.splitlines()

        if delimiter:
            reader = csv.reader(io.StringIO(content), delimiter=delimiter)
            header: Optional[List[str]] = None
            name_idx, type_idx, exec_idx, resp_idx, user_idx = 0, -1, -1, -1, -1

            for line_idx, row in enumerate(reader, start=1):
                if not row or all(not cell.strip() for cell in row):
                    continue
                if row[0].strip().startswith("#"):
                    continue
                snippet = lines[line_idx - 1] if line_idx <= len(lines) else ",".join(row)

                # Header detection
                if header is None and any(term in "".join(row).lower() for term in ["tcode", "transaction", "object_name", "object_type", "interface_name", "execution_count", "dialog_steps"]):
                    header = [c.strip().lower() for c in row]
                    for col_idx, col_name in enumerate(header):
                        if any(k in col_name for k in ["user_count", "users", "user"]):
                            user_idx = col_idx
                        elif any(k in col_name for k in ["object_type", "type"]):
                            type_idx = col_idx
                        elif any(k in col_name for k in ["tcode", "transaction", "object_name", "interface_name", "name"]) or col_name == "object":
                            name_idx = col_idx
                        elif any(k in col_name for k in ["executions", "steps", "dialog_steps", "usage"]) or col_name == "count" or "exec" in col_name:
                            exec_idx = col_idx
                        elif any(k in col_name for k in ["response_time", "resp_time", "resptime", "responsetime", "response"]):
                            resp_idx = col_idx
                    continue

                # Data row
                name = row[name_idx].strip() if 0 <= name_idx < len(row) else ""
                obj_type = row[type_idx].strip().upper() if 0 <= type_idx < len(row) else ""
                
                # Infer object type if not explicit
                if not obj_type:
                    if name.startswith("BAPI_"):
                        obj_type = "BAPI"
                    elif name.startswith("RFC_") or "RFC" in name:
                        obj_type = "RFC"
                    elif any(name.startswith(p) for p in ["ORDERS", "INVOIC", "DESADV", "DEBMAS", "CREMAS", "MATMAS"]):
                        obj_type = "IDOC"
                    else:
                        obj_type = "TCODE"

                exec_val = 1
                if 0 <= exec_idx < len(row):
                    try:
                        clean_num = "".join(ch for ch in row[exec_idx] if ch.isdigit() or ch == ".")
                        exec_val = int(float(clean_num)) if clean_num else 1
                    except Exception:
                        exec_val = 1
                elif header is None and len(row) > 1:
                    try:
                        clean_num = "".join(ch for ch in row[1] if ch.isdigit() or ch == ".")
                        if clean_num:
                            exec_val = int(float(clean_num))
                    except Exception:
                        pass

                resp_val = None
                if 0 <= resp_idx < len(row):
                    try:
                        resp_val = float(row[resp_idx].strip())
                    except Exception:
                        pass
                elif header is None and len(row) > 2:
                    try:
                        resp_val = float(row[2].strip())
                    except Exception:
                        pass

                user_val = None
                if 0 <= user_idx < len(row):
                    try:
                        user_val = int(row[user_idx].strip())
                    except Exception:
                        pass
                elif header is None and len(row) > 3:
                    try:
                        user_val = int(row[3].strip())
                    except Exception:
                        pass

                if name:
                    items.append(EccUsageItem(
                        object_name=name,
                        object_type=obj_type,
                        executions=max(0, exec_val),
                        response_time_ms=resp_val,
                        user_count=user_val,
                        line_number=line_idx,
                        column_number=1,
                        raw_snippet=snippet,
                        artifact_path=artifact_path,
                    ))
        else:
            # Single object per line
            for line_idx, line in enumerate(lines, start=1):
                val = line.strip()
                if not val or val.startswith("#"):
                    continue
                # Split whitespace if format is: TCODE EXEC_COUNT
                parts = val.split()
                obj_name = parts[0]
                exec_val = 1
                if len(parts) > 1 and parts[1].isdigit():
                    exec_val = int(parts[1])

                obj_type = "TCODE"
                if obj_name.startswith("BAPI_"):
                    obj_type = "BAPI"
                elif obj_name.startswith("RFC_"):
                    obj_type = "RFC"
                elif any(obj_name.startswith(p) for p in ["ORDERS", "INVOIC", "DESADV", "DEBMAS", "CREMAS", "MATMAS"]):
                    obj_type = "IDOC"

                items.append(EccUsageItem(
                    object_name=obj_name,
                    object_type=obj_type,
                    executions=exec_val,
                    response_time_ms=None,
                    user_count=None,
                    line_number=line_idx,
                    column_number=1,
                    raw_snippet=line,
                    artifact_path=artifact_path,
                ))

        return items


# ============================================================================
# 4. ECC2CLOUD NAVIGATOR ENGINE IMPLEMENTATION
# ============================================================================

# ==== ENGINE CONTRACT (rule catalog + input contract) ====
from pydantic import model_validator

RULES = rule_catalog(
    RuleSpec(
        "ECC_TCODE_SUCCESSOR_FOUND", "Fiori / cloud successor available for transaction", Severity.INFO,
        "Plan user adoption of the listed Fiori successor app and assign the business role/catalog; retire the "
        "classic transaction from roles.", "Fiori Modernization",
    ),
    RuleSpec(
        "ECC_TCODE_OBSOLETE_REDESIGN", "Transaction requires process redesign or is not in the cloud catalog",
        Severity.MAJOR,
        "Run a fit-to-standard workshop for the process behind the transaction; map it to the named successor "
        "concept or a standard Fiori app, otherwise to a BTP extension.", "Process Redesign",
    ),
    RuleSpec(
        "ECC_TCODE_NO_EQUIVALENT_BLOCKER", "Classic transaction prohibited in S/4HANA Cloud", Severity.BLOCKER,
        "The transaction (e.g. SE38, SM30-based maintenance) has no cloud equivalent; move the use case to ADT / "
        "ABAP Cloud development, key-user apps or SAP BTP.", "Migration Blocker",
    ),
    RuleSpec(
        "ECC_TCODE_CUSTOM_CODE_REVIEW", "Custom Z/Y transaction needs Clean Core review", Severity.MAJOR,
        "Re-implement the custom dynpro as a RAP-based Fiori Elements app in ABAP Cloud (tier 1) or a BTP "
        "side-by-side extension; run the Clean Core Object Guard on its source.", "Clean Core Custom Code",
    ),
    RuleSpec(
        "ECC_BAPI_RFC_MODERNIZATION_FOUND", "Released API successor for BAPI/RFC interface", Severity.INFO,
        "Re-point the integration to the listed released OData/SOAP API (Communication Arrangement) before "
        "cut-over.", "Interface Modernization",
    ),
    RuleSpec(
        "ECC_BAPI_RFC_UNRELEASED_BLOCKER", "Unreleased BAPI / RFC interface", Severity.MAJOR,
        "Unreleased RFC/BAPI calls are not permitted from outside in S/4HANA Cloud; migrate the caller to a "
        "released API (api.sap.com) or wrap the logic in a custom released OData service.",
        "Interface Modernization",
    ),
    RuleSpec(
        "ECC_IDOC_MODERNIZATION_EVENT_MESH", "IDoc interface has an event / API successor", Severity.INFO,
        "Replace the IDoc with the listed business event (SAP Event Mesh / Advanced Event Mesh) or released API "
        "and adapt the middleware mapping.", "Interface Modernization",
    ),
    RuleSpec(
        "ECC_IDOC_UNSUPPORTED_BLOCKER", "IDoc type not supported in the cloud target", Severity.BLOCKER,
        "Redesign the integration with a released API or event; the IDoc basic type cannot be used in the target "
        "edition.", "Interface Modernization",
    ),
)

_ECC_NAME_KEYS = ("object_name", "tcode", "transaction", "name", "interface")


class EccUsageInput(ContractModel):
    """ST03N usage / interface inventory as JSON rows (list, or {'items'|'usage'|'objects': [...]})."""
    items: Optional[List[Any]] = None
    usage: Optional[List[Any]] = None
    objects: Optional[List[Any]] = None

    @model_validator(mode="after")
    def _require_objects(self) -> "EccUsageInput":
        rows = self.items or self.usage or self.objects or [self.model_extra or {}]
        for row in rows:
            if isinstance(row, dict) and any(str(row.get(k) or "").strip() for k in _ECC_NAME_KEYS):
                return self
        raise insufficient(
            "No transactions or interfaces found: each row needs 'tcode' / 'transaction' / 'object_name' / "
            "'name' / 'interface'."
        )


_ECC_LINE = re.compile(r"^[A-Za-z0-9_/]{2,60}(\s+\d+)?$")


def _ecc_text_check(text: str) -> Optional[str]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    if not lines:
        return "no transaction codes found."
    bad = next((i for i, ln in enumerate(lines, 1) if not _ECC_LINE.match(ln)), None)
    if bad is not None:
        return (
            "plain-text input must list one transaction code / interface name per line, optionally followed by "
            f"an execution count (line {bad} does not match)."
        )
    return None


INPUT_CONTRACT = InputContract(
    formats=(InputFormat.CSV, InputFormat.JSON, InputFormat.TEXT),
    summary=(
        "ST03N / SUIM usage export: CSV with a TCode / Transaction / object_name column (optional "
        "ExecutionCount, AvgResponseTimeMs, UserCount), interface inventory JSON rows {name, type, executions}, "
        "or 'TCODE [count]' lines."
    ),
    required=("At least one transaction code or interface name",),
    json_model=EccUsageInput,
    json_array_field="items",
    csv_signal_columns=("TCode", "Transaction", "object_name", "interface_name", "name", "object", "Report"),
    text_check=_ecc_text_check,
)


# ==== END ENGINE CONTRACT ====


@register_engine
class ECC2CloudEngine(BaseEngine):
    engine_type = EngineType.ECC2CLOUD_NAVIGATOR
    rule_prefix = "ECC"
    finding_codes = RULES
    input_contract = INPUT_CONTRACT
    name = "ECC2Cloud Navigator"
    description = "Custom code remediation, obsolete transaction / table migration roadmap"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.CSV, ArtifactType.JSON]

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        rules_evaluated = 0

        # Step 1: Parse input artifacts
        raw_items: List[EccUsageItem] = []
        if request.raw_content:
            raw_items.extend(EccArtifactParser.parse(request.raw_content, "raw_content"))

        for art in request.artifacts:
            if art.raw_content:
                raw_items.extend(EccArtifactParser.parse(art.raw_content, art.file_name))

        if not raw_items:
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "No transactions or interfaces could be read from the payload; no migration verdict produced.",
            )

        # Metrics counters
        total_objects = len(raw_items)
        tcodes_count = 0
        interfaces_count = 0
        total_executions = 0
        blocker_count = 0
        redesign_count = 0
        extension_count = 0
        cloud_ready_count = 0
        tier1_count = 0
        tier2_count = 0
        tier3_count = 0

        # Temporary findings with impact score for deterministic sorting
        scored_findings: List[Tuple[float, Finding]] = []

        # Step 2: Pure deterministic evaluation loop
        for item in raw_items:
            rules_evaluated += 5
            obj_name = item.object_name.strip().upper()
            total_executions += item.executions

            snippet_str = item.raw_snippet.strip() or obj_name
            sha256_hash = hashlib.sha256(snippet_str.encode("utf-8")).hexdigest()

            evidence_item = Evidence(
                artifact_path=item.artifact_path,
                line_number=item.line_number,
                column_number=item.column_number,
                snippet=snippet_str,
                sha256=sha256_hash,
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
                trust_score=1.0,
            )

            # Check if object is an Interface (BAPI, RFC, IDOC)
            if item.object_type in ("BAPI", "RFC", "IDOC") or obj_name in INTERFACE_CATALOG:
                interfaces_count += 1
                if obj_name in INTERFACE_CATALOG:
                    iface = INTERFACE_CATALOG[obj_name]
                    status = iface.status
                    clean_core_tier = iface.clean_core_tier

                    # Criticality weight calculation
                    crit_weight = 1.0 if status == "NO_EQUIVALENT" else (0.7 if status == "PROCESS_REDESIGN" else (0.5 if status == "EXTENSION_REQUIRED" else 0.2))
                    impact_score = item.executions * crit_weight

                    if clean_core_tier == "TIER_1_CLOUD":
                        tier1_count += 1
                    elif clean_core_tier == "TIER_2_DEVELOPER":
                        tier2_count += 1
                    else:
                        tier3_count += 1

                    tech_details = {
                        "interfaceName": iface.interface_name,
                        "interfaceType": iface.interface_type,
                        "cloudSuccessor": iface.cloud_successor,
                        "successorType": iface.successor_type,
                        "releasedContractC1": iface.released_contract_c1,
                        "cleanCoreTier": clean_core_tier,
                        "st03nExecutions": item.executions,
                        "impactScore": impact_score,
                    }

                    if status == "SUCCESSOR_AVAILABLE":
                        cloud_ready_count += 1
                        rule_code = "ECC_BAPI_RFC_MODERNIZATION_FOUND" if iface.interface_type in ("BAPI", "RFC") else "ECC_IDOC_MODERNIZATION_EVENT_MESH"
                        title = f"Cloud Modernization Available for {iface.interface_type} '{iface.interface_name}'"
                        desc = f"{iface.interface_type} '{iface.interface_name}' maps to released Cloud successor: {iface.cloud_successor}."
                        sev = Severity.INFO
                        conf = ConfidenceClass.VERIFIED
                        conf_score = 1.0

                    elif status == "NO_EQUIVALENT":
                        blocker_count += 1
                        rule_code = "ECC_BAPI_RFC_UNRELEASED_BLOCKER"
                        title = f"Prohibited Interface Blocker: '{iface.interface_name}'"
                        desc = f"{iface.interface_type} '{iface.interface_name}' is strictly prohibited in S/4HANA Cloud Public Edition."
                        sev = Severity.BLOCKER if item.executions >= 10000 else Severity.CRITICAL
                        conf = ConfidenceClass.VERIFIED
                        conf_score = 1.0

                    else:
                        redesign_count += 1
                        rule_code = "ECC_IDOC_UNSUPPORTED_BLOCKER"
                        title = f"Interface Process Redesign: '{iface.interface_name}'"
                        desc = f"Interface '{iface.interface_name}' requires integration modernization via SAP Cloud Integration."
                        sev = Severity.MAJOR
                        conf = ConfidenceClass.RULE_DERIVED
                        conf_score = 0.85

                    f = Finding(
                        rule_id=rule_code,
                        severity=sev,
                        category="Interface Modernization",
                        title=title,
                        description=desc,
                        confidence=conf,
                        confidence_score=conf_score,
                        remediation=iface.remediation_guide,
                        evidence=[evidence_item],
                        technical_details=tech_details,
                        affected_objects=[iface.interface_name],
                    )
                    scored_findings.append((impact_score, ConfidenceClassifier.classify(f)))
                else:
                    # Uncataloged Custom Interface
                    extension_count += 1
                    tier3_count += 1
                    impact_score = item.executions * 0.5
                    tech_details = {
                        "interfaceName": obj_name,
                        "interfaceType": item.object_type,
                        "cleanCoreTier": "TIER_3_CLASSIC",
                        "st03nExecutions": item.executions,
                        "impactScore": impact_score,
                    }
                    f = Finding(
                        rule_id="ECC_BAPI_RFC_UNRELEASED_BLOCKER",
                        severity=Severity.MAJOR if item.executions >= 25000 else Severity.MINOR,
                        category="Custom Interface Review",
                        title=f"Uncataloged Custom Interface '{obj_name}' Requires Modernization",
                        description=f"Interface '{obj_name}' ({item.object_type}) must be reviewed for ABAP Cloud C1 contract compatibility.",
                        confidence=ConfidenceClass.UNKNOWN,
                        confidence_score=0.30,
                        remediation="Expose custom functionality as released OData API (Contract C1) or refactor into SAP BTP side-by-side extension.",
                        evidence=[evidence_item],
                        technical_details=tech_details,
                        affected_objects=[obj_name],
                    )
                    scored_findings.append((impact_score, ConfidenceClassifier.classify(f)))

            # Otherwise, evaluate as Transaction Code (T-Code)
            else:
                tcodes_count += 1
                is_custom_tcode = obj_name.startswith("Z") or obj_name.startswith("Y")

                if obj_name in TCODE_CATALOG:
                    succ = TCODE_CATALOG[obj_name]
                    status = succ.status
                    clean_core_tier = succ.clean_core_tier

                    crit_weight = 1.0 if status == "NO_EQUIVALENT" else (0.7 if status == "PROCESS_REDESIGN" else (0.5 if status == "EXTENSION_REQUIRED" else 0.2))
                    impact_score = item.executions * crit_weight

                    if clean_core_tier == "TIER_1_CLOUD":
                        tier1_count += 1
                    elif clean_core_tier == "TIER_2_DEVELOPER":
                        tier2_count += 1
                    else:
                        tier3_count += 1

                    tech_details = {
                        "tcode": succ.tcode,
                        "fioriAppId": succ.fiori_app_id or "N/A",
                        "fioriAppName": succ.fiori_app_name or "N/A",
                        "status": status,
                        "cleanCoreTier": clean_core_tier,
                        "scopeItem": succ.scope_item or "N/A",
                        "businessRole": succ.business_role or "N/A",
                        "st03nExecutions": item.executions,
                        "impactScore": impact_score,
                    }

                    if status == "SUCCESSOR_AVAILABLE":
                        cloud_ready_count += 1
                        f = Finding(
                            rule_id="ECC_TCODE_SUCCESSOR_FOUND",
                            severity=Severity.INFO,
                            category="Fiori Modernization",
                            title=f"Fiori Successor Available for {succ.tcode}",
                            description=f"Transaction {succ.tcode} is replaced by Fiori App {succ.fiori_app_id} ({succ.fiori_app_name}).",
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=succ.remediation_guide,
                            evidence=[evidence_item],
                            technical_details=tech_details,
                            affected_objects=[succ.tcode],
                        )
                        scored_findings.append((impact_score, ConfidenceClassifier.classify(f)))

                    elif status == "PROCESS_REDESIGN":
                        redesign_count += 1
                        sev = Severity.CRITICAL if item.executions >= 50000 else Severity.MAJOR
                        f = Finding(
                            rule_id="ECC_TCODE_OBSOLETE_REDESIGN",
                            severity=sev,
                            category="Process Redesign",
                            title=f"Process Redesign Required for {succ.tcode}",
                            description=f"Transaction {succ.tcode} is obsolete in Cloud. Replaced by {succ.fiori_app_name} ({succ.fiori_app_id}).",
                            confidence=ConfidenceClass.RULE_DERIVED,
                            confidence_score=0.85,
                            remediation=succ.remediation_guide,
                            evidence=[evidence_item],
                            technical_details=tech_details,
                            affected_objects=[succ.tcode],
                        )
                        scored_findings.append((impact_score, ConfidenceClassifier.classify(f)))

                    elif status == "NO_EQUIVALENT":
                        blocker_count += 1
                        sev = Severity.BLOCKER if item.executions >= 10000 else Severity.CRITICAL
                        f = Finding(
                            rule_id="ECC_TCODE_NO_EQUIVALENT_BLOCKER",
                            severity=sev,
                            category="Migration Blocker",
                            title=f"Prohibited Classic Transaction: {succ.tcode}",
                            description=f"Classic transaction {succ.tcode} is strictly prohibited in S/4HANA Cloud Public Edition.",
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=succ.remediation_guide,
                            evidence=[evidence_item],
                            technical_details=tech_details,
                            affected_objects=[succ.tcode],
                        )
                        scored_findings.append((impact_score, ConfidenceClassifier.classify(f)))

                elif is_custom_tcode:
                    extension_count += 1
                    tier3_count += 1
                    crit_weight = 0.5
                    impact_score = item.executions * crit_weight

                    sev = Severity.BLOCKER if item.executions >= 50000 else (Severity.MAJOR if item.executions >= 10000 else Severity.MINOR)
                    tech_details = {
                        "tcode": obj_name,
                        "isCustomZObject": True,
                        "cleanCoreTier": "TIER_3_CLASSIC",
                        "st03nExecutions": item.executions,
                        "impactScore": impact_score,
                    }

                    f = Finding(
                        rule_id="ECC_TCODE_CUSTOM_CODE_REVIEW",
                        severity=sev,
                        category="Clean Core Custom Code",
                        title=f"Custom Transaction Review Required: {obj_name}",
                        description=f"Custom transaction {obj_name} with {item.executions:,} executions requires Clean Core ABAP Cloud remediation.",
                        confidence=ConfidenceClass.UNKNOWN,
                        confidence_score=0.30,  # Epistemic honesty: uncataloged custom Z-objects demoted to 0.30
                        remediation="Analyze custom dynpro logic. Re-architect using SAP Fiori Elements and RAP (RESTful Application Programming Model) adhering to ABAP Cloud language version.",
                        evidence=[evidence_item],
                        technical_details=tech_details,
                        affected_objects=[obj_name],
                    )
                    scored_findings.append((impact_score, ConfidenceClassifier.classify(f)))

                else:
                    # Uncataloged Standard ECC T-Code
                    redesign_count += 1
                    tier2_count += 1
                    crit_weight = 0.4
                    impact_score = item.executions * crit_weight
                    tech_details = {
                        "tcode": obj_name,
                        "isCustomZObject": False,
                        "cleanCoreTier": "TIER_2_DEVELOPER",
                        "st03nExecutions": item.executions,
                        "impactScore": impact_score,
                    }
                    f = Finding(
                        rule_id="ECC_TCODE_OBSOLETE_REDESIGN",
                        severity=Severity.MAJOR if item.executions >= 20000 else Severity.MINOR,
                        category="Uncataloged Standard Transaction",
                        title=f"Standard ECC Transaction {obj_name} Not in Public Cloud Catalog",
                        description=f"Transaction {obj_name} is not directly registered in Cloud Fiori reference catalog. Fit-to-Standard assessment required.",
                        confidence=ConfidenceClass.RULE_DERIVED,
                        confidence_score=0.85,
                        remediation="Evaluate business requirement in Fit-to-Standard workshops to identify modern standard Fiori app or SAP BTP extension.",
                        evidence=[evidence_item],
                        technical_details=tech_details,
                        affected_objects=[obj_name],
                    )
                    scored_findings.append((impact_score, ConfidenceClassifier.classify(f)))

        # Step 3: Usage-Weighted Blocker Ranking (Deterministic Sorting)
        # Severity ranking order for stable secondary sort
        sev_rank = {
            Severity.BLOCKER: 5,
            Severity.CRITICAL: 4,
            Severity.MAJOR: 3,
            Severity.MINOR: 2,
            Severity.INFO: 1,
        }

        # Sort key: (-impact_score, -sev_rank, affected_object_id)
        scored_findings.sort(
            key=lambda tup: (
                -tup[0],
                -sev_rank.get(tup[1].severity, 0),
                tup[1].affected_objects[0] if tup[1].affected_objects else "",
            )
        )

        sorted_findings = [tup[1] for tup in scored_findings]

        # Calculate Cloud Ready Percentage
        if total_objects > 0:
            cloud_ready_percentage = round((cloud_ready_count / total_objects) * 100.0, 1)
        else:
            cloud_ready_percentage = 100.0

        duration_ms = int((time.perf_counter() - start_time) * 1000)

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=sorted_findings,
            metrics=AnalysisMetrics(
                execution_time_ms=duration_ms,
                rules_evaluated=max(rules_evaluated, 1),
                artifacts_scanned=max(len(request.artifacts), 1 if request.raw_content else 0),
                additional_metrics={
                    "totalObjectsAnalyzed": total_objects,
                    "tcodesAnalyzed": tcodes_count,
                    "interfacesAnalyzed": interfaces_count,
                    "totalSt03nExecutions": total_executions,
                    "cloudReadyPercentage": cloud_ready_percentage,
                    "blockerCount": blocker_count,
                    "redesignCount": redesign_count,
                    "extensionCount": extension_count,
                    "cleanCoreTier1Count": tier1_count,
                    "cleanCoreTier2Count": tier2_count,
                    "cleanCoreTier3Count": tier3_count,
                },
            ),
        )
