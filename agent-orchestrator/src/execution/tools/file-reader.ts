import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import { ITool, JSONSchema } from '../tool-registry.js';
import { ILogger } from '../../agents/interfaces.js';

@injectable()
export class FileReaderTool implements ITool {
  public name = 'read_file';
  public description = 'Reads the content of a file.';
  
  public schema: JSONSchema = {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'The absolute or relative path to the file to read.' }
    },
    required: ['filePath']
  };

  constructor(@inject('ILogger') private logger: ILogger) {}

  public async execute(args: { filePath: string }): Promise<any> {
    this.logger.info(`FileReaderTool executing for path: ${args.filePath}`);
    try {
      const worktreePath = path.join(process.cwd(), '.agent-workspace');
      const baseDir = fs.existsSync(worktreePath) ? worktreePath : process.cwd();
      const targetPath = path.resolve(baseDir, args.filePath);
      
      if (fs.existsSync(targetPath)) {
        const content = fs.readFileSync(targetPath, 'utf8');
        this.logger.info(`FileReaderTool successfully read ${targetPath}`);
        return { success: true, content };
      } else {
        return { success: false, error: `File not found: ${args.filePath}` };
      }
    } catch (err) {
      this.logger.error('FileReaderTool failed', err);
      return { success: false, error: (err as Error).message };
    }
  }
}
