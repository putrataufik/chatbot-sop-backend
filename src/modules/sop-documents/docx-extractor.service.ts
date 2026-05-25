// FILE: src/modules/sop-documents/pdf-extractor.service.ts
// PDF Extractor v11 — konversi PDF ke format teks terstruktur menggunakan tag

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
    this.model = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-5-mini';
  }

  async extract(pdfBuffer: Buffer): Promise<string> {
    if (!pdfBuffer || pdfBuffer.length < 100) {
      throw new BadRequestException('File PDF kosong atau terlalu kecil');
    }

    this.logger.log(
      `[EXTRACT] PDF size: ${pdfBuffer.length} bytes, model: ${this.model}`,
    );

    const base64Pdf = pdfBuffer.toString('base64');

    const systemPrompt = `Convert SOP documents into a structured tag-based text format designed for reliable retrieval. The output uses fixed tags such as [DOC], [META], [SEC], [INFO], and [STEP] to preserve hierarchy, metadata, and procedural steps from the original document.

═══ OUTPUT SCHEMA ═══

[DOC] title=<title> | lang=<en|id|other>

[META] field=<name> | value=<value>
(repeat for each metadata: doc number, date, revision, department, etc.)

[SEC] id=<id> | title=<section title>
(one per section/chapter; omit if document has no sections)

[INFO] type=<purpose|scope|definition|policy|other> | sec=<section title or empty>
<verbatim content>
[/INFO]

[STEP] id=<step id> | sec=<section title or empty>
actor: <primary role> | <alternate role or empty>
action: <verbatim activity description, including sub-points and forms>
time: <duration verbatim, e.g. "4-6 minutes", "24 jam", "Within 30 min">
cond: <if/else or yes/no branches, or empty>
form: <form name, or empty>
note: <compliance/SLA/extra notes, or empty>
[/STEP]

═══ RULES ═══

1. COMPLETENESS — output every step, actor, time, condition, form. Omit nothing meaningful.
2. VERBATIM — copy values exactly. Keep IDs ("STEP-3.c"), durations ("4-6 minutes"), role names ("Concerned Physician") unchanged.
3. LANGUAGE — preserve the document's original language. Do NOT translate. Tag names (DOC, STEP, etc.) stay in English.
4. ORDER — preserve original step/section order.
5. OMIT only: page numbers, headers/footers, decorative shapes, "Begin"/"End" terminals.
6. FIELDS — if a field is absent, write empty value (e.g. "form: "). Never invent.
7. MULTI-VALUE TIME — join with " | " (e.g. "time: Next day | Within 6 hours").

═══ MINIMAL EXAMPLE ═══

[DOC] title=Customer Complaint Handling | lang=en
[META] field=Doc No | value=SOP-CS-001
[META] field=Revision | value=2

[SEC] id=1 | title=Intake

[INFO] type=purpose | sec=Intake
Ensure every customer complaint is logged within one business day.
[/INFO]

[STEP] id=1.1 | sec=Intake
actor: Front Desk Officer | Supervisor
action: Receive complaint via phone, email, or in-person. Fill Form CC-01 with complainant name, contact, and complaint summary.
time: Within 15 minutes
cond: 
form: CC-01
note: 
[/STEP]

[STEP] id=1.2 | sec=Intake
actor: Supervisor | 
action: Review and categorize complaint as Minor, Major, or Critical.
time: Within 1 hour
cond: If Critical -> escalate to Manager immediately. If Minor/Major -> assign to handler.
form: 
note: 
[/STEP]

═══

Now convert the provided document. Output ONLY the structured text in the schema above — no preamble, no markdown fences.`;

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
                  text: 'Convert this SOP into the structured tag-based text format defined in the system prompt. Include every step, actor, time, condition, and form. Preserve original language and order. Output the structured text only.',
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

      this.logger.log(
        `[EXTRACT] ✅ Tokens — input: ${tokens.prompt_tokens}, output: ${tokens.completion_tokens}`,
      );
      this.logger.log(
        `[EXTRACT] ✅ Finish: ${finishReason} | Length: ${result.length} chars`,
      );

      if (finishReason === 'length') {
        this.logger.warn(
          `[EXTRACT] ⚠️ Output truncated. Increase max_completion_tokens.`,
        );
      }

      if (result.trim().length < 30) {
        this.logger.error(`[EXTRACT] ❌ Result too short: "${result}"`);
        throw new Error('LLM returned empty or too short result');
      }

      return result.trim();
    } catch (e: any) {
      if (e.response) {
        const status = e.response.status;
        const errorData = e.response.data?.error;
        const errorMessage = errorData?.message ?? 'No message';

        this.logger.error(
          `[EXTRACT] ❌ OpenAI API Error (${status}): ${errorMessage}`,
        );
        this.logger.error(
          `[EXTRACT] Body: ${JSON.stringify(e.response.data).slice(0, 500)}`,
        );
        throw new BadRequestException(
          `Gagal extract PDF (${status}): ${errorMessage}`,
        );
      } else if (e.code === 'ECONNABORTED' || e.message?.includes('timeout')) {
        this.logger.error(`[EXTRACT] ❌ Timeout`);
        throw new BadRequestException('Gagal extract PDF: timeout');
      } else if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
        this.logger.error(`[EXTRACT] ❌ Network error: ${e.code}`);
        throw new BadRequestException(
          'Gagal extract PDF: tidak bisa terhubung ke OpenAI API',
        );
      } else {
        this.logger.error(`[EXTRACT] ❌ Unexpected: ${e.message}`);
        throw new BadRequestException('Gagal extract PDF: ' + e.message);
      }
    }
  }
}
