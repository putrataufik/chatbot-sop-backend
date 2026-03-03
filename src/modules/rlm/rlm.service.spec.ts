import { Test, TestingModule } from '@nestjs/testing';
import { RlmService } from './rlm.service';

describe('RlmService', () => {
  let service: RlmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RlmService],
    }).compile();

    service = module.get<RlmService>(RlmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
