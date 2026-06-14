import { injectable, inject } from 'tsyringe';
import { ILogger } from '../agents/interfaces.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface MemoryEntry {
  id: string;
  timestamp: string;
  type: 'task' | 'code' | 'error' | 'pattern' | 'preference';
  prompt: string;
  outcome: string;
  filesCreated: string[];
  provider: string;
  tags: string[];
  embedding?: number[];  // future: real embeddings
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

@injectable()
export class MemoryStore {
  private memoryPath: string;
  private memories: MemoryEntry[] = [];
  private maxMemories = 10000;

  constructor(@inject('ILogger') private logger: ILogger) {
    this.memoryPath = path.join(os.homedir(), '.ca2026-memory.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.memoryPath)) {
        const data = fs.readFileSync(this.memoryPath, 'utf8');
        this.memories = JSON.parse(data);
        this.logger.info(`MemoryStore: Loaded ${this.memories.length} memories from ${this.memoryPath}`);
      }
    } catch (e) {
      this.logger.warn('MemoryStore: Could not load memories, starting fresh.');
      this.memories = [];
    }
  }

  private save(): void {
    try {
      // Keep only the most recent maxMemories entries
      if (this.memories.length > this.maxMemories) {
        this.memories = this.memories.slice(-this.maxMemories);
      }
      fs.writeFileSync(this.memoryPath, JSON.stringify(this.memories, null, 2), 'utf8');
    } catch (e) {
      this.logger.warn('MemoryStore: Failed to save memories.');
    }
  }

  store(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): void {
    const memory: MemoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    };
    this.memories.push(memory);
    this.save();
    this.logger.info(`MemoryStore: Stored memory [${memory.type}] "${memory.prompt.slice(0, 60)}..."`);
  }

  /**
   * TF-IDF style keyword search across all memories.
   * Returns top N most relevant memories for the given query.
   */
  search(query: string, topN: number = 5): MemorySearchResult[] {
    if (this.memories.length === 0) return [];
    
    const queryTokens = this.tokenize(query);
    const scored = this.memories.map(entry => {
      const entryText = `${entry.prompt} ${entry.outcome} ${entry.tags.join(' ')}`;
      const entryTokens = this.tokenize(entryText);
      
      // Simple TF score: how many query tokens appear in the entry
      let matches = 0;
      for (const qt of queryTokens) {
        if (entryTokens.includes(qt)) matches++;
      }
      
      // Recency boost: more recent memories score higher
      const ageMs = Date.now() - new Date(entry.timestamp).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recencyBoost = Math.max(0, 1 - ageDays / 30); // decays over 30 days
      
      // Success boost: successful tasks score higher
      const successBoost = entry.outcome.includes('success') || entry.outcome.includes('created') ? 0.2 : 0;
      
      const score = (matches / Math.max(queryTokens.length, 1)) + (recencyBoost * 0.3) + successBoost;
      
      return { entry, score };
    });
    
    return scored
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  /**
   * Format memories into context string for LLM injection.
   */
  formatForContext(results: MemorySearchResult[]): string {
    if (results.length === 0) return '';
    let context = '<agent_memory>\n';
    context += '// Previous related tasks/context:\n';
    
    for (const { entry, score } of results) {
      context += `// [${entry.type.toUpperCase()}] ${new Date(entry.timestamp).toLocaleDateString()} (relevance: ${(score * 100).toFixed(0)}%)\n`;
      context += `// Task: ${entry.prompt.slice(0, 150)}\n`;
      context += `// Outcome: ${entry.outcome.slice(0, 200)}\n`;
      if (entry.filesCreated.length > 0) {
        context += `// Files created: ${entry.filesCreated.join(', ')}\n`;
      }
      context += '\n';
    }
    
    context += '</agent_memory>';
    return context;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);  // skip tiny words
  }

  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const m of this.memories) {
      byType[m.type] = (byType[m.type] || 0) + 1;
    }
    return { total: this.memories.length, byType };
  }

  clear(): void {
    this.memories = [];
    this.save();
  }
}
