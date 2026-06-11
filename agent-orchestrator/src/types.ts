export interface AgentContext {
  prompt: string;
  plan: string | null;
  codeDiff: string | null;
  verificationLogs: string | null;
  compilationFailures: number;
  error: Error | null;
}

export type AgentEvent =
  | { type: 'START'; prompt: string }
  | { type: 'PLAN_CREATED'; plan: string }
  | { type: 'CODE_GENERATED'; codeDiff: string }
  | { type: 'VERIFICATION_SUCCESS' }
  | { type: 'VERIFICATION_FAILED'; logs: string }
  | { type: 'FATAL_ERROR'; error: Error };
