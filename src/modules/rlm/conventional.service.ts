// FILE: src/modules/rlm/conventional.service.ts

import { Injectable } from '@nestjs/common';
import { LlmApiClient, ChatMessage } from './llm-api.client';
import { SopDocumentsService } from '../sop-documents/sop-documents.service';

export interface ConventionalResult {
  content: string;
  input_tokens: number;
  output_tokens: number;
  error_message: string | null;
}

@Injectable()
export class ConventionalService {
  constructor(
    private llmApiClient: LlmApiClient,
    private sopDocumentsService: SopDocumentsService,
  ) {}

  async process(
    userQuestion: string,
    chatHistory: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<ConventionalResult> {
    console.log('\n[CONV] 🏛️ Starting conventional processing...');

    const allDocs = await this.sopDocumentsService.findAllWithContent();
    console.log(`[CONV] 📚 Loaded ${allDocs.length} documents for context`);

    const fullContext = allDocs
      .map((doc) => `=== ${doc.title} ===\n${doc.content}`)
      .join('\n\n');

    const trimmedHistory = chatHistory.slice(-4).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content:
        m.role === 'assistant'
          ? m.content.slice(0, 1000) +
            (m.content.length > 1000 ? '\n...[dipotong]' : '')
          : m.content,
    }));

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Kamu adalah asisten HR bernama SOP Intellect. Jawab pertanyaan berdasarkan dokumen SOP berikut:\n\n${fullContext}\n\nJawab dengan lengkap dan akurat menggunakan Markdown. Kutip judul dokumen yang relevan.`,
      },
      ...trimmedHistory,
      { role: 'user', content: userQuestion },
    ];

    try {
      const result = await this.llmApiClient.queryConvLM(messages);
      console.log(
        `[CONV] ✅ Done. Tokens: input=${result.input_tokens}, output=${result.output_tokens}`,
      );
      return {
        content: result.content,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        error_message: null,
      };
    } catch (err: any) {
      // Jika gagal (misal context overflow), estimasi token dan simpan error
      const estimatedInputTokens = this.llmApiClient.estimateTokens(
        messages.map((m) => m.content).join(' '),
      );
      const errorMsg: string =
        (err?.response?.data?.error?.message as string | undefined) ??
        (err?.message as string | undefined) ??
        'Unknown error';
      console.error(`[CONV] ❌ Error: ${errorMsg}`);
      console.log(`[CONV] 📊 Estimated input tokens: ${estimatedInputTokens}`);

      return {
        content: '',
        input_tokens: estimatedInputTokens,
        output_tokens: 0,
        error_message: errorMsg,
      };
    }
  }
}
