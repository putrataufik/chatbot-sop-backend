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

  // ── Total tokens (gabungan semua model) ───────────────
  @Column({ type: 'int', nullable: false, default: 0 })
  input_tokens!: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  output_tokens!: number;

  // ── Root LM tokens (gpt-5.1) ─────────────────────────
  // Untuk RLM: token dari loop utama + fallback (queryRootLM)
  // Untuk CONV: sama dengan input_tokens / output_tokens (hanya pakai satu model)
  @Column({
    type: 'int',
    nullable: false,
    default: 0,
    comment: 'Token input dari Root LM (gpt-5.1) — loop utama RLM atau seluruh CONV',
  })
  root_input_tokens!: number;

  @Column({
    type: 'int',
    nullable: false,
    default: 0,
    comment: 'Token output dari Root LM (gpt-5.1) — loop utama RLM atau seluruh CONV',
  })
  root_output_tokens!: number;

  // ── Sub LM tokens (gpt-5-mini) ────────────────────────
  // Untuk RLM: token dari setiap llm_query() di dalam sandbox
  // Untuk CONV: selalu 0 (tidak menggunakan Sub LM)
  @Column({
    type: 'int',
    nullable: false,
    default: 0,
    comment: 'Token input dari Sub LM (gpt-5-mini) — setiap llm_query() di sandbox RLM. 0 untuk CONV.',
  })
  sub_input_tokens!: number;

  @Column({
    type: 'int',
    nullable: false,
    default: 0,
    comment: 'Token output dari Sub LM (gpt-5-mini) — setiap llm_query() di sandbox RLM. 0 untuk CONV.',
  })
  sub_output_tokens!: number;

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