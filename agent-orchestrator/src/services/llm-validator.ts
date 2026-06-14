import { injectable, inject } from 'tsyringe';
import { ConfigService } from './config.js';

@injectable()
export class LlmValidatorService {
  constructor(@inject(ConfigService) private configService: ConfigService) {}

  async validateConnection(): Promise<boolean> {
    const config = this.configService.getConfig();
    if (!config || !config.apiKey) {
      throw new Error('LLM Provider not configured. Please use the wizard to set it up.');
    }

    try {
      if (config.provider === 'OpenRouter') {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.modelName || 'openrouter/auto',
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 5
          })
        });
        if (!response.ok) throw new Error(`OpenRouter API error: ${response.statusText}`);
      } else if (config.provider === 'Anthropic Claude') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.modelName || 'claude-3-haiku-20240307',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Ping' }],
          })
        });
        if (!response.ok) throw new Error(`Anthropic API error: ${response.statusText}`);
      } else if (config.provider === 'Gemini API') {
        const model = config.modelName || 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Ping' }] }],
            generationConfig: { maxOutputTokens: 5 }
          })
        });
        if (!response.ok) throw new Error(`Gemini API error: ${response.statusText}`);
      } else if (config.provider === 'OpenAI') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.modelName || 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 5
          })
        });
        if (!response.ok) throw new Error(`OpenAI API error: ${response.statusText}`);
      }
      return true;
    } catch (error: any) {
      throw new Error(`LLM connection failed: ${error.message}`);
    }
  }
}
