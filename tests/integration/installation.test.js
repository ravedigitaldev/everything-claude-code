/**
 * Integration tests for installation system
 *
 * Tests end-to-end installation workflows including:
 * - Legacy language mode
 * - Profile-based installation
 * - Incremental module installation
 * - Multi-target installation
 * - Install state persistence
 *
 * Run with: node tests/integration/installation.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createIsolatedTestEnvironment,
  runInstallScript,
  assertFilesExist,
  readInstallState
} = require('../lib/integration-helpers');

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    if (err.stack) {
      console.log(`    ${err.stack.split('\n').slice(1, 3).join('\n    ')}`);
    }
    return false;
  }
}

/**
 * Test: Fresh TypeScript installation creates all expected files
 */
async function testFreshTypeScriptInstallation() {
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Act
    const result = await runInstallScript(['typescript'], { homeDir, projectDir });

    // Assert - install should succeed
    assert.strictEqual(result.code, 0, `Install should succeed. stderr: ${result.stderr}`);

    // Verify core rules installed
    const expectedCoreRules = [
      '.claude/rules/ecc/common/coding-style.md',
      '.claude/rules/ecc/common/testing.md',
      '.claude/rules/ecc/common/patterns.md',
      '.claude/rules/ecc/common/security.md'
    ];
    assertFilesExist(homeDir, expectedCoreRules);

    // Verify TypeScript-specific rules installed
    const expectedTSRules = [
      '.claude/rules/ecc/typescript/coding-style.md',
      '.claude/rules/ecc/typescript/testing.md'
    ];
    assertFilesExist(homeDir, expectedTSRules);

    // Verify install state was written
    const state = readInstallState(homeDir);
    assert.strictEqual(state.request.legacyMode, true, 'Should be legacy mode');
    assert.ok(Array.isArray(state.request.legacyLanguages), 'Should have languages array');
    assert.ok(state.request.legacyLanguages.includes('typescript'), 'Should include typescript');
    assert.ok(state.operations.length > 0, 'Should have operations recorded');
  } finally {
    cleanup();
  }
}

/**
 * Test: Fresh Python installation creates expected files
 */
async function testFreshPythonInstallation() {
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Act
    const result = await runInstallScript(['python'], { homeDir, projectDir });

    // Assert
    assert.strictEqual(result.code, 0, `Install should succeed. stderr: ${result.stderr}`);

    // Verify Python-specific rules installed
    const expectedPyRules = [
      '.claude/rules/ecc/python/coding-style.md',
      '.claude/rules/ecc/python/testing.md'
    ];
    assertFilesExist(homeDir, expectedPyRules);

    // Verify install state
    const state = readInstallState(homeDir);
    assert.strictEqual(state.request.legacyMode, true);
    assert.ok(state.request.legacyLanguages.includes('python'));
  } finally {
    cleanup();
  }
}

/**
 * Test: Multi-language installation
 */
async function testMultiLanguageInstallation() {
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Act - install both TypeScript and Python
    const result = await runInstallScript(['typescript', 'python'], { homeDir, projectDir });

    // Assert
    assert.strictEqual(result.code, 0, `Install should succeed. stderr: ${result.stderr}`);

    // Verify both language rules installed
    assertFilesExist(homeDir, [
      '.claude/rules/ecc/typescript/coding-style.md',
      '.claude/rules/ecc/python/coding-style.md'
    ]);

    // Verify install state
    const state = readInstallState(homeDir);
    assert.ok(state.request.legacyLanguages.includes('typescript'));
    assert.ok(state.request.legacyLanguages.includes('python'));
    assert.strictEqual(state.request.legacyLanguages.length, 2);
  } finally {
    cleanup();
  }
}

/**
 * Test: Dry-run doesn't create files
 */
async function testDryRunDoesNotCreateFiles() {
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Act
    const result = await runInstallScript(['typescript', '--dry-run'], { homeDir, projectDir });

    // Assert - should succeed
    assert.strictEqual(result.code, 0, 'Dry-run should succeed');

    // Verify output mentions dry-run
    assert.ok(result.stdout.includes('Dry-run') || result.stdout.includes('dry-run'),
      'Output should mention dry-run');

    // Verify no files were created (except .claude dir might exist)
    const claudeDir = path.join(homeDir, '.claude');
    if (fs.existsSync(claudeDir)) {
      const rulesDir = path.join(claudeDir, 'rules');
      assert.ok(!fs.existsSync(rulesDir), 'Dry-run should not create rules directory');
    }

    // Verify no install state created in dry-run
    const statePath = path.join(homeDir, '.claude', 'install-state.json');
    assert.ok(!fs.existsSync(statePath), 'Dry-run should not create install state');
  } finally {
    cleanup();
  }
}

/**
 * Test: Install state persistence
 */
async function testInstallStatePersistence() {
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // First install
    const result1 = await runInstallScript(['typescript'], { homeDir, projectDir });
    assert.strictEqual(result1.code, 0);

    // Read state
    const state1 = readInstallState(homeDir);
    assert.ok(state1.installedAt, 'Should have installedAt timestamp');
    assert.ok(state1.operations.length > 0);

    // Verify state file structure
    assert.ok(state1.request, 'Should have request');
    assert.ok(state1.target, 'Should have target');
    assert.ok(Array.isArray(state1.request.legacyLanguages), 'Should have languages array');
    assert.ok(Array.isArray(state1.operations), 'Should have operations array');
  } finally {
    cleanup();
  }
}

/**
 * Test: JSON output mode
 */
async function testJSONOutputMode() {
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Act - run with --json flag
    const result = await runInstallScript(['typescript', '--json'], { homeDir, projectDir });

    // Assert
    assert.strictEqual(result.code, 0, 'Install should succeed');

    // Verify output is valid JSON
    let jsonOutput;
    try {
      jsonOutput = JSON.parse(result.stdout);
    } catch (err) {
      throw new Error(`Output should be valid JSON. Got: ${result.stdout.substring(0, 200)}`);
    }

    // Verify JSON structure
    assert.ok(jsonOutput.result, 'JSON should have result');
    assert.ok(jsonOutput.result.mode, 'JSON result should have mode');
    assert.ok(jsonOutput.result.operations, 'JSON result should have operations');
  } finally {
    cleanup();
  }
}

/**
 * Test: Invalid language shows error
 */
async function testInvalidLanguageShowsError() {
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Act
    const result = await runInstallScript(['invalid-language-xyz'], { homeDir, projectDir });

    // Assert - should fail
    assert.notStrictEqual(result.code, 0, 'Invalid language should fail');

    // Should mention the invalid language or show error
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes('invalid') ||
      output.includes('not found') ||
      output.includes('Unknown') ||
      output.includes('Error'),
      'Output should indicate error'
    );
  } finally {
    cleanup();
  }
}

/**
 * Test: Target option - cursor installation
 */
async function testCursorTargetInstallation() {
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Act
    const result = await runInstallScript(['--target', 'cursor', 'typescript'], {
      homeDir,
      projectDir
    });

    // Assert
    assert.strictEqual(result.code, 0, `Cursor install should succeed. stderr: ${result.stderr}`);

    // Verify output mentions cursor target and shows the install plan
    assert.ok(result.stdout.includes('cursor'), 'Output should mention cursor target');
    assert.ok(result.stdout.includes('Target: cursor'), 'Output should show cursor as target');
    assert.ok(result.stdout.includes('typescript'), 'Output should mention TypeScript');
  } finally {
    cleanup();
  }
}

/**
 * Test: Help flag shows usage
 */
async function testHelpFlagShowsUsage() {
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Act
    const result = await runInstallScript(['--help'], { homeDir, projectDir });

    // Assert - help should exit 0
    assert.strictEqual(result.code, 0, 'Help should exit with 0');

    // Verify help text is shown
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('Usage:'), 'Should show usage');
    assert.ok(output.includes('install'), 'Should mention install');
  } finally {
    cleanup();
  }
}

async function runTests() {
  console.log('\n=== Integration Tests: Installation ===\n');
  let passed = 0;
  let failed = 0;

  console.log('Legacy Language Mode:');
  if (await asyncTest('fresh TypeScript installation', testFreshTypeScriptInstallation)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('fresh Python installation', testFreshPythonInstallation)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('multi-language installation', testMultiLanguageInstallation)) {
    passed++;
  } else {
    failed++;
  }

  console.log('\nInstall Options:');
  if (await asyncTest('dry-run does not create files', testDryRunDoesNotCreateFiles)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('JSON output mode', testJSONOutputMode)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('target option - cursor installation', testCursorTargetInstallation)) {
    passed++;
  } else {
    failed++;
  }

  console.log('\nState & Validation:');
  if (await asyncTest('install state persistence', testInstallStatePersistence)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('invalid language shows error', testInvalidLanguageShowsError)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('help flag shows usage', testHelpFlagShowsUsage)) {
    passed++;
  } else {
    failed++;
  }

  console.log(`\nPassed: ${passed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
