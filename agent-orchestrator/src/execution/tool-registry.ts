import { injectable } from 'tsyringe';

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

  public registerTool(tool: ITool): void {
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  public getToolSchemas(): any[] {
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
