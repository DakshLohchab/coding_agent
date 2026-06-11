import 'reflect-metadata';
import { createActor } from 'xstate';
import { orchestratorMachine } from './orchestrator/machine';
import { container } from './di/container';
import { ILogger } from './agents/interfaces';
import { FileWatcherDaemon } from './intelligence/file-watcher';
import { VectorStore } from './intelligence/vector-store';

const logger = container.resolve<ILogger>('ILogger');
const fileWatcher = container.resolve(FileWatcherDaemon);
const vectorStore = container.resolve(VectorStore);

async function bootstrap() {
  logger.info('Bootstrapping Autonomous Agent Orchestrator...');

  // Initialize Intelligence Layer
  await vectorStore.initialize();
  fileWatcher.start(process.cwd() + '/src');

  const actor = createActor(orchestratorMachine);

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
