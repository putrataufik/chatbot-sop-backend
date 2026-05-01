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

    let rootInputTokens  = 0;
    let rootOutputTokens = 0;
    let subInputTokens   = 0;
    let subOutputTokens  = 0;

    let totalIterations = 0;
    let currentDepth = 1;

    const conversationHistory: ChatMessage[] = [
      { role: 'system', content: this.buildSystemPrompt(allDocuments) },
      ...chatHistory,
      { role: 'user', content: userQuestion },
    ];

    // ── MAIN LOOP ───────────────────────────────────────
    for (let i = 0; i < this.maxIterations; i++) {
      totalIterations++;
      console.log(`\n[RLM] ── ITERATION ${i + 1}/${this.maxIterations} ──`);

      const trimmedHistory = this.trimHistory(conversationHistory);
      const response = await this.llmApiClient.queryRootLM(trimmedHistory);

      rootInputTokens  += response.input_tokens;
      rootOutputTokens += response.output_tokens;

      console.log(`[RLM] 📨 GPT preview: "${response.content.slice(0, 200)}"`);

      conversationHistory.push({ role: 'assistant', content: response.content });

      const codeBlock = this.extractCodeBlock(response.content);
      const finalMatch = response.content.match(
        /FINAL\(([^)]*(?:\([^)]*\)[^)]*)*)\)/s,
      );

      if (finalMatch && !codeBlock) {
        const answer = finalMatch[1].trim();
        if (answer && !answer.includes('__LLM_PLACEHOLDER') && answer.length > 5) {
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
          console.log('[RLM] 💡 Direct answer without FINAL()');
          return this.buildResult({
            answer: plainAnswer, references, subQueryResults,
            rootInputTokens, rootOutputTokens,
            subInputTokens, subOutputTokens,
            totalIterations, currentDepth,
            selectedDocumentIds,
          });
        }

        console.log('[RLM] ⚠️  No code block, prompting REPL');
        conversationHistory.push({
          role: 'user',
          content: 'Observation: No code block found. Write code in ```repl block, or call FINAL(answer) inside it.',
        });
        continue;
      }

      if (!codeBlock) {
        console.log('[RLM] ⚠️  No valid code block');
        conversationHistory.push({
          role: 'user',
          content: 'Observation: No valid code block. Write code in ```repl block.',
        });
        continue;
      }

      // ── Execute in sandbox ──
      const execResult = await this.replSandbox.execute(
        codeBlock,
        async (prompt: string) => {
          currentDepth++;
          console.log(`[RLM] 🔬 Sub-LM (depth=${currentDepth})`);
          const subResponse = await this.llmApiClient.querySubLM(
            this.buildSubLMSystemPrompt(),
            prompt,
          );

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
        async (id: number) => {
          console.log(`[RLM] 📂 Loading document id=${id}`);
          const content    = await loadDocumentFn(id);
          const normalized = this.normalizeDocument(content);
          if (!selectedDocumentIds.includes(id)) {
            selectedDocumentIds.push(id);
          }
          repl.loadDocument(normalized);
          console.log(`[RLM] ✅ Loaded id=${id}: ${normalized.length} chars`);
          return normalized;
        },
      );

      console.log('[RLM] 📤 finalAnswer:', execResult.finalAnswer?.slice(0, 200));
      console.log('[RLM] 📤 error:', execResult.error);

      if (execResult.finalAnswer) {
        const answer = execResult.finalAnswer.trim();
        if (answer.includes('__LLM_PLACEHOLDER')) {
          console.log('[RLM] ⚠️  FINAL() contains placeholder, continuing...');
          conversationHistory.push({
            role: 'user',
            content: 'Observation: FINAL() contains an unresolved placeholder. Make sure llm_query() is awaited and assigned to a variable before FINAL().',
          });
          continue;
        }

        console.log('\n[RLM] 🏁 FINAL() called → done');
        return this.buildResult({
          answer, references, subQueryResults,
          rootInputTokens, rootOutputTokens,
          subInputTokens, subOutputTokens,
          totalIterations, currentDepth,
          selectedDocumentIds,
        });
      }

      const observation = this.buildObservation(execResult);
      console.log(`[RLM] 👁️  Observation: "${observation.slice(0, 200)}..."`);
      conversationHistory.push({
        role: 'user',
        content: `Observation:\n${observation}`,
      });
    }

    // ── Fallback ──
    console.log('\n[RLM] ⚠️  Max iterations reached');
    const fallback = await this.buildFallbackAnswer(userQuestion, subQueryResults, repl);

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

  // ══════════════════════════════════════════════════════
  // RESULT BUILDER
  // ══════════════════════════════════════════════════════

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
      `[RLM] 📊 Tokens → Root: in=${params.rootInputTokens} out=${params.rootOutputTokens} | Sub: in=${params.subInputTokens} out=${params.subOutputTokens}`,
    );

    return {
      answer:              params.answer,
      references:          params.references,
      subQueryResults:     params.subQueryResults,
      totalInputTokens,
      totalOutputTokens,
      rootInputTokens:     params.rootInputTokens,
      rootOutputTokens:    params.rootOutputTokens,
      subInputTokens:      params.subInputTokens,
      subOutputTokens:     params.subOutputTokens,
      totalIterations:     params.totalIterations,
      depth:               params.currentDepth,
      execLog:             this.replSandbox.getExecLog(),
      selectedDocumentIds: params.selectedDocumentIds,
    };
  }

  // ══════════════════════════════════════════════════════
  // OBSERVATION BUILDER
  // ══════════════════════════════════════════════════════

  private buildObservation(execResult: {
    output: string;
    error: string;
    success: boolean;
    llmQueryCalls: string[];
    loadedDocumentIds: number[];
  }): string {
    let obs = '';

    if (execResult.loadedDocumentIds.length > 0) {
      obs += `Documents loaded: id=[${execResult.loadedDocumentIds.join(', ')}]. The variable \`context\` now holds the RRF content.\n`;
      obs += `IMPORTANT: In the next iteration, \`context\` already has the document. Do NOT call load_document() again.\n\n`;
    }

    if (execResult.output) {
      const truncated =
        execResult.output.length > 3000
          ? execResult.output.slice(0, 3000) + '\n... [output truncated]'
          : execResult.output;
      obs += `Output:\n${truncated}`;
    }

    if (execResult.error) {
      obs += `\n\nError:\n${execResult.error}`;
    }

    if (execResult.llmQueryCalls.length > 0) {
      obs += `\n\n${execResult.llmQueryCalls.length} llm_query() executed. Results are available.`;
    }

    if (!obs.trim()) {
      obs = 'Code executed with no output. Continue, or call FINAL(answer).';
    }

    return obs;
  }

  // ══════════════════════════════════════════════════════
  // SYSTEM PROMPT — Ringkas & RRF-aware
  // ══════════════════════════════════════════════════════

  private buildSystemPrompt(allDocuments: DocumentMeta[]): string {
  const docList = allDocuments
    .map((d) => `  - id:${d.id} | "${d.title}"`)
    .join('\n');

  return `You answer questions about SOP documents stored in RRF format with tags [DOC], [META], [SEC], [STEP], [INFO]. Each block has fields like actor, action, time, cond, form, note.

=== AVAILABLE DOCUMENTS ===
${docList}

=== ABSOLUTE RULES ===
- NEVER answer from prior knowledge. The document is the ONLY source.
- ALWAYS start with \`\`\`repl block + load_document(id). No exceptions.
- One \`\`\`repl block per response. Always finish with FINAL(answer).
- Reply in the SAME language as the user's question.

=== TOOLS ===
- await load_document(id), context, await llm_query(prompt), print(...), FINAL(answer)

=== FILTERING STRATEGY ===

Step 1 — Classify question type from these signals:
  • TIME question → contains: "when", "how long", "what time", "duration", "deadline", "berapa lama", "kapan"
  • PROCEDURAL → contains: "how to", "steps", "process", "procedure", "who does", "responsible for"
  • DESCRIPTIVE → contains: "what is", "what are", "list", "key", "define", "describe"
  • SPECIFIC-VALUE → asking for a number/size/code (e.g. "optimum size", "doc number")

Step 2 — Build snippet with these tactics (combine as needed):
  A. SENTENCE-LEVEL EXTRACTION (use for SPECIFIC-VALUE and TIME questions):
     Split context into sentences. Keep sentences containing question keywords + nearby context (±2 sentences).
  B. BLOCK FILTER BY KEYWORD:
     Split into blocks. Keep blocks where ANY question keyword appears.
  C. SECTION MATCH:
     If a [SEC] title contains a question noun, take that [SEC] + all blocks where sec=<title>.
  D. ALL [INFO]+[META]:
     Last resort for descriptive questions when other tactics yield <100 chars.

Step 3 — Hard size cap: snippet MUST be ≤ 15,000 chars before sending to llm_query.
  If snippet exceeds 15,000:
    • For TIME questions: keep only blocks containing time-pattern regex /\\d+\\s*(min|hour|hr|jam|menit|day|hari|am|pm|a\\.m|p\\.m)/i
    • For others: re-filter with stricter (longer) keywords from the question
  If still > 15,000 after re-filter, take first 15,000 chars but log a warning.

=== EXAMPLE: TIME / SPECIFIC-VALUE QUESTION ===
\`\`\`repl
await load_document(46)
const blocks = context.split(/\\n(?=\\[)/).filter(b => b.trim())

const q = "PUT_USER_QUESTION_HERE".toLowerCase()
const stop = new Set(['what','who','when','where','how','why','is','are','the','a','an','of','in','for','to','and','or','do','does','should','typically','responsible','found','before','their','much','long','time','many','given'])
const kws = q.split(/\\W+/).filter(w => w.length > 3 && !stop.has(w))

// Tactic A: sentence-level for time/specific-value
const isTimeQ = /\\b(when|how long|time|duration|long|deadline|kapan|berapa lama)\\b/i.test(q)

// First filter blocks by keyword
let candidates = blocks.filter(b => kws.some(k => b.toLowerCase().includes(k)))
if (candidates.length === 0) candidates = blocks  // fallback to all

// For time questions, prioritize blocks containing time patterns
if (isTimeQ) {
  const timeRx = /\\d+\\s*(min|hour|hr|jam|menit|day|hari|am|pm|a\\.m|p\\.m|second)/i
  const withTime = candidates.filter(b => timeRx.test(b))
  if (withTime.length > 0) candidates = withTime
}

let snippet = candidates.join('\\n\\n')
print('Candidates:', candidates.length, '| length:', snippet.length)

// Hard cap at 15K
if (snippet.length > 15000) {
  // Stricter: blocks containing AT LEAST 2 keywords
  const stricter = candidates.filter(b => {
    const lower = b.toLowerCase()
    return kws.filter(k => lower.includes(k)).length >= 2
  })
  if (stricter.length > 0 && stricter.join('\\n\\n').length < snippet.length) {
    snippet = stricter.join('\\n\\n')
    print('Stricter applied:', snippet.length)
  }
  if (snippet.length > 15000) {
    snippet = snippet.slice(0, 15000)
    print('Hard cap to 15000')
  }
}

const result = await llm_query(\`
Answer the user's question using ONLY the SOP excerpt below.
Quote exact role names, step IDs, durations, form names, and times verbatim.
For time/value questions, find the EXACT figure in the excerpt — do not approximate.
If you cannot find the answer, say "Not specified in the document".

SOP excerpt:
\${snippet}

Question: PUT_USER_QUESTION_HERE
\`)
FINAL(result)
\`\`\`

=== EXAMPLE: DESCRIPTIVE QUESTION ===
Same skeleton, but skip the time-pattern step and add fallback:
\`if (snippet.length < 100) snippet = blocks.filter(b => b.startsWith('[INFO]') || b.startsWith('[META]')).join('\\n\\n')\``;
}

  // ══════════════════════════════════════════════════════
  // SUB-LM SYSTEM PROMPT — singkat
  // ══════════════════════════════════════════════════════

  private buildSubLMSystemPrompt(): string {
  return `You are an assistant answering questions about a document. Use ONLY the snippet provided in the user prompt.

READING METHOD (CRITICAL):
- Read EVERY block in the snippet carefully, including narrative paragraphs inside [INFO] blocks.
- The answer may be a single sentence buried in a paragraph. Look for it directly — do not assume it must be in a structured list.
- If the question asks "what are X" or "list X", and the snippet contains a sentence like "X are A, B, C, and D", that IS the answer. Extract it.

COMPLETENESS:
- For procedural questions: list EVERY relevant [STEP] in order. Include actor, action, time, condition.
- For descriptive questions: extract the exact information from [INFO] paragraphs.

FORMAT:
- Reply in the SAME language as the user's question.
- Use Markdown: **bold** for key terms, numbered lists for steps, bullets for items.

ACCURACY:
- Quote names, IDs, durations, and form names EXACTLY as written.
- Only say "the document does not specify" if you have read EVERY block and the information truly is not there. Be very reluctant to give this answer.
- Do NOT invent content not in the snippet.`;
}

  // ══════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════

  private normalizeDocument(content: string): string {
    // RRF is already structured. Only do minimal cleanup.
    return content.replace(/\n{3,}/g, '\n\n').trim();
  }

  private extractCodeBlock(content: string): string | null {
    const match = content.match(/```repl\n?([\s\S]*?)```/);
    if (match) return match[1].trim();
    const jsMatch = content.match(/```(?:javascript|js)\n?([\s\S]*?)```/);
    if (jsMatch) return jsMatch[1].trim();
    return null;
  }

  private trimHistory(history: ChatMessage[], maxMessages: number = 10): ChatMessage[] {
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
      .filter((r) => !r.answer.includes('Tidak tersedia') && !r.answer.includes('not available'))
      .map((r, i) => `Sub-query ${i + 1}: ${r.subQuestion}\nAnswer: ${r.answer}`)
      .join('\n\n---\n\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a friendly HR assistant. Answer the user's question based on the SOP excerpt provided.
Reply in the SAME language as the user's question. Use Markdown.
Keep step IDs and role names exactly as written. Do not invent.`,
      },
      {
        role: 'user',
        content: `Question: "${originalQuestion}"
${validSubAnswers ? `\nPrevious analysis:\n${validSubAnswers}\n\n` : ''}
SOP excerpt:
${hits || 'No relevant excerpt found.'}

Answer based on the excerpt above.`,
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