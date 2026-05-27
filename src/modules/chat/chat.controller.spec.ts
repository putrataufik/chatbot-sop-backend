import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RlmService } from '../rlm/rlm.service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: jest.Mocked<ChatService>;
  let rlmService: jest.Mocked<RlmService>;

  const req = { user: { id: 1, role: 'USER' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: {
            createSession: jest.fn(),
            findAllSessions: jest.fn(),
            findSessionById: jest.fn(),
            updateSessionTitle: jest.fn(),
            removeSession: jest.fn(),
            findMessagesBySession: jest.fn(),
            getSessionTokenComparison: jest.fn(),
          },
        },
        {
          provide: RlmService,
          useValue: {
            sendMessage: jest.fn(),
            getSubQueryResults: jest.fn(),
            getTokenUsageLogs: jest.fn(),
            getTokenComparison: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
    chatService = module.get(ChatService);
    rlmService = module.get(RlmService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createSession()', () => {
    it('should delegate to chatService with dto and user', () => {
      const dto = { title: 'My Session' };
      chatService.createSession.mockReturnValue('created' as any);

      const result = controller.createSession(dto, req);

      expect(chatService.createSession).toHaveBeenCalledWith(dto, req.user);
      expect(result).toBe('created');
    });
  });

  describe('findAllSessions()', () => {
    it('should delegate to chatService with user', () => {
      chatService.findAllSessions.mockReturnValue('sessions' as any);

      const result = controller.findAllSessions(req);

      expect(chatService.findAllSessions).toHaveBeenCalledWith(req.user);
      expect(result).toBe('sessions');
    });
  });

  describe('findSessionById()', () => {
    it('should delegate to chatService with id and user', () => {
      chatService.findSessionById.mockReturnValue('session' as any);

      const result = controller.findSessionById(5, req);

      expect(chatService.findSessionById).toHaveBeenCalledWith(5, req.user);
      expect(result).toBe('session');
    });
  });

  describe('renameSession()', () => {
    it('should verify access, update title, and return confirmation', async () => {
      chatService.findSessionById.mockResolvedValue({} as any);
      chatService.updateSessionTitle.mockResolvedValue(undefined);

      const result = await controller.renameSession(5, '  New Title  ', req);

      expect(chatService.findSessionById).toHaveBeenCalledWith(5, req.user);
      expect(chatService.updateSessionTitle).toHaveBeenCalledWith(5, 'New Title');
      expect(result).toEqual({ message: 'Nama session berhasil diubah', id: 5, title: 'New Title' });
    });

    it('should handle null title as empty string', async () => {
      chatService.findSessionById.mockResolvedValue({} as any);
      chatService.updateSessionTitle.mockResolvedValue(undefined);

      const result = await controller.renameSession(5, null as any, req);

      expect(chatService.updateSessionTitle).toHaveBeenCalledWith(5, '');
      expect(result.title).toBe('');
    });
  });

  describe('removeSession()', () => {
    it('should delegate to chatService with id and user', () => {
      chatService.removeSession.mockReturnValue('removed' as any);

      const result = controller.removeSession(5, req);

      expect(chatService.removeSession).toHaveBeenCalledWith(5, req.user);
      expect(result).toBe('removed');
    });
  });

  describe('findMessages()', () => {
    it('should delegate to chatService with id and user', () => {
      chatService.findMessagesBySession.mockReturnValue('messages' as any);

      const result = controller.findMessages(5, req);

      expect(chatService.findMessagesBySession).toHaveBeenCalledWith(5, req.user);
      expect(result).toBe('messages');
    });
  });

  describe('sendMessage()', () => {
    it('should verify access then delegate to rlmService.sendMessage', async () => {
      chatService.findSessionById.mockResolvedValue({} as any);
      rlmService.sendMessage.mockResolvedValue('answer' as any);

      const result = await controller.sendMessage(5, { content: 'Halo' }, req);

      expect(chatService.findSessionById).toHaveBeenCalledWith(5, req.user);
      expect(rlmService.sendMessage).toHaveBeenCalledWith(5, 'Halo');
      expect(result).toBe('answer');
    });
  });

  describe('getSubQueryResults()', () => {
    it('should delegate to rlmService with messageId', () => {
      rlmService.getSubQueryResults.mockReturnValue('subq' as any);

      const result = controller.getSubQueryResults(10);

      expect(rlmService.getSubQueryResults).toHaveBeenCalledWith(10);
      expect(result).toBe('subq');
    });
  });

  describe('getTokenUsage()', () => {
    it('should delegate to rlmService.getTokenUsageLogs', () => {
      rlmService.getTokenUsageLogs.mockReturnValue('logs' as any);

      const result = controller.getTokenUsage(10);

      expect(rlmService.getTokenUsageLogs).toHaveBeenCalledWith(10);
      expect(result).toBe('logs');
    });
  });

  describe('getTokenComparison()', () => {
    it('should delegate to rlmService.getTokenComparison', () => {
      rlmService.getTokenComparison.mockReturnValue('comparison' as any);

      const result = controller.getTokenComparison(10);

      expect(rlmService.getTokenComparison).toHaveBeenCalledWith(10);
      expect(result).toBe('comparison');
    });
  });

  describe('getSessionTokenComparison()', () => {
    it('should delegate to chatService with sessionId and user', () => {
      chatService.getSessionTokenComparison.mockReturnValue('agg' as any);

      const result = controller.getSessionTokenComparison(5, req);

      expect(chatService.getSessionTokenComparison).toHaveBeenCalledWith(5, req.user);
      expect(result).toBe('agg');
    });
  });
});
