# Test Fixtures

This directory contains test fixtures used by integration tests.

## Structure

```
fixtures/
├── projects/           # Sample project structures
│   ├── typescript-simple/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/index.ts
│   └── python-django/
│       ├── requirements.txt
│       └── manage.py
└── mcp-servers/       # Mock MCP servers for testing
    ├── healthy-server.js   # Exits 0, simulates healthy server
    ├── broken-server.js    # Exits 1, simulates unhealthy server
    └── slow-server.js      # 5s delay, for timeout testing
```

## Usage

Use the `copyFixture()` helper from `integration-helpers.js`:

```javascript
const { copyFixture, createIsolatedTestEnvironment } = require('../lib/integration-helpers');

const env = createIsolatedTestEnvironment();
copyFixture('projects/typescript-simple', env.projectDir);
```

## Adding New Fixtures

1. Create fixture under appropriate subdirectory
2. Keep fixtures minimal (only essential files)
3. Document purpose in this README
4. Ensure fixtures work cross-platform (no hardcoded paths)
