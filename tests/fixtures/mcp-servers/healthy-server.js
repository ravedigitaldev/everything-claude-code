#!/usr/bin/env node
/**
 * Mock healthy MCP server for testing
 * Stays running to simulate a healthy MCP server process
 */

// MCP servers should stay running, not exit immediately
// The health check expects the process to be alive

// Send initial response (optional, for realism)
console.log(JSON.stringify({
  jsonrpc: '2.0',
  result: {
    serverInfo: {
      name: 'healthy-test-server',
      version: '1.0.0'
    }
  }
}));

// Keep process alive - this is what makes it "healthy"
// The health check will kill it after verifying it's running
setInterval(() => {
  // Just keep alive
}, 1000);
