import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateChatSessionDto {
  @ApiProperty({ example: 'SOP Pengajuan Cuti', description: 'Judul sesi percakapan' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title: string;
}