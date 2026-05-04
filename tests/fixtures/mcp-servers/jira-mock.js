/**
 * Mock Jira API server for integration testing
 *
 * Simulates Jira API endpoints for issue search, creation, and transitions.
 * Used by mcp-integration.test.js to test Jira MCP workflows without real API calls.
 */

const http = require('http');

/**
 * Create a mock Jira API server
 *
 * @param {object} options - Server configuration
 * @param {boolean} options.healthy - Whether server responds with healthy status
 * @param {boolean} options.authenticated - Whether auth succeeds or fails
 * @param {number} options.delay - Response delay in ms (for timeout testing)
 * @param {number} options.port - Port to listen on (default: random)
 * @returns {object} Server instance with start(), stop(), url properties
 */
function createJiraMockServer(options = {}) {
  const { healthy = true, authenticated = true, delay = 0, port = 0 } = options;

  let server = null;
  let serverUrl = null;

  const requestLog = [];

  const handler = async (req, res) => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Log request for assertions
    requestLog.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      timestamp: Date.now()
    });

    // Check authentication
    const authHeader = req.headers.authorization;
    if (!authenticated || !authHeader) {
      if (req.url !== '/health') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errorMessages: ['Unauthorized'] }));
        return;
      }
    }

    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: healthy ? 'healthy' : 'unhealthy' }));
      return;
    }

    // Search issues endpoint
    if (req.method === 'POST' && req.url === '/rest/api/2/search') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          total: 2,
          issues: [
            { key: 'TEST-123', fields: { summary: 'Test issue 1', status: { name: 'Open' } } },
            { key: 'TEST-124', fields: { summary: 'Test issue 2', status: { name: 'In Progress' } } }
          ]
        }));
      });
      return;
    }

    // Create issue endpoint
    if (req.method === 'POST' && req.url === '/rest/api/2/issue') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const data = JSON.parse(body);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          key: 'TEST-125',
          id: '10001',
          self: `${serverUrl}/rest/api/2/issue/10001`
        }));
      });
      return;
    }

    // Transition issue endpoint
    if (req.method === 'POST' && req.url.match(/\/rest\/api\/2\/issue\/.+\/transitions$/)) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(204);
        res.end();
      });
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errorMessages: ['Not Found'] }));
  };

  return {
    start() {
      return new Promise((resolve, reject) => {
        server = http.createServer(handler);
        server.listen(port, () => {
          const addr = server.address();
          serverUrl = `http://localhost:${addr.port}`;
          resolve(serverUrl);
        });
        server.on('error', reject);
      });
    },

    stop() {
      return new Promise((resolve, reject) => {
        if (server) {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        } else {
          resolve();
        }
      });
    },

    get url() {
      return serverUrl;
    },

    get requests() {
      return requestLog;
    },

    clearRequests() {
      requestLog.length = 0;
    }
  };
}

module.exports = { createJiraMockServer };
