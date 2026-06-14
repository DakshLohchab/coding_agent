import { injectable, inject } from 'tsyringe';
import { ILogger } from './interfaces.js';
import { ConfigService } from '../services/config.js';
import { EventBroker } from '../services/event-broker.js';
import * as fs from 'fs';
import * as path from 'path';

export interface SubTask {
  id: string;
  description: string;
  files: string[];  // file paths this subtask is responsible for
  priority: number; // 1 = highest
}

export interface SubTaskResult {
  taskId: string;
  success: boolean;
  files: { path: string; content: string }[];
  error?: string;
}

@injectable()
export class ParallelExecutor {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject(ConfigService) private configService: ConfigService,
    @inject(EventBroker) private eventBroker: EventBroker
  ) {}

  /**
   * Decomposes a plan into subtasks and executes up to 50 in parallel.
   * Each subtask calls the LLM independently and writes its files immediately.
   */
  async executeParallel(prompt: string, plan: string, maxParallel: number = 10): Promise<SubTaskResult[]> {
    this.logger.info('ParallelExecutor: Executing subtasks in parallel...');
    this.eventBroker.emitAsync('agent.thought', 'Parallel executor engaged. Decomposing plan and spawning subagents...');

    // Step 1: Decompose the plan into subtasks
    const subtasks = await this.decomposePlan(prompt, plan);
    this.logger.info(`ParallelExecutor: Decomposed into ${subtasks.length} subtasks. Running up to ${maxParallel} in parallel.`);
    this.eventBroker.emitAsync('agent.thought', `Launching ${subtasks.length} parallel subagents...`);

    // Step 2: Execute in batches of maxParallel
    const results: SubTaskResult[] = [];
    const config = this.configService.getConfig();

    for (let i = 0; i < subtasks.length; i += maxParallel) {
      const batch = subtasks.slice(i, i + maxParallel);
      this.eventBroker.emitAsync('agent.thought', `Executing batch ${Math.floor(i/maxParallel)+1}: ${batch.length} subagents in parallel...`);
      
      const batchResults = await Promise.allSettled(
        batch.map(task => this.executeSubTask(task, prompt, plan, config))
      );
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          // Write files immediately as each subagent completes
          for (const file of result.value.files) {
            const fullPath = path.resolve(process.cwd(), file.path);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, file.content, 'utf8');
            this.logger.info(`[SubAgent ${result.value.taskId}] Wrote: ${file.path}`);
          }
        } else {
          this.logger.error(`SubTask failed: ${result.reason}`);
          results.push({ taskId: 'unknown', success: false, files: [], error: String(result.reason) });
        }
      }
    }

    const succeeded = results.filter(r => r.success).length;
    this.eventBroker.emitAsync('agent.thought', `Parallel execution complete: ${succeeded}/${results.length} subtasks succeeded.`);
    return results;
  }

  private async decomposePlan(prompt: string, plan: string): Promise<SubTask[]> {
    const config = this.configService.getConfig();
    if (!config?.apiKey) return [{ id: 'main', description: plan, files: [], priority: 1 }];
    
    const decompositionPrompt = `You are a task decomposition expert. Break this coding task into independent subtasks that can be executed IN PARALLEL by separate agents.
User request: ${prompt}
Plan: ${plan}
Output ONLY a JSON array of subtasks. Each subtask must be independent (no dependencies on other subtasks).
Format:
[
  {
    "id": "subtask_1",
    "description": "Create the HTML structure for the landing page with navigation and hero section",
    "files": ["index.html"],
    "priority": 1
  },
  {
    "id": "subtask_2",
    "description": "Create the CSS stylesheet with responsive grid layout and dark theme",
    "files": ["style.css"],
    "priority": 1
  }
]
Rules:
- Maximum 50 subtasks
- Each subtask should handle 1-3 files maximum
- All subtasks must be truly parallel (no subtask depends on another)
- Be specific: each description must tell the agent exactly what to create
- Output ONLY the JSON array, no other text`;

    try {
      const decompRes = await this.callLLM(decompositionPrompt);
      const jsonMatch = decompRes.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const tasks = JSON.parse(jsonMatch[0]) as SubTask[];
        return tasks.slice(0, 50); // Hard cap at 50
      }
      throw new Error('No JSON array found');
    } catch (e) {
      this.logger.warn('Failed to decompose plan via LLM. Falling back to single task.');
      return [{ id: 'main', description: plan, files: [], priority: 1 }];
    }
  }

  private async executeSubTask(task: SubTask, originalPrompt: string, plan: string, config: any): Promise<SubTaskResult> {
    this.logger.info(`SubTask [${task.id}]: Generating code for files: ${task.files.join(', ')}`);
    
    const systemPrompt = `You are a specialized coding subagent. Your ONLY job is to implement one specific subtask.
Output files using ONLY this format — no other text before or between file blocks:
<file path="relative/path/to/file.ext">
complete file content here
</file>`;

    const userPrompt = `Original user request: ${originalPrompt}
Your specific subtask: ${task.description}
${task.files.length > 0 ? `Files you must create: ${task.files.join(', ')}` : ''}
Implement this subtask completely. Output all needed files.`;
    
    try {
      const response = await this.callLLM(userPrompt, systemPrompt);
      
      const files = this.extractFiles(response);
      if (files.length === 0) {
        return { taskId: task.id, success: false, files: [], error: 'No files generated' };
      }

      return { taskId: task.id, success: true, files };
    } catch (error: any) {
      this.logger.error(`SubTask [${task.id}] failed: ${error.message}`);
      return { taskId: task.id, success: false, files: [], error: error.message };
    }
  }

  private extractFiles(raw: string): { path: string; content: string }[] {
    const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
    const virtualFiles: { path: string; content: string }[] = [];
    let match;
    
    while ((match = fileRegex.exec(raw)) !== null) {
      virtualFiles.push({ path: match[1], content: match[2].trim() });
    }
    return virtualFiles;
  }

  private async callLLM(userContent: string, systemContent?: string): Promise<string> {
    const config = this.configService.getConfig();
    if (!config?.apiKey) throw new Error('No API key configured');
    
    if (config.provider === 'Gemini API') {
      const model = config.modelName || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: systemContent ? { parts: [{ text: systemContent }] } : undefined,
          contents: [{ role: 'user', parts: [{ text: userContent }] }],
          generationConfig: { maxOutputTokens: 8096 }
        })
      });
      if (!response.ok) throw new Error(`Gemini error: ${response.status}`);
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    
    if (config.provider === 'Anthropic Claude') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName || 'claude-sonnet-4-6',
          max_tokens: 8096,
          system: systemContent || 'You are a helpful coding assistant.',
          messages: [{ role: 'user', content: userContent }]
        })
      });
      if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
      const data = await response.json();
      return data.content?.[0]?.text || '';
    }

    if (config.provider === 'OpenRouter') {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName || 'openrouter/auto',
          messages: [
            ...(systemContent ? [{ role: 'system', content: systemContent }] : []),
            { role: 'user', content: userContent }
          ]
        })
      });
      if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);
      const data = await response.json();
      return data.choices[0].message.content || '';
    }

    if (config.provider === 'OpenAI') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName || 'gpt-4o',
          messages: [
            ...(systemContent ? [{ role: 'system', content: systemContent }] : []),
            { role: 'user', content: userContent }
          ]
        })
      });
      if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    }
    
    throw new Error(`Provider ${config.provider} not supported in ParallelExecutor`);
  }
}
