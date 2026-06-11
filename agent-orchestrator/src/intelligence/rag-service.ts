import { injectable, inject } from 'tsyringe';
import { VectorStore } from './vector-store';
import { ILogger } from '../agents/interfaces';

@injectable()
export class RAGService {
  constructor(
    @inject(VectorStore) private vectorStore: VectorStore,
    @inject('ILogger') private logger: ILogger
  ) {}

  public async retrieveContext(prompt: string): Promise<string> {
    this.logger.info(`RAG Service: Querying vector store for deeply coupled dependencies...`);
    
    // RAG Pipeline: Search local ChromaDB instance based on semantic proximity to prompt.
    const results = await this.vectorStore.search(prompt, 5);
    
    if (!results || results.length === 0) {
      return "No deeply coupled context found in the local vector base.";
    }

    let contextData = "=== REPOSITORY INTELLIGENCE CONTEXT ===\n\n";
    for (const res of results) {
      contextData += `[File: ${res.metadata.filePath}] | [Symbol: ${res.metadata.type} ${res.metadata.name}]\n`;
      contextData += `${res.text}\n\n`;
    }
    contextData += "=======================================";

    return contextData;
  }
}
