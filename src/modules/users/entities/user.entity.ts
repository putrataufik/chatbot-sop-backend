// FILE: src/modules/users/entities/user.entity.ts

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { ChatSession } from '../../chat/entities/chat-session.entity';
import { SopDocument } from '../../sop-documents/entities/sop-document.entity';

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100, nullable: false })
  name!: string;

  @Column({ type: 'varchar', length: 150, nullable: false, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  password_hash!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
    nullable: false,
  })
  role!: UserRole;

  @Column({ type: 'int', nullable: true, default: null })
  admin_level?: number;

  @Column({ type: 'datetime', nullable: true, default: null })
  last_login?: Date;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  /**
   * Relation: User can have multiple chat histories.
   * Cascade delete is handled at the Session level.
   */
  @OneToMany(() => ChatSession, (session) => session.user)
  chat_sessions!: ChatSession[];

  /**
   * Relation: Tracking which admin uploaded the SOP.
   */
  @OneToMany(() => SopDocument, (doc) => doc.uploaded_by_user)
  sop_documents!: SopDocument[];
}