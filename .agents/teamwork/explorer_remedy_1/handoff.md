# Handoff Report: Item 1 ClamAV Scanner Detection Order & Fail-Closed Hardening

> **Agent**: Explorer Remedy 1 (`teamwork_preview_explorer`)  
> **Working Directory**: `H:/erppreflight/.agents/teamwork/explorer_remedy_1`  
> **Target Scope**: Item 1 (ClamAV Scanner detection order & fail-closed security)  
> **Target File**: `apps/api/src/modules/ingestion/clamav.scanner.ts`  
> **Test Files**: `apps/api/test/empirical_challenger1_stress.spec.ts`, `apps/api/test/ingestion_security.spec.ts`  
> **Governing Standards**: `AGENTS.md` (Cardinal Axioms 1 & 2), `ORIGINAL_REQUEST.md` (R3)  
> **Timestamp**: 2026-09-24T21:53:00Z  

---

## 1. Observation

### 1.1 Root Cause in `apps/api/src/modules/ingestion/clamav.scanner.ts`
Direct inspection of `apps/api/src/modules/ingestion/clamav.scanner.ts` lines 80–103 reveals:

```typescript
80:       socket.on('end', () => {
81:         const duration = Date.now() - startTime;
82:         const trimmed = response.trim();
83: 
84:         if (trimmed.includes('OK')) {
85:           safeResolve({ isInfected: false, scanDurationMs: duration });
86:         } else if (trimmed.includes('FOUND')) {
87:           const match = trimmed.match(/stream:\s*(.+)\s+FOUND/);
88:           const virus = match ? match[1] : 'UNKNOWN_VIRUS';
89:           safeResolve({ isInfected: true, virusName: virus, scanDurationMs: duration });
90:         } else {
91:           if (!this.isMockMode) {
92:             this.logger.error(`ClamAV unexpected response: ${trimmed} - failing closed`);
93:             safeResolve({
94:               isInfected: true,
95:               virusName: 'SCAN_FAILED_UNRECOGNIZED_RESPONSE',
96:               scanDurationMs: duration,
97:             });
98:           } else {
99:             this.logger.warn(`ClamAV unexpected response: ${trimmed}, falling back to mock check`);
100:             safeResolve(this.mockScan(buffer, startTime));
101:           }
102:         }
103:       });
```

Line 84 executes `if (trimmed.includes('OK'))` **before** checking line 86 `else if (trimmed.includes('FOUND'))`.

### 1.2 Verbatim Empirical Test Failure in `apps/api/test/empirical_challenger1_stress.spec.ts`
Execution of `pnpm --filter @erppreflight/api test` reveals two test failures directly caused by this detection order:

```text
 FAIL  test/empirical_challenger1_stress.spec.ts > Empirical Challenger 1: R3 (ClamAV Fail-Closed Security) > R3-C9 (Adversarial stress): Checks behavior on response containing "OK" inside virus name or negative response
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ test/empirical_challenger1_stress.spec.ts:241:33
    239|       // CRITICAL CHECK: Does a virus with "OK" in its name get detected as infected,
    240|       // or does `trimmed.includes('OK')` cause it to pass as clean?!
    241|       expect(result.isInfected).toBe(true);
       |                                 ^
    242|       expect(result.virusName).toBe(virusName);
    243|     } finally {

 FAIL  test/empirical_challenger1_stress.spec.ts > Empirical Challenger 1: R3 (ClamAV Fail-Closed Security) > R3-C10 (Adversarial stress): Checks behavior on "stream: NOT OK" or "STATUS_NOK"
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ test/empirical_challenger1_stress.spec.ts:266:33
    264| 
    265|       // "stream: NOT OK" should NOT be classified as clean!
    266|       expect(result.isInfected).toBe(true);
       |                                 ^
    267|     } finally {
```

### 1.3 Baseline Ingestion Security Tests in `apps/api/test/ingestion_security.spec.ts`
Lines 166–293 test ClamAV behaviors:
- Lines 180–192: Unreachable socket (`ECONNREFUSED`) -> `SCAN_FAILED_CONNECTION_ERROR` (passes)
- Lines 193–215: Socket timeout -> `SCAN_FAILED_TIMEOUT` (passes)
- Lines 217–241: Unexpected response `ERROR: COMMAND_UNRECOGNIZED` -> `SCAN_FAILED_UNRECOGNIZED_RESPONSE` (passes)
- Lines 243–266: Response `stream: OK\n` -> `isInfected: false` (passes)
- Lines 268–293: Response `stream: Win.Trojan.Custom-42 FOUND\n` -> `isInfected: true`, `virusName: 'Win.Trojan.Custom-42'` (passes)

---

## 2. Logic Chain

1. **Protocol Response Format**:
   - In ClamAV clamd daemon protocol (`zINSTREAM`), malware findings follow the pattern `stream: <virus_signature> FOUND\n`.
   - Clean file responses follow the pattern `stream: OK\n`.
   - Errors follow patterns such as `INSTREAM size limit exceeded. ERROR\n`, `COMMAND READ TIMED OUT`, or other unhandled messages.
2. **Evaluation Precedence Flaw**:
   - Line 84 evaluated `if (trimmed.includes('OK'))` as the first branch.
   - Any virus name containing the letters `'OK'` (such as `Win32.Malware.OK_Variant` in R3-C9, `Trojan.Banker.OK`, etc.) causes `trimmed.includes('OK')` to evaluate to `true`.
   - Consequently, line 85 immediately resolves `{ isInfected: false }`. Line 86 (`FOUND`) is never evaluated.
3. **Negative Status Substring Collision**:
   - Any non-standard daemon or proxy negative response such as `stream: NOT OK` or `STATUS_NOK` contains the substring `'OK'`.
   - Furthermore, `'STATUS_NOK'.endsWith('OK')` evaluates to `true` in JavaScript because the last two characters of `NOK` are `'O'` and `'K'`.
   - When line 84 evaluated `includes('OK')`, `stream: NOT OK` resolved clean (`isInfected: false`).
4. **Remediation Invariants**:
   - **Invariant 1**: Any response containing `'FOUND'` represents an explicit virus detection and MUST be evaluated first.
   - **Invariant 2**: A clean response must strictly be `stream: OK` or end with `OK` while explicitly excluding `'FOUND'`, `'ERROR'`, `'NOT OK'`, and `'NOK'`.
   - **Invariant 3**: Any other response when `!this.isMockMode` must fail closed with `SCAN_FAILED_UNRECOGNIZED_RESPONSE`.

---

## 3. Caveats

- **Mock Mode**: When `CLAMAV_MOCK_MODE=true`, `scanBuffer` short-circuits via line 28 to `mockScan(buffer, startTime)` without opening a TCP socket. The socket handling logic applies strictly when `CLAMAV_MOCK_MODE=false`.
- **Item 2 Isolation**: The third failure in `apps/api/test/empirical_challenger1_stress.spec.ts` (`R4-C8`: URIError in `jwt.strategy.ts`) is part of Item 2. Fixing Item 1 in `clamav.scanner.ts` resolves failures R3-C9 and R3-C10; R4-C8 requires the separate Item 2 fix in `jwt.strategy.ts`.
- No caveats regarding ClamAV stream parsing itself; all known ClamAV protocol response permutations are accounted for.

---

## 4. Conclusion & Precise Code Fix

### 4.1 Target File & Exact Line Replacement
- **File**: `apps/api/src/modules/ingestion/clamav.scanner.ts`
- **Lines**: 84–90

#### Before:
```typescript
        if (trimmed.includes('OK')) {
          safeResolve({ isInfected: false, scanDurationMs: duration });
        } else if (trimmed.includes('FOUND')) {
          const match = trimmed.match(/stream:\s*(.+)\s+FOUND/);
          const virus = match ? match[1] : 'UNKNOWN_VIRUS';
          safeResolve({ isInfected: true, virusName: virus, scanDurationMs: duration });
        } else {
```

#### After:
```typescript
        // 1. Check for virus detection FIRST to prevent substring false-clean matches
        if (trimmed.includes('FOUND')) {
          const match = trimmed.match(/stream:\s*(.+)\s+FOUND/);
          const virus = match
            ? match[1].trim()
            : trimmed.replace(/^stream:\s*/, '').replace(/\s+FOUND$/, '').trim() || 'UNKNOWN_VIRUS';
          safeResolve({ isInfected: true, virusName: virus, scanDurationMs: duration });
        } else if (
          // 2. Clean files require exact 'stream: OK' or ending with 'OK' without 'FOUND', 'ERROR', 'NOT OK', or 'NOK'
          trimmed === 'stream: OK' ||
          (trimmed.endsWith('OK') &&
            !trimmed.endsWith('NOK') &&
            !trimmed.includes('ERROR') &&
            !trimmed.includes('NOT OK'))
        ) {
          safeResolve({ isInfected: false, scanDurationMs: duration });
        } else {
```

### 4.2 Artifacts Produced
1. **Diff Patch**: `H:/erppreflight/.agents/teamwork/explorer_remedy_1/clamav.scanner.patch`
2. **Full Replacement File**: `H:/erppreflight/.agents/teamwork/explorer_remedy_1/proposed_clamav.scanner.ts`

---

## 5. Verification Method

### 5.1 Verification Commands
To verify after the patch is applied:

1. **Verify Challenger 1 Stress Spec (R3 ClamAV Suite)**:
   ```bash
   pnpm --filter @erppreflight/api test test/empirical_challenger1_stress.spec.ts
   ```
   *Expected Result*: R3-C1 through R3-C10 all pass (10/10).

2. **Verify Ingestion Security Spec**:
   ```bash
   pnpm --filter @erppreflight/api test test/ingestion_security.spec.ts
   ```
   *Expected Result*: All 22 tests pass cleanly (100%).

3. **Verify Challenger Boundaries Spec**:
   ```bash
   pnpm --filter @erppreflight/api test test/m2_challenger_boundaries.spec.ts
   ```
   *Expected Result*: All 29 tests pass cleanly (100%).

### 5.2 Invalidation Conditions
This remedy is invalidated if:
1. A virus signature containing `OK` (e.g. `stream: Win32.Malware.OK_Variant FOUND`) evaluates to `isInfected: false`.
2. A negative response (e.g. `stream: NOT OK` or `STATUS_NOK`) evaluates to `isInfected: false`.
3. A clean response (e.g. `stream: OK`) fails to resolve `isInfected: false`.
4. Any error string in production mode (`!this.isMockMode`) fails to resolve `isInfected: true` with `SCAN_FAILED_UNRECOGNIZED_RESPONSE`.
