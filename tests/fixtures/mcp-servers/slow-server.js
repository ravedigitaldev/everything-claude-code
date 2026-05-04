#!/usr/bin/env node
/**
 * Mock slow MCP server for testing timeouts
 * Delays response to test timeout handling
 */

setTimeout(() => {
  console.log(JSON.stringify({
    jsonrpc: '2.0',
    result: {
      serverInfo: {
        name: 'slow-test-server',
        version: '1.0.0'
      }
    }
  }));
  process.exit(0);
}, 5000); // 5 second delay
