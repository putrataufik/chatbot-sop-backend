// FILE: src/modules/sop-documents/sop-documents.controller.ts

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseIntPipe,
  Request,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SopDocumentsService } from './sop-documents.service';
import { CreateSopDto } from './dto/create-sop.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('SOP Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sop-documents')
export class SopDocumentsController {
  constructor(private readonly sopDocumentsService: SopDocumentsService) {}

  // ── Upload BULK (multiple files, title & format otomatis dari nama file)
  @Post('bulk')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('files', 50))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Upload multiple file PDF atau TXT sekaligus',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload multiple dokumen SOP sekaligus (Admin only)',
    description:
      'Title otomatis diambil dari nama file. Format otomatis dideteksi dari ekstensi (.pdf / .txt).',
  })
  @ApiResponse({
    status: 201,
    description: 'Hasil upload bulk',
    schema: {
      example: {
        message: '3 dokumen berhasil diupload, 0 gagal',
        success: [
          { id: 1, title: 'SOP Rekrutmen', format: 'PDF' },
          { id: 2, title: 'SOP Cuti Karyawan', format: 'PDF' },
          { id: 3, title: 'SOP Kenaikan Gaji', format: 'TXT' },
        ],
        failed: [],
      },
    },
  })
  async createBulk(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: any,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Minimal 1 file harus diupload');
    }
    return this.sopDocumentsService.createBulk(files, req.user);
  }

  // ── Upload SINGLE (title & format otomatis dari nama file)
  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('files', 1))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'string',
          format: 'binary',
          description: 'File PDF atau TXT. Title otomatis dari nama file.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload 1 dokumen SOP (Admin only)',
    description:
      'Title otomatis diambil dari nama file. Format otomatis dideteksi dari ekstensi.',
  })
  @ApiResponse({ status: 201, description: 'Berhasil diupload' })
  async create(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: any,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('File tidak boleh kosong');
    }
    const result = await this.sopDocumentsService.createBulk(
      [files[0]],
      req.user,
    );
    if (result.failed.length > 0) {
      throw new BadRequestException(result.failed[0].reason);
    }
    return {
      message: 'Dokumen SOP berhasil diupload',
      id: result.success[0].id,
    };
  }

  // ── GET semua SOP
  @Get()
  @ApiOperation({ summary: 'Get semua dokumen SOP' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  findAll() {
    return this.sopDocumentsService.findAll();
  }

  // ── GET SOP by id
  @Get(':id')
  @ApiOperation({ summary: 'Get dokumen SOP by ID' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  @ApiResponse({ status: 404, description: 'Tidak ditemukan' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.sopDocumentsService.findById(id);
  }

  // ── PATCH update title SOP
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body('title') title: string, // ← langsung ambil field title
  ) {
    return this.sopDocumentsService.update(id, title);
  }

  // ── DELETE SOP
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Hapus dokumen SOP (Admin only)' })
  @ApiResponse({ status: 200, description: 'Berhasil dihapus' })
  @ApiResponse({ status: 404, description: 'Tidak ditemukan' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.sopDocumentsService.remove(id);
  }
}