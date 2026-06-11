#!/usr/bin/env bun
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Recreate the missing __dirname variable for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Point to the TSX entry file
const entryFile = join(__dirname, '..', 'src', 'index.tsx');

// Convert the absolute Windows path to a valid file:// URL
import(pathToFileURL(entryFile).href).catch(err => {
  console.error("Agent crashed:", err);
  process.exit(1);
});
