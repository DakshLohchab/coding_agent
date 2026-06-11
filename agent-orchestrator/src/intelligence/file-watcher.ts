import { injectable, inject } from 'tsyringe';
import * as chokidar from 'chokidar';
import * as crypto from 'crypto';
import * as fs from 'fs';
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
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true
    });

    this.watcher
      .on('add', path => this.handleFileChange(path))
      .on('change', path => this.handleFileChange(path))
      .on('unlink', path => this.handleFileRemove(path));
  }

  private handleFileChange(path: string) {
    if (!path.endsWith('.ts')) return; // Process TypeScript files
    
    try {
      const currentHash = this.computeHash(path);
      if (this.fileHashes.get(path) === currentHash) {
        return; // File content hasn't structurally changed
      }

      this.logger.info(`[Watcher] File changed: ${path}. Selectively updating AST & Vector Index...`);
      this.fileHashes.set(path, currentHash);
      
      // Fire-and-forget indexing (daemonized)
      this.indexer.indexFile(path).catch(err => {
        this.logger.error(`Error indexing file ${path}`, err);
      });
    } catch (error) {
      this.logger.error(`Watcher error processing ${path}`, error);
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
