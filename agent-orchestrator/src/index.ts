import 'reflect-metadata';
import { createActor } from 'xstate';
import { orchestratorMachine } from './orchestrator/machine.js';
import { container } from './di/container.js';
import { ILogger } from './agents/interfaces.js';
import { FileWatcherDaemon } from './intelligence/file-watcher.js';
import { VectorStore } from './intelligence/vector-store.js';

const logger = container.resolve<ILogger>('ILogger');
const fileWatcher = container.resolve(FileWatcherDaemon);
const vectorStore = container.resolve(VectorStore);

async function bootstrap() {
  logger.info('Bootstrapping Autonomous Agent Orchestrator...');

  // Initialize Intelligence Layer
  await vectorStore.initialize();
  fileWatcher.start(process.cwd() + '/src');

  const actor = createActor(orchestratorMachine as any) as any;

  actor.subscribe((state) => {
    logger.info(`[State Transition] Current State: ${state.value}`);
  });

  actor.start();

  logger.info('Dispatching START event...');
  actor.send({ type: 'START', prompt: 'Implement a production-ready HTTP API endpoint.' });
}

bootstrap().catch(err => {
  logger.error('Bootstrap error', err);
});
