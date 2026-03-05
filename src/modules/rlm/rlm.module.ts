// FILE: src/modules/rlm/rlm.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RlmService } from './rlm.service';
import { RlmEngine } from './rlm.engine';
import { LlmApiClient } from './llm-api.client';
import { SubQueryResult } from './entities/sub-query-result.entity';
import { TokenUsageLog } from './entities/token-usage-log.entity';
import { ChatModule } from '../chat/chat.module';
import { SopDocumentsModule } from '../sop-documents/sop-documents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubQueryResult, TokenUsageLog]),
    forwardRef(() => ChatModule), // ← hindari circular dependency
    SopDocumentsModule,
  ],
  providers: [RlmService, RlmEngine, LlmApiClient],
  exports: [RlmService],
})
export class RlmModule {}