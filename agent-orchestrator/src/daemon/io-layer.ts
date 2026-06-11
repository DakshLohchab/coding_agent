import { injectable, inject } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import { ILogger } from '../agents/interfaces';
import { EventEmitter } from 'events';

export interface IOMessage {
  type: 'prompt' | 'audio_hook' | 'cli_arg' | 'collision_resolution';
  payload: any;
}

@injectable()
export class IOLayer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  
  constructor(@inject('ILogger') private logger: ILogger) {
    super();
  }

  public initialize(port: number = 8080) {
    // 1. WebSocket Server (Browser extension / Website integration)
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (message: string) => {
        try {
          const parsed = JSON.parse(message);
          this.emit('input', parsed as IOMessage);
        } catch(e) {
          this.logger.warn('IOLayer: Failed to parse WS message.');
        }
      });
    });

    // 2. CLI Arguments standard input
    const args = process.argv.slice(2);
    if (args.length > 0) {
      // Defer emitting until machine is ready
      setTimeout(() => this.emit('input', { type: 'cli_arg', payload: args.join(' ') }), 1000);
    }

    // 3. Audio Pipeline Hook Placeholder (WebRTC or local mic instances)
    // Audio streams would buffer here, trigger VAD, and hit a transcription model before emitting as 'prompt'
  }

  public broadcast(message: any) {
    if (this.wss) {
      const data = JSON.stringify(message);
      this.wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    }
  }
}
