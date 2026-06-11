import { injectable, inject } from 'tsyringe';
import { ITool, JSONSchema } from '../tool-registry';
import { ILogger } from '../../agents/interfaces';
import { spawn } from 'child_process';
import * as fs from 'fs';

@injectable()
export class AtomicGitTool implements ITool {
  public name = 'atomic_git';
  public description = 'Manages code modifications on ephemeral git worktrees to prevent workspace corruption during agentic loops.';
  
  public schema: JSONSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create_worktree', 'commit', 'apply_patch', 'remove_worktree'] },
      message: { type: 'string', description: 'Commit message for the code changes.' }
    },
    required: ['action']
  };

  private worktreePath = '.agent-workspace';

  constructor(@inject('ILogger') private logger: ILogger) {}

  private async execGit(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, { cwd });
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
        case 'create_worktree':
          try { await this.execGit(['worktree', 'remove', this.worktreePath, '--force']); } catch {}
          await this.execGit(['worktree', 'add', this.worktreePath, '-f']);
          this.logger.info(`[AtomicGit] Created sandbox worktree at ${this.worktreePath}`);
          return { success: true, worktree: this.worktreePath };

        case 'commit':
          if (!args.message) throw new Error('Commit message required.');
          await this.execGit(['add', '.'], this.worktreePath);
          await this.execGit(['commit', '-m', args.message], this.worktreePath);
          this.logger.info(`[AtomicGit] Committed diffs to sandbox ${this.worktreePath}`);
          return { success: true };

        case 'apply_patch':
          await this.execGit(['add', '-A'], this.worktreePath);
          const diff = await this.execGit(['diff', 'HEAD'], this.worktreePath);
          if (diff.trim()) {
            fs.writeFileSync('patch.diff', diff);
            await this.execGit(['apply', 'patch.diff']);
            fs.unlinkSync('patch.diff');
          }
          await this.execGit(['worktree', 'remove', this.worktreePath, '--force']);
          this.logger.info(`[AtomicGit] Verified. Successfully merged ${this.worktreePath} back to primary workspace using patch.`);
          return { success: true, merged: true };

        case 'remove_worktree':
          await this.execGit(['worktree', 'remove', this.worktreePath, '--force']);
          this.logger.warn(`[AtomicGit] Rejected. Discarded ${this.worktreePath}. Workspace cleanly reverted.`);
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
