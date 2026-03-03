import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn 
} from 'typeorm';
import { Message } from '../../chat/entities/message.entity';

@Entity('sub_query_results')
export class SubQueryResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', default: 1 })
  stepOrder: number;

  @Column({ type: 'text' })
  generatedQuery: string;

  @Column({ type: 'text' })
  retrievedContext: string;

  // FK: message_id -> messages.id
  @ManyToOne(() => Message, (message) => message.subQueryResults, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: Message;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}