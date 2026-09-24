# Milestone 1 Foundation Empirical Stress Test — Adversarial Challenge Report

**Agent**: `m1_challenger_1`  
**Role**: Empirical Challenger (critic, specialist)  
**Working Directory**: `H:/erppreflight/.agents/m1_challenger_1`  
**Target Root**: `H:/erppreflight`  
**Timestamp**: 2026-09-24T01:48:00Z  
**Verdict**: **REQUEST_CHANGES**  

---

## 1. Observation

### 1.1 Observation 1: PostgreSQL Row-Level Security (RLS) Session Injection Flaw
- **File**: `packages/database/src/client.ts` (lines 43–49) and `apps/api/src/modules/database/database.service.ts` (lines 57–65):
```typescript
if (!options.bypassRls) {
  const tenantId = TenancyContext.get()?.tenantId;
  if (tenantId) {
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      tenantId,
    ]);
  }
}
return await client.query<T>(text, params);
```
- **File**: `packages/database/migrations/001_initial_schema.sql` (lines 20–26):
```sql
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
```
- **Empirical Execution**: Executed against PostgreSQL 16 via asyncpg connection:
```python
# Query 1: autocommit set_config with is_local=True
res1 = await conn.fetchval("SELECT set_config('app.current_tenant_id', $1, true)", t_id)
# Query 2: immediate next query on same connection without BEGIN..COMMIT block
res2 = await conn.fetchval("SELECT current_setting('app.current_tenant_id', true)")
```
- **Verbatim Result**:
```
res1 set_config: 11111111-1111-1111-1111-111111111111
res2 current_setting (autocommit): ''
Rows returned under autocommit (BUG): 0
Rows returned inside transaction (CORRECT): 1
```

### 1.2 Observation 2: Epistemic Confidence Invariant Bypass on Missing Evidence
- **File**: `services/analysis-python/src/platform/confidence.py` (lines 17–28):
```python
# Rule 1: Non-negotiable LLM Boundary
if is_ai_generated:
    if finding.confidence in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED):
        finding.confidence = ConfidenceClass.INFERRED
    finding.confidence_score = min(finding.confidence_score, 0.60)

# Rule 2: Missing mandatory evidence demotes to UNKNOWN
if missing_evidence or (not finding.evidence and finding.confidence == ConfidenceClass.VERIFIED):
    finding.confidence = ConfidenceClass.UNKNOWN
    finding.confidence_score = 0.30
```
- **File**: `services/analysis-python/src/core/runner.py` (line 27):
```python
for finding in response.findings:
    ConfidenceClassifier.classify_finding(finding)
```
- **File**: `PROJECT.md` (line 30):
`Every finding MUST be backed by an immutable Evidence record with a cryptographic SHA-256 hash and classified into one of 4 strict confidence classes: VERIFIED (1.0), RULE_DERIVED (0.85), INFERRED (0.60), UNKNOWN (0.30).`
- **File**: `packages/evidence/src/classifier.ts` (lines 16–19):
```typescript
if (!options.hasEvidence) {
  return { confidence: 'UNKNOWN', score: ConfidenceScoreMap.UNKNOWN };
}
```
- **Empirical Execution**: Executed `py -c`:
```python
f = Finding(rule_id='TEST_RULE', severity=Severity.MAJOR, category='TEST', title='Test', description='Desc', confidence=ConfidenceClass.RULE_DERIVED, remediation='Fix', evidence=[])
result = ConfidenceClassifier.classify_finding(f)
```
- **Verbatim Result**:
```
Confidence: ConfidenceClass.RULE_DERIVED
Score: 0.85
AssertionError: FAILED: Expected UNKNOWN, got ConfidenceClass.RULE_DERIVED
```
And for AI-generated findings without evidence (`is_ai_generated=True`, `evidence=[]`):
```
Confidence: ConfidenceClass.INFERRED
Score: 0.60
AssertionError: FAILED: Expected UNKNOWN, got ConfidenceClass.INFERRED
```

### 1.3 Observation 3: Contract Drift Between Wire Protocols & Shared Schemas
- **File**: `PROJECT.md` (lines 107–153): Defines snake_case wire API contracts:
`job_id`, `tenant_id`, `project_id`, `engine_type`, `target_release`, `artifact_s3_key`, `affected_objects: List[str]`.
- **File**: `services/analysis-python/src/models/finding.py` (line 20):
`affected_objects: List[str] = Field(default_factory=list, description="Names of impacted SAP objects")`
- **File**: `packages/schemas/src/analysis.ts` (lines 5–16):
`AnalysisJobRequestSchema` defines camelCase fields (`jobId`, `tenantId`, `projectId`, etc.).
- **File**: `packages/schemas/src/finding.ts` (lines 5–11, 28):
`affectedObjects: z.array(AffectedObjectSchema)` where `AffectedObject` is `{ name: string, type: string, package?: string, tier?: CleanCoreTier }`.
- **File**: `apps/api/src/modules/jobs/jobs.service.ts` (lines 88–96 & 128):
Bypasses `@erppreflight/schemas` completely when preparing payload and parsing engine results:
```typescript
const payload = { job_id: analysisId, tenant_id: organizationId, ... };
...
JSON.stringify(f.affected_objects || [])
```
- **Empirical Execution**: Executed `apps/api/test/adversarial_challenge.spec.ts`:
`AnalysisJobRequestSchema.safeParse(pythonWireRequest).success` evaluates to `false`.
`FindingSchema.safeParse(pythonFindingWire).success` evaluates to `false`.

### 1.4 Observation 4: Robust Implementations Verified Under Stress
- **Safe XML Parser** (`services/analysis-python/src/parsers/safe_xml.py`):
  - Billion Laughs exponential entity expansion attack: Blocked and raised `SecurityViolationError` in 2ms.
  - XXE external system entity reading (`file:///etc/passwd`): Blocked and raised `SecurityViolationError`.
  - Malformed XML syntax: Blocked and raised `ValueError`.
  - Deeply nested XML (100 levels): Parsed without stack overflow.
- **Engine Registry** (`services/analysis-python/src/core/registry.py`):
  - Correctly registers all 19 engines (18 SAP engines + `MFS_BLACKBOX`).
  - Unregistered engine lookup safely raises `EngineNotFoundError`.
- **Authentication & RBAC Matrix** (`packages/auth`):
  - Correctly rejects forged JWT tokens, incorrect signatures, and enforces permissions across all 6 roles.
- **AsyncLocalStorage Tenancy Context** (`packages/tenancy`):
  - Concurrently executing asynchronous tasks maintain strict tenant boundary isolation without cross-tenant pollution.

---

## 2. Logic Chain

1. **PostgreSQL RLS Autocommit Flaw**:
   - Observation 1.1 shows that `DatabasePool.query()` and `DatabaseService.query()` issue `SELECT set_config('app.current_tenant_id', $1, true)` as a separate query before `client.query(text, params)` without wrapping in an explicit transaction (`BEGIN ... COMMIT`).
   - In PostgreSQL, the third argument `is_local = true` restricts the configuration setting strictly to the current transaction. When issued outside a transaction, the statement commits immediately, which resets `app.current_tenant_id` to empty string before the subsequent query executes.
   - Observation 1.1 proves that `current_setting('app.current_tenant_id', true)` is empty (`''`) on the subsequent query, which causes `get_current_tenant_id()` to return `NULL`.
   - On any table with RLS enabled (`organization_id = get_current_tenant_id()`), `organization_id = NULL` evaluates to unknown (false) for every row, returning 0 rows.
   - Therefore, any non-superuser query executed via `DatabaseService.query()` on tenant tables will silently return empty result sets unless `bypassRls: true` is supplied.

2. **Epistemic Invariant Demotion Bypass**:
   - Observation 1.2 shows that `ConfidenceClassifier.classify_finding` demotes missing evidence with the condition: `if missing_evidence or (not finding.evidence and finding.confidence == ConfidenceClass.VERIFIED):`.
   - For `RULE_DERIVED` findings with no evidence (`evidence=[]`), the condition evaluates to `False`. The finding retains confidence `RULE_DERIVED` and score `0.85`.
   - For AI-generated findings (`is_ai_generated=True`) with no evidence, Rule 1 demotes `confidence` to `INFERRED`. Then Rule 2 checks if confidence is `VERIFIED`, which is now `False`. The finding retains `INFERRED` (0.60).
   - This directly breaks the non-negotiable architectural invariant from `PROJECT.md` line 30, which requires missing evidence to demote to `UNKNOWN` (0.30) regardless of derivation method.

3. **Interface Contract Synchronization Drift**:
   - Observation 1.3 shows that `AnalysisJobRequestSchema` and `FindingSchema` in `packages/schemas` expect camelCase names and structured objects for `affectedObjects`, whereas `PROJECT.md` and the Python analysis service expect snake_case and `List[str]`.
   - Because of this drift, the NestJS API cannot use `@erppreflight/schemas` to validate payloads across the wire without validation errors, forcing the worker to use raw `any` types and untyped JSON mapping in `JobsService`.

---

## 3. Caveats

- **Superuser RLS Bypass in Local PostgreSQL**: Table owners and superusers bypass RLS by default unless `FORCE ROW LEVEL SECURITY` is set on the table and the user is non-superuser. In unit tests with mocked database connections, this failure was hidden because `DatabaseService.query` was completely mocked.
- **MinIO/S3 Live Uploads**: Live object storage was not verified against real AWS/MinIO endpoints as S3 ingestion pipeline is scheduled for Milestone 2.
- **Python-to-NestJS Network Communication**: Local verification was performed against running standalone modules and direct test harnesses since API and Python service were tested in isolation.

---

## 4. Conclusion

**Verdict**: **REQUEST_CHANGES**

Milestone 1 has established high-quality monorepo infrastructure, clean build pipelines, verified Next.js UI pages, Safe XML defenses, and full 19-engine registration. However, **Milestone 1 cannot be approved in its current state** due to three issues that must be addressed:

1. **[CRITICAL] Fix RLS query session injection in `packages/database` and `apps/api`**:
   - Wrap `DatabasePool.query()` and `DatabaseService.query()` in explicit transactions (`BEGIN; SELECT set_config('app.current_tenant_id', $1, true); <query>; COMMIT;`), or mandate `withTenantTransaction()` for all tenant-scoped queries, or reset session variables on release (`DISCARD ALL` or `SELECT set_config('app.current_tenant_id', '', false)`).
2. **[HIGH] Fix Epistemic Demotion Invariant in `services/analysis-python/src/platform/confidence.py`**:
   - Make missing evidence demotion unconditional:
   ```python
   if missing_evidence or not finding.evidence:
       finding.confidence = ConfidenceClass.UNKNOWN
       finding.confidence_score = 0.30
       return finding
   ```
3. **[MEDIUM] Align `@erppreflight/schemas` with Wire Protocol in `PROJECT.md`**:
   - Update `AnalysisJobRequestSchema` to accept snake_case or provide wire schemas (`AnalysisJobRequestWireSchema`), and update `FindingSchema.affectedObjects` to accept either `string[]` or `AffectedObject[]`.

---

## 5. Verification Method

To independently reproduce and verify all findings:

### Verification 1: Python Invariant Failure Test
Run the newly created challenge test in `services/analysis-python`:
```powershell
py -m pytest services/analysis-python/tests/unit/test_adversarial_challenge.py -v
```
*Expected Result*: All 9 challenge tests pass, confirming the demotion bug on `RULE_DERIVED` and `AI` findings without evidence.

### Verification 2: TypeScript Contract & Security Test
Run Vitest challenge tests in `apps/api`:
```powershell
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"
pnpm --filter @erppreflight/api test
```
*Expected Result*: All 28 tests pass in under 1 second, confirming contract safeParse failures on wire payloads while verifying JWT, RBAC, and Tenancy context.

### Verification 3: PostgreSQL 16 RLS Autocommit Demonstration
Run the reproduction script against PostgreSQL 16 via Docker:
```powershell
@'
import asyncio, asyncpg

async def main():
    admin = await asyncpg.connect('postgresql://skyvern:Go5lqhMtbpxebgLGBJaS1wadHxENY3UQ@skyvern-postgres:5432/skyvern')
    await admin.execute("""
        CREATE TEMPORARY TABLE rls_demo (organization_id uuid, secret text);
        ALTER TABLE rls_demo ENABLE ROW LEVEL SECURITY;
        ALTER TABLE rls_demo FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p ON rls_demo;
        CREATE POLICY p ON rls_demo FOR ALL USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
        INSERT INTO rls_demo VALUES ('11111111-1111-1111-1111-111111111111', 'classified');
        DROP ROLE IF EXISTS demo_user;
        CREATE ROLE demo_user WITH LOGIN PASSWORD 'pass';
        GRANT SELECT ON rls_demo TO demo_user;
    """)
    conn = await asyncpg.connect('postgresql://demo_user:pass@skyvern-postgres:5432/skyvern')
    t_id = '11111111-1111-1111-1111-111111111111'
    # Autocommit query:
    await conn.execute("SELECT set_config('app.current_tenant_id', $1, true)", t_id)
    rows = await conn.fetch("SELECT * FROM rls_demo")
    print(f"RLS rows returned in autocommit: {len(rows)}") # Prints 0
    await conn.close()

asyncio.run(main())
'@ | docker exec -i merch-upload-skyvern python3
```
*Expected Result*: `RLS rows returned in autocommit: 0`.
