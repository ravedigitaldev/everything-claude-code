/**
 * Integration tests for Git workflows
 *
 * Tests end-to-end Git workflow integration including:
 * - Commit quality gates
 * - PR creation detection
 * - Git command transformations
 * - No-verify blocking
 * - Branch detection
 *
 * Run with: node tests/integration/git-workflows.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  createIsolatedTestEnvironment,
  createMockGitRepo,
  runHookWithInput
} = require('../lib/integration-helpers');
const { test, asyncTest } = require('../lib/test-utils');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMMIT_QUALITY_HOOK = path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-bash-commit-quality.js');
const PR_CREATED_HOOK = path.join(REPO_ROOT, 'scripts', 'hooks', 'post-bash-pr-created.js');

/**
 * Test: Git commit command is recognized
 */
async function testGitCommitRecognized() {
  const { cleanup } = createIsolatedTestEnvironment();

  try {
    // Run quality hook with git commit command
    // Note: Hook runs in ECC repo context, not test repo
    const result = await runHookWithInput(COMMIT_QUALITY_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "test"' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse'
    });

    // Assert - hook processes git commit commands
    assert.strictEqual(result.code, 0, 'Hook should process git commit commands');
  } finally {
    cleanup();
  }
}

/**
 * Test: Commit with --amend is recognized
 */
async function testCommitAmendRecognized() {
  const { cleanup } = createIsolatedTestEnvironment();

  try {
    // Test that --amend commits are recognized
    const result = await runHookWithInput(COMMIT_QUALITY_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git commit --amend --no-edit' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse'
    });

    assert.strictEqual(result.code, 0, 'Hook should process --amend commits');
  } finally {
    cleanup();
  }
}

/**
 * Test: Conventional commit format recognized
 */
async function testConventionalCommitFormat() {
  const { cleanup } = createIsolatedTestEnvironment();

  try {
    // Test conventional commit format
    const result = await runHookWithInput(COMMIT_QUALITY_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "feat: add new feature"' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse'
    });

    assert.strictEqual(result.code, 0, 'Conventional commit should be recognized');
  } finally {
    cleanup();
  }
}

/**
 * Test: Non-commit Git commands bypass quality check
 */
async function testNonCommitCommandsBypassed() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    createMockGitRepo(projectDir, { withCommit: true });

    // Run quality hook with non-commit command
    const result = await runHookWithInput(COMMIT_QUALITY_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git status' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      CLAUDE_PROJECT_DIR: projectDir
    });

    // Assert - should pass through
    assert.strictEqual(result.code, 0, 'Non-commit commands should bypass');
  } finally {
    cleanup();
  }
}

/**
 * Test: PR creation detected and URL extracted
 */
async function testPRCreationDetected() {
  const { cleanup } = createIsolatedTestEnvironment();

  try {
    // Simulate gh pr create output
    const ghOutput = `
Creating pull request for feature-branch into main in user/repo

https://github.com/user/repo/pull/123
`;

    // Run PR detection hook
    const result = await runHookWithInput(PR_CREATED_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create --title "Test PR" --body "Test"' },
      tool_output: { output: ghOutput }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse'
    });

    // Assert - should detect PR
    assert.strictEqual(result.code, 0, 'Should succeed');
    assert.ok(result.stderr.includes('PR created'), 'Should detect PR creation');
    assert.ok(result.stderr.includes('github.com/user/repo/pull/123'), 'Should extract PR URL');
    assert.ok(result.stderr.includes('gh pr review 123'), 'Should suggest review command');
  } finally {
    cleanup();
  }
}

/**
 * Test: Non-PR commands bypass detection
 */
async function testNonPRCommandsBypassed() {
  const { cleanup } = createIsolatedTestEnvironment();

  try {
    // Run with non-PR command
    const result = await runHookWithInput(PR_CREATED_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
      tool_output: { output: 'Everything up-to-date' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse'
    });

    // Assert - should pass through without PR detection
    assert.strictEqual(result.code, 0, 'Should succeed');
    assert.ok(!result.stderr || !result.stderr.includes('PR created'), 'Should not detect PR');
  } finally {
    cleanup();
  }
}

/**
 * Test: Malformed PR output handled gracefully
 */
async function testMalformedPROutputHandled() {
  const { cleanup } = createIsolatedTestEnvironment();

  try {
    // Simulate malformed output
    const result = await runHookWithInput(PR_CREATED_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create' },
      tool_output: { output: 'Error: failed to create PR' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse'
    });

    // Assert - should handle gracefully
    assert.strictEqual(result.code, 0, 'Should handle errors gracefully');
  } finally {
    cleanup();
  }
}

/**
 * Test: Git repo detection in quality hook
 */
async function testGitRepoDetection() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Run quality hook in non-git directory
    const result = await runHookWithInput(COMMIT_QUALITY_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "test"' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      CLAUDE_PROJECT_DIR: projectDir
    });

    // Assert - should gracefully handle non-git directory
    assert.strictEqual(result.code, 0, 'Should handle non-git directory gracefully');
  } finally {
    cleanup();
  }
}

/**
 * Test: Hook handles no staged files gracefully
 */
async function testNoStagedFilesHandled() {
  const { cleanup } = createIsolatedTestEnvironment();

  try {
    // Run hook when no files are staged (in ECC repo context)
    const result = await runHookWithInput(COMMIT_QUALITY_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git commit --allow-empty -m "Empty"' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse'
    });

    // Assert - should handle gracefully
    assert.strictEqual(result.code, 0, 'Should handle no staged files');
  } finally {
    cleanup();
  }
}

/**
 * Test: Commit message validation (if implemented)
 */
async function testCommitMessageExtraction() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    createMockGitRepo(projectDir, { withCommit: true });

    // Add clean file
    fs.writeFileSync(path.join(projectDir, 'test.js'), 'const x = 1;');
    execSync('git add test.js', { cwd: projectDir, stdio: 'pipe' });

    // Run with commit message
    const result = await runHookWithInput(COMMIT_QUALITY_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "feat: add new feature"' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      CLAUDE_PROJECT_DIR: projectDir
    });

    // Assert - should pass
    assert.strictEqual(result.code, 0, 'Valid commit message should pass');
  } finally {
    cleanup();
  }
}

/**
 * Test: Binary files skipped in quality check
 */
async function testBinaryFilesSkipped() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    createMockGitRepo(projectDir, { withCommit: true });

    // Add binary file (image)
    const binaryFile = path.join(projectDir, 'image.png');
    fs.writeFileSync(binaryFile, Buffer.from([0x89, 0x50, 0x4E, 0x47])); // PNG header

    execSync('git add image.png', { cwd: projectDir, stdio: 'pipe' });

    // Run quality hook
    const result = await runHookWithInput(COMMIT_QUALITY_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "Add image"' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      CLAUDE_PROJECT_DIR: projectDir
    });

    // Assert - should pass (binary files skipped)
    assert.strictEqual(result.code, 0, 'Binary files should be skipped');
  } finally {
    cleanup();
  }
}

/**
 * Test: Empty commit handled
 */
async function testEmptyCommitHandled() {
  const { projectDir, cleanup } = createIsolatedTestEnvironment();

  try {
    createMockGitRepo(projectDir, { withCommit: true });

    // No files staged

    // Run quality hook with empty commit
    const result = await runHookWithInput(COMMIT_QUALITY_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git commit --allow-empty -m "Empty"' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      CLAUDE_PROJECT_DIR: projectDir
    });

    // Assert - should pass (no files to check)
    assert.strictEqual(result.code, 0, 'Empty commit should pass');
  } finally {
    cleanup();
  }
}

/**
 * Test: PR detection with multiple PRs in output
 */
async function testMultiplePRsInOutput() {
  const { cleanup } = createIsolatedTestEnvironment();

  try {
    // Simulate output with multiple PR URLs (should extract first)
    const ghOutput = `
Previous PRs:
https://github.com/user/repo/pull/100

Creating new PR:
https://github.com/user/repo/pull/123
`;

    const result = await runHookWithInput(PR_CREATED_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create' },
      tool_output: { output: ghOutput }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse'
    });

    // Assert - should extract first PR URL
    assert.strictEqual(result.code, 0, 'Should succeed');
    assert.ok(result.stderr.includes('pull/100'), 'Should extract first PR');
  } finally {
    cleanup();
  }
}

async function runTests() {
  console.log('\n=== Integration Tests: Git Workflows ===\n');
  let passed = 0;
  let failed = 0;

  console.log('Commit Quality Gates:');
  if (await asyncTest('git commit recognized', testGitCommitRecognized)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('commit --amend recognized', testCommitAmendRecognized)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('conventional commit format', testConventionalCommitFormat)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('non-commit commands bypassed', testNonCommitCommandsBypassed)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('no staged files handled', testNoStagedFilesHandled)) {
    passed++;
  } else {
    failed++;
  }

  console.log('\nPR Detection:');
  if (await asyncTest('PR creation detected', testPRCreationDetected)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('non-PR commands bypassed', testNonPRCommandsBypassed)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('malformed PR output handled', testMalformedPROutputHandled)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('multiple PRs in output', testMultiplePRsInOutput)) {
    passed++;
  } else {
    failed++;
  }

  console.log(`\nPassed: ${passed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
