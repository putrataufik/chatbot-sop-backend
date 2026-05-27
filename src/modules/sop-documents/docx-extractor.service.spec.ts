import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PdfExtractorService } from './docx-extractor.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const makeExtractResponse = (content: string, finishReason = 'stop') => ({
  data: {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  },
});

// A buffer big enough to pass the >= 100 byte guard
const validPdfBuffer = Buffer.alloc(200, 'a');

describe('PdfExtractorService', () => {
  let service: PdfExtractorService;

  const configValues: Record<string, string> = {
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'gpt-5-mini',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfExtractorService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => configValues[key]) },
        },
      ],
    }).compile();

    service = module.get<PdfExtractorService>(PdfExtractorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extract()', () => {
    it('should return the structured text from the API on success', async () => {
      const structured = '[DOC] title=SOP Rekrutmen | lang=id\n[STEP] id=1.1 actor: HR';
      mockedAxios.post.mockResolvedValue(makeExtractResponse(structured));

      const result = await service.extract(validPdfBuffer);

      expect(result).toBe(structured);
      const [url, body, config] = mockedAxios.post.mock.calls[0];
      expect(url).toContain('openai.com');
      expect(body.model).toBe('gpt-5-mini');
      expect(config.headers.Authorization).toBe('Bearer test-key');
    });

    it('should still return content when the response was truncated (finish_reason=length)', async () => {
      const structured = '[DOC] title=SOP yang panjang dan terpotong di tengah jalan';
      mockedAxios.post.mockResolvedValue(makeExtractResponse(structured, 'length'));

      const result = await service.extract(validPdfBuffer);

      expect(result).toBe(structured);
    });

    it('should trim whitespace from the result', async () => {
      mockedAxios.post.mockResolvedValue(
        makeExtractResponse('   [DOC] title=Trimmed valid content here   '),
      );

      const result = await service.extract(validPdfBuffer);

      expect(result).toBe('[DOC] title=Trimmed valid content here');
    });

    it('should reject buffers that are empty or too small', async () => {
      await expect(service.extract(Buffer.alloc(10))).rejects.toThrow(BadRequestException);
      await expect(service.extract(null as any)).rejects.toThrow(BadRequestException);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the result is too short', async () => {
      mockedAxios.post.mockResolvedValue(makeExtractResponse('short'));

      await expect(service.extract(validPdfBuffer)).rejects.toThrow(BadRequestException);
    });

    it('should map an OpenAI API error response to BadRequestException', async () => {
      mockedAxios.post.mockRejectedValue({
        response: { status: 401, data: { error: { message: 'Invalid API key' } } },
      });

      await expect(service.extract(validPdfBuffer)).rejects.toThrow(BadRequestException);
    });

    it('should map a timeout error to BadRequestException', async () => {
      mockedAxios.post.mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout of 500000ms exceeded' });

      await expect(service.extract(validPdfBuffer)).rejects.toThrow(BadRequestException);
    });

    it('should map a network error to BadRequestException', async () => {
      mockedAxios.post.mockRejectedValue({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' });

      await expect(service.extract(validPdfBuffer)).rejects.toThrow(BadRequestException);
    });

    it('should map an unexpected error to BadRequestException', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Something weird'));

      await expect(service.extract(validPdfBuffer)).rejects.toThrow(BadRequestException);
    });
  });
});
