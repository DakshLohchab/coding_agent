import { injectable, inject } from 'tsyringe';
import { VectorStore } from './vector-store.js';
import { ILogger } from '../agents/interfaces.js';

@injectable()
export class RAGService {
  constructor(
    @inject(VectorStore) private vectorStore: VectorStore,
    @inject('ILogger') private logger: ILogger
  ) {}

  public async retrieveContext(prompt: string): Promise<string> {
    this.logger.info(`RAG Service: Querying vector store for Graph-Aware semantic dependencies...`);
    
    const results = await this.vectorStore.searchSemantic(prompt, 5);
    
    if (!results || results.length === 0) {
      return "<code_graph>\nNo deeply coupled context found in the local vector base.\n</code_graph>";
    }

    let graphOutput = "<code_graph>\n";
    const addedClasses = new Set<string>();

    for (const res of results) {
      const nodeId = res.id;
      const node = this.vectorStore.getNode(nodeId);
      
      if (node) {
        graphOutput += `// === Semantic Node Retrieved: [${node.type}] ${node.name} ===\n`;
        
        // Relationship 1: [RequiresImports]
        if (node.fileImports && node.fileImports.length > 0) {
          graphOutput += `// Inherited File Imports:\n${node.fileImports.join('\n')}\n\n`;
        }
        
        // Relationship 2: [BelongsToClass]
        if (node.parentClass && !addedClasses.has(node.parentClass)) {
          const parentNode = this.vectorStore.getClassOrInterface(node.parentClass);
          if (parentNode) {
            graphOutput += `// Structurally Enclosed By [Class/Interface]:\n${parentNode.code}\n\n`;
            addedClasses.add(node.parentClass);
          } else {
            graphOutput += `// Belongs to Class: ${node.parentClass} (Definition not loaded)\n\n`;
          }
        }
        
        // Root Node Context
        graphOutput += `// Implementation Chunk:\n${node.code}\n\n`;
      } else {
        // Fallback if node not found in memory graph (e.g. restarts)
        graphOutput += `// === Semantic Chunk: ${res.metadata.name} ===\n${res.text}\n\n`;
      }
    }
    
    graphOutput += "</code_graph>";

    return graphOutput;
  }
}
