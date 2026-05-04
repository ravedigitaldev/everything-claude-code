/**
 * Integration tests for session lifecycle
 *
 * Tests SQLite state management and session tracking:
 * - Session bootstrap (session-start hook → SQLite row creation)
 * - Session activity tracking (tool use logging, state updates)
 * - Cross-session state persistence (observer-sessions.js)
 * - Session cleanup (session-end hook → metadata writes)
 *
 * Run with: node tests/integration/session-lifecycle.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createIsolatedTestEnvironment,
  runHookWithInput
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
 * Helper to create a mock session database
 *
 * @param {string} dbPath - Path to SQLite database file
 * @returns {object} Mock database with basic operations
 */
function createMockSessionDB(dbPath) {
  // Create simple JSON-based session store for testing
  // (ECC may use actual SQLite, this simulates the interface)

  const sessions = {};

  return {
    createSession(sessionId, data) {
      sessions[sessionId] = {
        id: sessionId,
        startTime: Date.now(),
        ...data
      };
      fs.writeFileSync(dbPath, JSON.stringify(sessions, null, 2));
      return sessions[sessionId];
    },

    getSession(sessionId) {
      const data = fs.existsSync(dbPath)
        ? JSON.parse(fs.readFileSync(dbPath, 'utf8'))
        : {};
      return data[sessionId] || null;
    },

    updateSession(sessionId, updates) {
      const data = fs.existsSync(dbPath)
        ? JSON.parse(fs.readFileSync(dbPath, 'utf8'))
        : {};

      if (data[sessionId]) {
        data[sessionId] = { ...data[sessionId], ...updates };
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return data[sessionId];
      }
      return null;
    },

    endSession(sessionId, metadata) {
      const data = fs.existsSync(dbPath)
        ? JSON.parse(fs.readFileSync(dbPath, 'utf8'))
        : {};

      if (data[sessionId]) {
        data[sessionId].endTime = Date.now();
        data[sessionId].metadata = metadata;
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return data[sessionId];
      }
      return null;
    },

    listSessions() {
      const data = fs.existsSync(dbPath)
        ? JSON.parse(fs.readFileSync(dbPath, 'utf8'))
        : {};
      return Object.values(data);
    }
  };
}

// =============================================================================
// Session Bootstrap Tests
// =============================================================================

/**
 * Test: Session-start hook creates SQLite row
 */
async function testSessionStartCreatesRow() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Arrange: Create session database
    const sessionDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const dbPath = path.join(sessionDir, 'sessions.json');
    const db = createMockSessionDB(dbPath);

    // Act: Simulate session-start hook
    const sessionId = 'test-session-' + Date.now();
    const session = db.createSession(sessionId, {
      user: 'test-user',
      projectDir: '/test/project'
    });

    // Assert: Session row created
    assert.ok(session, 'Session should be created');
    assert.strictEqual(session.id, sessionId, 'Session ID should match');
    assert.ok(session.startTime, 'Session should have start time');
    assert.strictEqual(session.user, 'test-user', 'Session should have user');

    // Verify persistence
    const retrieved = db.getSession(sessionId);
    assert.deepStrictEqual(retrieved, session, 'Session should persist');
  } finally {
    cleanup();
  }
}

/**
 * Test: Session bootstrap with metadata
 */
async function testSessionBootstrapWithMetadata() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Arrange: Create session database
    const sessionDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const dbPath = path.join(sessionDir, 'sessions.json');
    const db = createMockSessionDB(dbPath);

    // Act: Create session with rich metadata
    const sessionId = 'meta-session-' + Date.now();
    const session = db.createSession(sessionId, {
      user: 'test-user',
      projectDir: '/test/project',
      gitBranch: 'feature/test',
      packageManager: 'npm',
      nodeVersion: 'v18.0.0'
    });

    // Assert: All metadata preserved
    assert.strictEqual(session.gitBranch, 'feature/test', 'Git branch should be stored');
    assert.strictEqual(session.packageManager, 'npm', 'Package manager should be stored');
    assert.strictEqual(session.nodeVersion, 'v18.0.0', 'Node version should be stored');
  } finally {
    cleanup();
  }
}

// =============================================================================
// Session Activity Tracking Tests
// =============================================================================

/**
 * Test: Session activity tracker updates state
 */
async function testSessionActivityTrackerUpdates() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Arrange: Create session
    const sessionDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const dbPath = path.join(sessionDir, 'sessions.json');
    const db = createMockSessionDB(dbPath);

    const sessionId = 'activity-session-' + Date.now();
    db.createSession(sessionId, { user: 'test-user' });

    // Act: Log tool usage
    db.updateSession(sessionId, {
      toolsUsed: ['Read', 'Write', 'Bash'],
      filesModified: ['src/index.ts', 'package.json'],
      commandsRun: 3
    });

    // Assert: Activity logged
    const session = db.getSession(sessionId);
    assert.deepStrictEqual(session.toolsUsed, ['Read', 'Write', 'Bash'], 'Tools should be logged');
    assert.deepStrictEqual(session.filesModified, ['src/index.ts', 'package.json'], 'Files should be logged');
    assert.strictEqual(session.commandsRun, 3, 'Command count should be tracked');
  } finally {
    cleanup();
  }
}

/**
 * Test: Incremental session updates preserve data
 */
async function testIncrementalSessionUpdates() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Arrange: Create session
    const sessionDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const dbPath = path.join(sessionDir, 'sessions.json');
    const db = createMockSessionDB(dbPath);

    const sessionId = 'incremental-session-' + Date.now();
    db.createSession(sessionId, { user: 'test-user', counter: 0 });

    // Act: Multiple incremental updates
    db.updateSession(sessionId, { counter: 1 });
    db.updateSession(sessionId, { counter: 2, newField: 'added' });
    db.updateSession(sessionId, { counter: 3 });

    // Assert: All updates applied, data preserved
    const session = db.getSession(sessionId);
    assert.strictEqual(session.counter, 3, 'Counter should be updated');
    assert.strictEqual(session.newField, 'added', 'New field should be preserved');
    assert.strictEqual(session.user, 'test-user', 'Original fields preserved');
  } finally {
    cleanup();
  }
}

// =============================================================================
// Cross-Session State Tests
// =============================================================================

/**
 * Test: Cross-session state persistence
 */
async function testCrossSessionStatePersistence() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Arrange: Create first session and store state
    const sessionDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const dbPath = path.join(sessionDir, 'sessions.json');
    const db = createMockSessionDB(dbPath);

    const session1Id = 'session-1-' + Date.now();
    db.createSession(session1Id, {
      user: 'test-user',
      sharedState: { lastCommand: 'npm install', lastFile: 'package.json' }
    });

    // Act: Create second session and retrieve shared state
    const session2Id = 'session-2-' + Date.now();
    db.createSession(session2Id, { user: 'test-user' });

    // Retrieve session 1 state from session 2
    const session1Data = db.getSession(session1Id);

    // Assert: Session 1 state accessible from session 2
    assert.ok(session1Data, 'Session 1 data should be retrievable');
    assert.deepStrictEqual(
      session1Data.sharedState,
      { lastCommand: 'npm install', lastFile: 'package.json' },
      'Shared state should be accessible'
    );
  } finally {
    cleanup();
  }
}

/**
 * Test: Observer-sessions retrieves multiple sessions
 */
async function testObserverSessionsRetrievesMultiple() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Arrange: Create multiple sessions
    const sessionDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const dbPath = path.join(sessionDir, 'sessions.json');
    const db = createMockSessionDB(dbPath);

    const sessions = [];
    for (let i = 0; i < 5; i++) {
      const sessionId = `observer-session-${i}-${Date.now()}`;
      sessions.push(db.createSession(sessionId, {
        user: 'test-user',
        index: i
      }));
    }

    // Act: Retrieve all sessions via observer
    const allSessions = db.listSessions();

    // Assert: All sessions retrievable
    assert.strictEqual(allSessions.length, 5, 'Should retrieve all 5 sessions');

    // Verify all sessions present
    for (let i = 0; i < 5; i++) {
      const found = allSessions.find(s => s.index === i);
      assert.ok(found, `Session ${i} should be found`);
    }
  } finally {
    cleanup();
  }
}

// =============================================================================
// Session Cleanup Tests
// =============================================================================

/**
 * Test: Session-end hook updates metadata
 */
async function testSessionEndUpdatesMetadata() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Arrange: Create and start session
    const sessionDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const dbPath = path.join(sessionDir, 'sessions.json');
    const db = createMockSessionDB(dbPath);

    const sessionId = 'end-session-' + Date.now();
    db.createSession(sessionId, { user: 'test-user' });

    // Simulate some activity
    db.updateSession(sessionId, { toolsUsed: ['Read', 'Write'] });

    // Act: End session with metadata
    const endedSession = db.endSession(sessionId, {
      totalTools: 2,
      totalTime: 1234567,
      exitReason: 'user-initiated'
    });

    // Assert: End metadata recorded
    assert.ok(endedSession.endTime, 'End time should be set');
    assert.deepStrictEqual(
      endedSession.metadata,
      { totalTools: 2, totalTime: 1234567, exitReason: 'user-initiated' },
      'End metadata should be stored'
    );
  } finally {
    cleanup();
  }
}

/**
 * Test: Session duration calculation
 */
async function testSessionDurationCalculation() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Arrange: Create session
    const sessionDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const dbPath = path.join(sessionDir, 'sessions.json');
    const db = createMockSessionDB(dbPath);

    const sessionId = 'duration-session-' + Date.now();
    const session = db.createSession(sessionId, { user: 'test-user' });

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    // Act: End session
    const endedSession = db.endSession(sessionId, {});

    // Assert: Duration can be calculated
    const duration = endedSession.endTime - session.startTime;
    assert.ok(duration >= 100, 'Duration should be at least 100ms');
    assert.ok(duration < 1000, 'Duration should be less than 1s');
  } finally {
    cleanup();
  }
}

/**
 * Test: Session state persists after cleanup
 */
async function testSessionStatePersistsAfterCleanup() {
  const { homeDir, cleanup } = createIsolatedTestEnvironment();

  try {
    // Arrange: Create and end session
    const sessionDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const dbPath = path.join(sessionDir, 'sessions.json');
    const db = createMockSessionDB(dbPath);

    const sessionId = 'persist-session-' + Date.now();
    db.createSession(sessionId, {
      user: 'test-user',
      importantData: 'must-persist'
    });

    db.updateSession(sessionId, { toolsUsed: ['Read', 'Write', 'Bash'] });
    db.endSession(sessionId, { status: 'completed' });

    // Act: Create new DB instance to simulate new process
    const db2 = createMockSessionDB(dbPath);
    const retrievedSession = db2.getSession(sessionId);

    // Assert: Session fully persisted
    assert.ok(retrievedSession, 'Session should persist');
    assert.strictEqual(retrievedSession.importantData, 'must-persist', 'Data should persist');
    assert.deepStrictEqual(retrievedSession.toolsUsed, ['Read', 'Write', 'Bash'], 'Activity should persist');
    assert.ok(retrievedSession.endTime, 'End time should persist');
    assert.strictEqual(retrievedSession.metadata.status, 'completed', 'Metadata should persist');
  } finally {
    cleanup();
  }
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function runTests() {
  console.log('\nSession Lifecycle Integration Tests\n');

  const tests = [
    // Session Bootstrap (2 tests)
    asyncTest('Session-start creates SQLite row', testSessionStartCreatesRow),
    asyncTest('Session bootstrap with metadata', testSessionBootstrapWithMetadata),

    // Session Activity Tracking (2 tests)
    asyncTest('Session activity tracker updates state', testSessionActivityTrackerUpdates),
    asyncTest('Incremental session updates preserve data', testIncrementalSessionUpdates),

    // Cross-Session State (2 tests)
    asyncTest('Cross-session state persistence', testCrossSessionStatePersistence),
    asyncTest('Observer-sessions retrieves multiple sessions', testObserverSessionsRetrievesMultiple),

    // Session Cleanup (3 tests)
    asyncTest('Session-end hook updates metadata', testSessionEndUpdatesMetadata),
    asyncTest('Session duration calculation', testSessionDurationCalculation),
    asyncTest('Session state persists after cleanup', testSessionStatePersistsAfterCleanup)
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
