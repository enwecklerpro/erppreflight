# ERP Preflight — Engine Catalog

> **Generated file — do not edit by hand.** Source: the analysis service engine registry
> (`services/analysis-python/src/engines`). Regenerate with
> `python scripts/generate-engine-catalog.py`; CI runs it with `--check` and fails when this
> file no longer matches the code.

**19 engines registered.** Every engine runs deterministically behind `POST /api/v1/analyses` (the API queues a BullMQ job; the Python service executes it). Every finding carries a confidence class (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`); findings without a verifiable artifact path, line and SHA-256 are demoted to `UNKNOWN` by the runner.

Runner-level input codes available to every engine (`<PREFIX>_` + suffix): `INSUFFICIENT_INPUT`, `PARSE_ERROR`, `INVALID_INPUT`.

## Overview

| Engine type (API value) | Name | Rule prefix | Artifact types | Binary input | Version |
|---|---|---|---|---|---|
| `ACCOUNT_DETERMINATION_PREFLIGHT` | Account Determination Preflight | `ACCT` | JSON, CSV | no | 1.0.0 |
| `API_CHANGE_GUARD` | API Change Guard | `API` | JSON, EDMX, XML, TXT | no | 2.1.0 |
| `CHANGE_POINTER_COVERAGE_AUDITOR` | Change Pointer Coverage Auditor | `CP` | JSON, CSV, TXT | no | 2.0.0 |
| `CLEAN_CORE_OBJECT_GUARD` | Clean Core Object Guard | `CLEAN_CORE` | ABAP, ZIP, TXT, JSON | yes | 2.0.0 |
| `CUSTOM_FIELD_FLOW_DOCTOR` | Custom Field Flow Doctor | `FIELD` | JSON, TXT, XML | no | 1.0.0 |
| `ECC2CLOUD_NAVIGATOR` | ECC2Cloud Navigator | `ECC` | CSV, JSON | no | 2.0.0 |
| `EXTENSION_IMPACT_GUARD` | Extension Impact Guard | `EXT` | JSON, ABAP, XML | no | 1.0.0 |
| `FIORI_403_ROOT_CAUSE_DOCTOR` | Fiori 403 Root-Cause Doctor | `FIORI_403` | JSON, TXT, CSV | no | 2.0.0 |
| `FORM_DOCTOR` | FormDoctor | `FORM` | XML, XDP, TXT | no | 2.0.0 |
| `IAM_COST_OPTIMIZER` | IAM Cost Optimizer | `IAM` | JSON, CSV | no | 1.0.0 |
| `MFS_BLACKBOX` | MFS BlackBox | `MFS` | CSV, TXT, JSON | no | 1.1.0 |
| `OPD_GUARD` | OPD Guard | `OPD` | CSV, XLSX, JSON, XML | yes | 2.0.0 |
| `SAFE_DECOMMISSION_PREFLIGHT` | Safe Decommission Preflight | `DECOM` | JSON, CSV, TXT | no | 2.0.0 |
| `SAP_GAP_RADAR` | SAP Gap Radar | `GAP_RADAR` | JSON, TXT | no | 1.1.0 |
| `SOFTWARE_COLLECTION_DEPENDENCY_GUARD` | Software Collection Dependency Guard | `SC` | JSON, XML, ZIP | yes | 1.0.0 |
| `SPRO2CLOUD` | SPRO2Cloud | `SPRO` | CSV, XLSX, JSON | no | 2.0.0 |
| `SYSTEM_REFRESH_DELTA_GUARD` | System Refresh Delta Guard | `REFRESH` | JSON, CSV, TXT | no | 2.0.0 |
| `TRANSPORT_DEPENDENCY_ANALYZER` | Transport Dependency Analyzer | `TR` | JSON, CSV, XML, TXT | no | 2.0.0 |
| `WORKFLOW_STUCK_EXPLAINER` | Workflow Stuck Explainer | `WF` | CSV, JSON | no | 2.0.0 |

## Input probes (observed behaviour)

Each engine is executed through `EngineRunner.execute` with its first supported artifact type. *Empty* sends no payload; *non-SAP text* sends a short plain-text string. An engine that answers `COMPLETED, 0 finding(s)` to non-SAP text cannot distinguish "nothing wrong" from "nothing understood" — see KNOWN_LIMITATIONS.md.

| Engine type | Empty payload | Non-SAP text payload |
|---|---|---|
| `ACCOUNT_DETERMINATION_PREFLIGHT` | FAILED, 1 finding(s): `ACCT_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `ACCT_PARSE_ERROR` (UNKNOWN) |
| `API_CHANGE_GUARD` | FAILED, 1 finding(s): `API_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `API_INVALID_INPUT` (UNKNOWN) |
| `CHANGE_POINTER_COVERAGE_AUDITOR` | FAILED, 1 finding(s): `CP_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `CP_INVALID_INPUT` (UNKNOWN) |
| `CLEAN_CORE_OBJECT_GUARD` | FAILED, 1 finding(s): `CLEAN_CORE_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `CLEAN_CORE_INVALID_INPUT` (UNKNOWN) |
| `CUSTOM_FIELD_FLOW_DOCTOR` | FAILED, 1 finding(s): `FIELD_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `FIELD_PARSE_ERROR` (UNKNOWN) |
| `ECC2CLOUD_NAVIGATOR` | FAILED, 1 finding(s): `ECC_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `ECC_INVALID_INPUT` (UNKNOWN) |
| `EXTENSION_IMPACT_GUARD` | FAILED, 1 finding(s): `EXT_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `EXT_PARSE_ERROR` (UNKNOWN) |
| `FIORI_403_ROOT_CAUSE_DOCTOR` | FAILED, 1 finding(s): `FIORI_403_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `FIORI_403_INVALID_INPUT` (UNKNOWN) |
| `FORM_DOCTOR` | FAILED, 1 finding(s): `FORM_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `FORM_INVALID_INPUT` (UNKNOWN) |
| `IAM_COST_OPTIMIZER` | FAILED, 1 finding(s): `IAM_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `IAM_PARSE_ERROR` (UNKNOWN) |
| `MFS_BLACKBOX` | FAILED, 1 finding(s): `MFS_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `MFS_PARSE_ERROR` (UNKNOWN) |
| `OPD_GUARD` | FAILED, 1 finding(s): `OPD_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `OPD_PARSE_ERROR` (UNKNOWN) |
| `SAFE_DECOMMISSION_PREFLIGHT` | FAILED, 1 finding(s): `DECOM_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `DECOM_INVALID_INPUT` (UNKNOWN) |
| `SAP_GAP_RADAR` | FAILED, 1 finding(s): `GAP_RADAR_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `GAP_RADAR_INVALID_INPUT` (UNKNOWN) |
| `SOFTWARE_COLLECTION_DEPENDENCY_GUARD` | FAILED, 1 finding(s): `SC_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `SC_PARSE_ERROR` (UNKNOWN) |
| `SPRO2CLOUD` | FAILED, 1 finding(s): `SPRO_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `SPRO_INVALID_INPUT` (UNKNOWN) |
| `SYSTEM_REFRESH_DELTA_GUARD` | FAILED, 1 finding(s): `REFRESH_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `REFRESH_INVALID_INPUT` (UNKNOWN) |
| `TRANSPORT_DEPENDENCY_ANALYZER` | FAILED, 1 finding(s): `TR_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `TR_PARSE_ERROR` (UNKNOWN) |
| `WORKFLOW_STUCK_EXPLAINER` | FAILED, 1 finding(s): `WF_INSUFFICIENT_INPUT` (UNKNOWN) | FAILED, 1 finding(s): `WF_PARSE_ERROR` (UNKNOWN) |

## Engines

### Account Determination Preflight — `ACCOUNT_DETERMINATION_PREFLIGHT`

OBYC, VKOA, and FBKP automatic account determination rule validator, detecting missing GL accounts, posting blocks, conflicting rules, and matrix gaps.

- **Implementation:** `services/analysis-python/src/engines/account_determination.py` (`AccountDeterminationEngine`)
- **Artifact types:** JSON, CSV
- **Finding codes in the engine module (6):** `ACCT_DET_ACCOUNT_BLOCKED_POSTING`, `ACCT_DET_ACCOUNT_NOT_IN_COMPANY_CODE`, `ACCT_DET_CONFLICTING_RULES`, `ACCT_DET_MISSING_ACCOUNT`, `ACCT_INSUFFICIENT_INPUT`, `ACCT_INVALID_INPUT`
- **Tests referencing the engine (2):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_domain5_engines.py`
- **Fixture files named in those test files (22):** `acct_det_blocked_posting.json`, `acct_det_clean_vkoa.json`, `acct_det_conflicting_rules.json`, `acct_det_matrix.csv`, `acct_det_missing_bsx.json`, `decom_clean_user.json`, `decom_job_dependency.json`, `decom_rfc_dependency.json`, `fiori_auth_missing.json`, `fiori_clean_pass.json`, `fiori_icf_inactive.json`, `iam_clean_role.json`, `iam_license_escalation.json`, `iam_redundant_catalog.json`, `iam_role_matrix.csv`, `iam_unused_privilege.json`, `refresh_clean_isolated.json`, `refresh_rfc_production.json`, `refresh_scot_active.json`, `wf_background_failed.json`, `wf_clean_running.json`, `wf_stuck_no_agent.json`

### API Change Guard — `API_CHANGE_GUARD`

OData, SOAP, RFC compatibility and deprecation impact scanner

- **Implementation:** `services/analysis-python/src/engines/api_change.py` (`ApiChangeEngine`)
- **Artifact types:** JSON, EDMX, XML, TXT
- **Finding codes in the engine module (27):** `API_BREAKING_ENDPOINT_REMOVED`, `API_BREAKING_ENTITYSET_REMOVED`, `API_BREAKING_ENTITY_REMOVED`, `API_BREAKING_ENUM_RESTRICTED`, `API_BREAKING_FIELD_REMOVED`, `API_BREAKING_FORMAT_CHANGED`, `API_BREAKING_KEY_CHANGED`, `API_BREAKING_MAX_LENGTH_DECREASED`, `API_BREAKING_NAVIGATION_REMOVED`, `API_BREAKING_OPERATION_REMOVED`, `API_BREAKING_PARAM_REMOVED`, `API_BREAKING_PARAM_RENAMED`, `API_BREAKING_REQUIRED_PARAM_ADDED`, `API_BREAKING_REQUIRED_PROPERTY_ADDED`, `API_BREAKING_RESPONSE_PROPERTY_REMOVED`, `API_BREAKING_RESPONSE_STATUS_REMOVED`, `API_BREAKING_SECURITY_CHANGED`, `API_BREAKING_TYPE_CHANGED`, `API_DEPRECATION_WARNING`, `API_INSUFFICIENT_INPUT`, `API_INVALID_INPUT`, `API_NON_BREAKING_ENDPOINT_ADDED`, `API_NON_BREAKING_ENUM_EXPANDED`, `API_NON_BREAKING_MAX_LENGTH_INCREASED`, `API_NON_BREAKING_OPERATION_ADDED`, `API_NON_BREAKING_OPTIONAL_PROPERTY_ADDED`, `API_PARSE_ERROR`
- **Tests referencing the engine (4):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_api_change_oasdiff.py`, `tests/unit/test_domain3_engines.py`, `tests/unit/test_property_parsers.py`
- **Fixture files named in those test files (14):** `api_edmx_structure_baseline.xml`, `api_edmx_structure_candidate.xml`, `api_oasdiff_baseline.json`, `api_oasdiff_candidate.json`, `api_odata_edmx_baseline.xml`, `api_odata_edmx_candidate.xml`, `api_openapi_breaking.json`, `api_openapi_clean.json`, `cp_bd52_config.csv`, `cp_custom_field_omitted.json`, `cp_dd04l_flag_missing.json`, `cp_global_disabled.json`, `cp_matmas_active.json`, `cp_missing_field.json`

### Change Pointer Coverage Auditor — `CHANGE_POINTER_COVERAGE_AUDITOR`

BD61/BD50/BD52 change pointer configuration and event trigger validation

- **Implementation:** `services/analysis-python/src/engines/change_pointer.py` (`ChangePointerEngine`)
- **Artifact types:** JSON, CSV, TXT
- **Finding codes in the engine module (8):** `CP_CUSTOM_FIELD_OMITTED_BD52`, `CP_FIELD_DD04L_CHGFLAG_MISSING`, `CP_FIELD_FILTERED_BD53`, `CP_FIELD_NOT_CONFIGURED_BD52`, `CP_GLOBAL_DEACTIVATED`, `CP_INSUFFICIENT_INPUT`, `CP_MSG_TYPE_DEACTIVATED`, `CP_RUNTIME_UNPROCESSED_BACKLOG`
- **Tests referencing the engine (3):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_domain3_engines.py`
- **Fixture files named in those test files (14):** `api_odata_edmx_baseline.xml`, `api_odata_edmx_candidate.xml`, `api_openapi_breaking.json`, `api_openapi_clean.json`, `cp_bd52_config.csv`, `cp_custom_field_omitted.json`, `cp_dd04l_flag_missing.json`, `cp_global_disabled.json`, `cp_matmas_active.json`, `cp_missing_field.json`, `decom_clean_user.json`, `opd_decision_table.csv`, `refresh_clean_isolated.json`, `sc_circular.json`

### Clean Core Object Guard — `CLEAN_CORE_OBJECT_GUARD`

Token-based ABAP Cloud / Clean Core static analysis and released-object classification

- **Implementation:** `services/analysis-python/src/engines/clean_core.py` (`CleanCoreEngine`)
- **Artifact types:** ABAP, ZIP, TXT, JSON (binary payloads accepted as base64)
- **Finding codes in the engine module (8):** `CLEAN_CORE_DIRECT_DB_ACCESS`, `CLEAN_CORE_DIRECT_DB_MUTATION`, `CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE`, `CLEAN_CORE_OBJECT_RELEASED`, `CLEAN_CORE_OBSOLETE_SYNTAX`, `CLEAN_CORE_UNRELEASED_API`, `CLEAN_CORE_UNRELEASED_CLASS`, `CLEAN_CORE_UNRELEASED_OBJECT`
- **Tests referencing the engine (8):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_clean_core_tokenizer.py`, `tests/unit/test_contract_match.py`, `tests/unit/test_domain2_engines.py`, `tests/unit/test_knowledge_client.py`, `tests/unit/test_property_parsers.py`, `tests/unit/test_rule_catalog.py`
- **Fixture files named in those test files (20):** `clean_core_compliant.abap`, `clean_core_dynamic.abap`, `clean_core_legacy.abap`, `clean_core_tricky_negative.abap`, `clean_core_tricky_positive.abap`, `cp_missing_field.json`, `decom_clean_user.json`, `ecc_interface_inventory.json`, `ecc_obsolete_blockers.csv`, `ecc_st03n_clean.csv`, `gap_radar_direct_db_write.json`, `gap_radar_event_mesh.json`, `gap_radar_known_gap.json`, `opd_decision_table.csv`, `refresh_clean_isolated.json`, `sc_circular.json`, `spro_custom_z_activity.json`, `spro_negative_unsupported.csv`, `spro_standard_valid.csv`, `tr_collision.json`

### Custom Field Flow Doctor — `CUSTOM_FIELD_FLOW_DOCTOR`

Extension field lineage from CDS views through BAPIs to UI annotations

- **Implementation:** `services/analysis-python/src/engines/custom_field_flow.py` (`CustomFieldFlowEngine`)
- **Artifact types:** JSON, TXT, XML
- **Finding codes in the engine module (8):** `FIELD_BADI_REQUIRED_NOT_FOUND`, `FIELD_INSUFFICIENT_INPUT`, `FIELD_INVALID_INPUT`, `FIELD_MISSING_TARGET_CONTEXT`, `FIELD_NAME_INVALID_PREFIX`, `FIELD_PROPAGATION_BLOCKED`, `FIELD_PROPAGATION_REQUIRES_BADI`, `FIELD_TYPE_MISMATCH`
- **Tests referencing the engine (3):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_domain1_engines.py`
- **Fixture files named in those test files (16):** `cp_missing_field.json`, `custom_field_registry.json`, `custom_field_type_mismatch.json`, `decom_clean_user.json`, `extension_cycle.json`, `extension_manifest.json`, `form_data_missing_field.xml`, `form_data_valid.xml`, `form_legacy_smartform.xml`, `form_template_xdp.xml`, `opd_decision_table.csv`, `opd_scenario_missing_channel.json`, `opd_scenario_shadowed.json`, `opd_scenario_valid.json`, `refresh_clean_isolated.json`, `sc_circular.json`

### ECC2Cloud Navigator — `ECC2CLOUD_NAVIGATOR`

Custom code remediation, obsolete transaction / table migration roadmap

- **Implementation:** `services/analysis-python/src/engines/ecc2cloud.py` (`ECC2CloudEngine`)
- **Artifact types:** CSV, JSON
- **Finding codes in the engine module (9):** `ECC_BAPI_RFC_MODERNIZATION_FOUND`, `ECC_BAPI_RFC_UNRELEASED_BLOCKER`, `ECC_IDOC_MODERNIZATION_EVENT_MESH`, `ECC_IDOC_UNSUPPORTED_BLOCKER`, `ECC_INSUFFICIENT_INPUT`, `ECC_TCODE_CUSTOM_CODE_REVIEW`, `ECC_TCODE_NO_EQUIVALENT_BLOCKER`, `ECC_TCODE_OBSOLETE_REDESIGN`, `ECC_TCODE_SUCCESSOR_FOUND`
- **Tests referencing the engine (2):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_domain2_engines.py`
- **Fixture files named in those test files (12):** `clean_core_compliant.abap`, `clean_core_dynamic.abap`, `clean_core_legacy.abap`, `ecc_interface_inventory.json`, `ecc_obsolete_blockers.csv`, `ecc_st03n_clean.csv`, `gap_radar_direct_db_write.json`, `gap_radar_event_mesh.json`, `gap_radar_known_gap.json`, `spro_custom_z_activity.json`, `spro_negative_unsupported.csv`, `spro_standard_valid.csv`

### Extension Impact Guard — `EXTENSION_IMPACT_GUARD`

Cloud BAdI, key-user extensibility, and upgrade stability analyzer

- **Implementation:** `services/analysis-python/src/engines/extension_impact.py` (`ExtensionImpactEngine`)
- **Artifact types:** JSON, ABAP, XML
- **Finding codes in the engine module (7):** `EXT_CYCLIC_DEPENDENCY_DETECTED`, `EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS`, `EXT_HIGH_BLAST_RADIUS_WARNING`, `EXT_INSUFFICIENT_INPUT`, `EXT_MODIFICATION_BREAKING_CONSUMERS`, `EXT_SAFE_TO_DELETE`, `EXT_TARGET_OBJECT_NOT_FOUND`
- **Tests referencing the engine (2):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_domain1_engines.py`
- **Fixture files named in those test files (12):** `custom_field_registry.json`, `custom_field_type_mismatch.json`, `extension_cycle.json`, `extension_manifest.json`, `form_data_missing_field.xml`, `form_data_valid.xml`, `form_legacy_smartform.xml`, `form_template_xdp.xml`, `opd_decision_table.csv`, `opd_scenario_missing_channel.json`, `opd_scenario_shadowed.json`, `opd_scenario_valid.json`

### Fiori 403 Root-Cause Doctor — `FIORI_403_ROOT_CAUSE_DOCTOR`

Deterministic 7-step decision-tree diagnosis across HTTP 403 / unauthorized errors

- **Implementation:** `services/analysis-python/src/engines/fiori_auth_guard.py` (`Fiori403Engine`)
- **Artifact types:** JSON, TXT, CSV
- **Finding codes in the engine module (3):** `FIORI_403_INSUFFICIENT_INPUT`, `FIORI_403_INSUFFICIENT_TELEMETRY`, `FIORI_403_INVALID_INPUT`
- **Tests referencing the engine (2):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_domain5_engines.py`
- **Fixture files named in those test files (22):** `acct_det_blocked_posting.json`, `acct_det_clean_vkoa.json`, `acct_det_conflicting_rules.json`, `acct_det_matrix.csv`, `acct_det_missing_bsx.json`, `decom_clean_user.json`, `decom_job_dependency.json`, `decom_rfc_dependency.json`, `fiori_auth_missing.json`, `fiori_clean_pass.json`, `fiori_icf_inactive.json`, `iam_clean_role.json`, `iam_license_escalation.json`, `iam_redundant_catalog.json`, `iam_role_matrix.csv`, `iam_unused_privilege.json`, `refresh_clean_isolated.json`, `refresh_rfc_production.json`, `refresh_scot_active.json`, `wf_background_failed.json`, `wf_clean_running.json`, `wf_stuck_no_agent.json`

### FormDoctor — `FORM_DOCTOR`

SAPscript, Smart Forms to Adobe Forms (XDP) migration & syntax validator

- **Implementation:** `services/analysis-python/src/engines/form_doctor.py` (`FormDoctorEngine`)
- **Artifact types:** XML, XDP, TXT
- **Finding codes in the engine module (5):** `FORM_BINDING_PATH_MISMATCH`, `FORM_FIELD_HIDDEN_IN_LAYOUT`, `FORM_FIELD_MISSING_IN_XML`, `FORM_LEGACY_SAPSCRIPT_DETECTED`, `FORM_LEGACY_SMARTFORM_DETECTED`
- **Tests referencing the engine (8):** `tests/adversarial/test_m1_challenges.py`, `tests/adversarial/test_m2_challenges.py`, `tests/integration/test_api.py`, `tests/unit/test_domain1_engines.py`, `tests/unit/test_domain1_rechallenge.py`, `tests/unit/test_form_doctor_file_names.py`, `tests/unit/test_platform_services.py`, `tests/unit/test_property_parsers.py`
- **Fixture files named in those test files (12):** `custom_field_registry.json`, `custom_field_type_mismatch.json`, `extension_cycle.json`, `extension_manifest.json`, `form_data_missing_field.xml`, `form_data_valid.xml`, `form_legacy_smartform.xml`, `form_template_xdp.xml`, `opd_decision_table.csv`, `opd_scenario_missing_channel.json`, `opd_scenario_shadowed.json`, `opd_scenario_valid.json`

### IAM Cost Optimizer — `IAM_COST_OPTIMIZER`

Role catalog over-licensing, license tier escalation driver pinpointing, redundant catalog detection, and unused authorization minimizer.

- **Implementation:** `services/analysis-python/src/engines/iam_cost_guard.py` (`IAMCostEngine`)
- **Artifact types:** JSON, CSV
- **Finding codes in the engine module (7):** `IAM_INSUFFICIENT_INPUT`, `IAM_INVALID_INPUT`, `IAM_LICENSE_TIER_ESCALATED`, `IAM_LICENSE_TIER_INFLATION_DRIVER`, `IAM_PERMANENT_EMERGENCY_ROLE`, `IAM_REDUNDANT_CATALOG_DETECTED`, `IAM_UNUSED_CRITICAL_AUTHORIZATION`
- **Tests referencing the engine (3):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_domain5_engines.py`
- **Fixture files named in those test files (25):** `acct_det_blocked_posting.json`, `acct_det_clean_vkoa.json`, `acct_det_conflicting_rules.json`, `acct_det_matrix.csv`, `acct_det_missing_bsx.json`, `cp_missing_field.json`, `decom_clean_user.json`, `decom_job_dependency.json`, `decom_rfc_dependency.json`, `fiori_auth_missing.json`, `fiori_clean_pass.json`, `fiori_icf_inactive.json`, `iam_clean_role.json`, `iam_license_escalation.json`, `iam_redundant_catalog.json`, `iam_role_matrix.csv`, `iam_unused_privilege.json`, `opd_decision_table.csv`, `refresh_clean_isolated.json`, `refresh_rfc_production.json`, `refresh_scot_active.json`, `sc_circular.json`, `wf_background_failed.json`, `wf_clean_running.json`, `wf_stuck_no_agent.json`

### MFS BlackBox — `MFS_BLACKBOX`

Material Flow System / EWM telegram sequence and telegram buffer auditor

- **Implementation:** `services/analysis-python/src/engines/mfs_blackbox.py` (`MFSBlackBoxEngine`)
- **Artifact types:** CSV, TXT, JSON
- **Finding codes in the engine module (8):** `MFS_CORRUPTED_TELEGRAM`, `MFS_DUPLICATE_TELEGRAM_SEND`, `MFS_FIRST_CAUSAL_DIVERGENCE`, `MFS_IMPOSSIBLE_TOPOLOGY_JUMP`, `MFS_INSUFFICIENT_INPUT`, `MFS_INVALID_INPUT`, `MFS_MISSING_ACK_TIMEOUT`, `MFS_OUT_OF_ORDER_SEQUENCE`
- **Tests referencing the engine (9):** `tests/adversarial/test_m2_challenges.py`, `tests/integration/test_api.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_contract_match.py`, `tests/unit/test_domain6_engines.py`, `tests/unit/test_mfs_streaming.py`, `tests/unit/test_property_parsers.py`, `tests/unit/test_rule_catalog.py`, `tests/unit/test_stream_admission.py`
- **Fixture files named in those test files (11):** `clean_core_legacy.abap`, `cp_missing_field.json`, `decom_clean_user.json`, `mfs_ack_retry_storm.json`, `mfs_jump_stream.json`, `mfs_normal_flow.json`, `mfs_telegram_log.csv`, `opd_decision_table.csv`, `refresh_clean_isolated.json`, `sc_circular.json`, `tr_collision.json`

### OPD Guard — `OPD_GUARD`

S/4HANA Output Parameter Determination & BRFplus decision table evaluation

- **Implementation:** `services/analysis-python/src/engines/opd_guard.py` (`OPDGuardEngine`)
- **Artifact types:** CSV, XLSX, JSON, XML (binary payloads accepted as base64)
- **Finding codes in the engine module (10):** `OPD_ARCHIVE_REJECTED`, `OPD_CHANNEL_INACTIVE`, `OPD_DETERMINATION_STEP_MISSING`, `OPD_INSUFFICIENT_INPUT`, `OPD_INVALID_INPUT`, `OPD_PARSE_ERROR`, `OPD_PRINTER_QUEUE_NOT_FOUND`, `OPD_RELEVANCE_SUPPRESSED`, `OPD_STEP_FAILED`, `OPD_UNREACHABLE_RULE`
- **Tests referencing the engine (15):** `tests/adversarial/test_empirical_r7_opd_stress.py`, `tests/adversarial/test_m1_challenges.py`, `tests/adversarial/test_m2_challenges.py`, `tests/integration/test_api.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_contract_match.py`, `tests/unit/test_domain1_engines.py`, `tests/unit/test_domain1_rechallenge.py`, `tests/unit/test_mfs_streaming.py`, `tests/unit/test_platform_services.py`, `tests/unit/test_rule_catalog.py`, `tests/unit/test_rule_self_test.py`, `tests/unit/test_rule_versions.py`, `tests/unit/test_runner.py`, `tests/unit/test_schemas.py`
- **Fixture files named in those test files (19):** `clean_core_legacy.abap`, `cp_missing_field.json`, `custom_field_registry.json`, `custom_field_type_mismatch.json`, `decom_clean_user.json`, `extension_cycle.json`, `extension_manifest.json`, `form_data_missing_field.xml`, `form_data_valid.xml`, `form_legacy_smartform.xml`, `form_template_xdp.xml`, `mfs_telegram_log.csv`, `opd_decision_table.csv`, `opd_scenario_missing_channel.json`, `opd_scenario_shadowed.json`, `opd_scenario_valid.json`, `refresh_clean_isolated.json`, `sc_circular.json`, `tr_collision.json`

### Safe Decommission Preflight — `SAFE_DECOMMISSION_PREFLIGHT`

Unused Z-program, table, and interface retirement preflight validator

- **Implementation:** `services/analysis-python/src/engines/decommission_audit.py` (`DecommissionAuditEngine`)
- **Artifact types:** JSON, CSV, TXT
- **Finding codes in the engine module (9):** `DECOM_ACTIVE_RFC_DEPENDENCY`, `DECOM_INSUFFICIENT_INPUT`, `DECOM_INVALID_INPUT`, `DECOM_LOCKED_USER_CALL_FLOOD`, `DECOM_RECENT_ACTIVITY_DETECTED`, `DECOM_SAFE_FOR_ARCHIVING`, `DECOM_SCHEDULED_JOB_DEPENDENCY`, `DECOM_USER_NOT_FOUND`, `DECOM_WORKFLOW_AGENT_DEPENDENCY`
- **Tests referencing the engine (4):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_decommission_evaluation_date.py`, `tests/unit/test_domain5_engines.py`
- **Fixture files named in those test files (25):** `acct_det_blocked_posting.json`, `acct_det_clean_vkoa.json`, `acct_det_conflicting_rules.json`, `acct_det_matrix.csv`, `acct_det_missing_bsx.json`, `cp_missing_field.json`, `decom_clean_user.json`, `decom_job_dependency.json`, `decom_rfc_dependency.json`, `fiori_auth_missing.json`, `fiori_clean_pass.json`, `fiori_icf_inactive.json`, `iam_clean_role.json`, `iam_license_escalation.json`, `iam_redundant_catalog.json`, `iam_role_matrix.csv`, `iam_unused_privilege.json`, `opd_decision_table.csv`, `refresh_clean_isolated.json`, `refresh_rfc_production.json`, `refresh_scot_active.json`, `sc_circular.json`, `wf_background_failed.json`, `wf_clean_running.json`, `wf_stuck_no_agent.json`

### SAP Gap Radar — `SAP_GAP_RADAR`

Fit-to-standard vs custom delta analyzer with Clean Core recommendations

- **Implementation:** `services/analysis-python/src/engines/gap_radar.py` (`GapRadarEngine`)
- **Artifact types:** JSON, TXT
- **Finding codes in the engine module (1):** `GAP_RADAR_INSUFFICIENT_INPUT`
- **Tests referencing the engine (3):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_domain2_engines.py`, `tests/unit/test_gap_radar_input_contract.py`
- **Fixture files named in those test files (15):** `clean_core_compliant.abap`, `clean_core_dynamic.abap`, `clean_core_legacy.abap`, `ecc_interface_inventory.json`, `ecc_obsolete_blockers.csv`, `ecc_st03n_clean.csv`, `gap_radar_direct_db_write.json`, `gap_radar_event_mesh.json`, `gap_radar_known_gap.json`, `gap_radar_mixed_batch.json`, `gap_radar_non_sap_prose.txt`, `gap_radar_requirement_list.txt`, `spro_custom_z_activity.json`, `spro_negative_unsupported.csv`, `spro_standard_valid.csv`

### Software Collection Dependency Guard — `SOFTWARE_COLLECTION_DEPENDENCY_GUARD`

Export software collection item cross-reference and release validator

- **Implementation:** `services/analysis-python/src/engines/software_collection.py` (`SoftwareCollectionEngine`)
- **Artifact types:** JSON, XML, ZIP (binary payloads accepted as base64)
- **Finding codes in the engine module (8):** `SC_ARCHIVE_REJECTED`, `SC_CIRCULAR_DEPENDENCY`, `SC_DANGLING_FIELD_REFERENCE`, `SC_DRAFT_ITEM_INCLUDED`, `SC_INSUFFICIENT_INPUT`, `SC_INVALID_INPUT`, `SC_MISSING_PREREQUISITE`, `SC_SCHEMA_VALIDATION_FAILED`
- **Tests referencing the engine (3):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_domain4_engines.py`
- **Fixture files named in those test files (18):** `cp_missing_field.json`, `decom_clean_user.json`, `opd_decision_table.csv`, `refresh_clean_isolated.json`, `sc_circular.json`, `sc_dangling_field.json`, `sc_draft_item.json`, `sc_linear_manifest.xml`, `sc_missing_prereq.json`, `sc_valid_sequence.json`, `tr_circular_transports.json`, `tr_collision.csv`, `tr_collision.json`, `tr_customizing_ahead_of_structure.json`, `tr_e070_e071_complete.csv`, `tr_overtaker_downgrade.json`, `tr_valid_e070_e071.csv`, `tr_valid_sequence.json`

### SPRO2Cloud — `SPRO2CLOUD`

On-premise IMG/SPRO configuration to Cloud CBC mapping and delta analysis

- **Implementation:** `services/analysis-python/src/engines/spro2cloud.py` (`SPRO2CloudEngine`)
- **Artifact types:** CSV, XLSX, JSON
- **Finding codes in the engine module (7):** `SPRO_INSUFFICIENT_INPUT`, `SPRO_MAPPING_EXACT`, `SPRO_MAPPING_NEEDS_REVIEW`, `SPRO_MAPPING_NOT_AVAILABLE`, `SPRO_MAPPING_PARTIAL`, `SPRO_MAPPING_PROCESS_REDESIGN`, `SPRO_MAPPING_SCOPE_DEPENDENT`
- **Tests referencing the engine (3):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_domain2_engines.py`, `tests/unit/test_property_parsers.py`
- **Fixture files named in those test files (12):** `clean_core_compliant.abap`, `clean_core_dynamic.abap`, `clean_core_legacy.abap`, `ecc_interface_inventory.json`, `ecc_obsolete_blockers.csv`, `ecc_st03n_clean.csv`, `gap_radar_direct_db_write.json`, `gap_radar_event_mesh.json`, `gap_radar_known_gap.json`, `spro_custom_z_activity.json`, `spro_negative_unsupported.csv`, `spro_standard_valid.csv`

### System Refresh Delta Guard — `SYSTEM_REFRESH_DELTA_GUARD`

Post-refresh BDLS, RFC destination, and logical system change validator

- **Implementation:** `services/analysis-python/src/engines/system_refresh_guard.py` (`SystemRefreshEngine`)
- **Artifact types:** JSON, CSV, TXT
- **Finding codes in the engine module (9):** `REFRESH_CRITICAL_JOB_SCHEDULED`, `REFRESH_INPUT_SID_MISMATCH`, `REFRESH_INSUFFICIENT_INPUT`, `REFRESH_INVALID_INPUT`, `REFRESH_ISOLATION_VERIFIED`, `REFRESH_LOGICAL_SYSTEM_UNADJUSTED`, `REFRESH_PRODUCTION_PRINTER_ACTIVE`, `REFRESH_RFC_TARGETS_PRODUCTION`, `REFRESH_SCOT_OUTBOUND_ACTIVE`
- **Tests referencing the engine (3):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_domain5_engines.py`
- **Fixture files named in those test files (25):** `acct_det_blocked_posting.json`, `acct_det_clean_vkoa.json`, `acct_det_conflicting_rules.json`, `acct_det_matrix.csv`, `acct_det_missing_bsx.json`, `cp_missing_field.json`, `decom_clean_user.json`, `decom_job_dependency.json`, `decom_rfc_dependency.json`, `fiori_auth_missing.json`, `fiori_clean_pass.json`, `fiori_icf_inactive.json`, `iam_clean_role.json`, `iam_license_escalation.json`, `iam_redundant_catalog.json`, `iam_role_matrix.csv`, `iam_unused_privilege.json`, `opd_decision_table.csv`, `refresh_clean_isolated.json`, `refresh_rfc_production.json`, `refresh_scot_active.json`, `sc_circular.json`, `wf_background_failed.json`, `wf_clean_running.json`, `wf_stuck_no_agent.json`

### Transport Dependency Analyzer — `TRANSPORT_DEPENDENCY_ANALYZER`

CTS transport sequence, cross-transport dictionary dependency validator

- **Implementation:** `services/analysis-python/src/engines/transport_dependency.py` (`TransportDependencyEngine`)
- **Artifact types:** JSON, CSV, XML, TXT
- **Finding codes in the engine module (8):** `TR_CALL_DEPENDENCY_SEQUENCE_RISK`, `TR_CIRCULAR_DEPENDENCY_DETECTED`, `TR_CUSTOMIZING_AHEAD_OF_STRUCTURE`, `TR_INSUFFICIENT_INPUT`, `TR_INVALID_INPUT`, `TR_OBJECT_COLLISION`, `TR_OVERTAKER_DOWNGRADE_RISK`, `TR_PARSE_ERROR`
- **Tests referencing the engine (4):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_contract_match.py`, `tests/unit/test_domain4_engines.py`, `tests/unit/test_property_parsers.py`
- **Fixture files named in those test files (15):** `clean_core_legacy.abap`, `sc_circular.json`, `sc_dangling_field.json`, `sc_draft_item.json`, `sc_linear_manifest.xml`, `sc_missing_prereq.json`, `sc_valid_sequence.json`, `tr_circular_transports.json`, `tr_collision.csv`, `tr_collision.json`, `tr_customizing_ahead_of_structure.json`, `tr_e070_e071_complete.csv`, `tr_overtaker_downgrade.json`, `tr_valid_e070_e071.csv`, `tr_valid_sequence.json`

### Workflow Stuck Explainer — `WORKFLOW_STUCK_EXPLAINER`

Deterministic diagnostic analysis of stuck, failed, or overdue SAP Business Workflows

- **Implementation:** `services/analysis-python/src/engines/workflow_deadlock.py` (`WorkflowStuckEngine`)
- **Artifact types:** CSV, JSON
- **Finding codes in the engine module (8):** `WF_BACKGROUND_TASK_FAILED`, `WF_CONTAINER_BINDING_ERROR`, `WF_DEADLINE_BREACHED`, `WF_DEADLOCK_DETECTED`, `WF_EVENT_LINKAGE_DEACTIVATED`, `WF_INSUFFICIENT_INPUT`, `WF_INVALID_INPUT`, `WF_STUCK_NO_AGENT`
- **Tests referencing the engine (3):** `tests/adversarial/test_m2_challenges.py`, `tests/unit/test_audit_fixes.py`, `tests/unit/test_domain5_engines.py`
- **Fixture files named in those test files (25):** `acct_det_blocked_posting.json`, `acct_det_clean_vkoa.json`, `acct_det_conflicting_rules.json`, `acct_det_matrix.csv`, `acct_det_missing_bsx.json`, `cp_missing_field.json`, `decom_clean_user.json`, `decom_job_dependency.json`, `decom_rfc_dependency.json`, `fiori_auth_missing.json`, `fiori_clean_pass.json`, `fiori_icf_inactive.json`, `iam_clean_role.json`, `iam_license_escalation.json`, `iam_redundant_catalog.json`, `iam_role_matrix.csv`, `iam_unused_privilege.json`, `opd_decision_table.csv`, `refresh_clean_isolated.json`, `refresh_rfc_production.json`, `refresh_scot_active.json`, `sc_circular.json`, `wf_background_failed.json`, `wf_clean_running.json`, `wf_stuck_no_agent.json`

## Modules in `src/engines` that are not registered

These files are importable but no registered engine is defined in them; the registry never dispatches to code that lives only there:

- `services/analysis-python/src/engines/fiori_403.py`
- `services/analysis-python/src/engines/iam_cost.py`
- `services/analysis-python/src/engines/mfs_processor.py`
- `services/analysis-python/src/engines/safe_decommission.py`
- `services/analysis-python/src/engines/system_refresh.py`
- `services/analysis-python/src/engines/workflow_stuck.py`
