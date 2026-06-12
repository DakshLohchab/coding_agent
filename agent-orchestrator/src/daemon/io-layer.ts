import { injectable, inject } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import { ILogger } from '../agents/interfaces.js';
import { EventEmitter } from 'events';
import { EventBroker } from '../services/event-broker.js';

export interface IOMessage {
  type: 'prompt' | 'audio_stream' | 'cli_arg' | 'collision_resolution';
  payload: any;
}

@injectable()
export class IOLayer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private audioBuffer: Buffer[] = [];
  private isListening: boolean = false;
  private silenceTimeout: NodeJS.Timeout | null = null;
  
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(EventBroker) private eventBroker: EventBroker
  ) {
    super();
  }

  public initialize(port: number = 8080) {
    this.wss = new WebSocketServer({ port });
    
    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', async (message: any, isBinary: boolean) => {
        // Handle Multi-Modal binary streams natively
        if (isBinary) {
          this.handleAudioStream(message as Buffer);
        } else {
          try {
            const parsed = JSON.parse(message.toString());
            if (parsed.type === 'audio_stream') {
              // Fallback for Base64 encoded JSON streams
              const buffer = Buffer.from(parsed.payload, 'base64');
              this.handleAudioStream(buffer);
            } else {
              this.emit('input', parsed as IOMessage);
            }
          } catch(e) {
            this.logger.warn('IOLayer: Failed to parse WS message.');
          }
        }
      });
    });

    const args = process.argv.slice(2);
    if (args.length > 0) {
      setTimeout(() => this.emit('input', { type: 'cli_arg', payload: args.join(' ') }), 1000);
    }
  }

  private handleAudioStream(chunk: Buffer) {
    if (!this.isListening) {
      this.isListening = true;
      // Emit async UI event to render the 🎙️ visual indicator
      this.eventBroker.emitAsync('audio.listening', true);
      this.logger.info("IOLayer: Audio stream detected. Buffering PCM data...");
    }

    this.audioBuffer.push(chunk);

    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
    
    // Silence Detection: If no audio chunks received for 1.5s, process the prompt
    this.silenceTimeout = setTimeout(async () => {
      this.isListening = false;
      this.eventBroker.emitAsync('audio.listening', false);
      
      const fullAudio = Buffer.concat(this.audioBuffer);
      this.audioBuffer = []; // Clear buffer
      
      const transcribedText = await this.transcribeAudio(fullAudio);
      this.logger.info(`IOLayer: Transcribed audio: "${transcribedText}"`);
      
      // Automatically trigger the orchestration loop
      this.emit('input', { type: 'prompt', payload: transcribedText });
    }, 1500);
  }

  /**
   * Internal stub for OpenAI Whisper / Local Whisper instance
   */
  private async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    this.logger.info(`IOLayer: Sending ${audioBuffer.length} bytes to local Whisper transcription module...`);
    return new Promise(resolve => {
      // Simulate transcription latency
      setTimeout(() => resolve("Update the agent orchestration loop to handle multi-agent tasks concurrently."), 1000);
    });
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
