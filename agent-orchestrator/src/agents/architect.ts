import { injectable, inject } from 'tsyringe';
import { IArchitectAgent, ILogger } from './interfaces.js';
import { AgentContext } from '../types.js';
import { RAGService } from '../intelligence/rag-service.js';
import { ToolRegistry } from '../execution/tool-registry.js';
import { ConfigService } from '../services/config.js';
import { EventBroker } from '../services/event-broker.js';
import { MemoryStore } from '../intelligence/memory-store.js';

@injectable()
export class ArchitectAgent implements IArchitectAgent {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(RAGService) private ragService: RAGService,
    @inject(ToolRegistry) private toolRegistry: ToolRegistry,
    @inject(ConfigService) private configService: ConfigService,
    @inject(EventBroker) private eventBroker: EventBroker,
    @inject(MemoryStore) private memoryStore: MemoryStore
  ) {}

  async analyzeAndPlan(context: AgentContext): Promise<string> {
    const config = this.configService.getConfig();
    this.logger.info(`Architect Agent: Analyzing prompt and repository structure using LLM Provider [${config?.provider}]...`);
    
    // RAG Pipeline: Pull deeply coupled dependencies into context
    const ragContext = await this.ragService.retrieveContext(context.prompt);
    
    const SYSTEM_PROMPT = `You are the core intelligence driving OpenClaw (Local CoderCore Agent Orchestrator). You operate as a strict, headless terminal daemon integrated directly into an isolated local OS execution environment.

CRITICAL RULE #1: ZERO CONVERSATIONAL FILLER
- You are forbidden from outputting conversational text, pleasantries, or transitions.
- Never summarize your thoughts for human readability in the raw output stream.
- Any conversational filler breaks the JSON parser and crashes the orchestrator daemon.

CRITICAL RULE #2: STRICT PIPELINE STATE TRANSITIONS
You must process tasks through the four rigid engineering phases defined in your architecture:
1. ARCHITECTING: Analyze the task and output the exact file diff strategies.
2. EXECUTING: Generate raw, precise code modifications and execute native tool chains.
3. VERIFYING: Run local syntax checks, compilation tests, or test suites.
4. DEBATING: If verification fails, cross-examine alternative strategies internally.

OUTPUT FORMAT PROTOCOL
When generating code or files, you MUST use the following XML-like structure:
<file path="relative/path/to/file.ext">
// file contents here
</file>
You may output multiple <file> blocks. Do not use standard markdown code blocks.
If you need to execute a tool, output a single JSON object:
{
  "phase": "architecting" | "executing" | "verifying" | "debating",
  "thought": "Short technical log",
  "tool": "native_shell" | "atomic_git" | "none",
  "arguments": { "cmd": "..." }
}
If no tool execution is required, simply output the <file> blocks.`;

    const relevantMemories = this.memoryStore.search(context.prompt, 5);
    const memoryContext = this.memoryStore.formatForContext(relevantMemories);
    if (memoryContext) {
      this.eventBroker.emitAsync('agent.thought', `Architect: Recalled ${relevantMemories.length} related tasks from memory...`);
    }

    const messages: any[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${memoryContext ? memoryContext + '\n\n' : ''}Prompt: ${context.prompt}\nContext: ${ragContext}` }
    ];

    if (context.verificationLogs) {
      messages.push({ role: 'user', content: `Re-evaluate based on failure logs:\n${context.verificationLogs}` });
    }

    const toolsSchema = this.toolRegistry.getOpenAIToolsSchema();

    let finalPlan = '';
    let isFinished = false;
    let iteration = 0;

      // Autonomous LLM Tool Invocation Loop
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
        this.logger.info(`Architect Agent: LLM requested tool invocation. Pausing generation stream...`);
        
        // Push the assistant's tool call intent onto the context stack
        messages.push({ role: 'assistant', tool_calls: llmResponse.tool_calls });

        for (const toolCall of llmResponse.tool_calls) {
          const { name, arguments: args } = toolCall.function;
          this.logger.info(`Architect Agent: Routing tool '${name}' via ToolRegistry...`);
          
          if (name === 'native_shell') {
            this.eventBroker.emitAsync('agent.thought', `Running command: ${JSON.parse(args).script}`);
          } else {
            this.eventBroker.emitAsync('agent.thought', `Executing tool: ${name}`);
          }
          
          try {
            const parsedArgs = JSON.parse(args);
            const toolOutput = await this.toolRegistry.executeTool(name, parsedArgs);
            
            // Capture the tool's output and append it as a 'tool_result' role
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
        
        // The loop continues, triggering an immediate continuation API call 
        // so the LLM can see the result of its action and continue its plan.
        this.logger.info(`Architect Agent: Tool output captured. Triggering continuation API call...`);
      } else {
        isFinished = true;
        finalPlan = llmResponse.content || '';
      }
    }

    return finalPlan;
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
          ...(tools && tools.length > 0 ? { tools } : {}),
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API error: ${response.statusText} - ${errText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      try {
        const parsed = JSON.parse(content);
        if (parsed.tool && parsed.tool !== 'none') {
           return {
             role: 'assistant',
             content: parsed.thought ? `<introspection>${parsed.thought}</introspection>` : null,
             tool_calls: [{
               id: `call_${Date.now()}`,
               type: 'function',
               function: {
                 name: parsed.tool,
                 arguments: JSON.stringify(parsed.arguments)
               }
             }]
           };
        } else {
           return {
             role: 'assistant',
             content: JSON.stringify(parsed, null, 2)
           };
        }
      } catch (e) {
         return {
           role: 'assistant',
           content: content
         };
      }
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
    
    // Fallback to mock for now if other providers aren't implemented yet
    return this.mockLLMCall(messages, tools, iteration);
  }

  private async mockLLMCall(messages: any[], tools: any[], iteration: number): Promise<any> {
    if (iteration === 1) {
      return {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_arch123',
          type: 'function',
          function: {
            name: 'native_shell',
            arguments: JSON.stringify({ script: 'echo "Scouting OS environment..."' })
          }
        }]
      };
    }
    return {
      role: 'assistant',
      content: `Revised Plan after exploring OS:\n1. Scaffold module\n2. Implement logic`,
    };
  }
}
