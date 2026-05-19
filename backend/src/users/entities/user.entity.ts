import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { UserRole } from '../enums/user-role.enum';

@Entity('users')
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

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deleted_at!: Date | null;
}
