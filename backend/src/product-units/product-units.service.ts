import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ProductUnitStatus } from './enums/product-unit-status.enum';
import { ProductUnit } from './entities/product-unit.entity';
import { ListProductUnitsQueryDto } from './dto/list-product-units-query.dto';
import {
  paginate,
  PaginatedResponse,
} from '../common/dto/paginated-response.dto';

/**
 * Relations eagerly hydrated on findOne / findAll. Includes the parent
 * Product, Branch, and PhonePurchase (with its customer, so admins can
 * see who we bought the phone from without a second lookup).
 */
const PRODUCT_UNIT_RELATIONS = [
  'product',
  'branch',
  'phone_purchase',
  'phone_purchase.customer',
] as const;

@Injectable()
export class ProductUnitsService {
  constructor(
    @InjectRepository(ProductUnit)
    private readonly productUnitsRepository: Repository<ProductUnit>,
  ) {}

  /**
   * Paginated list of ProductUnits with optional filters.
   * Admin/Manager only per Q6 decision — cashiers interact with
   * ProductUnits implicitly via IMEI at ring-up (Slice E), not
   * through browse.
   *
   * Sorted by created_at DESC (newest first).
   */
  async findAll(
    query: ListProductUnitsQueryDto,
  ): Promise<PaginatedResponse<ProductUnit>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.productUnitsRepository
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.product', 'product')
      .leftJoinAndSelect('unit.branch', 'branch')
      .leftJoinAndSelect('unit.phone_purchase', 'phone_purchase')
      .leftJoinAndSelect('phone_purchase.customer', 'customer');

    if (query.productId) {
      qb.andWhere('unit.product_id = :productId', {
        productId: query.productId,
      });
    }
    if (query.branchId) {
      qb.andWhere('unit.branch_id = :branchId', {
        branchId: query.branchId,
      });
    }
    if (query.status) {
      qb.andWhere('unit.status = :status', { status: query.status });
    }
    if (query.imei) {
      qb.andWhere('unit.imei = :imei', { imei: query.imei });
    }

    qb.orderBy('unit.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, page, limit);
  }

  /**
   * Get one ProductUnit by ID with all relations hydrated.
   * NotFound if the ID doesn't exist.
   */
  async findOne(id: string): Promise<ProductUnit> {
    const unit = await this.productUnitsRepository.findOne({
      where: { id },
      relations: [...PRODUCT_UNIT_RELATIONS],
    });
    if (!unit) {
      throw new NotFoundException('Product unit not found');
    }
    return unit;
  }

  /**
   * Flip a ProductUnit from IN_STOCK to SOLD as part of a larger
   * transaction (typically SalesService.completeSale). Enlists in the
   * caller's EntityManager so that if the outer transaction rolls back
   * — for any reason, including a later line failing or the sale
   * COMPLETE UPDATE itself failing — this status flip rolls back with
   * it. Never opens its own transaction.
   *
   * Behavior:
   *   - If no ProductUnit row exists for `unitId`: raw Error → 500. The
   *     caller (completeSale) got this ID from a SaleLine.product_unit_id
   *     that was validated at addLine time. Its absence at complete time
   *     means the row was deleted out from under us, which the RESTRICT
   *     FK explicitly prevents. Fail loudly — this is data integrity,
   *     not business.
   *
   *   - If status is not IN_STOCK: throw 409 ConflictException with a
   *     structured payload (existing_unit: {id, status, product_id,
   *     branch_id}) mirroring Slice D's IMEI-collision shape. This is
   *     the cross-DRAFT race outcome — two DRAFT sales both referenced
   *     this PU (allowed at addLine per Q5), the first to complete
   *     wins, the second gets this error. Message includes the current
   *     status so the frontend can render actionable feedback.
   *
   *   - Otherwise: UPDATE product_units SET status = SOLD, updated_at = now().
   *
   * Concurrency:
   *   We SELECT ... FOR UPDATE the PU row first. Serializes concurrent
   *   flips of the same PU (which would only happen under the very
   *   narrow cross-DRAFT-race window). The loser waits, re-reads under
   *   lock, sees status = SOLD, and gets the 409.
   *
   * Must be called inside a transaction; will throw if `manager` is
   * outside one (TypeORM's setLock enforces this).
   */
  async markSoldForSale(manager: EntityManager, unitId: string): Promise<void> {
    const unit = await manager
      .createQueryBuilder(ProductUnit, 'unit')
      .setLock('pessimistic_write')
      .where('unit.id = :unitId', { unitId })
      .getOne();

    if (!unit) {
      // Data integrity failure — a SaleLine's product_unit_id FK to a
      // row that no longer exists means the RESTRICT FK was bypassed.
      throw new Error(
        `ProductUnit ${unitId} not found at complete time. ` +
          `This indicates a data integrity issue — the RESTRICT FK on ` +
          `sale_lines.product_unit_id should prevent this.`,
      );
    }

    if (unit.status !== ProductUnitStatus.IN_STOCK) {
      throw new ConflictException({
        message:
          `Cannot sell IMEI '${unit.imei}': status is ${unit.status}, ` +
          `expected IN_STOCK. Another sale may have completed with this ` +
          `unit while yours was being drafted.`,
        existing_unit: {
          id: unit.id,
          status: unit.status,
          product_id: unit.product_id,
          branch_id: unit.branch_id,
        },
      });
    }

    await manager
      .createQueryBuilder()
      .update(ProductUnit)
      .set({ status: ProductUnitStatus.SOLD })
      .where('id = :id', { id: unit.id })
      .execute();
  }

  /**
   * Reverse markSoldForSale: flip a ProductUnit from SOLD back to
   * IN_STOCK as part of a larger transaction (typically
   * SalesService.voidSale). Symmetric to StockService.incrementForReversal.
   *
   * Behavior:
   *   - If no ProductUnit row exists for `unitId`: raw Error → 500,
   *     same reasoning as markSoldForSale (FK RESTRICT prevents deletion).
   *
   *   - If status is not SOLD: raw Error → 500. A COMPLETED sale being
   *     voided MUST have every serialized in-house line's PU in SOLD
   *     status, because completeSale flipped them all at complete time.
   *     Any other status here means someone bypassed the flow (admin
   *     hand-edit? separate return endpoint we haven't built yet?). We
   *     don't have a business path that legitimately produces this, so
   *     fail loudly — the operator needs to see this in the logs.
   *
   *   - Otherwise: UPDATE product_units SET status = IN_STOCK, updated_at = now().
   *
   * Note: does NOT transition to RETURNED. RETURNED is a separate flow
   * (customer physically returns the phone, not a full sale void).
   * That endpoint is a tracked followup.
   *
   * Concurrency: same setLock pattern as markSoldForSale.
   *
   * Must be called inside a transaction.
   */
  async markAvailableForReversal(
    manager: EntityManager,
    unitId: string,
  ): Promise<void> {
    const unit = await manager
      .createQueryBuilder(ProductUnit, 'unit')
      .setLock('pessimistic_write')
      .where('unit.id = :unitId', { unitId })
      .getOne();

    if (!unit) {
      throw new Error(
        `ProductUnit ${unitId} not found at void time. ` +
          `This indicates a data integrity issue — stock and PU rows ` +
          `for voided sale lines must exist at void time.`,
      );
    }

    if (unit.status !== ProductUnitStatus.SOLD) {
      // A COMPLETED sale's PU MUST be SOLD at void time. Any other
      // status means the state machine was bypassed.
      throw new Error(
        `ProductUnit ${unitId} has status ${unit.status} at void time, ` +
          `expected SOLD. The PU state machine was bypassed by an ` +
          `unknown code path.`,
      );
    }

    await manager
      .createQueryBuilder()
      .update(ProductUnit)
      .set({ status: ProductUnitStatus.IN_STOCK })
      .where('id = :id', { id: unit.id })
      .execute();
  }
}
