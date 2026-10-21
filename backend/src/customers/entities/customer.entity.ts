import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * A Customer is an individual we buy phones from, sell phones to, or both.
 *
 * Introduced in Phase 6.3.5 (used phones) because:
 * - PhonePurchase needs a customer FK (who did we buy this from?).
 * - Sale.customer_id was pre-added in Phase 6.3 as a bare nullable UUID
 *   pending this entity; Slice B wires the FK.
 *
 * Identity rules:
 * - name + phone are required at intake (walk-in flow demands minimum
 *   identification for legal reasons — see business context in the phase
 *   docs).
 * - NIC is nullable but unique when set. Partial unique index in DB
 *   (idx_customers_nic_unique) enforces this. Nullable because walk-ins
 *   don't always have their NIC handy at intake.
 * - Email is optional and NOT unique (family members may share one).
 * - No address column: this codebase identifies customers by NIC + phone.
 *   Delivery address is a future Order/Delivery concern, not a Customer
 *   attribute.
 *
 * Soft delete via deleted_at (matches Product/Brand/Category pattern).
 * TypeORM's @DeleteDateColumn makes .softRemove() and .softDelete() work
 * out of the box, and default finds filter deleted rows.
 */
@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_customers_name')
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Index('idx_customers_phone')
  @Column({ type: 'varchar', length: 20 })
  phone!: string;

  // Nullable. Unique-when-non-null enforced by partial index
  // idx_customers_nic_unique (see migration). Not declared as unique
  // here because @Index({ unique: true }) generates a full unique
  // index without the WHERE clause, which would still work on Postgres
  // (NULLs distinct) but wouldn't match the DB reality.
  @Column({ type: 'varchar', length: 20, nullable: true })
  nic!: string | null;

  // Optional, stored trimmed and lowercase (see the DTOs). Not unique:
  // family members may share one address.
  @Column({ type: 'varchar', length: 254, nullable: true })
  email!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deleted_at!: Date | null;
}
