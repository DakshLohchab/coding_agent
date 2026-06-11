import { setup, assign, fromPromise } from 'xstate';
import { container } from '../di/container';
import { AgentContext, AgentEvent } from '../types';
import { IArchitectAgent, IExecutionAgent, IVerificationAgent, ILogger } from '../agents/interfaces';

// Resolve dependencies from DI
const architect = container.resolve<IArchitectAgent>('IArchitectAgent');
const executor = container.resolve<IExecutionAgent>('IExecutionAgent');
const verifier = container.resolve<IVerificationAgent>('IVerificationAgent');
const logger = container.resolve<ILogger>('ILogger');

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
    }
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
    error: null
  },
  states: {
    idle: {
      on: {
        START: {
          target: 'architecting',
          actions: assign({
            prompt: ({ event }) => (event as Extract<AgentEvent, { type: 'START' }>).prompt,
            compilationFailures: 0
          })
        }
      }
    },
    architecting: {
      invoke: {
        src: 'architectActor',
        input: ({ context }) => context,
        onDone: {
          target: 'executing',
          actions: assign({ plan: ({ event }) => event.output as string })
        },
        onError: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error as Error })
        }
      }
    },
    executing: {
      invoke: {
        src: 'executorActor',
        input: ({ context }) => context,
        onDone: {
          target: 'verifying',
          actions: assign({ codeDiff: ({ event }) => event.output as string })
        },
        onError: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error as Error })
        }
      }
    },
    verifying: {
      invoke: {
        src: 'verifierActor',
        input: ({ context }) => context,
        onDone: [
          {
            guard: ({ event }) => (event.output as any).success === true,
            target: 'done',
            actions: assign({ verificationLogs: ({ event }) => (event.output as any).logs })
          },
          {
            // If the Execution Agent fails to compile code 3 times, route back to Architect Agent
            guard: ({ context }) => context.compilationFailures >= 2,
            target: 'architecting',
            actions: assign({
              verificationLogs: ({ event }) => (event.output as any).logs,
              compilationFailures: 0 // Reset failures for complete re-evaluation
            })
          },
          {
            // Retry execution loop (1st and 2nd failure)
            target: 'executing',
            actions: assign({
              verificationLogs: ({ event }) => (event.output as any).logs,
              compilationFailures: ({ context }) => context.compilationFailures + 1
            })
          }
        ],
        onError: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error as Error })
        }
      }
    },
    done: {
      entry: ['logSuccess'],
      type: 'final'
    },
    failed: {
      entry: ['logError'],
      type: 'final'
    },
    paused: {
      on: {
        RESUME_FROM_COLLISION: {
          target: 'architecting',
          actions: assign({
            prompt: ({ event, context }) => context.prompt + `\n\n[USER RESOLUTION]: ${(event as any).resolution}`
          })
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
