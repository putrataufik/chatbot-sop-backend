import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RlmEngine } from './rlm.engine';
import { ReplSandbox } from './repl.sandbox';
import { LlmApiClient } from './llm-api.client';
import { RlmService } from './rlm.service';
import { TokenUsageLog } from './entities/token-usage-log.entity';
import { SubQueryResult } from './entities/sub-query-result.entity';
import { ChatModule } from '../chat/chat.module';
import { SopDocumentsModule } from '../sop-documents/sop-documents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TokenUsageLog, SubQueryResult]),
    forwardRef(() => ChatModule),
    SopDocumentsModule,                 
  ],
  providers: [RlmEngine, ReplSandbox, LlmApiClient, RlmService],
  exports: [RlmEngine, RlmService],
})
export class RlmModule {}