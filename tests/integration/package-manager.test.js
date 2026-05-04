/**
 * Integration tests for package manager detection
 *
 * Tests end-to-end package manager detection including:
 * - Lock file priority detection (pnpm > bun > yarn > npm)
 * - Environment variable overrides
 * - package.json packageManager field
 * - Project-specific configuration
 * - Global configuration fallback
 * - Default fallback
 *
 * Run with: node tests/integration/package-manager.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createIsolatedTestEnvironment
} = require('../lib/integration-helpers');
const { test, asyncTest, withEnv } = require('../lib/test-utils');

// Import the package manager module
const REPO_ROOT = path.join(__dirname, '..', '..');
const { getPackageManager, detectFromLockFile, detectFromPackageJson } = require(
  path.join(REPO_ROOT, 'scripts', 'lib', 'package-manager')
);

/**
 * Test: Lock file priority - pnpm has highest priority
 */
function testLockFilePriorityPnpm() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create multiple lock files
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(projectDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4');
    fs.writeFileSync(path.join(projectDir, 'yarn.lock'), '');

    // Detect
    const detected = detectFromLockFile(projectDir);

    // Assert - pnpm should win
    assert.strictEqual(detected, 'pnpm', 'pnpm should have highest priority');
  } finally {
    cleanup();
  }
}

/**
 * Test: Lock file priority - bun over yarn/npm
 */
function testLockFilePriorityBun() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create lock files (no pnpm)
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(projectDir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(projectDir, 'bun.lockb'), '');

    // Detect
    const detected = detectFromLockFile(projectDir);

    // Assert - bun should win over yarn/npm
    assert.strictEqual(detected, 'bun', 'bun should have priority over yarn and npm');
  } finally {
    cleanup();
  }
}

/**
 * Test: Lock file priority - yarn over npm
 */
function testLockFilePriorityYarn() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create lock files (no pnpm/bun)
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(projectDir, 'yarn.lock'), '');

    // Detect
    const detected = detectFromLockFile(projectDir);

    // Assert - yarn should win over npm
    assert.strictEqual(detected, 'yarn', 'yarn should have priority over npm');
  } finally {
    cleanup();
  }
}

/**
 * Test: Lock file detection - npm only
 */
function testLockFileDetectionNpm() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create only npm lock file
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), '{}');

    // Detect
    const detected = detectFromLockFile(projectDir);

    // Assert
    assert.strictEqual(detected, 'npm', 'Should detect npm from package-lock.json');
  } finally {
    cleanup();
  }
}

/**
 * Test: Lock file detection - no lock files
 */
function testLockFileDetectionNone() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // No lock files created

    // Detect
    const detected = detectFromLockFile(projectDir);

    // Assert
    assert.strictEqual(detected, null, 'Should return null when no lock files exist');
  } finally {
    cleanup();
  }
}

/**
 * Test: package.json packageManager field - pnpm with version
 */
function testPackageJsonFieldPnpm() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create package.json with packageManager field
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'test',
      packageManager: 'pnpm@8.6.0'
    }));

    // Detect
    const detected = detectFromPackageJson(projectDir);

    // Assert
    assert.strictEqual(detected, 'pnpm', 'Should detect pnpm from packageManager field');
  } finally {
    cleanup();
  }
}

/**
 * Test: package.json packageManager field - without version
 */
function testPackageJsonFieldNoVersion() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create package.json with packageManager field (no version)
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'test',
      packageManager: 'yarn'
    }));

    // Detect
    const detected = detectFromPackageJson(projectDir);

    // Assert
    assert.strictEqual(detected, 'yarn', 'Should detect yarn from packageManager field');
  } finally {
    cleanup();
  }
}

/**
 * Test: package.json with unknown package manager
 */
function testPackageJsonUnknownPM() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create package.json with unknown packageManager
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'test',
      packageManager: 'unknown-pm@1.0.0'
    }));

    // Detect
    const detected = detectFromPackageJson(projectDir);

    // Assert
    assert.strictEqual(detected, null, 'Should return null for unknown package manager');
  } finally {
    cleanup();
  }
}

/**
 * Test: Environment variable override
 */
async function testEnvironmentVariableOverride() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create lock files that would normally detect pnpm
    fs.writeFileSync(path.join(projectDir, 'pnpm-lock.yaml'), '');

    // Use withEnv helper to safely set and restore environment variable
    await withEnv('CLAUDE_PACKAGE_MANAGER', 'yarn', async () => {
      // Detect
      const result = getPackageManager({ projectDir });

      // Assert - environment variable should override lock file
      assert.strictEqual(result.name, 'yarn', 'Environment variable should override lock file');
      assert.strictEqual(result.source, 'environment', 'Source should be environment');
    });
  } finally {
    cleanup();
  }
}

/**
 * Test: Project-specific config overrides lock file
 */
function testProjectConfigOverride() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create lock file
    fs.writeFileSync(path.join(projectDir, 'pnpm-lock.yaml'), '');

    // Create project-specific config
    const claudeDir = path.join(projectDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'package-manager.json'),
      JSON.stringify({ packageManager: 'npm' })
    );

    // Detect
    const result = getPackageManager({ projectDir });

    // Assert - project config should override lock file
    assert.strictEqual(result.name, 'npm', 'Project config should override lock file');
    assert.strictEqual(result.source, 'project-config', 'Source should be project-config');
  } finally {
    cleanup();
  }
}

/**
 * Test: package.json field takes precedence over lock file
 */
function testPackageJsonOverridesLockFile() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create lock file
    fs.writeFileSync(path.join(projectDir, 'pnpm-lock.yaml'), '');

    // Create package.json with different PM
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'test',
      packageManager: 'yarn@3.0.0'
    }));

    // Detect
    const result = getPackageManager({ projectDir });

    // Assert - package.json should override lock file
    assert.strictEqual(result.name, 'yarn', 'package.json should override lock file');
    assert.strictEqual(result.source, 'package.json', 'Source should be package.json');
  } finally {
    cleanup();
  }
}

/**
 * Test: Lock file detection works
 */
function testLockFileDetection() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Create only lock file
    fs.writeFileSync(path.join(projectDir, 'yarn.lock'), '');

    // Detect
    const result = getPackageManager({ projectDir });

    // Assert
    assert.strictEqual(result.name, 'yarn', 'Should detect yarn from lock file');
    assert.strictEqual(result.source, 'lock-file', 'Source should be lock-file');
  } finally {
    cleanup();
  }
}

/**
 * Test: Default to npm when nothing detected
 */
function testDefaultToNpm() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // No lock files, no config, no package.json

    // Detect
    const result = getPackageManager({ projectDir });

    // Assert
    assert.strictEqual(result.name, 'npm', 'Should default to npm');
    assert.strictEqual(result.source, 'default', 'Source should be default');
    assert.ok(result.config, 'Should have config object');
    assert.strictEqual(result.config.name, 'npm');
  } finally {
    cleanup();
  }
}

/**
 * Test: Full detection priority chain
 */
async function testFullDetectionPriority() {
  const { projectDir, homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Set up complete detection chain
    // 2. Project config
    const claudeDir = path.join(projectDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'package-manager.json'),
      JSON.stringify({ packageManager: 'yarn' })
    );

    // 3. package.json
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@8.0.0'
    }));

    // 4. Lock file
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), '{}');

    // Use withEnv to test env var priority (highest priority)
    await withEnv('CLAUDE_PACKAGE_MANAGER', 'bun', async () => {
      // Detect - env var should win
      const result = getPackageManager({ projectDir });

      // Assert
      assert.strictEqual(result.name, 'bun', 'Environment variable should have highest priority');
      assert.strictEqual(result.source, 'environment');
    });
  } finally {
    cleanup();
  }
}

/**
 * Test: All package managers detected correctly
 */
function testAllPackageManagersDetected() {
  const managers = ['npm', 'pnpm', 'yarn', 'bun'];
  const lockFiles = {
    npm: 'package-lock.json',
    pnpm: 'pnpm-lock.yaml',
    yarn: 'yarn.lock',
    bun: 'bun.lockb'
  };

  for (const pm of managers) {
    const { projectDir, cleanup } = createIsolatedTestEnvironment();

    try {
      // Create lock file for this PM
      fs.writeFileSync(path.join(projectDir, lockFiles[pm]), '');

      // Detect
      const detected = detectFromLockFile(projectDir);

      // Assert
      assert.strictEqual(detected, pm, `Should detect ${pm} from ${lockFiles[pm]}`);
    } finally {
      cleanup();
    }
  }

  return true; // All passed
}

async function runTests() {
  console.log('\n=== Integration Tests: Package Manager Detection ===\n');
  let passed = 0;
  let failed = 0;

  console.log('Lock File Priority Detection:');
  if (test('pnpm has highest priority', testLockFilePriorityPnpm)) {
    passed++;
  } else {
    failed++;
  }

  if (test('bun priority over yarn/npm', testLockFilePriorityBun)) {
    passed++;
  } else {
    failed++;
  }

  if (test('yarn priority over npm', testLockFilePriorityYarn)) {
    passed++;
  } else {
    failed++;
  }

  if (test('npm detection', testLockFileDetectionNpm)) {
    passed++;
  } else {
    failed++;
  }

  if (test('no lock files returns null', testLockFileDetectionNone)) {
    passed++;
  } else {
    failed++;
  }

  console.log('\npackage.json packageManager Field:');
  if (test('detects pnpm with version', testPackageJsonFieldPnpm)) {
    passed++;
  } else {
    failed++;
  }

  if (test('detects yarn without version', testPackageJsonFieldNoVersion)) {
    passed++;
  } else {
    failed++;
  }

  if (test('returns null for unknown PM', testPackageJsonUnknownPM)) {
    passed++;
  } else {
    failed++;
  }

  console.log('\nDetection Priority Chain:');
  if (await asyncTest('environment variable override', testEnvironmentVariableOverride)) {
    passed++;
  } else {
    failed++;
  }

  if (test('project config overrides lock file', testProjectConfigOverride)) {
    passed++;
  } else {
    failed++;
  }

  if (test('package.json overrides lock file', testPackageJsonOverridesLockFile)) {
    passed++;
  } else {
    failed++;
  }

  if (test('lock file detection works', testLockFileDetection)) {
    passed++;
  } else {
    failed++;
  }

  if (test('defaults to npm', testDefaultToNpm)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('full detection priority chain', testFullDetectionPriority)) {
    passed++;
  } else {
    failed++;
  }

  console.log('\nComprehensive Tests:');
  if (test('all package managers detected', testAllPackageManagersDetected)) {
    passed++;
  } else {
    failed++;
  }

  console.log(`\nPassed: ${passed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
