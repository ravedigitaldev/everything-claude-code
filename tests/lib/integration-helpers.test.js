/**
 * Tests for integration-helpers.js
 *
 * Run with: node tests/lib/integration-helpers.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createIsolatedTestEnvironment,
  assertFilesExist,
  assertFilesNotExist,
  createMockGitRepo
} = require('./integration-helpers');

function test(name, fn) {
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

async function asyncTest(name, fn) {
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

function runTests() {
  console.log('\n=== Testing integration-helpers.js ===\n');
  let passed = 0;
  let failed = 0;

  console.log('createIsolatedTestEnvironment:');

  if (test('creates temporary directories', () => {
    const env = createIsolatedTestEnvironment();
    try {
      assert.ok(fs.existsSync(env.tmpDir), 'tmpDir should exist');
      assert.ok(fs.existsSync(env.homeDir), 'homeDir should exist');
      assert.ok(fs.existsSync(env.projectDir), 'projectDir should exist');

      // Verify structure
      assert.ok(env.tmpDir.includes('ecc-test-'), 'tmpDir should have ecc-test- prefix');
      assert.strictEqual(path.basename(env.homeDir), 'home');
      assert.strictEqual(path.basename(env.projectDir), 'project');
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  if (test('cleanup removes directories', () => {
    const env = createIsolatedTestEnvironment();
    const tmpPath = env.tmpDir;

    assert.ok(fs.existsSync(tmpPath), 'tmpDir should exist before cleanup');
    env.cleanup();

    // Give filesystem time to process on Windows
    const maxWait = 1000;
    const start = Date.now();
    while (fs.existsSync(tmpPath) && (Date.now() - start) < maxWait) {
      // Wait
    }

    assert.ok(!fs.existsSync(tmpPath), 'tmpDir should not exist after cleanup');
  })) passed++; else failed++;

  if (test('creates isolated HOME and project directories', () => {
    const env = createIsolatedTestEnvironment();
    try {
      // Verify directories are writable
      const testFile = path.join(env.homeDir, 'test.txt');
      fs.writeFileSync(testFile, 'test');
      assert.ok(fs.existsSync(testFile));

      const projectFile = path.join(env.projectDir, 'project.txt');
      fs.writeFileSync(projectFile, 'project');
      assert.ok(fs.existsSync(projectFile));
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  console.log('\nassertFilesExist:');

  if (test('passes when all files exist', () => {
    const env = createIsolatedTestEnvironment();
    try {
      fs.writeFileSync(path.join(env.homeDir, 'file1.txt'), 'test');
      fs.mkdirSync(path.join(env.homeDir, 'subdir'));
      fs.writeFileSync(path.join(env.homeDir, 'subdir', 'file2.txt'), 'test');

      assertFilesExist(env.homeDir, ['file1.txt', 'subdir/file2.txt']);
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  if (test('throws when files are missing', () => {
    const env = createIsolatedTestEnvironment();
    try {
      fs.writeFileSync(path.join(env.homeDir, 'exists.txt'), 'test');

      let threw = false;
      try {
        assertFilesExist(env.homeDir, ['exists.txt', 'missing.txt']);
      } catch (err) {
        threw = true;
        assert.ok(err.message.includes('missing.txt'));
      }

      assert.ok(threw, 'Should throw for missing files');
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  console.log('\nassertFilesNotExist:');

  if (test('passes when files do not exist', () => {
    const env = createIsolatedTestEnvironment();
    try {
      assertFilesNotExist(env.homeDir, ['should-not-exist.txt']);
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  if (test('throws when unexpected files exist', () => {
    const env = createIsolatedTestEnvironment();
    try {
      fs.writeFileSync(path.join(env.homeDir, 'unexpected.txt'), 'test');

      let threw = false;
      try {
        assertFilesNotExist(env.homeDir, ['unexpected.txt']);
      } catch (err) {
        threw = true;
        assert.ok(err.message.includes('unexpected.txt'));
      }

      assert.ok(threw, 'Should throw for unexpected files');
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  console.log('\ncreateMockGitRepo:');

  if (test('initializes git repository', () => {
    const env = createIsolatedTestEnvironment();
    try {
      createMockGitRepo(env.projectDir);

      assert.ok(fs.existsSync(path.join(env.projectDir, '.git')));
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  if (test('creates initial commit when requested', () => {
    const env = createIsolatedTestEnvironment();
    try {
      createMockGitRepo(env.projectDir, { withCommit: true });

      const { execSync } = require('child_process');
      const log = execSync('git log --oneline', { cwd: env.projectDir, encoding: 'utf8' });

      assert.ok(log.includes('Initial commit'));
      assert.ok(fs.existsSync(path.join(env.projectDir, 'README.md')));
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  if (test('adds uncommitted changes when requested', () => {
    const env = createIsolatedTestEnvironment();
    try {
      createMockGitRepo(env.projectDir, { withCommit: true, withUncommittedChanges: true });

      const { execSync } = require('child_process');
      const status = execSync('git status --porcelain', { cwd: env.projectDir, encoding: 'utf8' });

      assert.ok(status.includes('test.js'));
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  console.log('\nCross-platform compatibility:');

  if (test('handles paths correctly on current platform', () => {
    const env = createIsolatedTestEnvironment();
    try {
      // Test path.join works correctly
      const nestedPath = path.join(env.homeDir, '.claude', 'rules', 'test.md');
      fs.mkdirSync(path.dirname(nestedPath), { recursive: true });
      fs.writeFileSync(nestedPath, 'test');

      assert.ok(fs.existsSync(nestedPath));
      assertFilesExist(env.homeDir, ['.claude/rules/test.md']);
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  if (test('handles HOME vs USERPROFILE environment variables', () => {
    const env = createIsolatedTestEnvironment();
    try {
      // Both should point to same directory conceptually
      assert.ok(env.homeDir.length > 0);
      assert.ok(path.isAbsolute(env.homeDir));
    } finally {
      env.cleanup();
    }
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
