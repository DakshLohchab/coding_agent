import { AgentContext } from '../types';

export interface IArchitectAgent {
  analyzeAndPlan(context: AgentContext): Promise<string>;
}

export interface IDebateAgent {
  debateAndConverge(context: AgentContext): Promise<string>;
}

export interface IExecutionAgent {
  generateCodeDiff(context: AgentContext): Promise<string>;
}

export interface IVerificationAgent {
  verify(context: AgentContext): Promise<{ success: boolean; logs: string }>;
}

export interface ILogger {
  info(message: string): void;
  error(message: string, err?: any): void;
  warn(message: string): void;
}
