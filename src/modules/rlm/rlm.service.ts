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
    sopDocumentId: number,
    userQuestion: string,
  ): Promise<SendMessageResult> {
    // 1. Ambil dokumen SOP
    const sopDocument = await this.sopDocumentsService.findById(sopDocumentId);
    if (!sopDocument) {
      throw new NotFoundException(
        `Dokumen SOP dengan id ${sopDocumentId} tidak ditemukan`,
      );
    }

    // 2. Simpan pesan USER ke database
    const userMessage = await this.chatService.saveMessage(
      sessionId,
      userQuestion,
      MessageRole.USER,
      0,
      0,
    );

    // 3. Setup REPL Environment dengan dokumen SOP
    const repl = new ReplEnvironment();
    repl.loadDocument(sopDocument.content);

    // 4. Proses pertanyaan dengan RLM Engine
    const rlmResult = await this.rlmEngine.process(userQuestion, repl);

    // 5. Simpan pesan ASSISTANT ke database
    const assistantMessage = await this.chatService.saveMessage(
      sessionId,
      rlmResult.answer,
      MessageRole.ASSISTANT,
      rlmResult.totalInputTokens,
      rlmResult.totalOutputTokens,
    );

    // 6. Simpan SubQueryResult ke database
    for (const subQuery of rlmResult.subQueryResults) {
      const subQueryResult = this.subQueryRepository.create({
        sub_question: subQuery.subQuestion,
        answer: subQuery.answer,
        tokens_used: subQuery.tokensUsed,
        depth: subQuery.depth,
        message: assistantMessage,
      });
      await this.subQueryRepository.save(subQueryResult);
    }

    // 7. Simpan TokenUsageLog ke database
    const tokenLog = this.tokenLogRepository.create({
      method: TokenMethod.RLM,
      input_tokens: rlmResult.totalInputTokens,
      output_tokens: rlmResult.totalOutputTokens,
      rlm_depth: rlmResult.depth,
      message: assistantMessage,
    });
    await this.tokenLogRepository.save(tokenLog);

    // Bagian return di rlm.service.ts — update tokenUsage
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
      },
    };
  }

  // Ambil detail sub query result per message
  async getSubQueryResults(messageId: number): Promise<SubQueryResult[]> {
    return this.subQueryRepository.find({
      where: { message: { id: messageId } },
      order: { depth: 'ASC', created_at: 'ASC' },
    });
  }

  // Ambil token usage log per message
  async getTokenUsageLog(messageId: number): Promise<TokenUsageLog | null> {
    return this.tokenLogRepository.findOne({
      where: { message: { id: messageId } },
    });
  }
}
