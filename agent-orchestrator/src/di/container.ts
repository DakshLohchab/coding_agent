import 'reflect-metadata';
import { container } from 'tsyringe';

import { Logger } from '../services/logger.js';
import { ArchitectAgent } from '../agents/architect.js';
import { ThinkingAgent } from '../agents/thinking.js';
import { PlanningAgent } from '../agents/planning.js';
import { BuildingAgent } from '../agents/building.js';
import { ExecutionAgent } from '../agents/executor.js';
import { VerificationAgent } from '../agents/verifier.js';
import { DebateAgent } from '../agents/debate.js';
import { ParallelExecutor } from '../agents/parallel-executor.js';

import { ASTParser } from '../intelligence/ast-parser.js';
import { VectorStore } from '../intelligence/vector-store.js';
import { Indexer } from '../intelligence/indexer.js';
import { RAGService } from '../intelligence/rag-service.js';
import { FileWatcherDaemon } from '../intelligence/file-watcher.js';
import { MemoryStore } from '../intelligence/memory-store.js';

import { ToolRegistry } from '../execution/tool-registry.js';
import { NativeShellTool } from '../execution/tools/native-shell.js';
import { AtomicGitTool } from '../execution/tools/atomic-git.js';
import { FileWriterTool } from '../execution/tools/file-writer.js';
import { DirectoryCreatorTool } from '../execution/tools/directory-creator.js';
import { FileReaderTool } from '../execution/tools/file-reader.js';
import { PatchFileTool } from '../execution/tools/patch-file.js';

import { IOLayer } from '../daemon/io-layer.js';
import { CollisionDetector } from '../daemon/collision-detector.js';
import { EventBroker } from '../services/event-broker.js';
import { ContextCompressor } from '../services/context-compressor.js';
import { ConfigService } from '../services/config.js';
import { LlmValidatorService } from '../services/llm-validator.js';

// Core Services
container.registerSingleton('ILogger', Logger);
container.registerSingleton(EventBroker);
container.registerSingleton(ContextCompressor);
container.registerSingleton(ConfigService);
container.registerSingleton(LlmValidatorService);

// Daemon Layer
container.registerSingleton(IOLayer);
container.registerSingleton(CollisionDetector);

// Execution Layer
container.registerSingleton(ToolRegistry);
container.registerSingleton(NativeShellTool);
container.registerSingleton(AtomicGitTool);
container.registerSingleton(FileWriterTool);
container.registerSingleton(DirectoryCreatorTool);
container.registerSingleton(FileReaderTool);
container.registerSingleton(PatchFileTool);

// Intelligence Layer
container.registerSingleton(ASTParser);
container.registerSingleton(VectorStore);
container.registerSingleton(Indexer);
container.registerSingleton(RAGService);
container.registerSingleton(FileWatcherDaemon);
container.registerSingleton(MemoryStore);

// Agents
container.register('IThinkingAgent', { useClass: ThinkingAgent });
container.register('IPlanningAgent', { useClass: PlanningAgent });
container.register('IArchitectAgent', { useClass: ArchitectAgent });
container.register('IExecutionAgent', { useClass: ExecutionAgent });
container.register('IBuildingAgent', { useClass: BuildingAgent });
container.register('IVerificationAgent', { useClass: VerificationAgent });
container.register('IDebateAgent', { useClass: DebateAgent });
container.registerSingleton(ParallelExecutor);

export { container };
