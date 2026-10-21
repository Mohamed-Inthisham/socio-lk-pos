import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Not, Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import {
  PaginatedResponse,
  paginate,
} from '../common/dto/paginated-response.dto';

/**
 * CustomersService — CRUD + soft-delete lifecycle for Customer entities.
 *
 * Design notes:
 * - NIC uniqueness enforced BOTH at DB (partial unique index) and here
 *   at service layer. Service check produces a clean ConflictException
 *   with the existing customer_id in the payload (matches Q5b design
 *   decision for PhonePurchase's dedup flow — reusing the same shape
 *   here for consistency).
 * - Search is a simple case-insensitive substring match across
 *   name / phone / nic / email. Not full-text; not needed at current scale.
 * - Sort order: newest first (matches Phase 6.3 sale list convention).
 *
 * What this service does NOT do (deferred to later slices):
 * - Cross-entity concerns (PhonePurchase creation flow lands in Slice D).
 * - Merging duplicate customers (out of scope for R1).
 */
@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

  async create(dto: CreateCustomerDto): Promise<Customer> {
    // Pre-check NIC uniqueness at service layer so we can return a
    // structured ConflictException with the existing id. Without this,
    // the DB unique index would still catch it, but the error would
    // surface as a raw QueryFailedError with an opaque message.
    if (dto.nic) {
      const existing = await this.customerRepo.findOne({
        where: { nic: dto.nic },
        withDeleted: false,
      });
      if (existing) {
        throw new ConflictException({
          message: `A customer with NIC ${dto.nic} already exists`,
          existing_customer_id: existing.id,
        });
      }
    }

    const customer = this.customerRepo.create({
      name: dto.name,
      phone: dto.phone,
      nic: dto.nic ?? null,
      email: dto.email ?? null,
      notes: dto.notes ?? null,
    });

    return this.customerRepo.save(customer);
  }

  async findAll(query: CustomerQueryDto): Promise<PaginatedResponse<Customer>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const includeDeleted = query.include_deleted === 'true';

    const qb = this.customerRepo.createQueryBuilder('customer');

    if (includeDeleted) {
      qb.withDeleted();
    }

    if (query.search) {
      // ILIKE across the identifying fields. NIC compare is also
      // case-insensitive because we uppercase on ingest (see DTO
      // Transform) — the query still uses ILIKE for consistency and to
      // handle legacy lowercase rows if any ever sneak in. Email is
      // stored lowercase; ILIKE matches a mixed-case query too.
      const pattern = `%${query.search}%`;
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('customer.name ILIKE :pattern', { pattern })
            .orWhere('customer.phone ILIKE :pattern', { pattern })
            .orWhere('customer.nic ILIKE :pattern', { pattern })
            .orWhere('customer.email ILIKE :pattern', { pattern });
        }),
      );
    }

    qb.orderBy('customer.created_at', 'DESC')
      .addOrderBy('customer.id', 'DESC')
      .skip(skip)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return paginate(data, total, page, limit);
  }

  async findOne(id: string): Promise<Customer> {
    // Include soft-deleted here so admin restore flows can fetch first.
    // If callers want to reject deleted rows, they can check .deleted_at.
    const customer = await this.customerRepo.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.findOne(id);

    if (customer.deleted_at) {
      throw new ConflictException(
        `Customer ${id} is deleted; restore before updating`,
      );
    }

    // NIC uniqueness re-check on update (only when nic actually changes
    // to a non-null value different from current).
    if (dto.nic !== undefined && dto.nic !== null && dto.nic !== customer.nic) {
      const existing = await this.customerRepo.findOne({
        where: { nic: dto.nic, id: Not(id) },
        withDeleted: false,
      });
      if (existing) {
        throw new ConflictException({
          message: `A customer with NIC ${dto.nic} already exists`,
          existing_customer_id: existing.id,
        });
      }
    }

    // REST PATCH semantics: undefined = don't touch, null = clear, value = set.
    if (dto.name !== undefined) customer.name = dto.name;
    if (dto.phone !== undefined) customer.phone = dto.phone;
    if (dto.nic !== undefined) customer.nic = dto.nic;
    if (dto.email !== undefined) customer.email = dto.email;
    if (dto.notes !== undefined) customer.notes = dto.notes;

    return this.customerRepo.save(customer);
  }

  async remove(id: string): Promise<void> {
    const customer = await this.findOne(id);
    if (customer.deleted_at) {
      throw new ConflictException(`Customer ${id} is already deleted`);
    }
    await this.customerRepo.softRemove(customer);
  }

  async reactivate(id: string): Promise<Customer> {
    const customer = await this.findOne(id);
    if (!customer.deleted_at) {
      throw new ConflictException(`Customer ${id} is not deleted`);
    }

    // If reactivating would create an NIC clash with a still-active
    // customer, block it. This can happen if: customer A had NIC X,
    // was soft-deleted, then admin created customer B with NIC X
    // (allowed because partial unique index skips deleted rows — wait,
    // it doesn't skip them; the partial index is WHERE nic IS NOT NULL,
    // not WHERE deleted_at IS NULL). So actually this SHOULDN'T be
    // reachable in normal flow because the DB would have rejected
    // creating customer B. But we check anyway for defense in depth.
    if (customer.nic) {
      const clash = await this.customerRepo.findOne({
        where: { nic: customer.nic, id: Not(id), deleted_at: IsNull() },
        withDeleted: true,
      });
      if (clash) {
        throw new ConflictException({
          message: `Cannot reactivate: NIC ${customer.nic} is now in use by another customer`,
          existing_customer_id: clash.id,
        });
      }
    }

    await this.customerRepo.restore(id);
    return this.findOne(id);
  }
}
