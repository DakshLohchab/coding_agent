import 'reflect-metadata';
import { container } from 'tsyringe';

import { Logger } from '../services/logger.js';
import { ArchitectAgent } from '../agents/architect.js';
import { ExecutionAgent } from '../agents/executor.js';
import { VerificationAgent } from '../agents/verifier.js';
import { DebateAgent } from '../agents/debate.js';

import { ASTParser } from '../intelligence/ast-parser.js';
import { VectorStore } from '../intelligence/vector-store.js';
import { Indexer } from '../intelligence/indexer.js';
import { RAGService } from '../intelligence/rag-service.js';
import { FileWatcherDaemon } from '../intelligence/file-watcher.js';

import { ToolRegistry } from '../execution/tool-registry.js';
import { NativeShellTool } from '../execution/tools/native-shell.js';
import { AtomicGitTool } from '../execution/tools/atomic-git.js';

import { IOLayer } from '../daemon/io-layer.js';
import { CollisionDetector } from '../daemon/collision-detector.js';
import { EventBroker } from '../services/event-broker.js';
import { ContextCompressor } from '../services/context-compressor.js';
import { ConfigService } from '../services/config.js';

// Core Services
container.registerSingleton('ILogger', Logger);
container.registerSingleton(EventBroker);
container.registerSingleton(ContextCompressor);
container.registerSingleton(ConfigService);

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
container.register('IDebateAgent', { useClass: DebateAgent });

export { container };
