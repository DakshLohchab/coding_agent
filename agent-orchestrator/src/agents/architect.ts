import { injectable, inject } from 'tsyringe';
import { IArchitectAgent, ILogger } from './interfaces';
import { AgentContext } from '../types';
import { RAGService } from '../intelligence/rag-service';

@injectable()
export class ArchitectAgent implements IArchitectAgent {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(RAGService) private ragService: RAGService
  ) {}

  async analyzeAndPlan(context: AgentContext): Promise<string> {
    this.logger.info('Architect Agent: Analyzing prompt and repository structure...');
    
    // RAG Pipeline: Pull deeply coupled dependencies into context
    const ragContext = await this.ragService.retrieveContext(context.prompt);
    
    if (context.verificationLogs) {
      this.logger.warn(`Architect Agent: Re-evaluating based on failure logs:\n${context.verificationLogs}`);
      return `Revised Plan for: ${context.prompt}\nContext:\n${ragContext}\n(Fixing previous errors)`;
    }

    return `Initial Plan for: ${context.prompt}\nContext:\n${ragContext}\n1. Scaffold module\n2. Implement logic\n3. Write tests`;
  }
}
