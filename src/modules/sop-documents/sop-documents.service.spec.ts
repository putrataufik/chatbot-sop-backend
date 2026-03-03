import { Test, TestingModule } from '@nestjs/testing';
import { SopDocumentsService } from './sop-documents.service';

describe('SopDocumentsService', () => {
  let service: SopDocumentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SopDocumentsService],
    }).compile();

    service = module.get<SopDocumentsService>(SopDocumentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
