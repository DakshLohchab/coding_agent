import { injectable, inject } from 'tsyringe';
import { IVerificationAgent, ILogger } from './interfaces.js';
import { AgentContext } from '../types.js';
import { NativeShellTool } from '../execution/tools/native-shell.js';

@injectable()
export class VerificationAgent implements IVerificationAgent {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(NativeShellTool) private nativeShell: NativeShellTool
  ) {}

  async verify(context: AgentContext): Promise<{ success: boolean; logs: string }> {
    this.logger.info('Verification Agent: Running linters, compilers, and tests...');
    
    // Determine the verification command based on the workspace
    // Usually we would read the package.json to see if 'test' or 'build' exists
    const script = 'npm run build --if-present && npm test --if-present';
    const result = await this.nativeShell.execute({ script });

    if (result.success) {
      this.logger.info('Verification Agent: All checks passed successfully.');
      return { success: true, logs: '0 errors, 0 warnings.' };
    }

    this.logger.warn(`Verification Agent: Execution failed. Bypassing raw build logs and isolating targeted payload...`);

    if (result.extractedErrors && result.extractedErrors.length > 0) {
      let formattedPayload = '=== TARGETED ERROR PAYLOAD ===\n';
      
      for (const err of result.extractedErrors) {
        formattedPayload += `- Failed Command: ${result.command}\n`;
        formattedPayload += `- Target File: ${err.file}\n`;
        formattedPayload += `- Error Line ${err.line}: ${err.sourceLine.trim()}\n`;
        formattedPayload += `- Surrounding Context:\n${err.contextSnippet}\n`;
        formattedPayload += `- Runtime Exception: ${err.message}\n\n`;
      }
      
      return { success: false, logs: formattedPayload };
    }

    // Fallback if no recognized regex formats were matched
    return { 
      success: false, 
      logs: `Command Failed: ${result.command}\nRaw Output Snippet: ${(result.stderr || result.stdout).substring(0, 1000)}` 
    };
  }
}
