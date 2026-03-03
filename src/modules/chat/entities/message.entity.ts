import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn, 
  OneToMany, 
  OneToOne 
} from 'typeorm';
import { ChatSession } from './chat-session.entity';
import { SubQueryResult } from 'src/modules/rlm/entities/sub-query-result.entity';
import { TokenUsageLog } from 'src/modules/rlm/entities/token-usage-log.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ['user', 'assistant', 'system'] })
  role: string;

  @Column({ type: 'longtext' })
  content: string;

  // FK: session_id -> chat_sessions.id
  @ManyToOne(() => ChatSession, (session) => session.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: ChatSession;

  // Relasi 1 : N ke sub_query_results
  @OneToMany(() => SubQueryResult, (subQueryResult) => subQueryResult.message)
  subQueryResults: SubQueryResult[];

  // Relasi 1 : 1 ke token_usage_logs
  @OneToOne(() => TokenUsageLog, (tokenLog) => tokenLog.message)
  tokenUsageLog: TokenUsageLog;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}