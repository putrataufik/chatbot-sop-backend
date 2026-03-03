// Lokasi: src/modules/sop-documents/sop-documents.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SopDocumentsService } from './sop-documents.service';
import { SopDocumentsController } from './sop-documents.controller';
import { SopDocument } from './entities/sop-document.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SopDocument])],
  controllers: [SopDocumentsController],
  providers: [SopDocumentsService],
})
export class SopDocumentsModule {}