import { injectable, inject } from 'tsyringe';
import { ASTParser } from './ast-parser';
import { VectorStore } from './vector-store';
import { ILogger } from '../agents/interfaces';

@injectable()
export class Indexer {
  constructor(
    @inject(ASTParser) private astParser: ASTParser,
    @inject(VectorStore) private vectorStore: VectorStore,
    @inject('ILogger') private logger: ILogger
  ) {}

  public async indexFile(filePath: string): Promise<void> {
    try {
      const parsed = this.astParser.parseFile(filePath);
      
      const chunks = parsed.nodes.map((node, index) => ({
        id: `${filePath}_${node.type}_${index}`,
        text: node.code,
        metadata: {
          filePath,
          type: node.type,
          name: node.name,
          startLine: node.startLine,
          endLine: node.endLine
        }
      }));

      if (chunks.length > 0) {
        await this.vectorStore.upsertChunks(chunks);
      }
    } catch (err) {
      this.logger.error(`Indexer failed to parse and upsert file: ${filePath}`, err);
    }
  }
}
