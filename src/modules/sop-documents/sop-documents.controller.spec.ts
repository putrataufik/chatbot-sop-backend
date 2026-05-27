import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SopDocumentsController } from './sop-documents.controller';
import { SopDocumentsService } from './sop-documents.service';
import { SopFormat } from './entities/sop-document.entity';

const makeFile = (name = 'doc.pdf'): Express.Multer.File =>
  ({ originalname: name, buffer: Buffer.from('x'), size: 100 } as any);

describe('SopDocumentsController', () => {
  let controller: SopDocumentsController;
  let service: jest.Mocked<SopDocumentsService>;

  const req = { user: { id: 1, role: 'ADMIN' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SopDocumentsController],
      providers: [
        {
          provide: SopDocumentsService,
          useValue: {
            createBulk: jest.fn(),
            findAll: jest.fn(),
            findById: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            removeAll: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<SopDocumentsController>(SopDocumentsController);
    service = module.get(SopDocumentsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createBulk()', () => {
    it('should delegate to service with files and user', async () => {
      const files = [makeFile('a.pdf'), makeFile('b.pdf')];
      const expected = { message: 'ok', success: [], failed: [] };
      service.createBulk.mockResolvedValue(expected as any);

      const result = await controller.createBulk(files, req);

      expect(service.createBulk).toHaveBeenCalledWith(files, req.user);
      expect(result).toBe(expected);
    });

    it('should throw BadRequestException when no files provided', async () => {
      await expect(controller.createBulk([], req)).rejects.toThrow(BadRequestException);
      await expect(controller.createBulk(undefined as any, req)).rejects.toThrow(BadRequestException);
      expect(service.createBulk).not.toHaveBeenCalled();
    });
  });

  describe('create()', () => {
    it('should upload a single file and return id', async () => {
      const files = [makeFile('single.pdf')];
      service.createBulk.mockResolvedValue({
        message: 'ok',
        success: [{ id: 42, title: 'single', format: SopFormat.PDF }],
        failed: [],
      } as any);

      const result = await controller.create(files, req);

      expect(service.createBulk).toHaveBeenCalledWith([files[0]], req.user);
      expect(result).toEqual({ message: 'Dokumen SOP berhasil diupload', id: 42 });
    });

    it('should throw BadRequestException when no file provided', async () => {
      await expect(controller.create([], req)).rejects.toThrow(BadRequestException);
      expect(service.createBulk).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the upload fails', async () => {
      const files = [makeFile('bad.docx')];
      service.createBulk.mockResolvedValue({
        message: 'failed',
        success: [],
        failed: [{ filename: 'bad.docx', reason: 'Format tidak didukung' }],
      } as any);

      await expect(controller.create(files, req)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll()', () => {
    it('should delegate to service', () => {
      service.findAll.mockReturnValue('all' as any);

      const result = controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toBe('all');
    });
  });

  describe('findOne()', () => {
    it('should delegate to service with id', () => {
      service.findById.mockReturnValue('doc' as any);

      const result = controller.findOne(7);

      expect(service.findById).toHaveBeenCalledWith(7);
      expect(result).toBe('doc');
    });
  });

  describe('update()', () => {
    it('should delegate to service with id and title', () => {
      service.update.mockReturnValue('updated' as any);

      const result = controller.update(7, 'New Title');

      expect(service.update).toHaveBeenCalledWith(7, 'New Title');
      expect(result).toBe('updated');
    });
  });

  describe('removeAll()', () => {
    it('should delegate to service.removeAll', () => {
      service.removeAll.mockReturnValue('removed-all' as any);

      const result = controller.removeAll();

      expect(service.removeAll).toHaveBeenCalled();
      expect(result).toBe('removed-all');
    });
  });

  describe('remove()', () => {
    it('should delegate to service.remove with id', () => {
      service.remove.mockReturnValue('removed' as any);

      const result = controller.remove(7);

      expect(service.remove).toHaveBeenCalledWith(7);
      expect(result).toBe('removed');
    });
  });
});
