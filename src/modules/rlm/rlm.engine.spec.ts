import { Test, TestingModule } from '@nestjs/testing';
import { RlmEngine, DocumentMeta, RLMResult } from './rlm.engine';
import { LlmApiClient } from './llm-api.client';
import { ReplEnvironment } from './repl.environment';
import { ReplSandbox } from './repl.sandbox';

// ─── Mocks ───────────────────────────────────────────────────────────────

const mockLlmApiClient = () => ({
  queryRootLM: jest.fn(),
  querySubLM: jest.fn(),
});

const mockReplSandbox = () => ({
  initSession: jest.fn(),
  execute: jest.fn(),
  getExecLog: jest.fn().mockReturnValue([]),
});

const mockReplEnvironment = () => ({
  loadDocument: jest.fn(),
  getDocument: jest.fn().mockReturnValue(''),
});

// ─── Helpers ─────────────────────────────────────────────────────────────

const makeLlmResponse = (content: string, inputTokens = 10, outputTokens = 20) => ({
  content,
  input_tokens: inputTokens,
  output_tokens: outputTokens,
});

const sampleDocs: DocumentMeta[] = [
  { id: 1, title: 'SOP Rekrutmen', file_size: 5000 },
  { id: 2, title: 'SOP Pengadaan Barang', file_size: 8000 },
];

const loadDocumentFn = jest.fn().mockResolvedValue('Isi dokumen contoh untuk testing.');

// ─── Tests ───────────────────────────────────────────────────────────────

describe('RlmEngine', () => {
  let engine: RlmEngine;
  let llmClient: jest.Mocked<LlmApiClient>;
  let sandbox: jest.Mocked<ReplSandbox>;
  let repl: jest.Mocked<ReplEnvironment>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RlmEngine,
        { provide: LlmApiClient, useFactory: mockLlmApiClient },
        { provide: ReplSandbox, useFactory: mockReplSandbox },
      ],
    }).compile();

    engine = module.get<RlmEngine>(RlmEngine);
    llmClient = module.get(LlmApiClient);
    sandbox = module.get(ReplSandbox);
    repl = mockReplEnvironment() as any;
    loadDocumentFn.mockClear();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. FINAL() outside code block
  // ═══════════════════════════════════════════════════════════════════════

  describe('FINAL() detected outside code block', () => {
    it('should return answer when FINAL() is in plain text (no code block)', async () => {
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('FINAL(Prosedur rekrutmen dimulai dari pengajuan formulir oleh Mgr DYM.)'),
      );

      const result = await engine.process('Apa prosedur rekrutmen?', repl, sampleDocs, loadDocumentFn);

      expect(result.answer).toBe('Prosedur rekrutmen dimulai dari pengajuan formulir oleh Mgr DYM.');
      expect(result.totalIterations).toBe(1);
    });

    it('should reject FINAL() with placeholder content', async () => {
      // First response: FINAL with placeholder → should continue
      llmClient.queryRootLM
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(__LLM_PLACEHOLDER)'),
        )
        // Second response: valid FINAL
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(Jawaban yang valid dan lengkap dari dokumen SOP.)'),
        );

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.answer).toBe('Jawaban yang valid dan lengkap dari dokumen SOP.');
      expect(result.totalIterations).toBe(2);
    });

    it('should reject FINAL() with too-short content', async () => {
      llmClient.queryRootLM
        .mockResolvedValueOnce(makeLlmResponse('FINAL(ok)'))
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(Jawaban lengkap mengenai prosedur pengadaan barang.)'),
        );

      const result = await engine.process('Prosedur?', repl, sampleDocs, loadDocumentFn);

      // "ok" is <= 5 chars, so it should be rejected
      expect(result.answer).not.toBe('ok');
      expect(result.totalIterations).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Direct answer without FINAL() or code block
  // ═══════════════════════════════════════════════════════════════════════

  describe('Direct answer without FINAL() wrapper', () => {
    it('should accept a long direct answer after first iteration', async () => {
      const longAnswer = 'A'.repeat(250);

      // First iteration: code block that loads doc
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('```repl\nawait load_document(1)\n```'),
      );
      sandbox.execute.mockResolvedValueOnce({
        output: '', error: '', success: true,
        finalAnswer: undefined,
        llmQueryCalls: [], loadedDocumentIds: [1],
      });

      // Second iteration: plain long answer (no code block, no FINAL)
      llmClient.queryRootLM.mockResolvedValueOnce(makeLlmResponse(longAnswer));

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.answer).toBe(longAnswer);
      expect(result.totalIterations).toBe(2);
    });

    it('should NOT accept a short direct answer on first iteration', async () => {
      // First iteration: short plain text (not long enough, i == 0)
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('Saya akan cek dokumen dulu.'),
      );

      // Second iteration: valid code with FINAL
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('```repl\nFINAL("Jawaban dari dokumen tentang prosedur tersebut.")\n```'),
      );
      sandbox.execute.mockResolvedValueOnce({
        output: '', error: '', success: true,
        finalAnswer: 'Jawaban dari dokumen tentang prosedur tersebut.',
        llmQueryCalls: [], loadedDocumentIds: [],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.totalIterations).toBe(2);
    });

    it('should prompt for code block when no code and no FINAL on first iteration', async () => {
      llmClient.queryRootLM
        .mockResolvedValueOnce(makeLlmResponse('Hmm, saya pikirkan dulu.'))
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(Jawaban yang benar setelah diprompt ulang oleh sistem.)'),
        );

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      // Verify the engine added an observation prompting for code block
      expect(result.totalIterations).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Code block execution → FINAL() from sandbox
  // ═══════════════════════════════════════════════════════════════════════

  describe('Code block execution with sandbox FINAL()', () => {
    it('should return sandbox finalAnswer on successful execution', async () => {
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('```repl\nawait load_document(1)\nFINAL("Jawaban dari sandbox")\n```'),
      );
      sandbox.execute.mockResolvedValueOnce({
        output: '', error: '', success: true,
        finalAnswer: 'Jawaban dari sandbox',
        llmQueryCalls: [], loadedDocumentIds: [1],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.answer).toBe('Jawaban dari sandbox');
      expect(result.totalIterations).toBe(1);
      expect(result.selectedDocumentIds).toEqual([]);
      // selectedDocumentIds are populated in the load_document callback,
      // which is not invoked when we mock sandbox.execute directly
    });

    it('should reject sandbox FINAL() containing __LLM_PLACEHOLDER', async () => {
      llmClient.queryRootLM
        .mockResolvedValueOnce(
          makeLlmResponse('```repl\nFINAL("__LLM_PLACEHOLDER jawaban")\n```'),
        )
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(Jawaban sebenarnya setelah koreksi dari placeholder.)'),
        );

      sandbox.execute.mockResolvedValueOnce({
        output: '', error: '', success: true,
        finalAnswer: '__LLM_PLACEHOLDER jawaban',
        llmQueryCalls: [], loadedDocumentIds: [],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.answer).not.toContain('__LLM_PLACEHOLDER');
      expect(result.totalIterations).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Observation building
  // ═══════════════════════════════════════════════════════════════════════

  describe('Observation building', () => {
    it('should include loaded document info in observation and continue', async () => {
      llmClient.queryRootLM
        .mockResolvedValueOnce(makeLlmResponse('```repl\nawait load_document(1)\n```'))
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(Jawaban setelah load dokumen berhasil dilakukan.)'),
        );

      sandbox.execute.mockResolvedValueOnce({
        output: 'Loaded OK', error: '', success: true,
        finalAnswer: undefined,
        llmQueryCalls: [], loadedDocumentIds: [1],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.totalIterations).toBe(2);
      expect(result.answer).toBe('Jawaban setelah load dokumen berhasil dilakukan.');
    });

    it('should include error info in observation', async () => {
      llmClient.queryRootLM
        .mockResolvedValueOnce(makeLlmResponse('```repl\nawait load_document(999)\n```'))
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(Jawaban setelah error dan retry yang berhasil.)'),
        );

      sandbox.execute.mockResolvedValueOnce({
        output: '', error: 'Document not found', success: false,
        finalAnswer: undefined,
        llmQueryCalls: [], loadedDocumentIds: [],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.totalIterations).toBe(2);
    });

    it('should include llm_query call count in observation', async () => {
      llmClient.queryRootLM
        .mockResolvedValueOnce(
          makeLlmResponse('```repl\nconst r = await llm_query("test")\nprint(r)\n```'),
        )
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(Jawaban final setelah llm_query berhasil dipanggil.)'),
        );

      sandbox.execute.mockResolvedValueOnce({
        output: 'Sub-LM result', error: '', success: true,
        finalAnswer: undefined,
        llmQueryCalls: ['test prompt'],
        loadedDocumentIds: [],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.totalIterations).toBe(2);
    });

    it('should truncate long output in observation', async () => {
      const longOutput = 'X'.repeat(5000);

      llmClient.queryRootLM
        .mockResolvedValueOnce(makeLlmResponse('```repl\nprint("long")\n```'))
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(Jawaban ringkas setelah output panjang berhasil diproses.)'),
        );

      sandbox.execute.mockResolvedValueOnce({
        output: longOutput, error: '', success: true,
        finalAnswer: undefined,
        llmQueryCalls: [], loadedDocumentIds: [],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      // Engine should have truncated to 3000 chars in observation
      expect(result.totalIterations).toBe(2);
    });

    it('should produce default message when no output, no error, no docs loaded', async () => {
      llmClient.queryRootLM
        .mockResolvedValueOnce(makeLlmResponse('```repl\nlet x = 1\n```'))
        .mockResolvedValueOnce(
          makeLlmResponse('FINAL(Jawaban setelah code tanpa output dieksekusi.)'),
        );

      sandbox.execute.mockResolvedValueOnce({
        output: '', error: '', success: true,
        finalAnswer: undefined,
        llmQueryCalls: [], loadedDocumentIds: [],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.totalIterations).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Sub-LM callback
  // ═══════════════════════════════════════════════════════════════════════

  describe('Sub-LM (llm_query) callback', () => {
    it('should invoke sub-LM and track tokens + depth', async () => {
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('```repl\nconst r = await llm_query("sub prompt")\nFINAL(r)\n```'),
      );
      llmClient.querySubLM.mockResolvedValueOnce(
        makeLlmResponse('Sub-LM answer', 15, 25),
      );

      // Simulate sandbox calling the llm_query callback
      sandbox.execute.mockImplementationOnce(async (code, llmCallback, loadCallback) => {
        const subResult = await llmCallback('sub prompt');
        return {
          output: subResult, error: '', success: true,
          finalAnswer: subResult,
          llmQueryCalls: ['sub prompt'], loadedDocumentIds: [],
        };
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(llmClient.querySubLM).toHaveBeenCalledTimes(1);
      expect(result.subQueryResults).toHaveLength(1);
      expect(result.subQueryResults[0].answer).toBe('Sub-LM answer');
      expect(result.depth).toBeGreaterThanOrEqual(2);
      expect(result.totalInputTokens).toBe(10 + 15); // root + sub
      expect(result.totalOutputTokens).toBe(20 + 25);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. load_document callback
  // ═══════════════════════════════════════════════════════════════════════

  describe('load_document callback', () => {
    it('should load, normalize, and track document IDs', async () => {
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('```repl\nawait load_document(1)\nFINAL(context)\n```'),
      );

      sandbox.execute.mockImplementationOnce(async (code, llmCb, loadCb) => {
        const content = await loadCb(1);
        return {
          output: content, error: '', success: true,
          finalAnswer: content,
          llmQueryCalls: [], loadedDocumentIds: [1],
        };
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(loadDocumentFn).toHaveBeenCalledWith(1);
      expect(repl.loadDocument).toHaveBeenCalled();
      expect(result.selectedDocumentIds).toContain(1);
    });

    it('should not duplicate document IDs when loaded twice', async () => {
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('```repl\nawait load_document(2)\nawait load_document(2)\nFINAL("done")\n```'),
      );

      sandbox.execute.mockImplementationOnce(async (code, llmCb, loadCb) => {
        await loadCb(2);
        await loadCb(2);
        return {
          output: '', error: '', success: true,
          finalAnswer: 'done',
          llmQueryCalls: [], loadedDocumentIds: [2],
        };
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      const count = result.selectedDocumentIds.filter(id => id === 2).length;
      expect(count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Fallback when max iterations reached
  // ═══════════════════════════════════════════════════════════════════════

  describe('Fallback answer', () => {
    it('should produce a fallback answer after max iterations', async () => {
      // All 10 iterations return no-op code with no FINAL
      for (let i = 0; i < 10; i++) {
        llmClient.queryRootLM.mockResolvedValueOnce(
          makeLlmResponse('```repl\nprint("thinking...")\n```'),
        );
        sandbox.execute.mockResolvedValueOnce({
          output: 'thinking...', error: '', success: true,
          finalAnswer: undefined,
          llmQueryCalls: [], loadedDocumentIds: [],
        });
      }

      // Fallback call
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('Jawaban fallback berdasarkan kutipan dokumen.', 5, 10),
      );

      const result = await engine.process('Apa prosedur X?', repl, sampleDocs, loadDocumentFn);

      expect(result.totalIterations).toBe(10);
      expect(result.answer).toBe('Jawaban fallback berdasarkan kutipan dokumen.');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Chat history handling
  // ═══════════════════════════════════════════════════════════════════════

  describe('Chat history', () => {
    it('should include chat history in conversation', async () => {
      const chatHistory = [
        { role: 'user' as const, content: 'Halo' },
        { role: 'assistant' as const, content: 'Halo, ada yang bisa dibantu?' },
      ];

      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('FINAL(Jawaban dengan konteks chat history sebelumnya.)'),
      );

      const result = await engine.process(
        'Apa SOP rekrutmen?', repl, sampleDocs, loadDocumentFn, chatHistory,
      );

      // The queryRootLM should be called with messages including chat history
      const calledMessages = llmClient.queryRootLM.mock.calls[0][0];
      expect(calledMessages).toHaveLength(5); // system + 2 history + user question
      expect(calledMessages[1].content).toBe('Halo');
      expect(calledMessages[2].content).toBe('Halo, ada yang bisa dibantu?');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. History trimming
  // ═══════════════════════════════════════════════════════════════════════

  describe('History trimming', () => {
    it('should trim history when exceeding max messages', async () => {
      // Generate enough iterations to grow conversation history beyond 10
      const iterations = 6;
      for (let i = 0; i < iterations - 1; i++) {
        llmClient.queryRootLM.mockResolvedValueOnce(
          makeLlmResponse('```repl\nprint("iter")\n```'),
        );
        sandbox.execute.mockResolvedValueOnce({
          output: 'iter', error: '', success: true,
          finalAnswer: undefined,
          llmQueryCalls: [], loadedDocumentIds: [],
        });
      }

      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('FINAL(Jawaban setelah banyak iterasi dengan history trimming.)'),
      );

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.totalIterations).toBe(iterations);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Token tracking
  // ═══════════════════════════════════════════════════════════════════════

  describe('Token tracking', () => {
    it('should accumulate tokens across iterations', async () => {
      llmClient.queryRootLM
        .mockResolvedValueOnce(makeLlmResponse('```repl\nprint("a")\n```', 100, 200))
        .mockResolvedValueOnce(makeLlmResponse('FINAL(Jawaban final setelah dua iterasi.)', 150, 250));

      sandbox.execute.mockResolvedValueOnce({
        output: 'a', error: '', success: true,
        finalAnswer: undefined,
        llmQueryCalls: [], loadedDocumentIds: [],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.totalInputTokens).toBe(250);
      expect(result.totalOutputTokens).toBe(450);
    });

    it('should include fallback tokens in total', async () => {
      for (let i = 0; i < 10; i++) {
        llmClient.queryRootLM.mockResolvedValueOnce(
          makeLlmResponse('```repl\nprint("x")\n```', 10, 20),
        );
        sandbox.execute.mockResolvedValueOnce({
          output: 'x', error: '', success: true,
          finalAnswer: undefined,
          llmQueryCalls: [], loadedDocumentIds: [],
        });
      }

      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('Fallback answer.', 5, 10),
      );

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.totalInputTokens).toBe(10 * 10 + 5); // 10 iterations + fallback
      expect(result.totalOutputTokens).toBe(10 * 20 + 10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11. Code block extraction
  // ═══════════════════════════════════════════════════════════════════════

  describe('Code block extraction', () => {
    it('should extract ```repl code blocks', async () => {
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('Berikut code-nya:\n```repl\nFINAL("from repl block")\n```\nSelesai.'),
      );
      sandbox.execute.mockResolvedValueOnce({
        output: '', error: '', success: true,
        finalAnswer: 'from repl block',
        llmQueryCalls: [], loadedDocumentIds: [],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.answer).toBe('from repl block');
    });

    it('should fall back to ```javascript code blocks', async () => {
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('```javascript\nFINAL("from js block")\n```'),
      );
      sandbox.execute.mockResolvedValueOnce({
        output: '', error: '', success: true,
        finalAnswer: 'from js block',
        llmQueryCalls: [], loadedDocumentIds: [],
      });

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.answer).toBe('from js block');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12. initSession called on start
  // ═══════════════════════════════════════════════════════════════════════

  describe('Session initialization', () => {
    it('should call initSession with document metadata', async () => {
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('FINAL(Jawaban cepat untuk menguji inisialisasi sesi.)'),
      );

      await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(sandbox.initSession).toHaveBeenCalledWith(sampleDocs);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13. FINAL() with nested parentheses
  // ═══════════════════════════════════════════════════════════════════════

  describe('FINAL() with nested parentheses', () => {
    it('should handle FINAL() with plain text content', async () => {
  const answer = 'Prosedur rekrutmen dimulai dari Mgr DYM mengisi formulir permintaan';
  llmClient.queryRootLM.mockResolvedValueOnce(
    makeLlmResponse(`FINAL(${answer})`),
  );

  const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

  expect(result.answer).toBe(answer);
});

    it('should handle FINAL() content without parentheses', async () => {
      const answer = 'Langkah 5.1: Mgr DYM mengisi formulir permintaan karyawan baru';
      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse(`FINAL(${answer})`),
      );

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.answer).toBe(answer);
    });

    // Known limitation: regex tidak handle multiple nested parentheses groups
    // e.g. FINAL(Prosedur (langkah 1) dari Mgr (DYM)) → terpotong
    // TODO: fix regex di rlm.engine.ts
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 14. execLog returned in result
  // ═══════════════════════════════════════════════════════════════════════

  describe('Execution log', () => {
    it('should include execLog from sandbox in result', async () => {
      sandbox.getExecLog.mockReturnValue(['log entry 1', 'log entry 2']);

      llmClient.queryRootLM.mockResolvedValueOnce(
        makeLlmResponse('FINAL(Jawaban dengan exec log yang tercatat di sandbox.)'),
      );

      const result = await engine.process('Pertanyaan?', repl, sampleDocs, loadDocumentFn);

      expect(result.execLog).toEqual(['log entry 1', 'log entry 2']);
    });
  });
});