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

    // Generate judul otomatis jika ini pesan USER pertama
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
    return this.messageRepository.find({
      where: { session: { id: sessionId } },
      order: { timestamp: 'DESC' },
      take: limit,
    }).then(msgs => msgs.reverse());
  }
}