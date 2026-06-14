import { AgentContext } from '../types.js';

export interface IArchitectAgent {
  analyzeAndPlan(context: AgentContext): Promise<string>;
}

export interface IThinkingAgent {
  think(context: AgentContext): Promise<string>;
}

export interface IPlanningAgent {
  plan(context: AgentContext): Promise<string>;
}

export interface IBuildingAgent {
  build(context: AgentContext): Promise<{ success: boolean; logs: string }>;
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
  info(message: string, ...meta: any[]): void;
  warn(message: string, ...meta: any[]): void;
  error(message: string, ...meta: any[]): void;
  debug(message: string, ...meta: any[]): void;
}

export interface IEventBroker {
  emit(event: string, payload?: any): void;
  on(event: string, callback: (payload: any) => void): void;
}

export interface IToolRegistry {
  executeTool(name: string, args: Record<string, any>): Promise<any>;
  getToolSchemas(): any[];
}
