import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ example: 'Bagaimana prosedur pengajuan cuti tahunan?', description: 'Pertanyaan pengguna terkait SOP' })
  @IsNotEmpty()
  @IsString()
  content: string;
}