import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'uuid', name: 'parent_id', nullable: true })
  parent_id!: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parent_id' })
  parent!: Category | null;

  @Column({ type: 'integer', default: 0, name: 'sort_order' })
  sort_order!: number;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at!: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deleted_at!: Date | null;
}
