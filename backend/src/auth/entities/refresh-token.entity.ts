import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  @Index('idx_refresh_tokens_user_id')
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Index('idx_refresh_tokens_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 255, name: 'token_hash' })
  token_hash!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expires_at!: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revoked_at!: Date | null;

  @Column({ type: 'varchar', length: 500, name: 'user_agent', nullable: true })
  user_agent!: string | null;

  @Column({ type: 'varchar', length: 45, name: 'ip_address', nullable: true })
  ip_address!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;
}
