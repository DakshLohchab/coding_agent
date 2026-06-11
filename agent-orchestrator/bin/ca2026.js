#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

// Resolve the path to the original agent-orchestrator directory
const projectDir = path.resolve(__dirname, '..');
const entryFile = path.join(projectDir, 'src', 'index.tsx');

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// Boot up the orchestrator daemon natively via TSX
const result = spawnSync(npxCmd, ['tsx', entryFile], { stdio: 'inherit' });

if (result.error) {
  console.error("Agent crashed:", result.error);
  process.exit(1);
}

process.exit(result.status || 0);
