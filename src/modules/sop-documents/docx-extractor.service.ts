// FILE: src/modules/sop-documents/pdf-extractor.service.ts
//
// PDF Extractor v7 — Kirim PDF langsung ke LLM
//
// Alur: User upload PDF → encode base64 → kirim ke OpenAI API → structured text → DB
// Tidak perlu: LibreOffice, Python, pdfplumber, pdftotext, mammoth, OOXML parsing

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
    // Model ringan untuk extraction
    this.model =
      this.configService.get<string>('OPENAI_MODEL_EXTRACT') ??
      this.configService.get<string>('OPENAI_MODEL_MINI') ??
      'gpt-4o-mini';
  }

  async extract(pdfBuffer: Buffer): Promise<string> {
    if (!pdfBuffer || pdfBuffer.length < 100) {
      throw new BadRequestException('File PDF kosong atau terlalu kecil');
    }

    this.logger.log(`[EXTRACT] PDF size: ${pdfBuffer.length} bytes`);
    this.logger.log(`[EXTRACT] Sending to LLM (${this.model})...`);

    // Encode PDF ke base64
    const base64Pdf = pdfBuffer.toString('base64');

    const systemPrompt = `Kamu adalah parser dokumen SOP (Standard Operating Procedure).
Tugasmu: baca dokumen PDF yang diberikan dan konversi menjadi teks terstruktur yang rapih.

ATURAN OUTPUT:
1. Pertahankan SEMUA informasi — jangan tambah, jangan kurangi.
2. Header dokumen (no.dokumen, tgl berlaku, status revisi, departemen) tulis apa adanya.
3. Section TUJUAN, CAKUPAN, DEFINISI, DOKUMEN tulis dengan nomor section.
4. Bagian PROSEDUR format sebagai:

   Langkah [nomor]. [Actor] Isi kegiatan.

   Contoh:
   Langkah 5.1. [Mgr DYM] Mengisi Form Permintaan Karyawan Baru dan menyerahkannya ke HRD.
   Langkah 5.2. [Mgr DYM] Jika posisi baru harus disertai job description.

5. Untuk tabel prosedur multi-kolom:
   - Kolom "No." = nomor langkah
   - Kolom "KEGIATAN"/"URAIAN"/"KETERANGAN" = isi kegiatan
   - Kolom "TANGGUNG JAWAB"/"PELAKSANA" = actor dalam [kurung siku]
   - Pasangkan SETIAP kegiatan dengan actor yang TEPAT pada baris yang SAMA
   - Sub-poin (5.1.1, 5.1.2) gabungkan dalam satu langkah induknya

6. Untuk flowchart/swim-lane:
   - Beri nomor urut (Langkah 1, 2, 3, dst)
   - Actor dari kolom TANGGUNG JAWAB
   - Isi dari kolom KETERANGAN/PROSES
   - Abaikan elemen flowchart (Begin, End, garis, kotak)

7. JANGAN menambahkan informasi yang tidak ada di dokumen.
8. JANGAN mengubah istilah, nama jabatan, atau nama formulir.
9. Output dalam plain text, bukan markdown.`;

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
                  text: 'Baca dokumen PDF di atas dan konversi menjadi teks terstruktur sesuai instruksi.',
                },
              ],
            },
          ],
          max_completion_tokens: 4000,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 120000,
        },
      );

      const result = response.data.choices[0]?.message?.content ?? '';
      const tokens = response.data.usage;

      this.logger.log(
        `[EXTRACT] ✅ Done — input: ${tokens.prompt_tokens}, output: ${tokens.completion_tokens}`,
      );

      if (result.trim().length < 30) {
        throw new Error('LLM returned empty or too short result');
      }

      return result.trim();
    } catch (e: any) {
      const errMsg = e.response?.data?.error?.message ?? e.message;
      this.logger.error(`[EXTRACT] ❌ LLM extraction failed: ${errMsg}`);
      throw new BadRequestException('Gagal membaca PDF: ' + errMsg);
    }
  }
}