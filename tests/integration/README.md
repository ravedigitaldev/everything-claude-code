# Integration Tests

Comprehensive end-to-end integration tests for Everything Claude Code (ECC).

## Overview

This directory contains integration tests that validate complete workflows across the ECC system, including:

- Installation workflows (legacy, profile, module modes)
- Package manager detection (npm, pnpm, yarn, bun)
- MCP server health checking and blocking
- Git commit quality gates
- PR creation detection

**Total Integration Tests:** 124 (100% passing)  
**New ECC Integration Tests:** 59 tests across 6 test suites (Phases 1-6)

## Test Files

### Existing Integration Tests (65 tests)

| Test Suite | File | Tests | Description |
|------------|------|-------|-------------|
| Installation | `installation.test.js` | 9 | Install workflows, targets, state persistence |
| Package Manager | `package-manager.test.js` | 15 | PM detection, priority, environment overrides |
| MCP Health | `mcp-health.test.js` | 9 | Health checks, blocking, state caching |
| Git Workflows | `git-workflows.test.js` | 9 | Commit quality, PR detection |
| Hooks (existing) | `hooks.test.js` | ~40 | Hook lifecycle, I/O handling |

### New ECC Integration Tests (59 tests)

| Phase | Test Suite | File | Tests | Priority | Description |
|-------|------------|------|-------|----------|-------------|
| 1 | Infrastructure | `../fixtures/verify-infrastructure.test.js` | 5 | Foundation | Mock servers, security payloads, test helpers |
| 2 | **Security Boundaries** | `security-boundaries.test.js` | 16 | **HIGHEST** | API key isolation, hook injection prevention, path traversal, subprocess safety |
| 3 | CLI Workflows | `cli-workflows.test.js` | 12 | High | Full install pipeline, repair workflow, session commands, error recovery |
| 4 | Session Lifecycle | `session-lifecycle.test.js` | 9 | High | SQLite state management, cross-session persistence, cleanup |
| 5 | Cross-Harness | `cross-harness.test.js` | 7 | Medium | Multi-target compatibility (claude, cursor, antigravity) |
| 6 | MCP Integration | `mcp-integration.test.js` | 10 | High | GitHub/Jira API workflows, multi-server coordination |

## Running Tests

### Run All Integration Tests

```bash
# Run all integration tests
npm test

# Run only integration tests
node tests/run-all.js 2>&1 | grep "integration/"

# Run with coverage
npm run coverage
```

### Run Individual Test Suite (Existing)

```bash
# Installation tests
node tests/integration/installation.test.js

# Package manager tests
node tests/integration/package-manager.test.js

# MCP health check tests
node tests/integration/mcp-health.test.js

# Git workflow tests
node tests/integration/git-workflows.test.js
```

### Run Individual Test Suite (New ECC Tests)

```bash
# Phase 1: Infrastructure tests
node tests/fixtures/verify-infrastructure.test.js

# Phase 2: Security boundaries tests (HIGHEST PRIORITY)
node tests/integration/security-boundaries.test.js
ECC_STRICT_SECURITY=1 node tests/integration/security-boundaries.test.js  # Strict mode

# Phase 3: CLI workflows tests
node tests/integration/cli-workflows.test.js

# Phase 4: Session lifecycle tests
node tests/integration/session-lifecycle.test.js

# Phase 5: Cross-harness tests
node tests/integration/cross-harness.test.js

# Phase 6: MCP integration tests
node tests/integration/mcp-integration.test.js
ECC_SKIP_EXTERNAL=1 node tests/integration/mcp-integration.test.js  # Skip external APIs
```

### Environment Variables for New Tests

- **ECC_TEST_MODE=1** - Use mock MCP servers instead of real API calls
- **ECC_SKIP_EXTERNAL=1** - Skip tests requiring network access
- **ECC_STRICT_SECURITY=1** - All security tests must pass (no exceptions)

## Test Infrastructure

### Helper Functions

Located in `tests/lib/integration-helpers.js`:

```javascript
const {
  createIsolatedTestEnvironment,  // Create temp HOME and project dirs
  runInstallScript,                // Run install with isolated env
  runHookWithInput,                // Execute hook with JSON input
  assertFilesExist,                // Verify files created
  assertFilesNotExist,             // Verify files not created
  readInstallState,                // Parse install state JSON
  createMockGitRepo,               // Initialize test git repo
  copyFixture                      // Copy test fixtures
} = require('../lib/integration-helpers');
```

### Test Utilities

Located in `tests/lib/test-utils.js`:

```javascript
const {
  test,                // Sync test wrapper
  asyncTest,           // Async test wrapper with timeout
  createTestRunner,    // Test runner with metrics
  withEnv,             // Safe env var management
  withEnvVars,         // Multi-var env management
  measureTime          // Execution timing
} = require('../lib/test-utils');
```

## Test Patterns

### AAA Pattern (Arrange-Act-Assert)

All tests follow the Arrange-Act-Assert pattern:

```javascript
async function testExample() {
  // === ARRANGE ===
  const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();
  
  try {
    // Set up test conditions
    fs.writeFileSync(path.join(projectDir, 'test.js'), 'code');
    
    // === ACT ===
    const result = await runInstallScript(['typescript'], { homeDir, projectDir });
    
    // === ASSERT ===
    assert.strictEqual(result.code, 0);
    assertFilesExist(homeDir, ['.claude/rules/ecc/typescript/coding-style.md']);
  } finally {
    // === CLEANUP ===
    cleanup();
  }
}
```

### Environment Isolation

Each test creates an isolated environment:

```javascript
const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

// homeDir: Isolated ~/.home directory
// projectDir: Isolated project directory
// cleanup(): Remove temp directories
```

**Always use try-finally to ensure cleanup:**

```javascript
try {
  // Test code
} finally {
  cleanup();
}
```

### Environment Variables

Use `withEnv` helper for safe environment variable management:

```javascript
await withEnv('CLAUDE_PACKAGE_MANAGER', 'pnpm', async () => {
  // Env var set to 'pnpm' during this block
  const result = getPackageManager();
  assert.strictEqual(result.name, 'pnpm');
});
// Env var automatically restored
```

### Hook Testing

Test hooks by simulating Claude Code's JSON input:

```javascript
const result = await runHookWithInput(HOOK_SCRIPT, {
  tool_name: 'mcp__server__search',
  tool_input: { query: 'test' }
}, {
  CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
  ECC_MCP_CONFIG_PATH: '/path/to/config.json'
});

assert.strictEqual(result.code, 0); // or 2 for blocking
```

## Test Fixtures

Located in `tests/fixtures/`:

### Project Fixtures

```
tests/fixtures/projects/
├── typescript-simple/     # Basic TypeScript project
│   ├── package.json
│   ├── tsconfig.json
│   └── src/index.ts
└── python-django/         # Django project
    ├── requirements.txt
    └── manage.py
```

### MCP Server Fixtures

```
tests/fixtures/mcp-servers/
├── healthy-server.js      # Stays running (healthy)
├── broken-server.js       # Exits immediately (unhealthy)
└── slow-server.js         # 5s delay (timeout testing)
```

## Writing New Integration Tests

### 1. Create Test File

```javascript
/**
 * Integration tests for [feature]
 *
 * Run with: node tests/integration/feature.test.js
 */

const assert = require('assert');
const {
  createIsolatedTestEnvironment,
  // ... other helpers
} = require('../lib/integration-helpers');
const { asyncTest } = require('../lib/test-utils');
```

### 2. Write Test Functions

```javascript
async function testFeature() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();
  
  try {
    // Arrange
    // ... setup
    
    // Act
    // ... execute
    
    // Assert
    assert.strictEqual(actual, expected);
  } finally {
    cleanup();
  }
}
```

### 3. Create Test Runner

```javascript
async function runTests() {
  console.log('\n=== Integration Tests: Feature ===\n');
  let passed = 0;
  let failed = 0;

  if (await asyncTest('test name', testFeature)) {
    passed++;
  } else {
    failed++;
  }

  console.log(`\nPassed: ${passed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
```

### 4. Test Automatically Discovered

The test runner (`tests/run-all.js`) automatically discovers and runs all `*.test.js` files.

## Best Practices

### ✅ DO

- **Always use isolated environments** - Each test creates its own temp directories
- **Always cleanup** - Use try-finally to ensure cleanup runs
- **Use helper functions** - Reuse shared utilities from `integration-helpers.js`
- **Test one thing** - Each test should verify a single behavior
- **Use descriptive names** - Test names should explain what's being tested
- **Handle async properly** - Use async/await for all async operations
- **Use AAA pattern** - Arrange, Act, Assert structure

### ❌ DON'T

- **Don't skip cleanup** - Always call cleanup() in finally block
- **Don't use hardcoded paths** - Use path.join() and isolated environments
- **Don't share state** - Each test should be independent
- **Don't test implementation details** - Test behavior, not internals
- **Don't make tests flaky** - Avoid timing-dependent assertions
- **Don't mutate process.env directly** - Use `withEnv()` helper

## Cross-Platform Considerations

Tests run on Windows, macOS, and Linux. Ensure compatibility:

### Path Handling

```javascript
// ✅ GOOD - Cross-platform
const filePath = path.join(homeDir, '.claude', 'config.json');

// ❌ BAD - Unix-only
const filePath = `${homeDir}/.claude/config.json`;
```

### Environment Variables

```javascript
// ✅ GOOD - Handles both HOME and USERPROFILE
const { homeDir } = createIsolatedTestEnvironment();

// ❌ BAD - Assumes Unix
const homeDir = process.env.HOME;
```

### Command Execution

```javascript
// ✅ GOOD - Cross-platform git
execSync('git status', { cwd: projectDir });

// ❌ BAD - Shell-specific
execSync('ls -la', { cwd: projectDir }); // 'ls' doesn't exist on Windows
```

## Debugging Tests

### Run with Verbose Output

```bash
# See full output
node tests/integration/installation.test.js 2>&1 | less
```

### Inspect Test Directories

Modify cleanup to preserve directories:

```javascript
const { homeDir, projectDir, cleanup } = createIsolatedTestEnvironment();

try {
  // ... test code ...
  console.log('homeDir:', homeDir);
  console.log('projectDir:', projectDir);
  // Comment out cleanup to inspect directories:
  // cleanup();
} finally {
  // cleanup();
}
```

### Check Exit Codes

```bash
node tests/integration/installation.test.js
echo "Exit code: $?"
```

## CI/CD Integration

Integration tests run in GitHub Actions:

```yaml
# .github/workflows/ci.yml
- name: Run tests
  run: node tests/run-all.js
```

Tests run on:
- **OS:** ubuntu-latest, windows-latest, macos-latest
- **Node:** 18.x, 20.x, 22.x
- **Package Managers:** npm, pnpm, yarn, bun

## Performance

**Typical execution times:**
- Integration helpers tests: ~2s
- Installation tests: ~5s
- Package manager tests: ~3s
- MCP health tests: ~8s (includes timeout tests)
- Git workflow tests: ~2s

**Total integration test time:** ~20-30 seconds

## Coverage

Integration tests complement unit tests by validating:

- ✅ End-to-end workflows
- ✅ Cross-component integration
- ✅ File system operations
- ✅ Process spawning
- ✅ State persistence
- ✅ Error recovery
- ✅ Platform compatibility

**Target coverage:** 80%+ on critical workflows

## Troubleshooting

### Tests Fail Locally but Pass in CI

- Check Node.js version (use same as CI)
- Check package manager (npm/pnpm/yarn/bun)
- Ensure dependencies installed: `npm install`

### Cleanup Errors on Windows

Windows may lock files. Cleanup errors are ignored but you may see warnings.

### Git Commands Fail

Ensure git is installed and in PATH:

```bash
git --version
```

### Timeout Errors

Increase timeout for slow tests:

```javascript
asyncTest('slow test', testFunction, { timeout: 10000 });
```

## Contributing

When adding new integration tests:

1. Follow existing patterns in this directory
2. Use shared helpers from `integration-helpers.js`
3. Ensure tests pass on all platforms
4. Add test description to this README
5. Keep tests focused and independent
6. Include cleanup in finally blocks

## References

- [Test Utilities](../lib/test-utils.js) - Shared test helpers
- [Integration Helpers](../lib/integration-helpers.js) - Integration test utilities
- [Test Fixtures](../fixtures/README.md) - Mock data and servers
- [Main Test Runner](../run-all.js) - Test orchestration

---

**Questions?** See [CONTRIBUTING.md](../../CONTRIBUTING.md) or open an issue.
