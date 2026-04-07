// FILE: src/modules/sop-documents/sop-documents.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { SopDocumentsController } from './sop-documents.controller';
import { SopDocumentsService }    from './sop-documents.service';
import { SopDocument }            from './entities/sop-document.entity';
import { DocxExtractorService }   from './docx-extractor.service'; // ← TAMBAH

@Module({
  imports: [
    TypeOrmModule.forFeature([SopDocument]),
    MulterModule.register({
      storage: undefined,
      limits: { fileSize: 20 * 1024 * 1024 }, 
    }),
  ],
  controllers: [SopDocumentsController],
  providers: [
    SopDocumentsService,
    DocxExtractorService,
    DocxExtractorService, // ← TAMBAH
  ],
  exports: [SopDocumentsService, TypeOrmModule],
})
export class SopDocumentsModule {}