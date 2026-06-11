import { setup, assign, fromPromise } from 'xstate';
import { container } from '../di/container';
import { AgentContext, AgentEvent } from '../types';
import { IArchitectAgent, IExecutionAgent, IVerificationAgent, IDebateAgent, ILogger } from '../agents/interfaces';
import { EventBroker } from '../services/event-broker';
import { ContextCompressor } from '../services/context-compressor';
import { execSync } from 'child_process';
import * as fs from 'fs';

// 1. Convert eager resolutions to Lazy Getters to prevent Tsyringe module race conditions
const getArchitect = () => container.resolve<IArchitectAgent>('IArchitectAgent');
const getExecutor = () => container.resolve<IExecutionAgent>('IExecutionAgent');
const getVerifier = () => container.resolve<IVerificationAgent>('IVerificationAgent');
const getDebateAgent = () => container.resolve<IDebateAgent>('IDebateAgent');
const getLogger = () => container.resolve<ILogger>('ILogger');
const getEventBroker = () => container.resolve(EventBroker);
const getCompressor = () => container.resolve(ContextCompressor);

export const orchestratorMachine = setup({
  types: {
    context: {} as AgentContext,
    events: {} as AgentEvent,
  },
  actors: {
    // 2. Resolve them safely inside the async actors
    architectActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await getArchitect().analyzeAndPlan(input);
    }),
    executorActor: fromPromise(async ({ input }: { input: AgentContext }) => {
      return await getExecutor().generateCodeDiff(input);
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
    setupWorktree: () => {
      if (!fs.existsSync('.agent-workspace')) {
        try {
          try { execSync('git worktree remove .agent-workspace --force', { stdio: 'ignore' }); } catch (e) {}
          execSync('git worktree add .agent-workspace -f', { stdio: 'ignore' });
          getLogger().info('Created isolated git worktree at .agent-workspace');
        } catch (e: any) {
          getLogger().error(`Failed to setup worktree: ${e.message}`);
        }
      }
    },
    applyWorktreePatch: () => {
      try {
        execSync('git -C .agent-workspace add -A');
        const diff = execSync('git -C .agent-workspace diff HEAD').toString();
        if (diff.trim()) {
          fs.writeFileSync('patch.diff', diff);
          execSync('git apply patch.diff');
          fs.unlinkSync('patch.diff');
        }
        execSync('git worktree remove .agent-workspace --force', { stdio: 'ignore' });
        getLogger().info('Successfully merged worktree patch and cleaned up.');
      } catch (e: any) {
        getLogger().error(`Failed to merge worktree patch: ${e.message}`);
      }
    },
    removeWorktree: () => {
      try {
        execSync('git worktree remove .agent-workspace --force', { stdio: 'ignore' });
        getLogger().info('Cleaned up failed .agent-workspace worktree.');
      } catch (e) {}
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
      // 4. Also use the getter for the EventBroker in the entry states
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'idle')],
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
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'architecting')],
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
      entry: [
        () => getEventBroker().emitAsync('agent.state_change', 'executing'),
        'setupWorktree'
      ],
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
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'verifying')],
      invoke: {
        src: 'verifierActor',
        input: ({ context }) => context,
        onDone: [
          {
            guard: ({ event }) => (event.output as any).success === true,
            target: 'done',
            actions: [
              'applyWorktreePatch',
              assign({ 
                verificationLogs: ({ event }) => (event.output as any).logs,
                executionHistory: ({ context, event }) => [...context.executionHistory, `[VERIFIER] Success: ${(event.output as any).logs}`]
              }),
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
    debating: {
      entry: [() => getEventBroker().emitAsync('agent.state_change', 'debating')],
      invoke: {
        src: 'debateActor',
        input: ({ context }) => context,
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
      entry: ['logSuccess', () => getEventBroker().emitAsync('agent.state_change', 'done')],
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
