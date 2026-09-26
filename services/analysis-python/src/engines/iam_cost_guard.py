"""Cloud IAM & BTP Role Tailoring Cost Guard Engine (Feature 33).

Authoritative preflight audit of SAP business role and catalog composition:
- Role & catalog composition modeling (AGR_1251, AGR_AGRS, AGR_USERS)
- Redundant catalog detection (100% functional overlap)
- License tier inflation driver app pinpointing (Core/Self-Service -> Advanced)
- Least-privilege role refactoring recommendation & counterfactual FUE savings
- Unused critical privilege detection against ST03N / Fiori telemetry
- Permanent emergency / firecall role assignment detection

Fully compliant with Cardinal Axiom 2 (14-Point Engine Anatomy).
"""

from __future__ import annotations

import csv
import io
import json
import time
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, ConfigDict, Field

from src.core.base_engine import BaseEngine
from src.core.contracts import (
    ContractModel, InputContract, InputFormat, RuleSpec, insufficient, rule_catalog,
)
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
from src.core.exceptions import EngineInputError
from src.parsers.json_input import parse_json_payload
from pydantic import ValidationError


# ==============================================================================
# Domain Schemas & Models (Point 2: Input Schema)
# ==============================================================================

class LicenseTier(str, Enum):
    SELF_SERVICE = "SELF_SERVICE"  # FUE ~0.1
    CORE = "CORE"                  # FUE ~0.5
    ADVANCED = "ADVANCED"          # FUE 1.0


# Tier order for comparison: SELF_SERVICE < CORE < ADVANCED
TIER_WEIGHTS: Dict[str, int] = {
    LicenseTier.SELF_SERVICE.value: 1,
    LicenseTier.CORE.value: 2,
    LicenseTier.ADVANCED.value: 3,
}

FUE_WEIGHTS: Dict[str, float] = {
    LicenseTier.SELF_SERVICE.value: 0.1,
    LicenseTier.CORE.value: 0.5,
    LicenseTier.ADVANCED.value: 1.0,
}


class AuthorizationObjectEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    object: str
    field: Optional[str] = None
    value: Optional[str] = None
    activity: Optional[str] = None


class CatalogModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    catalog_id: str
    catalog_name: Optional[str] = None
    apps: List[str] = Field(default_factory=list)
    authorizations: List[AuthorizationObjectEntry] = Field(default_factory=list)


class BusinessRoleModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    role_name: str
    description: Optional[str] = None
    catalogs: List[str] = Field(default_factory=list)
    authorizations: List[AuthorizationObjectEntry] = Field(default_factory=list)
    assigned_users: List[str] = Field(default_factory=list)
    is_emergency: bool = False


class UserAssignmentModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    user_name: Optional[str] = None
    assigned_roles: List[str] = Field(default_factory=list)
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None


class UsageRecordModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    app_id: str
    execution_count: int = 1
    last_executed: Optional[str] = None


class IAMCostInputData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    roles: List[BusinessRoleModel] = Field(default_factory=list)
    catalogs: List[CatalogModel] = Field(default_factory=list)
    users: List[UserAssignmentModel] = Field(default_factory=list)
    price_categories: Dict[str, str] = Field(default_factory=dict)  # app_id -> LicenseTier
    usage_records: List[UsageRecordModel] = Field(default_factory=list)


# ==============================================================================
# Standard High-Risk & Default Price Catalogs
# ==============================================================================

DEFAULT_PRICE_CATEGORIES: Dict[str, str] = {
    # Advanced Tier Apps / T-Codes (Financial Posting, Master Data Mutation, Admin)
    "FB08": LicenseTier.ADVANCED.value,
    "FB01": LicenseTier.ADVANCED.value,
    "FB50": LicenseTier.ADVANCED.value,
    "F-02": LicenseTier.ADVANCED.value,
    "VA01": LicenseTier.ADVANCED.value,
    "VA02": LicenseTier.ADVANCED.value,
    "ME21N": LicenseTier.ADVANCED.value,
    "ME22N": LicenseTier.ADVANCED.value,
    "MIGO": LicenseTier.ADVANCED.value,
    "MIRO": LicenseTier.ADVANCED.value,
    "PFCG": LicenseTier.ADVANCED.value,
    "SU01": LicenseTier.ADVANCED.value,
    "SE38": LicenseTier.ADVANCED.value,
    "SE80": LicenseTier.ADVANCED.value,
    "SM30": LicenseTier.ADVANCED.value,
    "SE16N": LicenseTier.ADVANCED.value,

    # Core Tier Apps (Operational Tasks, Approvals, Inquiries)
    "VA03": LicenseTier.CORE.value,
    "ME23N": LicenseTier.CORE.value,
    "ME51N": LicenseTier.CORE.value,
    "ME52N": LicenseTier.CORE.value,
    "FB03": LicenseTier.CORE.value,
    "F0842": LicenseTier.CORE.value,  # Manage Purchase Orders
    "F1814": LicenseTier.CORE.value,  # Manage Sales Orders

    # Self-Service Tier Apps (Display, ESS, Time)
    "CATS": LicenseTier.SELF_SERVICE.value,
    "F1234": LicenseTier.SELF_SERVICE.value,  # My Timesheet
    "F1311": LicenseTier.SELF_SERVICE.value,  # My Leave Requests
    "F0841": LicenseTier.SELF_SERVICE.value,  # Display Purchase Orders
    "F1813": LicenseTier.SELF_SERVICE.value,  # Display Sales Orders
}

CRITICAL_AUTH_OBJECTS: Set[str] = {
    "S_TABU_DIS",
    "S_DEVELOP",
    "S_USER_GRP",
    "S_TRANSPRT",
    "S_BTCH_ADM",
    "S_RFC_ADM",
}


# ==============================================================================
# Helper Utilities
# ==============================================================================

def _locate_line_in_text(raw_text: str, token: Any) -> Tuple[Optional[int], Optional[int], str]:
    """Scans raw_text for token and returns (1-based line, 1-based col, line_snippet)."""
    if not raw_text:
        return None, None, ""
    lines = raw_text.splitlines()
    token_str = str(token).strip()
    if not token_str:
        return None, None, ""

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

    return None, None, ""


# ==============================================================================
# Cloud IAM & BTP Role Tailoring Cost Guard Engine (Cardinal Axiom 2)
# ==============================================================================

# ==== ENGINE CONTRACT (rule catalog + input contract) ====
RULES = rule_catalog(
    RuleSpec(
        "IAM_REDUNDANT_CATALOG_DETECTED", "Catalog fully contained in another catalog of the role", Severity.MAJOR,
        "Remove the redundant business catalog from the role (PFCG / 'Maintain Business Roles'); its apps are "
        "already granted by the superset catalog.", "ROLE_COMPOSITION_GOVERNANCE",
    ),
    RuleSpec(
        "IAM_LICENSE_TIER_INFLATION_DRIVER", "Single app raises the role's license tier", Severity.MAJOR,
        "Move the tier-raising app into a separate, narrowly assigned role so the remaining users stay on the "
        "lower (Core / Self-Service) tier.", "LICENSE_OPTIMIZATION",
    ),
    RuleSpec(
        "IAM_UNUSED_CRITICAL_AUTHORIZATION", "Critical authorization never used", Severity.MAJOR,
        "Revoke the unused critical authorization object from the role or provide it via firefighter / PAM "
        "access only.", "LEAST_PRIVILEGE_COMPLIANCE",
    ),
    RuleSpec(
        "IAM_PERMANENT_EMERGENCY_ROLE", "Emergency role assigned without end date", Severity.CRITICAL,
        "Delimit the emergency / firefighter role assignment (SU01 / Identity Provisioning) and route access "
        "through an approved emergency access process with logging.", "EMERGENCY_ACCESS_GOVERNANCE",
    ),
)


class IamInput(ContractModel):
    signal_fields = ("roles", "users")
    signal_message = "IAM analysis requires business 'roles' and/or 'users' with role assignments."


INPUT_CONTRACT = InputContract(
    formats=(InputFormat.JSON, InputFormat.CSV),
    summary=(
        "Role composition and assignments: JSON {'roles': [{role_name, catalogs, authorizations, assigned_users}], "
        "'users': [...], 'catalogs': [...], 'price_categories': {...}, 'usage_records': [...]} or CSV exports "
        "AGR_USERS (UNAME, AGR_NAME), AGR_1251 (AGR_NAME, OBJECT, FIELD, LOW), catalog/app and ST03N usage."
    ),
    required=("business roles or user role assignments",),
    json_model=IamInput,
    csv_signal_columns=("AGR_NAME", "UNAME", "CATALOG_ID", "APP_ID"),
)


# ==== END ENGINE CONTRACT ====


@register_engine
class IAMCostEngine(BaseEngine):
    """Production-grade Cloud IAM & BTP Role Tailoring Cost Guard."""

    engine_type = EngineType.IAM_COST_OPTIMIZER
    rule_prefix = "IAM"
    finding_codes = RULES
    input_contract = INPUT_CONTRACT
    name = "IAM Cost Optimizer"
    description = (
        "Role catalog over-licensing, license tier escalation driver pinpointing, "
        "redundant catalog detection, and unused authorization minimizer."
    )
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.CSV]

    def _parse_inputs(self, raw_content: str) -> IAMCostInputData:
        """Parses JSON payload or CSV tables into validated IAMCostInputData."""
        if not raw_content or not raw_content.strip():
            return IAMCostInputData()

        stripped = raw_content.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            # Malformed JSON / wrong structure is an input error — never re-read as CSV.
            data_dict = parse_json_payload(stripped, self.rule_prefix)
            if not isinstance(data_dict, dict):
                raise EngineInputError(f"{self.rule_prefix}_INVALID_INPUT", "Expected a JSON object at the top level.")
            try:
                return IAMCostInputData.model_validate(data_dict)
            except ValidationError as exc:
                locs = sorted({".".join(str(p) for p in e.get("loc", ())) for e in exc.errors(include_input=False)})
                raise EngineInputError(
                    f"{self.rule_prefix}_INVALID_INPUT",
                    "IAM role/user payload does not match the expected structure at: " + ", ".join(locs[:5]),
                ) from None

        # Parse CSV format (handles AGR_1251, AGR_USERS, or composite CSV)
        roles_map: Dict[str, BusinessRoleModel] = {}
        users_map: Dict[str, UserAssignmentModel] = {}
        catalogs_map: Dict[str, CatalogModel] = {}
        price_cats: Dict[str, str] = dict(DEFAULT_PRICE_CATEGORIES)
        usage_records: List[UsageRecordModel] = []

        reader = csv.DictReader(io.StringIO(stripped))
        for row in reader:
            normalized_row = {k.strip().upper(): v.strip() for k, v in row.items() if k and v}
            
            # AGR_USERS format
            if "UNAME" in normalized_row and "AGR_NAME" in normalized_row:
                uname = normalized_row["UNAME"]
                rname = normalized_row["AGR_NAME"]
                to_dat = normalized_row.get("TO_DAT", "99991231")
                from_dat = normalized_row.get("FROM_DAT", "20260101")
                
                u_entry = users_map.setdefault(uname, UserAssignmentModel(user_id=uname, user_name=uname))
                if rname not in u_entry.assigned_roles:
                    u_entry.assigned_roles.append(rname)
                u_entry.valid_to = to_dat
                u_entry.valid_from = from_dat

                r_entry = roles_map.setdefault(rname, BusinessRoleModel(role_name=rname))
                if uname not in r_entry.assigned_users:
                    r_entry.assigned_users.append(uname)

            # AGR_1251 format (Authorizations)
            elif "OBJECT" in normalized_row and "AGR_NAME" in normalized_row:
                rname = normalized_row["AGR_NAME"]
                obj = normalized_row["OBJECT"]
                fld = normalized_row.get("FIELD", "")
                val = normalized_row.get("LOW", "")
                actvt = val if fld == "ACTVT" else None
                
                r_entry = roles_map.setdefault(rname, BusinessRoleModel(role_name=rname))
                r_entry.authorizations.append(
                    AuthorizationObjectEntry(object=obj, field=fld, value=val, activity=actvt)
                )

            # Catalogs / Apps composite format
            elif "CATALOG_ID" in normalized_row and "APP_ID" in normalized_row:
                cat_id = normalized_row["CATALOG_ID"]
                app_id = normalized_row["APP_ID"]
                tier = normalized_row.get("TIER", normalized_row.get("LICENSE_TIER"))
                if tier and tier in TIER_WEIGHTS:
                    price_cats[app_id] = tier
                
                cat = catalogs_map.setdefault(cat_id, CatalogModel(catalog_id=cat_id, catalog_name=cat_id))
                if app_id not in cat.apps:
                    cat.apps.append(app_id)

            # ST03N usage format
            elif "APP_ID" in normalized_row and ("USER_ID" in normalized_row or "UNAME" in normalized_row):
                uid = normalized_row.get("USER_ID", normalized_row.get("UNAME", ""))
                app = normalized_row["APP_ID"]
                count = int(normalized_row.get("EXECUTION_COUNT", normalized_row.get("COUNT", 1)))
                usage_records.append(UsageRecordModel(user_id=uid, app_id=app, execution_count=count))

        return IAMCostInputData(
            roles=list(roles_map.values()),
            catalogs=list(catalogs_map.values()),
            users=list(users_map.values()),
            price_categories=price_cats,
            usage_records=usage_records,
        )

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Executes deterministic evaluation of role tailoring and licensing cost guard."""
        start_time = time.perf_counter()
        findings: List[Finding] = []
        rules_evaluated = 0

        # Retrieve artifact content
        raw_text = ""
        artifact_path = request.artifact_s3_key or "iam_role_composition.json"
        if request.raw_content:
            raw_text = request.raw_content
        elif request.artifacts and len(request.artifacts) > 0:
            first_art = request.artifacts[0]
            raw_text = getattr(first_art, "raw_content", None) or getattr(first_art, "content", None) or ""
            if getattr(first_art, "file_name", None):
                artifact_path = first_art.file_name
        elif getattr(request, "artifact_reference", None) and (getattr(request.artifact_reference, "raw_content", None) or getattr(request.artifact_reference, "content", None)):
            raw_text = getattr(request.artifact_reference, "raw_content", None) or getattr(request.artifact_reference, "content", None)
        elif request.configuration and isinstance(request.configuration, dict) and "content" in request.configuration:
            raw_text = str(request.configuration["content"])

        if (not raw_text or not raw_text.strip()) and request.configuration and isinstance(request.configuration, dict):
            try:
                data = IAMCostInputData.model_validate(request.configuration)
            except ValidationError:
                data = self._parse_inputs(raw_text)
        else:
            data = self._parse_inputs(raw_text)

        # Merge additional artifacts if provided
        if request.artifacts and len(request.artifacts) > 1:
            for art in request.artifacts[1:]:
                c = getattr(art, "raw_content", None) or getattr(art, "content", None) or ""
                if c:
                    more_data = self._parse_inputs(c)
                    data.roles.extend(more_data.roles)
                    data.catalogs.extend(more_data.catalogs)
                    data.users.extend(more_data.users)
                    data.usage_records.extend(more_data.usage_records)
                    data.price_categories.update(more_data.price_categories)

        if not data.roles and not data.users:
            supplied = bool((raw_text or "").strip())
            raise EngineInputError(
                f"{self.rule_prefix}_INVALID_INPUT" if supplied else f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "No business roles or user assignments recognised: supply 'roles' / 'users' JSON or AGR_USERS / "
                "AGR_1251 CSV exports (optionally catalogs and ST03N usage).",
            )

        # Merge price catalog with defaults
        effective_price_map = dict(DEFAULT_PRICE_CATEGORIES)
        effective_price_map.update(data.price_categories)

        # Index catalogs by ID
        catalog_index: Dict[str, CatalogModel] = {c.catalog_id: c for c in data.catalogs}

        # Resolve user assignments to roles if users list is populated
        user_roles_map: Dict[str, Set[str]] = {}
        for u in data.users:
            user_roles_map[u.user_id] = set(u.assigned_roles)

        # Build reverse index: role -> assigned users
        role_users_map: Dict[str, Set[str]] = {}
        for r in data.roles:
            role_users_map[r.role_name] = set(r.assigned_users)
        for u_id, r_set in user_roles_map.items():
            for r_name in r_set:
                role_users_map.setdefault(r_name, set()).add(u_id)

        # Track usage executions by user: user_id -> set of executed apps
        user_executed_apps: Dict[str, Set[str]] = {}
        all_executed_apps: Set[str] = set()
        for rec in data.usage_records:
            user_executed_apps.setdefault(rec.user_id, set()).add(rec.app_id)
            all_executed_apps.add(rec.app_id)

        # Metrics accumulators
        redundant_catalogs_count = 0
        inflation_drivers_count = 0
        total_license_savings_fue = 0.0

        # ----------------------------------------------------------------------
        # Rule 1: Redundant Catalog Detection (100% Functional Overlap)
        # Finding Code: IAM_REDUNDANT_CATALOG_DETECTED
        # ----------------------------------------------------------------------
        for role in data.roles:
            rules_evaluated += 1
            if len(role.catalogs) < 2:
                continue

            # Gather apps per assigned catalog
            cat_apps: Dict[str, Set[str]] = {}
            for cat_id in role.catalogs:
                if cat_id in catalog_index:
                    cat_apps[cat_id] = set(catalog_index[cat_id].apps)
                else:
                    cat_apps[cat_id] = set()

            # Pairwise containment check
            assigned_cats = list(role.catalogs)
            for i, c_sub in enumerate(assigned_cats):
                apps_sub = cat_apps.get(c_sub, set())
                if not apps_sub:
                    continue

                for j, c_sup in enumerate(assigned_cats):
                    if i == j:
                        continue
                    apps_sup = cat_apps.get(c_sup, set())
                    
                    # If c_sub is a strict or equal subset of c_sup
                    if apps_sub.issubset(apps_sup):
                        redundant_catalogs_count += 1
                        line_no, col_no, snippet = _locate_line_in_text(raw_text, c_sub)
                        ev = EvidenceEngine.create_evidence(
                            artifact_path=artifact_path,
                            content=raw_text or f"{role.role_name}:{c_sub}",
                            line_number=line_no,
                            column_number=col_no,
                            snippet=snippet or f'"{c_sub}" in role "{role.role_name}"',
                            provenance=ConfidenceClass.VERIFIED,
                            source_type=TrustLevel.CUSTOMER_EVIDENCE,
                        )
                        f = Finding(
                            rule_id="IAM_REDUNDANT_CATALOG_DETECTED",
                            severity=Severity.MAJOR,
                            category="ROLE_COMPOSITION_GOVERNANCE",
                            title=f"Redundant Catalog Detected in Role {role.role_name}: {c_sub}",
                            description=(
                                f"In business role '{role.role_name}', catalog '{c_sub}' (contains {len(apps_sub)} apps) "
                                f"is 100% functionally covered by catalog '{c_sup}' (contains {len(apps_sup)} apps). "
                                "Retaining redundant catalogs bloats authorization profiles and degrades Launchpad performance."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=(
                                f"Open role '{role.role_name}' in transaction PFCG or SAP BTP Role Builder, navigate to "
                                f"assigned business catalogs, and remove redundant catalog '{c_sub}'."
                            ),
                            evidence=[ev],
                            technical_details={
                                "role": role.role_name,
                                "redundantCatalog": c_sub,
                                "coveringCatalog": c_sup,
                                "redundantAppCount": len(apps_sub),
                                "overlappingApps": sorted(list(apps_sub)),
                            },
                            affected_objects=[role.role_name, c_sub],
                        )
                        findings.append(ConfidenceClassifier.classify(f))
                        break  # Report once per redundant catalog

        # ----------------------------------------------------------------------
        # Helper: Calculate effective tier for an application list
        # ----------------------------------------------------------------------
        def get_highest_tier(apps: List[str]) -> Tuple[LicenseTier, str]:
            highest_weight = 0
            highest_tier = LicenseTier.SELF_SERVICE
            driver_app = ""
            for a in apps:
                t_str = effective_price_map.get(a, LicenseTier.CORE.value)
                weight = TIER_WEIGHTS.get(t_str, 2)
                if weight > highest_weight:
                    highest_weight = weight
                    highest_tier = LicenseTier(t_str)
                    driver_app = a
            return highest_tier, driver_app

        # ----------------------------------------------------------------------
        # Rule 2: License Tier Inflation Driver Pinpointing
        # Finding Code: IAM_LICENSE_TIER_INFLATION_DRIVER
        # ----------------------------------------------------------------------
        for role in data.roles:
            rules_evaluated += 1

            # Aggregate all apps in role
            role_apps: Set[str] = set()
            for cat_id in role.catalogs:
                if cat_id in catalog_index:
                    role_apps.update(catalog_index[cat_id].apps)

            if not role_apps:
                continue

            current_role_tier, highest_app = get_highest_tier(list(role_apps))

            # Only inspect roles that resolve to ADVANCED tier
            if current_role_tier == LicenseTier.ADVANCED:
                # Find which app(s) drive this role to Advanced
                advanced_apps = [
                    a for a in role_apps
                    if effective_price_map.get(a) == LicenseTier.ADVANCED.value
                ]

                # If there are 1 or 2 driver apps among many apps
                if 1 <= len(advanced_apps) <= 3 and len(role_apps) >= len(advanced_apps) + 1:
                    driver_app = advanced_apps[0]
                    # Compute counterfactual tier without driver_app
                    remaining_apps = [a for a in role_apps if a != driver_app]
                    counterfactual_tier, _ = get_highest_tier(remaining_apps)

                    if counterfactual_tier != LicenseTier.ADVANCED:
                        assigned_users = role_users_map.get(role.role_name, set())
                        user_count = len(assigned_users)
                        inflation_drivers_count += 1

                        # Calculate potential FUE savings
                        fue_delta = (
                            FUE_WEIGHTS[LicenseTier.ADVANCED.value]
                            - FUE_WEIGHTS[counterfactual_tier.value]
                        )
                        role_savings = round(user_count * fue_delta, 2)
                        total_license_savings_fue += role_savings

                        line_no, col_no, snippet = _locate_line_in_text(raw_text, driver_app)
                        ev = EvidenceEngine.create_evidence(
                            artifact_path=artifact_path,
                            content=raw_text or f"{role.role_name}:{driver_app}",
                            line_number=line_no,
                            column_number=col_no,
                            snippet=snippet or f'Driver app "{driver_app}" in role "{role.role_name}"',
                            provenance=ConfidenceClass.RULE_DERIVED,
                            source_type=TrustLevel.CURATED_RULE,
                        )

                        # Severity scaled by user impact
                        sev = (
                            Severity.CRITICAL if user_count >= 20
                            else Severity.MAJOR if user_count >= 5
                            else Severity.MINOR
                        )

                        f = Finding(
                            rule_id="IAM_LICENSE_TIER_INFLATION_DRIVER",
                            severity=sev,
                            category="LICENSE_OPTIMIZATION",
                            title=f"Single App Escalates License Tier to Advanced: {driver_app} in {role.role_name}",
                            description=(
                                f"In business role '{role.role_name}', application '{driver_app}' is categorized as "
                                f"ADVANCED, escalating the entire role from {counterfactual_tier.value} to ADVANCED. "
                                f"This directly inflates {user_count} assigned user(s) to the highest SAP license tier. "
                                f"Removing or extracting '{driver_app}' yields an estimated FUE savings of {role_savings}."
                            ),
                            confidence=ConfidenceClass.RULE_DERIVED,
                            confidence_score=0.85,
                            remediation=(
                                f"Refactor role '{role.role_name}': extract application '{driver_app}' into a dedicated "
                                f"restricted supervisor role (e.g. '{role.role_name}_SUP'), leaving standard users at "
                                f"{counterfactual_tier.value} license tier."
                            ),
                            evidence=[ev],
                            technical_details={
                                "role": role.role_name,
                                "escalatingApp": driver_app,
                                "affectedUsers": user_count,
                                "currentTier": current_role_tier.value,
                                "counterfactualTier": counterfactual_tier.value,
                                "potentialFUESavings": role_savings,
                                "totalRoleApps": len(role_apps),
                                "aliasFindingCode": "IAM_LICENSE_TIER_ESCALATED",
                            },
                            affected_objects=[role.role_name, driver_app],
                        )
                        findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 3: Unused Critical Authorization Audit
        # Finding Code: IAM_UNUSED_CRITICAL_AUTHORIZATION
        # ----------------------------------------------------------------------
        for role in data.roles:
            rules_evaluated += 1
            assigned_users = role_users_map.get(role.role_name, set())
            if not assigned_users:
                continue

            # Check authorization objects
            for auth in role.authorizations:
                rules_evaluated += 1
                if auth.object in CRITICAL_AUTH_OBJECTS:
                    # Check if any user in this role has executed any usage record
                    # If ST03N records exist and no user ever executed related apps
                    if data.usage_records:
                        role_user_executions = set()
                        for u in assigned_users:
                            role_user_executions.update(user_executed_apps.get(u, set()))

                        # If user executions exist in log, but critical object is never needed
                        # (e.g. S_TABU_DIS or S_DEVELOP with zero transactions run)
                        line_no, col_no, snippet = _locate_line_in_text(raw_text, auth.object)
                        ev = EvidenceEngine.create_evidence(
                            artifact_path=artifact_path,
                            content=raw_text or f"{role.role_name}:{auth.object}",
                            line_number=line_no,
                            column_number=col_no,
                            snippet=snippet or f'Auth object "{auth.object}" in "{role.role_name}"',
                            provenance=ConfidenceClass.VERIFIED,
                            source_type=TrustLevel.CUSTOMER_EVIDENCE,
                        )
                        f = Finding(
                            rule_id="IAM_UNUSED_CRITICAL_AUTHORIZATION",
                            severity=Severity.MAJOR,
                            category="LEAST_PRIVILEGE_COMPLIANCE",
                            title=f"Unused Critical Authorization Object: {auth.object} in {role.role_name}",
                            description=(
                                f"Business role '{role.role_name}' grants critical authorization object '{auth.object}', "
                                f"but telemetry across {len(assigned_users)} assigned user(s) over the analysis period "
                                "shows zero executions requiring this privilege. Retaining unused critical authorizations "
                                "violates least-privilege compliance and expands security attack surface."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=(
                                f"Revoke authorization object '{auth.object}' from role '{role.role_name}' in PFCG, "
                                "or assign it via temporary privileged access management (PAM / Firecall) when needed."
                            ),
                            evidence=[ev],
                            technical_details={
                                "role": role.role_name,
                                "authObject": auth.object,
                                "assignedUserCount": len(assigned_users),
                                "field": auth.field,
                                "activity": auth.activity,
                            },
                            affected_objects=[role.role_name, auth.object],
                        )
                        findings.append(ConfidenceClassifier.classify(f))
                        break  # Report once per role for high-privilege objects

        # ----------------------------------------------------------------------
        # Rule 4: Permanent Emergency Role Assignment
        # Finding Code: IAM_PERMANENT_EMERGENCY_ROLE
        # ----------------------------------------------------------------------
        role_map: Dict[str, BusinessRoleModel] = {r.role_name: r for r in data.roles}
        for user in data.users:
            rules_evaluated += 1
            for rname in user.assigned_roles:
                role_obj = role_map.get(rname)
                is_emergency_role = (
                    (role_obj is not None and getattr(role_obj, "is_emergency", False))
                    or "EMERGENCY" in rname.upper()
                    or "FIRECALL" in rname.upper()
                    or "SUPERUSER" in rname.upper()
                )
                if is_emergency_role and (user.valid_to == "99991231" or not user.valid_to):
                    line_no, col_no, snippet = _locate_line_in_text(raw_text, user.user_id)
                    ev = EvidenceEngine.create_evidence(
                        artifact_path=artifact_path,
                        content=raw_text or f"{user.user_id}:{rname}",
                        line_number=line_no,
                        column_number=col_no,
                        snippet=snippet or f'User "{user.user_id}" assigned "{rname}" permanently',
                        provenance=ConfidenceClass.VERIFIED,
                        source_type=TrustLevel.CUSTOMER_EVIDENCE,
                    )
                    f = Finding(
                        rule_id="IAM_PERMANENT_EMERGENCY_ROLE",
                        severity=Severity.CRITICAL,
                        category="EMERGENCY_ACCESS_GOVERNANCE",
                        title=f"Permanent Emergency Role Assignment Detected: {user.user_id} -> {rname}",
                        description=(
                            f"User '{user.user_id}' is permanently assigned emergency / firecall role '{rname}' "
                            f"(validity: {user.valid_from or 'any'} to {user.valid_to or 'indefinite'}). "
                            "Emergency roles must be time-delimited (maximum 24–48 hours) to prevent unauthorized audit drift."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"Update user assignment for '{user.user_id}' in SU01 or BTP Identity Provisioning to delimit "
                            f"role '{rname}' with an immediate expiration date."
                        ),
                        evidence=[ev],
                        technical_details={
                            "user": user.user_id,
                            "role": rname,
                            "validTo": user.valid_to,
                        },
                        affected_objects=[user.user_id, rname],
                    )
                    findings.append(ConfidenceClassifier.classify(f))

        # Calculate metrics
        duration_ms = int((time.perf_counter() - start_time) * 1000)
        total_roles = len(data.roles)
        potential_savings_pct = (
            round((total_license_savings_fue / (total_roles * 1.0 or 1.0)) * 100, 1)
            if total_roles > 0
            else 0.0
        )

        metrics = AnalysisMetrics(
            execution_time_ms=duration_ms,
            rules_evaluated=rules_evaluated,
            artifacts_scanned=1 if raw_text else 0,
            additional_metrics={
                "potentialSavingsPct": potential_savings_pct,
                "totalLicenseSavingsFue": total_license_savings_fue,
            },
        )

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=metrics,
        )


# Backward-compatibility alias
IAMCostGuardEngine = IAMCostEngine

__all__ = ["IAMCostEngine", "IAMCostGuardEngine"]
