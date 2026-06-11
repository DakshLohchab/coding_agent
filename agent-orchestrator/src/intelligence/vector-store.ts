import { injectable, inject } from 'tsyringe';
import { ChromaClient, Collection } from 'chromadb';
import { ILogger } from '../agents/interfaces';

@injectable()
export class VectorStore {
  private client: ChromaClient;
  private collection: Collection | null = null;

  constructor(@inject('ILogger') private logger: ILogger) {
    // Connects to a local ChromaDB instance by default (http://localhost:8000)
    this.client = new ChromaClient(); 
  }

  public async initialize(): Promise<void> {
    try {
      this.collection = await this.client.getOrCreateCollection({ name: 'code_intelligence' });
      this.logger.info('VectorStore connected to ChromaDB successfully.');
    } catch (error) {
      this.logger.warn('Failed to connect to local ChromaDB server. Ensure it is running. Fallback to mock retrieval is active.');
    }
  }

  public async upsertChunks(chunks: { id: string, text: string, metadata: any }[]): Promise<void> {
    if (!this.collection) return; // Silent fallback if Chroma is offline
    
    try {
      await this.collection.upsert({
        ids: chunks.map(c => c.id),
        documents: chunks.map(c => c.text),
        metadatas: chunks.map(c => c.metadata),
      });
      this.logger.info(`Upserted ${chunks.length} semantic chunks to vector store.`);
    } catch (error) {
      this.logger.error('Failed to upsert chunks to ChromaDB', error);
    }
  }

  public async search(query: string, nResults: number = 5): Promise<any[]> {
    if (!this.collection) {
      this.logger.warn('VectorStore not connected. Returning empty context.');
      return [];
    }
    
    try {
      const results = await this.collection.query({
        queryTexts: [query],
        nResults,
      });
      
      if (!results.documents[0]) return [];

      return results.documents[0].map((doc, idx) => ({
        text: doc,
        metadata: results.metadatas[0][idx],
        distance: results.distances?.[0]?.[idx]
      }));
    } catch (error) {
      this.logger.error('Error querying vector store', error);
      return [];
    }
  }
}
