// FILE: src/modules/chat/dto/create-session.dto.ts

import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSessionDto {
  @ApiPropertyOptional({ example: 'Konsultasi SOP Pengajuan Cuti' })
  @IsOptional()
  @IsString()
  title?: string;
}