import { injectable } from 'tsyringe';
import { EventEmitter } from 'events';

@injectable()
export class EventBroker extends EventEmitter {
  constructor() {
    super();
    // Allow an unlimited number of listeners for UI, Daemon, and remote Hooks
    this.setMaxListeners(0);
  }

  /**
   * Wrapper for asynchronous emission.
   * Defers event dispatching to the next iteration of the event loop.
   * This ensures heavy state transitions or tool invocations never block the React/Ink UI thread.
   */
  public emitAsync(event: string, ...args: any[]): void {
    setImmediate(() => {
      this.emit(event, ...args);
    });
  }
}
