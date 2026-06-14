export interface AgentContext {
  prompt: string;
  llmModel: string;
  thoughts: string | null;
  plan: string | null;
  codeDiff: string | null;
  buildLogs: string | null;
  verificationLogs: string | null;
  compilationFailures: number;
  error: Error | null;
  executionHistory: string[];
  historyTokenCount: number;
  lastAgentMessage: string | null;
  totalRetries?: number;
}

export type AgentEvent =
  | { type: 'START'; prompt: string; model?: string }
  | { type: 'PLAN_CREATED'; plan: string }
  | { type: 'CODE_GENERATED'; codeDiff: string }
  | { type: 'VERIFICATION_SUCCESS' }
  | { type: 'VERIFICATION_FAILED'; logs: string }
  | { type: 'FATAL_ERROR'; error: Error }
  | { type: 'PAUSE_FOR_COLLISION' }
  | { type: 'RESUME_FROM_COLLISION'; resolution: string };
