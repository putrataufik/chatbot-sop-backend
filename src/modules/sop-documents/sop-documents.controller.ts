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
  UploadedFile,
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
import { FileInterceptor } from '@nestjs/platform-express';
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

  // Upload SOP → hanya ADMIN
  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', example: 'SOP Pengajuan Cuti' },
        format: { type: 'string', enum: ['PDF', 'TXT'] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload dokumen SOP (Admin only)' })
  @ApiResponse({ status: 201, description: 'Berhasil diupload' })
  async create(
    @Body() dto: CreateSopDto,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('File tidak boleh kosong');
    }
    return this.sopDocumentsService.create(
      dto,
      file.buffer,
      file.size,
      req.user,
    );
  }

  // GET semua SOP → semua role
  @Get()
  @ApiOperation({ summary: 'Get semua dokumen SOP' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  findAll() {
    return this.sopDocumentsService.findAll();
  }

  // GET SOP by id → semua role
  @Get(':id')
  @ApiOperation({ summary: 'Get dokumen SOP by ID' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  @ApiResponse({ status: 404, description: 'Tidak ditemukan' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.sopDocumentsService.findById(id);
  }

  // PATCH update SOP → hanya ADMIN
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update judul dokumen SOP (Admin only)' })
  @ApiResponse({ status: 200, description: 'Berhasil diupdate' })
  @ApiResponse({ status: 404, description: 'Tidak ditemukan' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateSopDto>,
  ) {
    return this.sopDocumentsService.update(id, dto);
  }

  // DELETE SOP → hanya ADMIN
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Hapus dokumen SOP (Admin only)' })
  @ApiResponse({ status: 200, description: 'Berhasil dihapus' })
  @ApiResponse({ status: 404, description: 'Tidak ditemukan' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.sopDocumentsService.remove(id);
  }
}