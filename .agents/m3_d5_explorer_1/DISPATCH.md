# Dispatch: m3_d5_explorer_1

## 2026-09-24T09:05:00Z
- **Identity**: m3_d5_explorer_1
- **Role**: teamwork_preview_explorer (Domain 5 Blueprint: Decommission & System Refresh)
- **Working Directory**: H:/erppreflight/.agents/m3_d5_explorer_1
- **Parent Conversation ID**: b18c0539-d6d7-4a41-968f-58324775ab38

### Mission
Explore, design, and draft production implementations for Feature 30 (Safe Decommission & Archiving Readiness Engine) and Feature 35 (System Refresh & Data Masking Sanity Guard):
1. Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.
2. Read H:/erppreflight/.agents/orchestrator_main/PROJECT.md.
3. Read H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md (§13 & §18).
4. Inspect `services/analysis-python/src/engines/` and existing engine patterns.
5. Feature 30: Safe Decommission & Archiving Readiness Engine (`decommission_audit.py`):
   - Design multi-artifact parsing for user master (USR02), background jobs (TBTCO/TBTCP), RFC destinations (RFCDES), workflows (SWWWIHEAD), and security audit logs (SM20/ST03N).
   - Compute decommission risk score (0.0-10.0), active dependencies, and reassignment action checklist.
   - Standard finding codes: `DECOM_SCHEDULED_JOB_DEPENDENCY`, `DECOM_ACTIVE_RFC_DEPENDENCY`, `DECOM_WORKFLOW_AGENT_DEPENDENCY`.
6. Feature 35: System Refresh & Data Masking Sanity Guard (`system_refresh_guard.py`):
   - Compare pre-refresh baseline vs post-refresh configuration.
   - Detect dangerous targets in non-prod environments: RFC destinations pointing to production IPs/hostnames, SCOT email routing active without domain redirection, unadjusted logical systems (BD54).
   - Standard finding codes: `REFRESH_RFC_TARGETS_PRODUCTION`, `REFRESH_SCOT_OUTBOUND_ACTIVE`, `REFRESH_LOGICAL_SYSTEM_UNADJUSTED`.
7. Author deliverable files in your working directory:
   - `domain5_decom_refresh_blueprint.md`
   - `proposed_decommission_audit.py`
   - `proposed_system_refresh_guard.py`
   - `handoff.md`
8. Maintain progress.md with timestamps.
9. Call send_message to parent upon completion.
