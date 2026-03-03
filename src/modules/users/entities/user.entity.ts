import { ChatSession } from 'src/modules/chat/entities/chat-session.entity';
import { SopDocument } from 'src/modules/sop-documents/entities/sop-document.entity';
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  OneToMany 
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  // Relasi 1 : N ke sop_documents
  @OneToMany(() => SopDocument, (sopDocument) => sopDocument.uploadedBy)
  sopDocuments: SopDocument[];

  // Relasi 1 : N ke chat_sessions
  @OneToMany(() => ChatSession, (chatSession) => chatSession.user)
  chatSessions: ChatSession[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}