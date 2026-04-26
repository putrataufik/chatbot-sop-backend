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
  private readonly modelNano: string;
  private readonly maxTokensRoot: number;
  private readonly maxTokensSub: number;
  private readonly apiUrl = 'https://api.openai.com/v1/chat/completions';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY') as string;
    this.model = this.configService.get<string>('OPENAI_MODEL') as string;
    this.modelMini = this.configService.get<string>(
      'OPENAI_MODEL_MINI',
    ) as string;
    this.modelNano = this.configService.get<string>(
      'OPENAI_MODEL_NANO',
    ) as string;
    this.maxTokensRoot = parseInt(
      this.configService.get<string>('OPENAI_MAX_TOKENS_ROOT') ?? '100000',
    );
    this.maxTokensSub = parseInt(
      this.configService.get<string>('OPENAI_MAX_TOKENS_SUB') ?? '100000',
    );
  }

  private async queryModel(
    messages: ChatMessage[],
    model: string,
    maxTokens: number,
  ): Promise<LLMResponse> {
    console.log(`[LLM] 🚀 Querying model: ${model}`);
    console.log(`[LLM] 📨 Messages count: ${messages.length}`);

    const response = await axios.post(
      this.apiUrl,
      {
        model,
        messages,
        max_completion_tokens: maxTokens,
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
    const content = choice.message.content ?? '';

    console.log(`[LLM] ✅ Response received`);
    console.log(
      `[LLM] 📊 Tokens → input: ${usage.prompt_tokens}, output: ${usage.completion_tokens}`,
    );
    console.log(`[LLM] 💬 Content raw length: ${content.length}`);
    console.log(`[LLM] 💬 Content preview: "${content.slice(0, 200)}"`);

    return {
      content,
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
    };
  }

  // Root LM → untuk dekomposisi & sintesis RLM
  async queryRootLM(messages: ChatMessage[]): Promise<LLMResponse> {
    console.log(`\n[LLM] 🧠 ROOT LM called (${this.model})`);
    return this.queryModel(messages, this.model, this.maxTokensRoot);
  }

  // Conv LM → untuk baseline konvensional (same model & max tokens as Root LM)
  async queryConvLM(messages: ChatMessage[]): Promise<LLMResponse> {
    console.log(`\n[LLM] 🏛️ CONV LM called (${this.model})`);
    return this.queryModel(messages, this.model, this.maxTokensRoot);
  }

  // Sub LM → untuk inferensi konteks dokumen
  async querySubLM(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMResponse> {
    console.log(`\n[LLM] 🔬 SUB LM called (${this.modelMini})`);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    return this.queryModel(messages, this.modelMini, this.maxTokensSub);
  }

  // Mini LM → untuk jawaban kontekstual dari history
  async queryMiniLM(messages: ChatMessage[]): Promise<LLMResponse> {
    console.log(`\n[LLM] 💬 MINI LM called (${this.modelMini})`);
    return this.queryModel(messages, this.modelMini, 4000);
  }

  // Nano LM → untuk klasifikasi intent & chitchat
  async queryNano(messages: ChatMessage[]): Promise<LLMResponse> {
    console.log(`\n[LLM] ⚡ NANO called (${this.modelNano})`);
    return this.queryModel(messages, this.modelNano, 500);
  }

  async queryNanoShort(messages: ChatMessage[]): Promise<LLMResponse> {
    console.log(`\n[LLM] ⚡ NANO SHORT called (${this.modelNano})`);
    return this.queryModel(messages, this.modelNano, 500);
  }
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
