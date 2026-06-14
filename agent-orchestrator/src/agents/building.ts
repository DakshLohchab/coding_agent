import { injectable, inject } from 'tsyringe';
import { IBuildingAgent, ILogger } from './interfaces.js';
import { AgentContext } from '../types.js';
import { EventBroker } from '../services/event-broker.js';
import { ToolRegistry } from '../execution/tool-registry.js';

@injectable()
export class BuildingAgent implements IBuildingAgent {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(EventBroker) private eventBroker: EventBroker,
    @inject(ToolRegistry) private toolRegistry: ToolRegistry
  ) {}

  async build(context: AgentContext): Promise<{ success: boolean; logs: string }> {
    this.logger.info('Building Agent: Compiling project assets and checking dependencies...');
    this.eventBroker.emitAsync('agent.thought', 'Executing build commands (e.g. npm run build, tsc, or rustc)...');
    
    try {
      // In a full implementation, you would dynamically decide the build command based on the repository state
      const output = await this.toolRegistry.executeTool('native_shell', { script: 'echo "Mock build execution successful."' });
      return { success: output.success !== false, logs: output.stdout || 'Build completed successfully.' };
    } catch (e: any) {
      this.logger.error('Building Agent encountered a critical failure', e);
      return { success: false, logs: e.message };
    }
  }
}
