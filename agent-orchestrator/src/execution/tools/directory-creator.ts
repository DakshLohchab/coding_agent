import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import { ITool, JSONSchema } from '../tool-registry.js';
import { ILogger } from '../../agents/interfaces.js';

@injectable()
export class DirectoryCreatorTool implements ITool {
  public name = 'make_directory';
  public description = 'Creates a directory and any necessary parent directories.';
  
  public schema: JSONSchema = {
    type: 'object',
    properties: {
      dirPath: { type: 'string', description: 'The absolute or relative path to the directory to create.' }
    },
    required: ['dirPath']
  };

  constructor(@inject('ILogger') private logger: ILogger) {}

  public async execute(args: { dirPath: string }): Promise<any> {
    this.logger.info(`DirectoryCreatorTool executing for path: ${args.dirPath}`);
    try {
      const worktreePath = path.join(process.cwd(), '.agent-workspace');
      const baseDir = fs.existsSync(worktreePath) ? worktreePath : process.cwd();
      const targetPath = path.resolve(baseDir, args.dirPath);
      
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
        this.logger.info(`DirectoryCreatorTool successfully created ${targetPath}`);
        return { success: true, message: `Successfully created directory ${args.dirPath}` };
      } else {
        return { success: true, message: `Directory ${args.dirPath} already exists` };
      }
    } catch (err) {
      this.logger.error('DirectoryCreatorTool failed', err);
      return { success: false, error: (err as Error).message };
    }
  }
}
