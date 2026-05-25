import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RlmService } from './rlm.service';
import { SubQueryResult } from './entities/sub-query-result.entity';
import { TokenUsageLog, TokenMethod } from './entities/token-usage-log.entity';
import { RlmEngine } from './rlm.engine';
import { LlmApiClient } from './llm-api.client';
import { ConventionalService } from './conventional.service';
import { ChatService } from '../chat/chat.service';
import { SopDocumentsService } from '../sop-documents/sop-documents.service';
import { MessageRole } from '../chat/entities/message.entity';

// ── Helpers ───────────────────────────────────────────────────────────────

const makeLlmResponse = (content: string, inputTokens = 10, outputTokens = 20) => ({
  content,
  input_tokens: inputTokens,
  output_tokens: outputTokens,
  cached_input_tokens: 0,
});

const makeUserMessage = (overrides: Partial<any> = {}) => ({
  id: 1,
  role: MessageRole.USER,
  content: 'Pertanyaan user',
  input_tokens: 0,
  output_tokens: 0,
  timestamp: new Date(),
  ...overrides,
});

const makeAssistantMessage = (overrides: Partial<any> = {}) => ({
  id: 2,
  role: MessageRole.ASSISTANT,
  content: 'Jawaban asisten',
  input_tokens: 100,
  output_tokens: 50,
  timestamp: new Date(),
  ...overrides,
});

const makeRlmResult = () => ({
  answer: 'Jawaban dari RLM',
  references: [],
  subQueryResults: [{ subQuestion: 'sub q', answer: 'sub a', tokensUsed: 10, depth: 2 }],
  totalInputTokens: 300,
  totalOutputTokens: 150,
  rootInputTokens: 200,
  rootOutputTokens: 100,
  rootCachedInputTokens: 0,
  subInputTokens: 100,
  subOutputTokens: 50,
  subCachedInputTokens: 0,
  totalIterations: 3,
  depth: 2,
  execLog: ['log1'],
  selectedDocumentIds: [1],
});

const makeConvResult = () => ({
  content: 'Jawaban konvensional',
  input_tokens: 800,
  output_tokens: 200,
  total_tokens: 1000,
  error_message: null,
});

const makeTokenLog = (method: TokenMethod, overrides: Partial<any> = {}) => ({
  id: method === TokenMethod.RLM ? 1 : 2,
  method,
  input_tokens: method === TokenMethod.RLM ? 300 : 800,
  output_tokens: method === TokenMethod.RLM ? 150 : 200,
  root_input_tokens: method === TokenMethod.RLM ? 200 : 800,
  root_output_tokens: method === TokenMethod.RLM ? 100 : 200,
  root_cached_input_tokens: 0,
  sub_input_tokens: method === TokenMethod.RLM ? 100 : 0,
  sub_output_tokens: method === TokenMethod.RLM ? 50 : 0,
  sub_cached_input_tokens: 0,
  response_time_ms: method === TokenMethod.RLM ? 1200 : 1800,
  rlm_depth: method === TokenMethod.RLM ? 2 : 0,
  conv_answer: method === TokenMethod.CONV ? 'Jawaban konvensional' : null,
  error_message: null,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('RlmService', () => {
  let service: RlmService;
  let subQueryRepo: jest.Mocked<any>;
  let tokenLogRepo: jest.Mocked<any>;
  let rlmEngine: jest.Mocked<RlmEngine>;
  let llmApiClient: jest.Mocked<LlmApiClient>;
  let conventionalService: jest.Mocked<ConventionalService>;
  let chatService: jest.Mocked<ChatService>;
  let sopDocumentsService: jest.Mocked<SopDocumentsService>;

  const mockSubQueryRepo = {
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockTokenLogRepo = {
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RlmService,
        { provide: getRepositoryToken(SubQueryResult), useValue: mockSubQueryRepo },
        { provide: getRepositoryToken(TokenUsageLog), useValue: mockTokenLogRepo },
        {
          provide: RlmEngine,
          useValue: {
            process: jest.fn(),
          },
        },
        {
          provide: LlmApiClient,
          useValue: {
            queryNano: jest.fn(),
            queryNanoShort: jest.fn(),
            queryRootLM: jest.fn(),
            querySubLM: jest.fn(),
          },
        },
        {
          provide: ConventionalService,
          useValue: {
            process: jest.fn(),
          },
        },
        {
          provide: ChatService,
          useValue: {
            getRecentMessages: jest.fn(),
            saveMessage: jest.fn(),
            updateSessionTitle: jest.fn(),
          },
        },
        {
          provide: SopDocumentsService,
          useValue: {
            findAllMetadata: jest.fn(),
            findById: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RlmService>(RlmService);
    subQueryRepo = mockSubQueryRepo;
    tokenLogRepo = mockTokenLogRepo;
    rlmEngine = module.get(RlmEngine);
    llmApiClient = module.get(LlmApiClient);
    conventionalService = module.get(ConventionalService);
    chatService = module.get(ChatService);
    sopDocumentsService = module.get(SopDocumentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // sendMessage — CHITCHAT
  // ═══════════════════════════════════════════════════════════════════════

  describe('sendMessage() — CHITCHAT intent', () => {
    beforeEach(() => {
      chatService.getRecentMessages.mockResolvedValue([]);
      // saveMessage returns the content it was called with
      chatService.saveMessage.mockImplementation(async (_sid, content, role) =>
        role === MessageRole.USER
          ? (makeUserMessage({ content }) as any)
          : (makeAssistantMessage({ content }) as any),
      );
      chatService.updateSessionTitle.mockResolvedValue(undefined);

      // Classify as CHITCHAT
      llmApiClient.queryNano.mockResolvedValue(makeLlmResponse('CHITCHAT'));
      // Chitchat answer
      llmApiClient.queryNanoShort.mockResolvedValue(makeLlmResponse('Halo juga!', 20, 10));

      tokenLogRepo.create.mockImplementation((d: any) => d);
      tokenLogRepo.save.mockResolvedValue({});
    });

    it('should return SendMessageResult with CHITCHAT intent', async () => {
      const result = await service.sendMessage(1, 'Halo');

      expect(result.meta.intent).toBe('CHITCHAT');
      expect(result.assistantMessage.content).toBe('Halo juga!');
      expect(result.convTokenUsage).toBeNull();
    });

    it('should not call RLM engine or CONV for CHITCHAT', async () => {
      await service.sendMessage(1, 'Halo');

      expect(rlmEngine.process).not.toHaveBeenCalled();
      expect(conventionalService.process).not.toHaveBeenCalled();
    });

    it('should save a single RLM token log for CHITCHAT', async () => {
      await service.sendMessage(1, 'Halo');

      expect(tokenLogRepo.save).toHaveBeenCalledTimes(1);
      expect(tokenLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ method: TokenMethod.RLM }),
      );
    });

    it('should update session title when no previous messages', async () => {
      await service.sendMessage(1, 'Halo');

      expect(chatService.updateSessionTitle).toHaveBeenCalledWith(1, 'Halo');
    });

    it('should not update session title when previous messages exist', async () => {
      chatService.getRecentMessages.mockResolvedValue([makeUserMessage() as any]);

      await service.sendMessage(1, 'Halo');

      expect(chatService.updateSessionTitle).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // sendMessage — SOP_QUERY
  // ═══════════════════════════════════════════════════════════════════════

  describe('sendMessage() — SOP_QUERY intent', () => {
    const sampleDocs = [
      { id: 1, title: 'SOP Rekrutmen', file_size: 5000 },
    ];

    beforeEach(() => {
      chatService.getRecentMessages.mockResolvedValue([]);
      chatService.saveMessage.mockImplementation(async (_sid, content, role) =>
        role === MessageRole.USER
          ? (makeUserMessage({ content }) as any)
          : (makeAssistantMessage({ content }) as any),
      );
      chatService.updateSessionTitle.mockResolvedValue(undefined);

      llmApiClient.queryNano.mockResolvedValue(makeLlmResponse('SOP_QUERY'));

      sopDocumentsService.findAllMetadata.mockResolvedValue(sampleDocs);
      sopDocumentsService.findById.mockResolvedValue({ id: 1, content: 'Isi SOP', uploaded_by_user: { id: 1, name: 'Admin' } });

      rlmEngine.process.mockResolvedValue(makeRlmResult() as any);
      conventionalService.process.mockResolvedValue(makeConvResult() as any);

      tokenLogRepo.create.mockImplementation((d: any) => d);
      tokenLogRepo.save.mockResolvedValue({});
      subQueryRepo.create.mockImplementation((d: any) => d);
      subQueryRepo.save.mockResolvedValue({});
    });

    it('should return SendMessageResult with SOP_QUERY intent', async () => {
      const result = await service.sendMessage(1, 'Bagaimana prosedur rekrutmen?');

      expect(result.meta.intent).toBe('SOP_QUERY');
      expect(result.assistantMessage.content).toBe('Jawaban dari RLM');
      expect(result.convTokenUsage).not.toBeNull();
    });

    it('should call RLM engine and CONV service', async () => {
      await service.sendMessage(1, 'Bagaimana prosedur rekrutmen?');

      expect(rlmEngine.process).toHaveBeenCalledTimes(1);
      expect(conventionalService.process).toHaveBeenCalledTimes(1);
    });

    it('should save sub-query results for SOP_QUERY', async () => {
      await service.sendMessage(1, 'Bagaimana prosedur rekrutmen?');

      expect(subQueryRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should save both RLM and CONV token logs for SOP_QUERY', async () => {
      await service.sendMessage(1, 'Bagaimana prosedur rekrutmen?');

      expect(tokenLogRepo.save).toHaveBeenCalledTimes(2);
      const calls = tokenLogRepo.create.mock.calls.map((c: any[]) => c[0].method);
      expect(calls).toContain(TokenMethod.RLM);
      expect(calls).toContain(TokenMethod.CONV);
    });

    it('should include selectedDocumentIds in meta', async () => {
      const result = await service.sendMessage(1, 'Bagaimana prosedur rekrutmen?');

      expect(result.meta.selectedDocumentIds).toEqual([1]);
    });

    it('should include subQueryCount in meta', async () => {
      const result = await service.sendMessage(1, 'Bagaimana prosedur rekrutmen?');

      expect(result.meta.subQueryCount).toBe(1);
    });

    it('should classify as SOP_QUERY when queryNano returns SOP_QUERY', async () => {
      llmApiClient.queryNano.mockResolvedValue(makeLlmResponse('SOP_QUERY'));

      const result = await service.sendMessage(1, 'Prosedur pengadaan?');

      expect(result.meta.intent).toBe('SOP_QUERY');
    });

    it('should default to SOP_QUERY on classification failure', async () => {
      llmApiClient.queryNano.mockRejectedValue(new Error('Network error'));

      const result = await service.sendMessage(1, 'Prosedur pengadaan?');

      expect(result.meta.intent).toBe('SOP_QUERY');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // generateTitle (private, tested via sendMessage)
  // ═══════════════════════════════════════════════════════════════════════

  describe('generateTitle() via sendMessage()', () => {
    it('should truncate long questions at word boundary', async () => {
      chatService.getRecentMessages.mockResolvedValue([]);
      chatService.saveMessage.mockImplementation(async (_sid, content, role) =>
        role === MessageRole.USER
          ? (makeUserMessage({ content }) as any)
          : (makeAssistantMessage({ content }) as any),
      );
      chatService.updateSessionTitle.mockResolvedValue(undefined);
      llmApiClient.queryNano.mockResolvedValue(makeLlmResponse('CHITCHAT'));
      llmApiClient.queryNanoShort.mockResolvedValue(makeLlmResponse('Halo!', 5, 5));
      tokenLogRepo.create.mockImplementation((d: any) => d);
      tokenLogRepo.save.mockResolvedValue({});

      const longQuestion = 'Kata '.repeat(30);
      await service.sendMessage(1, longQuestion);

      const titleCall = chatService.updateSessionTitle.mock.calls[0][1];
      expect(titleCall.length).toBeLessThanOrEqual(103); // 100 + "..."
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getSubQueryResults
  // ═══════════════════════════════════════════════════════════════════════

  describe('getSubQueryResults()', () => {
    it('should find and return sub-query results for a message', async () => {
      const subResults = [
        { id: 1, sub_question: 'q1', answer: 'a1', tokens_used: 10, depth: 2 },
        { id: 2, sub_question: 'q2', answer: 'a2', tokens_used: 15, depth: 3 },
      ];
      subQueryRepo.find.mockResolvedValue(subResults);

      const result = await service.getSubQueryResults(5);

      expect(subQueryRepo.find).toHaveBeenCalledWith({
        where: { message: { id: 5 } },
        order: { depth: 'ASC', created_at: 'ASC' },
      });
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no sub-queries exist', async () => {
      subQueryRepo.find.mockResolvedValue([]);

      const result = await service.getSubQueryResults(99);

      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getTokenUsageLogs
  // ═══════════════════════════════════════════════════════════════════════

  describe('getTokenUsageLogs()', () => {
    it('should return token usage logs for a message', async () => {
      const logs = [
        makeTokenLog(TokenMethod.RLM),
        makeTokenLog(TokenMethod.CONV),
      ];
      tokenLogRepo.find.mockResolvedValue(logs);

      const result = await service.getTokenUsageLogs(5);

      expect(tokenLogRepo.find).toHaveBeenCalledWith({
        where: { message: { id: 5 } },
      });
      expect(result).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getTokenComparison
  // ═══════════════════════════════════════════════════════════════════════

  describe('getTokenComparison()', () => {
    it('should return token comparison with RLM and CONV data', async () => {
      const logs = [makeTokenLog(TokenMethod.RLM), makeTokenLog(TokenMethod.CONV)];
      tokenLogRepo.find.mockResolvedValue(logs);

      const result = await service.getTokenComparison(5);

      expect(result.message_id).toBe(5);
      expect(result.rlm.input_tokens).toBe(300);
      expect(result.rlm.output_tokens).toBe(150);
      expect(result.conv.input_tokens).toBe(800);
      expect(result.conv.output_tokens).toBe(200);
    });

    it('should calculate token savings correctly', async () => {
      const logs = [makeTokenLog(TokenMethod.RLM), makeTokenLog(TokenMethod.CONV)];
      tokenLogRepo.find.mockResolvedValue(logs);

      const result = await service.getTokenComparison(5);

      const rlmTotal = 300 + 150;
      const convTotal = 800 + 200;
      expect(result.comparison.token_savings).toBe(convTotal - rlmTotal);
    });

    it('should determine response time winner correctly', async () => {
      const rlmLog = makeTokenLog(TokenMethod.RLM, { response_time_ms: 1000 });
      const convLog = makeTokenLog(TokenMethod.CONV, { response_time_ms: 2000 });
      tokenLogRepo.find.mockResolvedValue([rlmLog, convLog]);

      const result = await service.getTokenComparison(5);

      expect(result.comparison.response_time_faster).toBe('RLM');
    });

    it('should return SAMA when response times are equal', async () => {
      const rlmLog = makeTokenLog(TokenMethod.RLM, { response_time_ms: 1500 });
      const convLog = makeTokenLog(TokenMethod.CONV, { response_time_ms: 1500 });
      tokenLogRepo.find.mockResolvedValue([rlmLog, convLog]);

      const result = await service.getTokenComparison(5);

      expect(result.comparison.response_time_faster).toBe('SAMA');
    });

    it('should include cost breakdown in result', async () => {
      const logs = [makeTokenLog(TokenMethod.RLM), makeTokenLog(TokenMethod.CONV)];
      tokenLogRepo.find.mockResolvedValue(logs);

      const result = await service.getTokenComparison(5);

      expect(result.rlm.cost.root).toBeDefined();
      expect(result.rlm.cost.sub).toBeDefined();
      expect(result.rlm.cost.total_cost_usd).toBeDefined();
      expect(result.conv.cost.total_cost_usd).toBeDefined();
    });

    it('should throw NotFoundException when RLM log is missing', async () => {
      tokenLogRepo.find.mockResolvedValue([makeTokenLog(TokenMethod.CONV)]);

      await expect(service.getTokenComparison(5)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when CONV log is missing', async () => {
      tokenLogRepo.find.mockResolvedValue([makeTokenLog(TokenMethod.RLM)]);

      await expect(service.getTokenComparison(5)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when no logs exist', async () => {
      tokenLogRepo.find.mockResolvedValue([]);

      await expect(service.getTokenComparison(5)).rejects.toThrow(NotFoundException);
    });

    it('should include cache hit rate in RLM result', async () => {
      const rlmLog = makeTokenLog(TokenMethod.RLM, {
        input_tokens: 1000,
        root_cached_input_tokens: 500,
        sub_cached_input_tokens: 200,
      });
      const convLog = makeTokenLog(TokenMethod.CONV);
      tokenLogRepo.find.mockResolvedValue([rlmLog, convLog]);

      const result = await service.getTokenComparison(5);

      expect(result.rlm.cache_hit_rate).toContain('%');
    });
  });
});
