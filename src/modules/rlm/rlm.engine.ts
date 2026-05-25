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
  rootCachedInputTokens: number;
  subInputTokens: number;
  subOutputTokens: number;
  subCachedInputTokens: number;
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

    let rootInputTokens = 0;
    let rootOutputTokens = 0;
    let rootCachedInputTokens = 0;
    let subInputTokens = 0;
    let subOutputTokens = 0;
    let subCachedInputTokens = 0;

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

      rootInputTokens += response.input_tokens;
      rootOutputTokens += response.output_tokens;
      rootCachedInputTokens += response.cached_input_tokens;

      console.log(`[RLM] 📨 GPT preview: "${response.content.slice(0, 200)}"`);

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
            answer,
            references,
            subQueryResults,
            rootInputTokens,
            rootOutputTokens,
            rootCachedInputTokens,
            subInputTokens,
            subOutputTokens,
            subCachedInputTokens,
            totalIterations,
            currentDepth,
            selectedDocumentIds,
          });
        }
      }

      if (!codeBlock && !finalMatch) {
        const plainAnswer = response.content.trim();
        if (plainAnswer.length > 200 && i > 0) {
          console.log('[RLM] 💡 Direct answer without FINAL()');
          return this.buildResult({
            answer: plainAnswer,
            references,
            subQueryResults,
            rootInputTokens,
            rootOutputTokens,
            rootCachedInputTokens,
            subInputTokens,
            subOutputTokens,
            subCachedInputTokens,
            totalIterations,
            currentDepth,
            selectedDocumentIds,
          });
        }

        console.log('[RLM] ⚠️  No code block, prompting REPL');
        conversationHistory.push({
          role: 'user',
          content:
            'Observation: No code block found. Write code in ```repl block, or call FINAL(answer) inside it.',
        });
        continue;
      }

      if (!codeBlock) {
        console.log('[RLM] ⚠️  No valid code block');
        conversationHistory.push({
          role: 'user',
          content:
            'Observation: No valid code block. Write code in ```repl block.',
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

          subInputTokens += subResponse.input_tokens;
          subOutputTokens += subResponse.output_tokens;
          subCachedInputTokens += subResponse.cached_input_tokens;

          subQueryResults.push({
            subQuestion: prompt.slice(0, 200),
            answer: subResponse.content,
            tokensUsed: subResponse.input_tokens + subResponse.output_tokens,
            depth: currentDepth,
          });
          return subResponse.content;
        },
        async (id: number) => {
          console.log(`[RLM] 📂 Loading document id=${id}`);
          const content = await loadDocumentFn(id);
          const normalized = this.normalizeDocument(content);
          if (!selectedDocumentIds.includes(id)) {
            selectedDocumentIds.push(id);
          }
          repl.loadDocument(normalized);
          console.log(`[RLM] ✅ Loaded id=${id}: ${normalized.length} chars`);
          return normalized;
        },
      );

      console.log(
        '[RLM] 📤 finalAnswer:',
        execResult.finalAnswer?.slice(0, 200),
      );
      console.log('[RLM] 📤 error:', execResult.error);

      if (execResult.finalAnswer) {
        const answer = execResult.finalAnswer.trim();
        if (answer.includes('__LLM_PLACEHOLDER')) {
          console.log('[RLM] ⚠️  FINAL() contains placeholder, continuing...');
          conversationHistory.push({
            role: 'user',
            content:
              'Observation: FINAL() contains an unresolved placeholder. Make sure llm_query() is awaited and assigned to a variable before FINAL().',
          });
          continue;
        }

        console.log('\n[RLM] 🏁 FINAL() called → done');
        return this.buildResult({
          answer,
          references,
          subQueryResults,
          rootInputTokens,
          rootOutputTokens,
          rootCachedInputTokens,
          subInputTokens,
          subOutputTokens,
          subCachedInputTokens,
          totalIterations,
          currentDepth,
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
    const fallback = await this.buildFallbackAnswer(
      userQuestion,
      subQueryResults,
      repl,
    );

    rootInputTokens += fallback.inputTokens;
    rootOutputTokens += fallback.outputTokens;
    rootCachedInputTokens += fallback.cachedInputTokens;

    return this.buildResult({
      answer: fallback.answer,
      references,
      subQueryResults,
      rootInputTokens,
      rootOutputTokens,
      rootCachedInputTokens,
      subInputTokens,
      subOutputTokens,
      subCachedInputTokens,
      totalIterations,
      currentDepth,
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
    rootCachedInputTokens: number;
    subInputTokens: number;
    subOutputTokens: number;
    subCachedInputTokens: number;
    totalIterations: number;
    currentDepth: number;
    selectedDocumentIds: number[];
  }): RLMResult {
    const totalInputTokens = params.rootInputTokens + params.subInputTokens;
    const totalOutputTokens = params.rootOutputTokens + params.subOutputTokens;
    const totalCached =
      params.rootCachedInputTokens + params.subCachedInputTokens;
    const cacheHitPct =
      totalInputTokens > 0
        ? ((totalCached / totalInputTokens) * 100).toFixed(1)
        : '0.0';

    console.log(
      `[RLM] 📊 Tokens → Root: in=${params.rootInputTokens} (cached: ${params.rootCachedInputTokens}) out=${params.rootOutputTokens} | Sub: in=${params.subInputTokens} (cached: ${params.subCachedInputTokens}) out=${params.subOutputTokens} | Cache hit: ${cacheHitPct}%`,
    );

    return {
      answer: params.answer,
      references: params.references,
      subQueryResults: params.subQueryResults,
      totalInputTokens,
      totalOutputTokens,
      rootInputTokens: params.rootInputTokens,
      rootOutputTokens: params.rootOutputTokens,
      rootCachedInputTokens: params.rootCachedInputTokens,
      subInputTokens: params.subInputTokens,
      subOutputTokens: params.subOutputTokens,
      subCachedInputTokens: params.subCachedInputTokens,
      totalIterations: params.totalIterations,
      depth: params.currentDepth,
      execLog: this.replSandbox.getExecLog(),
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
      obs += `Documents loaded: id=[${execResult.loadedDocumentIds.join(', ')}]. The variable \`context\` now holds the structured document content.\n`;
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
  // SYSTEM PROMPT — Ringkas, sesuai format dokumen terstruktur
  // ══════════════════════════════════════════════════════

  private buildSystemPrompt(allDocuments: DocumentMeta[]): string {
    const docList = allDocuments
      .map((d) => `  - id:${d.id} | "${d.title}"`)
      .join('\n');

    return `You answer questions about SOP documents stored in a structured tag-based text format. Each document uses tags [DOC], [META], [SEC], [STEP], and [INFO]. Each block has fields like actor, action, time, cond, form, note.

=== AVAILABLE DOCUMENTS ===
${docList}

=== ABSOLUTE RULES ===
- NEVER answer from prior knowledge. The document is the ONLY source.
- ALWAYS start with \`\`\`repl block + load_document(id). No exceptions.
- One \`\`\`repl block per response. Always finish with FINAL(answer).
- Reply in the SAME language as the user's question.

- FINAL(answer) must contain NATURAL PROSE. Never include raw parsing tags or field names ([STEP], [INFO], [SEC], [META], id=, sec=, type=, actor=, action=, cond=, form=, note=, etc.).
- If sub-LM returns answers containing tags or field names, clean them into natural language before passing to FINAL().

=== TOOLS ===
- await load_document(id), context, await llm_query(prompt), print(...), FINAL(answer)

=== FILTERING STRATEGY ===

Step 1 — Classify question type from these signals:
  • TIME question → contains: "when", "how long", "what time", "duration", "deadline", "berapa lama", "kapan"
  • PROCEDURAL → contains: "how to", "steps", "process", "procedure", "who does", "responsible for"
  • DESCRIPTIVE → contains: "what is", "what are", "list", "key", "define", "describe"
  • SPECIFIC-VALUE → asking for a number/size/code (e.g. "optimum size", "doc number")
  • MULTI-AREA / COMPARISON → contains: "compare", "differences between", "across", or mentions 2+ specific topics/sections joined by "and", "vs", "between"

Step 2 — Detect target sections from question (CRITICAL for accuracy):
  Many documents are organized into named sections (chapters, departments, modules, etc.). When the question mentions specific section names that appear in the document's [SEC] titles or [META] fields, the snippet MUST prioritize content from those matching sections.

  How to detect:
  A. Extract proper nouns and named entities from the question (e.g., "Emergency", "Compliance", "Phase 2", "Module A").
  B. Match against [SEC] titles in the document by inspecting blocks like \`[SEC] id=X | title=Y\`.
  C. If a match exists, treat that section as the AUTHORITATIVE source for this question.

Step 3 — Build snippet with these tactics (combine as needed):
  A. SENTENCE-LEVEL EXTRACTION (for SPECIFIC-VALUE and TIME questions):
     Split context into sentences. Keep sentences containing question keywords + nearby context (±2 sentences).
  B. BLOCK FILTER BY KEYWORD:
     Split into blocks. Keep blocks where ANY question keyword appears.
  C. SECTION MATCH (CRITICAL for section-specific questions):
     If question mentions a [SEC] title or related entity, take ALL blocks where sec=<that title>, even if individual keywords don't match.
  D. ALL [INFO]+[META]:
     Last resort for descriptive questions when other tactics yield <100 chars.

Step 4 — For MULTI-AREA / COMPARISON questions:
  Build snippet that covers EVERY mentioned area/section. Each area must contribute its own blocks. Do NOT collapse to one area — that defeats comparison.
  Annotate snippet with section markers (e.g., "=== AREA 1 ===") so the sub-LM knows which content belongs to which area.

Step 5 — Hard size cap: snippet MUST be ≤ 40,000 chars before sending to llm_query.
  If snippet exceeds 40,000:
    • For TIME questions: keep only blocks containing time-pattern regex /\\d+\\s*(min|hour|hr|jam|menit|day|hari|am|pm|a\\.m|p\\.m)/i
    • For others: re-filter with stricter (longer) keywords from the question
  If still > 40,000 after re-filter, take first 40,000 chars but log a warning.

=== AVOID OVERVIEW/INTRODUCTION CONTENT FOR SPECIFIC OPERATIONAL QUESTIONS ===

Documents often have an overview, introduction, or preface section that contains GENERAL definitions and high-level context. For SPECIFIC operational questions (e.g., "who is responsible for X in section Y", "what is the procedure for Z"), this overview content is usually NOT the right answer.

Heuristics to identify overview/general content:
- [SEC] titles like "Introduction", "Overview", "Preface", "Pendahuluan", "Background"
- [INFO] blocks with type=other, type=purpose, or type=scope when they appear at the start of the document
- Blocks containing generic definitions ("X is defined as...", "The objective of X is...")

For specific operational questions, DEPRIORITIZE these blocks unless the question is itself a definition/scope question (e.g., "what is the definition of X").

=== EXAMPLE: TIME / SPECIFIC-VALUE QUESTION ===
\`\`\`repl
await load_document(46)
const blocks = context.split(/\\n(?=\\[)/).filter(b => b.trim())

const q = "PUT_USER_QUESTION_HERE".toLowerCase()
const stop = new Set(['what','who','when','where','how','why','is','are','the','a','an','of','in','for','to','and','or','do','does','should','typically','responsible','found','before','their','much','long','time','many','given'])
const kws = q.split(/\\W+/).filter(w => w.length > 3 && !stop.has(w))

// Detect target [SEC] from question by inspecting available section titles
const sectionTitles = []
const secRx = /\\[SEC\\][^\\n]*title=([^|\\n]+)/gi
let secMatch
while ((secMatch = secRx.exec(context)) !== null) {
  sectionTitles.push(secMatch[1].trim().toLowerCase())
}
const targetSections = sectionTitles.filter(t =>
  kws.some(k => t.includes(k)) || t.split(/\\s+/).some(w => q.includes(w.toLowerCase()))
)
print('Available sections:', sectionTitles.length, '| matched:', targetSections)

const isTimeQ = /\\b(when|how long|time|duration|long|deadline|kapan|berapa lama)\\b/i.test(q)

// Filter blocks by keyword
let candidates = blocks.filter(b => kws.some(k => b.toLowerCase().includes(k)))

// CRITICAL: If target section detected, also include all blocks from that section
if (targetSections.length > 0) {
  const secBlocks = blocks.filter(b => {
    const lower = b.toLowerCase()
    return targetSections.some(t => lower.includes('sec=' + t) || lower.includes('title=' + t))
  })
  const seen = new Set(candidates)
  for (const b of secBlocks) if (!seen.has(b)) { candidates.push(b); seen.add(b) }
}

// DEPRIORITIZE overview/introduction blocks for specific operational questions
const overviewRx = /sec=(introduction|overview|preface|pendahuluan|background)|type=(purpose|scope|other)/i
const isDefinitionQ = /\\b(definition|define|what is|apa itu)\\b/i.test(q)
if (!isDefinitionQ && candidates.length >= 3) {
  const filtered = candidates.filter(b => !overviewRx.test(b.split('\\n')[0] || ''))
  if (filtered.length > 0) candidates = filtered
}

if (candidates.length === 0) candidates = blocks  // fallback to all

// For time questions, prioritize blocks containing time patterns
if (isTimeQ) {
  const timeRx = /\\d+\\s*(min|hour|hr|jam|menit|day|hari|am|pm|a\\.m|p\\.m|second)/i
  const withTime = candidates.filter(b => timeRx.test(b))
  if (withTime.length > 0) candidates = withTime
}

let snippet = candidates.join('\\n\\n')
print('Candidates:', candidates.length, '| length:', snippet.length)

// Hard cap at 40K
if (snippet.length > 40000) {
  const stricter = candidates.filter(b => {
    const lower = b.toLowerCase()
    return kws.filter(k => lower.includes(k)).length >= 2
  })
  if (stricter.length > 0 && stricter.join('\n\n').length < snippet.length) {
    snippet = stricter.join('\n\n')
    print('Stricter applied:', snippet.length)
  }
  if (snippet.length > 40000) {
    snippet = snippet.slice(0, 40000)
    print('Hard cap to 40000')
  }
}

const result = await llm_query(\`
Answer the user's question using ONLY the document excerpt below.
Quote exact role names, IDs, durations, form names, and times verbatim.
For time/value questions, find the EXACT figure in the excerpt — do not approximate.
If you cannot find the answer, say "Not specified in the document".

Document excerpt:
\${snippet}

Question: PUT_USER_QUESTION_HERE
\`)
FINAL(result)
\`\`\`

=== EXAMPLE: MULTI-AREA / COMPARISON QUESTION ===
For questions comparing multiple areas/sections, build snippet covering ALL mentioned areas:
\`\`\`repl
await load_document(46)
const blocks = context.split(/\\n(?=\\[)/).filter(b => b.trim())
const q = "PUT_USER_QUESTION_HERE".toLowerCase()

// Extract section titles from document
const sectionTitles = []
const secRx = /\\[SEC\\][^\\n]*title=([^|\\n]+)/gi
let m
while ((m = secRx.exec(context)) !== null) sectionTitles.push(m[1].trim())

// Identify which sections the question refers to
const mentionedSections = sectionTitles.filter(t => {
  const lower = t.toLowerCase()
  return q.includes(lower) || lower.split(/\\s+/).some(w => w.length > 3 && q.includes(w.toLowerCase()))
})
print('Sections mentioned in Q:', mentionedSections)

// Build snippet section-by-section, with clear markers
let snippet = ''
for (const sec of mentionedSections) {
  const secLower = sec.toLowerCase()
  const secBlocks = blocks.filter(b => b.toLowerCase().includes('sec=' + secLower) || b.toLowerCase().includes('title=' + secLower)).slice(0, 15)
  if (secBlocks.length > 0) {
    snippet += '\\n\\n=== ' + sec.toUpperCase() + ' ===\\n' + secBlocks.join('\\n\\n')
  }
}

// Fallback: if no sections matched, use keyword-based filter
if (snippet.length < 200) {
  const stop = new Set(['what','who','when','where','how','why','is','are','the','a','an','of','in','for','to','and','or','do','does','should','compare','vs','versus','difference','between','across'])
  const kws = q.split(/\\W+/).filter(w => w.length > 3 && !stop.has(w))
  snippet = blocks.filter(b => kws.some(k => b.toLowerCase().includes(k))).join('\\n\\n')
}

if (snippet.length > 40000) snippet = snippet.slice(0, 40000)
print('Multi-area snippet length:', snippet.length)

const result = await llm_query(\`
Compare/explain across the areas mentioned in the question. For EACH area in the excerpt below (separated by === markers ===), extract specific information. Do NOT skip any area — even if information is limited, state what is available.

Document excerpt:
\${snippet}

Question: PUT_USER_QUESTION_HERE
\`)
FINAL(result)
\`\`\`

=== EXAMPLE: DESCRIPTIVE QUESTION ===
Same skeleton as TIME, but skip the time-pattern step and add fallback:
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

SOURCE PRIORITIZATION (CRITICAL):
When the same topic is discussed in multiple places, prioritize sources in this order:
1. SPECIFIC operational sections (e.g., chapter dedicated to the topic the question asks about)
2. Detailed [STEP] entries with actor and action fields
3. Topic-specific [INFO] blocks
4. General overview/introduction content (LOWEST priority — usually not the answer for specific operational questions)

For numeric/value questions, your answer MUST follow this format:
1. Quote the FULL sentence containing the value (verbatim, copy-paste).
2. Then state the extracted value.

Example:
Quote: "Target pencapaian minimal delapan puluh lima persen."
Value: 85%

Heuristic: If the question asks about a specific role, procedure, or value within a named section, look for [STEP] or [INFO] blocks where sec=<that section>. A general statement in an Introduction/Overview that mentions the same keyword is rarely the right answer.


CONCEPT DISAMBIGUATION (CRITICAL):
Documents often contain similar but DISTINCT concepts that share keywords. Before answering:
1. Identify the EXACT concept the question asks about (read the question carefully — note prepositions like "to another", "from", "between").
2. Distinguish between superficially similar terms by their CONTEXT in the document.
3. If the snippet contains multiple matching concepts, pick the one whose surrounding context most closely matches the question's intent.

Example pattern: A question about "transferring to another organization" should NOT be confused with "referring to another department within the same organization" — these are distinct concepts even if both contain the word "transfer" or "refer".

SECTION FOCUS (CRITICAL):
If the question explicitly names a section, department, or topic area, restrict your answer to content from THAT section. Do not pull general statements from overview/introduction sections or unrelated chapters, even if they superficially mention the keyword.

COMPLETENESS:
- For procedural questions: list EVERY relevant [STEP] in order. Include actor, action, time, condition.
- For descriptive questions: extract the exact information from [INFO] paragraphs.
- For multi-area/comparison questions: you MUST cover EVERY area mentioned. Do not skip any. If one area has limited info in the snippet, state it briefly but still attempt to extract what is available — do NOT default to "not specified" when there is ANY relevant content.

FORMAT NORMALIZATION:
- If you encounter table extraction artifacts (e.g., duplicated numbers from multi-column rows like "3 2 Time/day"), present the meaningful value clearly (e.g., "2 Times/day" with explanation if uncertain).
- Standardize obvious format inconsistencies (e.g., "11-00 a.m." → "11:00 AM", "2Min" → "2 minutes") while preserving original wording in quotes if needed.
- For quantity/measurement answers, INCLUDE the substance/subject name when present (e.g., "Substance X — 20 mg/day" not just "20 mg/day").

FORMAT:
- Reply in the SAME language as the user's question.
- Use Markdown: **bold** for key terms, numbered lists for steps, bullets for items.

ACCURACY:
- Quote names, IDs, durations, and form names EXACTLY as written (after format normalization).
- Only say "the document does not specify" as a LAST RESORT, after thoroughly searching every block. Be EXTREMELY reluctant to give this answer — if there is even partial information, present it.
- Do NOT invent content not in the snippet.

OUTPUT RULES (CRITICAL):
- The document uses internal parsing tags (e.g. [STEP], [INFO], [SEC], [META], id=, sec=, type=, and field names like actor, action, time, cond, form, note). These are STRUCTURAL MARKUP for the system, NOT content for the user.
- NEVER show tags, field names, or IDs in your answer. The user must not see "[STEP]", "id=5.4.3", "actor:", "field 'note'", "sec=...", etc.
- NEVER cite block IDs (e.g. "5.4.3", "6.3.1", "section 2.1.4").
- Convert tag content into natural prose. Example: a block with "actor: <Role>" and "action: <Task>" becomes "<Role> performs <task>".
- It IS acceptable to mention real document identifiers that exist within the content itself (document numbers, form codes, regulation references, etc.) — these are part of the document, not parsing markup.
- Write as if you are summarizing from the original source document, not from a parsed data structure.

`;
  }

  // ══════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════

  private normalizeDocument(content: string): string {
    // Dokumen sudah terstruktur dari tahap ekstraksi. Hanya perlu pembersihan minimal.
    return content.replace(/\n{3,}/g, '\n\n').trim();
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
    const firstUser = history[1];
    const recent = history.slice(-(maxMessages - 2));
    console.log(
      `[RLM] ✂️  History trimmed: ${history.length} → ${recent.length + 2}`,
    );
    return [systemPrompt, firstUser, ...recent];
  }

  private async buildFallbackAnswer(
    originalQuestion: string,
    subQueryResults: SubQueryItem[],
    repl: ReplEnvironment,
  ): Promise<{
    answer: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  }> {
    const keywords = originalQuestion
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const lines = repl.getDocument().split('\n');
    const hits = lines
      .filter((l) => keywords.some((kw) => l.toLowerCase().includes(kw)))
      .sort((a, b) => b.length - a.length)
      .slice(0, 20)
      .join('\n');

    const validSubAnswers = subQueryResults
      .filter(
        (r) =>
          !r.answer.includes('Tidak tersedia') &&
          !r.answer.includes('not available'),
      )
      .map(
        (r, i) => `Sub-query ${i + 1}: ${r.subQuestion}\nAnswer: ${r.answer}`,
      )
      .join('\n\n---\n\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a friendly assistant. Answer the user's question based on the document excerpt provided.
Reply in the SAME language as the user's question. Use Markdown.
Keep IDs, role names, and exact values as written. Do not invent.

CRITICAL: Prioritize specific section content over general overview/introduction statements. If the question mentions a specific topic or section, focus on that section's content.`,
      },
      {
        role: 'user',
        content: `Question: "${originalQuestion}"
${validSubAnswers ? `\nPrevious analysis:\n${validSubAnswers}\n\n` : ''}
Document excerpt:
${hits || 'No relevant excerpt found.'}

Answer based on the excerpt above.`,
      },
    ];

    const response = await this.llmApiClient.queryRootLM(messages);
    return {
      answer: response.content,
      inputTokens: response.input_tokens,
      outputTokens: response.output_tokens,
      cachedInputTokens: response.cached_input_tokens,
    };
  }
}
