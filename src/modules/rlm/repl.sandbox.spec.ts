import { ReplSandbox, SandboxExecutionResult } from './repl.sandbox';

// ─── Helpers ─────────────────────────────────────────────────────────────

const sampleDocs = [
  { id: 1, title: 'SOP Rekrutmen', file_size: 5000 },
  { id: 2, title: 'SOP Pengadaan', file_size: 8000 },
];

const mockLlmQuery = jest.fn().mockResolvedValue('Sub-LM answer');
const mockLoadDocument = jest.fn().mockResolvedValue('Isi dokumen contoh.');

// ─── Tests ───────────────────────────────────────────────────────────────

describe('ReplSandbox', () => {
  let sandbox: ReplSandbox;

  beforeEach(() => {
    sandbox = new ReplSandbox();
    sandbox.initSession(sampleDocs);
    mockLlmQuery.mockClear();
    mockLoadDocument.mockClear();
    mockLlmQuery.mockResolvedValue('Sub-LM answer');
    mockLoadDocument.mockResolvedValue('Isi dokumen contoh.');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Session initialization
  // ═══════════════════════════════════════════════════════════════════════

  describe('initSession', () => {
    it('should reset all state on init', async () => {
      // Execute something first to populate state
      await sandbox.execute('print("hello")', mockLlmQuery, mockLoadDocument);

      // Re-init
      sandbox.initSession(sampleDocs);

      expect(sandbox.getExecLog()).toEqual([]);
      expect(sandbox.getPrintBuffer()).toEqual([]);
    });

    it('should store document metadata', async () => {
      const result = await sandbox.execute(
        'print(JSON.stringify(document_list))',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.output).toContain('SOP Rekrutmen');
      expect(result.output).toContain('SOP Pengadaan');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Basic code execution
  // ═══════════════════════════════════════════════════════════════════════

  describe('Basic execution', () => {
    it('should execute simple code and return success', async () => {
      const result = await sandbox.execute('let x = 1 + 1', mockLlmQuery, mockLoadDocument);

      expect(result.success).toBe(true);
      expect(result.error).toBe('');
    });

    it('should capture print output', async () => {
      const result = await sandbox.execute(
        'print("hello"); print("world")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.output).toBe('hello\nworld');
      expect(result.success).toBe(true);
    });

    it('should capture console.log output', async () => {
      const result = await sandbox.execute(
        'console.log("from console")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.output).toBe('from console');
    });

    it('should print objects as JSON', async () => {
      const result = await sandbox.execute(
        'print({ key: "value" })',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.output).toContain('"key"');
      expect(result.output).toContain('"value"');
    });

    it('should print multiple args joined by space', async () => {
      const result = await sandbox.execute(
        'print("a", "b", "c")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.output).toBe('a b c');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. FINAL()
  // ═══════════════════════════════════════════════════════════════════════

  describe('FINAL()', () => {
    it('should capture final answer from FINAL()', async () => {
      const result = await sandbox.execute(
        'FINAL("Jawaban akhir")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.finalAnswer).toBe('Jawaban akhir');
      expect(result.success).toBe(true);
    });

    it('should convert non-string to string', async () => {
      const result = await sandbox.execute(
        'FINAL(42)',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.finalAnswer).toBe('42');
    });

    it('should capture FINAL() even if error occurs after it', async () => {
      const result = await sandbox.execute(
        'FINAL("jawaban sebelum error"); throw new Error("boom")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.finalAnswer).toBe('jawaban sebelum error');
      expect(result.error).toContain('boom');
      expect(result.success).toBe(false);
    });

    it('should return undefined finalAnswer when FINAL() is not called', async () => {
      const result = await sandbox.execute(
        'print("no final")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.finalAnswer).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. FINAL_VAR()
  // ═══════════════════════════════════════════════════════════════════════

  describe('FINAL_VAR()', () => {
    it('should resolve variable name to its value as finalAnswer', async () => {
      const result = await sandbox.execute(
        'let myResult = "jawaban dari variabel"; FINAL_VAR("myResult")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.finalAnswer).toBe('jawaban dari variabel');
      expect(result.finalVar).toBe('myResult');
    });

    it('should JSON-stringify non-string variables', async () => {
      const result = await sandbox.execute(
        'let data = { key: "val" }; FINAL_VAR("data")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.finalAnswer).toContain('"key"');
      expect(result.finalAnswer).toContain('"val"');
    });

    it('should not override FINAL() if both are called', async () => {
      const result = await sandbox.execute(
        'let x = "from var"; FINAL("from final"); FINAL_VAR("x")',
        mockLlmQuery,
        mockLoadDocument,
      );

      // FINAL() takes precedence — FINAL_VAR only resolves if finalAnswer is not set
      expect(result.finalAnswer).toBe('from final');
    });

    it('should return undefined if variable does not exist', async () => {
      const result = await sandbox.execute(
        'FINAL_VAR("nonexistent")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.finalAnswer).toBeUndefined();
      expect(result.finalVar).toBe('nonexistent');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. load_document()
  // ═══════════════════════════════════════════════════════════════════════

  describe('load_document()', () => {
    it('should call loadDocumentCallback and update context', async () => {
      const result = await sandbox.execute(
        'await load_document(1); print(context.length)',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(mockLoadDocument).toHaveBeenCalledWith(1);
      expect(result.loadedDocumentIds).toContain(1);
      expect(result.success).toBe(true);
    });

    it('should make context available after loading', async () => {
      const result = await sandbox.execute(
        'await load_document(1); print(context)',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.output).toContain('Isi dokumen contoh.');
    });

    it('should cache documents and not call callback twice for same id', async () => {
      await sandbox.execute(
        'await load_document(1); await load_document(1)',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(mockLoadDocument).toHaveBeenCalledTimes(1);
    });

    it('should merge multiple documents in context', async () => {
      mockLoadDocument
        .mockResolvedValueOnce('Dokumen A')
        .mockResolvedValueOnce('Dokumen B');

      const result = await sandbox.execute(
        'await load_document(1); await load_document(2); print(context)',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.output).toContain('Dokumen A');
      expect(result.output).toContain('Dokumen B');
      expect(result.loadedDocumentIds).toEqual([1, 2]);
    });

    it('should return document content from load_document()', async () => {
      const result = await sandbox.execute(
        'const doc = await load_document(1); print(doc)',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.output).toBe('Isi dokumen contoh.');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. llm_query()
  // ═══════════════════════════════════════════════════════════════════════

  describe('llm_query()', () => {
    it('should call llmQueryCallback and return result', async () => {
      const result = await sandbox.execute(
        'const r = await llm_query("test prompt"); print(r)',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(mockLlmQuery).toHaveBeenCalledWith('test prompt');
      expect(result.output).toBe('Sub-LM answer');
      expect(result.llmQueryCalls).toHaveLength(1);
    });

    it('should truncate prompt exceeding 100k chars', async () => {
      const longPrompt = 'X'.repeat(150000);

      await sandbox.execute(
        `await llm_query("${longPrompt}")`,
        mockLlmQuery,
        mockLoadDocument,
      );

      const calledPrompt = mockLlmQuery.mock.calls[0][0];
      expect(calledPrompt.length).toBeLessThanOrEqual(100000 + 20); // +margin for truncation text
      expect(calledPrompt).toContain('[truncated]');
    });

    it('should track multiple llm_query calls', async () => {
      mockLlmQuery
        .mockResolvedValueOnce('answer 1')
        .mockResolvedValueOnce('answer 2');

      const result = await sandbox.execute(
        'await llm_query("q1"); await llm_query("q2")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.llmQueryCalls).toHaveLength(2);
      expect(mockLlmQuery).toHaveBeenCalledTimes(2);
    });

    it('should work with FINAL() using llm_query result', async () => {
      const result = await sandbox.execute(
        'const r = await llm_query("prompt"); FINAL(r)',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.finalAnswer).toBe('Sub-LM answer');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Error handling
  // ═══════════════════════════════════════════════════════════════════════

  describe('Error handling', () => {
    it('should capture runtime errors', async () => {
      const result = await sandbox.execute(
        'throw new Error("test error")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('test error');
    });

    it('should capture reference errors', async () => {
      const result = await sandbox.execute(
        'undefinedVariable.doSomething()',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should capture syntax errors', async () => {
      const result = await sandbox.execute(
        'if (true { }',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should still return output captured before error', async () => {
      const result = await sandbox.execute(
        'print("before"); throw new Error("fail")',
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.output).toBe('before');
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Utility functions
  // ═══════════════════════════════════════════════════════════════════════

  describe('Utility functions', () => {
    describe('len()', () => {
      it('should return string length', async () => {
        const result = await sandbox.execute('print(len("hello"))', mockLlmQuery, mockLoadDocument);
        expect(result.output).toBe('5');
      });

      it('should return array length', async () => {
        const result = await sandbox.execute('print(len([1,2,3]))', mockLlmQuery, mockLoadDocument);
        expect(result.output).toBe('3');
      });

      it('should return object key count', async () => {
        const result = await sandbox.execute('print(len({a:1,b:2}))', mockLlmQuery, mockLoadDocument);
        expect(result.output).toBe('2');
      });

      it('should return 0 for non-object', async () => {
        const result = await sandbox.execute('print(len(null))', mockLlmQuery, mockLoadDocument);
        expect(result.output).toBe('0');
      });
    });

    describe('range()', () => {
      it('should generate range with single arg', async () => {
        const result = await sandbox.execute('print(JSON.stringify(range(3)))', mockLlmQuery, mockLoadDocument);
        expect(result.output).toBe('[0,1,2]');
      });

      it('should generate range with start and end', async () => {
        const result = await sandbox.execute('print(JSON.stringify(range(2,5)))', mockLlmQuery, mockLoadDocument);
        expect(result.output).toBe('[2,3,4]');
      });

      it('should generate range with step', async () => {
        const result = await sandbox.execute('print(JSON.stringify(range(0,10,3)))', mockLlmQuery, mockLoadDocument);
        expect(result.output).toBe('[0,3,6,9]');
      });
    });

    describe('enumerate()', () => {
      it('should return index-value pairs', async () => {
        const result = await sandbox.execute(
          'print(JSON.stringify(enumerate(["a","b"])))',
          mockLlmQuery,
          mockLoadDocument,
        );
        expect(result.output).toBe('[[0,"a"],[1,"b"]]');
      });
    });

    describe('re (regex)', () => {
      it('should findall matches', async () => {
        const result = await sandbox.execute(
          'print(JSON.stringify(re.findall("\\\\d+", "abc123def456")))',
          mockLlmQuery,
          mockLoadDocument,
        );
        expect(result.output).toContain('123');
        expect(result.output).toContain('456');
      });

      it('should search and return boolean', async () => {
        const result = await sandbox.execute(
          'print(re.search("hello", "say hello world"))',
          mockLlmQuery,
          mockLoadDocument,
        );
        expect(result.output).toBe('true');
      });

      it('should return false for no match', async () => {
        const result = await sandbox.execute(
          'print(re.search("xyz", "hello world"))',
          mockLlmQuery,
          mockLoadDocument,
        );
        expect(result.output).toBe('false');
      });

      it('should split by regex', async () => {
        const result = await sandbox.execute(
          'print(JSON.stringify(re.split(",\\\\s*", "a, b, c")))',
          mockLlmQuery,
          mockLoadDocument,
        );
        expect(result.output).toBe('["a","b","c"]');
      });
    });

    describe('json', () => {
      it('should dumps object to JSON string', async () => {
        const result = await sandbox.execute(
          'print(json.dumps({a:1}))',
          mockLlmQuery,
          mockLoadDocument,
        );
        expect(result.output).toContain('"a": 1');
      });

      it('should loads JSON string to object', async () => {
        const result = await sandbox.execute(
          'const obj = json.loads(\'{"x":2}\'); print(obj.x)',
          mockLlmQuery,
          mockLoadDocument,
        );
        expect(result.output).toBe('2');
      });
    });

    describe('getContextWindow()', () => {
      it('should return surrounding lines for hits', async () => {
        const result = await sandbox.execute(
          `const lines = ["a","b","c","d","e","f","g"];
           const hits = [{i:3, l:"d"}];
           const w = getContextWindow(hits, lines, 1);
           print(JSON.stringify(w))`,
          mockLlmQuery,
          mockLoadDocument,
        );
        expect(result.output).toContain('"c"');
        expect(result.output).toContain('"d"');
        expect(result.output).toContain('"e"');
      });

      it('should deduplicate overlapping windows', async () => {
        const result = await sandbox.execute(
          `const lines = ["a","b","c","d","e"];
           const hits = [{i:1, l:"b"}, {i:2, l:"c"}];
           const w = getContextWindow(hits, lines, 1);
           print(JSON.stringify(w))`,
          mockLlmQuery,
          mockLoadDocument,
        );
        const parsed = JSON.parse(result.output);
        const unique = new Set(parsed);
        expect(parsed.length).toBe(unique.size);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Persistent variables
  // ═══════════════════════════════════════════════════════════════════════

  describe('Persistent variables', () => {
    it('should persist user-defined variables across executions', async () => {
      await sandbox.execute('var myVar = "persisted"', mockLlmQuery, mockLoadDocument);

      const result = await sandbox.execute('print(myVar)', mockLlmQuery, mockLoadDocument);

      expect(result.output).toBe('persisted');
    });

    it('should not persist builtin names', async () => {
      await sandbox.execute('print("first")', mockLlmQuery, mockLoadDocument);

      const result = await sandbox.execute(
        'print(typeof document_list)',
        mockLlmQuery,
        mockLoadDocument,
      );

      // document_list should still be the original, not overwritten
      expect(result.output).toBe('object');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Context persistence across executions
  // ═══════════════════════════════════════════════════════════════════════

  describe('Context persistence', () => {
    it('should keep context available across multiple executions', async () => {
      await sandbox.execute('await load_document(1)', mockLlmQuery, mockLoadDocument);

      const result = await sandbox.execute('print(context)', mockLlmQuery, mockLoadDocument);

      expect(result.output).toContain('Isi dokumen contoh.');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11. Exec log
  // ═══════════════════════════════════════════════════════════════════════

  describe('Exec log', () => {
    it('should log successful execution', async () => {
      await sandbox.execute('let x = 1', mockLlmQuery, mockLoadDocument);

      const log = sandbox.getExecLog();
      expect(log).toContainEqual(expect.stringContaining('✅'));
    });

    it('should log error execution', async () => {
      await sandbox.execute('throw new Error("fail")', mockLlmQuery, mockLoadDocument);

      const log = sandbox.getExecLog();
      expect(log).toContainEqual(expect.stringContaining('❌'));
    });

    it('should accumulate logs across executions', async () => {
      await sandbox.execute('let a = 1', mockLlmQuery, mockLoadDocument);
      await sandbox.execute('let b = 2', mockLlmQuery, mockLoadDocument);

      const log = sandbox.getExecLog();
      expect(log).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12. Full workflow: load → query → FINAL
  // ═══════════════════════════════════════════════════════════════════════

  describe('Full workflow', () => {
    it('should execute load_document → llm_query → FINAL in single pass', async () => {
      mockLoadDocument.mockResolvedValue('Isi SOP Rekrutmen lengkap.');
      mockLlmQuery.mockResolvedValue('Prosedur dimulai dari Mgr DYM.');

      const result = await sandbox.execute(
        `await load_document(1)
         const answer = await llm_query("Berdasarkan: " + context + " Apa prosedurnya?")
         FINAL(answer)`,
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(mockLoadDocument).toHaveBeenCalledWith(1);
      expect(mockLlmQuery).toHaveBeenCalledTimes(1);
      expect(mockLlmQuery.mock.calls[0][0]).toContain('Isi SOP Rekrutmen lengkap.');
      expect(result.finalAnswer).toBe('Prosedur dimulai dari Mgr DYM.');
      expect(result.success).toBe(true);
      expect(result.loadedDocumentIds).toContain(1);
      expect(result.llmQueryCalls).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13. Print buffer reset between executions
  // ═══════════════════════════════════════════════════════════════════════

  describe('Print buffer reset', () => {
    it('should reset print buffer between executions', async () => {
      await sandbox.execute('print("first")', mockLlmQuery, mockLoadDocument);
      const result = await sandbox.execute('print("second")', mockLlmQuery, mockLoadDocument);

      expect(result.output).toBe('second');
      expect(result.output).not.toContain('first');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 14. Async IIFE wrapping
  // ═══════════════════════════════════════════════════════════════════════

  describe('Async execution', () => {
    it('should handle await correctly in user code', async () => {
      const result = await sandbox.execute(
        `const doc = await load_document(1)
         const answer = await llm_query("test")
         print(doc)
         print(answer)`,
        mockLlmQuery,
        mockLoadDocument,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('Isi dokumen contoh.');
      expect(result.output).toContain('Sub-LM answer');
    });
  });
});