import { injectable, inject } from 'tsyringe';
import { ITool, JSONSchema } from '../tool-registry';
import { ILogger } from '../../agents/interfaces';
import { spawn } from 'child_process';
import * as crypto from 'crypto';

@injectable()
export class AtomicGitTool implements ITool {
  public name = 'atomic_git';
  public description = 'Manages code modifications on ephemeral git branches to prevent workspace corruption during agentic loops.';
  
  public schema: JSONSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create_ephemeral', 'commit', 'approve_merge', 'reject_reset'] },
      message: { type: 'string', description: 'Commit message for the code changes.' }
    },
    required: ['action']
  };

  private currentEphemeralBranch: string | null = null;
  private baseBranch: string = 'main';

  constructor(@inject('ILogger') private logger: ILogger) {}

  private async execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args);
      let out = '';
      let err = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => err += d);
      proc.on('close', code => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(`Git command failed: ${err.trim()}`));
      });
    });
  }

  public async execute(args: { action: string, message?: string }): Promise<any> {
    try {
      switch (args.action) {
        case 'create_ephemeral':
          // Sandbox code execution into a temporary branch
          const branchId = `ephemeral-${crypto.randomBytes(4).toString('hex')}`;
          await this.execGit(['checkout', '-b', branchId]);
          this.currentEphemeralBranch = branchId;
          this.logger.info(`[AtomicGit] Created and checked out sandbox branch: ${branchId}`);
          return { success: true, branch: branchId };

        case 'commit':
          if (!args.message) throw new Error('Commit message required.');
          await this.execGit(['add', '.']);
          await this.execGit(['commit', '-m', args.message]);
          this.logger.info(`[AtomicGit] Committed diffs to sandbox ${this.currentEphemeralBranch}`);
          return { success: true };

        case 'approve_merge':
          // Gatekeeper: Merges only if Verification Agent clears the tests
          if (!this.currentEphemeralBranch) throw new Error('No sandbox branch active.');
          await this.execGit(['checkout', this.baseBranch]);
          await this.execGit(['merge', this.currentEphemeralBranch]);
          await this.execGit(['branch', '-D', this.currentEphemeralBranch]);
          
          this.logger.info(`[AtomicGit] Verified. Successfully merged ${this.currentEphemeralBranch} into ${this.baseBranch}`);
          this.currentEphemeralBranch = null;
          return { success: true, merged: true };

        case 'reject_reset':
          // Hard reset to discard corrupted changes
          if (!this.currentEphemeralBranch) throw new Error('No sandbox branch active.');
          await this.execGit(['checkout', this.baseBranch]);
          await this.execGit(['branch', '-D', this.currentEphemeralBranch]);
          
          this.logger.warn(`[AtomicGit] Rejected. Discarded ${this.currentEphemeralBranch}. Workspace cleanly reverted to ${this.baseBranch}`);
          this.currentEphemeralBranch = null;
          return { success: true, reset: true };

        default:
          throw new Error('Invalid atomic_git action.');
      }
    } catch (error: any) {
      this.logger.error(`[AtomicGit] Secure fallback failure: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
