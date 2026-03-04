import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession } from './entities/chat-session.entity';
import { Message, MessageRole } from './entities/message.entity';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private chatSessionRepo: Repository<ChatSession>,
    @InjectRepository(Message)
    private messageRepo: Repository<Message>,
  ) {}

  async createSession(userId: number, createChatSessionDto: CreateChatSessionDto): Promise<ChatSession> {
    const session = this.chatSessionRepo.create({
      title: createChatSessionDto.title,
      user: { id: userId },
    });
    return this.chatSessionRepo.save(session);
  }

  async findAllSessions(userId: number, role: string): Promise<any[]> {
    const query = this.chatSessionRepo.createQueryBuilder('session')
      .leftJoinAndSelect('session.user', 'user')
      .select([
        'session.id',
        'session.title',
        'session.created_at',
        'session.updated_at',
        'user.id',
        'user.name',
      ])
      .orderBy('session.updated_at', 'DESC');

    // Jika bukan ADMIN, hanya tampilkan sesi miliknya sendiri
    if (role !== 'ADMIN') {
      query.where('user.id = :userId', { userId });
    }

    return query.getMany();
  }

  async findOneSession(sessionId: number, userId: number, role: string): Promise<ChatSession> {
    const session = await this.chatSessionRepo.findOne({
      where: { id: sessionId },
      relations: ['user', 'messages'],
      order: {
        messages: {
          timestamp: 'ASC',
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Chat Session dengan ID ${sessionId} tidak ditemukan`);
    }

    // Pengecekan otorisasi
    if (role !== 'ADMIN' && session.user.id !== userId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke sesi ini');
    }

    // Sembunyikan data sensitif user, hanya tampilkan id dan name
    session.user = { id: session.user.id, name: session.user.name } as any;

    return session;
  }

  async deleteSession(sessionId: number, userId: number, role: string): Promise<void> {
    const session = await this.findOneSession(sessionId, userId, role);
    await this.chatSessionRepo.remove(session);
  }

  async sendMessage(sessionId: number, userId: number, role: string, sendMessageDto: SendMessageDto): Promise<any> {
    // 1. Validasi sesi
    const session = await this.findOneSession(sessionId, userId, role);

    // 2. Simpan pesan dari USER
    const userMessage = this.messageRepo.create({
      session: { id: session.id },
      role: MessageRole.USER,
      content: sendMessageDto.content,
      input_tokens: 0, // Akan dihitung nanti
      output_tokens: 0,
    });
    await this.messageRepo.save(userMessage);

    // Update timestamp sesi agar naik ke atas (seperti ChatGPT)
    session.updated_at = new Date();
    await this.chatSessionRepo.save(session);

    // ====================================================================
    // TODO: Di sini nanti Anda memanggil RLM Service
    // const rlmResponse = await this.rlmService.processQuery(sendMessageDto.content, ...);
    // ====================================================================

    // 3. Simpan pesan dari ASSISTANT (Placeholder)
    const assistantMessage = this.messageRepo.create({
      session: { id: session.id },
      role: MessageRole.ASSISTANT,
      content: 'Ini adalah respons simulasi dari sistem RLM. Integrasi AI akan dilakukan di tahap selanjutnya.',
      input_tokens: 150,  // Contoh simulasi token
      output_tokens: 50,  // Contoh simulasi token
    });
    await this.messageRepo.save(assistantMessage);

    return {
      userMessage,
      assistantMessage,
    };
  }
}