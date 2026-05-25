import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Not } from 'typeorm';
import { SopDocumentsService } from './sop-documents.service';
import { SopDocument, SopFormat } from './entities/sop-document.entity';
import { PdfExtractorService } from './docx-extractor.service';

// ── Helpers ───────────────────────────────────────────────────────────────

const makeUploadedByUser = () => ({
  id: 1,
  name: 'Admin User',
});

const makeSopDocument = (overrides: Partial<any> = {}) => ({
  id: 1,
  title: 'SOP Rekrutmen',
  content: '[DOC] Isi SOP Rekrutmen lengkap',
  format: SopFormat.PDF,
  file_size: 50000,
  uploaded_at: new Date('2024-01-01'),
  uploaded_by_user: makeUploadedByUser(),
  ...overrides,
});

const makePdfFile = (overrides: Partial<any> = {}): Express.Multer.File => ({
  fieldname: 'files',
  originalname: 'SOP_Rekrutmen.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: Buffer.from('PDF content'),
  size: 50000,
  destination: '',
  filename: '',
  path: '',
  stream: null as any,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('SopDocumentsService', () => {
  let service: SopDocumentsService;
  let sopRepo: jest.Mocked<any>;
  let pdfExtractor: jest.Mocked<PdfExtractorService>;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  const mockSopRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  const mockPdfExtractor = {
    extract: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSopRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SopDocumentsService,
        { provide: getRepositoryToken(SopDocument), useValue: mockSopRepo },
        { provide: PdfExtractorService, useValue: mockPdfExtractor },
      ],
    }).compile();

    service = module.get<SopDocumentsService>(SopDocumentsService);
    sopRepo = mockSopRepo;
    pdfExtractor = module.get(PdfExtractorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // createBulk
  // ═══════════════════════════════════════════════════════════════════════

  describe('createBulk()', () => {
    const uploadedBy = makeUploadedByUser() as any;

    it('should successfully upload valid PDF files', async () => {
      const file = makePdfFile();
      const sopDoc = makeSopDocument();

      pdfExtractor.extract.mockResolvedValue('[DOC] Konten hasil ekstraksi');
      sopRepo.findOne.mockResolvedValue(null); // No duplicate
      sopRepo.create.mockReturnValue(sopDoc);
      sopRepo.save.mockResolvedValue(sopDoc);

      const result = await service.createBulk([file], uploadedBy);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
      expect(result.success[0].title).toBe('SOP_Rekrutmen');
      expect(result.success[0].format).toBe(SopFormat.PDF);
    });

    it('should fail for non-PDF files', async () => {
      const file = makePdfFile({ originalname: 'document.docx' });

      const result = await service.createBulk([file], uploadedBy);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].filename).toBe('document.docx');
      expect(result.failed[0].reason).toContain('.docx');
      expect(result.success).toHaveLength(0);
    });

    it('should fail when document title already exists', async () => {
      const file = makePdfFile();
      sopRepo.findOne.mockResolvedValue(makeSopDocument()); // Duplicate exists

      const result = await service.createBulk([file], uploadedBy);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain('sudah terdaftar');
    });

    it('should process multiple files and track success and failures separately', async () => {
      const pdfFile = makePdfFile({ originalname: 'valid.pdf' });
      const docxFile = makePdfFile({ originalname: 'invalid.docx' });
      const sopDoc = makeSopDocument({ id: 2, title: 'valid' });

      pdfExtractor.extract.mockResolvedValue('Konten PDF');
      sopRepo.findOne.mockResolvedValue(null);
      sopRepo.create.mockReturnValue(sopDoc);
      sopRepo.save.mockResolvedValue(sopDoc);

      const result = await service.createBulk([pdfFile, docxFile], uploadedBy);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.message).toContain('1 dokumen berhasil');
    });

    it('should handle PDF extraction failure gracefully', async () => {
      const file = makePdfFile();
      sopRepo.findOne.mockResolvedValue(null);
      pdfExtractor.extract.mockRejectedValue(new Error('Extraction failed'));

      const result = await service.createBulk([file], uploadedBy);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toBe('Extraction failed');
    });

    it('should extract title from filename without extension', async () => {
      const file = makePdfFile({ originalname: 'SOP Pengadaan Barang 2024.pdf' });
      const sopDoc = makeSopDocument({ id: 3, title: 'SOP Pengadaan Barang 2024' });

      pdfExtractor.extract.mockResolvedValue('Konten');
      sopRepo.findOne.mockResolvedValue(null);
      sopRepo.create.mockReturnValue(sopDoc);
      sopRepo.save.mockResolvedValue(sopDoc);

      const result = await service.createBulk([file], uploadedBy);

      expect(result.success[0].title).toBe('SOP Pengadaan Barang 2024');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // findAll
  // ═══════════════════════════════════════════════════════════════════════

  describe('findAll()', () => {
    it('should return all SOP documents with uploader info', async () => {
      const sops = [makeSopDocument(), makeSopDocument({ id: 2, title: 'SOP Pengadaan' })];
      sopRepo.find.mockResolvedValue(sops);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('uploaded_by');
      expect(result[0]).not.toHaveProperty('uploaded_by_user');
    });

    it('should return empty array when no documents', async () => {
      sopRepo.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });

    it('should include id, title, format, file_size, uploaded_at', async () => {
      sopRepo.find.mockResolvedValue([makeSopDocument()]);

      const result = await service.findAll();

      expect(result[0]).toMatchObject({
        id: 1,
        title: 'SOP Rekrutmen',
        format: SopFormat.PDF,
        file_size: 50000,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // findById
  // ═══════════════════════════════════════════════════════════════════════

  describe('findById()', () => {
    it('should return document with uploader info when found', async () => {
      sopRepo.findOne.mockResolvedValue(makeSopDocument());

      const result = await service.findById(1);

      expect(result.id).toBe(1);
      expect(result.uploaded_by).toEqual({ id: 1, name: 'Admin User' });
      expect(result).not.toHaveProperty('uploaded_by_user');
    });

    it('should throw NotFoundException when document not found', async () => {
      sopRepo.findOne.mockResolvedValue(null);

      await expect(service.findById(99)).rejects.toThrow(NotFoundException);
    });

    it('should call findOne with correct conditions', async () => {
      sopRepo.findOne.mockResolvedValue(makeSopDocument());

      await service.findById(5);

      expect(sopRepo.findOne).toHaveBeenCalledWith({
        where: { id: 5 },
        relations: ['uploaded_by_user'],
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // update
  // ═══════════════════════════════════════════════════════════════════════

  describe('update()', () => {
    it('should update title when no duplicate exists', async () => {
      const existing = makeSopDocument();
      sopRepo.findOne
        .mockResolvedValueOnce(existing)   // findById call
        .mockResolvedValueOnce(null);      // duplicate check

      sopRepo.update.mockResolvedValue(undefined);

      const result = await service.update(1, 'New Title');

      expect(sopRepo.update).toHaveBeenCalledWith(existing.id, { title: 'New Title' });
      expect(result.message).toBe('Dokumen SOP berhasil diupdate');
    });

    it('should throw NotFoundException when document not found', async () => {
      sopRepo.findOne.mockResolvedValue(null);

      await expect(service.update(99, 'Title')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when title already used by another document', async () => {
      const existing = makeSopDocument({ id: 1 });
      const duplicate = makeSopDocument({ id: 2, title: 'Existing Title' });

      sopRepo.findOne
        .mockResolvedValueOnce(existing)   // findById
        .mockResolvedValueOnce(duplicate); // duplicate check

      await expect(service.update(1, 'Existing Title')).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // remove
  // ═══════════════════════════════════════════════════════════════════════

  describe('remove()', () => {
    it('should delete document when found', async () => {
      const sop = makeSopDocument();
      sopRepo.findOne.mockResolvedValue(sop);
      sopRepo.delete.mockResolvedValue(undefined);

      const result = await service.remove(1);

      expect(sopRepo.delete).toHaveBeenCalledWith(sop.id);
      expect(result.message).toBe('Dokumen SOP berhasil dihapus');
    });

    it('should throw NotFoundException when document not found', async () => {
      sopRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // removeAll
  // ═══════════════════════════════════════════════════════════════════════

  describe('removeAll()', () => {
    it('should delete all documents and return count', async () => {
      const sops = [{ id: 1 }, { id: 2 }, { id: 3 }];
      sopRepo.find.mockResolvedValue(sops);
      sopRepo.delete.mockResolvedValue(undefined);

      const result = await service.removeAll();

      expect(sopRepo.delete).toHaveBeenCalledWith([1, 2, 3]);
      expect(result.deleted).toBe(3);
      expect(result.message).toContain('3 dokumen');
    });

    it('should return message without deleting when no documents', async () => {
      sopRepo.find.mockResolvedValue([]);

      const result = await service.removeAll();

      expect(sopRepo.delete).not.toHaveBeenCalled();
      expect(result.deleted).toBe(0);
      expect(result.message).toContain('Tidak ada');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // findAllMetadata
  // ═══════════════════════════════════════════════════════════════════════

  describe('findAllMetadata()', () => {
    it('should return metadata using query builder', async () => {
      const metadata = [
        { id: 1, title: 'SOP Rekrutmen', file_size: 50000 },
        { id: 2, title: 'SOP Pengadaan', file_size: 30000 },
      ];
      mockQueryBuilder.getMany.mockResolvedValue(metadata);

      const result = await service.findAllMetadata();

      expect(sopRepo.createQueryBuilder).toHaveBeenCalledWith('doc');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(['doc.id', 'doc.title', 'doc.file_size']);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1, title: 'SOP Rekrutmen', file_size: 50000 });
    });

    it('should return empty array when no documents exist', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const result = await service.findAllMetadata();

      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // findAllWithContent
  // ═══════════════════════════════════════════════════════════════════════

  describe('findAllWithContent()', () => {
    it('should return documents with content using query builder', async () => {
      const docs = [
        { id: 1, title: 'SOP Rekrutmen', content: '[DOC] Isi lengkap' },
      ];
      mockQueryBuilder.getMany.mockResolvedValue(docs);

      const result = await service.findAllWithContent();

      expect(sopRepo.createQueryBuilder).toHaveBeenCalledWith('doc');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(['doc.id', 'doc.title', 'doc.content']);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('[DOC] Isi lengkap');
    });
  });
});
