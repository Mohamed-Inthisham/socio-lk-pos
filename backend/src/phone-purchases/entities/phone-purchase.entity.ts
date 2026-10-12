import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { User } from '../../users/entities/user.entity';
import { ProductUnit } from '../../product-units/entities/product-unit.entity';

@Entity('phone_purchases')
@Check(`"total_amount" >= 0`)
export class PhonePurchase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  customer_id!: string;

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer;

  @Column({ type: 'uuid' })
  branch_id!: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'uuid' })
  cashier_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cashier_id' })
  cashier?: User;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  total_amount!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @OneToMany(() => ProductUnit, (unit) => unit.phone_purchase)
  product_units?: ProductUnit[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
