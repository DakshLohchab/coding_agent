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
      if (parsed.nodes.length > 0) {
        await this.vectorStore.upsertGraphNodes(parsed.nodes);
      }
    } catch (err) {
      this.logger.error(`Indexer failed to parse and upsert graph for file: ${filePath}`, err);
    }
  }
}
