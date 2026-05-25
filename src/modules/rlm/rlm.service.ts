// FILE: src/modules/rlm/rlm.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubQueryResult } from './entities/sub-query-result.entity';
import { TokenUsageLog, TokenMethod } from './entities/token-usage-log.entity';
import { RlmEngine } from './rlm.engine';
import { ReplEnvironment } from './repl.environment';
import { LlmApiClient, ChatMessage } from './llm-api.client';
import {
  ConventionalService,
  ConventionalResult,
} from './conventional.service';
import { ChatService } from '../chat/chat.service';
import { SopDocumentsService } from '../sop-documents/sop-documents.service';
import { MessageRole } from '../chat/entities/message.entity';
import { calcTokenCost, formatUsd } from './helpers/token-price.helper';

export type IntentType = 'CHITCHAT' | 'SOP_QUERY';

export interface TokenComparisonResult {
  message_id: number;
  rlm: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    rlm_depth: number;
    root_input_tokens: number;
    root_output_tokens: number;
    root_cached_input_tokens: number;
    sub_input_tokens: number;
    sub_output_tokens: number;
    sub_cached_input_tokens: number;
    cache_hit_rate: string;
    response_time_ms: number;
    cost: {
      root: {
        input_cost_usd: string;
        output_cost_usd: string;
        total_cost_usd: string;
      };
      sub: {
        input_cost_usd: string;
        output_cost_usd: string;
        total_cost_usd: string;
      };
      total_cost_usd: string;
    };
  };
  conv: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cached_input_tokens: number;
    answer: string | null;
    error_message: string | null;
    cache_hit_rate: string;
    response_time_ms: number;
    cost: {
      input_cost_usd: string;
      output_cost_usd: string;
      total_cost_usd: string;
    };
  };
  comparison: {
    token_savings: number;
    efficiency_ratio: number;
    percentage_saved: string;
    cost_savings_usd: string;
    response_time_diff_ms: number;
    response_time_faster: 'RLM' | 'CONV' | 'SAMA';
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
    root_input_tokens: number;
    root_output_tokens: number;
    root_cached_input_tokens: number;
    sub_input_tokens: number;
    sub_output_tokens: number;
    sub_cached_input_tokens: number;
    rlm_depth: number;
    response_time_ms: number;
  };
  convTokenUsage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    response_time_ms: number;
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
const ENABLE_CONV = 'true';

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

  // ── Toggle: nyalakan true untuk uji perbandingan dengan CONV ──

  // ══════════════════════════════════════════════════════
  // INTENT CLASSIFIER (language-agnostic)
  // ══════════════════════════════════════════════════════

  private async classifyIntent(
    userQuestion: string,
    chatHistory: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<IntentType> {
    const historyPreview =
      chatHistory.length > 0
        ? `\nRecent context:\n${chatHistory
            .slice(-4)
            .map((m) => `${m.role}: ${m.content.slice(0, 100)}`)
            .join('\n')}`
        : '';

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Classify the message into exactly one label:
CHITCHAT = greetings, thanks, small talk, self-introduction, or pleasantries that do NOT require any SOP/procedure information (e.g., "halo", "terima kasih", "siapa kamu?").
SOP_QUERY = any substantive question, including follow-ups that reference prior turns (e.g., "jelaskan lagi", "berikan contohnya", "bagaimana prosedur cuti?"). When in doubt, choose SOP_QUERY.
Reply with ONE word only.`,
      },
      {
        role: 'user',
        content: `${historyPreview}\n\nMessage: "${userQuestion}"`,
      },
    ];

    try {
      const response = await this.llmApiClient.queryNano(messages);
      const raw = response.content.trim().toUpperCase();

      if (!raw) {
        console.log(
          '[INTENT] Empty response from classifier, defaulting to SOP_QUERY',
        );
        return 'SOP_QUERY';
      }

      console.log(`[INTENT] Classified as: ${raw}`);
      if (raw.includes('CHITCHAT')) return 'CHITCHAT';
      return 'SOP_QUERY';
    } catch {
      console.log('[INTENT] Classification failed, defaulting to SOP_QUERY');
      return 'SOP_QUERY';
    }
  }

  // ══════════════════════════════════════════════════════
  // CHITCHAT HANDLER (language-agnostic)
  // ══════════════════════════════════════════════════════

  private async answerChitchat(
    userQuestion: string,
    chatHistory: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<{
    content: string;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
  }> {
    console.log('[RLM SERVICE] 💬 Handling as CHITCHAT');

    const recentHistory = chatHistory.slice(-2).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content.slice(0, 100),
    }));

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are SOP Intellect, a friendly HR assistant. Reply briefly and naturally in the SAME language as the user's message. Max 2 sentences.`,
      },
      ...recentHistory,
      { role: 'user' as const, content: userQuestion },
    ];

    return this.llmApiClient.queryNanoShort(messages);
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
    let rootInputTokens = 0;
    let rootOutputTokens = 0;
    let rootCachedInputTokens = 0;
    let subInputTokens = 0;
    let subOutputTokens = 0;
    let subCachedInputTokens = 0;
    let totalIterations = 1;
    let rlmDepth = 1;
    let subQueryResults: any[] = [];
    let references: string[] = [];
    let execLog: string[] = [];
    let selectedDocumentIds: number[] = [];
    let convResult: ConventionalResult | null = null;

    // ── Response time trackers ──────────────────────
    let rlmResponseTimeMs = 0;
    let convResponseTimeMs = 0;

    if (intent === 'CHITCHAT') {
      const t0 = Date.now();
      const result = await this.answerChitchat(userQuestion, chatHistory);
      rlmResponseTimeMs = Date.now() - t0;

      answerContent = result.content;
      totalInputTokens = result.input_tokens;
      totalOutputTokens = result.output_tokens;
      rootInputTokens = result.input_tokens;
      rootOutputTokens = result.output_tokens;
      rootCachedInputTokens = result.cached_input_tokens;
    } else {
      // ── SOP_QUERY → run RLM & CONV in parallel, measure each independently ──
      const allDocuments = await this.sopDocumentsService.findAllMetadata();
      console.log(`[RLM SERVICE] 📋 Found ${allDocuments.length} documents`);

      const trimmedHistory = chatHistory.slice(-4).map((m) => ({
        role: m.role,
        content:
          m.role === 'assistant'
            ? m.content.slice(0, 800) +
              (m.content.length > 800 ? '\n...[truncated]' : '')
            : m.content,
      }));

      const repl = new ReplEnvironment();

      console.log(
        `[RLM SERVICE] ⚡ Running RLM${ENABLE_CONV ? ' & CONV in parallel' : ' only (CONV disabled)'}...`,
      );

      // RLM selalu jalan
      const rlmPromise = (async () => {
        const t0 = Date.now();
        const result = await this.rlmEngine.process(
          userQuestion,
          repl,
          allDocuments,
          async (id: number) => {
            const doc = await this.sopDocumentsService.findById(id);
            if (!doc) throw new Error(`Document id=${id} not found`);
            return doc.content;
          },
          trimmedHistory,
        );
        return { result, elapsed: Date.now() - t0 };
      })();

      // CONV hanya jalan jika ENABLE_CONV = true
      const convPromise = ENABLE_CONV
        ? (async () => {
            const t0 = Date.now();
            const result = await this.conventionalService.process(
              userQuestion,
              trimmedHistory,
            );
            return { result, elapsed: Date.now() - t0 };
          })()
        : Promise.resolve(null);

      const [rlmWrapped, convWrapped] = await Promise.all([
        rlmPromise,
        convPromise,
      ]);

      const rlmResult = rlmWrapped.result;
      rlmResponseTimeMs = rlmWrapped.elapsed;

      if (convWrapped !== null) {
        convResponseTimeMs = convWrapped.elapsed;
        convResult = convWrapped.result;
      } else {
        convResponseTimeMs = 0;
        convResult = null;
      }

      answerContent = rlmResult.answer;
      totalInputTokens = rlmResult.totalInputTokens;
      totalOutputTokens = rlmResult.totalOutputTokens;
      rootInputTokens = rlmResult.rootInputTokens;
      rootOutputTokens = rlmResult.rootOutputTokens;
      rootCachedInputTokens = rlmResult.rootCachedInputTokens;
      subInputTokens = rlmResult.subInputTokens;
      subOutputTokens = rlmResult.subOutputTokens;
      subCachedInputTokens = rlmResult.subCachedInputTokens;
      totalIterations = rlmResult.totalIterations;
      rlmDepth = rlmResult.depth;
      subQueryResults = rlmResult.subQueryResults;
      references = rlmResult.references;
      execLog = rlmResult.execLog;
      selectedDocumentIds = rlmResult.selectedDocumentIds;

      console.log(
        `[RLM SERVICE] ⏱  RLM: ${rlmResponseTimeMs}ms | CONV: ${convResponseTimeMs}ms`,
      );
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

    // ── Simpan RLM token log ──
    console.log(
      `[RLM SERVICE] 💾 RLM log → root_in=${rootInputTokens} root_out=${rootOutputTokens} sub_in=${subInputTokens} sub_out=${subOutputTokens} time=${rlmResponseTimeMs}ms`,
    );
    await this.tokenLogRepository.save(
      this.tokenLogRepository.create({
        method: TokenMethod.RLM,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        root_input_tokens: rootInputTokens,
        root_output_tokens: rootOutputTokens,
        root_cached_input_tokens: rootCachedInputTokens,
        sub_input_tokens: subInputTokens,
        sub_output_tokens: subOutputTokens,
        sub_cached_input_tokens: subCachedInputTokens,
        response_time_ms: rlmResponseTimeMs,
        rlm_depth: rlmDepth,
        conv_answer: null,
        error_message: null,
        message: assistantMessage,
      }),
    );

    // ── Simpan CONV token log (hanya untuk SOP_QUERY) ──
    if (intent === 'SOP_QUERY' && convResult !== null) {
      console.log(
        `[RLM SERVICE] 💾 CONV log → in=${convResult.input_tokens} out=${convResult.output_tokens} time=${convResponseTimeMs}ms`,
      );
      await this.tokenLogRepository.save(
        this.tokenLogRepository.create({
          method: TokenMethod.CONV,
          input_tokens: convResult.input_tokens,
          output_tokens: convResult.output_tokens,
          root_input_tokens: convResult.input_tokens,
          root_output_tokens: convResult.output_tokens,

          // PERBAIKAN: Pastikan tidak ada properti 'cached' yang terselip dari convResult
          root_cached_input_tokens: 0,

          sub_input_tokens: 0,
          sub_output_tokens: 0,
          sub_cached_input_tokens: 0,
          response_time_ms: convResponseTimeMs,
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
        root_input_tokens: rootInputTokens,
        root_output_tokens: rootOutputTokens,
        root_cached_input_tokens: rootCachedInputTokens,
        sub_input_tokens: subInputTokens,
        sub_output_tokens: subOutputTokens,
        sub_cached_input_tokens: subCachedInputTokens,
        rlm_depth: rlmDepth,
        response_time_ms: rlmResponseTimeMs,
      },
      convTokenUsage:
        convResult !== null
          ? {
              input_tokens: convResult.input_tokens,
              output_tokens: convResult.output_tokens,
              total_tokens: convResult.input_tokens + convResult.output_tokens,
              response_time_ms: convResponseTimeMs,
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

    if (!rlmLog)
      throw new NotFoundException(
        `Token log RLM tidak ditemukan untuk message id=${messageId}`,
      );
    if (!convLog)
      throw new NotFoundException(
        `Token log CONV tidak ditemukan untuk message id=${messageId}. Pastikan pesan ini adalah SOP_QUERY.`,
      );

    const rlmTotal = rlmLog.input_tokens + rlmLog.output_tokens;
    const convTotal = convLog.input_tokens + convLog.output_tokens;
    const savings = convTotal - rlmTotal;
    const ratio = rlmTotal > 0 ? convTotal / rlmTotal : 0;
    const percentSaved =
      convTotal > 0 ? ((savings / convTotal) * 100).toFixed(1) + '%' : '0%';
    const rlmTotalCached =
      rlmLog.root_cached_input_tokens + rlmLog.sub_cached_input_tokens;
    const rlmCacheHitPct =
      rlmLog.input_tokens > 0
        ? ((rlmTotalCached / rlmLog.input_tokens) * 100).toFixed(1) + '%'
        : '0.0%';

    const convCacheHitPct =
      convLog.input_tokens > 0
        ? (
            (convLog.root_cached_input_tokens / convLog.input_tokens) *
            100
          ).toFixed(1) + '%'
        : '0.0%';

    const rlmCost = calcTokenCost({
      root_input_tokens: rlmLog.root_input_tokens,
      root_output_tokens: rlmLog.root_output_tokens,
      root_cached_input_tokens: rlmLog.root_cached_input_tokens,
      sub_input_tokens: rlmLog.sub_input_tokens,
      sub_output_tokens: rlmLog.sub_output_tokens,
      sub_cached_input_tokens: rlmLog.sub_cached_input_tokens,
    });
    const convCost = calcTokenCost({
      root_input_tokens: convLog.root_input_tokens,
      root_output_tokens: convLog.root_output_tokens,
      root_cached_input_tokens: convLog.root_cached_input_tokens ?? 0,
      sub_input_tokens: 0,
      sub_output_tokens: 0,
    });
    const costSavings = convCost.total_cost_usd - rlmCost.total_cost_usd;

    // Response time comparison
    const rlmTime = rlmLog.response_time_ms ?? 0;
    const convTime = convLog.response_time_ms ?? 0;
    const timeDiff = Math.abs(rlmTime - convTime);
    const timeFaster: 'RLM' | 'CONV' | 'SAMA' =
      timeDiff === 0 ? 'SAMA' : rlmTime < convTime ? 'RLM' : 'CONV';

    return {
      message_id: messageId,
      rlm: {
        input_tokens: rlmLog.input_tokens,
        output_tokens: rlmLog.output_tokens,
        total_tokens: rlmTotal,
        rlm_depth: rlmLog.rlm_depth,
        root_input_tokens: rlmLog.root_input_tokens,
        root_output_tokens: rlmLog.root_output_tokens,
        root_cached_input_tokens: rlmLog.root_cached_input_tokens,
        sub_input_tokens: rlmLog.sub_input_tokens,
        sub_cached_input_tokens: rlmLog.sub_cached_input_tokens,
        sub_output_tokens: rlmLog.sub_output_tokens,
        cache_hit_rate: rlmCacheHitPct,
        response_time_ms: rlmTime,
        cost: {
          root: {
            input_cost_usd: formatUsd(rlmCost.root.input_cost_usd),
            output_cost_usd: formatUsd(rlmCost.root.output_cost_usd),
            total_cost_usd: formatUsd(rlmCost.root.total_cost_usd),
          },
          sub: {
            input_cost_usd: formatUsd(rlmCost.sub.input_cost_usd),
            output_cost_usd: formatUsd(rlmCost.sub.output_cost_usd),
            total_cost_usd: formatUsd(rlmCost.sub.total_cost_usd),
          },
          total_cost_usd: formatUsd(rlmCost.total_cost_usd),
        },
      },
      conv: {
        input_tokens: convLog.input_tokens,
        output_tokens: convLog.output_tokens,
        cached_input_tokens: convLog.root_cached_input_tokens,
        cache_hit_rate: convCacheHitPct,
        total_tokens: convTotal,
        answer: convLog.conv_answer,
        error_message: convLog.error_message,
        response_time_ms: convTime,
        cost: {
          input_cost_usd: formatUsd(convCost.root.input_cost_usd),
          output_cost_usd: formatUsd(convCost.root.output_cost_usd),
          total_cost_usd: formatUsd(convCost.total_cost_usd),
        },
      },
      comparison: {
        token_savings: savings,
        efficiency_ratio: Math.round(ratio * 100) / 100,
        percentage_saved: percentSaved,
        cost_savings_usd: formatUsd(costSavings),
        response_time_diff_ms: timeDiff,
        response_time_faster: timeFaster,
      },
    };
  }
}
