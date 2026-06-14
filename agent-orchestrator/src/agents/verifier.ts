import { injectable, inject } from 'tsyringe';
import { IVerificationAgent, ILogger } from './interfaces.js';
import { AgentContext } from '../types.js';
import { NativeShellTool } from '../execution/tools/native-shell.js';
import * as fs from 'fs';
import * as path from 'path';
import { EventBroker } from '../services/event-broker.js';

@injectable()
export class VerificationAgent implements IVerificationAgent {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(NativeShellTool) private nativeShell: NativeShellTool,
    @inject(EventBroker) private eventBroker: EventBroker
  ) {}

  async verify(context: AgentContext): Promise<{ success: boolean; logs: string }> {
    this.logger.info('Verification Agent: Checking what files were created...');
    // If there's a codeDiff, parse it for the file list and verify they exist on disk
    if (context.codeDiff) {
      const filePathRegex = /<file path="([^"]+)">/g;
      const createdFiles: string[] = [];
      let match;
      while ((match = filePathRegex.exec(context.codeDiff)) !== null) {
        createdFiles.push(match[1]);
      }
      if (createdFiles.length > 0) {
        const missing: string[] = [];
        for (const filePath of createdFiles) {
          const fullPath = path.join(process.cwd(), filePath);
          if (!fs.existsSync(fullPath)) {
            missing.push(filePath);
          }
        }
        if (missing.length === 0) {
          const summary = `Created ${createdFiles.length} file(s): ${createdFiles.join(', ')}`;
          this.logger.info(`Verification Agent: ${summary}`);
          this.eventBroker.emitAsync('agent.reply', `✅ Task complete! ${summary}`);
          return { success: true, logs: summary };
        } else {
          return {
            success: false,
            logs: `Missing files on disk: ${missing.join(', ')}. Files may not have been written correctly.`
          };
        }
      }
      // If codeDiff has no <file> blocks but has content, treat as success
      if (context.codeDiff.trim().length > 0) {
        this.eventBroker.emitAsync('agent.reply', context.codeDiff);
        return { success: true, logs: 'Agent completed task (no file output).' };
      }
    }
    return { success: true, logs: 'Verification skipped — no output to check.' };
  }
}
