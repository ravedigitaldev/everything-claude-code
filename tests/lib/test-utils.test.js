/**
 * Tests for test-utils.js
 *
 * Run with: node tests/lib/test-utils.test.js
 */

const assert = require('assert');
const { test, asyncTest, withEnv, withEnvVars, measureTime } = require('./test-utils');

// Use the test functions to test themselves (meta!)
function metaTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

async function metaAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

async function runTests() {
  console.log('\n=== Testing test-utils.js ===\n');
  let passed = 0;
  let failed = 0;

  console.log('test() function:');

  if (metaTest('test() returns true for passing test', () => {
    const result = test('sample passing test', () => {
      assert.strictEqual(1, 1);
    });
    assert.strictEqual(result, true);
  })) passed++; else failed++;

  if (metaTest('test() returns false for failing test', () => {
    const result = test('sample failing test', () => {
      assert.strictEqual(1, 2); // This will fail
    });
    assert.strictEqual(result, false);
  })) passed++; else failed++;

  console.log('\nasyncTest() function:');

  if (await metaAsyncTest('asyncTest() returns true for passing async test', async () => {
    const result = await asyncTest('sample async test', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.strictEqual(1, 1);
    });
    assert.strictEqual(result, true);
  })) passed++; else failed++;

  if (await metaAsyncTest('asyncTest() returns false for failing async test', async () => {
    const result = await asyncTest('sample async failing test', async () => {
      assert.strictEqual(1, 2);
    });
    assert.strictEqual(result, false);
  })) passed++; else failed++;

  if (await metaAsyncTest('asyncTest() handles timeout', async () => {
    const result = await asyncTest('timeout test', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    }, { timeout: 50 });
    assert.strictEqual(result, false, 'Should fail on timeout');
  })) passed++; else failed++;

  console.log('\nwithEnv() function:');

  if (await metaAsyncTest('withEnv() sets and restores env var', async () => {
    const original = process.env.TEST_VAR;

    await withEnv('TEST_VAR', 'test-value', async () => {
      assert.strictEqual(process.env.TEST_VAR, 'test-value');
    });

    assert.strictEqual(process.env.TEST_VAR, original);
  })) passed++; else failed++;

  if (await metaAsyncTest('withEnv() removes env var if undefined', async () => {
    process.env.TEST_VAR = 'initial';

    await withEnv('TEST_VAR', undefined, async () => {
      assert.strictEqual(process.env.TEST_VAR, undefined);
    });

    assert.strictEqual(process.env.TEST_VAR, 'initial');
  })) passed++; else failed++;

  if (await metaAsyncTest('withEnv() restores even on error', async () => {
    process.env.TEST_VAR = 'original';

    try {
      await withEnv('TEST_VAR', 'temporary', async () => {
        throw new Error('Test error');
      });
    } catch (err) {
      // Expected
    }

    assert.strictEqual(process.env.TEST_VAR, 'original');
  })) passed++; else failed++;

  console.log('\nwithEnvVars() function:');

  if (await metaAsyncTest('withEnvVars() sets multiple env vars', async () => {
    await withEnvVars({ VAR1: 'value1', VAR2: 'value2' }, async () => {
      assert.strictEqual(process.env.VAR1, 'value1');
      assert.strictEqual(process.env.VAR2, 'value2');
    });

    assert.strictEqual(process.env.VAR1, undefined);
    assert.strictEqual(process.env.VAR2, undefined);
  })) passed++; else failed++;

  if (await metaAsyncTest('withEnvVars() restores multiple env vars', async () => {
    process.env.VAR1 = 'original1';
    process.env.VAR2 = 'original2';

    await withEnvVars({ VAR1: 'temp1', VAR2: 'temp2' }, async () => {
      assert.strictEqual(process.env.VAR1, 'temp1');
    });

    assert.strictEqual(process.env.VAR1, 'original1');
    assert.strictEqual(process.env.VAR2, 'original2');

    delete process.env.VAR1;
    delete process.env.VAR2;
  })) passed++; else failed++;

  console.log('\nmeasureTime() function:');

  if (await metaAsyncTest('measureTime() returns result and duration', async () => {
    const { result, duration } = await measureTime(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return 'test-result';
    });

    assert.strictEqual(result, 'test-result');
    assert.ok(duration >= 50, `Duration should be >= 50ms, got ${duration}ms`);
    assert.ok(duration < 200, `Duration should be < 200ms, got ${duration}ms`);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
