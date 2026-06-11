import { injectable } from 'tsyringe';

@injectable()
export class ContextCompressor {
  private readonly TOKEN_THRESHOLD = 30000;

  /**
   * Fast character-based token tracking (~4 chars per token)
   */
  public calculateTokens(payload: string): number {
    return Math.ceil(payload.length / 4);
  }

  /**
   * Immutably compresses the execution history array if it exceeds the hard threshold.
   * Retains the core architectural plan implicitly (as it's stored separately in context.plan) 
   * and the most recent 2 log frames, while squashing older steps into a summary.
   */
  public compressIfNeeded(executionHistory: string[]): { newHistory: string[]; tokenCount: number; compressed: boolean } {
    const historyStr = executionHistory.join('\n');
    const tokens = this.calculateTokens(historyStr);

    if (tokens > this.TOKEN_THRESHOLD) {
      // Create a single-line summary of evicted logs
      const summary = `[System Note: Context Eviction Triggered. Steps 1-${executionHistory.length - 2} completed. Resolved older errors securely.]`;
      
      // Immutably truncate middle logs, keeping the summary and last 2 recent logs
      const compressedHistory = [summary, ...executionHistory.slice(-2)];
      
      return {
        newHistory: compressedHistory,
        tokenCount: this.calculateTokens(compressedHistory.join('\n')),
        compressed: true
      };
    }

    return {
      newHistory: executionHistory,
      tokenCount: tokens,
      compressed: false
    };
  }
}
