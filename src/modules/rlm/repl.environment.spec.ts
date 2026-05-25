import { ReplEnvironment } from './repl.environment';

describe('ReplEnvironment', () => {
  let env: ReplEnvironment;

  beforeEach(() => {
    env = new ReplEnvironment();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Document management
  // ═══════════════════════════════════════════════════════════════════════

  describe('loadDocument() / getDocument() / hasDocument()', () => {
    it('should load document and make it retrievable', () => {
      env.loadDocument('Konten SOP Rekrutmen.');
      expect(env.getDocument()).toBe('Konten SOP Rekrutmen.');
      expect(env.hasDocument()).toBe(true);
    });

    it('should return empty string and false before loading', () => {
      expect(env.getDocument()).toBe('');
      expect(env.hasDocument()).toBe(false);
    });

    it('should overwrite previous document on second load', () => {
      env.loadDocument('Dokumen A');
      env.loadDocument('Dokumen B');
      expect(env.getDocument()).toBe('Dokumen B');
    });

    it('should log document load in execLog', () => {
      env.loadDocument('Dokumen contoh');
      const log = env.getExecLog();
      expect(log.some((l) => l.includes('Document loaded'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. findSnippets
  // ═══════════════════════════════════════════════════════════════════════

  describe('findSnippets()', () => {
    const content = [
      'Langkah 1: Pengajuan formulir oleh Manajer',
      'Langkah 2: Review oleh HR Department',
      'Langkah 3: Persetujuan Direktur',
      'Catatan: Pastikan formulir diisi lengkap',
    ].join('\n');

    beforeEach(() => env.loadDocument(content));

    it('should find lines containing single keyword', () => {
      const result = env.findSnippets('formulir');
      expect(result).toHaveLength(2);
      expect(result.every((l) => l.toLowerCase().includes('formulir'))).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(env.findSnippets('FORMULIR')).toHaveLength(2);
      expect(env.findSnippets('formulir')).toHaveLength(2);
    });

    it('should return empty array when no keyword matches', () => {
      expect(env.findSnippets('xyz_tidak_ada')).toEqual([]);
    });

    it('should return empty array when no document is loaded', () => {
      const fresh = new ReplEnvironment();
      expect(fresh.findSnippets('test')).toEqual([]);
    });

    it('should accept array of keywords and find lines matching any', () => {
      const result = env.findSnippets(['Manajer', 'HR']);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('should deduplicate lines that match multiple keywords', () => {
      env.loadDocument('formulir dan formulir lagi dalam satu baris');
      const result = env.findSnippets('formulir');
      expect(result).toHaveLength(1);
    });

    it('should include log entry after search', () => {
      env.findSnippets('formulir');
      const log = env.getExecLog();
      expect(log.some((l) => l.includes('find_snippets'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. splitContext
  // ═══════════════════════════════════════════════════════════════════════

  describe('splitContext()', () => {
    it('should return empty array when no document loaded', () => {
      expect(env.splitContext()).toEqual([]);
    });

    it('should return single chunk for content shorter than chunk size', () => {
      env.loadDocument('Dokumen singkat saja.');
      const chunks = env.splitContext(4000);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toContain('Dokumen singkat');
    });

    it('should split content into multiple chunks based on paragraphs', () => {
      const paragraph = 'A'.repeat(1500);
      env.loadDocument(`${paragraph}\n\n${paragraph}\n\n${paragraph}`);
      const chunks = env.splitContext(2000);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should handle very long single paragraph by splitting by size', () => {
      const longParagraph = 'W '.repeat(3000);
      env.loadDocument(longParagraph);
      const chunks = env.splitContext(500);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should log chunk count in execLog', () => {
      env.loadDocument('Paragraf satu.\n\nParagraf dua.');
      env.splitContext();
      const log = env.getExecLog();
      expect(log.some((l) => l.includes('split_context'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. getChunk / countChunks
  // ═══════════════════════════════════════════════════════════════════════

  describe('getChunk() / countChunks()', () => {
    it('should return 0 chunks when no document loaded', () => {
      expect(env.countChunks()).toBe(0);
    });

    it('should return 1 chunk for short content', () => {
      env.loadDocument('Dokumen pendek.');
      expect(env.countChunks(4000)).toBe(1);
    });

    it('should return chunk at valid index', () => {
      env.loadDocument('Bagian pertama.\n\n' + 'X'.repeat(6000) + '\n\nBagian ketiga.');
      const chunk = env.getChunk(0, 100);
      expect(typeof chunk).toBe('string');
      expect(chunk.length).toBeGreaterThan(0);
    });

    it('should return empty string for out-of-range index', () => {
      env.loadDocument('Dokumen pendek.');
      expect(env.getChunk(99)).toBe('');
    });

    it('should return empty string for negative index', () => {
      env.loadDocument('Dokumen pendek.');
      expect(env.getChunk(-1)).toBe('');
    });

    it('countChunks should match splitContext length', () => {
      const text = 'Para A.\n\n' + 'Z'.repeat(5000) + '\n\nPara C.';
      env.loadDocument(text);
      const count = env.countChunks(2000);
      expect(count).toBe(env.splitContext(2000).length);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Intermediate variable storage
  // ═══════════════════════════════════════════════════════════════════════

  describe('storeIntermediate() / getIntermediate() / hasIntermediate() / getAllIntermediates()', () => {
    it('should store and retrieve a string value', () => {
      env.storeIntermediate('key1', 'value1');
      expect(env.getIntermediate('key1')).toBe('value1');
    });

    it('should return null for missing key', () => {
      expect(env.getIntermediate('nonexistent')).toBeNull();
    });

    it('hasIntermediate should return true for existing key', () => {
      env.storeIntermediate('present', 42);
      expect(env.hasIntermediate('present')).toBe(true);
    });

    it('hasIntermediate should return false for missing key', () => {
      expect(env.hasIntermediate('absent')).toBe(false);
    });

    it('should store and retrieve complex objects', () => {
      const data = { a: [1, 2, 3], nested: { flag: true } };
      env.storeIntermediate('complex', data);
      expect(env.getIntermediate('complex')).toEqual(data);
    });

    it('getAllIntermediates should return all stored pairs', () => {
      env.storeIntermediate('k1', 'v1');
      env.storeIntermediate('k2', 100);
      expect(env.getAllIntermediates()).toEqual({ k1: 'v1', k2: 100 });
    });

    it('should overwrite value for existing key', () => {
      env.storeIntermediate('key', 'old');
      env.storeIntermediate('key', 'new');
      expect(env.getIntermediate('key')).toBe('new');
    });

    it('should log store operation in execLog', () => {
      env.storeIntermediate('myKey', 'myVal');
      const log = env.getExecLog();
      expect(log.some((l) => l.includes('store'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Logging
  // ═══════════════════════════════════════════════════════════════════════

  describe('log() / getExecLog()', () => {
    it('should append log messages with [REPL] prefix', () => {
      env.log('First message');
      const log = env.getExecLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toContain('First message');
    });

    it('should accumulate multiple log entries', () => {
      env.log('Entry 1');
      env.log('Entry 2');
      expect(env.getExecLog()).toHaveLength(2);
    });

    it('getExecLog should return a copy, not the internal array', () => {
      env.log('Original entry');
      const log = env.getExecLog();
      log.push('Injected from test');
      expect(env.getExecLog()).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. clearEnv
  // ═══════════════════════════════════════════════════════════════════════

  describe('clearEnv()', () => {
    it('should reset document, variables, and log', () => {
      env.loadDocument('Dokumen contoh');
      env.storeIntermediate('k', 'v');
      env.log('Some log');

      env.clearEnv();

      expect(env.getDocument()).toBe('');
      expect(env.hasDocument()).toBe(false);
      expect(env.getAllIntermediates()).toEqual({});
      expect(env.getExecLog()).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. clearIntermediates
  // ═══════════════════════════════════════════════════════════════════════

  describe('clearIntermediates()', () => {
    it('should clear variables only, preserving document and logs', () => {
      env.loadDocument('Tetap ada');
      env.storeIntermediate('toBeCleared', 'val');
      env.log('Log tetap ada');

      env.clearIntermediates();

      expect(env.getAllIntermediates()).toEqual({});
      expect(env.getDocument()).toBe('Tetap ada');
      // loadDocument + storeIntermediate + log each append to execLog
      expect(env.getExecLog().length).toBeGreaterThanOrEqual(3);
      expect(env.getExecLog().some((l) => l.includes('Log tetap ada'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. getStats
  // ═══════════════════════════════════════════════════════════════════════

  describe('getStats()', () => {
    it('should return zeroed stats for empty env', () => {
      const stats = env.getStats();
      expect(stats.documentLength).toBe(0);
      expect(stats.totalChunks).toBe(0);
      expect(stats.storedVariables).toBe(0);
      expect(stats.execLogCount).toBe(0);
    });

    it('should reflect current state correctly', () => {
      env.loadDocument('Hello world.');
      env.storeIntermediate('k1', 'v1');
      env.storeIntermediate('k2', 'v2');
      env.log('message');

      const stats = env.getStats();
      expect(stats.documentLength).toBe('Hello world.'.length);
      expect(stats.storedVariables).toBe(2);
      // execLogCount includes entries from loadDocument, storeIntermediate calls, log,
      // and any internal calls (e.g. splitContext called from countChunks in getStats)
      expect(stats.execLogCount).toBeGreaterThanOrEqual(4);
    });
  });
});
