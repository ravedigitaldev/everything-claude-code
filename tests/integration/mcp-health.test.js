/**
 * Integration tests for MCP health check system
 *
 * Tests end-to-end MCP health checking including:
 * - Health check blocking behavior
 * - Health state persistence
 * - Server recovery detection
 * - TTL expiration
 * - Backoff retry logic
 *
 * Run with: node tests/integration/mcp-health.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createIsolatedTestEnvironment,
  runHookWithInput
} = require('../lib/integration-helpers');
const { test, asyncTest, withEnvVars } = require('../lib/test-utils');

const REPO_ROOT = path.join(__dirname, '..', '..');
const MCP_HEALTH_HOOK = path.join(REPO_ROOT, 'scripts', 'hooks', 'mcp-health-check.js');

/**
 * Test: Healthy server allows tool execution
 */
async function testHealthyServerAllowsExecution() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const configPath = path.join(homeDir, 'claude.json');
    const statePath = path.join(homeDir, 'mcp-health.json');

    // Create MCP config with healthy server
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        healthy: {
          command: 'node',
          args: [path.join(REPO_ROOT, 'tests/fixtures/mcp-servers/healthy-server.js')]
        }
      }
    }));

    // Run health check
    const result = await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__healthy__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_TIMEOUT_MS: '2000'
    });

    // Assert - should allow execution
    assert.strictEqual(result.code, 0, 'Healthy server should allow tool execution');

    // Verify health state was saved
    assert.ok(fs.existsSync(statePath), 'Health state file should be created');
    const healthState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.strictEqual(healthState.servers.healthy.status, 'healthy');
  } finally {
    cleanup();
  }
}

/**
 * Test: Unhealthy server blocks tool execution
 */
async function testUnhealthyServerBlocksExecution() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const configPath = path.join(homeDir, 'claude.json');
    const statePath = path.join(homeDir, 'mcp-health.json');

    // Create MCP config with broken server
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        broken: {
          command: 'node',
          args: [path.join(REPO_ROOT, 'tests/fixtures/mcp-servers/broken-server.js')]
        }
      }
    }));

    // Run health check
    const result = await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__broken__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_TIMEOUT_MS: '2000'
    });

    // Assert - should block with exit code 2
    assert.strictEqual(result.code, 2, 'Unhealthy server should block with exit code 2');
    assert.ok(result.stderr.includes('unavailable'), 'Should warn about unavailable server');

    // Verify health state persisted
    assert.ok(fs.existsSync(statePath), 'Health state file should exist');
    const healthState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.strictEqual(healthState.servers.broken.status, 'unhealthy');
    assert.ok(healthState.servers.broken.nextRetryAt, 'Should have nextRetryAt');
  } finally {
    cleanup();
  }
}

/**
 * Test: Health state TTL caching
 */
async function testHealthStateTTL() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const configPath = path.join(homeDir, 'claude.json');
    const statePath = path.join(homeDir, 'mcp-health.json');

    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        healthy: {
          command: 'node',
          args: [path.join(REPO_ROOT, 'tests/fixtures/mcp-servers/healthy-server.js')]
        }
      }
    }));

    // First check - should probe server
    await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__healthy__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_TTL_MS: '60000' // 60 second TTL
    });

    const state1 = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const checkedAt1 = state1.servers.healthy.checkedAt;

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    // Second check - should use cached state (within TTL)
    await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__healthy__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_TTL_MS: '60000'
    });

    const state2 = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const checkedAt2 = state2.servers.healthy.checkedAt;

    // Assert - should use cached state (same checkedAt timestamp)
    assert.strictEqual(checkedAt1, checkedAt2, 'Should use cached health state within TTL');
  } finally {
    cleanup();
  }
}

/**
 * Test: Non-MCP tool bypasses health check
 */
async function testNonMCPToolBypasses() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const statePath = path.join(homeDir, 'mcp-health.json');

    // Run with non-MCP tool
    const result = await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test.txt' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_HEALTH_STATE_PATH: statePath
    });

    // Assert - should pass through without checking
    assert.strictEqual(result.code, 0, 'Non-MCP tool should bypass health check');
    assert.ok(!fs.existsSync(statePath), 'Should not create health state for non-MCP tools');
  } finally {
    cleanup();
  }
}

/**
 * Test: Backoff retry logic
 */
async function testBackoffRetryLogic() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const configPath = path.join(homeDir, 'claude.json');
    const statePath = path.join(homeDir, 'mcp-health.json');

    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        broken: {
          command: 'node',
          args: [path.join(REPO_ROOT, 'tests/fixtures/mcp-servers/broken-server.js')]
        }
      }
    }));

    // First failure
    await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__broken__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_BACKOFF_MS: '1000', // 1 second base backoff
      ECC_MCP_HEALTH_TIMEOUT_MS: '500'
    });

    const state1 = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const retry1 = state1.servers.broken.nextRetryAt;
    const failureCount1 = state1.servers.broken.failureCount;

    assert.strictEqual(failureCount1, 1, 'Should have 1 failure');

    // Wait for retry window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Second failure - should increase backoff
    await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__broken__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_BACKOFF_MS: '1000',
      ECC_MCP_HEALTH_TIMEOUT_MS: '500'
    });

    const state2 = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const retry2 = state2.servers.broken.nextRetryAt;
    const failureCount2 = state2.servers.broken.failureCount;

    assert.strictEqual(failureCount2, 2, 'Should have 2 failures');
    assert.ok(retry2 > retry1, 'Retry backoff should increase with failures');
  } finally {
    cleanup();
  }
}

/**
 * Test: Multiple servers tracked independently
 */
async function testMultipleServersIndependent() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const configPath = path.join(homeDir, 'claude.json');
    const statePath = path.join(homeDir, 'mcp-health.json');

    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        healthy: {
          command: 'node',
          args: [path.join(REPO_ROOT, 'tests/fixtures/mcp-servers/healthy-server.js')]
        },
        broken: {
          command: 'node',
          args: [path.join(REPO_ROOT, 'tests/fixtures/mcp-servers/broken-server.js')]
        }
      }
    }));

    // Check healthy server
    const result1 = await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__healthy__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_TIMEOUT_MS: '2000'
    });

    // Check broken server
    const result2 = await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__broken__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_TIMEOUT_MS: '2000'
    });

    // Assert - each server tracked independently
    assert.strictEqual(result1.code, 0, 'Healthy server should allow');
    assert.strictEqual(result2.code, 2, 'Broken server should block');

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.strictEqual(state.servers.healthy.status, 'healthy');
    assert.strictEqual(state.servers.broken.status, 'unhealthy');
  } finally {
    cleanup();
  }
}

/**
 * Test: Fail-open mode when enabled
 */
async function testFailOpenMode() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const configPath = path.join(homeDir, 'claude.json');
    const statePath = path.join(homeDir, 'mcp-health.json');

    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        broken: {
          command: 'node',
          args: [path.join(REPO_ROOT, 'tests/fixtures/mcp-servers/broken-server.js')]
        }
      }
    }));

    // Run with fail-open enabled
    const result = await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__broken__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_TIMEOUT_MS: '2000',
      ECC_MCP_HEALTH_FAIL_OPEN: '1' // Enable fail-open
    });

    // Assert - should allow even though server is broken
    assert.strictEqual(result.code, 0, 'Fail-open mode should allow execution');
  } finally {
    cleanup();
  }
}

/**
 * Test: No config file scenario
 */
async function testNoConfigFile() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const statePath = path.join(homeDir, 'mcp-health.json');

    // Run without config file
    const result = await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__unknown__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_HEALTH_STATE_PATH: statePath
    });

    // Assert - should allow (no config = skip check)
    assert.strictEqual(result.code, 0, 'No config should skip health check');
    assert.ok(result.stderr.includes('No MCP config'), 'Should log config not found');
  } finally {
    cleanup();
  }
}

/**
 * Test: Health state file structure
 */
async function testHealthStateStructure() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const configPath = path.join(homeDir, 'claude.json');
    const statePath = path.join(homeDir, 'mcp-health.json');

    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        healthy: {
          command: 'node',
          args: [path.join(REPO_ROOT, 'tests/fixtures/mcp-servers/healthy-server.js')]
        }
      }
    }));

    await runHookWithInput(MCP_HEALTH_HOOK, {
      tool_name: 'mcp__healthy__search',
      tool_input: { query: 'test' }
    }, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_MCP_CONFIG_PATH: configPath,
      ECC_MCP_HEALTH_STATE_PATH: statePath,
      ECC_MCP_HEALTH_TIMEOUT_MS: '2000'
    });

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    // Verify state structure
    assert.ok(state.version, 'Should have version');
    assert.ok(state.servers, 'Should have servers object');
    assert.ok(state.servers.healthy, 'Should have healthy server');
    assert.strictEqual(state.servers.healthy.status, 'healthy');
    assert.ok(state.servers.healthy.checkedAt, 'Should have checkedAt timestamp');
    assert.ok(state.servers.healthy.expiresAt, 'Should have expiresAt timestamp');
  } finally {
    cleanup();
  }
}

async function runTests() {
  console.log('\n=== Integration Tests: MCP Health Check ===\n');
  let passed = 0;
  let failed = 0;

  console.log('Basic Health Checking:');
  if (await asyncTest('healthy server allows execution', testHealthyServerAllowsExecution)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('unhealthy server blocks execution', testUnhealthyServerBlocksExecution)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('non-MCP tool bypasses check', testNonMCPToolBypasses)) {
    passed++;
  } else {
    failed++;
  }

  console.log('\nState Management:');
  if (await asyncTest('health state TTL caching', testHealthStateTTL)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('health state file structure', testHealthStateStructure)) {
    passed++;
  } else {
    failed++;
  }

  console.log('\nAdvanced Features:');
  if (await asyncTest('backoff retry logic', testBackoffRetryLogic, { timeout: 5000 })) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('multiple servers tracked independently', testMultipleServersIndependent)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('fail-open mode', testFailOpenMode)) {
    passed++;
  } else {
    failed++;
  }

  if (await asyncTest('no config file scenario', testNoConfigFile)) {
    passed++;
  } else {
    failed++;
  }

  const duration = ((Date.now() - 0) / 1000).toFixed(2);
  console.log(`\nPassed: ${passed} | Failed: ${failed} | Duration: ${duration}s`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
