import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Message } from './message.entity';

export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

@Entity('chat_sessions')
export class ChatSession {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 200, nullable: false })
  title!: string;

  @Column({
    type: 'varchar',
    default: SessionStatus.ACTIVE,
  })
  status!: SessionStatus;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;

  @ManyToOne(() => User, (user) => user.chat_sessions, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany(() => Message, (message) => message.session)
  messages!: Message[];
}