// FILE: src/modules/chat/chat.service.ts

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatSession } from './entities/chat-session.entity';
import { Message, MessageRole } from './entities/message.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { User, UserRole } from '../users/entities/user.entity';
import { calcTokenCost, formatUsd } from '../rlm/helpers/token-price.helper';

@Injectable()
export class ChatService {
  private openai: OpenAI;

  constructor(
    @InjectRepository(ChatSession)
    private sessionRepository: Repository<ChatSession>,

    @InjectRepository(Message)
    private messageRepository: Repository<Message>,

    private config: ConfigService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  // ── Session title generation ───────────────────────────

  async generateSessionTitle(firstMessage: string): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.get<string>('OPENAI_MODEL_NANO') || 'gpt-4o-mini',
        max_tokens: 20,
        messages: [
          {
            role: 'system',
            content:
              'Buat judul singkat (maks 5 kata, bahasa Indonesia) dari pertanyaan berikut. ' +
              'Balas hanya judulnya saja, tanpa tanda kutip, tanpa penjelasan.',
          },
          { role: 'user', content: firstMessage },
        ],
      });
      return response.choices[0]?.message?.content?.trim() || firstMessage.substring(0, 40);
    } catch {
      return firstMessage.substring(0, 40);
    }
  }

  // ── ChatSession ────────────────────────────────────────

  async createSession(
    dto: CreateSessionDto,
    user: User,
  ): Promise<{ message: string; id: number; title: string; status: string; created_at: Date; updated_at: Date }> {
    const session = this.sessionRepository.create({
      title: dto.title || '...',
      user,
    });
    const saved = await this.sessionRepository.save(session);
    return {
      message: 'Session berhasil dibuat',
      id: saved.id,
      title: saved.title,
      status: saved.status,
      created_at: saved.created_at,
      updated_at: saved.updated_at,
    };
  }

  async updateSessionTitle(sessionId: number, title: string): Promise<void> {
    await this.sessionRepository.update(sessionId, { title });
  }

  async findAllSessions(user: User): Promise<any[]> {
    const where =
      user.role === UserRole.ADMIN ? {} : { user: { id: user.id } };

    const sessions = await this.sessionRepository.find({
      where,
      relations: ['user'],
      order: { updated_at: 'DESC' },
    });

    return sessions.map((session) => ({
      id: session.id,
      title: session.title,
      status: session.status,
      created_at: session.created_at,
      updated_at: session.updated_at,
      user: {
        id: session.user.id,
        name: session.user.name,
      },
    }));
  }

  async findSessionById(id: number, user: User): Promise<any> {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['user', 'messages'],
      order: { messages: { timestamp: 'ASC' } },
    });

    if (!session) {
      throw new NotFoundException(`Session dengan id ${id} tidak ditemukan`);
    }

    if (user.role !== UserRole.ADMIN && session.user.id !== user.id) {
      throw new ForbiddenException('Anda tidak memiliki akses ke session ini');
    }

    return {
      id: session.id,
      title: session.title,
      status: session.status,
      created_at: session.created_at,
      updated_at: session.updated_at,
      user: {
        id: session.user.id,
        name: session.user.name,
      },
      messages: session.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        input_tokens: msg.input_tokens,
        output_tokens: msg.output_tokens,
        timestamp: msg.timestamp,
      })),
    };
  }

  async removeSession(id: number, user: User): Promise<{ message: string }> {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!session) {
      throw new NotFoundException(`Session dengan id ${id} tidak ditemukan`);
    }

    if (user.role !== UserRole.ADMIN && session.user.id !== user.id) {
      throw new ForbiddenException('Anda tidak memiliki akses ke session ini');
    }

    await this.sessionRepository.delete(id);
    return { message: 'Session berhasil dihapus' };
  }

  // ── Message ────────────────────────────────────────────

  async saveMessage(
    sessionId: number,
    content: string,
    role: MessageRole,
    inputTokens: number = 0,
    outputTokens: number = 0,
  ): Promise<Message> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['messages'],
    });

    if (!session) {
      throw new NotFoundException(`Session dengan id ${sessionId} tidak ditemukan`);
    }

    if (role === MessageRole.USER && session.messages.length === 0) {
      const title = await this.generateSessionTitle(content);
      await this.sessionRepository.update(sessionId, { title });
    }

    const message = this.messageRepository.create({
      content,
      role,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      session,
    });

    await this.sessionRepository.update(sessionId, { updated_at: new Date() });

    return this.messageRepository.save(message);
  }

  async findMessagesBySession(sessionId: number, user: User): Promise<any[]> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['user'],
    });

    if (!session) {
      throw new NotFoundException(`Session dengan id ${sessionId} tidak ditemukan`);
    }

    if (user.role !== UserRole.ADMIN && session.user.id !== user.id) {
      throw new ForbiddenException('Anda tidak memiliki akses ke session ini');
    }

    const messages = await this.messageRepository.find({
      where: { session: { id: sessionId } },
      order: { timestamp: 'ASC' },
    });

    return messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      input_tokens: msg.input_tokens,
      output_tokens: msg.output_tokens,
      timestamp: msg.timestamp,
    }));
  }

  async getRecentMessages(sessionId: number, limit: number) {
    return this.messageRepository
      .find({
        where: { session: { id: sessionId } },
        order: { timestamp: 'DESC' },
        take: limit,
      })
      .then((msgs) => msgs.reverse());
  }

  // ── Session Token Comparison (RLM vs CONV agregat) ────

  async getSessionTokenComparison(sessionId: number, user: User): Promise<any> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['user'],
    });

    if (!session) {
      throw new NotFoundException(`Session dengan id ${sessionId} tidak ditemukan`);
    }
    if (user.role !== UserRole.ADMIN && session.user.id !== user.id) {
      throw new ForbiddenException('Anda tidak memiliki akses ke session ini');
    }

    const messages = await this.messageRepository.find({
      where: { session: { id: sessionId } },
      relations: ['token_usage_logs'],
      order: { timestamp: 'ASC' },
    });

    const userMessages      = messages.filter((m) => m.role === MessageRole.USER);
    const assistantMessages = messages.filter((m) => m.role === MessageRole.ASSISTANT);

    const rows: any[] = [];

    for (let i = 0; i < assistantMessages.length; i++) {
      const aMsg = assistantMessages[i];
      const uMsg = userMessages[i] ?? null;

      const rlmLog  = aMsg.token_usage_logs?.find((l) => l.method === 'RLM') ?? null;
      const convLog = aMsg.token_usage_logs?.find((l) => l.method === 'CONV') ?? null;

      if (!rlmLog || !convLog) continue;

      const rlmTotal  = rlmLog.input_tokens  + rlmLog.output_tokens;
      const convTotal = convLog.input_tokens + convLog.output_tokens;
      const savings   = convTotal - rlmTotal;

      const inputEfficiency      = rlmLog.input_tokens  > 0 ? Math.round((convLog.input_tokens  / rlmLog.input_tokens)  * 1000) / 1000 : 0;
      const outputEfficiency     = rlmLog.output_tokens > 0 ? Math.round((convLog.output_tokens / rlmLog.output_tokens) * 1000) / 1000 : 0;
      const totalEfficiencyRatio = rlmTotal > 0 ? Math.round((convTotal / rlmTotal) * 1000) / 1000 : 0;
      const percentageSaved      = convTotal > 0 ? ((savings / convTotal) * 100).toFixed(1) + '%' : '0%';

      const rlmCost  = calcTokenCost({
        root_input_tokens:  rlmLog.root_input_tokens,
        root_output_tokens: rlmLog.root_output_tokens,
        sub_input_tokens:   rlmLog.sub_input_tokens,
        sub_output_tokens:  rlmLog.sub_output_tokens,
      });
      const convCost = calcTokenCost({
        root_input_tokens:  convLog.root_input_tokens,
        root_output_tokens: convLog.root_output_tokens,
        sub_input_tokens:   0,
        sub_output_tokens:  0,
      });
      const costSavings = convCost.total_cost_usd - rlmCost.total_cost_usd;

      rows.push({
        message_id:        aMsg.id,
        timestamp:         aMsg.timestamp,
        user_content:      uMsg?.content ?? null,
        assistant_content: aMsg.content,
        rlm: {
          input_tokens:       rlmLog.input_tokens,
          output_tokens:      rlmLog.output_tokens,
          total_tokens:       rlmTotal,
          rlm_depth:          rlmLog.rlm_depth,
          root_input_tokens:  rlmLog.root_input_tokens,
          root_output_tokens: rlmLog.root_output_tokens,
          sub_input_tokens:   rlmLog.sub_input_tokens,
          sub_output_tokens:  rlmLog.sub_output_tokens,
          cost: {
            root: {
              model:           'gpt-5.1',
              input_cost_usd:  formatUsd(rlmCost.root.input_cost_usd),
              output_cost_usd: formatUsd(rlmCost.root.output_cost_usd),
              total_cost_usd:  formatUsd(rlmCost.root.total_cost_usd),
            },
            sub: {
              model:           'gpt-5-mini',
              input_cost_usd:  formatUsd(rlmCost.sub.input_cost_usd),
              output_cost_usd: formatUsd(rlmCost.sub.output_cost_usd),
              total_cost_usd:  formatUsd(rlmCost.sub.total_cost_usd),
            },
            total_cost_usd: formatUsd(rlmCost.total_cost_usd),
          },
        },
        conv: {
          input_tokens:  convLog.input_tokens,
          output_tokens: convLog.output_tokens,
          total_tokens:  convTotal,
          cost: {
            model:           'gpt-5.1',
            input_cost_usd:  formatUsd(convCost.root.input_cost_usd),
            output_cost_usd: formatUsd(convCost.root.output_cost_usd),
            total_cost_usd:  formatUsd(convCost.total_cost_usd),
          },
        },
        efficiency: {
          input_efficiency:       inputEfficiency,
          output_efficiency:      outputEfficiency,
          total_efficiency_ratio: totalEfficiencyRatio,
          token_savings:          savings,
          percentage_saved:       percentageSaved,
          cost_savings_usd:       formatUsd(costSavings),
        },
      });
    }

    // ── Summary agregat ──────────────────────────────────
    const totalRlmInput      = rows.reduce((s, r) => s + r.rlm.input_tokens,       0);
    const totalRlmOutput     = rows.reduce((s, r) => s + r.rlm.output_tokens,      0);
    const totalRlmTokens     = rows.reduce((s, r) => s + r.rlm.total_tokens,       0);
    const totalConvInput     = rows.reduce((s, r) => s + r.conv.input_tokens,      0);
    const totalConvOutput    = rows.reduce((s, r) => s + r.conv.output_tokens,     0);
    const totalConvTokens    = rows.reduce((s, r) => s + r.conv.total_tokens,      0);
    const totalSavings       = totalConvTokens - totalRlmTokens;
    const totalRlmRootInput  = rows.reduce((s, r) => s + r.rlm.root_input_tokens,  0);
    const totalRlmRootOutput = rows.reduce((s, r) => s + r.rlm.root_output_tokens, 0);
    const totalRlmSubInput   = rows.reduce((s, r) => s + r.rlm.sub_input_tokens,   0);
    const totalRlmSubOutput  = rows.reduce((s, r) => s + r.rlm.sub_output_tokens,  0);

    const avgEfficiencyRatio  = rows.length > 0
      ? Math.round((rows.reduce((s, r) => s + r.efficiency.total_efficiency_ratio, 0) / rows.length) * 1000) / 1000
      : 0;
    const avgInputEfficiency  = rows.length > 0
      ? Math.round((rows.reduce((s, r) => s + r.efficiency.input_efficiency, 0) / rows.length) * 1000) / 1000
      : 0;
    const avgOutputEfficiency = rows.length > 0
      ? Math.round((rows.reduce((s, r) => s + r.efficiency.output_efficiency, 0) / rows.length) * 1000) / 1000
      : 0;
    const avgPercentageSaved  = totalConvTokens > 0
      ? ((totalSavings / totalConvTokens) * 100).toFixed(1) + '%'
      : '0%';

    const totalRlmCost  = calcTokenCost({
      root_input_tokens:  totalRlmRootInput,
      root_output_tokens: totalRlmRootOutput,
      sub_input_tokens:   totalRlmSubInput,
      sub_output_tokens:  totalRlmSubOutput,
    });
    const totalConvCost = calcTokenCost({
      root_input_tokens:  totalConvInput,
      root_output_tokens: totalConvOutput,
      sub_input_tokens:   0,
      sub_output_tokens:  0,
    });
    const totalCostSavings = totalConvCost.total_cost_usd - totalRlmCost.total_cost_usd;

    return {
      session_id:      sessionId,
      session_title:   session.title,
      total_messages:  messages.length,
      sop_query_count: rows.length,
      rows,
      summary: {
        total_rlm_input_tokens:       totalRlmInput,
        total_rlm_output_tokens:      totalRlmOutput,
        total_rlm_tokens:             totalRlmTokens,
        total_conv_input_tokens:      totalConvInput,
        total_conv_output_tokens:     totalConvOutput,
        total_conv_tokens:            totalConvTokens,
        total_savings:                totalSavings,
        avg_input_efficiency:         avgInputEfficiency,
        avg_output_efficiency:        avgOutputEfficiency,
        avg_efficiency_ratio:         avgEfficiencyRatio,
        avg_percentage_saved:         avgPercentageSaved,
        total_rlm_root_input_tokens:  totalRlmRootInput,
        total_rlm_root_output_tokens: totalRlmRootOutput,
        total_rlm_sub_input_tokens:   totalRlmSubInput,
        total_rlm_sub_output_tokens:  totalRlmSubOutput,
        cost: {
          rlm: {
            root: {
              model:           'gpt-5.1',
              input_cost_usd:  formatUsd(totalRlmCost.root.input_cost_usd),
              output_cost_usd: formatUsd(totalRlmCost.root.output_cost_usd),
              total_cost_usd:  formatUsd(totalRlmCost.root.total_cost_usd),
            },
            sub: {
              model:           'gpt-5-mini',
              input_cost_usd:  formatUsd(totalRlmCost.sub.input_cost_usd),
              output_cost_usd: formatUsd(totalRlmCost.sub.output_cost_usd),
              total_cost_usd:  formatUsd(totalRlmCost.sub.total_cost_usd),
            },
            total_cost_usd: formatUsd(totalRlmCost.total_cost_usd),
          },
          conv: {
            model:           'gpt-5.1',
            input_cost_usd:  formatUsd(totalConvCost.root.input_cost_usd),
            output_cost_usd: formatUsd(totalConvCost.root.output_cost_usd),
            total_cost_usd:  formatUsd(totalConvCost.total_cost_usd),
          },
          total_cost_savings_usd: formatUsd(totalCostSavings),
        },
      },
    };
  }
}