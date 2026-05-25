import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { ChatSession, SessionStatus } from './entities/chat-session.entity';
import { Message, MessageRole } from './entities/message.entity';
import { UserRole } from '../users/entities/user.entity';
import { TokenMethod } from '../rlm/entities/token-usage-log.entity';

// ── Mock OpenAI ─────────────────────────────────────────────────────────
jest.mock('openai', () => ({
  __esModule: true,
  default: class MockOpenAI {
    chat = {
      completions: {
        create: jest.fn(),
      },
    };
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────

const makeUser = (overrides: Partial<any> = {}) => ({
  id: 1,
  name: 'Test User',
  email: 'test@example.com',
  role: UserRole.USER,
  admin_level: null,
  last_login: null,
  created_at: new Date('2024-01-01'),
  ...overrides,
});

const makeAdmin = () => makeUser({ id: 99, role: UserRole.ADMIN, name: 'Admin' });

const makeSession = (overrides: Partial<any> = {}) => ({
  id: 1,
  title: 'Test Session',
  status: SessionStatus.ACTIVE,
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-01'),
  user: makeUser(),
  messages: [],
  ...overrides,
});

const makeMessage = (overrides: Partial<any> = {}) => ({
  id: 10,
  role: MessageRole.USER,
  content: 'Hello',
  input_tokens: 0,
  output_tokens: 0,
  timestamp: new Date(),
  session: makeSession(),
  token_usage_logs: [],
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ChatService', () => {
  let service: ChatService;
  let sessionRepo: jest.Mocked<any>;
  let messageRepo: jest.Mocked<any>;

  const mockSessionRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockMessageRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(ChatSession), useValue: mockSessionRepo },
        { provide: getRepositoryToken(Message), useValue: mockMessageRepo },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-key'),
          },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    sessionRepo = mockSessionRepo;
    messageRepo = mockMessageRepo;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // generateSessionTitle
  // ═══════════════════════════════════════════════════════════════════════

  describe('generateSessionTitle()', () => {
    it('should return generated title from OpenAI', async () => {
      const openaiInstance = (service as any).openai;
      openaiInstance.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'SOP Rekrutmen Karyawan' } }],
      });

      const title = await service.generateSessionTitle('Bagaimana cara merekrut karyawan baru?');

      expect(title).toBe('SOP Rekrutmen Karyawan');
    });

    it('should fall back to first 40 chars of message when OpenAI fails', async () => {
      const openaiInstance = (service as any).openai;
      openaiInstance.chat.completions.create.mockRejectedValueOnce(new Error('API error'));

      const longMessage = 'A'.repeat(100);
      const title = await service.generateSessionTitle(longMessage);

      expect(title).toBe('A'.repeat(40));
    });

    it('should fall back when OpenAI returns empty content', async () => {
      const openaiInstance = (service as any).openai;
      openaiInstance.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: '' } }],
      });

      const message = 'Prosedur pengadaan barang';
      const title = await service.generateSessionTitle(message);

      expect(title).toBe(message.substring(0, 40));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // createSession
  // ═══════════════════════════════════════════════════════════════════════

  describe('createSession()', () => {
    it('should create and save a new session', async () => {
      const user = makeUser();
      const savedSession = makeSession({ title: 'Custom Title' });

      sessionRepo.create.mockReturnValue(savedSession);
      sessionRepo.save.mockResolvedValue(savedSession);

      const result = await service.createSession({ title: 'Custom Title' }, user as any);

      expect(sessionRepo.create).toHaveBeenCalledWith({
        title: 'Custom Title',
        user,
      });
      expect(result.message).toBe('Session berhasil dibuat');
      expect(result.id).toBe(savedSession.id);
      expect(result.title).toBe('Custom Title');
    });

    it('should use "..." as default title when not provided', async () => {
      const user = makeUser();
      const savedSession = makeSession({ title: '...' });

      sessionRepo.create.mockReturnValue(savedSession);
      sessionRepo.save.mockResolvedValue(savedSession);

      const result = await service.createSession({}, user as any);

      expect(sessionRepo.create).toHaveBeenCalledWith({ title: '...', user });
      expect(result.title).toBe('...');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // updateSessionTitle
  // ═══════════════════════════════════════════════════════════════════════

  describe('updateSessionTitle()', () => {
    it('should update session title', async () => {
      sessionRepo.update.mockResolvedValue(undefined);

      await service.updateSessionTitle(1, 'New Title');

      expect(sessionRepo.update).toHaveBeenCalledWith(1, { title: 'New Title' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // findAllSessions
  // ═══════════════════════════════════════════════════════════════════════

  describe('findAllSessions()', () => {
    it('should return all sessions for ADMIN regardless of owner', async () => {
      const admin = makeAdmin();
      const sessions = [makeSession({ user: makeUser() }), makeSession({ id: 2, user: makeUser({ id: 2 }) })];
      sessionRepo.find.mockResolvedValue(sessions);

      const result = await service.findAllSessions(admin as any);

      expect(sessionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(result).toHaveLength(2);
    });

    it('should filter by user id for non-ADMIN', async () => {
      const user = makeUser({ id: 5 });
      const sessions = [makeSession({ user })];
      sessionRepo.find.mockResolvedValue(sessions);

      const result = await service.findAllSessions(user as any);

      expect(sessionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user: { id: 5 } } }),
      );
      expect(result).toHaveLength(1);
    });

    it('should map sessions to response format without sensitive data', async () => {
      const session = makeSession();
      sessionRepo.find.mockResolvedValue([session]);

      const result = await service.findAllSessions(makeUser() as any);

      expect(result[0]).toMatchObject({
        id: session.id,
        title: session.title,
        status: session.status,
        user: { id: session.user.id, name: session.user.name },
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // findSessionById
  // ═══════════════════════════════════════════════════════════════════════

  describe('findSessionById()', () => {
    it('should return session with messages for owner', async () => {
      const user = makeUser();
      const session = makeSession({ user, messages: [makeMessage()] });
      sessionRepo.findOne.mockResolvedValue(session);

      const result = await service.findSessionById(1, user as any);

      expect(result.id).toBe(session.id);
      expect(result.messages).toHaveLength(1);
    });

    it('should throw NotFoundException when session not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.findSessionById(99, makeUser() as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when user does not own the session', async () => {
      const owner = makeUser({ id: 1 });
      const stranger = makeUser({ id: 2 });
      const session = makeSession({ user: owner });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(service.findSessionById(1, stranger as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow ADMIN to access any session', async () => {
      const admin = makeAdmin();
      const session = makeSession({ user: makeUser({ id: 999 }) });
      sessionRepo.findOne.mockResolvedValue(session);

      const result = await service.findSessionById(1, admin as any);

      expect(result.id).toBe(session.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // removeSession
  // ═══════════════════════════════════════════════════════════════════════

  describe('removeSession()', () => {
    it('should delete session owned by the user', async () => {
      const user = makeUser();
      const session = makeSession({ user });
      sessionRepo.findOne.mockResolvedValue(session);
      sessionRepo.delete.mockResolvedValue(undefined);

      const result = await service.removeSession(1, user as any);

      expect(sessionRepo.delete).toHaveBeenCalledWith(1);
      expect(result.message).toBe('Session berhasil dihapus');
    });

    it('should throw NotFoundException when session not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.removeSession(99, makeUser() as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when user does not own the session', async () => {
      const session = makeSession({ user: makeUser({ id: 1 }) });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(service.removeSession(1, makeUser({ id: 2 }) as any)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // saveMessage
  // ═══════════════════════════════════════════════════════════════════════

  describe('saveMessage()', () => {
    it('should save a message and return it', async () => {
      const session = makeSession({ messages: [makeMessage()] });
      const savedMsg = makeMessage({ id: 20, role: MessageRole.ASSISTANT, content: 'Reply' });

      sessionRepo.findOne.mockResolvedValue(session);
      messageRepo.create.mockReturnValue(savedMsg);
      messageRepo.save.mockResolvedValue(savedMsg);
      sessionRepo.update.mockResolvedValue(undefined);

      const result = await service.saveMessage(1, 'Reply', MessageRole.ASSISTANT);

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Reply', role: MessageRole.ASSISTANT }),
      );
      expect(result.id).toBe(20);
    });

    it('should generate title for first user message', async () => {
      const session = makeSession({ messages: [] });
      const savedMsg = makeMessage({ role: MessageRole.USER, content: 'Pertanyaan pertama' });

      sessionRepo.findOne.mockResolvedValue(session);
      messageRepo.create.mockReturnValue(savedMsg);
      messageRepo.save.mockResolvedValue(savedMsg);
      sessionRepo.update.mockResolvedValue(undefined);

      const openaiInstance = (service as any).openai;
      openaiInstance.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Judul Session' } }],
      });

      await service.saveMessage(1, 'Pertanyaan pertama', MessageRole.USER);

      expect(sessionRepo.update).toHaveBeenCalledWith(1, { title: 'Judul Session' });
    });

    it('should throw NotFoundException when session not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.saveMessage(99, 'content', MessageRole.USER),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not generate title for non-USER messages', async () => {
      const session = makeSession({ messages: [] });
      const savedMsg = makeMessage({ role: MessageRole.ASSISTANT });

      sessionRepo.findOne.mockResolvedValue(session);
      messageRepo.create.mockReturnValue(savedMsg);
      messageRepo.save.mockResolvedValue(savedMsg);
      sessionRepo.update.mockResolvedValue(undefined);

      const openaiInstance = (service as any).openai;
      const createSpy = openaiInstance.chat.completions.create;

      await service.saveMessage(1, 'Answer', MessageRole.ASSISTANT);

      // OpenAI create should NOT be called for assistant messages
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // findMessagesBySession
  // ═══════════════════════════════════════════════════════════════════════

  describe('findMessagesBySession()', () => {
    it('should return messages for the session owner', async () => {
      const user = makeUser();
      const session = makeSession({ user });
      const messages = [
        makeMessage({ id: 1, role: MessageRole.USER }),
        makeMessage({ id: 2, role: MessageRole.ASSISTANT }),
      ];

      sessionRepo.findOne.mockResolvedValue(session);
      messageRepo.find.mockResolvedValue(messages);

      const result = await service.findMessagesBySession(1, user as any);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 1, role: MessageRole.USER });
    });

    it('should throw NotFoundException when session not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.findMessagesBySession(99, makeUser() as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for non-owner', async () => {
      const session = makeSession({ user: makeUser({ id: 1 }) });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(service.findMessagesBySession(1, makeUser({ id: 2 }) as any)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getRecentMessages
  // ═══════════════════════════════════════════════════════════════════════

  describe('getRecentMessages()', () => {
    it('should return recent messages in ascending order (reversed)', async () => {
      const messages = [
        makeMessage({ id: 3, timestamp: new Date('2024-01-03') }),
        makeMessage({ id: 2, timestamp: new Date('2024-01-02') }),
        makeMessage({ id: 1, timestamp: new Date('2024-01-01') }),
      ];
      messageRepo.find.mockResolvedValue(messages);

      const result = await service.getRecentMessages(1, 3);

      expect(messageRepo.find).toHaveBeenCalledWith({
        where: { session: { id: 1 } },
        order: { timestamp: 'DESC' },
        take: 3,
      });
      // Messages are reversed from DESC order
      expect(result[0].id).toBe(1);
      expect(result[2].id).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getSessionTokenComparison
  // ═══════════════════════════════════════════════════════════════════════

  describe('getSessionTokenComparison()', () => {
    const buildTokenLog = (method: string, overrides: Partial<any> = {}) => ({
      id: Math.random(),
      method,
      input_tokens: 1000,
      output_tokens: 200,
      root_input_tokens: 800,
      root_output_tokens: 200,
      root_cached_input_tokens: 0,
      sub_input_tokens: 200,
      sub_output_tokens: 0,
      sub_cached_input_tokens: 0,
      response_time_ms: 1500,
      rlm_depth: 2,
      conv_answer: null,
      error_message: null,
      ...overrides,
    });

    it('should throw NotFoundException when session not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.getSessionTokenComparison(99, makeUser() as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for non-owner', async () => {
      const session = makeSession({ user: makeUser({ id: 1 }) });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(
        service.getSessionTokenComparison(1, makeUser({ id: 2 }) as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return comparison result for session with paired RLM/CONV logs', async () => {
      const user = makeUser();
      const session = makeSession({ user });
      sessionRepo.findOne.mockResolvedValue(session);

      const userMsg = makeMessage({ id: 1, role: MessageRole.USER, content: 'Pertanyaan?' });
      const asstMsg = makeMessage({
        id: 2,
        role: MessageRole.ASSISTANT,
        content: 'Jawaban.',
        token_usage_logs: [
          buildTokenLog(TokenMethod.RLM, { input_tokens: 500, output_tokens: 100 }),
          buildTokenLog(TokenMethod.CONV, {
            input_tokens: 2000,
            output_tokens: 300,
            sub_input_tokens: 0,
            sub_output_tokens: 0,
          }),
        ],
      });

      messageRepo.find.mockResolvedValue([userMsg, asstMsg]);

      const result = await service.getSessionTokenComparison(1, user as any);

      expect(result.session_id).toBe(1);
      expect(result.sop_query_count).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.summary).toBeDefined();
      expect(result.rows[0].rlm.input_tokens).toBe(500);
      expect(result.rows[0].conv.input_tokens).toBe(2000);
    });

    it('should return empty rows when no paired logs exist', async () => {
      const user = makeUser();
      const session = makeSession({ user });
      sessionRepo.findOne.mockResolvedValue(session);

      const asstMsg = makeMessage({
        id: 2,
        role: MessageRole.ASSISTANT,
        token_usage_logs: [],
      });
      messageRepo.find.mockResolvedValue([asstMsg]);

      const result = await service.getSessionTokenComparison(1, user as any);

      expect(result.rows).toHaveLength(0);
      expect(result.sop_query_count).toBe(0);
    });

    it('should allow ADMIN to view any session comparison', async () => {
      const admin = makeAdmin();
      const session = makeSession({ user: makeUser({ id: 999 }) });
      sessionRepo.findOne.mockResolvedValue(session);
      messageRepo.find.mockResolvedValue([]);

      const result = await service.getSessionTokenComparison(1, admin as any);

      expect(result.session_id).toBe(1);
    });
  });
});
