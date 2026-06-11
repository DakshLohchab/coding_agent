import { injectable, inject } from 'tsyringe';
import { IVerificationAgent, ILogger } from './interfaces';
import { AgentContext } from '../types';

@injectable()
export class VerificationAgent implements IVerificationAgent {
  constructor(@inject('ILogger') private logger: ILogger) {}

  async verify(context: AgentContext): Promise<{ success: boolean; logs: string }> {
    this.logger.info('Verification Agent: Running linters, compilers, and local OS test scripts...');
    
    // Simulate verification failing the first few times to demonstrate the retry and feedback loop
    if (!context.verificationLogs && context.compilationFailures < 3) {
      this.logger.warn(`Verification Agent: Compilation failed.`);
      return { success: false, logs: `Compilation error TS2304: Cannot find name 'x' (Attempt ${context.compilationFailures + 1})` };
    }
    
    this.logger.info('Verification Agent: All checks passed successfully.');
    return { success: true, logs: '0 errors, 0 warnings.' };
  }
}
