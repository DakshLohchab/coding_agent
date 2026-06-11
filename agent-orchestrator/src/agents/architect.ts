import { injectable, inject } from 'tsyringe';
import { IArchitectAgent, ILogger } from './interfaces';
import { AgentContext } from '../types';
import { RAGService } from '../intelligence/rag-service';
import { ToolRegistry } from '../execution/tool-registry';
import { ConfigService } from '../services/config';
import { EventBroker } from '../services/event-broker';

@injectable()
export class ArchitectAgent implements IArchitectAgent {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(RAGService) private ragService: RAGService,
    @inject(ToolRegistry) private toolRegistry: ToolRegistry,
    @inject(ConfigService) private configService: ConfigService,
    @inject(EventBroker) private eventBroker: EventBroker
  ) {}

  async analyzeAndPlan(context: AgentContext): Promise<string> {
    const config = this.configService.getConfig();
    this.logger.info(`Architect Agent: Analyzing prompt and repository structure using LLM Provider [${config?.provider}]...`);
    
    // RAG Pipeline: Pull deeply coupled dependencies into context
    const ragContext = await this.ragService.retrieveContext(context.prompt);
    
    const messages = [
      { role: 'system', content: 'You are the Architect Agent.' },
      { role: 'user', content: `Prompt: ${context.prompt}\nContext: ${ragContext}` }
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
      
      // Inject OpenAI/Anthropic 'tools' JSON schema payload into the request
      const llmResponse = await this.mockLLMCall(messages, toolsSchema, iteration);

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
              role: 'tool_result', 
              tool_call_id: toolCall.id, 
              name: name,
              content: JSON.stringify(toolOutput)
            });
          } catch (err: any) {
            messages.push({ 
              role: 'tool_result', 
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
