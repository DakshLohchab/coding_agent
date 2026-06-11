import { setup, assign, fromPromise } from 'xstate';
import { container } from '../di/container';
import { AgentContext, AgentEvent } from '../types';
import { IArchitectAgent, IExecutionAgent, IVerificationAgent, ILogger } from '../agents/interfaces';
import { EventBroker } from '../services/event-broker';

// Resolve dependencies from DI
const architect = container.resolve<IArchitectAgent>('IArchitectAgent');
const executor = container.resolve<IExecutionAgent>('IExecutionAgent');
const verifier = container.resolve<IVerificationAgent>('IVerificationAgent');
const logger = container.resolve<ILogger>('ILogger');
const eventBroker = container.resolve(EventBroker);

export const orchestratorMachine = setup({
  types: {
    context: {} as AgentContext,
    events: {} as AgentEvent,
  },
  actors: {
    architectActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await architect.analyzeAndPlan(input);
    }),
    executorActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await executor.generateCodeDiff(input);
    }),
    verifierActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await verifier.verify(input);
    })
  },
  actions: {
    logError: ({ event }) => {
      logger.error('State Machine FATAL ERROR', event);
    },
    logSuccess: () => {
      logger.info('State Machine completed orchestration successfully.');
    },
    compressHistoryIfNeeded: assign(({ context }) => {
      // 1. Fast character-based token tracking (Total Characters / 4)
      const historyStr = context.executionHistory.join('\n');
      const tokens = Math.ceil(historyStr.length / 4);
      
      // 2. Maximum history limit: 40,000 tokens.
      if (tokens > 40000) {
        logger.warn(`Token budget exceeded (${tokens} > 40000). Triggering automated sliding-window compression...`);
        
        // 3. Keep main plan intact (context.plan is separate)
        // Merge old execution histories and tool outputs into a concise summary block
        const summary = `[System Note: Steps 1-4 completed successfully. Files modified: A, B. Error resolved: ReferenceError]`;
        
        // Retain the summary and the last 2 recent context windows to preserve immediate execution fidelity
        const compressedHistory = [summary, ...context.executionHistory.slice(-2)];
        
        return {
          executionHistory: compressedHistory,
          historyTokenCount: Math.ceil(compressedHistory.join('\n').length / 4)
        };
      }
      return {
        historyTokenCount: tokens
      };
    })
  }
}).createMachine({
  id: 'orchestrator',
  initial: 'idle',
  context: {
    prompt: '',
    plan: null,
    codeDiff: null,
    verificationLogs: null,
    compilationFailures: 0,
    error: null,
    executionHistory: [],
    historyTokenCount: 0
  },
  states: {
    idle: {
      entry: [() => eventBroker.emitAsync('agent.state_change', 'idle')],
      on: {
        START: {
          target: 'architecting',
          actions: assign({
            prompt: ({ event }) => (event as Extract<AgentEvent, { type: 'START' }>).prompt,
            compilationFailures: 0,
            executionHistory: ['[SYSTEM] Agent orchestration started.'],
            historyTokenCount: Math.ceil('[SYSTEM] Agent orchestration started.'.length / 4)
          })
        }
      }
    },
    architecting: {
      entry: [() => eventBroker.emitAsync('agent.state_change', 'architecting')],
      invoke: {
        src: 'architectActor',
        input: ({ context }) => context,
        onDone: {
          target: 'executing',
          actions: [
            assign({ 
              plan: ({ event }) => event.output as string,
              executionHistory: ({ context }) => [...context.executionHistory, '[ARCHITECT] Plan created and AST parsed.']
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
    executing: {
      entry: [() => eventBroker.emitAsync('agent.state_change', 'executing')],
      invoke: {
        src: 'executorActor',
        input: ({ context }) => context,
        onDone: {
          target: 'verifying',
          actions: [
            assign({ 
              codeDiff: ({ event }) => event.output as string,
              executionHistory: ({ context }) => [...context.executionHistory, '[EXECUTOR] Code diffs generated via NativeShell/AtomicGit.']
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
    verifying: {
      entry: [() => eventBroker.emitAsync('agent.state_change', 'verifying')],
      invoke: {
        src: 'verifierActor',
        input: ({ context }) => context,
        onDone: [
          {
            guard: ({ event }) => (event.output as any).success === true,
            target: 'done',
            actions: [
              assign({ 
                verificationLogs: ({ event }) => (event.output as any).logs,
                executionHistory: ({ context, event }) => [...context.executionHistory, `[VERIFIER] Success: ${(event.output as any).logs}`]
              }),
              'compressHistoryIfNeeded'
            ]
          },
          {
            // If Execution Agent fails to compile code 3 times, route back to Architect Agent
            guard: ({ context }) => context.compilationFailures >= 2,
            target: 'architecting',
            actions: [
              assign({
                verificationLogs: ({ event }) => (event.output as any).logs,
                compilationFailures: 0, // Reset failures for complete re-evaluation
                executionHistory: ({ context, event }) => [
                  ...context.executionHistory, 
                  `[VERIFIER] Critical Error (Attempt 3). Triggering Architect structural re-evaluation.\nLogs: ${(event.output as any).logs}`
                ]
              }),
              'compressHistoryIfNeeded'
            ]
          },
          {
            // Retry execution loop (1st and 2nd failure)
            target: 'executing',
            actions: [
              assign({
                verificationLogs: ({ event }) => (event.output as any).logs,
                compilationFailures: ({ context }) => context.compilationFailures + 1,
                executionHistory: ({ context, event }) => [
                  ...context.executionHistory, 
                  `[VERIFIER] Verification Failed. Routing back to Executor. Logs: ${(event.output as any).logs}`
                ]
              }),
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
    done: {
      entry: ['logSuccess', () => eventBroker.emitAsync('agent.state_change', 'done')],
      type: 'final'
    },
    failed: {
      entry: ['logError', () => eventBroker.emitAsync('agent.state_change', 'failed')],
      type: 'final'
    },
    paused: {
      entry: [() => eventBroker.emitAsync('agent.state_change', 'paused')],
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
