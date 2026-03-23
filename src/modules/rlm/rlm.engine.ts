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
  totalInputTokens: number;
  totalOutputTokens: number;
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
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
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
      console.log(`\n[RLM] ── ITERASI ${i + 1}/${this.maxIterations} ──────────────────`);

      const trimmedHistory = this.trimHistory(conversationHistory);
      const response = await this.llmApiClient.queryRootLM(trimmedHistory);
      totalInputTokens += response.input_tokens;
      totalOutputTokens += response.output_tokens;

      console.log(`[RLM] 📨 GPT response preview: "${response.content.slice(0, 200)}"`);

      conversationHistory.push({ role: 'assistant', content: response.content });

      // Cek FINAL() di luar code block
      const finalMatch = response.content.match(/FINAL\(([^)]*(?:\([^)]*\)[^)]*)*)\)/s);
      if (finalMatch && !response.content.includes('```repl')) {
        console.log('\n[RLM] 🏁 FINAL() detected outside code block');
        return {
          answer: finalMatch[1].trim(),
          references, subQueryResults, totalInputTokens,
          totalOutputTokens, totalIterations,
          depth: currentDepth, execLog: this.replSandbox.getExecLog(),
          selectedDocumentIds,
        };
      }

      const codeBlock = this.extractCodeBlock(response.content);
      if (!codeBlock) {
        console.log('[RLM] ⚠️  No code block found');
        conversationHistory.push({
          role: 'user',
          content: 'Observation: Tidak ada code block. Tulis code dalam ```repl block.',
        });
        continue;
      }

      // Eksekusi di sandbox
      const execResult = await this.replSandbox.execute(
        codeBlock,
        // llm_query callback
        async (prompt: string) => {
          currentDepth++;
          console.log(`[RLM] 🔬 Sub-LM called (depth=${currentDepth})`);
          const subResponse = await this.llmApiClient.querySubLM(
            `Kamu adalah asisten ahli SOP. Jawab HANYA berdasarkan informasi yang diberikan.
Jika tidak ada info relevan, katakan "Tidak tersedia dalam dokumen".`,
            prompt,
          );
          totalInputTokens += subResponse.input_tokens;
          totalOutputTokens += subResponse.output_tokens;
          subQueryResults.push({
            subQuestion: prompt.slice(0, 200),
            answer: subResponse.content,
            tokensUsed: subResponse.input_tokens + subResponse.output_tokens,
            depth: currentDepth,
          });
          return subResponse.content;
        },
        // load_document callback
        async (id: number) => {
          console.log(`[RLM] 📂 Loading document id=${id}`);
          const content = await loadDocumentFn(id);
          const normalized = this.normalizeDocument(content);
          if (!selectedDocumentIds.includes(id)) {
            selectedDocumentIds.push(id);
          }
          repl.loadDocument(normalized);
          console.log(`[RLM] ✅ Document ${id} loaded & normalized: ${normalized.length} chars`);
          return normalized;
        },
      );

      console.log('[RLM] 📤 execResult.finalAnswer:', execResult.finalAnswer?.slice(0, 200));
      console.log('[RLM] 📤 execResult.error:', execResult.error);

      if (execResult.finalAnswer) {
        console.log('\n[RLM] 🏁 FINAL() called inside code → selesai');
        return {
          answer: execResult.finalAnswer,
          references, subQueryResults, totalInputTokens,
          totalOutputTokens, totalIterations,
          depth: currentDepth, execLog: this.replSandbox.getExecLog(),
          selectedDocumentIds,
        };
      }

      const observation = this.buildObservation(execResult);
      console.log(`[RLM] 👁️  Observation: "${observation.slice(0, 200)}..."`);
      conversationHistory.push({ role: 'user', content: `Observation:\n${observation}` });
    }

    // Fallback
    console.log('\n[RLM] ⚠️  Max iterasi tercapai');
    const fallback = await this.buildFallbackAnswer(userQuestion, subQueryResults, repl);
    totalInputTokens += fallback.inputTokens;
    totalOutputTokens += fallback.outputTokens;

    return {
      answer: fallback.answer,
      references, subQueryResults, totalInputTokens,
      totalOutputTokens, totalIterations,
      depth: currentDepth, execLog: this.replSandbox.getExecLog(),
      selectedDocumentIds,
    };
  }

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

  private buildObservation(execResult: {
    output: string; error: string; success: boolean;
    llmQueryCalls: string[]; loadedDocumentIds: number[];
  }): string {
    let obs = '';
    if (execResult.loadedDocumentIds.length > 0) {
      obs += `Dokumen berhasil diload: id=[${execResult.loadedDocumentIds.join(', ')}]. Context sekarang tersedia.\n\n`;
    }
    if (execResult.output) {
      const truncated = execResult.output.length > 2000
        ? execResult.output.slice(0, 2000) + '\n... [output dipotong]'
        : execResult.output;
      obs += `Output:\n${truncated}`;
    }
    if (execResult.error) {
      obs += `\n\nError:\n${execResult.error}`;
    }
    if (execResult.llmQueryCalls.length > 0) {
      obs += `\n\n${execResult.llmQueryCalls.length} llm_query() telah dieksekusi.`;
    }
    if (!obs) {
      obs = 'Code berhasil dieksekusi tanpa output. Lanjutkan atau panggil FINAL().';
    }
    return obs;
  }

  private buildSystemPrompt(allDocuments: DocumentMeta[]): string {
  const docList = allDocuments
    .map(d => `  - id:${d.id} | "${d.title}" | ${d.file_size} bytes`)
    .join('\n');

  return `Kamu adalah asisten cerdas untuk menjawab pertanyaan tentang
Standar Operasional Prosedur (SOP).

=== DOKUMEN TERSEDIA ===
${docList}
========================

=== CARA KERJA ===
1. Pilih dokumen yang relevan dengan pertanyaan
2. Load dokumen dengan load_document(id)
3. Cari informasi di dokumen dengan keyword/regex
4. Analisis dengan llm_query()
5. Berikan jawaban dengan FINAL()

=== FUNGSI TERSEDIA ===
- \`load_document(id)\`     → load dokumen ke context (WAJIB dipanggil dulu)
- \`context\`               → isi dokumen setelah load_document() dipanggil
- \`document_list\`         → array metadata semua dokumen
- \`print(...)\`            → tampilkan output
- \`llm_query(prompt)\`     → analisis semantik dengan Sub-LM
- \`re.search(pat, text)\`  → regex search
- \`re.findall(pat, text)\` → regex findall
- \`getContextWindow(hits, lines, n)\` → ambil n baris sekitar hits
- \`FINAL(jawaban)\`        → berikan jawaban akhir
- \`FINAL_VAR(varName)\`    → return variabel sebagai jawaban

=== ATURAN PENCARIAN ===
- Setelah load_document(), cek jumlah baris: context.split('\\n').length
- Jika dokumen kecil (< 100 baris), kirim SELURUH context ke llm_query tanpa filter
- Gunakan multiple keyword saat filter, jangan hanya 1 kata
- Jika hits < 5 baris, kirim seluruh context langsung ke llm_query
- JANGAN kirim prompt kosong ke llm_query — pastikan selalu ada teks dokumen

=== CONTOH LENGKAP ===
\`\`\`repl
// Step 1: Load dokumen yang relevan
load_document(4)

// Step 2: Cek ukuran dokumen
const lines = context.split('\\n')
const keywords = ['medical', 'offering', 'lulus', 'orientasi', 'percobaan', 'karyawan']

// Step 3: Filter dengan multiple keyword
const hits = lines.filter(l =>
  keywords.some(kw => l.toLowerCase().includes(kw))
)

// Step 4: Jika dokumen kecil atau hits sedikit, pakai seluruh context
const text = (lines.length < 100 || hits.length < 5)
  ? context
  : hits.slice(0, 30).join('\\n')

// Step 5: Analisis dengan Sub-LM
const result = llm_query(\`
Berdasarkan SOP berikut, jawab pertanyaan ini dengan poin-poin terstruktur.
Gunakan bahasa Indonesia formal. Hanya jawab berdasarkan isi dokumen.

Dokumen SOP:
\${text}
\`)

print(result)
FINAL(result)
\`\`\`

=== ATURAN PENTING ===
- WAJIB panggil load_document() sebelum mengakses context
- SATU code block per respons
- WAJIB sertakan isi dokumen di dalam prompt llm_query — jangan kirim prompt kosong
- WAJIB panggil FINAL() setelah mendapat jawaban
- JANGAN jawab dari pengetahuan umum`;
}

  private trimHistory(history: ChatMessage[], maxMessages: number = 10): ChatMessage[] {
    if (history.length <= maxMessages) return history;
    const systemPrompt = history[0];
    const firstUser = history[1];
    const recent = history.slice(-(maxMessages - 2));
    console.log(`[RLM] ✂️  History trimmed: ${history.length} → ${recent.length + 2}`);
    return [systemPrompt, firstUser, ...recent];
  }

  private async buildFallbackAnswer(
    originalQuestion: string,
    subQueryResults: SubQueryItem[],
    repl: ReplEnvironment,
  ): Promise<{ answer: string; inputTokens: number; outputTokens: number }> {
    const keywords = originalQuestion.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const lines = repl.getDocument().split('\n');
    const hits = lines
      .filter(l => keywords.some(kw => l.toLowerCase().includes(kw)))
      .sort((a, b) => b.length - a.length)
      .slice(0, 10)
      .join('\n');

    const subAnswers = subQueryResults
      .map((r, i) => `Sub-query ${i + 1}: ${r.subQuestion}\nJawaban: ${r.answer}`)
      .join('\n\n---\n\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Kamu adalah asisten ahli SOP. Jawab berdasarkan informasi dari dokumen. Gunakan bahasa Indonesia yang formal.`,
      },
      {
        role: 'user',
        content: `Pertanyaan: "${originalQuestion}"
${subAnswers ? `\nHasil analisis:\n${subAnswers}\n\n` : ''}Kutipan relevan:
${hits || 'Tidak ditemukan kutipan relevan'}

Susun jawaban lengkap berdasarkan informasi di atas.`,
      },
    ];

    const response = await this.llmApiClient.queryRootLM(messages);
    return { answer: response.content, inputTokens: response.input_tokens, outputTokens: response.output_tokens };
  }
}