import { injectable, inject } from 'tsyringe';
import { IExecutionAgent, ILogger } from './interfaces';
import { AgentContext } from '../types';

@injectable()
export class ExecutionAgent implements IExecutionAgent {
  constructor(@inject('ILogger') private logger: ILogger) {}

  async generateCodeDiff(context: AgentContext): Promise<string> {
    this.logger.info(`Execution Agent: Generating surgical code diffs (Attempt ${context.compilationFailures + 1})...`);
    if (!context.plan) throw new Error('No plan provided to Execution Agent.');
    
    if (context.verificationLogs) {
      this.logger.info('Execution Agent: Incorporating feedback from verification failures...');
    }

    return `--- a/file.ts\n+++ b/file.ts\n+ console.log('Executing step ${context.compilationFailures + 1}');`;
  }
}
