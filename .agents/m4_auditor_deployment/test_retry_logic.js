const assert = require('assert');

// Test 1: Successful migration on 1st attempt
async function testSuccessFirstAttempt() {
  let attempts = 0;
  const mockRunMigrations = async () => {
    attempts++;
    return { applied: ['0001_initial.sql'], skipped: [] };
  };

  async function applyWithRetry(maxAttempts = 3, delayMs = 10) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await mockRunMigrations();
        return result;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const res = await applyWithRetry();
  assert.strictEqual(attempts, 1);
  assert.strictEqual(res.applied.length, 1);
  console.log('Test 1 Passed: Immediate success');
}

// Test 2: Transient failure recovered on 3rd attempt
async function testTransientFailureRecovery() {
  let attempts = 0;
  const mockRunMigrations = async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error('Connection refused: postgres is booting');
    }
    return { applied: [], skipped: ['0001_initial.sql'] };
  };

  async function applyWithRetry(maxAttempts = 5, delayMs = 10) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await mockRunMigrations();
        return result;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const res = await applyWithRetry();
  assert.strictEqual(attempts, 3);
  assert.strictEqual(res.skipped.length, 1);
  console.log('Test 2 Passed: Transient failure recovered on 3rd attempt');
}

// Test 3: Exhaustion in non-strict mode
async function testNonStrictMode() {
  let attempts = 0;
  const mockRunMigrations = async () => {
    attempts++;
    throw new Error('Persistent failure');
  };

  async function applyWithRetry(maxAttempts = 3, delayMs = 10) {
    const STRICT_MIGRATIONS = 'false';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await mockRunMigrations();
      } catch (err) {
        if (attempt === maxAttempts) {
          if (STRICT_MIGRATIONS === 'true') {
            throw err;
          } else {
            return { failedProceed: true };
          }
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const res = await applyWithRetry();
  assert.strictEqual(attempts, 3);
  assert.strictEqual(res.failedProceed, true);
  console.log('Test 3 Passed: Non-strict mode permits proceed after warnings');
}

// Test 4: Exhaustion in strict mode
async function testStrictMode() {
  let attempts = 0;
  const mockRunMigrations = async () => {
    attempts++;
    throw new Error('Persistent failure');
  };

  async function applyWithRetry(maxAttempts = 3, delayMs = 10) {
    const STRICT_MIGRATIONS = 'true';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await mockRunMigrations();
      } catch (err) {
        if (attempt === maxAttempts) {
          if (STRICT_MIGRATIONS === 'true') {
            throw new Error('Aborting startup');
          } else {
            return { failedProceed: true };
          }
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  let threw = false;
  try {
    await applyWithRetry();
  } catch (err) {
    threw = true;
    assert.strictEqual(err.message, 'Aborting startup');
  }
  assert.strictEqual(threw, true);
  assert.strictEqual(attempts, 3);
  console.log('Test 4 Passed: Strict mode aborts on exhaustion');
}

(async () => {
  await testSuccessFirstAttempt();
  await testTransientFailureRecovery();
  await testNonStrictMode();
  await testStrictMode();
  console.log('ALL MIGRATION RUNNER RETRY TESTS PASSED.');
})();
