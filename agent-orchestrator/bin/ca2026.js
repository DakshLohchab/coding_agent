#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkgDir  = join(__dirname, '..');
const distEntry = join(pkgDir, 'dist', 'index.js');
const tsc = join(pkgDir, 'node_modules', '.bin', 'tsc');

const buildResult = spawnSync(tsc, ['-p', pkgDir], {
    stdio: 'inherit',
    shell: true,
    cwd: pkgDir
});

if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
}

const result = spawnSync(process.execPath, [distEntry], {
    stdio: 'inherit',
    cwd: pkgDir
});

process.exit(result.status ?? 0);
