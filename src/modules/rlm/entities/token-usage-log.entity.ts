// FILE: src/modules/rlm/entities/token-usage-log.entity.ts

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
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

  @OneToOne(() => Message, (message) => message.token_usage_log, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'message_id' })
  message!: Message;
}