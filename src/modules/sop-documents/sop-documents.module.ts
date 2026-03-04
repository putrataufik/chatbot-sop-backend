import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { SopDocumentsController } from './sop-documents.controller';
import { SopDocumentsService } from './sop-documents.service';
import { SopDocument } from './entities/sop-document.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SopDocument]),
    MulterModule.register({
      storage: undefined, // ← gunakan memoryStorage (buffer)
      limits: {
        fileSize: 10 * 1024 * 1024, // maksimal 10MB
      },
    }),
  ],
  controllers: [SopDocumentsController],
  providers: [SopDocumentsService],
  exports: [SopDocumentsService, TypeOrmModule],
})
export class SopDocumentsModule {}