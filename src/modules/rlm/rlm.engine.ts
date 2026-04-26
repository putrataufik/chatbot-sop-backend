// FILE: src/modules/rlm/rlm.engine.ts

import { Injectable } from '@nestjs/common';
import { LlmApiClient, ChatMessage } from './llm-api.client';
import { ReplEnvironment } from './repl.environment';
import { ReplSandbox } from './repl.sandbox';

export interface DocumentMeta {
  id: number;
  title: string;
  file_size: number;
}

export interface RLMResult {
  answer: string;
  references: string[];
  subQueryResults: SubQueryItem[];
  // Total gabungan (backward compat)
  totalInputTokens: number;
  totalOutputTokens: number;
  // Breakdown per model — BARU
  rootInputTokens: number;
  rootOutputTokens: number;
  subInputTokens: number;
  subOutputTokens: number;
  totalIterations: number;
  depth: number;
  execLog: string[];
  selectedDocumentIds: number[];
}

export interface SubQueryItem {
  subQuestion: string;
  answer: string;
  tokensUsed: number;
  depth: number;
}

@Injectable()
export class RlmEngine {
  private readonly maxIterations = 10;

  constructor(
    private llmApiClient: LlmApiClient,
    private replSandbox: ReplSandbox,
  ) {}

  async process(
    userQuestion: string,
    repl: ReplEnvironment,
    allDocuments: DocumentMeta[],
    loadDocumentFn: (id: number) => Promise<string>,
    chatHistory: { role: 'user' | 'assistant'; content: string }[] = [],
  ): Promise<RLMResult> {
    console.log('\n════════════════════════════════════════════════');
    console.log('[RLM] 🚀 START PROCESSING');
    console.log(`[RLM] ❓ Question: "${userQuestion}"`);
    console.log(`[RLM] 📋 Documents available: ${allDocuments.length}`);
    console.log('════════════════════════════════════════════════\n');

    this.replSandbox.initSession(allDocuments);

    const subQueryResults: SubQueryItem[] = [];
    const references: string[] = [];
    const selectedDocumentIds: number[] = [];

    // ── Token tracking dipisah per model ──────────────────
    let rootInputTokens  = 0;  // gpt-5.1
    let rootOutputTokens = 0;  // gpt-5.1
    let subInputTokens   = 0;  // gpt-5-mini
    let subOutputTokens  = 0;  // gpt-5-mini

    let totalIterations = 0;
    let currentDepth = 1;

    const conversationHistory: ChatMessage[] = [
      {
        role: 'system',
        content: this.buildSystemPrompt(allDocuments),
      },
      ...chatHistory,
      {
        role: 'user',
        content: userQuestion,
      },
    ];

    // ── LOOP UTAMA ─────────────────────────────────────
    for (let i = 0; i < this.maxIterations; i++) {
      totalIterations++;
      console.log(
        `\n[RLM] ── ITERASI ${i + 1}/${this.maxIterations} ──────────────────`,
      );

      const trimmedHistory = this.trimHistory(conversationHistory);
      const response = await this.llmApiClient.queryRootLM(trimmedHistory);

      // Root LM token → gpt-5.1
      rootInputTokens  += response.input_tokens;
      rootOutputTokens += response.output_tokens;

      console.log(
        `[RLM] 📨 GPT response preview: "${response.content.slice(0, 300)}"`,
      );

      conversationHistory.push({
        role: 'assistant',
        content: response.content,
      });

      const codeBlock = this.extractCodeBlock(response.content);
      const finalMatch = response.content.match(
        /FINAL\(([^)]*(?:\([^)]*\)[^)]*)*)\)/s,
      );

      if (finalMatch && !codeBlock) {
        const answer = finalMatch[1].trim();
        if (
          answer &&
          !answer.includes('__LLM_PLACEHOLDER') &&
          answer.length > 5
        ) {
          console.log('\n[RLM] 🏁 FINAL() detected outside code block');
          return this.buildResult({
            answer, references, subQueryResults,
            rootInputTokens, rootOutputTokens,
            subInputTokens, subOutputTokens,
            totalIterations, currentDepth,
            selectedDocumentIds,
          });
        }
      }

      if (!codeBlock && !finalMatch) {
        const plainAnswer = response.content.trim();
        if (plainAnswer.length > 200 && i > 0) {
          console.log('[RLM] 💡 Root LM provided direct answer without FINAL()');
          return this.buildResult({
            answer: plainAnswer, references, subQueryResults,
            rootInputTokens, rootOutputTokens,
            subInputTokens, subOutputTokens,
            totalIterations, currentDepth,
            selectedDocumentIds,
          });
        }

        console.log('[RLM] ⚠️  No code block found, prompting Root LM to use REPL');
        conversationHistory.push({
          role: 'user',
          content:
            'Observation: Tidak ada code block. Tulis code dalam ```repl block. Jika kamu sudah tahu jawabannya, panggil FINAL(jawaban) di dalam code block.',
        });
        continue;
      }

      if (!codeBlock) {
        console.log('[RLM] ⚠️  No code block found (FINAL was placeholder)');
        conversationHistory.push({
          role: 'user',
          content:
            'Observation: Tidak ada code block yang valid. Tulis code dalam ```repl block.',
        });
        continue;
      }

      // ── Eksekusi di sandbox ──
      const execResult = await this.replSandbox.execute(
        codeBlock,
        // llm_query callback → Sub LM (gpt-5-mini)
        async (prompt: string) => {
          currentDepth++;
          console.log(`[RLM] 🔬 Sub-LM called (depth=${currentDepth})`);
          const subResponse = await this.llmApiClient.querySubLM(
            `Kamu adalah asisten HR yang ramah dan helpful. Jawab pertanyaan user berdasarkan dokumen SOP yang diberikan.

GAYA JAWABAN:
- Jawab seperti teman kerja yang menjelaskan prosedur — ramah, jelas, dan to the point.
- Gunakan format Markdown agar mudah dibaca:
  - **Bold** untuk nama jabatan, nama formulir, dan hal penting
  - Gunakan numbered list (1. 2. 3.) untuk langkah-langkah prosedur
  - Gunakan bullet points untuk sub-detail
- Boleh beri pengantar singkat 1-2 kalimat sebelum masuk ke detail prosedur.
- Jika ada kondisi if/else, jelaskan dengan natural (misal: "Kalau disetujui, lanjut ke... Tapi kalau tidak, maka...")

AKURASI:
- Semua informasi HARUS dari dokumen yang diberikan — jangan mengarang.
- Gunakan istilah dan nomor langkah PERSIS dari dokumen.
- Jangan menambah langkah atau prosedur yang tidak tertulis di dokumen.
- Jika informasi yang ditanyakan tidak ada di dokumen, jawab dengan sopan bahwa informasi tersebut tidak tercantum dalam SOP yang tersedia.`,
            prompt,
          );

          // Sub LM token → gpt-5-mini
          subInputTokens  += subResponse.input_tokens;
          subOutputTokens += subResponse.output_tokens;

          subQueryResults.push({
            subQuestion: prompt.slice(0, 200),
            answer:      subResponse.content,
            tokensUsed:  subResponse.input_tokens + subResponse.output_tokens,
            depth:       currentDepth,
          });
          return subResponse.content;
        },
        // load_document callback
        async (id: number) => {
          console.log(`[RLM] 📂 Loading document id=${id}`);
          const content    = await loadDocumentFn(id);
          const normalized = this.normalizeDocument(content);
          if (!selectedDocumentIds.includes(id)) {
            selectedDocumentIds.push(id);
          }
          repl.loadDocument(normalized);
          console.log(
            `[RLM] ✅ Document ${id} loaded & normalized: ${normalized.length} chars`,
          );
          return normalized;
        },
      );

      console.log('[RLM] 📤 execResult.finalAnswer:', execResult.finalAnswer?.slice(0, 200));
      console.log('[RLM] 📤 execResult.error:', execResult.error);

      if (execResult.finalAnswer) {
        const answer = execResult.finalAnswer.trim();
        if (answer.includes('__LLM_PLACEHOLDER')) {
          console.log('[RLM] ⚠️  FINAL() contains placeholder, continuing...');
          conversationHistory.push({
            role: 'user',
            content:
              'Observation: FINAL() mengandung placeholder. Pastikan llm_query() dipanggil dengan benar dan hasilnya di-assign ke variabel sebelum FINAL().',
          });
          continue;
        }

        console.log('\n[RLM] 🏁 FINAL() called inside code → selesai');
        return this.buildResult({
          answer, references, subQueryResults,
          rootInputTokens, rootOutputTokens,
          subInputTokens, subOutputTokens,
          totalIterations, currentDepth,
          selectedDocumentIds,
        });
      }

      const observation = this.buildObservation(execResult);
      console.log(`[RLM] 👁️  Observation: "${observation.slice(0, 300)}..."`);
      conversationHistory.push({
        role: 'user',
        content: `Observation:\n${observation}`,
      });
    }

    // ── Fallback ──
    console.log('\n[RLM] ⚠️  Max iterasi tercapai');
    const fallback = await this.buildFallbackAnswer(
      userQuestion,
      subQueryResults,
      repl,
    );

    // Fallback juga pakai Root LM
    rootInputTokens  += fallback.inputTokens;
    rootOutputTokens += fallback.outputTokens;

    return this.buildResult({
      answer: fallback.answer, references, subQueryResults,
      rootInputTokens, rootOutputTokens,
      subInputTokens, subOutputTokens,
      totalIterations, currentDepth,
      selectedDocumentIds,
    });
  }

  // ── Helper: bangun RLMResult ───────────────────────────

  private buildResult(params: {
    answer: string;
    references: string[];
    subQueryResults: SubQueryItem[];
    rootInputTokens: number;
    rootOutputTokens: number;
    subInputTokens: number;
    subOutputTokens: number;
    totalIterations: number;
    currentDepth: number;
    selectedDocumentIds: number[];
  }): RLMResult {
    const totalInputTokens  = params.rootInputTokens  + params.subInputTokens;
    const totalOutputTokens = params.rootOutputTokens + params.subOutputTokens;

    console.log(
      `[RLM] 📊 Token breakdown → Root: in=${params.rootInputTokens} out=${params.rootOutputTokens} | Sub: in=${params.subInputTokens} out=${params.subOutputTokens}`,
    );

    return {
      answer:            params.answer,
      references:        params.references,
      subQueryResults:   params.subQueryResults,
      totalInputTokens,
      totalOutputTokens,
      rootInputTokens:   params.rootInputTokens,
      rootOutputTokens:  params.rootOutputTokens,
      subInputTokens:    params.subInputTokens,
      subOutputTokens:   params.subOutputTokens,
      totalIterations:   params.totalIterations,
      depth:             params.currentDepth,
      execLog:           this.replSandbox.getExecLog(),
      selectedDocumentIds: params.selectedDocumentIds,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OBSERVATION BUILDER
  // ══════════════════════════════════════════════════════════════════════════

  private buildObservation(execResult: {
    output: string;
    error: string;
    success: boolean;
    llmQueryCalls: string[];
    loadedDocumentIds: number[];
  }): string {
    let obs = '';

    if (execResult.loadedDocumentIds.length > 0) {
      obs += `Dokumen berhasil diload: id=[${execResult.loadedDocumentIds.join(', ')}]. Context sekarang tersedia di variabel \`context\`.\n`;
      obs += `PENTING: Di iterasi berikutnya, \`context\` sudah berisi dokumen yang di-load. Kamu TIDAK perlu memanggil load_document() lagi.\n\n`;
    }

    if (execResult.output) {
      const truncated =
        execResult.output.length > 3000
          ? execResult.output.slice(0, 3000) + '\n... [output dipotong]'
          : execResult.output;
      obs += `Output:\n${truncated}`;
    }

    if (execResult.error) {
      obs += `\n\nError:\n${execResult.error}`;
    }

    if (execResult.llmQueryCalls.length > 0) {
      obs += `\n\n${execResult.llmQueryCalls.length} llm_query() telah dieksekusi. Hasilnya sudah tersedia.`;
    }

    if (!obs.trim()) {
      obs = 'Code berhasil dieksekusi tanpa output. Lanjutkan atau panggil FINAL() dengan jawaban.';
    }

    return obs;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SYSTEM PROMPT
  // ══════════════════════════════════════════════════════════════════════════

  private buildSystemPrompt(allDocuments: DocumentMeta[]): string {
    const docList = allDocuments
      .map((d) => `  - id:${d.id} | "${d.title}" | ${d.file_size} bytes`)
      .join('\n');

    return `Kamu adalah asisten cerdas untuk menjawab pertanyaan tentang
Standar Operasional Prosedur (SOP).

=== DOKUMEN TERSEDIA ===
${docList}
========================

=== CARA KERJA ===
1. Pilih dokumen yang relevan dengan pertanyaan
2. Load dokumen dengan load_document(id)
3. Filter context dengan keyword/regex — ambil bagian yang relevan saja
4. Analisis dengan llm_query() menggunakan context yang sudah difilter
5. Berikan jawaban dengan FINAL()

=== FUNGSI TERSEDIA ===
- \`await load_document(id)\` → load dokumen ke context (WAJIB pakai await)
- \`context\`                → isi dokumen setelah load_document() dipanggil
- \`document_list\`          → array metadata semua dokumen
- \`print(...)\`             → tampilkan output
- \`await llm_query(prompt)\`→ analisis semantik dengan Sub-LM (WAJIB pakai await)
- \`re.search(pat, text)\`   → regex search (return boolean)
- \`re.findall(pat, text)\`  → regex findall (return array)
- \`FINAL(jawaban)\`         → berikan jawaban akhir

=== ATURAN PENTING ===
- Gunakan JavaScript karena sistem ini menjalankan code di sandbox JavaScript.
- WAJIB pakai \`await\` untuk load_document() dan llm_query()
- WAJIB panggil load_document() sebelum mengakses context
- SATU code block per respons (gunakan \`\`\`repl)
- WAJIB panggil FINAL() setelah mendapat jawaban
- JANGAN jawab dari pengetahuan umum — HANYA dari isi dokumen
- Gunakan istilah dan nomor langkah PERSIS dari dokumen

=== ATURAN EFISIENSI TOKEN ===
- JANGAN kirim seluruh context ke llm_query — sangat boros token
- WAJIB filter context dengan keyword/regex sebelum llm_query
- Kirim HANYA baris/paragraf yang relevan dengan pertanyaan (maks 5000 karakter)
- Jika hasil filter kosong, perluas keyword atau ambil paragraf yang paling dekat
- Sertakan sedikit konteks sekitar (2-3 baris sebelum/sesudah) agar jawaban tidak terputus

=== CONTOH LENGKAP ===
\`\`\`repl
// Step 1: Load dokumen
await load_document(4)

// Step 2: Filter context — ambil bagian yang relevan saja
const lines = context.split('\\n')
const keywords = ['biro perencanaan', 'kepala biro', 'perencanaan']
const relevantIndices = new Set()
lines.forEach((line, i) => {
  if (keywords.some(kw => line.toLowerCase().includes(kw.toLowerCase()))) {
    for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
      relevantIndices.add(j)
    }
  }
})
const filteredContext = [...relevantIndices].sort((a, b) => a - b).map(i => lines[i]).join('\\n')
const contextToSend = filteredContext.length > 200
  ? filteredContext.slice(0, 5000)
  : context.slice(0, 5000)

print('Filtered context length:', contextToSend.length)

// Step 3: Analisis dengan Sub-LM
const result = await llm_query(\`
Berdasarkan dokumen SOP di bawah, jawab pertanyaan user.
Dokumen SOP (bagian relevan): \${contextToSend}
Pertanyaan: [pertanyaan user]
\`)

FINAL(result)
\`\`\``;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private normalizeDocument(content: string): string {
    return content
      .replace(/(\d{4},\s*No\.\d+\s+\d+\s)/g, '\n\n$1')
      .replace(/(\s{2,}\d+\.\s{2,})/g, '\n$1')
      .replace(/(\s{2,}[a-z]\.\s{2,})/g, '\n$1')
      .replace(/(BAB\s+[IVX]+\s)/g, '\n\n$1')
      .replace(/([.!?])\s{2,}/g, '$1\n')
      .replace(/\s{3,}/g, '  ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private extractCodeBlock(content: string): string | null {
    const match = content.match(/```repl\n?([\s\S]*?)```/);
    if (match) return match[1].trim();
    const jsMatch = content.match(/```(?:javascript|js)\n?([\s\S]*?)```/);
    if (jsMatch) return jsMatch[1].trim();
    return null;
  }

  private trimHistory(
    history: ChatMessage[],
    maxMessages: number = 10,
  ): ChatMessage[] {
    if (history.length <= maxMessages) return history;
    const systemPrompt = history[0];
    const firstUser    = history[1];
    const recent       = history.slice(-(maxMessages - 2));
    console.log(`[RLM] ✂️  History trimmed: ${history.length} → ${recent.length + 2}`);
    return [systemPrompt, firstUser, ...recent];
  }

  private async buildFallbackAnswer(
    originalQuestion: string,
    subQueryResults: SubQueryItem[],
    repl: ReplEnvironment,
  ): Promise<{ answer: string; inputTokens: number; outputTokens: number }> {
    const keywords = originalQuestion
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const lines = repl.getDocument().split('\n');
    const hits  = lines
      .filter((l) => keywords.some((kw) => l.toLowerCase().includes(kw)))
      .sort((a, b) => b.length - a.length)
      .slice(0, 20)
      .join('\n');

    const validSubAnswers = subQueryResults
      .filter((r) => !r.answer.includes('Tidak tersedia'))
      .map((r, i) => `Sub-query ${i + 1}: ${r.subQuestion}\nJawaban: ${r.answer}`)
      .join('\n\n---\n\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Kamu adalah asisten yang ramah. Jawab berdasarkan dokumen SOP yang diberikan.
Gunakan format Markdown dan gaya conversational yang natural.
Gunakan istilah dan nomor langkah persis dari dokumen. Jangan mengarang.`,
      },
      {
        role: 'user',
        content: `Pertanyaan: "${originalQuestion}"
${validSubAnswers ? `\nHasil analisis sebelumnya:\n${validSubAnswers}\n\n` : ''}
Kutipan dari dokumen SOP:
${hits || 'Tidak ditemukan kutipan relevan'}

Jawab pertanyaan berdasarkan kutipan di atas.`,
      },
    ];

    const response = await this.llmApiClient.queryRootLM(messages);
    return {
      answer:       response.content,
      inputTokens:  response.input_tokens,
      outputTokens: response.output_tokens,
    };
  }
}