/**
 * Mock GitHub API server for integration testing
 *
 * Simulates GitHub API endpoints for PR creation, issue management, etc.
 * Used by mcp-integration.test.js to test GitHub MCP workflows without real API calls.
 */

const http = require('http');

/**
 * Create a mock GitHub API server
 *
 * @param {object} options - Server configuration
 * @param {boolean} options.healthy - Whether server responds with healthy status
 * @param {number} options.delay - Response delay in ms (for timeout testing)
 * @param {number} options.port - Port to listen on (default: random)
 * @returns {object} Server instance with start(), stop(), url properties
 */
function createGitHubMockServer(options = {}) {
  const { healthy = true, delay = 0, port = 0 } = options;

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

    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: healthy ? 'healthy' : 'unhealthy' }));
      return;
    }

    // Create PR endpoint
    if (req.method === 'POST' && req.url.match(/\/repos\/.+\/.+\/pulls$/)) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const data = JSON.parse(body);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 12345,
          number: 42,
          title: data.title,
          state: 'open',
          html_url: 'https://github.com/test/repo/pull/42'
        }));
      });
      return;
    }

    // List issues endpoint
    if (req.method === 'GET' && req.url.match(/\/repos\/.+\/.+\/issues$/)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { id: 1, number: 10, title: 'Test issue 1', state: 'open' },
        { id: 2, number: 11, title: 'Test issue 2', state: 'closed' }
      ]));
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not Found' }));
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

module.exports = { createGitHubMockServer };
