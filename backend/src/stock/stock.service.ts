import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Stock } from './entities/stock.entity';
import { CreateStockDto } from './dto/create-stock.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { ProductsService } from '../products/products.service';
import { BranchesService } from '../branches/branches.service';

/**
 * Response shape helper — adds the computed low_stock_alert flag to
 * every returned Stock row. Never touches the DB.
 */
export type StockWithAlert = Stock & { low_stock_alert: boolean };

const STOCK_RELATIONS = ['product', 'branch'] as const;

@Injectable()
export class StockService {
  constructor(
    @InjectRepository(Stock)
    private readonly stockRepository: Repository<Stock>,
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
    private readonly branchesService: BranchesService,
  ) {}

  /**
   * Create a stock row. Enforces:
   *  - product and branch exist and are active
   *  - product+branch pair is unique (also DB-enforced)
   *
   * Used both by admin (rare) and by ProductsService when auto-creating
   * a stock row for a new product.
   */
  async create(dto: CreateStockDto): Promise<StockWithAlert> {
    // Validate references — clean errors instead of raw FK failures
    const product = await this.productsService
      .findOne(dto.product_id)
      .catch(() => null);
    if (!product) {
      throw new BadRequestException(`Product ${dto.product_id} not found`);
    }
    if (!product.is_active) {
      throw new BadRequestException(`Product "${product.name}" is not active`);
    }

    const branch = await this.branchesService
      .findOne(dto.branch_id)
      .catch(() => null);
    if (!branch) {
      throw new BadRequestException(`Branch ${dto.branch_id} not found`);
    }
    if (!branch.is_active) {
      throw new BadRequestException(`Branch "${branch.name}" is not active`);
    }

    // Uniqueness check — one row per product+branch pair
    const existing = await this.stockRepository.findOne({
      where: { product_id: dto.product_id, branch_id: dto.branch_id },
    });
    if (existing) {
      throw new ConflictException(
        `Stock row for this product+branch already exists`,
      );
    }

    const stock = this.stockRepository.create({
      product_id: dto.product_id,
      branch_id: dto.branch_id,
      quantity: dto.quantity ?? 0,
      min_quantity: dto.min_quantity ?? 0,
      manage_stock: dto.manage_stock ?? true,
    });

    const saved = await this.stockRepository.save(stock);
    return this.findOne(saved.id);
  }

  /**
   * List all stock rows with nested product and branch data.
   * Includes computed low_stock_alert flag on each row.
   */
  async findAll(options: {
    productId?: string;
    branchId?: string;
    lowStockOnly?: boolean;
  }): Promise<StockWithAlert[]> {
    const where: Record<string, unknown> = {};
    if (options.productId) where.product_id = options.productId;
    if (options.branchId) where.branch_id = options.branchId;

    const rows = await this.stockRepository.find({
      where,
      relations: [...STOCK_RELATIONS],
      order: { updated_at: 'DESC' },
    });

    const withAlerts = rows.map((r) => this.attachLowStockAlert(r));

    if (options.lowStockOnly) {
      return withAlerts.filter((r) => r.low_stock_alert && r.manage_stock);
    }
    return withAlerts;
  }

  /**
   * Get one stock row by id.
   */
  async findOne(id: string): Promise<StockWithAlert> {
    const stock = await this.stockRepository.findOne({
      where: { id },
      relations: [...STOCK_RELATIONS],
    });
    if (!stock) {
      throw new NotFoundException('Stock row not found');
    }
    return this.attachLowStockAlert(stock);
  }

  /**
   * Get all stock rows for a given product (across all branches).
   * Convenience method — used by the product detail page.
   */
  async findByProduct(productId: string): Promise<StockWithAlert[]> {
    return this.findAll({ productId });
  }

  /**
   * Update quantity, min_quantity, or manage_stock. product_id and
   * branch_id cannot change after creation.
   */
  async update(id: string, dto: UpdateStockDto): Promise<StockWithAlert> {
    const stock = await this.stockRepository.findOne({ where: { id } });
    if (!stock) {
      throw new NotFoundException('Stock row not found');
    }

    if (dto.quantity !== undefined) stock.quantity = dto.quantity;
    if (dto.min_quantity !== undefined) stock.min_quantity = dto.min_quantity;
    if (dto.manage_stock !== undefined) stock.manage_stock = dto.manage_stock;

    await this.stockRepository.save(stock);
    return this.findOne(id);
  }

  /**
   * Called by ProductsService when a new Product is created.
   * Auto-creates a stock row with quantity=0 for the product's branch.
   * Silently no-ops if a row already exists (idempotent).
   */
  async createForNewProduct(
    productId: string,
    branchId: string,
  ): Promise<Stock> {
    const existing = await this.stockRepository.findOne({
      where: { product_id: productId, branch_id: branchId },
    });
    if (existing) return existing;

    const stock = this.stockRepository.create({
      product_id: productId,
      branch_id: branchId,
      quantity: 0,
      min_quantity: 0,
      manage_stock: true,
    });
    return this.stockRepository.save(stock);
  }

  /**
   * Decrement stock for a sold line as part of a larger transaction
   * (typically SalesService.completeSale). Enlists in the caller's
   * EntityManager so that if the outer transaction rolls back — for
   * any reason, including a later line failing — this decrement rolls
   * back with it. Never opens its own transaction.
   *
   * Behavior:
   *   - If no stock row exists for (product, branch): 500-level error.
   *     Stock rows are auto-created at product creation (Phase 6.1), so
   *     a missing row means data integrity is broken, not a business
   *     condition the cashier can fix. Fail loudly.
   *   - If stock.manage_stock is false: silent no-op. Untracked
   *     products (services, unlimited SIMs, etc.) don't move inventory.
   *   - If stock.quantity < qty: throw 409 Conflict with the product
   *     name and current available quantity, so the frontend can show
   *     "Only 3 of iPhone 15 Pro left" instead of a generic error.
   *   - Otherwise: UPDATE stock SET quantity = quantity - qty.
   *
   * Concurrency:
   *   We SELECT ... FOR UPDATE the stock row first to serialize
   *   concurrent decrements of the same (product, branch). Without
   *   the lock, two cashiers ringing up the last unit at the same
   *   moment could both pass the quantity >= qty check and both
   *   decrement, leaving quantity = -1. The DB CHK_stock_quantity_nonneg
   *   would catch it as a 500, but we want a clean 409 for the loser
   *   of the race, not a check violation.
   *
   * Why productNameForError is passed in rather than looked up:
   *   The caller (SalesService.completeSale) already has the product
   *   name from the sale line's product_name_snapshot column. Passing
   *   it in saves a join and keeps this method single-purpose.
   *
   * Must be called inside a transaction; will throw if `manager` is
   * outside one (TypeORM's setLock enforces this).
   */
  async decrementForSale(
    manager: EntityManager,
    productId: string,
    branchId: string,
    qty: number,
    productNameForError: string,
  ): Promise<void> {
    // Lock the stock row for this (product, branch) pair. Serializes
    // concurrent completeSale calls on the same product at the same branch.
    const stock = await manager
      .createQueryBuilder(Stock, 'stock')
      .setLock('pessimistic_write')
      .where('stock.product_id = :productId', { productId })
      .andWhere('stock.branch_id = :branchId', { branchId })
      .getOne();

    if (!stock) {
      // Data integrity failure — stock rows should always exist by
      // the time a sale is completed. Bubble up as 500.
      throw new Error(
        `Stock row missing for product ${productId} at branch ${branchId}. ` +
          `This indicates a data integrity issue — every product should have ` +
          `a stock row auto-created at product creation.`,
      );
    }

    // Untracked products (services, reloads, etc.) don't move inventory.
    if (!stock.manage_stock) {
      return;
    }

    if (stock.quantity < qty) {
      throw new ConflictException(
        `Insufficient stock for "${productNameForError}": ` +
          `requested ${qty}, available ${stock.quantity}`,
      );
    }

    await manager
      .createQueryBuilder()
      .update(Stock)
      .set({ quantity: () => `quantity - ${qty}` })
      .where('id = :id', { id: stock.id })
      .execute();
  }

  /**
   * Re-increment stock for a line on a voided sale, as part of a larger
   * transaction (typically SalesService.voidSale). Enlists in the caller's
   * EntityManager so that if the outer transaction rolls back — for any
   * reason, including a later line failing — this increment rolls back
   * with it. Never opens its own transaction.
   *
   * The mirror of decrementForSale, with two deliberate asymmetries:
   *
   *   1. No upper bound to check. Adding stock back can't fail on
   *      business grounds — inventory can go arbitrarily high on
   *      reversal. That means no 409 path here; the method has fewer
   *      branches than its twin.
   *
   *   2. Missing stock row is still a 500-level integrity error. A
   *      COMPLETED sale had this line's stock decremented at complete
   *      time — the row MUST exist by the time we're voiding. If it
   *      doesn't, something is very wrong with the data, not with
   *      this business flow.
   *
   * Behavior:
   *   - If no stock row exists for (product, branch): raw Error → 500.
   *   - If stock.manage_stock is false: silent no-op. Symmetric to
   *     decrement — we never touched it going in, don't touch it coming
   *     out. Services, reloads, unlimited SIMs, etc.
   *   - Otherwise: UPDATE stock SET quantity = quantity + qty.
   *
   * Concurrency:
   *   We SELECT ... FOR UPDATE the stock row before mutating, same as
   *   decrementForSale. Serializes against concurrent decrements or
   *   increments of the same (product, branch). Without the lock, a
   *   void racing against another cashier's completeSale on the same
   *   product could interleave reads and produce a lost update.
   *
   * Must be called inside a transaction; will throw if `manager` is
   * outside one (TypeORM's setLock enforces this).
   */
  async incrementForReversal(
    manager: EntityManager,
    productId: string,
    branchId: string,
    qty: number,
  ): Promise<void> {
    const stock = await manager
      .createQueryBuilder(Stock, 'stock')
      .setLock('pessimistic_write')
      .where('stock.product_id = :productId', { productId })
      .andWhere('stock.branch_id = :branchId', { branchId })
      .getOne();

    if (!stock) {
      // Data integrity failure — if we're voiding a sale, this line's
      // stock row was here when we decremented at complete time. Its
      // absence now indicates the row was deleted out from under us,
      // which should never happen.
      throw new Error(
        `Stock row missing for product ${productId} at branch ${branchId}. ` +
          `This indicates a data integrity issue — stock rows for voided ` +
          `sale lines must exist at void time.`,
      );
    }

    // Untracked products don't move inventory in either direction.
    if (!stock.manage_stock) {
      return;
    }

    await manager
      .createQueryBuilder()
      .update(Stock)
      .set({ quantity: () => `quantity + ${qty}` })
      .where('id = :id', { id: stock.id })
      .execute();
  }

  /**
   * Attach the computed low_stock_alert flag to a Stock row.
   * Rule: alert fires when tracking is enabled AND quantity is at or
   * below the minimum threshold.
   */
  private attachLowStockAlert(stock: Stock): StockWithAlert {
    const low_stock_alert =
      stock.manage_stock && stock.quantity <= stock.min_quantity;
    return Object.assign(stock, { low_stock_alert });
  }
}
