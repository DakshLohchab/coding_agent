#!/usr/bin/env node

const path = require('path');

// Resolve the path to the original agent-orchestrator directory
const projectDir = path.resolve(__dirname, '..');

// Register ts-node to compile TypeScript on the fly using the orchestrator's tsconfig
require('ts-node').register({
  project: path.join(projectDir, 'tsconfig.json'),
  transpileOnly: true
});

// Boot up the orchestrator daemon!
require(path.join(projectDir, 'src', 'index.tsx'));
