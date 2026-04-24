// FILE: src/modules/rlm/entities/token-usage-log.entity.ts

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Message } from '../../chat/entities/message.entity';

export enum TokenMethod {
  CONV = 'CONV', // Conventional (tanpa RLM) → sebagai baseline
  RLM = 'RLM',  // Recursive Language Model
}

@Entity('token_usage_logs')
export class TokenUsageLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'enum', enum: TokenMethod, nullable: false })
  method!: TokenMethod;

  @Column({ type: 'int', nullable: false, default: 0 })
  input_tokens!: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  output_tokens!: number;

  @Column({
    type: 'int',
    nullable: false,
    default: 0,
    comment: 'RLM iteration depth. Value 0 indicates baseline conventional model.',
  })
  rlm_depth!: number;

  @Column({ type: 'longtext', nullable: true, default: null })
  conv_answer!: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  error_message!: string | null;

  @ManyToOne(() => Message, (message) => message.token_usage_logs, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'message_id' })
  message!: Message;
}