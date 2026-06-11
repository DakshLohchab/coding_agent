import 'reflect-metadata';
import { container } from 'tsyringe';

import { Logger } from '../services/logger';
import { ArchitectAgent } from '../agents/architect';
import { ExecutionAgent } from '../agents/executor';
import { VerificationAgent } from '../agents/verifier';

import { ASTParser } from '../intelligence/ast-parser';
import { VectorStore } from '../intelligence/vector-store';
import { Indexer } from '../intelligence/indexer';
import { RAGService } from '../intelligence/rag-service';
import { FileWatcherDaemon } from '../intelligence/file-watcher';

import { ToolRegistry } from '../execution/tool-registry';
import { NativeShellTool } from '../execution/tools/native-shell';
import { AtomicGitTool } from '../execution/tools/atomic-git';

import { IOLayer } from '../daemon/io-layer';
import { CollisionDetector } from '../daemon/collision-detector';
import { EventBroker } from '../services/event-broker';

// Core Services
container.registerSingleton('ILogger', Logger);
container.registerSingleton(EventBroker);

// Daemon Layer
container.registerSingleton(IOLayer);
container.registerSingleton(CollisionDetector);

// Execution Layer
container.registerSingleton(ToolRegistry);
container.registerSingleton(NativeShellTool);
container.registerSingleton(AtomicGitTool);

// Intelligence Layer
container.registerSingleton(ASTParser);
container.registerSingleton(VectorStore);
container.registerSingleton(Indexer);
container.registerSingleton(RAGService);
container.registerSingleton(FileWatcherDaemon);

// Agents
container.register('IArchitectAgent', { useClass: ArchitectAgent });
container.register('IExecutionAgent', { useClass: ExecutionAgent });
container.register('IVerificationAgent', { useClass: VerificationAgent });

export { container };
