// FILE: src/modules/sop-documents/sop-documents.service.ts
// ✅ Mendukung: .pdf, .docx, .txt
// PDF  → PdfExtractorService  (koordinat x,y + algoritma swim-lane)
// DOCX → DocxExtractorService (baca XML langsung → struktur sempurna)
// TXT  → baca langsung

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { SopDocument, SopFormat } from './entities/sop-document.entity';
import { User } from '../users/entities/user.entity';
import { PdfExtractorService } from './docx-extractor.service';
import * as path from 'path';

@Injectable()
export class SopDocumentsService {
  constructor(
    @InjectRepository(SopDocument)
    private sopRepository: Repository<SopDocument>,
    private pdfExtractor: PdfExtractorService,
  ) {}

  private detectFormat(filename: string): SopFormat {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') return SopFormat.PDF;
    if (ext === '.docx') return SopFormat.DOCX; // ← tambah
    if (ext === '.txt') return SopFormat.TXT;
    throw new BadRequestException(
      `Format tidak didukung: ${ext}. Gunakan .pdf, .docx, atau .txt`,
    );
  }

  private getTitleFromFilename(filename: string): string {
    return path.basename(filename, path.extname(filename));
  }

  private async extractContent(
    buffer: Buffer,
    format: SopFormat,
  ): Promise<string> {
    if (format === SopFormat.TXT) return buffer.toString('utf-8');
    if (format === SopFormat.PDF) return this.pdfExtractor.extract(buffer);
    throw new BadRequestException('Format tidak didukung');
  }

  async createBulk(
    files: Express.Multer.File[],
    uploadedBy: User,
  ): Promise<{
    message: string;
    success: Array<{ id: number; title: string; format: string }>;
    failed: Array<{ filename: string; reason: string }>;
  }> {
    const success: Array<{ id: number; title: string; format: string }> = [];
    const failed: Array<{ filename: string; reason: string }> = [];

    for (const file of files) {
      try {
        const format = this.detectFormat(file.originalname);
        const title = this.getTitleFromFilename(file.originalname);

        const isExist = await this.sopRepository.findOne({ where: { title } });
        if (isExist) throw new Error(`Judul "${title}" sudah terdaftar.`);

        const content = await this.extractContent(file.buffer, format);

        const sop = this.sopRepository.create({
          title,
          content,
          format,
          file_size: file.size,
          uploaded_by_user: uploadedBy,
        });
        const saved = await this.sopRepository.save(sop);
        success.push({ id: saved.id, title, format });
      } catch (e: any) {
        failed.push({ filename: file.originalname, reason: e.message });
      }
    }

    return {
      message: `${success.length} dokumen berhasil diupload, ${failed.length} gagal`,
      success,
      failed,
    };
  }

  async findAll(): Promise<any[]> {
    const sops = await this.sopRepository.find({
      select: ['id', 'title', 'format', 'file_size', 'uploaded_at'],
      relations: ['uploaded_by_user'],
    });
    return sops.map(({ uploaded_by_user, ...rest }) => ({
      ...rest,
      uploaded_by: { id: uploaded_by_user.id, name: uploaded_by_user.name },
    }));
  }

  async findById(id: number): Promise<any> {
    const sop = await this.sopRepository.findOne({
      where: { id },
      relations: ['uploaded_by_user'],
    });
    if (!sop) throw new NotFoundException(`Dokumen id ${id} tidak ditemukan`);
    const { uploaded_by_user, ...rest } = sop;
    return {
      ...rest,
      uploaded_by: { id: uploaded_by_user.id, name: uploaded_by_user.name },
    };
  }

  async update(id: number, title: string): Promise<{ message: string }> {
    const sop = await this.findById(id);
    const isExist = await this.sopRepository.findOne({
      where: { title, id: Not(sop.id) },
    });
    if (isExist)
      throw new BadRequestException(`Judul "${title}" sudah digunakan.`);
    await this.sopRepository.update(sop.id, { title });
    return { message: 'Dokumen SOP berhasil diupdate' };
  }

  async remove(id: number): Promise<{ message: string }> {
    const sop = await this.findById(id);
    await this.sopRepository.delete(sop.id);
    return { message: 'Dokumen SOP berhasil dihapus' };
  }

  async removeAll(): Promise<{ message: string; deleted: number }> {
    const all = await this.sopRepository.find({ select: ['id'] });
    if (all.length === 0) {
      return { message: 'Tidak ada dokumen untuk dihapus', deleted: 0 };
    }

    const ids = all.map((sop) => sop.id);
    await this.sopRepository.delete(ids);

    return {
      message: `${ids.length} dokumen SOP berhasil dihapus`,
      deleted: ids.length,
    };
  }

  async findAllMetadata(): Promise<
    Array<{ id: number; title: string; file_size: number }>
  > {
    return this.sopRepository
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.title', 'doc.file_size'])
      .getMany();
  }

  async findAllWithContent(): Promise<
    Array<{ id: number; title: string; content: string }>
  > {
    return this.sopRepository
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.title', 'doc.content'])
      .getMany();
  }
}
