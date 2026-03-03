// FILE: src/modules/rlm/entities/sub-query-result.entity.ts

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Message } from '../../chat/entities/message.entity';

@Entity('sub_query_results')
export class SubQueryResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: false })
  sub_question: string;

  @Column({ type: 'longtext', nullable: false })
  answer: string;

  @Column({ type: 'int', nullable: false, default: 0 })
  tokens_used: number;

  @Column({
    type: 'int',
    nullable: false,
    comment: 'level rekursi ke-n',
  })
  depth: number;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;

  // ── Relasi ──────────────────────────────────────────
  @ManyToOne(() => Message, (message) => message.sub_query_results, {
    nullable: false,
    onDelete: 'CASCADE', // hapus message → semua sub query ikut terhapus
  })
  @JoinColumn({ name: 'message_id' })
  message: Message;
}