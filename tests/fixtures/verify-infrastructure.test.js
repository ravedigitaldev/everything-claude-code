/**
 * Verification tests for Phase 1 infrastructure
 *
 * Tests that mock servers, security payloads, and helpers work correctly.
 * Run with: node tests/fixtures/verify-infrastructure.test.js
 */

const assert = require('assert');
const {
  createMockMCPServer,
  assertNoSecretsInOutput,
  createTestMCPConfig,
  createIsolatedTestEnvironment
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
 * Test: GitHub mock server starts and responds to requests
 */
async function testGitHubMockServer() {
  const server = createMockMCPServer('github', { healthy: true });

  try {
    // Start server
    const url = await server.start();
    assert.ok(url, 'Server URL should be returned');
    assert.match(url, /^http:\/\/localhost:\d+$/, 'URL should be valid');

    // Test health endpoint
    const http = require('http');
    const response = await new Promise((resolve, reject) => {
      http.get(`${url}/health`, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });

    assert.strictEqual(response.status, 200, 'Health check should return 200');
    const data = JSON.parse(response.body);
    assert.strictEqual(data.status, 'healthy', 'Health status should be healthy');
  } finally {
    await server.stop();
  }
}

/**
 * Test: Jira mock server starts and handles authentication
 */
async function testJiraMockServer() {
  const server = createMockMCPServer('jira', { healthy: true, authenticated: true });

  try {
    const url = await server.start();
    assert.ok(url, 'Server URL should be returned');

    // Test health endpoint
    const http = require('http');
    const response = await new Promise((resolve, reject) => {
      http.get(`${url}/health`, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });

    assert.strictEqual(response.status, 200, 'Health check should return 200');
    const data = JSON.parse(response.body);
    assert.strictEqual(data.status, 'healthy', 'Health status should be healthy');
  } finally {
    await server.stop();
  }
}

/**
 * Test: Auth-failing server returns 401 for all requests
 */
async function testAuthFailingServer() {
  const server = createMockMCPServer('auth-failing');

  try {
    const url = await server.start();
    assert.ok(url, 'Server URL should be returned');

    // All requests should return 401
    const http = require('http');
    const response = await new Promise((resolve, reject) => {
      http.get(`${url}/any-endpoint`, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });

    assert.strictEqual(response.status, 401, 'Should return 401 Unauthorized');
    const data = JSON.parse(response.body);
    assert.strictEqual(data.error, 'Unauthorized', 'Should return auth error');
  } finally {
    await server.stop();
  }
}

/**
 * Test: assertNoSecretsInOutput detects secrets in output
 */
async function testAssertNoSecretsInOutput() {
  // Should pass with clean output
  assertNoSecretsInOutput('Clean output', 'No secrets here', []);

  // Should fail with GitHub PAT
  try {
    assertNoSecretsInOutput('', 'GITHUB_PAT: ghp_secret123', []);
    throw new Error('Should have thrown on GitHub PAT');
  } catch (err) {
    assert.match(err.message, /Secret pattern found/, 'Should detect GitHub PAT');
  }

  // Should fail with AWS key
  try {
    assertNoSecretsInOutput('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE', '', []);
    throw new Error('Should have thrown on AWS key');
  } catch (err) {
    assert.match(err.message, /Secret pattern found/, 'Should detect AWS key');
  }

  // Should pass with just key names (no values)
  assertNoSecretsInOutput('{"GITHUB_PAT": null, "token": ""}', '', []);
}

/**
 * Test: createTestMCPConfig creates valid config file
 */
async function testCreateTestMCPConfig() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    const configPath = createTestMCPConfig(['github', 'jira'], {
      homeDir,
      serverUrls: {
        github: 'http://localhost:3000',
        jira: 'http://localhost:3001'
      }
    });

    const fs = require('fs');
    assert.ok(fs.existsSync(configPath), 'Config file should be created');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(config.mcpServers.github, 'GitHub server config should exist');
    assert.ok(config.mcpServers.jira, 'Jira server config should exist');
    assert.strictEqual(
      config.mcpServers.github.env.GITHUB_API_URL,
      'http://localhost:3000',
      'GitHub URL should match'
    );
    assert.strictEqual(
      config.mcpServers.jira.env.JIRA_API_URL,
      'http://localhost:3001',
      'Jira URL should match'
    );

    // Verify no hardcoded secrets
    const configStr = JSON.stringify(config);
    assert.ok(!configStr.includes('ghp_'), 'Should not contain hardcoded GitHub tokens');
    assert.ok(configStr.includes('${GITHUB_PAT}'), 'Should use env var references');
  } finally {
    cleanup();
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\nPhase 1 Infrastructure Verification Tests\n');

  const tests = [
    asyncTest('GitHub mock server starts and responds', testGitHubMockServer),
    asyncTest('Jira mock server starts and responds', testJiraMockServer),
    asyncTest('Auth-failing server returns 401', testAuthFailingServer),
    asyncTest('assertNoSecretsInOutput detects secrets', testAssertNoSecretsInOutput),
    asyncTest('createTestMCPConfig creates valid config', testCreateTestMCPConfig)
  ];

  const results = await Promise.all(tests);
  const passed = results.filter(r => r).length;
  const failed = results.length - passed;

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Test runner failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
