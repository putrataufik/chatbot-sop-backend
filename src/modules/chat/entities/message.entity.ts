// FILE: src/modules/chat/entities/message.entity.ts

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { ChatSession } from './chat-session.entity';
import { TokenUsageLog } from '../../rlm/entities/token-usage-log.entity';
import { SubQueryResult } from '../../rlm/entities/sub-query-result.entity';

export enum MessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
}

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'enum', enum: MessageRole, nullable: false })
  role!: MessageRole;

  @Column({ type: 'longtext', nullable: false })
  content!: string;

  // Storing tokens directly in message for quick cost analysis
  @Column({ type: 'int', nullable: false, default: 0 })
  input_tokens!: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  output_tokens!: number;

  @CreateDateColumn({ type: 'datetime' })
  timestamp!: Date;

  @ManyToOne(() => ChatSession, (session) => session.messages, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'session_id' })
  session!: ChatSession;

  @OneToOne(() => TokenUsageLog, (log) => log.message, {
    cascade: true,
  })
  token_usage_log!: TokenUsageLog;

  @OneToMany(() => SubQueryResult, (subQuery) => subQuery.message, {
    cascade: true,
  })
  sub_query_results!: SubQueryResult[];
}