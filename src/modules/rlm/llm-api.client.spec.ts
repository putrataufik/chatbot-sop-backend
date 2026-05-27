import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LlmApiClient } from './llm-api.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const makeApiResponse = (overrides: Partial<any> = {}) => ({
  data: {
    choices: [{ message: { content: 'LLM reply' }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 300 },
    },
    ...overrides,
  },
});

describe('LlmApiClient', () => {
  let client: LlmApiClient;

  const configValues: Record<string, string> = {
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'gpt-5.4',
    OPENAI_MODEL_MINI: 'gpt-5-mini',
    OPENAI_MODEL_NANO: 'gpt-5-nano',
    OPENAI_MAX_TOKENS_ROOT: '100000',
    OPENAI_MAX_TOKENS_SUB: '90000',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmApiClient,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => configValues[key]) },
        },
      ],
    }).compile();

    client = module.get<LlmApiClient>(LlmApiClient);
  });

  it('should be defined', () => {
    expect(client).toBeDefined();
  });

  describe('queryRootLM()', () => {
    it('should call the API with the root model and parse the response', async () => {
      mockedAxios.post.mockResolvedValue(makeApiResponse());

      const result = await client.queryRootLM([{ role: 'user', content: 'Hi' }]);

      expect(result).toEqual({
        content: 'LLM reply',
        input_tokens: 1000,
        output_tokens: 200,
        cached_input_tokens: 300,
      });

      const [url, body] = mockedAxios.post.mock.calls[0];
      expect(url).toContain('openai.com');
      expect(body.model).toBe('gpt-5.4');
      expect(body.max_completion_tokens).toBe(100000);
      expect(body.prompt_cache_key).toBe('rootlm-sop');
    });

    it('should default cached_input_tokens to 0 when not provided', async () => {
      mockedAxios.post.mockResolvedValue(
        makeApiResponse({
          usage: { prompt_tokens: 500, completion_tokens: 100 },
        }),
      );

      const result = await client.queryRootLM([{ role: 'user', content: 'Hi' }]);

      expect(result.cached_input_tokens).toBe(0);
    });

    it('should default content to empty string when null', async () => {
      mockedAxios.post.mockResolvedValue(
        makeApiResponse({
          choices: [{ message: { content: null }, finish_reason: 'stop' }],
        }),
      );

      const result = await client.queryRootLM([{ role: 'user', content: 'Hi' }]);

      expect(result.content).toBe('');
    });
  });

  describe('queryConvLM()', () => {
    it('should use the root model with the conv cache key', async () => {
      mockedAxios.post.mockResolvedValue(makeApiResponse());

      await client.queryConvLM([{ role: 'user', content: 'Hi' }]);

      const body = mockedAxios.post.mock.calls[0][1];
      expect(body.model).toBe('gpt-5.4');
      expect(body.prompt_cache_key).toBe('convlm-sop');
    });
  });

  describe('querySubLM()', () => {
    it('should build system+user messages and use the mini model', async () => {
      mockedAxios.post.mockResolvedValue(makeApiResponse());

      await client.querySubLM('system prompt', 'user prompt');

      const body = mockedAxios.post.mock.calls[0][1];
      expect(body.model).toBe('gpt-5-mini');
      expect(body.max_completion_tokens).toBe(90000);
      expect(body.messages).toEqual([
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ]);
    });
  });

  describe('queryMiniLM()', () => {
    it('should use the mini model with 4000 max tokens', async () => {
      mockedAxios.post.mockResolvedValue(makeApiResponse());

      await client.queryMiniLM([{ role: 'user', content: 'Hi' }]);

      const body = mockedAxios.post.mock.calls[0][1];
      expect(body.model).toBe('gpt-5-mini');
      expect(body.max_completion_tokens).toBe(4000);
    });
  });

  describe('queryNano()', () => {
    it('should use the nano model with 500 max tokens and intent cache key', async () => {
      mockedAxios.post.mockResolvedValue(makeApiResponse());

      await client.queryNano([{ role: 'user', content: 'Hi' }]);

      const body = mockedAxios.post.mock.calls[0][1];
      expect(body.model).toBe('gpt-5-nano');
      expect(body.max_completion_tokens).toBe(500);
      expect(body.prompt_cache_key).toBe('nano-intent');
    });
  });

  describe('queryNanoShort()', () => {
    it('should use the nano model with the chitchat cache key', async () => {
      mockedAxios.post.mockResolvedValue(makeApiResponse());

      await client.queryNanoShort([{ role: 'user', content: 'Hi' }]);

      const body = mockedAxios.post.mock.calls[0][1];
      expect(body.model).toBe('gpt-5-nano');
      expect(body.prompt_cache_key).toBe('nano-chitchat');
    });
  });

  describe('estimateTokens()', () => {
    it('should estimate roughly text length / 4', () => {
      expect(client.estimateTokens('12345678')).toBe(2);
      expect(client.estimateTokens('abc')).toBe(1);
      expect(client.estimateTokens('')).toBe(0);
    });
  });

  describe('config defaults', () => {
    it('should fall back to default max token limits when config is missing', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [
          LlmApiClient,
          {
            provide: ConfigService,
            // Only return the model keys; max-token keys are undefined → defaults apply
            useValue: {
              get: jest.fn((key: string) =>
                key === 'OPENAI_MODEL' ? 'gpt-5.4' : undefined,
              ),
            },
          },
        ],
      }).compile();

      const defaultClient = moduleRef.get<LlmApiClient>(LlmApiClient);
      mockedAxios.post.mockResolvedValue(makeApiResponse());

      await defaultClient.queryRootLM([{ role: 'user', content: 'Hi' }]);

      const body = mockedAxios.post.mock.calls[0][1];
      expect(body.max_completion_tokens).toBe(100000);
    });

    it('should report 0% cache when prompt_tokens is 0', async () => {
      mockedAxios.post.mockResolvedValue(
        makeApiResponse({
          usage: { prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
        }),
      );

      const result = await client.queryRootLM([{ role: 'user', content: 'Hi' }]);

      expect(result.input_tokens).toBe(0);
      expect(result.cached_input_tokens).toBe(0);
    });
  });
});
