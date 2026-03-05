// FILE: src/modules/chat/chat.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSession } from './entities/chat-session.entity';
import { Message } from './entities/message.entity';
import { RlmModule } from '../rlm/rlm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, Message]),
    forwardRef(() => RlmModule), // ← hindari circular dependency
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService, TypeOrmModule],
})
export class ChatModule {}