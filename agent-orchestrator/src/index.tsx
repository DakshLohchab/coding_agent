import 'reflect-metadata';
import React from 'react';
import { render } from 'ink';
import { createActor } from 'xstate';
import { orchestratorMachine } from './orchestrator/machine';
import { container } from './di/container';
import { ILogger } from './agents/interfaces';
import { FileWatcherDaemon } from './intelligence/file-watcher';
import { VectorStore } from './intelligence/vector-store';
import { IOLayer } from './daemon/io-layer';
import { CollisionDetector } from './daemon/collision-detector';
import { OrchestratorUI } from './ui/ink-app';

const logger = container.resolve<ILogger>('ILogger');
const fileWatcher = container.resolve(FileWatcherDaemon);
const vectorStore = container.resolve(VectorStore);
const ioLayer = container.resolve(IOLayer);
const collisionDetector = container.resolve(CollisionDetector);

async function bootstrap() {
  // Initialize Intelligence & Daemon Layers
  await vectorStore.initialize();
  fileWatcher.start(process.cwd() + '/src');
  
  ioLayer.initialize(8080);
  collisionDetector.start(process.cwd() + '/src');

  const actor = createActor(orchestratorMachine);

  // Render the Ink React UI
  render(React.createElement(OrchestratorUI, { ioLayer, collisionDetector, actor }));

  actor.start();
  
  // Seed an initial prompt via CLI arguments or default
  setTimeout(() => {
    actor.send({ type: 'START', prompt: 'Implement a persistent daemon agent.' });
  }, 1000);
}

bootstrap().catch(err => {
  logger.error('Bootstrap error', err);
});
