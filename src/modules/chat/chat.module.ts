import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Message } from './entities/message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([ChatSession, Message])],
  controllers: [ChatController],
  providers: [ChatService]
})
export class ChatModule {}
