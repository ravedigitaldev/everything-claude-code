/**
 * Shared test utilities for ECC test suite
 *
 * Provides common test helpers used across unit and integration tests:
 * - Test execution wrappers (test, asyncTest)
 * - Test runner creation
 * - Environment variable management
 * - Timing and metrics
 */

/**
 * Synchronous test wrapper
 *
 * @param {string} name - Test name
 * @param {Function} fn - Test function
 * @returns {boolean} True if test passed
 */
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    if (err.stack) {
      const stackLines = err.stack.split('\n').slice(1, 3);
      console.log(`    ${stackLines.join('\n    ')}`);
    }
    return false;
  }
}

/**
 * Asynchronous test wrapper with optional timeout
 *
 * @param {string} name - Test name
 * @param {Function} fn - Async test function
 * @param {object} [options] - Options
 * @param {number} [options.timeout] - Timeout in milliseconds (default: 30000)
 * @returns {Promise<boolean>} True if test passed
 */
async function asyncTest(name, fn, options = {}) {
  const { timeout = 30000 } = options;

  try {
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout);
    });

    // Race test execution against timeout
    await Promise.race([fn(), timeoutPromise]);

    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    if (err.stack) {
      const stackLines = err.stack.split('\n').slice(1, 3);
      console.log(`    ${stackLines.join('\n    ')}`);
    }
    return false;
  }
}

/**
 * Create a test runner with pass/fail tracking
 *
 * @param {string} suiteName - Name of the test suite
 * @returns {object} Test runner with run() and finish() methods
 */
function createTestRunner(suiteName) {
  let passed = 0;
  let failed = 0;
  const startTime = Date.now();

  return {
    /**
     * Run a synchronous test
     */
    test: (name, fn) => {
      if (test(name, fn)) {
        passed++;
      } else {
        failed++;
      }
    },

    /**
     * Run an asynchronous test
     */
    asyncTest: async (name, fn, options) => {
      if (await asyncTest(name, fn, options)) {
        passed++;
      } else {
        failed++;
      }
    },

    /**
     * Get current stats
     */
    getStats: () => ({ passed, failed, total: passed + failed }),

    /**
     * Finish test suite and exit
     */
    finish: () => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\nPassed: ${passed} | Failed: ${failed} | Duration: ${duration}s`);
      process.exit(failed > 0 ? 1 : 0);
    }
  };
}

/**
 * Execute function with temporary environment variable
 *
 * Safely sets environment variable, runs function, then restores original value
 *
 * @param {string} key - Environment variable name
 * @param {string} value - Value to set
 * @param {Function} fn - Function to execute (sync or async)
 * @returns {*} Return value of fn
 */
async function withEnv(key, value, fn) {
  const original = process.env[key];
  const hadOriginal = key in process.env;

  try {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    return await fn();
  } finally {
    if (hadOriginal) {
      process.env[key] = original;
    } else {
      delete process.env[key];
    }
  }
}

/**
 * Execute function with multiple temporary environment variables
 *
 * @param {object} env - Object of environment variables to set
 * @param {Function} fn - Function to execute (sync or async)
 * @returns {*} Return value of fn
 */
async function withEnvVars(env, fn) {
  const original = {};
  const keys = Object.keys(env);

  // Save originals
  for (const key of keys) {
    if (key in process.env) {
      original[key] = process.env[key];
    }
  }

  try {
    // Set new values
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return await fn();
  } finally {
    // Restore originals
    for (const key of keys) {
      if (key in original) {
        process.env[key] = original[key];
      } else {
        delete process.env[key];
      }
    }
  }
}

/**
 * Measure execution time of a function
 *
 * @param {Function} fn - Function to time (sync or async)
 * @returns {Promise<{result: *, duration: number}>} Result and duration in ms
 */
async function measureTime(fn) {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

module.exports = {
  test,
  asyncTest,
  createTestRunner,
  withEnv,
  withEnvVars,
  measureTime
};
