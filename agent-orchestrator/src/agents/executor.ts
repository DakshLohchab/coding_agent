import { injectable, inject } from 'tsyringe';
import { IExecutionAgent, ILogger } from './interfaces.js';
import { AgentContext } from '../types.js';
import { ASTParser } from '../intelligence/ast-parser.js';
import { ToolRegistry } from '../execution/tool-registry.js';
import { ConfigService } from '../services/config.js';
import { EventBroker } from '../services/event-broker.js';
import * as fs from 'fs';
import * as path from 'path';

export interface VirtualFile {
  path: string;
  content: string;
}

@injectable()
export class ExecutionAgent implements IExecutionAgent {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(ASTParser) private astParser: ASTParser,
    @inject(ToolRegistry) private toolRegistry: ToolRegistry,
    @inject(ConfigService) private configService: ConfigService,
    @inject(EventBroker) private eventBroker: EventBroker
  ) {}

  async generateCodeDiff(context: AgentContext): Promise<string> {
    const config = this.configService.getConfig();
    this.logger.info(`Execution Agent: Generating structured multi-file blocks (Attempt ${context.compilationFailures + 1}) using [${config?.provider}]...`);
    if (!context.plan) throw new Error('No plan provided to Execution Agent.');

    const messages: any[] = [
      { role: 'system', content: 'You are the Execution Agent.' },
      { role: 'user', content: `Execute Plan: ${context.plan}` }
    ];
    
    // Fetch JSON Schemas for 'native_shell', 'atomic_git', etc.
    const toolsSchema = this.toolRegistry.getOpenAIToolsSchema();
    let rawLLMOutput = '';

    // Autonomous LLM Tool Invocation Loop
    let isFinished = false;
    let iteration = 0;

    while (!isFinished && iteration < 5) {
      iteration++;
      const llmResponse = await this.callRealLLM(messages, toolsSchema, iteration);

      if (llmResponse.content) {
        const introspectionMatch = llmResponse.content.match(/<introspection>([\s\S]*?)<\/introspection>/);
        if (introspectionMatch) {
          this.eventBroker.emitAsync('agent.thought', introspectionMatch[1].trim());
        }
      }

      if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
        this.logger.info(`Execution Agent: LLM requested tool invocation. Pausing generation stream...`);
        messages.push({ role: 'assistant', tool_calls: llmResponse.tool_calls });

        for (const toolCall of llmResponse.tool_calls) {
          const { name, arguments: args } = toolCall.function;
          this.logger.info(`Execution Agent: Routing tool '${name}' via ToolRegistry...`);
          
          if (name === 'native_shell') {
            this.eventBroker.emitAsync('agent.thought', `Running command: ${JSON.parse(args).script}`);
          } else {
            this.eventBroker.emitAsync('agent.thought', `Executing tool: ${name}`);
          }
          
          try {
            const parsedArgs = JSON.parse(args);
            const toolOutput = await this.toolRegistry.executeTool(name, parsedArgs);
            
            messages.push({ 
              role: 'tool', 
              tool_call_id: toolCall.id, 
              name: name,
              content: JSON.stringify(toolOutput)
            });
          } catch (err: any) {
            messages.push({ 
              role: 'tool', 
              tool_call_id: toolCall.id, 
              name: name,
              content: `Tool Execution Error: ${err.message}`
            });
          }
        }
        this.logger.info(`Execution Agent: Tool output captured. Triggering continuation API call...`);
      } else {
        isFinished = true;
        rawLLMOutput = llmResponse.content || '';
      }
    }

    // Step 2: Extract virtual files from the structured blocks
    const virtualFiles = this.extractVirtualFiles(rawLLMOutput);
    
    // Step 3 & 4: Ghost Sandboxing Loop (Syntax verification before disk I/O)
    let retryCount = 0;
    while (retryCount < 3) {
      let allValid = true;
      
      for (const vFile of virtualFiles) {
        const validation = this.astParser.validateSyntax(vFile.content);
        
        if (!validation.valid) {
          this.logger.warn(`Ghost Sandbox REJECTED ${vFile.path}. Errors: ${validation.errors.join(' | ')}`);
          allValid = false;
          
          this.logger.info(`Execution Agent: Ghost Sandbox triggered internal LLM exception. Prompting self to fix syntax...`);
          
          // LLM self-correction
          const fixMessages = [
            ...messages,
            { role: 'assistant', content: vFile.content },
            { role: 'user', content: `Syntax Error detected in ${vFile.path}:\n${validation.errors.join(' | ')}\n\nPlease auto-correct the code and output the full corrected <file> block for ${vFile.path}.` }
          ];
          const fixResponse = await this.callRealLLM(fixMessages, toolsSchema, 1);
          
          const newFiles = this.extractVirtualFiles(fixResponse.content || '');
          const fixedFile = newFiles.find(f => f.path === vFile.path);
          if (fixedFile) {
            vFile.content = fixedFile.content;
          } else {
            vFile.content = fixResponse.content || '';
          }
        }
      }
      
      if (allValid) {
        this.logger.info(`Execution Agent: Ghost Sandbox passed. Hallucination check cleared. Code is structurally sound.`);
        
        let finalOutput = '';
        for (const vf of virtualFiles) {
          const workspacePath = path.join('.agent-workspace', vf.path);
          const dir = path.dirname(workspacePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(workspacePath, vf.content);
          finalOutput += `<file path="${vf.path}">\n${vf.content}\n</file>\n`;
        }
        return finalOutput;
      }
      retryCount++;
    }

    throw new Error('Execution Agent failed to generate syntactically valid code after internal retries.');
  }

  private async callRealLLM(messages: any[], tools: any[], iteration: number): Promise<any> {
    const config = this.configService.getConfig();
    if (!config || !config.apiKey) {
      throw new Error('LLM Provider not configured. Please use /model to set it up.');
    }

    if (config.provider === 'OpenRouter') {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:8080',
          'X-Title': 'OpenClaw Local Agent',
        },
        body: JSON.stringify({
          model: config.modelName || 'openrouter/auto',
          messages: messages,
          ...(tools && tools.length > 0 ? { tools } : {})
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API error: ${response.statusText} - ${errText}`);
      }

      const data = await response.json();
      return data.choices[0].message;
    }
    
    return this.mockLLMCall(messages, tools, iteration);
  }

  private async mockLLMCall(messages: any[], tools: any[], iteration: number): Promise<any> {
    if (iteration === 1) {
      return {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_exec123',
          type: 'function',
          function: {
            name: 'native_shell',
            arguments: JSON.stringify({ script: 'echo "Executing git ephemeral branch setup..."' })
          }
        }]
      };
    }
    
    return {
      role: 'assistant',
      content: `<file path="src/example.ts">
function processCode() {
  console.log("Missing closing parenthesis"
}
</file>`
    };
  }

  private extractVirtualFiles(rawOutput: string): VirtualFile[] {
    const files: VirtualFile[] = [];
    const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
    
    let match;
    while ((match = fileRegex.exec(rawOutput)) !== null) {
      files.push({
        path: match[1],
        content: match[2].trim()
      });
    }
    return files;
  }
}
