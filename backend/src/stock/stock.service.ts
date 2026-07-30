import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
