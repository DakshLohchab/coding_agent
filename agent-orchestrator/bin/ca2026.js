#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Recreate directory variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Point to the TSX entry file
const entryFile = join(__dirname, '..', 'src', 'index.tsx');

// Trampoline: Force Node to instantly spawn Bun and hand over the terminal
const result = spawnSync('bun', ['run', entryFile], { 
    stdio: 'inherit', 
    shell: true 
});

// Exit cleanly when the agent closes
process.exit(result.status ?? 0);
