// FILE: src/modules/sop-documents/entities/sop-document.entity.ts

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum SopFormat {
  PDF = 'PDF',
  TXT = 'TXT',
}

@Entity('sop_documents')
export class SopDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200, nullable: false, unique: true })
  title: string;

  @Column({ type: 'longtext', nullable: false })
  content: string;

  @Column({
    type: 'enum',
    enum: SopFormat,
    nullable: false,
  })
  format: SopFormat;

  @Column({ type: 'bigint', nullable: false, comment: 'in bytes' })
  file_size: number;

  @CreateDateColumn({ type: 'datetime' })
  uploaded_at: Date;

  // ── Relasi ──────────────────────────────────────────
  @ManyToOne(() => User, (user) => user.sop_documents, {
    nullable: false,
    onDelete: 'RESTRICT', // tidak bisa hapus user jika masih punya SOP
  })
  @JoinColumn({ name: 'uploaded_by' })
  uploaded_by_user: User;
}