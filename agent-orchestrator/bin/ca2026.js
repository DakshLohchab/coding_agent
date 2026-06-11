#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkgDir  = join(__dirname, '..');
const entryFile = join(pkgDir, 'src', 'index.tsx');

// Use the local tsx binary (devDep) — esbuild honours emitDecoratorMetadata
// Unlike `bun run`, which silently strips it and breaks tsyringe.
const tsx = join(pkgDir, 'node_modules', '.bin', 'tsx');

const result = spawnSync(tsx, [entryFile], {
    stdio: 'inherit',
    shell: true,
    cwd: pkgDir   // run from the package root so tsx finds tsconfig.json
});

process.exit(result.status ?? 0);
