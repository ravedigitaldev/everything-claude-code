/**
 * Mock server that always returns 401 Unauthorized
 *
 * Used for testing authentication failure scenarios in MCP integration tests.
 * Simulates external services that reject invalid credentials.
 */

const http = require('http');

/**
 * Create a mock server that always fails authentication
 *
 * @param {object} options - Server configuration
 * @param {number} options.delay - Response delay in ms (for timeout testing)
 * @param {number} options.port - Port to listen on (default: random)
 * @returns {object} Server instance with start(), stop(), url properties
 */
function createAuthFailingServer(options = {}) {
  const { delay = 0, port = 0 } = options;

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

    // Always return 401 Unauthorized
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Unauthorized',
      message: 'Invalid credentials'
    }));
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

module.exports = { createAuthFailingServer };
