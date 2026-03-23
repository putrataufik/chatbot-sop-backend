// FILE: src/modules/sop-documents/sop-documents.service.ts

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { SopDocument, SopFormat } from './entities/sop-document.entity';
import { CreateSopDto } from './dto/create-sop.dto';
import { User } from '../users/entities/user.entity';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import * as path from 'path';

@Injectable()
export class SopDocumentsService {
  constructor(
    @InjectRepository(SopDocument)
    private sopRepository: Repository<SopDocument>,
  ) {}

  // Deteksi format dari ekstensi file
  private detectFormat(filename: string): SopFormat {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') return SopFormat.PDF;
    if (ext === '.txt') return SopFormat.TXT;
    throw new BadRequestException(
      `Format file tidak didukung: ${ext}. Gunakan .pdf atau .txt`,
    );
  }

  // Ambil title dari nama file (tanpa ekstensi)
  private getTitleFromFilename(filename: string): string {
    return path.basename(filename, path.extname(filename));
  }

  private async extractContent(
    fileBuffer: Buffer,
    format: SopFormat,
  ): Promise<string> {
    if (format === SopFormat.TXT) {
      return fileBuffer.toString('utf-8');
    }

    if (format === SopFormat.PDF) {
      try {
        const uint8Array = new Uint8Array(fileBuffer);

        const loadingTask = pdfjsLib.getDocument({
          data: uint8Array,
          useWorkerFetch: false,
          isEvalSupported: false,
          useSystemFonts: true,
        });

        const pdf = await loadingTask.promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => ('str' in item ? item.str : ''))
            .join(' ');
          fullText += pageText + '\n';
        }

        return fullText.trim();
      } catch (e) {
        console.error('PDF parse error:', e);
        throw new BadRequestException('Gagal membaca file PDF');
      }
    }

    throw new BadRequestException('Format file tidak didukung');
  }

  // Upload single dokumen (title & format dari file)
  // async create(
  //   dto: CreateSopDto,
  //   fileBuffer: Buffer,
  //   fileSize: number,
  //   uploadedBy: User,
  // ): Promise<{ message: string; id: number }> {
  //   const content = await this.extractContent(fileBuffer, dto.format);

  //   const sop = this.sopRepository.create({
  //     title: dto.title,
  //     content,
  //     format: dto.format,
  //     file_size: fileSize,
  //     uploaded_by_user: uploadedBy,
  //   });

  //   const saved = await this.sopRepository.save(sop);
  //   return { message: 'Dokumen SOP berhasil diupload', id: saved.id };
  // }

  // Upload multiple dokumen sekaligus
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

        // --- TAMBAHKAN PENGECEKAN DISINI ---
        const isExist = await this.sopRepository.findOne({ where: { title } });
        if (isExist) {
          throw new Error(`Judul "${title}" sudah terdaftar di sistem.`);
        }
        // -----------------------------------

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

    return sops.map((sop) => {
      const { uploaded_by_user, ...rest } = sop;
      return Object.assign({}, rest, {
        uploaded_by: {
          id: uploaded_by_user.id,
          name: uploaded_by_user.name,
        },
      });
    });
  }

  async findById(id: number): Promise<any> {
    const sop = await this.sopRepository.findOne({
      where: { id },
      relations: ['uploaded_by_user'],
    });
    if (!sop) {
      throw new NotFoundException(
        `Dokumen SOP dengan id ${id} tidak ditemukan`,
      );
    }
    const { uploaded_by_user, ...rest } = sop;
    return {
      ...rest,
      uploaded_by: {
        id: uploaded_by_user.id,
        name: uploaded_by_user.name,
      },
    };
  }

  async update(id: number, title: string): Promise<{ message: string }> {
    // 1. Cari dokumennya dulu
    const sop = await this.findById(id);

    // 2. Cek apakah title baru sudah dipakai oleh dokumen LAIN
    const isExist = await this.sopRepository.findOne({
      where: { title, id: Not(sop.id) }, // Gunakan Not dari 'typeorm'
    });

    if (isExist) {
      throw new BadRequestException(
        `Judul "${title}" sudah digunakan dokumen lain.`,
      );
    }

    await this.sopRepository.update(sop.id, { title });
    return { message: 'Dokumen SOP berhasil diupdate' };
  }

  async remove(id: number): Promise<{ message: string }> {
    const sop = await this.findById(id);
    await this.sopRepository.delete(sop.id);
    return { message: 'Dokumen SOP berhasil dihapus' };
  }

  async findAllMetadata(): Promise<
    Array<{ id: number; title: string; file_size: number }>
  > {
    return this.sopRepository
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.title', 'doc.file_size'])
      .getMany();
  }
}
