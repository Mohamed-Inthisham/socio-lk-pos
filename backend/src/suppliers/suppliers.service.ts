import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { SaleLine } from '../sales/entities/sale-line.entity';
import { Sale } from '../sales/entities/sale.entity';
import { SaleStatus } from '../sales/enums/sale-status.enum';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly suppliersRepository: Repository<Supplier>,
    @InjectRepository(SaleLine)
    private readonly saleLinesRepository: Repository<SaleLine>,
  ) {}

  /**
   * Create a new supplier.
   * Enforces case-insensitive uniqueness on name (also enforced at DB level
   * via a partial unique index on LOWER(name) WHERE deleted_at IS NULL).
   */
  async create(dto: CreateSupplierDto): Promise<Supplier> {
    // DTO layer has already trimmed strings and converted empties to null.
    await this.assertNameNotTaken(dto.name);

    const supplier = this.suppliersRepository.create({
      name: dto.name,
      contact_person: dto.contact_person ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      address: dto.address ?? null,
      notes: dto.notes ?? null,
      is_active: dto.is_active,
    });
    return this.suppliersRepository.save(supplier);
  }
  /**
   * List suppliers. By default returns only active suppliers.
   * Soft-deleted suppliers are always excluded (TypeORM handles this via
   * @DeleteDateColumn).
   */
  async findAll(includeInactive = false): Promise<Supplier[]> {
    return this.suppliersRepository.find({
      where: includeInactive ? {} : { is_active: true },
      order: { name: 'ASC' },
    });
  }

  /**
   * Find one supplier by id. Throws NotFoundException if missing.
   * Returns inactive suppliers too — the admin editor needs to load them.
   */
  async findOne(id: string): Promise<Supplier> {
    const supplier = await this.suppliersRepository.findOne({ where: { id } });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
  }

  /**
   * Partial update. Enforces case-insensitive name uniqueness if name changes.
   * Empty strings on nullable fields are normalized to null.
   */
  async update(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const supplier = await this.findOne(id);

    // REST PATCH semantics: undefined = don't touch, null = clear, string = set.
    // DTO layer has already trimmed strings and converted empties to null.
    if (dto.name !== undefined) {
      if (dto.name === null) {
        // name is required — the DTO's @IsString + @MinLength(1) rejects
        // null/empty before we get here, so this branch is defensive only.
        throw new ConflictException('Supplier name cannot be empty');
      }
      if (dto.name.toLowerCase() !== supplier.name.toLowerCase()) {
        await this.assertNameNotTaken(dto.name);
      }
      supplier.name = dto.name;
    }
    if (dto.contact_person !== undefined)
      supplier.contact_person = dto.contact_person;
    if (dto.phone !== undefined) supplier.phone = dto.phone;
    if (dto.email !== undefined) supplier.email = dto.email;
    if (dto.address !== undefined) supplier.address = dto.address;
    if (dto.notes !== undefined) supplier.notes = dto.notes;
    if (dto.is_active !== undefined) supplier.is_active = dto.is_active;

    return this.suppliersRepository.save(supplier);
  }

  /**
   * "Delete" a supplier — deactivates it. Same pattern as Brand: mutations
   * that would orphan history are avoided. Idempotent.
   */
  async deactivate(id: string): Promise<Supplier> {
    const supplier = await this.findOne(id);
    if (!supplier.is_active) return supplier;
    supplier.is_active = false;
    return this.suppliersRepository.save(supplier);
  }

  /**
   * Reactivate a deactivated supplier. Idempotent.
   */
  async reactivate(id: string): Promise<Supplier> {
    const supplier = await this.findOne(id);
    if (supplier.is_active) return supplier;
    supplier.is_active = true;
    return this.suppliersRepository.save(supplier);
  }

  /**
   * Count DISTINCT COMPLETED sales in which this supplier appears as an
   * external source on at least one line. Answers the user-facing question
   * "how many sales has this supplier been involved in?" — where a sale
   * with three lines from Ranjith counts once, not three times.
   *
   * Status filter: COMPLETED only. DRAFT sales are unfinalized carts, not
   * real commitments (a cashier might drop the supplier line before
   * completing). VOIDED sales were reversed and no longer owe the supplier
   * anything — including them would misleadingly block deactivation and
   * inflate settlement dashboards.
   *
   * Used by:
   *  - the admin supplier page ("cannot deactivate, has 12 sales" context)
   *  - the Phase 6.7 settlement flow ("how much do we owe this shop?")
   *
   * Returns { count } — object rather than bare number so future additions
   * (e.g. { count, total_amount, oldest_unsettled }) don't break clients.
   *
   * The 404-on-missing-supplier guard runs BEFORE the count query. Cheaper
   * than a JOIN when the supplier doesn't exist, and matches every other
   * endpoint's "resolve target first" pattern.
   */
  async getSalesCount(id: string): Promise<{ count: number }> {
    // 404 if the supplier doesn't exist — matches other endpoints
    await this.findOne(id);

    const result = await this.saleLinesRepository
      .createQueryBuilder('line')
      .innerJoin(Sale, 'sale', 'sale.id = line.sale_id')
      .where('line.external_supplier_id = :id', { id })
      .andWhere('sale.status = :status', { status: SaleStatus.COMPLETED })
      .select('COUNT(DISTINCT line.sale_id)', 'count')
      .getRawOne<{ count: string }>();

    // COUNT returns bigint from Postgres, which comes back as a string via
    // node-pg. Number() is safe here — a shop with 2^53 sales is not a
    // realistic scenario in this decade.
    return { count: Number(result?.count ?? 0) };
  }

  /**
   * Case-insensitive name conflict check. Application-level guard that
   * matches the DB partial unique index — catches conflicts before the
   * repository call and returns a clean 409 instead of a generic 500.
   */
  private async assertNameNotTaken(name: string): Promise<void> {
    const existing = await this.suppliersRepository
      .createQueryBuilder('supplier')
      .where('LOWER(supplier.name) = LOWER(:name)', { name })
      .getOne();
    if (existing) {
      throw new ConflictException(`Supplier "${name}" already exists`);
    }
  }
}
