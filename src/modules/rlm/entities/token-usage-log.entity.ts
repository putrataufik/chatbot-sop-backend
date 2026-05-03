import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Message } from '../../chat/entities/message.entity';

export enum TokenMethod {
  CONV = 'CONV',
  RLM  = 'RLM',
}

@Entity('token_usage_logs')
export class TokenUsageLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'enum', enum: TokenMethod, nullable: false })
  method!: TokenMethod;

  // ── Total tokens ──
  @Column({ type: 'int', nullable: false, default: 0 })
  input_tokens!: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  output_tokens!: number;

  // ── Root LM ──
  @Column({ type: 'int', nullable: false, default: 0, comment: 'Root LM input tokens (full price + cached)' })
  root_input_tokens!: number;

  @Column({ type: 'int', nullable: false, default: 0, comment: 'Root LM output tokens' })
  root_output_tokens!: number;

  @Column({ type: 'int', nullable: false, default: 0, comment: 'Root LM cached input tokens (subset of root_input_tokens)' })
  root_cached_input_tokens!: number;

  // ── Sub LM ──
  @Column({ type: 'int', nullable: false, default: 0, comment: 'Sub LM input tokens. 0 untuk CONV.' })
  sub_input_tokens!: number;

  @Column({ type: 'int', nullable: false, default: 0, comment: 'Sub LM output tokens. 0 untuk CONV.' })
  sub_output_tokens!: number;

  @Column({ type: 'int', nullable: false, default: 0, comment: 'Sub LM cached input tokens. 0 untuk CONV.' })
  sub_cached_input_tokens!: number;

  // ── Response time ──
  @Column({ type: 'int', nullable: false, default: 0, comment: 'Waktu respons dalam milidetik.' })
  response_time_ms!: number;

  @Column({ type: 'int', nullable: false, default: 0, comment: 'RLM iteration depth. 0 = baseline conventional.' })
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