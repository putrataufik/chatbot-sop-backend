import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubQueryResult } from './entities/sub-query-result.entity';
import { TokenUsageLog, TokenMethod } from './entities/token-usage-log.entity';
import { RlmEngine } from './rlm.engine';
import { ReplEnvironment } from './repl.environment';
import { LlmApiClient, ChatMessage } from './llm-api.client';
import { ChatService } from '../chat/chat.service';
import { SopDocumentsService } from '../sop-documents/sop-documents.service';
import { MessageRole } from '../chat/entities/message.entity';

export type IntentType = 'CHITCHAT' | 'CONTEXTUAL' | 'SOP_QUERY';

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

  // Ambil 2 pesan terakhir saja, potong konten panjang
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
    // Potong konten assistant yang panjang agar tidak membengkak
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
    // Ambil history percakapan terakhir
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

    // Generate judul sesi dari pesan pertama
    if (previousMessages.length === 0) {
      await this.chatService.updateSessionTitle(
        sessionId,
        this.generateTitle(userQuestion),
      );
    }

    // Simpan pesan user
    const userMessage = await this.chatService.saveMessage(
      sessionId,
      userQuestion,
      MessageRole.USER,
      0,
      0,
    );

    // Klasifikasi intent
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

    // ── Routing berdasarkan intent ──
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
      // SOP_QUERY → full RLM pipeline
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
      const rlmResult = await this.rlmEngine.process(
        userQuestion,
        repl,
        allDocuments,
        async (id: number) => {
          const doc = await this.sopDocumentsService.findById(id);
          if (!doc) throw new Error(`Document id=${id} not found`);
          return doc.content;
        },
        trimmedHistory, // <- pakai trimmedHistory bukan chatHistory
      );

      answerContent = rlmResult.answer;
      totalInputTokens = rlmResult.totalInputTokens;
      totalOutputTokens = rlmResult.totalOutputTokens;
      totalIterations = rlmResult.totalIterations;
      rlmDepth = rlmResult.depth;
      subQueryResults = rlmResult.subQueryResults;
      references = rlmResult.references;
      execLog = rlmResult.execLog;
      selectedDocumentIds = rlmResult.selectedDocumentIds;
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

    // Simpan token usage log
    const method = intent === 'SOP_QUERY' ? TokenMethod.RLM : TokenMethod.CONV;
    await this.tokenLogRepository.save(
      this.tokenLogRepository.create({
        method,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        rlm_depth: rlmDepth,
        message: assistantMessage,
      }),
    );

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
        method,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        rlm_depth: rlmDepth,
      },
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

  async getTokenUsageLog(messageId: number): Promise<TokenUsageLog | null> {
    return this.tokenLogRepository.findOne({
      where: { message: { id: messageId } },
    });
  }
}
