import { injectable } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline/promises';

export interface ProviderConfig {
  provider: string;
  apiKey: string;
}

@injectable()
export class ConfigService {
  private configPath = path.join(os.homedir(), '.ca2026rc');
  private currentConfig: ProviderConfig | null = null;

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        const data = fs.readFileSync(this.configPath, 'utf8');
        this.currentConfig = JSON.parse(data);
        if (this.hasValidConfig()) return;
      } catch (e) {}
    }
    
    // Check local .env as fallback
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      try {
        const data = fs.readFileSync(envPath, 'utf8');
        const match = data.match(/(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|OPENROUTER_API_KEY|FIREWORKS_API_KEY)=([^\s]+)/);
        if (match) {
          const providerMap: Record<string, string> = {
            'OPENAI_API_KEY': 'OpenAI',
            'ANTHROPIC_API_KEY': 'Anthropic Claude',
            'GEMINI_API_KEY': 'Gemini API',
            'OPENROUTER_API_KEY': 'OpenRouter',
            'FIREWORKS_API_KEY': 'Fireworks'
          };
          this.currentConfig = {
            provider: providerMap[match[1]],
            apiKey: match[2]
          };
        }
      } catch (e) {}
    }
  }

  public hasValidConfig(): boolean {
    return !!this.currentConfig && !!this.currentConfig.provider && !!this.currentConfig.apiKey;
  }

  public getConfig(): ProviderConfig | null {
    return this.currentConfig;
  }

  public saveConfig(config: ProviderConfig) {
    this.currentConfig = config;
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  public async runWizard(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('\n======================================');
    console.log('   CA2026 Configuration Wizard');
    console.log('======================================');
    console.log('Select your preferred LLM Provider:\n');
    console.log('  1. Gemini API');
    console.log('  2. Anthropic Claude');
    console.log('  3. OpenAI');
    console.log('  4. OpenRouter');
    console.log('  5. Fireworks\n');

    let provider = '';
    while (!provider) {
      const choice = await rl.question('Enter number (1-5): ');
      switch (choice.trim()) {
        case '1': provider = 'Gemini API'; break;
        case '2': provider = 'Anthropic Claude'; break;
        case '3': provider = 'OpenAI'; break;
        case '4': provider = 'OpenRouter'; break;
        case '5': provider = 'Fireworks'; break;
        default: console.log('Invalid choice. Please enter 1-5.');
      }
    }

    const apiKey = await rl.question(`\nPlease paste your API key for ${provider}: `);
    
    this.saveConfig({ provider, apiKey: apiKey.trim() });
    console.log(`\n[Success] Configuration saved to ${this.configPath}\n`);
    rl.close();
  }
}
