// FILE: src/modules/sop-documents/dto/create-sop.dto.ts

import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SopFormat } from '../entities/sop-document.entity';

export class CreateSopDto {
  @ApiProperty({ example: 'SOP Pengajuan Cuti' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ enum: SopFormat, example: SopFormat.PDF })
  @IsEnum(SopFormat)
  @IsNotEmpty()
  format: SopFormat;
}