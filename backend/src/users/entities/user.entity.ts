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
import { Exclude } from 'class-transformer';
import { UserRole } from '../enums/user-role.enum';
import { Branch } from '../../branches/entities/branch.entity';

@Entity('users')
@Check('CHK_users_role', `role IN ('admin', 'manager', 'cashier')`)
@Check('CHK_users_branch_role', `role = 'admin' OR branch_id IS NOT NULL`)
// Approval PIN (Phase 6.4 P6-15): only admins and managers hold one, its
// set time is present exactly when the hash is, and the count is never
// negative. A route that makes a user a cashier must clear the PIN in the
// same UPDATE (UsersService.changeRole does).
@Check(
  'CHK_users_approval_pin_role',
  `approval_pin_hash IS NULL OR role IN ('admin', 'manager')`,
)
@Check(
  'CHK_users_approval_pin_set_at',
  `(approval_pin_hash IS NULL) = (approval_pin_set_at IS NULL)`,
)
@Check('CHK_users_approval_pin_attempts', `approval_pin_failed_attempts >= 0`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  // Never loaded by default (select: false) and never serialized (@Exclude,
  // via the global ClassSerializerInterceptor). Code that needs the hash
  // must opt in with addSelect — see UsersService.findByEmail.
  @Exclude()
  @Column({
    type: 'varchar',
    length: 255,
    name: 'password_hash',
    select: false,
  })
  password_hash!: string;

  @Column({ type: 'varchar', length: 100, name: 'full_name' })
  full_name!: string;

  // Contact details (Task 2.5). Required when a user is created
  // (CreateUserDto) but nullable here: users created before them have
  // none. Once set they can be changed, never cleared.
  // Phone: normalized by normalizeSlPhone (0XXXXXXXXX).
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  // NIC: normalized by normalizeSlNic (trimmed, uppercase). Unique among
  // users that aren't deleted, by the partial index idx_users_nic_unique
  // (see AddUserContactDetails); not declared here, since @Index can't
  // carry its WHERE clause.
  @Column({ type: 'varchar', length: 20, nullable: true })
  nic!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  // Manager approval PIN (Phase 6.4 P6-15), bcrypt like password_hash and
  // guarded the same way: never loaded by default (select: false), never
  // serialized (@Exclude). ApprovalsService opts in with addSelect.
  @Exclude()
  @Column({
    type: 'varchar',
    length: 255,
    name: 'approval_pin_hash',
    nullable: true,
    select: false,
  })
  approval_pin_hash!: string | null;

  // When the PIN was set ("Set on <date>"); null when there is none.
  @Column({ type: 'timestamptz', name: 'approval_pin_set_at', nullable: true })
  approval_pin_set_at!: Date | null;

  // Wrong PINs in a row and the lock they lead to (P6-19). Kept out of
  // every response: the PIN check reports them in its own error bodies.
  @Exclude()
  @Column({
    type: 'smallint',
    name: 'approval_pin_failed_attempts',
    default: 0,
  })
  approval_pin_failed_attempts!: number;

  @Exclude()
  @Column({
    type: 'timestamptz',
    name: 'approval_pin_locked_until',
    nullable: true,
  })
  approval_pin_locked_until!: Date | null;

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
