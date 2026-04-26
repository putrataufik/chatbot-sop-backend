// FILE: src/modules/chat/chat.controller.ts

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { RlmService } from '../rlm/rlm.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly rlmService: RlmService,
  ) {}

  // ── ChatSession ────────────────────────────────────────

  @Post('sessions')
  @ApiOperation({ summary: 'Buat session chat baru' })
  @ApiResponse({ status: 201, description: 'Session berhasil dibuat' })
  createSession(@Body() dto: CreateSessionDto, @Request() req: any) {
    return this.chatService.createSession(dto, req.user);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Get semua session chat' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  findAllSessions(@Request() req: any) {
    return this.chatService.findAllSessions(req.user);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get session by ID beserta messages' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  @ApiResponse({ status: 404, description: 'Session tidak ditemukan' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findSessionById(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.chatService.findSessionById(id, req.user);
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Hapus session chat' })
  @ApiResponse({ status: 200, description: 'Session berhasil dihapus' })
  @ApiResponse({ status: 404, description: 'Session tidak ditemukan' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  removeSession(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.chatService.removeSession(id, req.user);
  }

  // ── Message ────────────────────────────────────────────

  @Get('sessions/:id/messages')
  @ApiOperation({ summary: 'Get semua message dalam session' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  @ApiResponse({ status: 404, description: 'Session tidak ditemukan' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findMessages(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.chatService.findMessagesBySession(id, req.user);
  }

  // Send message → proses dengan RLM Engine
  @Post('sessions/:id/messages')
  @ApiOperation({ summary: 'Kirim pesan dan dapatkan jawaban dari RLM' })
  @ApiResponse({ status: 201, description: 'Pesan berhasil diproses' })
  async sendMessage(
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: SendMessageDto,
    @Request() req: any,
  ) {
    await this.chatService.findSessionById(sessionId, req.user);
    return this.rlmService.sendMessage(sessionId, dto.content);
  }

  // ── Token Comparison per Message ───────────────────────

  @Get('messages/:messageId/sub-queries')
  @ApiOperation({ summary: 'Get detail sub query hasil RLM per message' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  getSubQueryResults(@Param('messageId', ParseIntPipe) messageId: number) {
    return this.rlmService.getSubQueryResults(messageId);
  }

  @Get('messages/:messageId/token-usage')
  @ApiOperation({ summary: 'Get semua token usage log per message (RLM & CONV)' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  getTokenUsage(@Param('messageId', ParseIntPipe) messageId: number) {
    return this.rlmService.getTokenUsageLogs(messageId);
  }

  @Get('messages/:messageId/token-comparison')
  @ApiOperation({ summary: 'Perbandingan token RLM vs Konvensional per message' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  @ApiResponse({ status: 404, description: 'Log tidak ditemukan atau bukan SOP_QUERY' })
  getTokenComparison(@Param('messageId', ParseIntPipe) messageId: number) {
    return this.rlmService.getTokenComparison(messageId);
  }

  // ── Token Comparison agregat per Session ──────────────

  @Get('sessions/:sessionId/token-comparison')
  @ApiOperation({
    summary: 'Perbandingan token RLM vs CONV agregat per session',
    description:
      'Mengembalikan semua baris perbandingan token (hanya SOP_QUERY) ' +
      'beserta isi chat (user_content & assistant_content) dan summary agregat. ' +
      'Kolom: Input Token RLM/CONV, Output Token RLM/CONV, ' +
      'Input Efficiency, Output Efficiency, Total Token RLM/CONV, Efficiency Ratio CONV/RLM.',
  })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  @ApiResponse({ status: 404, description: 'Session tidak ditemukan' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  getSessionTokenComparison(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Request() req: any,
  ) {
    return this.chatService.getSessionTokenComparison(sessionId, req.user);
  }

  
}