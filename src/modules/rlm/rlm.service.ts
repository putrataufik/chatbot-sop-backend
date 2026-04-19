// FILE: src/modules/rlm/rlm.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubQueryResult } from './entities/sub-query-result.entity';
import { TokenUsageLog, TokenMethod } from './entities/token-usage-log.entity';
import { RlmEngine } from './rlm.engine';
import { ReplEnvironment } from './repl.environment';
import { LlmApiClient } from './llm-api.client';
import { ChatService } from '../chat/chat.service';
import { SopDocumentsService } from '../sop-documents/sop-documents.service';
import { MessageRole } from '../chat/entities/message.entity';

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

  async sendMessage(
    sessionId: number,
    userQuestion: string,
  ): Promise<SendMessageResult> {
    const allDocuments = await this.sopDocumentsService.findAllMetadata();
    console.log(`[RLM SERVICE] 📋 Found ${allDocuments.length} documents`);

    // ── Ambil 2 pesan terakhir saja ───────────────────
    const previousMessages = await this.chatService.getRecentMessages(
      sessionId,
      2,
    );
    const chatHistory: { role: 'user' | 'assistant'; content: string }[] =
      previousMessages.map((msg) => ({
        role: msg.role === MessageRole.USER ? 'user' : 'assistant',
        content: msg.content,
      }));
    // ─────────────────────────────────────────────────

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
      chatHistory, // ← pass di sini
    );

    const assistantMessage = await this.chatService.saveMessage(
      sessionId,
      rlmResult.answer,
      MessageRole.ASSISTANT,
      rlmResult.totalInputTokens,
      rlmResult.totalOutputTokens,
    );

    for (const subQuery of rlmResult.subQueryResults) {
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

    await this.tokenLogRepository.save(
      this.tokenLogRepository.create({
        method: TokenMethod.RLM,
        input_tokens: rlmResult.totalInputTokens,
        output_tokens: rlmResult.totalOutputTokens,
        rlm_depth: rlmResult.depth,
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
        method: TokenMethod.RLM,
        input_tokens: rlmResult.totalInputTokens,
        output_tokens: rlmResult.totalOutputTokens,
        rlm_depth: rlmResult.depth,
      },
      meta: {
        totalIterations: rlmResult.totalIterations,
        subQueryCount: rlmResult.subQueryResults.length,
        references: rlmResult.references,
        execLog: rlmResult.execLog,
        selectedDocumentIds: rlmResult.selectedDocumentIds,
      },
    };
  }
  
  private generateTitle(question: string): string {
    const max = 100;
    if (question.length <= max) return question;
    const trimmed = question.substring(0, max);
    const lastSpace = trimmed.lastIndexOf(' ');
    return lastSpace > 0 ? trimmed.substring(0, lastSpace) + '...' : trimmed + '...';
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
