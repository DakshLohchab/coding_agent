import { injectable, inject } from 'tsyringe';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ITool, JSONSchema } from '../tool-registry';
import { ILogger } from '../../agents/interfaces';

export interface ExtractedError {
  file: string;
  line: number;
  column: number;
  message: string;
  contextSnippet: string;
  sourceLine: string;
}

@injectable()
export class NativeShellTool implements ITool {
  public name = 'native_shell';
  public description = 'Executes a native PowerShell command or script asynchronously. Streams stdout and stderr to the Verification Agent context.';
  
  public schema: JSONSchema = {
    type: 'object',
    properties: {
      script: { type: 'string', description: 'The PowerShell script or command to execute.' },
      background: { type: 'boolean', description: 'If true, runs the process in the background and returns a PID instead of waiting.' }
    },
    required: ['script']
  };

  constructor(@inject('ILogger') private logger: ILogger) {}

  public async execute(args: { script: string, background?: boolean }): Promise<any> {
    this.logger.info(`NativeShell executing command via PowerShell...`);
    
    const worktreePath = path.join(process.cwd(), '.agent-workspace');
    const cwd = fs.existsSync(worktreePath) ? worktreePath : process.cwd();

    let proc: any;
    try {
      proc = spawn('powershell.exe', [
        '-NoProfile', 
        '-NonInteractive', 
        '-Command', 
        args.script
      ], { cwd });
    } catch (spawnErr) {
      this.logger.error('NativeShell failed to spawn process', spawnErr);
      return { success: false, error: spawnErr.message };
    }

    if (args.background) {
      try {
        this.logger.info(`Spawned detached background process with PID: ${proc.pid}`);
        proc.unref(); 
        return { status: 'background', pid: proc.pid };
      } catch (e) {
        this.logger.warn('Failed to detach background process', e);
        return { success: false, error: e.message };
      }
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      if (proc.stdout) proc.stdout.on('data', (data) => stdout += data.toString());
      if (proc.stderr) proc.stderr.on('data', (data) => stderr += data.toString());

      proc.on('close', (code) => {
        if (code !== 0) {
          this.logger.warn(`NativeShell command failed with code ${code}. Extracting stack traces...`);
          const extractedErrors = this.extractStackTraces(stderr || stdout);
          resolve({ success: false, code, stdout, stderr, extractedErrors, command: args.script });
        } else {
          this.logger.info(`NativeShell command executed successfully.`);
          resolve({ success: true, code, stdout, stderr, command: args.script });
        }
      });

      proc.on('error', (err) => {
        this.logger.error('NativeShell process spawn error', err);
        // Resolve with structured failure instead of rejecting to avoid crashing orchestrator actors
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * Deterministic regex parser that detects standard compiler and test runtime error formats
   * Fetches the exact line of code that threw the error, along with 5 lines of context above and below it.
   */
  private extractStackTraces(logOutput: string): ExtractedError[] {
    const errors: ExtractedError[] = [];
    
    // Matches "file.ts:line:column - error message" OR "at function (file:line:col)"
    const regex = /(?:([a-zA-Z0-9_\-\\\/\.]+):(\d+):(\d+)(.*))|(?:at .* \(([a-zA-Z0-9_\-\\\/\.]+):(\d+):(\d+)\))/g;
    
    let match;
    while ((match = regex.exec(logOutput)) !== null) {
      const file = match[1] || match[5];
      const line = parseInt(match[2] || match[6], 10);
      const column = parseInt(match[3] || match[7], 10);
      const message = (match[4] || '').trim();

      try {
        const absolutePath = path.resolve(process.cwd(), file);
        if (fs.existsSync(absolutePath)) {
          const content = fs.readFileSync(absolutePath, 'utf8').split('\n');
          const zeroLine = line - 1;
          
          // Grab exact line + 5 lines above and below
          const startLine = Math.max(0, zeroLine - 5);
          const endLine = Math.min(content.length - 1, zeroLine + 5);
          
          const snippet = content.slice(startLine, endLine + 1)
            .map((l, idx) => `${startLine + idx + 1}: ${l}`)
            .join('\n');
          
          errors.push({
            file: absolutePath,
            line,
            column,
            message: message || "Runtime Exception",
            sourceLine: content[zeroLine] || "",
            contextSnippet: snippet
          });
        }
      } catch (e) {
        // Safe fail if file unreadable, just skip context
      }
    }
    
    return errors;
  }

  public async killPort(port: number): Promise<any> {
    const script = `
      $pidToKill = (Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess
      if ($pidToKill) { Stop-Process -Id $pidToKill -Force; Write-Output "Killed port ${port}" }
      else { Write-Output "Port ${port} is free" }
    `;
    return await this.execute({ script });
  }
}
