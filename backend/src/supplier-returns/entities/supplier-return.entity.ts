import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from '../../users/entities/user.entity';
import { StockPurchase } from '../../stock-purchases/entities/stock-purchase.entity';
import { SupplierReturnReason } from '../enums/supplier-return-reason.enum';
import { SupplierReturnLine } from './supplier-return-line.entity';

@Entity('supplier_returns')
@Unique('UQ_supplier_returns_number', ['return_number'])
@Unique('UQ_supplier_returns_client_request_id', ['client_request_id'])
@Check(
  'CHK_supplier_returns_reason',
  `"reason_code" IN ('DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'EXCESS_STOCK', 'WARRANTY', 'OTHER')`,
)
@Check(
  'CHK_supplier_returns_other_note',
  `"reason_code" <> 'OTHER' OR length(trim(coalesce("note", ''))) > 0`,
)
@Check('CHK_supplier_returns_request_hash', `"request_hash" ~ '^[a-f0-9]{64}$'`)
@Index('idx_supplier_returns_purchase_created_at', [
  'stock_purchase_id',
  'created_at',
])
export class SupplierReturn {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_supplier_returns_id',
  })
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  return_number!: string;

  @Column({ type: 'uuid', name: 'stock_purchase_id' })
  stock_purchase_id!: string;

  @ManyToOne(() => StockPurchase, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'stock_purchase_id',
    foreignKeyConstraintName: 'FK_supplier_returns_purchase',
  })
  purchase!: StockPurchase;

  @Column({ type: 'varchar', length: 20, name: 'reason_code' })
  reason_code!: SupplierReturnReason;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', name: 'created_by_id' })
  created_by_id!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_supplier_returns_creator',
  })
  created_by!: User;

  @Column({ type: 'uuid', name: 'client_request_id' })
  client_request_id!: string;

  @Column({ type: 'varchar', length: 64, name: 'request_hash' })
  @Exclude()
  request_hash!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @OneToMany(() => SupplierReturnLine, (line) => line.supplier_return)
  lines!: SupplierReturnLine[];
}
