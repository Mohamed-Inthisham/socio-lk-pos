import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Check,
} from 'typeorm';

@Entity('suppliers')
@Check('CHK_suppliers_phone_format', `phone IS NULL OR phone ~ '^0\\d{9}$'`)
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'contact_person',
    nullable: true,
  })
  contact_person!: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deleted_at!: Date | null;
}
