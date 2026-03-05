// FILE: src/modules/rlm/rlm.engine.ts

import { Injectable } from '@nestjs/common';
import { LlmApiClient, ChatMessage } from './llm-api.client';
import { ReplEnvironment } from './repl.environment';

export interface RLMResult {
  answer: string;
  references: string[];
  subQueryResults: SubQueryItem[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalIterations: number;
  depth: number;
  execLog: string[];
}

export interface SubQueryItem {
  subQuestion: string;
  answer: string;
  tokensUsed: number;
  depth: number;
}

interface RLMAction {
  action: string;
  param?: any;
  key?: string;
  value?: any;
}

@Injectable()
export class RlmEngine {
  private readonly maxIterations = 10;
  private readonly chunkSize = 3000;

  constructor(private llmApiClient: LlmApiClient) {}

  // ── Entry Point ────────────────────────────────────────

  async process(
    userQuestion: string,
    repl: ReplEnvironment,
  ): Promise<RLMResult> {
    console.log('\n════════════════════════════════════════════════');
    console.log('[RLM] 🚀 START PROCESSING');
    console.log(`[RLM] ❓ Question: "${userQuestion}"`);
    console.log(`[RLM] 📄 Document stats:`, repl.getStats());
    console.log('════════════════════════════════════════════════\n');

    const subQueryResults: SubQueryItem[] = [];
    const references: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalIterations = 0;
    let currentDepth = 1;

    const conversationHistory: ChatMessage[] = [
      {
        role: 'system',
        content: this.buildSystemPrompt(repl),
      },
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
      totalInputTokens += response.input_tokens;
      totalOutputTokens += response.output_tokens;

      const action = this.parseAction(response.content);
      console.log(`[RLM] 🎯 Action detected: "${action.action}"`);

      conversationHistory.push({
        role: 'assistant',
        content: response.content,
      });

      // ── CEK FINAL() ─────────────────────────────────
      if (action.action === 'Final') {
        console.log('\n[RLM] 🏁 Final() called → jawaban siap');
        console.log(
          `[RLM] 📝 Answer preview: "${String(action.param).slice(0, 150)}..."`,
        );

        const allIntermediates = repl.getAllIntermediates();
        for (const key of Object.keys(allIntermediates)) {
          if (key.startsWith('ref_')) {
            references.push(allIntermediates[key]);
          }
        }

        console.log(`\n[RLM] ✅ SELESAI`);
        console.log(`[RLM] 📊 Total iterasi   : ${totalIterations}`);
        console.log(`[RLM] 📊 Total sub-query  : ${subQueryResults.length}`);
        console.log(`[RLM] 📊 Input tokens     : ${totalInputTokens}`);
        console.log(`[RLM] 📊 Output tokens    : ${totalOutputTokens}`);
        console.log('════════════════════════════════════════════════\n');

        return {
          answer: String(action.param),
          references,
          subQueryResults,
          totalInputTokens,
          totalOutputTokens,
          totalIterations,
          depth: currentDepth,
          execLog: repl.getExecLog(),
        };
      }

      // ── EKSEKUSI ACTION DI REPL ──────────────────────
      let observation = '';

      if (action.action === 'find_snippets') {
        const keyword = action.param;
        console.log(
          `[RLM] 🔍 Executing find_snippets(${JSON.stringify(keyword)})`,
        );
        const snippets = repl.findSnippets(keyword);

        if (snippets.length > 0) {
          // Ambil 5 hasil terpanjang (paling informatif)
          const topSnippets = [...snippets]
            .sort((a, b) => b.length - a.length)
            .slice(0, 5);

          observation =
            `Ditemukan ${snippets.length} baris. ` +
            `Menampilkan 5 paling relevan:\n\n` +
            topSnippets.map((s, idx) => `[${idx + 1}] ${s.trim()}`).join('\n\n');
        } else {
          observation = `Tidak ditemukan hasil untuk keyword ${JSON.stringify(keyword)}`;
        }

      } else if (action.action === 'split_context') {
        const size = Number(action.param) || this.chunkSize;
        console.log(`[RLM] ✂️  Executing split_context(${size})`);
        const chunks = repl.splitContext(size);
        observation =
          `Dokumen dipotong menjadi ${chunks.length} bagian.\n` +
          `Bagian pertama:\n${chunks[0]?.slice(0, 500) ?? ''}`;

      } else if (action.action === 'llm_query') {
        const subQuestion = String(action.param);
        console.log(`[RLM] 🔬 Executing llm_query("${subQuestion}")`);
        currentDepth++;

        const relevantContext = this.findRelevantContext(subQuestion, repl);
        const contextText =
          relevantContext.length > 0
            ? relevantContext.join('\n\n')
            : 'Tidak ada konteks spesifik tersedia';

        const subResponse = await this.llmApiClient.querySubLM(
          `Kamu adalah asisten ahli SOP.
Jawab pertanyaan HANYA berdasarkan konteks dokumen berikut.
Jika tidak ada informasi relevan, katakan "Informasi tidak tersedia dalam dokumen SOP".

Konteks dokumen:
${contextText}`,
          subQuestion,
        );

        totalInputTokens += subResponse.input_tokens;
        totalOutputTokens += subResponse.output_tokens;

        const subQueryItem: SubQueryItem = {
          subQuestion,
          answer: subResponse.content,
          tokensUsed: subResponse.input_tokens + subResponse.output_tokens,
          depth: currentDepth,
        };
        subQueryResults.push(subQueryItem);
        repl.storeIntermediate(
          `subquery_${subQueryResults.length}`,
          subQueryItem,
        );

        observation =
          `Hasil Sub-LM untuk "${subQuestion}":\n${subResponse.content}`;

      } else if (action.action === 'store') {
        const key = String(action.key ?? 'unknown');
        const value = action.value ?? action.param;
        console.log(`[RLM] 💾 Executing store("${key}")`);
        repl.storeIntermediate(key, value);
        observation = `Nilai berhasil disimpan dengan key "${key}"`;

      } else if (action.action === 'print') {
        const message = String(action.param);
        console.log(`[RLM] 🖨️  print: "${message}"`);
        repl.log(`print: ${message}`);
        observation = `Printed: ${message}`;

      } else if (action.action === 'continue') {
        console.log(`[RLM] 🔄 Continue action → lanjut iterasi`);
        observation = 'Lanjutkan proses pencarian dan analisis informasi';

      } else {
        console.log(`[RLM] ⚠️  Unknown action: "${action.action}"`);
        observation = `Action "${action.action}" tidak dikenali. Gunakan: find_snippets, split_context, llm_query, store, print, atau Final`;
      }

      console.log(`[RLM] 👁️  Observation: "${observation.slice(0, 150)}..."`);

      // Ringkas observation agar tidak membengkakkan history
      const observationForHistory =
        observation.length > 2000
          ? observation.slice(0, 2000) + '... [dipotong]'
          : observation;

      conversationHistory.push({
        role: 'user',
        content: `Observation:\n${observationForHistory}`,
      });
    }

    // ── ITERASI HABIS, GPT TIDAK PANGGIL Final() ──────
    console.log('\n[RLM] ⚠️  Max iterasi tercapai tanpa Final()');
    console.log('[RLM] 🔄 Menyusun jawaban dari informasi yang ada...');

    const fallbackAnswer = await this.buildFallbackAnswer(
      userQuestion,
      subQueryResults,
      repl,
    );
    totalInputTokens += fallbackAnswer.inputTokens;
    totalOutputTokens += fallbackAnswer.outputTokens;

    return {
      answer: fallbackAnswer.answer,
      references,
      subQueryResults,
      totalInputTokens,
      totalOutputTokens,
      totalIterations,
      depth: currentDepth,
      execLog: repl.getExecLog(),
    };
  }

  // ── System Prompt ──────────────────────────────────────

  private buildSystemPrompt(repl: ReplEnvironment): string {
    const stats = repl.getStats();
    const previewChunk = repl.getChunk(0, 300);

    return `Kamu adalah asisten cerdas untuk menjawab pertanyaan tentang 
Standar Operasional Prosedur (SOP).

Kamu memiliki akses ke dokumen SOP yang tersimpan dalam REPL Environment.

=== METADATA DOKUMEN ===
- Panjang dokumen : ${stats.documentLength} karakter
- Total chunks    : ${stats.totalChunks} bagian
- Preview awal    :
${previewChunk}
========================

Kamu bisa menggunakan helper functions berikut dengan menulis JSON action:

1. find_snippets(keyword) → cari baris yang mengandung keyword
   // Single keyword:
   {"action": "find_snippets", "param": "penyusunan SOP"}
   
   // Multi keyword sekaligus (lebih efisien):
   {"action": "find_snippets", "param": ["pengembangan", "integrasi", "tahapan"]}

2. split_context(size) → potong dokumen menjadi bagian kecil
   {"action": "split_context", "param": 2000}

3. llm_query(pertanyaan) → panggil Sub-LM untuk menjawab sub-pertanyaan spesifik
   {"action": "llm_query", "param": "sub pertanyaan spesifik"}

4. store(key, value) → simpan hasil intermediate
   {"action": "store", "key": "nama_variabel", "value": "nilai"}

5. print(pesan) → log pesan untuk debugging
   {"action": "print", "param": "pesan yang ingin dicetak"}

6. Final(jawaban) → berikan jawaban akhir ke user (WAJIB dipanggil di akhir)
   {"action": "Final", "param": "jawaban lengkap dalam bahasa Indonesia"}

=== ATURAN SANGAT PENTING ===
- HANYA tulis SATU JSON action per respons, tidak boleh lebih
- DILARANG menulis beberapa action sekaligus
- Setelah menulis action, BERHENTI dan tunggu observation
- Jangan tulis teks apapun selain satu JSON
- WAJIB gunakan informasi dari Observation untuk menjawab
- JANGAN menjawab dari pengetahuan umum jika data ada di dokumen
- Jika Observation berisi data relevan, gunakan langsung untuk Final()
- DILARANG mengabaikan Observation yang sudah berisi informasi
- WAJIB gunakan llm_query minimal 1x sebelum Final() untuk pertanyaan kompleks
- Setelah 2-3 kali find_snippets, gunakan llm_query untuk memproses informasi
- Jika informasi sudah cukup setelah llm_query, SEGERA panggil Final()

=== ALUR YANG BENAR ===
1. find_snippets → cari informasi relevan dari dokumen
2. llm_query    → proses dan analisis informasi yang ditemukan
3. Final()      → susun jawaban akhir dari hasil llm_query

CONTOH YANG BENAR:
Langkah 1: {"action": "find_snippets", "param": ["keyword1", "keyword2"]}
Langkah 2: {"action": "llm_query", "param": "jelaskan detail tentang X berdasarkan dokumen"}
Langkah 3: {"action": "Final", "param": "jawaban lengkap..."}

CONTOH YANG SALAH (jangan lakukan ini):
{"action": "find_snippets", "param": "keyword1"}
{"action": "find_snippets", "param": "keyword2"}
{"action": "Final", "param": "jawaban dari pengetahuan umum tanpa menggunakan dokumen"}`;
  }

  // ── Parse Action dari Response GPT ────────────────────

  private parseAction(content: string): RLMAction {
    const jsonMatches = content.match(/\{[^{}]*\}/g);

    if (jsonMatches && jsonMatches.length > 0) {
      try {
        const parsed = JSON.parse(jsonMatches[0]);
        if (parsed.action) {
          if (
            parsed.action === 'Final' &&
            (!parsed.param || String(parsed.param).trim() === '')
          ) {
            console.log('[RLM] ⚠️  Final() dengan konten kosong, diabaikan');
            return {
              action: 'continue',
              param: 'Lanjutkan pencarian informasi',
            };
          }

          console.log(`[RLM] ✅ Parsed action: ${JSON.stringify(parsed)}`);
          return parsed as RLMAction;
        }
      } catch {
        console.log('[RLM] ⚠️  Failed to parse first JSON');
      }
    }

    console.log('[RLM] ⚠️  No valid action found, using Final fallback');
    return { action: 'Final', param: content };
  }

  // ── Cari Konteks Relevan ───────────────────────────────

  private findRelevantContext(
    subQuestion: string,
    repl: ReplEnvironment,
  ): string[] {
    const keywords = this.extractKeywords(subQuestion);
    const relevantSnippets: string[] = [];

    for (const keyword of keywords) {
      const snippets = repl.findSnippets(keyword);
      relevantSnippets.push(...snippets);
    }

    const unique = [...new Set(relevantSnippets)];
    const limited: string[] = [];
    let totalLength = 0;

    for (const snippet of unique) {
      if (totalLength + snippet.length > this.chunkSize) break;
      limited.push(snippet);
      totalLength += snippet.length;
    }

    return limited;
  }

  // ── Fallback Answer ────────────────────────────────────

  private async buildFallbackAnswer(
  originalQuestion: string,
  subQueryResults: SubQueryItem[],
  repl: ReplEnvironment,  // ← tambah parameter
): Promise<{ answer: string; inputTokens: number; outputTokens: number }> {

  // Cari konteks relevan langsung dari dokumen
  const keywords = this.extractKeywords(originalQuestion);
  const relevantSnippets: string[] = [];

  for (const keyword of keywords) {
    const snippets = repl.findSnippets(keyword);
    relevantSnippets.push(...snippets);
  }

  const unique = [...new Set(relevantSnippets)];
  const topSnippets = [...unique]
    .sort((a, b) => b.length - a.length)
    .slice(0, 10)
    .join('\n\n');

  const subAnswers =
    subQueryResults.length > 0
      ? subQueryResults
          .map(
            (r, i) =>
              `Sub-pertanyaan ${i + 1}: ${r.subQuestion}\nJawaban: ${r.answer}`,
          )
          .join('\n\n---\n\n')
      : '';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Kamu adalah asisten ahli SOP.
Jawab pertanyaan berdasarkan informasi dari dokumen yang tersedia.
Gunakan bahasa Indonesia yang formal dan terstruktur.
PRIORITAS: gunakan data dari dokumen, bukan pengetahuan umum.`,
    },
    {
      role: 'user',
      content: `Pertanyaan: "${originalQuestion}"

${subAnswers ? `Hasil sub-query:\n${subAnswers}\n\n` : ''}Kutipan relevan dari dokumen:
${topSnippets || 'Tidak ditemukan kutipan relevan'}

Susun jawaban lengkap berdasarkan informasi di atas.`,
    },
  ];

  const response = await this.llmApiClient.queryRootLM(messages);
  return {
    answer: response.content,
    inputTokens: response.input_tokens,
    outputTokens: response.output_tokens,
  };
}

  // ── Trim History ───────────────────────────────────────

  private trimHistory(
    history: ChatMessage[],
    maxMessages: number = 6,
  ): ChatMessage[] {
    if (history.length <= maxMessages) return history;

    const systemPrompt = history[0];
    const firstUserMessage = history[1];
    const recent = history.slice(-(maxMessages - 2));

    console.log(
      `[RLM] ✂️  History trimmed: ${history.length} → ${recent.length + 2} messages`,
    );

    return [systemPrompt, firstUserMessage, ...recent];
  }

  // ── Extract Keywords ───────────────────────────────────

  private extractKeywords(question: string): string[] {
    const stopWords = [
      'apa', 'bagaimana', 'siapa', 'kapan', 'dimana', 'mengapa',
      'yang', 'dan', 'atau', 'ini', 'itu', 'ada', 'tidak', 'dengan',
      'untuk', 'dari', 'ke', 'di', 'pada', 'adalah', 'dalam', 'cara',
      'prosedur', 'sop', 'tolong', 'jelaskan', 'sebutkan',
    ];

    const words = question
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 3)
      .filter((word) => !stopWords.includes(word));

    return [...new Set(words)].slice(0, 5);
  }
}