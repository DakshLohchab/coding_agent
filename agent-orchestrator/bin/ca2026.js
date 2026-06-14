#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkgDir  = join(__dirname, '..');

// Use tsx for instant TypeScript execution (no compile step)
const tsx = join(pkgDir, 'node_modules', '.bin', 'tsx');
const entry = join(pkgDir, 'src', 'index.tsx');
const tsconfig = join(pkgDir, 'tsconfig.json');

const result = spawnSync(tsx, ['--tsconfig', tsconfig, entry], {
    stdio: 'inherit'
});

process.exit(result.status ?? 0);
