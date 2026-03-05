// FILE: src/modules/chat/dto/send-message.dto.ts

import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ example: 'Bagaimana prosedur pengajuan cuti tahunan?' })
  @IsString()
  @IsNotEmpty()
  content: string;
}