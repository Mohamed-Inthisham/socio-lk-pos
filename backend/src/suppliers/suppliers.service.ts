import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly suppliersRepository: Repository<Supplier>,
  ) {}

  /**
   * Create a new supplier.
   * Enforces case-insensitive uniqueness on name (also enforced at DB level
   * via a partial unique index on LOWER(name) WHERE deleted_at IS NULL).
   */
  async create(dto: CreateSupplierDto): Promise<Supplier> {
    const name = dto.name.trim();
    await this.assertNameNotTaken(name);

    const supplier = this.suppliersRepository.create({
      name,
      contact_person: dto.contact_person?.trim() || null,
      phone: dto.phone?.trim() || null,
      email: dto.email?.trim() || null,
      address: dto.address?.trim() || null,
      notes: dto.notes?.trim() || null,
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

    if (dto.name !== undefined) {
      const newName = dto.name.trim();
      if (newName.toLowerCase() !== supplier.name.toLowerCase()) {
        await this.assertNameNotTaken(newName);
      }
      supplier.name = newName;
    }
    if (dto.contact_person !== undefined) {
      supplier.contact_person = dto.contact_person?.trim() || null;
    }
    if (dto.phone !== undefined) {
      supplier.phone = dto.phone?.trim() || null;
    }
    if (dto.email !== undefined) {
      supplier.email = dto.email?.trim() || null;
    }
    if (dto.address !== undefined) {
      supplier.address = dto.address?.trim() || null;
    }
    if (dto.notes !== undefined) {
      supplier.notes = dto.notes?.trim() || null;
    }
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
   * Count SaleLines that reference this supplier as an external source.
   *
   * STUB in Slice A2 — returns 0 unconditionally because the SaleLine entity
   * doesn't exist yet. Replaced with a real query in Slice H1 after Sales
   * lands (Slice C onward).
   *
   * The method exists now so the controller in Slice A3 can wire the endpoint
   * and the frontend contract is stable from day one.
   */
  async getSalesCount(id: string): Promise<{ count: number }> {
    // Verify the supplier exists — 404 if not, matching other endpoints
    await this.findOne(id);
    return { count: 0 };
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
