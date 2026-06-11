import { injectable, inject } from 'tsyringe';
import { ILogger } from '../agents/interfaces';
import * as chokidar from 'chokidar';
import { EventEmitter } from 'events';

@injectable()
export class CollisionDetector extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private isAgentWriting: boolean = false;

  constructor(@inject('ILogger') private logger: ILogger) {
    super();
  }

  public start(watchPath: string) {
    this.watcher = chokidar.watch(watchPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true
    });

    this.watcher.on('change', (path) => {
      if (!this.isAgentWriting) {
        // A user or external process edited the file while the agent is active
        this.emit('collision', path);
      }
    });
  }

  // Execution Layer calls this before and after writing to disk to prevent self-triggering
  public setAgentWriting(state: boolean) {
    this.isAgentWriting = state;
  }
}
