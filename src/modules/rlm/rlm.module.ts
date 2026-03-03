// FILE: src/modules/rlm/rlm.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RlmService } from './rlm.service';
import { SubQueryResult } from './entities/sub-query-result.entity';
import { TokenUsageLog } from './entities/token-usage-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SubQueryResult, TokenUsageLog])],
  providers: [RlmService],
  exports: [RlmService, TypeOrmModule],
})
export class RlmModule {}