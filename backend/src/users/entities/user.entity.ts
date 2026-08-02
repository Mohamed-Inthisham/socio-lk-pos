import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  Check,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserRole } from '../enums/user-role.enum';
import { Branch } from '../../branches/entities/branch.entity';

@Entity('users')
@Check('CHK_users_role', `role IN ('admin', 'manager', 'cashier')`)
@Check('CHK_users_branch_role', `role = 'admin' OR branch_id IS NOT NULL`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  password_hash!: string;

  @Column({ type: 'varchar', length: 100, name: 'full_name' })
  full_name!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: UserRole.CASHIER,
  })
  role!: UserRole;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  is_active!: boolean;

  @Index('idx_users_branch_id')
  @Column({ type: 'uuid', name: 'branch_id', nullable: true })
  branch_id!: string | null;

  @ManyToOne(() => Branch, { nullable: true, eager: false })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deleted_at!: Date | null;
}
