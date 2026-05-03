// FILE: src/modules/rlm/conventional.service.ts
//
// Conventional baseline — kirim semua dokumen sekaligus ke model sebagai context
// Language: jawab dalam bahasa yang sama dengan user's question

import { Injectable } from '@nestjs/common';
import { LlmApiClient, ChatMessage } from './llm-api.client';
import { SopDocumentsService } from '../sop-documents/sop-documents.service';

export interface ConventionalResult {
  content: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
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
    chatHistory: { role: string; content: string }[],
  ): Promise<ConventionalResult> {
    console.log('[CONV] 🏛️ Starting conventional processing...');

    try {
      // Load semua dokumen dengan content
      const docs = await this.sopDocumentsService.findAllWithContent();
      console.log(`[CONV] 📚 Loaded ${docs.length} documents for context`);

      // Gabung semua dokumen sebagai context
      const fullContext = docs
        .map((d) => `=== ${d.title} ===\n${d.content}`)
        .join('\n\n');

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `You are a helpful HR assistant named SOP Intellect. Answer questions based solely on the SOP documents provided.

LANGUAGE RULE (CRITICAL):
- Detect the language of the user's question.
- Answer in the SAME language as the user's question.
- English question → English answer.
- Indonesian question → Indonesian answer.
- The SOP documents may be in a different language — read them in their original language but answer in the user's language.

ANSWER STYLE:
- Be friendly, conversational, and direct.
- The user has NO direct access to the SOP documents — YOU are their only source of information.
- Never tell the user to "check the document", "refer to the SOP", or "look it up themselves" — provide the complete answer.
- Use Markdown (bold for key terms, numbered lists for steps).
- Include ALL numeric values, durations, and time limits EXACTLY as written in the document.
- If information is not in the documents, say so politely — do NOT suggest checking elsewhere.

SOP DOCUMENTS:
${fullContext}`,
        },
        ...chatHistory.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        {
          role: 'user' as const,
          content: userQuestion,
        },
      ];

      const response = await this.llmApiClient.queryRootLM(messages);
      console.log(`[CONV] ✅ Done. Tokens: input=${response.input_tokens}, output=${response.output_tokens}`);

      return {
        content:       response.content,
        input_tokens:  response.input_tokens,
        output_tokens: response.output_tokens,
        cached_input_tokens: response.cached_input_tokens,
        error_message: null,
      };
    } catch (err: any) {
      console.error('[CONV] ❌ Error:', err.message);
      return {
        content:       '',
        input_tokens:  0,
        output_tokens: 0,
        cached_input_tokens: 0,
        error_message: err.message,
      };
    }
  }
}