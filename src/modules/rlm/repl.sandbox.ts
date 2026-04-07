// FILE: src/modules/rlm/repl.sandbox.ts
//
// RLM Sandbox v3 — Single-pass async execution
//
// v2 punya 3-pass: collect→resolve→re-execute → context hilang, FINAL capture placeholder
// v3: wrap kode user dalam async IIFE → load_document() dan llm_query() langsung await
// Tidak ada placeholder, tidak ada re-execution, tidak ada context yang hilang.

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
  private documentMetadata: Array<{ id: number; title: string; file_size: number }> = [];
  private loadedDocContents: Map<number, string> = new Map();

  initSession(
    documentMetadata: Array<{ id: number; title: string; file_size: number }>,
  ): void {
    this.contextDocument = '';
    this.printBuffer = [];
    this.llmQueryCalls = [];
    this.execLog = [];
    this.persistentVars = {};
    this.documentMetadata = documentMetadata;
    this.loadedDocContents = new Map();
    console.log('[SANDBOX] Session initialized');
  }

  async execute(
    code: string,
    llmQueryCallback: (prompt: string) => Promise<string>,
    loadDocumentCallback: (id: number) => Promise<string>,
  ): Promise<SandboxExecutionResult> {
    console.log('\n[SANDBOX] Executing code:');
    console.log(code.slice(0, 500) + (code.length > 500 ? '...' : ''));

    this.printBuffer = [];
    this.llmQueryCalls = [];
    let executionError = '';
    const loadedDocIds: number[] = [];
    const MAX_PROMPT = 100000;

    // Shared mutable state — semua data yang perlu di-share antara
    // sandbox code dan caller menggunakan object reference (bukan let variable)
    // karena vm.createContext bisa punya closure scope yang berbeda.
    const shared: {
      context: string;
      finalAnswer: string | undefined;
      finalVar: string | undefined;
    } = {
      context: this.contextDocument,
      finalAnswer: undefined,
      finalVar: undefined,
    };

    const sandboxVars: Record<string, any> = {
      get context() { return shared.context; },
      set context(v: string) { shared.context = v; },

      document_list: this.documentMetadata,

      print: (...args: any[]) => {
        const o = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
        this.printBuffer.push(o);
        console.log(`[SANDBOX] print: ${o.slice(0, 300)}`);
      },

      console: { log: (...args: any[]) => { this.printBuffer.push(args.map(String).join(' ')); } },

      load_document: async (id: number): Promise<string> => {
        console.log(`[SANDBOX] load_document(${id})`);
        loadedDocIds.push(id);
        let content: string;
        if (this.loadedDocContents.has(id)) {
          content = this.loadedDocContents.get(id)!;
        } else {
          content = await loadDocumentCallback(id);
          this.loadedDocContents.set(id, content);
        }
        shared.context = [...this.loadedDocContents.values()].join('\n\n---\n\n');
        this.contextDocument = shared.context;
        console.log(`[SANDBOX] Context updated: ${shared.context.length} chars`);
        return content;
      },

      llm_query: async (prompt: string): Promise<string> => {
        const p = prompt.length > MAX_PROMPT ? prompt.slice(0, MAX_PROMPT) + '\n...[truncated]' : prompt;
        this.llmQueryCalls.push(p);
        console.log(`[SANDBOX] llm_query: ${p.length} chars`);
        const result = await llmQueryCallback(p);
        console.log(`[SANDBOX] llm_query result: "${result.slice(0, 150)}..."`);
        return result;
      },

      FINAL: (answer: any) => {
        shared.finalAnswer = String(answer);
        console.log(`[SANDBOX] FINAL: "${String(answer).slice(0, 150)}..."`);
      },

      FINAL_VAR: (varName: string) => {
        shared.finalVar = varName;
        console.log(`[SANDBOX] FINAL_VAR("${varName}")`);
      },

      len: (obj: any): number => {
        if (typeof obj === 'string') return obj.length;
        if (Array.isArray(obj)) return obj.length;
        if (obj && typeof obj === 'object') return Object.keys(obj).length;
        return 0;
      },
      range: (s: number, e?: number, st: number = 1): number[] => {
        if (e === undefined) { e = s; s = 0; }
        const r: number[] = []; for (let i = s; i < e; i += st) r.push(i); return r;
      },
      enumerate: (a: any[]): [number, any][] => a.map((item, i) => [i, item]),
      re: {
        findall: (p: string, t: string, f = 'g'): string[] => t.match(new RegExp(p, f)) || [],
        search: (p: string, t: string, f = 'i'): boolean => new RegExp(p, f).test(t),
        split: (p: string, t: string): string[] => t.split(new RegExp(p)),
        IGNORECASE: 'i',
      },
      json: {
        dumps: (o: any): string => JSON.stringify(o, null, 2),
        loads: (s: string): any => JSON.parse(s),
      },
      getContextWindow: (hits: Array<{i:number;l:string}>, lines: string[], w = 3): string[] => {
        const r: string[] = [];
        for (const h of hits) {
          const s = Math.max(0, h.i - w), e = Math.min(lines.length - 1, h.i + w);
          for (let j = s; j <= e; j++) r.push(lines[j]);
        }
        return [...new Set(r)];
      },

      ...this.persistentVars,
    };

    // ── Single-pass: wrap dalam async IIFE ──
    // Semua await (load_document, llm_query) langsung di-resolve.
    // Tidak ada placeholder. Tidak ada re-execution.
    const wrappedCode = `(async () => {\n${code}\n})()`;

    try {
      const ctx = vm.createContext(sandboxVars);
      const promise = vm.runInContext(wrappedCode, ctx, { timeout: 60000 });
      await promise;

      // Save persistent vars
      const builtins = new Set([
        'document_list','print','len','range','enumerate','re','json',
        'getContextWindow','llm_query','load_document','FINAL','FINAL_VAR','console','context',
      ]);
      for (const key of Object.keys(ctx as object)) {
        if (!builtins.has(key) && !key.startsWith('__')) {
          this.persistentVars[key] = (ctx as any)[key];
        }
      }

      // Resolve FINAL_VAR
      if (shared.finalVar && !shared.finalAnswer) {
        const v = (ctx as any)[shared.finalVar];
        if (v !== undefined) shared.finalAnswer = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      }

      this.execLog.push('[SANDBOX] ✅ Code executed successfully');
    } catch (e: any) {
      executionError = e.message ?? 'Unknown error';
      console.log(`[SANDBOX] ❌ Error: ${executionError}`);
      this.execLog.push(`[SANDBOX] ❌ Error: ${executionError}`);

      // PENTING: meskipun ada error, FINAL() mungkin sudah dipanggil
      // sebelum error terjadi. Jangan buang finalAnswer.
    }

    console.log(`[SANDBOX] Result: finalAnswer=${shared.finalAnswer?.slice(0, 100)}, error=${executionError}`);

    return {
      output: this.printBuffer.join('\n'),
      error: executionError,
      success: !executionError,
      finalAnswer: shared.finalAnswer,
      finalVar: shared.finalVar,
      llmQueryCalls: this.llmQueryCalls,
      loadedDocumentIds: loadedDocIds,
    };
  }

  getExecLog(): string[] { return this.execLog; }
  getPrintBuffer(): string[] { return this.printBuffer; }
}