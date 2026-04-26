// FILE: src/modules/sop-documents/pdf-extractor.service.ts
//
// PDF Extractor v8 — PDF langsung ke LLM
//
// - Prompt general untuk segala bentuk SOP/dokumen prosedur
// - Full error logging dari OpenAI API
// - Support: tabel prosedur, flowchart, swim-lane, narrative
// - Output format cocok untuk RLM (Langkah X. [Actor] Isi)

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiUrl = 'https://api.openai.com/v1/chat/completions';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY') as string;
    this.model =
      this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';
  }

  async extract(pdfBuffer: Buffer): Promise<string> {
    if (!pdfBuffer || pdfBuffer.length < 100) {
      throw new BadRequestException('File PDF kosong atau terlalu kecil');
    }

    this.logger.log(
      `[EXTRACT] PDF size: ${pdfBuffer.length} bytes, model: ${this.model}`,
    );

    const base64Pdf = pdfBuffer.toString('base64');

    const systemPrompt = `Kamu adalah document parser. Tugasmu mengkonversi dokumen PDF menjadi plain text terstruktur.

ATURAN UMUM:
- Salin SEMUA informasi dari dokumen. Jangan tambah, jangan kurangi, jangan ubah istilah.
- Output dalam plain text (bukan markdown, bukan HTML).
- Gunakan bahasa yang sama dengan dokumen asli.

FORMAT OUTPUT:

1. HEADER DOKUMEN
   Tulis metadata dokumen apa adanya (nomor dokumen, tanggal berlaku, revisi, departemen, judul, dsb).

2. BAGIAN DESKRIPTIF
   Tulis section seperti Tujuan, Cakupan, Definisi, Dokumen/Formulir, Kebijakan, dsb dengan penomoran asli dari dokumen.

3. BAGIAN PROSEDUR / RINCIAN PROSEDUR
   Ini bagian terpenting. Format setiap langkah sebagai:

   Langkah [nomor]. [Penanggung Jawab] Isi kegiatan lengkap.

   Aturan khusus:
   a) NOMOR LANGKAH: gunakan penomoran persis dari dokumen.
      - Jika dokumen pakai 5.1, 5.2, dst → tulis "Langkah 5.1.", "Langkah 5.2."
      - Jika dokumen pakai 1, 2, 3 → tulis "Langkah 1.", "Langkah 2."
      - Jika dokumen tidak punya nomor (misal flowchart) → beri nomor urut sendiri: "Langkah 1.", "Langkah 2.", dst

   b) PENANGGUNG JAWAB / ACTOR: tulis dalam [kurung siku] persis dari dokumen.
      - Ambil dari kolom "Tanggung Jawab", "Pelaksana", "PIC", atau kolom serupa
      - Jika ada beberapa actor untuk satu langkah, pisahkan dengan koma: [Manager Langsung, HRD, DirOps]
      - Jika tidak ada actor yang tercantum untuk suatu langkah, tulis [] (kurung siku kosong)
      - PENTING: pasangkan setiap kegiatan dengan actor yang benar PADA BARIS YANG SAMA di tabel asli

   c) ISI KEGIATAN: salin lengkap termasuk:
      - Kondisi if/else (Jika disetujui... Jika tidak...)
      - Sub-poin (5.1.1, 5.1.2, dst) — gabungkan dalam langkah induknya
      - Nama formulir, nama jabatan, referensi ke langkah lain (misal "kembali ke point 5.6")

4. JENIS DOKUMEN YANG BISA MUNCUL:
   a) Tabel prosedur standar: kolom No, Kegiatan, Tanggung Jawab
   b) Flowchart / swim-lane diagram: ada shape (kotak, diamond), garis, Begin/End
      → Abaikan elemen visual (garis, kotak, Begin, End, Ya, Tidak sebagai label shape)
      → Ambil ISI teks dari shape dan actor dari kolom/swimlane
   c) Dokumen naratif: prosedur ditulis dalam paragraf
      → Identifikasi langkah-langkah dan actor dari konteks kalimat
   d) Tabel dengan format custom / tidak standar
      → Identifikasi kolom mana yang berisi kegiatan dan mana yang berisi penanggung jawab
      → Jika ragu, tulis semua informasi yang ada

5. JANGAN:
   - Menambah langkah yang tidak ada di dokumen
   - Mengubah nama jabatan (misal "Mgr DYM" jangan jadi "Manager DYM")
   - Mengubah nama formulir (misal "FPKMP" jangan jadi "Form Penilaian Karyawan")
   - Menambah penjelasan atau interpretasi sendiri
   - Meringkas atau memparafrase isi langkah`;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'file',
                  file: {
                    filename: 'document.pdf',
                    file_data: `data:application/pdf;base64,${base64Pdf}`,
                  },
                },
                {
                  type: 'text',
                  text: 'Konversi dokumen PDF di atas menjadi plain text terstruktur sesuai instruksi.',
                },
              ],
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 500000,
        },
      );

      const result = response.data.choices[0]?.message?.content ?? '';
      const tokens = response.data.usage;
      const finishReason = response.data.choices[0]?.finish_reason;

      this.logger.log(`[EXTRACT] ✅ Model: ${this.model}`);
      this.logger.log(
        `[EXTRACT] ✅ Tokens — input: ${tokens.prompt_tokens}, output: ${tokens.completion_tokens}`,
      );
      this.logger.log(`[EXTRACT] ✅ Finish reason: ${finishReason}`);
      this.logger.log(`[EXTRACT] ✅ Result length: ${result.length} chars`);

      if (finishReason === 'length') {
        this.logger.warn(
          `[EXTRACT] ⚠️ Output terpotong karena max_completion_tokens. Pertimbangkan naikkan limit.`,
        );
      }

      if (result.trim().length < 30) {
        this.logger.error(`[EXTRACT] ❌ Result too short: "${result}"`);
        throw new Error('LLM returned empty or too short result');
      }

      return result.trim();
    } catch (e: any) {
      // ── Full error logging ──
      if (e.response) {
        // OpenAI API returned an error response
        const status = e.response.status;
        const errorData = e.response.data?.error;
        const errorType = errorData?.type ?? 'unknown';
        const errorCode = errorData?.code ?? 'unknown';
        const errorMessage = errorData?.message ?? 'No message';

        this.logger.error(`[EXTRACT] ❌ OpenAI API Error:`);
        this.logger.error(`[EXTRACT]    HTTP Status: ${status}`);
        this.logger.error(`[EXTRACT]    Error Type: ${errorType}`);
        this.logger.error(`[EXTRACT]    Error Code: ${errorCode}`);
        this.logger.error(`[EXTRACT]    Message: ${errorMessage}`);

        if (status === 400) {
          this.logger.error(
            `[EXTRACT]    Hint: Cek apakah model "${this.model}" support PDF input, atau file terlalu besar`,
          );
        } else if (status === 401) {
          this.logger.error(
            `[EXTRACT]    Hint: API key tidak valid atau expired`,
          );
        } else if (status === 429) {
          this.logger.error(
            `[EXTRACT]    Hint: Rate limit tercapai, coba lagi nanti`,
          );
        } else if (status === 413) {
          this.logger.error(
            `[EXTRACT]    Hint: File PDF terlalu besar (${pdfBuffer.length} bytes)`,
          );
        }

        // Log full response body for debugging
        this.logger.error(
          `[EXTRACT]    Full error body: ${JSON.stringify(e.response.data).slice(0, 500)}`,
        );

        throw new BadRequestException(
          `Gagal extract PDF (${status}): ${errorMessage}`,
        );
      } else if (e.code === 'ECONNABORTED' || e.message?.includes('timeout')) {
        this.logger.error(`[EXTRACT] ❌ Timeout: request melebihi 120 detik`);
        this.logger.error(`[EXTRACT]    PDF size: ${pdfBuffer.length} bytes`);
        throw new BadRequestException(
          'Gagal extract PDF: timeout (file mungkin terlalu besar)',
        );
      } else if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
        this.logger.error(
          `[EXTRACT] ❌ Network error: ${e.code} - ${e.message}`,
        );
        throw new BadRequestException(
          'Gagal extract PDF: tidak bisa terhubung ke OpenAI API',
        );
      } else {
        this.logger.error(`[EXTRACT] ❌ Unexpected error: ${e.message}`);
        this.logger.error(`[EXTRACT]    Stack: ${e.stack?.slice(0, 300)}`);
        throw new BadRequestException('Gagal extract PDF: ' + e.message);
      }
    }
  }
}

// Backward compatibility
export { PdfExtractorService as DocxExtractorService };
