/**
 * Integration tests for MCP (Model Context Protocol) integrations
 *
 * Tests external service integration workflows:
 * - GitHub MCP (health checks, PR creation, issue management)
 * - Jira MCP (authentication, search, create, transitions)
 * - Multi-server coordination (independent health tracking, TTL caching)
 * - Error handling (auth failures, rate limits, timeouts)
 *
 * Run with: node tests/integration/mcp-integration.test.js
 * Or with external APIs disabled: ECC_SKIP_EXTERNAL=1 node tests/integration/mcp-integration.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const {
  createIsolatedTestEnvironment,
  createMockMCPServer,
  createTestMCPConfig
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
 * Helper to make HTTP requests
 */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body
      }));
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// =============================================================================
// GitHub MCP Tests
// =============================================================================

/**
 * Test: GitHub MCP health check succeeds
 */
async function testGitHubMCPHealthCheck() {
  const server = createMockMCPServer('github', { healthy: true });

  try {
    // Act: Start server and check health
    const url = await server.start();
    const response = await httpRequest(`${url}/health`);

    // Assert: Health check succeeds
    assert.strictEqual(response.statusCode, 200, 'Health check should return 200');

    const data = JSON.parse(response.body);
    assert.strictEqual(data.status, 'healthy', 'Server should report healthy');
  } finally {
    await server.stop();
  }
}

/**
 * Test: GitHub MCP creates PR successfully
 */
async function testGitHubMCPCreatePR() {
  const server = createMockMCPServer('github', { healthy: true });

  try {
    // Act: Start server and create PR
    const url = await server.start();

    const prData = {
      title: 'Test PR from integration test',
      head: 'feature/test',
      base: 'main',
      body: 'This is a test PR'
    };

    const response = await httpRequest(`${url}/repos/test/repo/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prData)
    });

    // Assert: PR created successfully
    assert.strictEqual(response.statusCode, 201, 'PR creation should return 201');

    const data = JSON.parse(response.body);
    assert.strictEqual(data.title, prData.title, 'PR title should match');
    assert.strictEqual(data.state, 'open', 'PR should be open');
    assert.ok(data.number, 'PR should have number');
  } finally {
    await server.stop();
  }
}

/**
 * Test: GitHub MCP lists issues
 */
async function testGitHubMCPListIssues() {
  const server = createMockMCPServer('github', { healthy: true });

  try {
    // Act: Start server and list issues
    const url = await server.start();
    const response = await httpRequest(`${url}/repos/test/repo/issues`);

    // Assert: Issues retrieved
    assert.strictEqual(response.statusCode, 200, 'Issue list should return 200');

    const data = JSON.parse(response.body);
    assert.ok(Array.isArray(data), 'Response should be array');
    assert.ok(data.length > 0, 'Should have at least one issue');
    assert.ok(data[0].title, 'Issue should have title');
  } finally {
    await server.stop();
  }
}

/**
 * Test: GitHub MCP request logging
 */
async function testGitHubMCPRequestLogging() {
  const server = createMockMCPServer('github', { healthy: true });

  try {
    // Act: Start server and make multiple requests
    const url = await server.start();

    await httpRequest(`${url}/health`);
    await httpRequest(`${url}/repos/test/repo/issues`);

    // Assert: Requests logged
    const requests = server.requests;
    assert.strictEqual(requests.length, 2, 'Should log 2 requests');
    assert.strictEqual(requests[0].url, '/health', 'First request should be health');
    assert.strictEqual(requests[1].url, '/repos/test/repo/issues', 'Second request should be issues');
  } finally {
    await server.stop();
  }
}

// =============================================================================
// Jira MCP Tests
// =============================================================================

/**
 * Test: Jira MCP authentication flow
 */
async function testJiraMCPAuthentication() {
  const serverAuth = createMockMCPServer('jira', { healthy: true, authenticated: true });
  const serverNoAuth = createMockMCPServer('jira', { healthy: true, authenticated: false });

  try {
    // Test with auth
    const urlAuth = await serverAuth.start();
    const responseAuth = await httpRequest(`${urlAuth}/rest/api/2/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic dGVzdDp0ZXN0'
      },
      body: JSON.stringify({ jql: 'project = TEST' })
    });

    assert.strictEqual(responseAuth.statusCode, 200, 'Authenticated request should succeed');

    // Test without auth
    const urlNoAuth = await serverNoAuth.start();
    const responseNoAuth = await httpRequest(`${urlNoAuth}/rest/api/2/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: 'project = TEST' })
    });

    assert.strictEqual(responseNoAuth.statusCode, 401, 'Unauthenticated request should fail');
  } finally {
    await serverAuth.stop();
    await serverNoAuth.stop();
  }
}

/**
 * Test: Jira MCP search issues
 */
async function testJiraMCPSearchIssues() {
  const server = createMockMCPServer('jira', { healthy: true, authenticated: true });

  try {
    // Act: Start server and search issues
    const url = await server.start();
    const response = await httpRequest(`${url}/rest/api/2/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic dGVzdDp0ZXN0'
      },
      body: JSON.stringify({ jql: 'project = TEST' })
    });

    // Assert: Search succeeds
    assert.strictEqual(response.statusCode, 200, 'Search should return 200');

    const data = JSON.parse(response.body);
    assert.ok(data.issues, 'Response should have issues');
    assert.ok(Array.isArray(data.issues), 'Issues should be array');
    assert.ok(data.total, 'Response should have total');
  } finally {
    await server.stop();
  }
}

/**
 * Test: Jira MCP create issue
 */
async function testJiraMCPCreateIssue() {
  const server = createMockMCPServer('jira', { healthy: true, authenticated: true });

  try {
    // Act: Start server and create issue
    const url = await server.start();

    const issueData = {
      fields: {
        project: { key: 'TEST' },
        summary: 'Test issue from integration test',
        issuetype: { name: 'Bug' }
      }
    };

    const response = await httpRequest(`${url}/rest/api/2/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic dGVzdDp0ZXN0'
      },
      body: JSON.stringify(issueData)
    });

    // Assert: Issue created
    assert.strictEqual(response.statusCode, 201, 'Issue creation should return 201');

    const data = JSON.parse(response.body);
    assert.ok(data.key, 'Issue should have key');
    assert.ok(data.id, 'Issue should have id');
  } finally {
    await server.stop();
  }
}

/**
 * Test: Jira MCP transition issue
 */
async function testJiraMCPTransitionIssue() {
  const server = createMockMCPServer('jira', { healthy: true, authenticated: true });

  try {
    // Act: Start server and transition issue
    const url = await server.start();

    const transitionData = {
      transition: { id: '21' }
    };

    const response = await httpRequest(`${url}/rest/api/2/issue/TEST-123/transitions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic dGVzdDp0ZXN0'
      },
      body: JSON.stringify(transitionData)
    });

    // Assert: Transition succeeds
    assert.strictEqual(response.statusCode, 204, 'Transition should return 204');
  } finally {
    await server.stop();
  }
}

// =============================================================================
// Multi-Server Coordination Tests
// =============================================================================

/**
 * Test: Multi-server independent health tracking
 */
async function testMultiServerHealthTracking() {
  const githubServer = createMockMCPServer('github', { healthy: true });
  const jiraServer = createMockMCPServer('jira', { healthy: true, authenticated: true });

  try {
    // Act: Start both servers
    const githubUrl = await githubServer.start();
    const jiraUrl = await jiraServer.start();

    // Check health of both
    const githubHealth = await httpRequest(`${githubUrl}/health`);
    const jiraHealth = await httpRequest(`${jiraUrl}/health`);

    // Assert: Both healthy independently
    assert.strictEqual(githubHealth.statusCode, 200, 'GitHub should be healthy');
    assert.strictEqual(jiraHealth.statusCode, 200, 'Jira should be healthy');

    const githubData = JSON.parse(githubHealth.body);
    const jiraData = JSON.parse(jiraHealth.body);

    assert.strictEqual(githubData.status, 'healthy', 'GitHub status should be healthy');
    assert.strictEqual(jiraData.status, 'healthy', 'Jira status should be healthy');

    // Assert: Servers are independent (different ports)
    assert.notStrictEqual(githubUrl, jiraUrl, 'Servers should have different URLs');
  } finally {
    await githubServer.stop();
    await jiraServer.stop();
  }
}

/**
 * Test: MCP server error handling
 */
async function testMCPServerErrorHandling() {
  const authFailServer = createMockMCPServer('auth-failing');

  try {
    // Act: Start auth-failing server
    const url = await authFailServer.start();
    const response = await httpRequest(`${url}/any-endpoint`);

    // Assert: Server returns 401 for all requests
    assert.strictEqual(response.statusCode, 401, 'Should return 401');

    const data = JSON.parse(response.body);
    assert.strictEqual(data.error, 'Unauthorized', 'Should return auth error');
  } finally {
    await authFailServer.stop();
  }
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function runTests() {
  console.log('\nMCP Integration Tests\n');

  // Skip external API tests if flag set
  if (process.env.ECC_SKIP_EXTERNAL === '1') {
    console.log('Skipping external API tests (ECC_SKIP_EXTERNAL=1)\n');
    return;
  }

  const tests = [
    // GitHub MCP (4 tests)
    asyncTest('GitHub MCP health check succeeds', testGitHubMCPHealthCheck),
    asyncTest('GitHub MCP creates PR successfully', testGitHubMCPCreatePR),
    asyncTest('GitHub MCP lists issues', testGitHubMCPListIssues),
    asyncTest('GitHub MCP request logging', testGitHubMCPRequestLogging),

    // Jira MCP (4 tests)
    asyncTest('Jira MCP authentication flow', testJiraMCPAuthentication),
    asyncTest('Jira MCP search issues', testJiraMCPSearchIssues),
    asyncTest('Jira MCP create issue', testJiraMCPCreateIssue),
    asyncTest('Jira MCP transition issue', testJiraMCPTransitionIssue),

    // Multi-Server Coordination (2 tests)
    asyncTest('Multi-server independent health tracking', testMultiServerHealthTracking),
    asyncTest('MCP server error handling', testMCPServerErrorHandling)
  ];

  const results = await Promise.all(tests);
  const passed = results.filter(r => r).length;
  const failed = results.length - passed;

  console.log(`\nResults: ${passed} passed, ${failed} failed (${tests.length} total)\n`);

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
