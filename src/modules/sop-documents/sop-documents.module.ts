// FILE: src/modules/sop-documents/sop-documents.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SopDocumentsController } from './sop-documents.controller';
import { SopDocumentsService } from './sop-documents.service';
import { SopDocument } from './entities/sop-document.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SopDocument])],
  controllers: [SopDocumentsController],
  providers: [SopDocumentsService],
  exports: [SopDocumentsService, TypeOrmModule],
})
export class SopDocumentsModule {}