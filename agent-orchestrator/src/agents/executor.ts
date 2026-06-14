import { injectable, inject } from 'tsyringe';
import { IExecutionAgent, ILogger } from './interfaces.js';
import { AgentContext } from '../types.js';
import { ASTParser } from '../intelligence/ast-parser.js';
import { ToolRegistry } from '../execution/tool-registry.js';
import { ConfigService } from '../services/config.js';
import { EventBroker } from '../services/event-broker.js';
import { ParallelExecutor } from './parallel-executor.js';
import { MemoryStore } from '../intelligence/memory-store.js';
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
    @inject(EventBroker) private eventBroker: EventBroker,
    @inject(ParallelExecutor) private parallelExecutor: ParallelExecutor,
    @inject(MemoryStore) private memoryStore: MemoryStore
  ) {}

  async generateCodeDiff(context: AgentContext): Promise<string> {
    const config = this.configService.getConfig();
    this.logger.info(`Execution Agent: Generating structured multi-file blocks (Attempt ${context.compilationFailures + 1}) using [${config?.provider}]...`);
    if (!context.plan) throw new Error('No plan provided to Execution Agent.');

    // Retrieve relevant memories to give the LLM prior context
    const relevantMemories = this.memoryStore.search(context.prompt, 5);
    const memoryContext = this.memoryStore.formatForContext(relevantMemories);
    if (memoryContext) {
      this.eventBroker.emitAsync('agent.thought', `Recalled ${relevantMemories.length} relevant past tasks from memory...`);
    }

    const messages: any[] = [
      { role: 'system', content: 'You are the Execution Agent.' },
      { role: 'user', content: `${memoryContext ? memoryContext + '\n\n' : ''}Implement this plan completely. Output all files needed:\n\n${context.plan}\n\nOriginal user request: ${context.prompt}` }
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
    let virtualFiles = this.extractVirtualFiles(rawLLMOutput);
    
    // For complex tasks (many files expected), use parallel execution
    const isComplexTask = context.prompt.length > 100 ||
                          context.prompt.toLowerCase().match(/website|app|project|system|full.?stack/);
    if (isComplexTask && virtualFiles.length === 0) {
      this.logger.info('Executor: Complex task detected. Switching to parallel execution...');
      this.eventBroker.emitAsync('agent.thought', 'Launching parallel subagents for complex task...');
      
      const parallelResults = await this.parallelExecutor.executeParallel(
        context.prompt,
        context.plan || context.prompt,
        10
      );
      
      virtualFiles = parallelResults.flatMap(r => r.files);
    }
    
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
          const targetPath = path.join(process.cwd(), vf.path);
          const dir = path.dirname(targetPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(targetPath, vf.content, 'utf8');
          this.logger.info(`Executor: Wrote file to ${targetPath}`);
          finalOutput += `<file path="${vf.path}">\n${vf.content}\n</file>\n`;
        }
        
        // Store this successful execution in memory for future reference
        const writtenPaths = virtualFiles.map(vf => vf.path);
        this.memoryStore.store({
          type: 'task',
          prompt: context.prompt,
          outcome: `Successfully created ${writtenPaths.length} files: ${writtenPaths.join(', ')}`,
          filesCreated: writtenPaths,
          provider: this.configService.getConfig()?.provider || 'unknown',
          tags: this.extractTags(context.prompt)
        });
        
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
    
    if (config.provider === 'Anthropic Claude') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.modelName || 'claude-sonnet-4-6',
          max_tokens: 8096,
          system: messages.find((m: any) => m.role === 'system')?.content || '',
          messages: messages.filter((m: any) => m.role !== 'system'),
        })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${errText}`);
      }
      const data = await response.json();
      return {
        role: 'assistant',
        content: data.content?.[0]?.text || ''
      };
    }

    if (config.provider === 'Gemini API') {
      const model = config.modelName || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
      const systemMsg = messages.find((m: any) => m.role === 'system')?.content || '';
      const userMessages = messages.filter((m: any) => m.role !== 'system');
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
          contents: userMessages.map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
          })),
          generationConfig: { maxOutputTokens: 8096 }
        })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errText}`);
      }
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { role: 'assistant', content: text };
    }

    if (config.provider === 'OpenAI') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.modelName || 'gpt-4o',
          messages: messages,
        })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
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

  private extractTags(prompt: string): string[] {
    const keywords = [
      'website', 'react', 'python', 'api', 'database', 'game',
      'cli', 'typescript', 'css', 'html', 'node', 'express',
      'vue', 'next', 'vite', 'flask', 'django', 'rust', 'go'
    ];
    const lower = prompt.toLowerCase();
    return keywords.filter(k => lower.includes(k));
  }
}
