import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  OneToOne, 
  JoinColumn 
} from 'typeorm';
import { Message } from '../../chat/entities/message.entity';

@Entity('token_usage_logs')
export class TokenUsageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', default: 0 })
  promptTokens: number;

  @Column({ type: 'int', default: 0 })
  completionTokens: number;

  @Column({ type: 'int', default: 0 })
  totalTokens: number;

  // FK: message_id -> messages.id (Relasi 1:1)
  @OneToOne(() => Message, (message) => message.tokenUsageLog, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: Message;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}