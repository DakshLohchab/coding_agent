import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import { ITool, JSONSchema } from '../tool-registry.js';
import { ILogger } from '../../agents/interfaces.js';

@injectable()
export class PatchFileTool implements ITool {
  public name = 'patch_file';
  public description = 'Replaces a specific string of text in a file with new text.';
  
  public schema: JSONSchema = {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'The absolute or relative path to the file to patch.' },
      searchString: { type: 'string', description: 'The exact string of text to find and replace.' },
      replaceString: { type: 'string', description: 'The string of text to insert in place of the searchString.' }
    },
    required: ['filePath', 'searchString', 'replaceString']
  };

  constructor(@inject('ILogger') private logger: ILogger) {}

  public async execute(args: { filePath: string, searchString: string, replaceString: string }): Promise<any> {
    this.logger.info(`PatchFileTool executing for path: ${args.filePath}`);
    try {
      const worktreePath = path.join(process.cwd(), '.agent-workspace');
      const baseDir = fs.existsSync(worktreePath) ? worktreePath : process.cwd();
      const targetPath = path.resolve(baseDir, args.filePath);
      
      if (!fs.existsSync(targetPath)) {
        return { success: false, error: `File not found: ${args.filePath}` };
      }

      const content = fs.readFileSync(targetPath, 'utf8');
      
      if (!content.includes(args.searchString)) {
         return { success: false, error: `The exact search string was not found in ${args.filePath}.` };
      }

      const newContent = content.replace(args.searchString, args.replaceString);
      fs.writeFileSync(targetPath, newContent, 'utf8');
      
      this.logger.info(`PatchFileTool successfully patched ${targetPath}`);
      return { success: true, message: `Successfully patched ${args.filePath}` };
    } catch (err) {
      this.logger.error('PatchFileTool failed', err);
      return { success: false, error: (err as Error).message };
    }
  }
}
