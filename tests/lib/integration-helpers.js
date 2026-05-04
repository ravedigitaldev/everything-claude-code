/**
 * Integration test helper utilities
 *
 * Provides reusable functions for integration testing across the ECC project.
 * Run tests: node tests/lib/integration-helpers.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

/**
 * Create isolated test environment with mock HOME and project directory
 *
 * @returns {{tmpDir: string, homeDir: string, projectDir: string, cleanup: function}}
 */
function createIsolatedTestEnvironment() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-test-'));
  const homeDir = path.join(tmpDir, 'home');
  const projectDir = path.join(tmpDir, 'project');

  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  return {
    tmpDir,
    homeDir,
    projectDir,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        // Ignore cleanup errors (file in use on Windows, etc.)
      }
    }
  };
}

/**
 * Run install script with isolated environment
 *
 * @param {string[]} args - Arguments to pass to install-apply.js
 * @param {object} options - Options
 * @param {string} options.homeDir - Mock HOME directory
 * @param {string} options.projectDir - Mock project directory
 * @param {object} [options.env={}] - Additional environment variables
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
async function runInstallScript(args, { homeDir, projectDir, env = {} }) {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const installScript = path.join(REPO_ROOT, 'scripts', 'install-apply.js');

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [installScript, ...args], {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir, // Windows
        CLAUDE_PROJECT_DIR: projectDir,
        CLAUDE_PLUGIN_ROOT: REPO_ROOT,
        ...env
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => stdout += data);
    proc.stderr.on('data', data => stderr += data);

    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.on('error', reject);
  });
}

/**
 * Run a hook script with simulated Claude Code input
 *
 * @param {string} scriptPath - Path to the hook script
 * @param {object} input - Hook input object (will be JSON stringified)
 * @param {object} env - Environment variables
 * @param {number} [timeoutMs=10000] - Timeout in milliseconds
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runHookWithInput(scriptPath, input = {}, env = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => stdout += data);
    proc.stderr.on('data', data => stderr += data);

    // Ignore EPIPE/EOF errors (process may exit before we finish writing)
    proc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'EOF') {
        reject(err);
      }
    });

    // Send JSON input on stdin (simulating Claude Code hook invocation)
    if (input && Object.keys(input).length > 0) {
      proc.stdin.write(JSON.stringify(input));
    }
    proc.stdin.end();

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Hook timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Assert files exist at expected paths
 *
 * @param {string} baseDir - Base directory to check
 * @param {string[]} expectedFiles - Array of relative file paths
 * @throws {Error} If any files are missing
 */
function assertFilesExist(baseDir, expectedFiles) {
  const missing = [];
  for (const file of expectedFiles) {
    const fullPath = path.join(baseDir, file);
    if (!fs.existsSync(fullPath)) {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing expected files: ${missing.join(', ')}`);
  }
}

/**
 * Assert files do NOT exist at specified paths
 *
 * @param {string} baseDir - Base directory to check
 * @param {string[]} unexpectedFiles - Array of relative file paths that should not exist
 * @throws {Error} If any files exist
 */
function assertFilesNotExist(baseDir, unexpectedFiles) {
  const found = [];
  for (const file of unexpectedFiles) {
    const fullPath = path.join(baseDir, file);
    if (fs.existsSync(fullPath)) {
      found.push(file);
    }
  }
  if (found.length > 0) {
    throw new Error(`Unexpected files found: ${found.join(', ')}`);
  }
}

/**
 * Read install state from .claude/ecc/install-state.json
 *
 * @param {string} homeDir - Home directory containing .claude/
 * @returns {object} Parsed install state
 * @throws {Error} If state file doesn't exist or is invalid JSON
 */
function readInstallState(homeDir) {
  const statePath = path.join(homeDir, '.claude', 'ecc', 'install-state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`Install state file not found at ${statePath}`);
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

/**
 * Create a mock Git repository in the specified directory
 *
 * @param {string} repoDir - Directory to initialize as git repo
 * @param {object} [options] - Options
 * @param {boolean} [options.withCommit=false] - Create initial commit
 * @param {boolean} [options.withUncommittedChanges=false] - Add uncommitted changes
 */
function createMockGitRepo(repoDir, options = {}) {
  const { execSync } = require('child_process');

  // Initialize repo
  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: repoDir, stdio: 'pipe' });

  if (options.withCommit) {
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test Repo');
    execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: repoDir, stdio: 'pipe' });
  }

  if (options.withUncommittedChanges) {
    fs.writeFileSync(path.join(repoDir, 'test.js'), 'console.log("test");');
  }
}

/**
 * Copy test fixture to target directory
 *
 * @param {string} fixtureName - Name of fixture in tests/fixtures/
 * @param {string} targetDir - Target directory to copy to
 */
function copyFixture(fixtureName, targetDir) {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const fixturePath = path.join(REPO_ROOT, 'tests', 'fixtures', fixtureName);

  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixtureName}`);
  }

  // Recursive copy
  const copyRecursive = (src, dest) => {
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src)) {
        copyRecursive(path.join(src, entry), path.join(dest, entry));
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  };

  copyRecursive(fixturePath, targetDir);
}

/**
 * Create a mock MCP server for testing external integrations
 *
 * @param {string} type - Server type: 'github', 'jira', 'auth-failing'
 * @param {object} options - Server configuration options
 * @returns {object} Mock server instance with start(), stop(), url properties
 */
function createMockMCPServer(type, options = {}) {
  const REPO_ROOT = path.join(__dirname, '..', '..');

  switch (type) {
    case 'github': {
      const { createGitHubMockServer } = require(
        path.join(REPO_ROOT, 'tests', 'fixtures', 'mcp-servers', 'github-mock')
      );
      return createGitHubMockServer(options);
    }
    case 'jira': {
      const { createJiraMockServer } = require(
        path.join(REPO_ROOT, 'tests', 'fixtures', 'mcp-servers', 'jira-mock')
      );
      return createJiraMockServer(options);
    }
    case 'auth-failing': {
      const { createAuthFailingServer } = require(
        path.join(REPO_ROOT, 'tests', 'fixtures', 'mcp-servers', 'auth-failing-server')
      );
      return createAuthFailingServer(options);
    }
    default:
      throw new Error(`Unknown MCP server type: ${type}`);
  }
}

/**
 * Assert that output does not contain any secrets
 *
 * @param {string} stdout - Standard output to check
 * @param {string} stderr - Standard error to check
 * @param {string[]} secretPatterns - Array of secret strings or patterns to check for
 * @throws {Error} If any secrets found in output
 */
function assertNoSecretsInOutput(stdout, stderr, secretPatterns = []) {
  const defaultPatterns = [
    { pattern: 'ghp_', context: 'GitHub personal access token' },
    { pattern: 'gho_', context: 'GitHub OAuth token' },
    { pattern: 'ghs_', context: 'GitHub server-to-server token' },
    { pattern: 'AKIA', context: 'AWS access key' },
    { pattern: 'sk-', context: 'OpenAI/Anthropic API key' },
    { pattern: 'xoxb-', context: 'Slack bot token' },
    { pattern: 'xoxp-', context: 'Slack user token' }
  ];

  const combinedOutput = stdout + '\n' + stderr;

  // Check for high-confidence secret patterns (token prefixes)
  for (const { pattern, context } of defaultPatterns) {
    // Look for pattern followed by alphanumeric characters (actual token value)
    const regex = new RegExp(`${pattern}[A-Za-z0-9_-]{8,}`, 'g');
    const matches = combinedOutput.match(regex);

    if (matches && matches.length > 0) {
      throw new Error(
        `Secret pattern found in output: ${context}\n` +
        `Pattern: ${pattern}\n` +
        `First match: ${matches[0].substring(0, 20)}...\n` +
        `Output should never contain sensitive credentials`
      );
    }
  }

  // Check for custom secret patterns provided by caller
  for (const pattern of secretPatterns) {
    if (combinedOutput.includes(pattern)) {
      throw new Error(
        `Custom secret pattern found in output: ${pattern.substring(0, 20)}...\n` +
        `Output should never contain sensitive credentials`
      );
    }
  }

  // Check for suspicious patterns (key=value with sensitive keywords)
  const suspiciousKeywords = [
    'password',
    'secret',
    'token',
    'api_key',
    'AWS_SECRET',
    'GITHUB_PAT',
    'JIRA_TOKEN'
  ];

  for (const keyword of suspiciousKeywords) {
    // Look for keyword as a key with a non-empty value
    const regex = new RegExp(
      `${keyword}["']?\\s*[=:]\\s*["']?([^"'\\s,}]{3,})`,
      'gi'
    );
    const matches = combinedOutput.match(regex);

    if (matches && matches.length > 0) {
      // Filter out safe occurrences (null, undefined, empty, or placeholder values)
      const dangerousMatches = matches.filter(match => {
        const lowerMatch = match.toLowerCase();
        return !lowerMatch.match(/(null|undefined|""|''|xxx|placeholder|\$\{)/);
      });

      if (dangerousMatches.length > 0) {
        throw new Error(
          `Suspicious secret-like pattern found: ${keyword}\n` +
          `Match: ${dangerousMatches[0].substring(0, 40)}...\n` +
          `Output should never contain sensitive credentials`
        );
      }
    }
  }
}

/**
 * Create a test MCP configuration for integration testing
 *
 * @param {string[]} servers - Array of server names to include: 'github', 'jira', etc.
 * @param {object} options - Configuration options
 * @param {string} options.homeDir - Home directory for config file
 * @param {object} options.serverUrls - Map of server names to URLs
 * @returns {string} Path to created config file
 */
function createTestMCPConfig(servers = [], options = {}) {
  const { homeDir, serverUrls = {} } = options;

  if (!homeDir) {
    throw new Error('homeDir is required for createTestMCPConfig');
  }

  const mcpConfigDir = path.join(homeDir, '.claude', 'mcp-configs');
  fs.mkdirSync(mcpConfigDir, { recursive: true });

  const config = {
    mcpServers: {}
  };

  for (const serverName of servers) {
    const url = serverUrls[serverName] || `http://localhost:0`;

    switch (serverName) {
      case 'github':
        config.mcpServers.github = {
          command: 'node',
          args: ['mcp-server-github'],
          env: {
            GITHUB_API_URL: url,
            // Reference env var instead of hardcoded value
            GITHUB_PAT: '${GITHUB_PAT}'
          }
        };
        break;
      case 'jira':
        config.mcpServers.jira = {
          command: 'node',
          args: ['mcp-server-jira'],
          env: {
            JIRA_API_URL: url,
            // Reference env var instead of hardcoded value
            JIRA_TOKEN: '${JIRA_TOKEN}',
            JIRA_EMAIL: '${JIRA_EMAIL}'
          }
        };
        break;
      default:
        throw new Error(`Unknown server type: ${serverName}`);
    }
  }

  const configPath = path.join(mcpConfigDir, 'mcp-servers.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  return configPath;
}

module.exports = {
  createIsolatedTestEnvironment,
  runInstallScript,
  runHookWithInput,
  assertFilesExist,
  assertFilesNotExist,
  readInstallState,
  createMockGitRepo,
  copyFixture,
  createMockMCPServer,
  assertNoSecretsInOutput,
  createTestMCPConfig
};
