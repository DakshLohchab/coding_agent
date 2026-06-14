import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import { ITool, JSONSchema } from '../tool-registry.js';
import { ILogger } from '../../agents/interfaces.js';

@injectable()
export class FileWriterTool implements ITool {
  public name = 'write_file';
  public description = 'Writes unescaped string data directly to a file path. Overwrites the file if it exists, creates it if it does not. Automatically creates parent directories if needed.';
  
  public schema: JSONSchema = {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'The absolute or relative path to the file to write.' },
      content: { type: 'string', description: 'The unescaped string content to write to the file.' }
    },
    required: ['filePath', 'content']
  };

  constructor(@inject('ILogger') private logger: ILogger) {}

  public async execute(args: { filePath: string, content: string }): Promise<any> {
    this.logger.info(`FileWriterTool executing for path: ${args.filePath}`);
    try {
      const worktreePath = path.join(process.cwd(), '.agent-workspace');
      const baseDir = fs.existsSync(worktreePath) ? worktreePath : process.cwd();
      const targetPath = path.resolve(baseDir, args.filePath);
      
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(targetPath, args.content, 'utf8');
      this.logger.info(`FileWriterTool successfully wrote to ${targetPath}`);
      return { success: true, message: `Successfully wrote to ${args.filePath}` };
    } catch (err) {
      this.logger.error('FileWriterTool failed', err);
      return { success: false, error: (err as Error).message };
    }
  }
}
