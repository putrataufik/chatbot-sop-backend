import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubQueryResult } from './entities/sub-query-result.entity';
import { TokenUsageLog, TokenMethod } from './entities/token-usage-log.entity';
import { RlmEngine } from './rlm.engine';
import { ReplEnvironment } from './repl.environment';
import { LlmApiClient, ChatMessage } from './llm-api.client';
import { ConventionalService, ConventionalResult } from './conventional.service';
import { ChatService } from '../chat/chat.service';
import { SopDocumentsService } from '../sop-documents/sop-documents.service';
import { MessageRole } from '../chat/entities/message.entity';

export type IntentType = 'CHITCHAT' | 'CONTEXTUAL' | 'SOP_QUERY';

export interface TokenComparisonResult {
  message_id: number;
  rlm: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    rlm_depth: number;
  };
  conv: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    answer: string | null;
    error_message: string | null;
  };
  comparison: {
    token_savings: number;
    efficiency_ratio: number;
    percentage_saved: string;
  };
}

export interface SendMessageResult {
  userMessage: {
    id: number;
    role: string;
    content: string;
    timestamp: Date;
  };
  assistantMessage: {
    id: number;
    role: string;
    content: string;
    input_tokens: number;
    output_tokens: number;
    timestamp: Date;
  };
  tokenUsage: {
    method: string;
    input_tokens: number;
    output_tokens: number;
    rlm_depth: number;
  };
  convTokenUsage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    error_message: string | null;
  } | null;
  meta: {
    totalIterations: number;
    subQueryCount: number;
    references: string[];
    execLog: string[];
    selectedDocumentIds: number[];
    intent: IntentType;
  };
}

@Injectable()
export class RlmService {
  constructor(
    @InjectRepository(SubQueryResult)
    private subQueryRepository: Repository<SubQueryResult>,

    @InjectRepository(TokenUsageLog)
    private tokenLogRepository: Repository<TokenUsageLog>,

    private rlmEngine: RlmEngine,
    private llmApiClient: LlmApiClient,
    private conventionalService: ConventionalService,
    private chatService: ChatService,
    private sopDocumentsService: SopDocumentsService,
  ) {}

  // ══════════════════════════════════════════════════════
  // INTENT CLASSIFIER
  // ══════════════════════════════════════════════════════

  private async classifyIntent(
    userQuestion: string,
    chatHistory: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<IntentType> {
    const historyPreview =
      chatHistory.length > 0
        ? `\nKonteks singkat percakapan:\n${chatHistory
            .slice(-4)
            .map(
              (m) =>
                `${m.role === 'user' ? 'User' : 'Asisten'}: ${m.content.slice(0, 100)}`,
            )
            .join('\n')}`
        : '';

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Klasifikasikan pesan ke: CHITCHAT, CONTEXTUAL, atau SOP_QUERY.
CHITCHAT=sapaan/terima kasih/basa-basi. CONTEXTUAL=lanjutan percakapan. SOP_QUERY=pertanyaan SOP/prosedur baru.
Balas HANYA satu kata.`,
      },
      {
        role: 'user',
        content: `${historyPreview}\n\nPesan: "${userQuestion}"`,
      },
    ];

    try {
      const response = await this.llmApiClient.queryNano(messages);
      const raw = response.content.trim().toUpperCase();
      console.log(`[INTENT] Classified as: ${raw}`);

      if (raw.includes('CHITCHAT')) return 'CHITCHAT';
      if (raw.includes('CONTEXTUAL')) return 'CONTEXTUAL';
      return 'SOP_QUERY';
    } catch {
      console.log('[INTENT] Classification failed, defaulting to SOP_QUERY');
      return 'SOP_QUERY';
    }
  }

  // ══════════════════════════════════════════════════════
  // CHITCHAT HANDLER
  // ══════════════════════════════════════════════════════

  private async answerChitchat(
  userQuestion: string,
  chatHistory: { role: 'user' | 'assistant'; content: string }[],
): Promise<{ content: string; input_tokens: number; output_tokens: number }> {
  console.log('[RLM SERVICE] 💬 Handling as CHITCHAT');

  const recentHistory = chatHistory.slice(-2).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.slice(0, 100),
  }));

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Asisten HR ramah bernama SOP Intellect. Balas singkat dan natural dalam Bahasa Indonesia. Maksimal 2 kalimat.`,
    },
    ...recentHistory,
    {
      role: 'user' as const,
      content: userQuestion,
    },
  ];

  return this.llmApiClient.queryNanoShort(messages);
}

  // ══════════════════════════════════════════════════════
  // CONTEXTUAL HANDLER
  // ══════════════════════════════════════════════════════

  private async answerContextual(
    userQuestion: string,
    chatHistory: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<{ content: string; input_tokens: number; output_tokens: number }> {
    const trimmedHistory = chatHistory.slice(-6).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content:
        m.role === 'assistant'
          ? m.content.slice(0, 1500) +
            (m.content.length > 1500 ? '\n...[dipotong]' : '')
          : m.content,
    }));

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Kamu adalah asisten HR bernama SOP Intellect. Jawab berdasarkan konteks percakapan. Gunakan Markdown.`,
      },
      ...trimmedHistory,
      { role: 'user' as const, content: userQuestion },
    ];

    return this.llmApiClient.queryMiniLM(messages);
  }

  // ══════════════════════════════════════════════════════
  // MAIN SEND MESSAGE
  // ══════════════════════════════════════════════════════

  async sendMessage(
    sessionId: number,
    userQuestion: string,
  ): Promise<SendMessageResult> {
    const previousMessages = await this.chatService.getRecentMessages(
      sessionId,
      6,
    );
    const chatHistory: { role: 'user' | 'assistant'; content: string }[] =
      previousMessages.map((msg) => ({
        role: msg.role === MessageRole.USER ? 'user' : 'assistant',
        content: msg.content,
      }));

    console.log(
      `\n[RLM SERVICE] 📨 New message: "${userQuestion.slice(0, 100)}"`,
    );
    console.log(`[RLM SERVICE] 📜 History: ${chatHistory.length} messages`);

    if (previousMessages.length === 0) {
      await this.chatService.updateSessionTitle(
        sessionId,
        this.generateTitle(userQuestion),
      );
    }

    const userMessage = await this.chatService.saveMessage(
      sessionId,
      userQuestion,
      MessageRole.USER,
      0,
      0,
    );

    const intent = await this.classifyIntent(userQuestion, chatHistory);
    console.log(`[RLM SERVICE] 🎯 Intent: ${intent}`);

    let answerContent: string;
    let totalInputTokens: number;
    let totalOutputTokens: number;
    let totalIterations = 1;
    let rlmDepth = 1;
    let subQueryResults: any[] = [];
    let references: string[] = [];
    let execLog: string[] = [];
    let selectedDocumentIds: number[] = [];
    let convResult: ConventionalResult | null = null;

    if (intent === 'CHITCHAT') {
      const result = await this.answerChitchat(userQuestion, chatHistory);
      answerContent = result.content;
      totalInputTokens = result.input_tokens;
      totalOutputTokens = result.output_tokens;
    } else if (intent === 'CONTEXTUAL') {
      const result = await this.answerContextual(userQuestion, chatHistory);
      answerContent = result.content;
      totalInputTokens = result.input_tokens;
      totalOutputTokens = result.output_tokens;
    } else {
      // SOP_QUERY → run RLM & CONV in parallel
      const allDocuments = await this.sopDocumentsService.findAllMetadata();
      console.log(`[RLM SERVICE] 📋 Found ${allDocuments.length} documents`);

      const trimmedHistory = chatHistory.slice(-4).map((m) => ({
        role: m.role,
        content:
          m.role === 'assistant'
            ? m.content.slice(0, 1000) +
              (m.content.length > 1000 ? '\n...[dipotong]' : '')
            : m.content,
      }));

      const repl = new ReplEnvironment();

      console.log('[RLM SERVICE] ⚡ Running RLM & CONV in parallel...');
      const [rlmResult, convResultParallel] = await Promise.all([
        this.rlmEngine.process(
          userQuestion,
          repl,
          allDocuments,
          async (id: number) => {
            const doc = await this.sopDocumentsService.findById(id);
            if (!doc) throw new Error(`Document id=${id} not found`);
            return doc.content;
          },
          trimmedHistory,
        ),
        this.conventionalService.process(userQuestion, trimmedHistory),
      ]);

      answerContent = rlmResult.answer;
      totalInputTokens = rlmResult.totalInputTokens;
      totalOutputTokens = rlmResult.totalOutputTokens;
      totalIterations = rlmResult.totalIterations;
      rlmDepth = rlmResult.depth;
      subQueryResults = rlmResult.subQueryResults;
      references = rlmResult.references;
      execLog = rlmResult.execLog;
      selectedDocumentIds = rlmResult.selectedDocumentIds;
      convResult = convResultParallel;
    }

    // Simpan pesan asisten
    const assistantMessage = await this.chatService.saveMessage(
      sessionId,
      answerContent,
      MessageRole.ASSISTANT,
      totalInputTokens,
      totalOutputTokens,
    );

    // Simpan sub query results (hanya untuk SOP_QUERY)
    if (intent === 'SOP_QUERY') {
      for (const subQuery of subQueryResults) {
        await this.subQueryRepository.save(
          this.subQueryRepository.create({
            sub_question: subQuery.subQuestion,
            answer: subQuery.answer,
            tokens_used: subQuery.tokensUsed,
            depth: subQuery.depth,
            message: assistantMessage,
          }),
        );
      }
    }

    // Simpan RLM token log
    await this.tokenLogRepository.save(
      this.tokenLogRepository.create({
        method: TokenMethod.RLM,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        rlm_depth: rlmDepth,
        conv_answer: null,
        error_message: null,
        message: assistantMessage,
      }),
    );

    // Simpan CONV token log (hanya untuk SOP_QUERY)
    if (intent === 'SOP_QUERY' && convResult !== null) {
      await this.tokenLogRepository.save(
        this.tokenLogRepository.create({
          method: TokenMethod.CONV,
          input_tokens: convResult.input_tokens,
          output_tokens: convResult.output_tokens,
          rlm_depth: 0,
          conv_answer: convResult.content || null,
          error_message: convResult.error_message,
          message: assistantMessage,
        }),
      );
    }

    return {
      userMessage: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        timestamp: userMessage.timestamp,
      },
      assistantMessage: {
        id: assistantMessage.id,
        role: assistantMessage.role,
        content: assistantMessage.content,
        input_tokens: assistantMessage.input_tokens,
        output_tokens: assistantMessage.output_tokens,
        timestamp: assistantMessage.timestamp,
      },
      tokenUsage: {
        method: TokenMethod.RLM,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        rlm_depth: rlmDepth,
      },
      convTokenUsage:
        convResult !== null
          ? {
              input_tokens: convResult.input_tokens,
              output_tokens: convResult.output_tokens,
              total_tokens: convResult.input_tokens + convResult.output_tokens,
              error_message: convResult.error_message,
            }
          : null,
      meta: {
        totalIterations,
        subQueryCount: subQueryResults.length,
        references,
        execLog,
        selectedDocumentIds,
        intent,
      },
    };
  }

  // ══════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════

  private generateTitle(question: string): string {
    const max = 100;
    if (question.length <= max) return question;
    const trimmed = question.substring(0, max);
    const lastSpace = trimmed.lastIndexOf(' ');
    return lastSpace > 0
      ? trimmed.substring(0, lastSpace) + '...'
      : trimmed + '...';
  }

  async getSubQueryResults(messageId: number): Promise<SubQueryResult[]> {
    return this.subQueryRepository.find({
      where: { message: { id: messageId } },
      order: { depth: 'ASC', created_at: 'ASC' },
    });
  }

  async getTokenUsageLogs(messageId: number): Promise<TokenUsageLog[]> {
    return this.tokenLogRepository.find({
      where: { message: { id: messageId } },
    });
  }

  async getTokenComparison(messageId: number): Promise<TokenComparisonResult> {
    const logs = await this.tokenLogRepository.find({
      where: { message: { id: messageId } },
    });

    const rlmLog = logs.find((l) => l.method === TokenMethod.RLM);
    const convLog = logs.find((l) => l.method === TokenMethod.CONV);

    if (!rlmLog) {
      throw new NotFoundException(
        `Token log RLM tidak ditemukan untuk message id=${messageId}`,
      );
    }
    if (!convLog) {
      throw new NotFoundException(
        `Token log CONV tidak ditemukan untuk message id=${messageId}. Pastikan pesan ini adalah SOP_QUERY.`,
      );
    }

    const rlmTotal = rlmLog.input_tokens + rlmLog.output_tokens;
    const convTotal = convLog.input_tokens + convLog.output_tokens;
    const savings = convTotal - rlmTotal;
    const ratio = rlmTotal > 0 ? convTotal / rlmTotal : 0;
    const percentSaved =
      convTotal > 0 ? ((savings / convTotal) * 100).toFixed(1) + '%' : '0%';

    return {
      message_id: messageId,
      rlm: {
        input_tokens: rlmLog.input_tokens,
        output_tokens: rlmLog.output_tokens,
        total_tokens: rlmTotal,
        rlm_depth: rlmLog.rlm_depth,
      },
      conv: {
        input_tokens: convLog.input_tokens,
        output_tokens: convLog.output_tokens,
        total_tokens: convTotal,
        answer: convLog.conv_answer,
        error_message: convLog.error_message,
      },
      comparison: {
        token_savings: savings,
        efficiency_ratio: Math.round(ratio * 100) / 100,
        percentage_saved: percentSaved,
      },
    };
  }
}
