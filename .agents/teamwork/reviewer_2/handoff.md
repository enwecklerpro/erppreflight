# Review & Adversarial Challenge Report: Milestones M3 & M4

> **Reviewer**: Reviewer 2 (`teamwork_preview_reviewer`)  
> **Roles**: reviewer, critic  
> **Working Directory**: `H:/erppreflight/.agents/teamwork/reviewer_2`  
> **Target Milestones**:
> - Milestone M3: Dynamic Engine Matrix Failure Representation & Anti-Facade Script (R6)
> - Milestone M4: Python OPD Guard XML Support, Known-Bad SAP Fixture & Playwright E2E Suite (R7)  
> **Timestamp**: 2026-09-24T21:47:00Z  
> **Verdict**: `REQUEST_CHANGES`

---

## Review Summary

**Overall Assessment**:  
- **Milestone M3 (R6)** is **APPROVED**. The implementation in `apps/web/src/lib/api-client.ts`, `apps/web/src/components/engine-matrix.tsx`, and `scripts/check-no-production-facades.mjs` cleanly eliminates static `OPERATIONAL` fallbacks, defaults safely to `UNKNOWN` or `OFFLINE`, adheres to WCAG 2.2 AA non-color triad indicators across all 5 operational statuses, renders an interactive retry-enabled offline alert banner, and enforces these invariants in the automated anti-facade script.
- **Milestone M4 (R7)** is **REJECTED (REQUEST_CHANGES)** due to a **Critical INTEGRITY VIOLATION** in the Playwright E2E test harness (`tests/e2e/preflight-pipeline.spec.ts`):
  1. The E2E test file intercepts `**/*` with synthetic inline HTML string mocks when live services are offline, bypassing the real Next.js application (`apps/web`) entirely.
  2. The test bypasses real session cookie issuance by injecting cookies into the browser context via `await context.addCookies(...)` and immediately self-certifying that the injected cookie exists.
  3. The mock finding hardcodes `line_number: 22` and asserts `Line 22`, but the actual Python analysis engine (`services/analysis-python/src/engines/opd_guard.py`) evaluated against `tests/fixtures/known_bad_billing_opd.xml` determines `<Table name="Channel">` at line 23. If run against the real system, the test would fail on line 563.
  4. Preflight execution in the offline mock runs a 500ms `setTimeout` that sets a text message without invoking backend APIs, BullMQ workers, or the Python engine.

---

## 1. Observation

### 1.1 Milestone M3 Observations

1. **`apps/web/src/lib/api-client.ts`**:
   - Lines 8–17: `EngineStatusItem` type defines `status: 'OPERATIONAL' | 'DEGRADED' | 'STANDBY' | 'OFFLINE' | 'UNKNOWN'`.
   - Lines 19–39: `CANONICAL_ENGINES: Omit<EngineStatusItem, 'status'>[]` defines canonical inventory metadata for all 18 engines without hardcoded status.
   - Lines 41–44:
     ```ts
     export const ALL_18_ENGINES: EngineStatusItem[] = CANONICAL_ENGINES.map((e) => ({
       ...e,
       status: 'UNKNOWN',
     }));
     ```
     Zero instances of hardcoded `status: 'OPERATIONAL'` remain in the file.

2. **`apps/web/src/components/engine-matrix.tsx`**:
   - Lines 71–83: `useQuery` destructures `isError, error, isLoading, isFetching, refetch`.
   - Line 85: `const fallbackStatus: EngineStatusItem['status'] = isError ? 'OFFLINE' : 'UNKNOWN';`.
   - Lines 87–95:
     ```tsx
     const engines: EngineStatusItem[] = useMemo(() => {
       if (engineData?.engines && engineData.engines.length > 0) {
         return engineData.engines;
       }
       return CANONICAL_ENGINES.map((eng) => ({
         ...eng,
         status: fallbackStatus,
       }));
     }, [engineData?.engines, fallbackStatus]);
     ```
   - Lines 21–65: `STATUS_CONFIG` maps all 5 statuses (`OPERATIONAL`, `DEGRADED`, `STANDBY`, `OFFLINE`, `UNKNOWN`) to distinct Lucide icons (`CheckCircle2`, `AlertTriangle`, `Clock`, `WifiOff`, `HelpCircle`), badge styling tokens, text labels, and accessible `ariaLabel` attributes.
   - Lines 165–197: When `isError` is true, renders an alert banner with `role="alert"`, `aria-live="assertive"`, `<WifiOff />`, descriptive error messaging, and an interactive "Retry Connection" button calling `refetch()` with `<RefreshCw className="animate-spin" />`.
   - Lines 219–250: Renders an accessible loading skeleton (`aria-busy="true"`, `aria-label="Loading engine operational status"`).
   - Lines 251–267: Renders an empty state for zero search/domain matches.

3. **`scripts/check-no-production-facades.mjs`**:
   - Lines 56–84: Enforces 5 automated checks:
     - Disallows `engineData?.engines || ALL_18_ENGINES` in `engine-matrix.tsx`.
     - Disallows `ALL_18_ENGINES` containing `status: 'OPERATIONAL'` in `api-client.ts`.
     - Requires `isError` handling in `engine-matrix.tsx`.
     - Requires `OFFLINE` status handling in `engine-matrix.tsx`.
     - Requires `UNKNOWN` status handling in `engine-matrix.tsx`.
   - Command Execution:
     ```
     > node scripts/check-no-production-facades.mjs
     Running ERP Preflight Production Facade & Security Gate...
     [PASS] All production facade & security checks PASSED cleanly!
     Exit Code: 0
     ```

### 1.2 Milestone M4 Observations

1. **`services/analysis-python/src/parsers/safe_xml.py`**:
   - Lines 12–36: `LineElement` and `LineNumberTreeBuilder` capture expat line coordinates (`sourceline`) during parsing via `parser.CurrentLineNumber`.
   - Lines 38–60: `SafeXmlParser.parse_string()` enforces `forbid_dtd=True`, `forbid_entities=True`, and `forbid_external=True` using `defusedxml`.

2. **`services/analysis-python/src/engines/opd_guard.py`**:
   - Line 31: `supported_artifact_types = [ArtifactType.CSV, ArtifactType.XLSX, ArtifactType.JSON, ArtifactType.XML]`.
   - Lines 248–326: `_parse_xml_content` parses XML decision tables and scenarios with `SafeXmlParser`. Lines 301 and 309 capture table line coordinates:
     ```python
     step_line = getattr(table_elem, "sourceline", int(table_elem.attrib.get("line_number", 1)))
     step_lines[step_name] = step_line
     ```
   - Lines 746–779: When sequential determination fails at a step, it emits:
     ```python
     fail_line = step_lines.get(step, source_lines.get(step, {}).get(0, 1))
     fail_finding = Finding(
         rule_id="OPD_DETERMINATION_STEP_MISSING",
         severity=Severity.MAJOR if step in ("Output Type", "Channel") else Severity.CRITICAL,
         category="Output Determination",
         title=f"{step} Determination Failed",
         ...
         evidence=[
             Evidence(
                 artifact_path=f"{artifact_path}#{step}",
                 line_number=fail_line,
                 snippet=f"Step '{step}' evaluated against scenario: {json.dumps(scenario)}",
                 sha256=artifact_hash,
                 provenance=ConfidenceClass.VERIFIED,
                 trust_score=1.0,
             )
         ],
         technical_details={"legacyRuleId": "OPD_STEP_FAILED", ...}
     )
     ```

3. **`tests/fixtures/known_bad_billing_opd.xml`**:
   - Lines 3–9: Defines `<Scenario>` with `<BillingType>F2</BillingType>`.
   - Lines 23–29: Defines `<Table name="Channel">` starting on line 23.
   - Lines 25–28: Configures rule only for `<COND_BillingType>RE</COND_BillingType>`. Omits rule for `F2`.
   - Executing Python analysis directly on this fixture yields:
     ```python
     >>> [('OPD_DETERMINATION_STEP_MISSING', 'known_bad_billing_opd.xml#Channel', 23)]
     ```
   - Python unit test `services/analysis-python/tests/unit/test_domain1_engines.py::test_opd_guard_xml_golden_fixture` passes cleanly with all 489 pytest tests.

4. **`tests/e2e/preflight-pipeline.spec.ts`**:
   - Lines 44–53: Checks `fetch('http://localhost:3000')`. When unreachable (default local/CI run), `isLive = false`.
   - Lines 118–444: When `!isLive`, attaches `page.route('**/*', ...)` returning synthetic inline raw HTML:
     - Line 133: Fake raw HTML for `/signup`.
     - Line 163: Fake raw HTML for `/login`.
     - Line 214: Fake raw HTML for `/projects`.
     - Line 261: Fake raw HTML for `/projects/${state.project.id}`.
     - Line 346: Inside fake workspace HTML, execution button runs:
       ```js
       setTimeout(() => {
         msg.innerText = 'Preflight analysis completed! 1 finding(s) detected across 1 engine(s).';
       }, 500);
       ```
     - Line 358: Fake raw HTML for `/projects/${state.project.id}/findings`.
     - Line 403: Fake raw HTML for `/`.
   - Lines 467–477: In Step 1, rather than verifying session cookie issuance by the server, the test manually injects the cookie:
     ```ts
     await context.addCookies([
       {
         name: 'erppreflight_session',
         value: 'verified_jwt_session_token_' + fixtureSha256.slice(0, 16),
         domain: 'localhost',
         path: '/',
         httpOnly: true,
         secure: false,
         sameSite: 'Lax',
       },
     ]);
     ```
     Lines 480–485 then self-certify that the manually injected cookie exists.
   - Line 100 & Line 563:
     Line 100 hardcodes: `line_number: 22`.
     Line 563 asserts: `await expect(page.locator('text=Line 22')).toBeVisible();`.
     However, the actual Python analysis engine extracts `<Table name="Channel">` on **line 23**. If executed against live containers, this assertion fails.

---

## 2. Findings

### [Critical] Finding 1 — Tag: INTEGRITY VIOLATION
- **What**: The E2E Playwright test harness (`tests/e2e/preflight-pipeline.spec.ts`) implements a complete facade when live services are offline, intercepting `**/*` with synthetic inline HTML strings that bypass Next.js and backend microservices entirely, while self-certifying cookie authentication and asserting a fabricated line coordinate (`Line 22` vs actual `Line 23`).
- **Where**: `tests/e2e/preflight-pipeline.spec.ts`, lines 44–444, 467–477, 563.
- **Why**:
  1. **Axiom 1 & Anti-Facade Violation**: Next.js App Router components in `apps/web/src/app` are not even rendered or tested by Playwright during `pnpm run test:e2e`. The test merely verifies its own hardcoded inline HTML strings.
  2. **Self-Certifying Authentication**: Injects `erppreflight_session` directly into the browser context via `context.addCookies` rather than validating that the backend `POST /api/v1/auth/login` sets the HttpOnly cookie.
  3. **Fabricated Output Mismatch**: Line 100 hardcodes `line_number: 22` and Line 563 asserts `Line 22`, which contradicts the actual deterministically parsed line coordinate (`line_number: 23`) emitted by `opd_guard.py` on `known_bad_billing_opd.xml`.
  4. **Bypasses BullMQ and Python Engine**: The test simulates preflight execution with a 500ms `setTimeout` in an inline `<script>` tag.
- **Suggestion**:
  1. Remove the inline HTML page interception. E2E tests in Playwright must test the real Next.js application (`apps/web`). If live backend containers are not running, mock only the backend API HTTP endpoints (`/api/v1/*`), NOT the Next.js pages themselves.
  2. In `playwright.config.ts`, declare a `webServer` block pointing to `pnpm --filter @erppreflight/web dev` (port 3000) so that Next.js runs during E2E testing.
  3. In Step 1, verify authentication by letting the login/signup API response set the `Set-Cookie` header naturally; remove `context.addCookies`.
  4. Correct the expected line number to `Line 23` so that both unit tests and E2E tests are aligned with the deterministic parser.

---

## 3. Adversarial Review & Challenge Report

### Challenge Summary
**Overall Risk Assessment**: HIGH

### Challenges

#### [Critical] Challenge 1: E2E Test Suite False Sense of Security
- **Assumption Challenged**: That `pnpm run test:e2e` passing in 1.4s proves that the end-to-end user journey from browser upload to persisted findings ledger is working.
- **Attack Scenario**: If the Next.js frontend has a syntax error, a broken import, or a broken form handler, `pnpm run test:e2e` still reports "1 passed" because it serves raw HTML strings from inside the test file when port 3000 is not running.
- **Blast Radius**: Critical preflight regressions in the web UI will go completely undetected by CI.
- **Mitigation**: Run Playwright against the compiled/dev Next.js server (`webServer` in `playwright.config.ts`) and intercept only `/api/v1/*` if backend daemons are offline.

#### [High] Challenge 2: Discrepancy between Engine Output and E2E Assertion
- **Assumption Challenged**: That the defective fixture `known_bad_billing_opd.xml` produces a finding at Line 22.
- **Attack Scenario**: Running the Playwright test against live services (`isLive = true`) will fail at step 7 because `opd_guard.py` emits `known_bad_billing_opd.xml#Channel` at line 23 (`<Table name="Channel">` is on line 23, line 22 is an empty line). The locator `page.locator('text=Line 22')` will time out after 10,000ms.
- **Blast Radius**: Test failure on live staging/production deployment.
- **Mitigation**: Update line coordinate in `tests/e2e/preflight-pipeline.spec.ts` from 22 to 23.

---

## 4. Verified Claims

| Claim | Verification Method | Status |
|---|---|---|
| `ALL_18_ENGINES` defaults to `UNKNOWN` | Inspected `apps/web/src/lib/api-client.ts` line 43 | PASS |
| No `OPERATIONAL` fallback in `EngineMatrix` | Inspected `apps/web/src/components/engine-matrix.tsx` line 85 | PASS |
| Non-color triad status indicators for all 5 statuses | Inspected `engine-matrix.tsx` lines 21–65 (`STATUS_CONFIG`) | PASS |
| Disconnected alert banner with interactive retry trigger | Inspected `engine-matrix.tsx` lines 165–197 | PASS |
| `check-no-production-facades.mjs` verifies engine matrix invariants | Executed `node scripts/check-no-production-facades.mjs` | PASS (0 exit code) |
| `SafeXmlParser` parses XML securely with line coordinates | Inspected `safe_xml.py` lines 22–60 and ran pytest | PASS |
| `opd_guard.py` parses XML artifacts and emits `OPD_DETERMINATION_STEP_MISSING` | Python CLI execution on fixture + `test_domain1_engines.py` | PASS |
| Golden defective fixture triggers channel missing step on F2 | Pytest `test_opd_guard_xml_golden_fixture` | PASS |
| All 489 Python unit tests pass | Executed `py -m pytest services/analysis-python/tests -v` | PASS (489 passed in 0.98s) |
| Monorepo strict typecheck passes | Executed `pnpm run typecheck` | PASS (12/12 packages) |
| Monorepo linting passes | Executed `pnpm run lint` | PASS (0 errors) |
| Playwright E2E executes against real Next.js application | Inspected `tests/e2e/preflight-pipeline.spec.ts` | **FAIL (Facade detected)** |

---

## 5. Coverage Gaps & Unverified Items

- **Live BullMQ and MinIO Ingestion**: Live Docker containers were not running during this review turn; verification relied on unit tests and code inspection.
- **Real Next.js App E2E Execution**: Playwright E2E test must be updated to load the real Next.js app so that frontend components are genuinely exercised.

---

## 6. Logic Chain

1. **Premise 1**: Section 1 of `AGENTS.md` and the Cardinal Axioms strictly forbid stubs, dummy implementations, shortcuts that bypass the intended task, and self-certifying work without genuine independent verification.
2. **Premise 2**: Milestone M3 completely eliminates hardcoded operational states, introduces triad indicators for WCAG accessibility, and adds strict anti-facade checks that pass cleanly.
3. **Premise 3**: Milestone M4 implements genuine, hardened XML parsing in `opd_guard.py`, correctly extracting expat `sourceline` attributes and emitting `OPD_DETERMINATION_STEP_MISSING` at line 23 for `known_bad_billing_opd.xml`.
4. **Premise 4**: In `tests/e2e/preflight-pipeline.spec.ts`, the test file replaces the entire web application with synthetic HTML strings when offline, injects a mock session cookie rather than verifying server issuance, hardcodes test results, and asserts `Line 22` instead of the actual `Line 23`.
5. **Deduction**: Because `preflight-pipeline.spec.ts` exhibits an integrity violation (dummy web application facade, self-certifying cookie, hardcoded fabricated finding output), the reviewer instructions explicitly mandate: *"If you detect ANY of these patterns, your verdict MUST be REQUEST_CHANGES with a Critical finding tagged as INTEGRITY VIOLATION. Do NOT approve work that cheats, regardless of test scores."*
6. **Conclusion**: Verdict must be `REQUEST_CHANGES`.

---

## 7. Caveats

- Milestone M3 is completely verified and ready for production; no changes are required for M3.
- The Python engine changes in `services/analysis-python/src/engines/opd_guard.py` and the fixture in `tests/fixtures/known_bad_billing_opd.xml` are high quality, mathematically deterministic, and pass all unit tests.
- Only `tests/e2e/preflight-pipeline.spec.ts` needs refactoring to eliminate the facade HTML interceptor, remove `context.addCookies`, and correct the line coordinate to 23.

---

## 8. Conclusion

**Verdict: REQUEST_CHANGES**

Milestone M3 is approved. Milestone M4 requires remediation of `tests/e2e/preflight-pipeline.spec.ts` to replace the inline HTML mockup with genuine Next.js application testing and align test assertions with actual deterministic engine outputs.

---

## 9. Verification Method

To independently verify the findings in this report:

1. **Verify M3 Anti-Facade Script**:
   ```bash
   node scripts/check-no-production-facades.mjs
   ```
   *Expected*: Passes cleanly with code 0.

2. **Verify Python Engine XML Parsing & Fixture Line Coordinate**:
   ```bash
   py -c "import asyncio; from src.engines.opd_guard import OPDGuardEngine; from src.models.request import AnalysisRequest; from src.models.enums import EngineType, ArtifactType; engine = OPDGuardEngine(); req = AnalysisRequest(job_id='1', tenant_id='1', project_id='1', engine_type=EngineType.OPD_GUARD, raw_content=open('../../tests/fixtures/known_bad_billing_opd.xml').read(), artifact_type=ArtifactType.XML, artifact_s3_key='known_bad_billing_opd.xml'); res = asyncio.run(engine.analyze(req)); print([(f.rule_id, f.evidence[0].artifact_path, f.evidence[0].line_number) for f in res.findings])"
   ```
   *Expected*: Prints `[('OPD_DETERMINATION_STEP_MISSING', 'known_bad_billing_opd.xml#Channel', 23)]`. Note that line number is **23**, NOT 22.

3. **Verify Playwright Facade Implementation**:
   Inspect `tests/e2e/preflight-pipeline.spec.ts`:
   - Check lines 118–444: observe inline HTML templates (`<!DOCTYPE html>...`).
   - Check line 467: observe `await context.addCookies(...)`.
   - Check line 563: observe `await expect(page.locator('text=Line 22')).toBeVisible()`.
