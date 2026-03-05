// FILE: src/modules/rlm/repl.environment.ts

export class ReplEnvironment {
  private documentContext: string = '';
  private variables: Map<string, any> = new Map();
  private execLog: string[] = [];
  private readonly maxContextSize: number = 4000;

  // ── Document Management ────────────────────────────────

  loadDocument(content: string): void {
    this.documentContext = content;
    const msg = `[REPL] ✅ Document loaded: ${content.length} characters`;
    this.execLog.push(msg);
    console.log(msg);
  }

  getDocument(): string {
    return this.documentContext;
  }

  hasDocument(): boolean {
    return this.documentContext.length > 0;
  }

  // ── Helper Functions (dipanggil oleh GPT via action) ───

  // Cari baris yang mengandung keyword
  findSnippets(keyword: string | string[]): string[] {
  if (!this.documentContext) return [];

  // Normalisasi ke array
  const keywords = Array.isArray(keyword) ? keyword : [keyword];

  const lines = this.documentContext.split('\n');

  const results = lines.filter((line) =>
    keywords.some((kw) =>
      line.toLowerCase().includes(kw.toLowerCase()),
    ),
  );

  // Hapus duplikat
  const unique = [...new Set(results)];

  const msg = `[REPL] 🔍 find_snippets(${JSON.stringify(keywords)}): ${unique.length} results`;
  this.execLog.push(msg);
  console.log(msg);

  return unique;
}

  // Potong dokumen menjadi chunks
  splitContext(chunkSize: number = this.maxContextSize): string[] {
    if (!this.documentContext) return [];

    const chunks: string[] = [];
    const paragraphs = this.documentContext.split('\n\n');
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if ((currentChunk + paragraph).length > chunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = paragraph;
        } else {
          for (let i = 0; i < paragraph.length; i += chunkSize) {
            chunks.push(paragraph.slice(i, i + chunkSize));
          }
        }
      } else {
        currentChunk += '\n\n' + paragraph;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    const msg = `[REPL] ✂️  split_context(${chunkSize}): ${chunks.length} chunks`;
    this.execLog.push(msg);
    console.log(msg);

    return chunks;
  }

  getChunk(index: number, chunkSize: number = this.maxContextSize): string {
    const chunks = this.splitContext(chunkSize);
    if (index < 0 || index >= chunks.length) return '';
    return chunks[index];
  }

  countChunks(chunkSize: number = this.maxContextSize): number {
    return this.splitContext(chunkSize).length;
  }

  // Simpan hasil intermediate
  storeIntermediate(key: string, value: any): void {
    this.variables.set(key, value);
    const msg = `[REPL] 💾 store("${key}"): saved`;
    this.execLog.push(msg);
    console.log(msg);
  }

  getIntermediate(key: string): any {
    return this.variables.get(key) ?? null;
  }

  hasIntermediate(key: string): boolean {
    return this.variables.has(key);
  }

  getAllIntermediates(): Record<string, any> {
    return Object.fromEntries(this.variables);
  }

  // ── Logging ────────────────────────────────────────────

  log(message: string): void {
    this.execLog.push(`[REPL] ${message}`);
    console.log(`[REPL] ${message}`);
  }

  getExecLog(): string[] {
    return [...this.execLog];
  }

  // ── Reset ──────────────────────────────────────────────

  clearEnv(): void {
    this.documentContext = '';
    this.variables.clear();
    this.execLog = [];
    console.log('[REPL] 🔄 Environment cleared');
  }

  clearIntermediates(): void {
    this.variables.clear();
    console.log('[REPL] 🔄 Intermediates cleared');
  }

  getStats(): Record<string, any> {
    return {
      documentLength: this.documentContext.length,
      totalChunks: this.countChunks(),
      storedVariables: this.variables.size,
      execLogCount: this.execLog.length,
    };
  }
}