import { injectable, inject } from 'tsyringe';
import { NativeShellTool } from './tools/native-shell.js';
import { AtomicGitTool } from './tools/atomic-git.js';
import { FileWriterTool } from './tools/file-writer.js';
import { DirectoryCreatorTool } from './tools/directory-creator.js';
import { FileReaderTool } from './tools/file-reader.js';
import { PatchFileTool } from './tools/patch-file.js';

export interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
}

export interface ITool {
  name: string;
  description: string;
  schema: JSONSchema;
  execute(args: any): Promise<any>;
}

@injectable()
export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();

  constructor(
    @inject(NativeShellTool) nativeShell: NativeShellTool,
    @inject(AtomicGitTool) atomicGit: AtomicGitTool,
    @inject(FileWriterTool) fileWriter: FileWriterTool,
    @inject(DirectoryCreatorTool) dirCreator: DirectoryCreatorTool,
    @inject(FileReaderTool) fileReader: FileReaderTool,
    @inject(PatchFileTool) patchFile: PatchFileTool
  ) {
    this.registerTool(nativeShell);
    this.registerTool(atomicGit);
    this.registerTool(fileWriter);
    this.registerTool(dirCreator);
    this.registerTool(fileReader);
    this.registerTool(patchFile);
  }

  public registerTool(tool: ITool): void {
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  public getOpenAIToolsSchema(): any[] {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema
      }
    }));
  }

  public async executeTool(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found in registry.`);
    return await tool.execute(args);
  }
}
