import { injectable, inject } from 'tsyringe';
import { ChromaClient, Collection } from 'chromadb';
import { ILogger } from '../agents/interfaces';
import { ASTNodeData } from './ast-parser';

@injectable()
export class VectorStore {
  private client: ChromaClient;
  private collection: Collection | null = null;
  
  // Graph-aware AST map: Node ID -> AST Node
  private astGraphMap: Map<string, ASTNodeData> = new Map();
  // Reverse lookup: ClassName/InterfaceName -> AST Node
  private classMap: Map<string, ASTNodeData> = new Map();

  constructor(@inject('ILogger') private logger: ILogger) {
    this.client = new ChromaClient(); 
  }

  public async initialize(): Promise<void> {
    try {
      this.collection = await this.client.getOrCreateCollection({ name: 'code_intelligence_graph' });
      this.logger.info('VectorStore connected to Graph-Aware ChromaDB successfully.');
    } catch (error) {
      this.logger.warn('Failed to connect to local ChromaDB server. Fallback to in-memory graph active.');
    }
  }

  public async upsertGraphNodes(nodes: ASTNodeData[]): Promise<void> {
    const chunks = nodes.map(node => ({
      id: node.id,
      text: node.code,
      metadata: {
        type: node.type,
        name: node.name,
        parentClass: node.parentClass || '',
        fileImports: JSON.stringify(node.fileImports || [])
      }
    }));

    // Update the in-memory strict graph map
    for (const node of nodes) {
      this.astGraphMap.set(node.id, node);
      if (node.type === 'class' || node.type === 'interface') {
        this.classMap.set(node.name, node);
      }
    }

    if (!this.collection) return;
    
    try {
      await this.collection.upsert({
        ids: chunks.map(c => c.id),
        documents: chunks.map(c => c.text),
        metadatas: chunks.map(c => c.metadata),
      });
      this.logger.info(`Upserted ${chunks.length} graph-aware chunks to vector store.`);
    } catch (error) {
      this.logger.error('Failed to upsert chunks to ChromaDB', error);
    }
  }

  public async searchSemantic(query: string, nResults: number = 5): Promise<any[]> {
    if (!this.collection) {
      this.logger.warn('VectorStore not connected. Returning empty context.');
      return [];
    }
    
    try {
      const results = await this.collection.query({ queryTexts: [query], nResults });
      if (!results.documents[0]) return [];

      return results.documents[0].map((doc, idx) => ({
        id: results.ids[0][idx],
        text: doc,
        metadata: results.metadatas[0][idx],
        distance: results.distances?.[0]?.[idx]
      }));
    } catch (error) {
      this.logger.error('Error querying vector store', error);
      return [];
    }
  }

  public getNode(id: string): ASTNodeData | undefined {
    return this.astGraphMap.get(id);
  }

  public getClassOrInterface(name: string): ASTNodeData | undefined {
    return this.classMap.get(name);
  }
}
