#!/usr/bin/env node
/**
 * Mock broken MCP server for testing
 * Exits with code 1 to simulate unhealthy server
 */

console.error('Error: Server failed to start');
process.exit(1);
