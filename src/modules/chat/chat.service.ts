// FILE: src/modules/chat/chat.service.ts

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession } from './entities/chat-session.entity';
import { Message, MessageRole } from './entities/message.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { User, UserRole } from '../users/entities/user.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private sessionRepository: Repository<ChatSession>,

    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
  ) {}

  // ── ChatSession ────────────────────────────────────────

  async createSession(
    dto: CreateSessionDto,
    user: User,
  ): Promise<{ message: string; id: number }> {
    const session = this.sessionRepository.create({
      title: dto.title,
      user,
    });
    const saved = await this.sessionRepository.save(session);
    return { message: 'Session berhasil dibuat', id: saved.id };
  }

  async findAllSessions(user: User): Promise<any[]> {
    // ADMIN bisa lihat semua session
    // USER hanya bisa lihat session miliknya sendiri
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

    // USER hanya bisa lihat session miliknya sendiri
    if (user.role !== UserRole.ADMIN && session.user.id !== user.id) {
      throw new ForbiddenException('Anda tidak memiliki akses ke session ini');
    }

    return {
      id: session.id,
      title: session.title,
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

    // USER hanya bisa hapus session miliknya sendiri
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
    });

    if (!session) {
      throw new NotFoundException(`Session dengan id ${sessionId} tidak ditemukan`);
    }

    const message = this.messageRepository.create({
      content,
      role,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      session,
    });

    // Update updated_at pada session
    await this.sessionRepository.update(sessionId, {
      updated_at: new Date(),
    });

    return this.messageRepository.save(message);
  }

  async findMessagesBySession(
    sessionId: number,
    user: User,
  ): Promise<any[]> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['user'],
    });

    if (!session) {
      throw new NotFoundException(`Session dengan id ${sessionId} tidak ditemukan`);
    }

    // USER hanya bisa lihat message miliknya sendiri
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
}