import { setup, assign, fromPromise } from 'xstate';
import { container } from '../di/container.js';
import { AgentContext, AgentEvent } from '../types.js';
import { IArchitectAgent, IExecutionAgent, IVerificationAgent, IDebateAgent, ILogger, IThinkingAgent, IPlanningAgent, IBuildingAgent } from '../agents/interfaces.js';
import { EventBroker } from '../services/event-broker.js';
import { ContextCompressor } from '../services/context-compressor.js';
import { execSync } from 'child_process';
import * as fs from 'fs';

import { LlmValidatorService } from '../services/llm-validator.js';

// 1. Convert eager resolutions to Lazy Getters to prevent Tsyringe module race conditions
const getThinking = () => container.resolve<IThinkingAgent>('IThinkingAgent');
const getPlanning = () => container.resolve<IPlanningAgent>('IPlanningAgent');
const getArchitect = () => container.resolve<IArchitectAgent>('IArchitectAgent');
const getExecutor = () => container.resolve<IExecutionAgent>('IExecutionAgent');
const getBuilding = () => container.resolve<IBuildingAgent>('IBuildingAgent');
const getVerifier = () => container.resolve<IVerificationAgent>('IVerificationAgent');
const getDebateAgent = () => container.resolve<IDebateAgent>('IDebateAgent');
const getLogger = () => container.resolve<ILogger>('ILogger');
const getEventBroker = () => container.resolve(EventBroker);
const getCompressor = () => container.resolve(ContextCompressor);
const getValidator = () => container.resolve(LlmValidatorService);

export const orchestratorMachine = setup({
  types: {
    context: {} as AgentContext,
    events: {} as AgentEvent,
  },
  actors: {
    // 2. Resolve them safely inside the async actors
    llmValidatorActor: fromPromise(async () => {
      return await getValidator().validateConnection();
    }),
    thinkingActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await getThinking().think(input);
    }),
    planningActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await getPlanning().plan(input);
    }),
    architectActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await getArchitect().analyzeAndPlan(input);
    }),
    executorActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await getExecutor().generateCodeDiff(input);
    }),
    buildingActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await getBuilding().build(input);
    }),
    verifierActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await getVerifier().verify(input);
    }),
    debateActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await getDebateAgent().debateAndConverge(input);
    })
  },
  actions: {
    // 3. Update all actions to use the lazy getters
    logError: ({ event }) => {
      getLogger().error('State Machine FATAL ERROR', event);
    },
    logSuccess: () => {
      getLogger().info('State Machine completed orchestration successfully.');
    },
    emitAgentMessage: ({ context }) => {
      if (context.lastAgentMessage) {
        getEventBroker().emitAsync('agent.reply', context.lastAgentMessage);
      }
    },
    setupWorktree: () => {
      getLogger().info('Skipping worktree — writing directly to working directory.');
    },
    applyWorktreePatch: () => {
      getLogger().info('Files already written to disk during execution.');
    },
    removeWorktree: () => {
      getLogger().info('No worktree to remove.');
    },
    compressHistoryIfNeeded: assign(({ context }) => {
      const result = getCompressor().compressIfNeeded(context.executionHistory);
      if (result.compressed) {
        getLogger().warn(`Token budget exceeded. ContextCompressor triggered sliding-window eviction.`);
      }
      return {
        executionHistory: result.newHistory,
        historyTokenCount: result.tokenCount
      };
    })
  }
}).createMachine({
  id: 'orchestrator',
  initial: 'idle',
  context: {
    prompt: '',
    llmModel: 'openrouter',
    thoughts: null,
    plan: null,
    codeDiff: null,
    buildLogs: null,
    verificationLogs: null,
    compilationFailures: 0,
    error: null,
    executionHistory: [],
    historyTokenCount: 0,
    lastAgentMessage: null,
    totalRetries: 0
  },
  states: {
    idle: {
      // 4. Also use the getter for the EventBroker in the entry states
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'idle')],
      on: {
        START: {
          target: 'validating_llm',
          actions: [
            assign({
              prompt: ({ event }) => (event as Extract<AgentEvent, { type: 'START' }>).prompt,
              llmModel: ({ event }) => (event as Extract<AgentEvent, { type: 'START' }>).model ?? 'openrouter',
              compilationFailures: 0,
              executionHistory: ['[SYSTEM] Agent orchestration started.'],
              lastAgentMessage: ({ event }) => `Agent started with model ${(event as Extract<AgentEvent, { type: 'START' }>).model ?? 'openrouter'}.`, 
              historyTokenCount: Math.ceil('[SYSTEM] Agent orchestration started.'.length / 4)
            }),
            'emitAgentMessage'
          ]
        }
      }
    },
    validating_llm: {
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'validating_llm')],
      invoke: {
        src: 'llmValidatorActor',
        onDone: {
          target: 'thinking',
          actions: [
            assign({
              executionHistory: ({ context }) => [...context.executionHistory, '[SYSTEM] LLM connection verified successfully.'],
              lastAgentMessage: () => 'LLM configuration verified. Proceeding with task.'
            }),
            'emitAgentMessage',
            'compressHistoryIfNeeded'
          ]
        },
        onError: {
          target: 'failed',
          actions: [
            assign({ error: ({ event }) => event.error as Error }),
            () => getEventBroker().emitAsync('agent.reply', 'FATAL ERROR: Could not connect to LLM provider. Please check your config using the wizard.')
          ]
        }
      }
    },
    thinking: {
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'thinking')],
      invoke: {
        src: 'thinkingActor',
        input: ({ context }: any) => context,
        onDone: {
          target: 'planning',
          actions: [
            assign({ thoughts: ({ event }) => event.output as string }),
            'compressHistoryIfNeeded'
          ]
        },
        onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error as Error }) }
      }
    },
    planning: {
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'planning')],
      invoke: {
        src: 'planningActor',
        input: ({ context }: any) => context,
        onDone: {
          target: 'architecting',
          actions: [
            assign({ plan: ({ event }) => event.output as string }),
            'compressHistoryIfNeeded'
          ]
        },
        onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error as Error }) }
      }
    },
    architecting: {
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'architecting')],
      invoke: {
        src: 'architectActor',
        input: ({ context }: any) => context,
        onDone: {
          target: 'executing',
          actions: [
            assign({ 
              plan: ({ event }) => event.output as string,
              executionHistory: ({ context }) => [...context.executionHistory, '[ARCHITECT] Plan created and AST parsed.'],
              lastAgentMessage: () => 'Architect completed the plan and prepared execution steps.'
            }),
            'emitAgentMessage',
            'compressHistoryIfNeeded'
          ]
        },
        onError: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error as Error })
        }
      }
    },
    executing: {
      entry: [
        () => getEventBroker().emitAsync('agent.state_change', 'executing'),
        'setupWorktree'
      ],
      invoke: {
        src: 'executorActor',
        input: ({ context }: any) => context,
        onDone: {
          target: 'building',
          actions: [
            assign({ 
              codeDiff: ({ event }) => event.output as string,
              executionHistory: ({ context }) => [...context.executionHistory, '[EXECUTOR] Code diffs generated via NativeShell/AtomicGit.'],
              lastAgentMessage: () => 'Execution finished generating code diffs; moving to build step.'
            }),
            'emitAgentMessage',
            'compressHistoryIfNeeded'
          ]
        },
        onError: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error as Error })
        }
      }
    },
    building: {
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'building')],
      invoke: {
        src: 'buildingActor',
        input: ({ context }: any) => context,
        onDone: [
          {
            guard: ({ event }) => (event.output as any).success === true,
            target: 'verifying',
            actions: [
              assign({ 
                buildLogs: ({ event }: any) => (event.output as any).logs,
                executionHistory: ({ context, event }: any) => [...context.executionHistory, `[BUILDER] Success: ${(event.output as any).logs}`]
              }),
              'compressHistoryIfNeeded'
            ]
          },
          {
            target: 'debating',
            actions: [
              assign({
                buildLogs: ({ event }: any) => (event.output as any).logs,
                executionHistory: ({ context, event }: any) => [...context.executionHistory, `[BUILDER] Failure: ${(event.output as any).logs}`]
              }),
              'compressHistoryIfNeeded'
            ]
          }
        ],
        onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error as Error }) }
      }
    },
    verifying: {
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'verifying')],
      invoke: {
        src: 'verifierActor',
        input: ({ context }: any) => context,
        onDone: [
          {
            guard: ({ event }) => (event.output as any).success === true,
            target: 'done',
            actions: [
              'applyWorktreePatch',
              assign({ 
                verificationLogs: ({ event }: any) => (event.output as any).logs,
                executionHistory: ({ context, event }: any) => [...context.executionHistory, `[VERIFIER] Success: ${(event.output as any).logs}`],
                lastAgentMessage: ({ event }: any) => `Verification succeeded: ${(event.output as any).logs}`
              }),
              'emitAgentMessage',
              'compressHistoryIfNeeded'
            ]
          },
          {
            guard: ({ context }) => context.compilationFailures >= 2,
            target: 'debating',
            actions: [
              'removeWorktree',
              assign({
                verificationLogs: ({ event }) => (event.output as any).logs,
                compilationFailures: 0, 
                executionHistory: ({ context, event }) => [
                  ...context.executionHistory, 
                  `[VERIFIER] Critical Error (Attempt 3). Triggering Multi-Agent Debate.\nLogs: ${(event.output as any).logs}`
                ]
              }),
              'compressHistoryIfNeeded'
            ]
          },
          {
            target: 'executing',
            actions: [
              assign({
                verificationLogs: ({ event }) => (event.output as any).logs,
                compilationFailures: ({ context }) => context.compilationFailures + 1,
                totalRetries: ({ context }) => (context.totalRetries || 0) + 1,
                executionHistory: ({ context, event }) => [
                  ...context.executionHistory, 
                  `[VERIFIER] Verification Failed. Routing back to Executor. Logs: ${(event.output as any).logs}`
                ],
                lastAgentMessage: ({ event }) => 'Verification failed. Re-running execution with a revised strategy.'
              }),
              'emitAgentMessage',
              'compressHistoryIfNeeded'
            ]
          }
        ],
        onError: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error as Error })
        }
      }
    },
    debating: {
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'debating')],
      invoke: {
        src: 'debateActor',
        input: ({ context }: any) => context,
        onDone: {
          target: 'executing',
          actions: [
            assign({
              plan: ({ event }) => event.output as string,
              executionHistory: ({ context }) => [...context.executionHistory, '[DEBATE] Multi-Agent consensus reached. Plan revised.']
            }),
            'compressHistoryIfNeeded'
          ]
        },
        onError: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error as Error })
        }
      }
    },
    done: {
      entry: [
        'logSuccess',
        ({ context }) => {
          const filesModified = context.codeDiff ? (context.codeDiff.match(/<file path=/g) || []).length : 0;
          const retriesResolved = context.totalRetries || 0;
          const commandsExecuted = 2 + retriesResolved;
          
          getEventBroker().emitAsync('agent.summary', {
            filesModified,
            commandsExecuted,
            retriesResolved
          });
        },
        () => getEventBroker().emitAsync('agent.state_change', 'done'),
        () => getEventBroker().emitAsync('agent.reply', 'Orchestration finished successfully. The agent has completed the task.')
      ],
      type: 'final'
    },
    failed: {
      entry: ['logError', () => getEventBroker().emitAsync('agent.state_change', 'failed')],
      type: 'final'
    },
    paused: {
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'paused')],
      on: {
        RESUME_FROM_COLLISION: {
          target: 'architecting',
          actions: [
            assign({
              prompt: ({ event, context }) => context.prompt + `\n\n[USER RESOLUTION]: ${(event as any).resolution}`,
              executionHistory: ({ context }) => [...context.executionHistory, '[SYSTEM] IDE Collision resolved. Resuming.']
            }),
            'compressHistoryIfNeeded'
          ]
        }
      }
    }
  },
  on: {
    PAUSE_FOR_COLLISION: {
      target: '.paused'
    }
  }
});
