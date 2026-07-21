import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AuditAction } from '../enums/audit-action.enum';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  user_id!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @Column({ type: 'varchar' })
  user_name!: string;

  @Column({ type: 'varchar' })
  user_role!: string;

  @Column({ type: 'varchar' })
  action!: AuditAction;

  @Column({ type: 'varchar' })
  entity_type!: string;

  @Column({ type: 'varchar' })
  entity_id!: string;

  @Column({ type: 'jsonb', nullable: true })
  changes!: Record<string, { old: unknown; new: unknown }> | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', nullable: true })
  ip_address!: string | null;

  @Index()
  @CreateDateColumn()
  created_at!: Date;
}
