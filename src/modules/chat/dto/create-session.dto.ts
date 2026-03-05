// FILE: src/modules/chat/dto/create-session.dto.ts

import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSessionDto {
  @ApiProperty({ example: 'Konsultasi SOP Pengajuan Cuti' })
  @IsString()
  @IsNotEmpty()
  title: string;
}