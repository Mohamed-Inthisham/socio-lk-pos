import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sale } from './entities/sale.entity';
import { SaleStatus } from './enums/sale-status.enum';
import { SaleType } from './enums/sale-type.enum';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';
import {
  PaginatedResponse,
  paginate,
} from '../common/dto/paginated-response.dto';

@Injectable()
export class SalesService {
  constructor(
    @InjectRepository(Sale)
    private readonly salesRepository: Repository<Sale>,
    @InjectRepository(Branch)
    private readonly branchesRepository: Repository<Branch>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /**
   * Create a new DRAFT sale. Called by an authenticated user via the
   * controller — the cashier_id comes from the JWT (never from the client
   * body), so a cashier cannot create a sale attributed to someone else.
   *
   * Cross-entity validation:
   *   - Branch must exist and be active
   *   - Cashier must exist and be active
   *   - Cashier's assigned branch (if any) must match branch_id — a
   *     cashier assigned to Branch A cannot open sales at Branch B.
   *     Admins have no branch assignment and can create at any branch.
   *
   * Sale starts as DRAFT with zeroed totals. Lines and payments are added
   * via sub-resource endpoints (POST /sales/:id/lines, etc — Slices D/E).
   */
  async create(dto: CreateSaleDto, cashierId: string): Promise<Sale> {
    // Validate cashier exists and is active
    const cashier = await this.usersRepository.findOne({
      where: { id: cashierId },
    });
    if (!cashier) {
      throw new NotFoundException('Cashier not found');
    }
    if (!cashier.is_active) {
      throw new ForbiddenException('Cashier account is inactive');
    }

    // Validate branch exists and is active
    const branch = await this.branchesRepository.findOne({
      where: { id: dto.branch_id },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    if (!branch.is_active) {
      throw new BadRequestException(
        'Cannot create a sale at an inactive branch',
      );
    }

    // Cashier must be creating the sale at their own branch (unless admin).
    // Non-admin users always have branch_id set (enforced by CHK_users_branch_role
    // from Phase 6.2 Path A). Admins have branch_id = null and can transact anywhere.
    if (cashier.branch_id && cashier.branch_id !== dto.branch_id) {
      throw new ForbiddenException(
        'You can only create sales at your own branch',
      );
    }

    const sale = this.salesRepository.create({
      sale_type: SaleType.RETAIL,
      status: SaleStatus.DRAFT,
      branch_id: dto.branch_id,
      cashier_id: cashierId,
      customer_id: dto.customer_id ?? null,
      notes: dto.notes ?? null,
      // All money fields default to '0' at the DB level
    });

    return this.salesRepository.save(sale);
  }

  /**
   * List sales with pagination and optional filters.
   *
   * Sort order: created_at DESC (newest first). Cashiers looking at
   * "today's sales" want the most recent at top; dashboards want the
   * same. No opt-out yet — if we need ASC sorting later, add a ?sort
   * param then.
   *
   * Nested branch + cashier included via joins so the frontend can
   * render "Sale #INV-... by cashier X at branch Y" without extra
   * round trips. Follows the nested-response pattern from Phase 6.1.
   */
  async findAll(query: ListSalesQueryDto): Promise<PaginatedResponse<Sale>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.salesRepository
      .createQueryBuilder('sale')
      .leftJoinAndSelect('sale.branch', 'branch')
      .leftJoinAndSelect('sale.cashier', 'cashier');

    if (query.branchId) {
      qb.andWhere('sale.branch_id = :branchId', { branchId: query.branchId });
    }
    if (query.cashierId) {
      qb.andWhere('sale.cashier_id = :cashierId', {
        cashierId: query.cashierId,
      });
    }
    if (query.status) {
      qb.andWhere('sale.status = :status', { status: query.status });
    }
    if (query.from) {
      qb.andWhere('sale.created_at >= :from', { from: query.from });
    }
    if (query.to) {
      // If the client sends a date-only string like '2026-08-31', they
      // typically mean "up to end of that day inclusive". Convert to
      // exclusive upper bound at the start of the next day.
      const to = this.normalizeToUpperBound(query.to);
      qb.andWhere('sale.created_at < :to', { to });
    }

    qb.orderBy('sale.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return paginate(rows, total, page, limit);
  }

  /**
   * Fetch one sale with nested branch + cashier. Lines and payments are
   * NOT loaded here in C2 — they don't exist yet as entities. Once
   * Slices D and E land, this method will grow to eager-load them so
   * the frontend can render the full sale in one call.
   *
   * Throws 404 if the sale doesn't exist.
   */
  async findOne(id: string): Promise<Sale> {
    const sale = await this.salesRepository.findOne({
      where: { id },
      relations: ['branch', 'cashier'],
    });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    return sale;
  }

  /**
   * Partial update on a DRAFT sale. Only notes and customer_id can be
   * changed via this endpoint. Attempting to update a COMPLETED or
   * VOIDED sale returns 400 (completed sales are immutable historical
   * records — if the cashier made a mistake, they void and re-create).
   */
  async update(id: string, dto: UpdateSaleDto): Promise<Sale> {
    const sale = await this.findOne(id);

    if (sale.status !== SaleStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot update a ${sale.status} sale. Only DRAFT sales are mutable.`,
      );
    }

    // DTO layer trims strings and converts empty strings to null.
    // undefined = don't touch, null = clear, string = set.
    if (dto.customer_id !== undefined) sale.customer_id = dto.customer_id;
    if (dto.notes !== undefined) sale.notes = dto.notes;

    return this.salesRepository.save(sale);
  }

  /**
   * Discard a DRAFT sale. Hard delete — a DRAFT never became a real
   * financial record, so no history is lost. Attempting to delete
   * a COMPLETED or VOIDED sale returns 400.
   *
   * If the sale doesn't exist, throws 404 (via findOne).
   */
  async discardDraft(id: string): Promise<void> {
    const sale = await this.findOne(id);

    if (sale.status !== SaleStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot delete a ${sale.status} sale. Only DRAFT sales can be discarded.`,
      );
    }

    await this.salesRepository.remove(sale);
  }

  /**
   * Convert an ISO date/timestamp to an exclusive upper bound for
   * a created_at range filter.
   *
   * If the input is date-only ('2026-08-31'), returns the start of the
   * next day ('2026-09-01T00:00:00Z') so the day is fully included.
   *
   * If the input already has a time component, returns it as-is.
   *
   * Kept private and simple; no timezone shifting (Postgres timestamps
   * are stored in UTC). If a client wants Colombo-local end-of-day
   * boundaries, they can pass an ISO string with explicit offset.
   */
  private normalizeToUpperBound(input: string): string {
    // Detect date-only ISO format YYYY-MM-DD (exactly 10 chars, no T)
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const date = new Date(input + 'T00:00:00Z');
      date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString();
    }
    return input;
  }
}
