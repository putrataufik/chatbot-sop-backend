import { Test, TestingModule } from '@nestjs/testing';
import { ConventionalService } from './conventional.service';
import { LlmApiClient } from './llm-api.client';
import { SopDocumentsService } from '../sop-documents/sop-documents.service';

describe('ConventionalService', () => {
  let service: ConventionalService;
  let llmApiClient: jest.Mocked<LlmApiClient>;
  let sopDocumentsService: jest.Mocked<SopDocumentsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConventionalService,
        {
          provide: LlmApiClient,
          useValue: { queryRootLM: jest.fn() },
        },
        {
          provide: SopDocumentsService,
          useValue: { findAllWithContent: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ConventionalService>(ConventionalService);
    llmApiClient = module.get(LlmApiClient);
    sopDocumentsService = module.get(SopDocumentsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('process()', () => {
    it('should build context from documents and return the LLM response', async () => {
      sopDocumentsService.findAllWithContent.mockResolvedValue([
        { id: 1, title: 'SOP Rekrutmen', content: 'Isi A' },
        { id: 2, title: 'SOP Cuti', content: 'Isi B' },
      ]);
      llmApiClient.queryRootLM.mockResolvedValue({
        content: 'Jawaban konvensional',
        input_tokens: 1000,
        output_tokens: 200,
        cached_input_tokens: 50,
      });

      const result = await service.process('Bagaimana prosedur cuti?', []);

      expect(sopDocumentsService.findAllWithContent).toHaveBeenCalled();
      expect(result).toEqual({
        content: 'Jawaban konvensional',
        input_tokens: 1000,
        output_tokens: 200,
        cached_input_tokens: 50,
        error_message: null,
      });

      // The system prompt must embed both document contents
      const messages = llmApiClient.queryRootLM.mock.calls[0][0];
      expect(messages[0].content).toContain('Isi A');
      expect(messages[0].content).toContain('Isi B');
    });

    it('should include chat history and the user question in the messages', async () => {
      sopDocumentsService.findAllWithContent.mockResolvedValue([
        { id: 1, title: 'SOP', content: 'Konten' },
      ]);
      llmApiClient.queryRootLM.mockResolvedValue({
        content: 'OK',
        input_tokens: 10,
        output_tokens: 5,
        cached_input_tokens: 0,
      });

      const history = [
        { role: 'user', content: 'Halo' },
        { role: 'assistant', content: 'Halo juga' },
      ];

      await service.process('Pertanyaan?', history);

      const messages = llmApiClient.queryRootLM.mock.calls[0][0];
      expect(messages).toHaveLength(4); // system + 2 history + user question
      expect(messages[1]).toEqual({ role: 'user', content: 'Halo' });
      expect(messages[3]).toEqual({ role: 'user', content: 'Pertanyaan?' });
    });

    it('should return an error_message on failure instead of throwing', async () => {
      sopDocumentsService.findAllWithContent.mockRejectedValue(new Error('DB down'));

      const result = await service.process('Pertanyaan?', []);

      expect(result).toEqual({
        content: '',
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        error_message: 'DB down',
      });
    });
  });
});
