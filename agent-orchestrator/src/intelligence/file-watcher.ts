import { injectable, inject } from 'tsyringe';
import * as chokidar from 'chokidar';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ILogger } from '../agents/interfaces';
import { Indexer } from './indexer';

@injectable()
export class FileWatcherDaemon {
  private watcher: chokidar.FSWatcher | null = null;
  private fileHashes: Map<string, string> = new Map();

  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(Indexer) private indexer: Indexer
  ) {}

  public start(watchPath: string) {
    this.logger.info(`Starting FileWatcherDaemon on path: ${watchPath}`);
    this.watcher = chokidar.watch(watchPath, {
      // Ignore dotfiles, node_modules, and TypeScript declaration files (.d.ts)
      ignored: (p: string) => {
        if (!p) return false;
        if ((/([\/\\])node_modules([\/\\])/.test(p))) return true;
        if (/\.d\.ts$/.test(p)) return true;
        if ((/(^|[\/\\])\./.test(path.basename(p)))) return true;
        return false;
      },
      persistent: true,
      ignoreInitial: true
    });

    this.watcher
      .on('add', path => this.handleFileChange(path))
      .on('change', path => this.handleFileChange(path))
      .on('unlink', path => this.handleFileRemove(path));
  }

  private handleFileChange(filePath: string) {
    const normalized = filePath.replace(/\\/g, '/');

    // Skip node_modules and declaration files explicitly (guard in addition to chokidar ignored)
    if (normalized.includes('/node_modules/')) return;
    if (normalized.endsWith('.d.ts')) return;

    // Only process TypeScript source files
    if (!(normalized.endsWith('.ts') || normalized.endsWith('.tsx'))) return;

    try {
      const stats = fs.statSync(filePath);
      const MAX_SIZE = 1_000_000; // 1MB
      if (stats.size > MAX_SIZE) {
        this.logger.info(`[Watcher] Skipping large file: ${filePath} (${stats.size} bytes)`);
        return;
      }

      const currentHash = this.computeHash(filePath);
      if (this.fileHashes.get(filePath) === currentHash) {
        return; // File content hasn't structurally changed
      }

      this.logger.info(`[Watcher] File changed: ${filePath}. Selectively updating AST & Vector Index...`);
      this.fileHashes.set(filePath, currentHash);
      
      // Fire-and-forget indexing (daemonized)
      this.indexer.indexFile(filePath).catch(err => {
        this.logger.error(`Error indexing file ${filePath}`, err);
      });
    } catch (error) {
      this.logger.error(`Watcher error processing ${filePath}`, error);
    }
  }

  private handleFileRemove(path: string) {
    this.logger.info(`[Watcher] File removed: ${path}.`);
    this.fileHashes.delete(path);
    // In a full implementation, we would also issue a delete query to ChromaDB for this filePath.
  }

  private computeHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  }
}
