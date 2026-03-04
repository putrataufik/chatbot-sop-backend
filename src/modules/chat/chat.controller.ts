import { Controller, Get, Post, Body, Param, Delete, Request, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat/sessions')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Membuat sesi chat baru' })
  async createSession(@Request() req, @Body() createChatSessionDto: CreateChatSessionDto) {
    const userId = req.user.id;
    return this.chatService.createSession(userId, createChatSessionDto);
  }

  @Get()
  @ApiOperation({ summary: 'Mendapatkan daftar sesi chat' })
  async findAllSessions(@Request() req) {
    const userId = req.user.id;
    const role = req.user.role;
    return this.chatService.findAllSessions(userId, role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Mendapatkan detail sesi chat beserta pesan di dalamnya' })
  async findOneSession(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const userId = req.user.id;
    const role = req.user.role;
    return this.chatService.findOneSession(id, userId, role);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Menghapus sesi chat' })
  async deleteSession(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const userId = req.user.id;
    const role = req.user.role;
    
    await this.chatService.deleteSession(id, userId, role);
    return { message: 'Sesi chat berhasil dihapus' };
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Mengirim pesan ke sesi chat (bertanya ke Chatbot)' })
  async sendMessage(
    @Request() req,
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    const userId = req.user.id;
    const role = req.user.role;
    return this.chatService.sendMessage(sessionId, userId, role, sendMessageDto);
  }
}