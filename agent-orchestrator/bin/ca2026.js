#!/usr/bin/env bun
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Recreate the missing __dirname variable for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Point to the TSX entry file
const entryFile = join(__dirname, '..', 'src', 'index.tsx');

// Import and execute the agent
import(entryFile).catch(err => {
  console.error("Agent crashed:", err);
  process.exit(1);
});
