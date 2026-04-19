// FILE: src/modules/rlm/llm-api.client.ts

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
}

@Injectable()
export class LlmApiClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly modelMini: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly apiUrl = 'https://api.openai.com/v1/chat/completions';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY') as string;
    this.model = this.configService.get<string>('OPENAI_MODEL') as string;
    this.modelMini = this.configService.get<string>('OPENAI_MODEL_MINI') as string;
    this.maxTokens = parseInt(
      this.configService.get<string>('OPENAI_MAX_TOKENS') ?? '5000',
    );
    this.temperature = parseFloat(
      this.configService.get<string>('OPENAI_TEMPERATURE') ?? '0.2',
    );
  }

  // Query ke model tertentu
  private async queryModel(
    messages: ChatMessage[],
    model: string,
  ): Promise<LLMResponse> {
    console.log(`[LLM] 🚀 Querying model: ${model}`);
    console.log(`[LLM] 📨 Messages count: ${messages.length}`);

    const response = await axios.post(
      this.apiUrl,
      {
        model,
        messages,
        max_completion_tokens: this.maxTokens
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const choice = response.data.choices[0];
    const usage = response.data.usage;

    console.log(`[LLM] ✅ Response received`);
    console.log(`[LLM] 📊 Tokens → input: ${usage.prompt_tokens}, output: ${usage.completion_tokens}`);
    console.log(`[LLM] 💬 Content preview: "${choice.message.content.slice(0, 100)}..."`);

    return {
      content: choice.message.content,
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
    };
  }

  // Root LM → GPT-5.2 untuk dekomposisi & sintesis
  async queryRootLM(messages: ChatMessage[]): Promise<LLMResponse> {
    console.log(`\n[LLM] 🧠 ROOT LM called (${this.model})`);
    return this.queryModel(messages, this.model);
  }

  // Sub LM → GPT-5-mini untuk inferensi konteks kecil
  async querySubLM(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMResponse> {
    console.log(`\n[LLM] 🔬 SUB LM called (${this.modelMini})`);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    return this.queryModel(messages, this.modelMini);
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}