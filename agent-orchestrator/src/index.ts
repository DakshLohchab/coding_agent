import 'reflect-metadata';
import { createActor } from 'xstate';
import React from 'react';
import { render } from 'ink';
import { OrchestratorUI } from './ui/ink-app.js';
import { orchestratorMachine } from './orchestrator/machine.js';
import { container } from './di/container.js';
import { ILogger } from './agents/interfaces.js';
import { FileWatcherDaemon } from './intelligence/file-watcher.js';
import { VectorStore } from './intelligence/vector-store.js';
import { EventBroker } from './services/event-broker.js';

const logger = container.resolve<ILogger>('ILogger');
const fileWatcher = container.resolve(FileWatcherDaemon);
const vectorStore = container.resolve(VectorStore);
const eventBroker = container.resolve(EventBroker);

async function bootstrap() {
  // Initialize Intelligence Layer
  await vectorStore.initialize();
  fileWatcher.start(process.cwd() + '/src');
  fileWatcher.start(process.cwd() + '/skills');

  const actor = createActor(orchestratorMachine as any) as any;
  actor.start();

  render(React.createElement(OrchestratorUI, { eventBroker, actor }));
}

bootstrap().catch(err => {
  logger.error('Bootstrap error', err);
});
