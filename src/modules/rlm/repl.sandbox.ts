// FILE: src/modules/rlm/repl.sandbox.ts

import { Injectable } from '@nestjs/common';
import * as vm from 'vm';

export interface SandboxExecutionResult {
  output: string;
  error: string;
  success: boolean;
  finalAnswer?: string;
  finalVar?: string;
  llmQueryCalls: string[];
  loadedDocumentIds: number[];
}

@Injectable()
export class ReplSandbox {
  private contextDocument: string = '';
  private printBuffer: string[] = [];
  private llmQueryCalls: string[] = [];
  private execLog: string[] = [];
  private persistentVars: Record<string, any> = {};
  private documentMetadata: Array<{
    id: number;
    title: string;
    file_size: number;
  }> = [];

  initSession(
    documentMetadata: Array<{ id: number; title: string; file_size: number }>,
  ): void {
    this.contextDocument = '';
    this.printBuffer = [];
    this.llmQueryCalls = [];
    this.execLog = [];
    this.persistentVars = {};
    this.documentMetadata = documentMetadata;

    console.log('[SANDBOX] 🟢 Session initialized');
    console.log(`[SANDBOX] 📋 Available documents: ${documentMetadata.length}`);
  }

  async execute(
    code: string,
    llmQueryCallback: (prompt: string) => Promise<string>,
    loadDocumentCallback: (id: number) => Promise<string>,
  ): Promise<SandboxExecutionResult> {
    console.log('\n[SANDBOX] ⚡ Executing code:');
    console.log('─'.repeat(50));
    console.log(code.slice(0, 300) + (code.length > 300 ? '...' : ''));
    console.log('─'.repeat(50));

    this.printBuffer = [];
    this.llmQueryCalls = [];
    let finalAnswer: string | undefined;
    let finalVar: string | undefined;
    let executionError = '';

    const MAX_PROMPT_CHARS = 100000;

    // ── Helper: getContextWindow ─────────────────────
    const getContextWindow = (
      hits: Array<{ i: number; l: string }>,
      lines: string[],
      window: number = 3,
    ): string[] => {
      const result: string[] = [];
      for (const hit of hits) {
        const start = Math.max(0, hit.i - window);
        const end = Math.min(lines.length - 1, hit.i + window);
        for (let j = start; j <= end; j++) result.push(lines[j]);
      }
      return [...new Set(result)];
    };

    // ── Bangun base sandbox vars ─────────────────────
    // contextValue dipass sebagai parameter agar bisa di-inject di setiap pass
    const buildBaseSandboxVars = (
      llmQueryFn: (prompt: string) => string,
      loadDocumentFn: (id: number) => string,
      contextValue: string = '', // ← inject context per pass
    ): Record<string, any> => ({
      context: contextValue, // ← langsung value, bukan getter

      document_list: this.documentMetadata,

      print: (...args: any[]) => {
        const output = args
          .map((a) =>
            typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a),
          )
          .join(' ');
        this.printBuffer.push(output);
        console.log(`[SANDBOX] 🖨️  ${output.slice(0, 300)}`);
      },

      len: (obj: any): number => {
        if (typeof obj === 'string') return obj.length;
        if (Array.isArray(obj)) return obj.length;
        if (obj && typeof obj === 'object') return Object.keys(obj).length;
        return 0;
      },

      range: (start: number, end?: number, step: number = 1): number[] => {
        if (end === undefined) {
          end = start;
          start = 0;
        }
        const result: number[] = [];
        for (let i = start; i < end; i += step) result.push(i);
        return result;
      },

      enumerate: (arr: any[]): [number, any][] =>
        arr.map((item, idx) => [idx, item]),

      re: {
        findall: (pattern: string, text: string, flags = 'g'): string[] =>
          text.match(new RegExp(pattern, flags)) || [],
        search: (pattern: string, text: string, flags = 'i'): boolean =>
          new RegExp(pattern, flags).test(text),
        split: (pattern: string, text: string): string[] =>
          text.split(new RegExp(pattern)),
        IGNORECASE: 'i',
      },

      json: {
        dumps: (obj: any): string => JSON.stringify(obj, null, 2),
        loads: (str: string): any => JSON.parse(str),
      },

      getContextWindow,
      llm_query: llmQueryFn,
      load_document: loadDocumentFn,

      FINAL: (answer: string) => {
        finalAnswer = answer;
        console.log(
          `[SANDBOX] 🏁 FINAL() called: "${String(answer).slice(0, 150)}..."`,
        );
      },

      FINAL_VAR: (varName: string) => {
        finalVar = varName;
        console.log(`[SANDBOX] 🏁 FINAL_VAR("${varName}") called`);
      },

      console: {
        log: (...args: any[]) => {
          const output = args.map((a) => String(a)).join(' ');
          this.printBuffer.push(output);
          console.log(`[SANDBOX] 🖨️  ${output.slice(0, 300)}`);
        },
      },

      ...this.persistentVars,
    });

    // ════════════════════════════════════════════════
    // PASS 1: Collect load_document calls
    // (context kosong, llm_query prompt belum valid)
    // ════════════════════════════════════════════════
    const collectedDocLoads: number[] = [];

    const pass1Vars = buildBaseSandboxVars(
      (prompt: string) => {
        // Di pass 1 kita hanya peduli load_document, llm_query diabaikan
        return `__LLM_PLACEHOLDER__`;
      },
      (id: number) => {
        console.log(`[SANDBOX] 📂 load_document(${id}) collected`);
        collectedDocLoads.push(id);
        return `__DOC_PLACEHOLDER_${id}__`;
      },
      '', // context kosong
    );

    try {
      const ctx1 = vm.createContext(pass1Vars);
      vm.runInContext(code, ctx1, { timeout: 10000 });
    } catch (e: any) {
      console.log(`[SANDBOX] ℹ️  Pass 1 note: ${e.message?.slice(0, 100)}`);
    }

    // ════════════════════════════════════════════════
    // Resolve load_document calls → isi _context
    // ════════════════════════════════════════════════
    const resolvedDocs: Map<number, string> = new Map();
    let _context = '';

    if (collectedDocLoads.length > 0) {
      console.log(
        `\n[SANDBOX] 📂 Resolving ${collectedDocLoads.length} load_document call(s)...`,
      );
      for (const docId of collectedDocLoads) {
        if (!resolvedDocs.has(docId)) {
          const content = await loadDocumentCallback(docId);
          resolvedDocs.set(docId, content);
          console.log(
            `[SANDBOX] ✅ Document ${docId} loaded: ${content.length} chars`,
          );
        }
      }
      const allContents = [...resolvedDocs.values()];
      _context = allContents.join('\n\n---\n\n');
      console.log(`[SANDBOX] 📄 Context updated: ${_context.length} chars`);
    }

    // ════════════════════════════════════════════════
    // PASS 1b: Re-collect llm_query dengan context sudah terisi
    // ════════════════════════════════════════════════
    const collectedQueries: string[] = [];

    console.log('\n[SANDBOX] 🔄 Re-collecting llm_query with loaded context...');

    const pass1bVars = buildBaseSandboxVars(
      (prompt: string) => {
        const idx = collectedQueries.length;
        console.log(
          `[SANDBOX] 🔬 llm_query[${idx}] re-collected, length: ${prompt.length}`,
        );
        console.log(
          prompt.slice(0, 500) + (prompt.length > 500 ? '\n...[preview]' : ''),
        );
        const truncated =
          prompt.length > MAX_PROMPT_CHARS
            ? prompt.slice(0, MAX_PROMPT_CHARS) + '\n...[dipotong]'
            : prompt;
        collectedQueries.push(truncated);
        return `__LLM_PLACEHOLDER_${idx}__`;
      },
      (id: number) => {
        // load_document di pass 1b return konten yang sudah resolved
        return resolvedDocs.get(id) ?? '';
      },
      _context, // ← context sudah terisi
    );

    try {
      const ctx1b = vm.createContext(pass1bVars);
      vm.runInContext(code, ctx1b, { timeout: 10000 });
    } catch (e: any) {
      console.log(`[SANDBOX] ℹ️  Pass 1b note: ${e.message?.slice(0, 100)}`);
    }

    // ════════════════════════════════════════════════
    // Resolve llm_query calls dengan prompt yang benar
    // ════════════════════════════════════════════════
    const resolvedResults: Map<number, string> = new Map();

    if (collectedQueries.length > 0) {
      console.log(
        `\n[SANDBOX] 🔬 Resolving ${collectedQueries.length} llm_query call(s)...`,
      );
      for (let i = 0; i < collectedQueries.length; i++) {
        const result = await llmQueryCallback(collectedQueries[i]);
        resolvedResults.set(i, result);
        console.log(
          `[SANDBOX] ✅ llm_query[${i}] resolved: "${result.slice(0, 150)}..."`,
        );
      }
    }

    // ════════════════════════════════════════════════
    // PASS 2: Real run dengan semua hasil resolved
    // ════════════════════════════════════════════════
    this.printBuffer = [];
    finalAnswer = undefined;
    finalVar = undefined;
    this.llmQueryCalls = [];

    let callIndex2 = 0;
    let lastLlmResult = '';

    const pass2Vars = buildBaseSandboxVars(
      (prompt: string) => {
        const idx = callIndex2++;
        this.llmQueryCalls.push(prompt);
        const result = resolvedResults.get(idx) ?? 'Hasil tidak tersedia';
        lastLlmResult = result;
        console.log(
          `[SANDBOX] 🔬 llm_query[${idx}] → "${result.slice(0, 100)}..."`,
        );
        return result;
      },
      (id: number) => {
        const content = resolvedDocs.get(id) ?? '';
        console.log(
          `[SANDBOX] 📂 load_document(${id}) → ${content.length} chars`,
        );
        return content;
      },
      _context, // ← inject context yang sudah terisi
    );

    Object.defineProperty(pass2Vars, '_', {
      get: () => lastLlmResult,
      enumerable: true,
      configurable: true,
    });

    try {
      const ctx2 = vm.createContext(pass2Vars);
      vm.runInContext(code, ctx2, { timeout: 15000 });

      this.savePersistentVars(ctx2);

      if (finalVar && !finalAnswer) {
        const varValue = (ctx2 as any)[finalVar];
        if (varValue !== undefined) {
          finalAnswer =
            typeof varValue === 'string'
              ? varValue
              : JSON.stringify(varValue, null, 2);
          console.log(
            `[SANDBOX] 📦 FINAL_VAR resolved: "${finalAnswer?.slice(0, 150)}..."`,
          );
        }
      }

      this.execLog.push(`[SANDBOX] ✅ Code executed successfully`);
    } catch (e: any) {
      executionError = e.message ?? 'Unknown error';
      console.log(`[SANDBOX] ❌ Execution error: ${executionError}`);
      this.execLog.push(`[SANDBOX] ❌ Error: ${executionError}`);
    }

    return {
      output: this.printBuffer.join('\n'),
      error: executionError,
      success: !executionError,
      finalAnswer,
      finalVar,
      llmQueryCalls: this.llmQueryCalls,
      loadedDocumentIds: collectedDocLoads,
    };
  }

  private savePersistentVars(ctx: vm.Context): void {
    const builtins = new Set([
      'context',
      'document_list',
      'print',
      'len',
      'range',
      'enumerate',
      're',
      'json',
      'getContextWindow',
      'llm_query',
      'load_document',
      'FINAL',
      'FINAL_VAR',
      'console',
      '_',
    ]);
    for (const key of Object.keys(ctx as object)) {
      if (!builtins.has(key) && !key.startsWith('__')) {
        this.persistentVars[key] = (ctx as any)[key];
      }
    }
    const keys = Object.keys(this.persistentVars);
    if (keys.length > 0) {
      console.log(`[SANDBOX] 💾 Persistent vars: ${keys.join(', ')}`);
    }
  }

  getExecLog(): string[] {
    return this.execLog;
  }

  getPrintBuffer(): string[] {
    return this.printBuffer;
  }
}