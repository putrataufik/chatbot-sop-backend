// Lokasi: src/modules/rlm/rlm.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RlmService } from './rlm.service';
// Pastikan path import ini sesuai dengan struktur foldermu
import { SubQueryResult } from './entities/sub-query-result.entity';
import { TokenUsageLog } from './entities/token-usage-log.entity';

@Module({
  // WAJIB: Daftarkan entity yang ada di dalam modul ini
  imports: [TypeOrmModule.forFeature([SubQueryResult, TokenUsageLog])],
  providers: [RlmService],
  exports: [RlmService],
})
export class RlmModule {}