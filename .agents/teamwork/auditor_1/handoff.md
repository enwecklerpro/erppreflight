# Forensic Audit Handoff Report

> **Auditor**: Forensic Auditor (`teamwork_preview_auditor`)  
> **Working Directory**: `H:/erppreflight/.agents/teamwork/auditor_1`  
> **Target Scope**: Requirements R1 through R7 across `apps/web`, `apps/api`, `services/analysis-python`, `packages/`, and `tests/`  
> **Timestamp**: 2026-09-24T21:46:30Z  
> **Governing Rules**: `AGENTS.md` (Cardinal Axioms 1 & 2, Integrity Forensics), `ORIGINAL_REQUEST.md`  

---

## Forensic Audit Report

**Work Product**: Full Monorepo Implementation for Requirements R1 through R7  
**Profile**: General Project (Integrity Mode: `development`)  
**Verdict**: INTEGRITY VIOLATION  

### Phase Results
- [Hardcoded Output Detection]: PASS — Zero hardcoded findings, test results, or dummy constants in production application code.
- [Facade Implementation Detection]: PASS — Zero dummy facades or fake stubs in production paths; dropzone, auth pages, and BullMQ worker are functionally wired.
- [Pre-populated Verification Artifacts]: PASS — No pre-populated test output artifacts predating runs.
- [Dynamic Engine Matrix Representation]: PASS — `apps/web/src/components/engine-matrix.tsx` contains NO static `OPERATIONAL` fallback; handles `OFFLINE` and `UNKNOWN` with WCAG 2.2 AA non-color triad indicators and retry prompt.
- [ClamAV Fail-Closed Production Security]: **FAIL** — `apps/api/src/modules/ingestion/clamav.scanner.ts` lines 84–90 evaluate `trimmed.includes('OK')` before checking for `FOUND`. Any virus containing the substring `'OK'` (e.g. `Win32.Malware.OK_Variant`) or any response containing `'OK'` (e.g. `stream: NOT OK`) passes as clean (`isInfected: false`).
- [AnalysisProcessor S3 Clean Streaming & Python Execution]: PASS — Clean stream fetched via `S3StorageService.getCleanStream(artifactS3Key)`, passed to Python `/api/v1/analyze`, and persisted into PostgreSQL with tenant RLS.
- [OPD Guard XML Parsing & Deterministic Rules]: PASS — Genuine defused XML parsing with line numbers, evaluates decision tables and scenario, emits `OPD_DETERMINATION_STEP_MISSING` with SHA-256 evidence. 489/489 pytest tests pass.
- [Playwright E2E Spec & Fixture Integrity]: PASS — `tests/e2e/preflight-pipeline.spec.ts` executes and passes (1.9s) asserting SHA-256 evidence match and Clean Core Index calculation.
- [Anti-Facade Script Gate]: PASS — `node scripts/check-no-production-facades.mjs` executes and exits code 0.
- [Automated Test Suite Quality Gate]: **FAIL** — Monorepo test suite `pnpm run test` fails with exit code 1 due to 3 failed tests in `@erppreflight/api` and 10 failed tests in `@erppreflight/web`.

---

## 1. Observation

Direct empirical evidence gathered across all audited components:

### 1.1 ClamAV Scanner Fail-Open Vulnerability (`apps/api/src/modules/ingestion/clamav.scanner.ts`)
- **Location**: `apps/api/src/modules/ingestion/clamav.scanner.ts`, lines 80–90:
  ```typescript
  80: socket.on('end', () => {
  81:   const duration = Date.now() - startTime;
  82:   const trimmed = response.trim();
  83:
  84:   if (trimmed.includes('OK')) {
  85:     safeResolve({ isInfected: false, scanDurationMs: duration });
  86:   } else if (trimmed.includes('FOUND')) {
  87:     const match = trimmed.match(/stream:\s*(.+)\s+FOUND/);
  88:     const virus = match ? match[1] : 'UNKNOWN_VIRUS';
  89:     safeResolve({ isInfected: true, virusName: virus, scanDurationMs: duration });
  90:   } else {
  ```
- **Verbatim Tool Execution & Error**:
  Command: `pnpm --filter @erppreflight/api test`
  Output from `test/empirical_challenger1_stress.spec.ts`:
  ```text
  FAIL test/empirical_challenger1_stress.spec.ts > Empirical Challenger 1: R3 (ClamAV Fail-Closed Security) > R3-C9 (Adversarial stress): Checks behavior on response containing "OK" inside virus name or negative response
  AssertionError: expected false to be true // Object.is equality
  - Expected: true
  + Received: false
    ❯ test/empirical_challenger1_stress.spec.ts:241:33
       239| // CRITICAL CHECK: Does a virus with "OK" in its name get detected as infected,
       240| // or does `trimmed.includes('OK')` cause it to pass as clean?!
       241| expect(result.isInfected).toBe(true);

  FAIL test/empirical_challenger1_stress.spec.ts > Empirical Challenger 1: R3 (ClamAV Fail-Closed Security) > R3-C10 (Adversarial stress): Checks behavior on "stream: NOT OK" or "STATUS_NOK"
  AssertionError: expected false to be true // Object.is equality
  - Expected: true
  + Received: false
    ❯ test/empirical_challenger1_stress.spec.ts:266:33
       265| // "stream: NOT OK" should NOT be classified as clean!
       266| expect(result.isInfected).toBe(true);
  ```

### 1.2 Uncaught `URIError` Crash in JwtStrategy Cookie Extractor (`apps/api/src/modules/auth/strategies/jwt.strategy.ts`)
- **Location**: `apps/api/src/modules/auth/strategies/jwt.strategy.ts`, lines 14–20:
  ```typescript
  14: const cookieHeader = req.headers?.cookie;
  15: if (cookieHeader) {
  16:   const match = cookieHeader.match(/(?:^|;\s*)erppreflight_session=([^;]+)/);
  17:   if (match && match[1]) {
  18:     return decodeURIComponent(match[1]);
  19:   }
  20: }
  ```
- **Verbatim Test Failure**:
  ```text
  FAIL test/empirical_challenger1_stress.spec.ts > Empirical Challenger 1: R4 (Cookie Extractor in JwtStrategy) > R4-C8 (Adversarial stress): Handles malformed percent-encoding in cookie without throwing unhandled URIError
  AssertionError: expected true to be false // Object.is equality
  - Expected: false
  + Received: true
    ❯ test/empirical_challenger1_stress.spec.ts:406:24
       406| expect(threwError).toBe(false);
  ```
  `decodeURIComponent('%ZZ')` throws `URIError: URI malformed`. The extractor lacks `try/catch`, allowing hostile or malformed HTTP cookie headers to crash request authentication.

### 1.3 URL Normalization Edge Case Failures (`apps/web/src/lib/api/custom-instance.ts`)
- **Location**: `apps/web/src/lib/api/custom-instance.ts`, lines 105–128.
- **Verbatim Test Output**:
  Command: `pnpm --filter @erppreflight/web test`
  Failed 10 edge case tests in `src/__tests__/empirical_url_resolution_stress.test.ts`:
  - Leading double slashes (`//projects` -> resolved with double slash).
  - Version prefix ambiguity (`/api/v10/projects` -> incorrectly treated as starting with `/api/v1`).
  - Whitespace in paths (`  /projects  ` -> unstripped whitespace in URL).

### 1.4 Dynamic Engine Matrix Verification (`apps/web/src/components/engine-matrix.tsx`)
- Lines 85–95:
  `const fallbackStatus: EngineStatusItem['status'] = isError ? 'OFFLINE' : 'UNKNOWN';`
  When API status query fails, status defaults to `OFFLINE`.
  In `apps/web/src/lib/api-client.ts`, `ALL_18_ENGINES` defaults to `status: 'UNKNOWN'`.
  Zero static `OPERATIONAL` fallback exists.
  Non-color triad indicators (`CheckCircle2`, `AlertTriangle`, `Clock`, `WifiOff`, `HelpCircle` + text label + aria-label) are verified.
  Alert banner with `role="alert"` and `<RefreshCw />` retry trigger is present.

### 1.5 Python OPD Guard & Golden Fixture Verification
- `services/analysis-python/src/engines/opd_guard.py`:
  Lines 31: `supported_artifact_types = [ArtifactType.CSV, ArtifactType.XLSX, ArtifactType.JSON, ArtifactType.XML]`
  Lines 248–326: `_parse_xml_content` uses `SafeXmlParser` and preserves `sourceline`.
  Line 748: Emits `rule_id="OPD_DETERMINATION_STEP_MISSING"`, confidence `VERIFIED` (1.0), with artifact SHA-256 hash and line coordinates.
- Pytest command: `py -m pytest services/analysis-python/tests -v`
  Result: 489 passed in 0.92s.

### 1.6 Playwright E2E Harness Execution
- Command: `pnpm run test:e2e`
  Output: `1 passed (1.9s)`.
  Asserts real SHA-256 hash match (`tests/fixtures/known_bad_billing_opd.xml`), `OPD_DETERMINATION_STEP_MISSING`, Line 22, and Clean Core Index decrement.

### 1.7 Production Anti-Facade Gate
- Command: `node scripts/check-no-production-facades.mjs`
  Output: `[PASS] All production facade & security checks PASSED cleanly!` with exit code 0.

---

## 2. Logic Chain

```
[Observation 1.1] clamav.scanner.ts executes `if (trimmed.includes('OK'))` at line 84 before `else if (trimmed.includes('FOUND'))`.
      │
      ├──> [Logic Step 1] Any ClamAV response where the virus signature string contains the substring "OK"
      │    (e.g., "stream: Win32.Malware.OK_Variant FOUND") matches `trimmed.includes('OK')` on line 84.
      │
      ├──> [Logic Step 2] Any ClamAV response indicating negative status (e.g., "stream: NOT OK") also matches line 84.
      │
      ├──> [Logic Step 3] On line 85, safeResolve({ isInfected: false, ... }) is invoked, marking the artifact as CLEAN.
      │
      └──> [Conclusion 1] In production mode (CLAMAV_MOCK_MODE=false), files containing virus signatures with "OK"
           in their name or negative daemon statuses fail open and are promoted to clean S3 storage.
           This directly breaches Requirement R3 and violates the prompt's explicit mandate:
           "Verify that apps/api/src/modules/ingestion/clamav.scanner.ts NEVER fails open in production mode."

[Observation 1.2] jwt.strategy.ts calls `decodeURIComponent(match[1])` without try/catch block.
      │
      └──> [Conclusion 2] An invalid percent encoding (e.g. %ZZ) triggers an unhandled URIError, crashing the request.

[Observation 1.1, 1.2, 1.3] Monorepo test suite `pnpm run test` fails with exit code 1 (3 failures in API, 10 in Web).
      │
      └──> [Conclusion 3] Fails Cardinal Axiom 2 and Quality Gate 5.1 ("TypeScript Unit & Integration Tests pass").
```

---

## 3. Caveats

- The core pipeline architecture (BullMQ `AnalysisProcessor`, S3 clean stream fetching, Python `opd_guard.py` XML parsing, Playwright E2E test, and dynamic `EngineMatrix` UI) is genuinely implemented and passes individual execution gates.
- In mock mode (`CLAMAV_MOCK_MODE=true`), the scanner behaves predictably for EICAR strings. The fail-open vulnerability is isolated to production mode (`CLAMAV_MOCK_MODE=false`) when parsing real or mock TCP stream responses containing the substring `'OK'`.
- The audit constraint explicitly mandates: "Audit-only — do NOT modify implementation code. Report any failures as findings — do NOT fix them yourself." Therefore, no source code changes were made by the auditor.

---

## 4. Conclusion

The monorepo cannot be certified as clean due to a critical security fail-open vulnerability and test suite failures:
1. **Critical Security Integrity Violation**: `apps/api/src/modules/ingestion/clamav.scanner.ts` fails open in production mode for virus names containing substring `'OK'` or negative status strings `'stream: NOT OK'`, violating Requirement R3.
2. **Quality Gate Failure**: `pnpm run test` fails with exit code 1.

**Final Verdict**: `INTEGRITY VIOLATION` — The work product must be rejected until `clamav.scanner.ts` and `jwt.strategy.ts` are hardened and all automated unit tests pass cleanly.

---

## 5. Verification Method

To independently reproduce and verify this audit:

### 5.1 Reproduce ClamAV Fail-Open Vulnerability
```bash
pnpm --filter @erppreflight/api test
```
*Observed Failure*:
- `test/empirical_challenger1_stress.spec.ts:241` (`R3-C9: Checks behavior on response containing "OK" inside virus name`).
- `test/empirical_challenger1_stress.spec.ts:266` (`R3-C10: Checks behavior on "stream: NOT OK"`).

### 5.2 Reproduce JwtStrategy Crash
Inspect `apps/api/src/modules/auth/strategies/jwt.strategy.ts` line 18:
```typescript
return decodeURIComponent(match[1]); // Crashes on malformed cookie %ZZ
```

### 5.3 Verify Clean OPD Guard & Golden Fixture
```bash
py -m pytest services/analysis-python/tests -v
```
*Observed Result*: 489 passed in 0.92s.

### 5.4 Verify Anti-Facade Gate
```bash
node scripts/check-no-production-facades.mjs
```
*Observed Result*: `[PASS] All production facade & security checks PASSED cleanly!`

### 5.5 Invalidation Conditions for Verdict
The `INTEGRITY VIOLATION` verdict is invalidated and becomes `CLEAN` ONLY when:
1. `apps/api/src/modules/ingestion/clamav.scanner.ts` matches exact `stream: OK\n` or checks `FOUND` first with `/stream:\s*(.+)\s+FOUND/`, and ensures no response containing `'OK'` inside a virus name or `'NOT OK'` can ever return `isInfected: false`.
2. `apps/api/src/modules/auth/strategies/jwt.strategy.ts` wraps `decodeURIComponent` in a `try/catch` block returning `null` on error.
3. `pnpm run test` executes across the entire monorepo with 100% pass rate (0 failures).
