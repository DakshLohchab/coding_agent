import { injectable, inject } from 'tsyringe';
import { spawn } from 'child_process';
import { ITool, JSONSchema } from '../tool-registry';
import { ILogger } from '../../agents/interfaces';

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
    
    // Deep PowerShell automation execution context
    const process = spawn('powershell.exe', [
      '-NoProfile', 
      '-NonInteractive', 
      '-Command', 
      args.script
    ]);

    if (args.background) {
      this.logger.info(`Spawned detached background process with PID: ${process.pid}`);
      process.unref(); // Detach the process from the parent Node event loop
      return { status: 'background', pid: process.pid };
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => stdout += data.toString());
      process.stderr.on('data', (data) => stderr += data.toString());

      process.on('close', (code) => {
        if (code !== 0) {
          this.logger.warn(`NativeShell command failed with code ${code}.`);
          // We resolve instead of reject so the Verification Agent can parse the error logs contextually
          resolve({ success: false, code, stdout, stderr });
        } else {
          this.logger.info(`NativeShell command executed successfully.`);
          resolve({ success: true, code, stdout, stderr });
        }
      });

      process.on('error', (err) => {
        this.logger.error('NativeShell process spawn error', err);
        reject(err);
      });
    });
  }

  /**
   * Specifically handles complex OS automation tasks, like port-killing capabilities.
   * Useful for freeing up blocked localhost ports before starting a dev server.
   */
  public async killPort(port: number): Promise<any> {
    const script = `
      $pidToKill = (Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess
      if ($pidToKill) { Stop-Process -Id $pidToKill -Force; Write-Output "Killed port ${port}" }
      else { Write-Output "Port ${port} is free" }
    `;
    return await this.execute({ script });
  }
}
