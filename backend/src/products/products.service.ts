import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BrandsService } from '../brands/brands.service';
import { CategoriesService } from '../categories/categories.service';
import { BranchesService } from '../branches/branches.service';
import { SkuBarcodeCountersService } from '../sku-barcode-counters/sku-barcode-counters.service';
import { CounterType } from '../sku-barcode-counters/enums/counter-type.enum';
import { Inject, forwardRef } from '@nestjs/common';
import { StockService } from '../stock/stock.service';

/**
 * Standard list of relations to always eagerly load for the nested
 * response shape (decision 7: nested responses with brand/category/branch
 * objects). Kept as a constant so all methods stay consistent.
 */
const PRODUCT_RELATIONS = ['brand', 'category', 'branch'] as const;

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    private readonly brandsService: BrandsService,
    private readonly categoriesService: CategoriesService,
    private readonly branchesService: BranchesService,
    private readonly countersService: SkuBarcodeCountersService,
    @Inject(forwardRef(() => StockService))
    private readonly stockService: StockService,
  ) {}

  /**
   * Create a new product. Enforces:
   *  - brand, category, branch exist AND are active
   *  - if barcode provided, it must be unique
   *  - SKU is always auto-generated
   *  - if barcode omitted, auto-generate an SLP-XXXXXX barcode
   */
  async create(dto: CreateProductDto): Promise<Product> {
    await this.assertReferencedEntitiesActive(
      dto.brand_id,
      dto.category_id,
      dto.branch_id,
    );

    if (dto.barcode) {
      await this.assertBarcodeAvailable(dto.barcode);
    }

    const sku = await this.countersService.next(CounterType.SKU);
    const barcode =
      dto.barcode ?? (await this.countersService.next(CounterType.BARCODE));

    const product = this.productsRepository.create({
      product_type: dto.product_type,
      name: dto.name,
      sku,
      barcode,
      barcode_type: dto.barcode_type,
      brand_id: dto.brand_id,
      category_id: dto.category_id,
      branch_id: dto.branch_id,
      description: dto.description ?? null,
      buying_price: dto.buying_price,
      selling_price: dto.selling_price,
      warranty_months: dto.warranty_months,
      checking_warranty_days: dto.checking_warranty_days,
      is_serialized: dto.is_serialized,
      is_active: dto.is_active,
      phone_condition: dto.phone_condition ?? null,
      phone_model: dto.phone_model ?? null,
      phone_storage: dto.phone_storage ?? null,
      phone_color: dto.phone_color ?? null,
      phone_ram: dto.phone_ram ?? null,
    });

    const saved = await this.productsRepository.save(product);
    // Auto-create a Stock row for the new product at its branch.
    // See Stock.createForNewProduct — idempotent, quantity starts at 0.
    await this.stockService.createForNewProduct(saved.id, saved.branch_id);
    // Re-fetch with relations for a consistent nested response shape
    return this.findOne(saved.id);
  }

  /**
   * List products. Default sort: created_at DESC (newest first).
   * Includes nested brand/category/branch data.
   * Supports filters via query params.
   */
  async findAll(options: {
    includeInactive?: boolean;
    brandId?: string;
    categoryId?: string;
    branchId?: string;
    productType?: string;
  }): Promise<Product[]> {
    const where: Record<string, unknown> = {};
    if (!options.includeInactive) where.is_active = true;
    if (options.brandId) where.brand_id = options.brandId;
    if (options.categoryId) where.category_id = options.categoryId;
    if (options.branchId) where.branch_id = options.branchId;
    if (options.productType) where.product_type = options.productType;

    return this.productsRepository.find({
      where,
      relations: [...PRODUCT_RELATIONS],
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Find one product by id, with nested relations.
   */
  async findOne(id: string): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { id },
      relations: [...PRODUCT_RELATIONS],
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  /**
   * Find a product by exact barcode string. Used at POS scan time.
   * Returns nested relations so the cashier UI has everything it needs.
   */
  async findByBarcode(barcode: string): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { barcode },
      relations: [...PRODUCT_RELATIONS],
    });
    if (!product) {
      throw new NotFoundException(`No product found with barcode ${barcode}`);
    }
    return product;
  }

  /**
   * Partial update. Enforces:
   *  - If brand/category/branch changes, new values must exist and be active
   *  - If sku changes, must be unique
   *  - If barcode changes, must be unique
   */
  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);

    // Cross-entity checks — only when the referenced ID actually changes
    const brandId = dto.brand_id ?? product.brand_id;
    const categoryId = dto.category_id ?? product.category_id;
    const branchId = dto.branch_id ?? product.branch_id;

    if (
      brandId !== product.brand_id ||
      categoryId !== product.category_id ||
      branchId !== product.branch_id
    ) {
      await this.assertReferencedEntitiesActive(brandId, categoryId, branchId);
    }

    // SKU uniqueness — only if changing
    if (dto.sku !== undefined && dto.sku !== product.sku) {
      await this.assertSkuAvailable(dto.sku, id);
    }

    // Barcode uniqueness — only if changing
    if (dto.barcode !== undefined && dto.barcode !== product.barcode) {
      await this.assertBarcodeAvailable(dto.barcode, id);
    }

    // Apply the update. Undefined fields are skipped, null clears the value.
    Object.assign(product, {
      ...(dto.product_type !== undefined && { product_type: dto.product_type }),
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.sku !== undefined && { sku: dto.sku }),
      ...(dto.barcode !== undefined && { barcode: dto.barcode }),
      ...(dto.barcode_type !== undefined && { barcode_type: dto.barcode_type }),
      ...(dto.brand_id !== undefined && { brand_id: dto.brand_id }),
      ...(dto.category_id !== undefined && { category_id: dto.category_id }),
      ...(dto.branch_id !== undefined && { branch_id: dto.branch_id }),
      ...(dto.description !== undefined && {
        description: dto.description ?? null,
      }),
      ...(dto.buying_price !== undefined && { buying_price: dto.buying_price }),
      ...(dto.selling_price !== undefined && {
        selling_price: dto.selling_price,
      }),
      ...(dto.warranty_months !== undefined && {
        warranty_months: dto.warranty_months,
      }),
      ...(dto.checking_warranty_days !== undefined && {
        checking_warranty_days: dto.checking_warranty_days,
      }),
      ...(dto.is_serialized !== undefined && {
        is_serialized: dto.is_serialized,
      }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      ...(dto.phone_condition !== undefined && {
        phone_condition: dto.phone_condition ?? null,
      }),
      ...(dto.phone_model !== undefined && {
        phone_model: dto.phone_model ?? null,
      }),
      ...(dto.phone_storage !== undefined && {
        phone_storage: dto.phone_storage ?? null,
      }),
      ...(dto.phone_color !== undefined && {
        phone_color: dto.phone_color ?? null,
      }),
      ...(dto.phone_ram !== undefined && { phone_ram: dto.phone_ram ?? null }),
    });

    await this.productsRepository.save(product);
    return this.findOne(id);
  }

  /**
   * Deactivate. Sets is_active=false. Idempotent.
   * Does NOT touch stock — deactivated product's stock stays queryable
   * for historical reports.
   */
  async deactivate(id: string): Promise<Product> {
    const product = await this.findOne(id);
    if (!product.is_active) return product;
    product.is_active = false;
    await this.productsRepository.save(product);
    return this.findOne(id);
  }

  /**
   * Reactivate. Idempotent.
   */
  async reactivate(id: string): Promise<Product> {
    const product = await this.findOne(id);
    if (product.is_active) return product;
    product.is_active = true;
    await this.productsRepository.save(product);
    return this.findOne(id);
  }

  // ---- private guards ----

  /**
   * Validates all three referenced entities exist and are active.
   * Uses the existing services (not raw repo queries) so business rules
   * from those modules stay in one place. Throws:
   *  - BadRequestException if any is missing (invalid FK)
   *  - BadRequestException if any is inactive
   */
  private async assertReferencedEntitiesActive(
    brandId: string,
    categoryId: string,
    branchId: string,
  ): Promise<void> {
    const [brand, category, branch] = await Promise.all([
      this.brandsService.findOne(brandId).catch(() => null),
      this.categoriesService.findOne(categoryId).catch(() => null),
      this.branchesService.findOne(branchId).catch(() => null),
    ]);

    if (!brand) throw new BadRequestException(`Brand ${brandId} not found`);
    if (!brand.is_active)
      throw new BadRequestException(`Brand "${brand.name}" is not active`);

    if (!category)
      throw new BadRequestException(`Category ${categoryId} not found`);
    if (!category.is_active)
      throw new BadRequestException(
        `Category "${category.name}" is not active`,
      );

    if (!branch) throw new BadRequestException(`Branch ${branchId} not found`);
    if (!branch.is_active)
      throw new BadRequestException(`Branch "${branch.name}" is not active`);
  }

  private async assertSkuAvailable(
    sku: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.productsRepository.findOne({
      where: excludeId ? { sku, id: Not(excludeId) } : { sku },
    });
    if (existing) {
      throw new ConflictException(`SKU "${sku}" is already in use`);
    }
  }

  private async assertBarcodeAvailable(
    barcode: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.productsRepository.findOne({
      where: excludeId ? { barcode, id: Not(excludeId) } : { barcode },
    });
    if (existing) {
      throw new ConflictException(`Barcode "${barcode}" is already in use`);
    }
  }
}
