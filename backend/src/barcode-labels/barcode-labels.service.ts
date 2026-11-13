import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { TrackingMethod } from '../products/enums/tracking-method.enum';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { unitSaleIdentifier } from '../product-units/unit-code';
import { paginate } from '../common/dto/paginated-response.dto';
import {
  LabelKind,
  ProductLabelRowDto,
  UnitIdentifierType,
  UnitLabelRowDto,
  UnitTrackingMethod,
} from './dto/label-row.dto';
import {
  ProductLabelSearchResponseDto,
  ResolvedLabelQueueResponseDto,
  ResolvedQueueItem,
  UnitLabelSearchResponseDto,
} from './dto/label-responses.dto';
import { SearchProductLabelsQueryDto } from './dto/search-product-labels-query.dto';
import { SearchUnitLabelsQueryDto } from './dto/search-unit-labels-query.dto';
import {
  MAX_LABELS_PER_QUEUE,
  ResolveLabelQueueDto,
} from './dto/resolve-label-queue.dto';

/** The tracking methods whose products get unit labels. */
const UNIT_TRACKING_METHODS: UnitTrackingMethod[] = [
  TrackingMethod.IMEI,
  TrackingMethod.SERIAL_NUMBER,
];

/** Escape LIKE wildcards and the escape character (Postgres's default \). */
const likePattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/** Why one queue item can't be printed. */
export type LabelItemProblemReason =
  | 'DUPLICATE_PRODUCT'
  | 'DUPLICATE_UNIT'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_INACTIVE'
  | 'PRODUCT_NOT_QUANTITY_TRACKED'
  | 'UNIT_NOT_FOUND'
  | 'UNIT_NOT_IN_STOCK'
  | 'UNIT_PRODUCT_INACTIVE'
  | 'UNIT_NOT_SERIALIZED';

/** One entry of a 400 INVALID_LABEL_ITEMS: the item's index in `items`. */
export interface LabelItemProblem {
  index: number;
  reason: LabelItemProblemReason;
  message: string;
}

const PROBLEM_MESSAGES: Record<LabelItemProblemReason, string> = {
  DUPLICATE_PRODUCT:
    'This product is already in the queue: change its quantity instead.',
  DUPLICATE_UNIT: 'This unit is already in the queue.',
  PRODUCT_NOT_FOUND: 'No product with that id.',
  PRODUCT_INACTIVE: 'This product is inactive.',
  PRODUCT_NOT_QUANTITY_TRACKED:
    'This product is tracked by IMEI or serial number: print unit labels instead.',
  // The same answer for another branch's unit, so its existence is not
  // revealed (as GET /product-units/:id does).
  UNIT_NOT_FOUND: 'No unit with that id at this branch.',
  UNIT_NOT_IN_STOCK: 'This unit is not in stock.',
  UNIT_PRODUCT_INACTIVE: 'This unit’s product is inactive.',
  UNIT_NOT_SERIALIZED:
    'This unit’s product is quantity-tracked: print a product label instead.',
};

/**
 * Barcode Labels (Stage 2): label-ready rows for the Barcode Labels page.
 *
 * Read-only: it builds labels from products and product units and never
 * changes them, so POS scanning (GET /products/by-barcode and
 * GET /product-units/sellable/by-identifier) is untouched.
 *
 * Rows are plain objects built field by field (toProductRow, toUnitRow)
 * from columns selected by name, never entities: no buying price is read,
 * and no customer, sale or sale line is joined.
 *
 * Branch scoping is resolved by the controller (scopeBranch) before any of
 * these run: `branchId` is then a manager's own branch, or an admin's
 * choice (undefined: every branch).
 */
@Injectable()
export class BarcodeLabelsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(ProductUnit)
    private readonly productUnitsRepository: Repository<ProductUnit>,
  ) {}

  /**
   * GET /barcode-labels/products: active QUANTITY-tracked products, the ones
   * that get product-level labels. query.search matches part of the name,
   * SKU or barcode, in any case; % _ and \ in it match themselves.
   *
   * Sorted as GET /products is: created_at DESC, id DESC, so pages are
   * stable. Soft-deleted products are left out (Product has a
   * DeleteDateColumn, which the query builder honours).
   *
   * Only the label's columns are selected and no relation is joined: no
   * buying price is read at all.
   */
  async searchProducts(
    query: SearchProductLabelsQueryDto,
  ): Promise<ProductLabelSearchResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.productsRepository
      .createQueryBuilder('product')
      .select(this.productLabelColumns())
      .where('product.tracking_method = :trackingMethod', {
        trackingMethod: TrackingMethod.QUANTITY,
      })
      .andWhere('product.is_active = :active', { active: true });

    if (query.search) {
      const pattern = likePattern(query.search);
      // The OR stays inside its Brackets: outside them it would bypass the
      // tracking and active filters.
      qb.andWhere(
        new Brackets((match) => {
          match
            .where('product.name ILIKE :pattern', { pattern })
            .orWhere('product.sku ILIKE :pattern', { pattern })
            .orWhere('product.barcode ILIKE :pattern', { pattern });
        }),
      );
    }

    qb.orderBy('product.created_at', 'DESC')
      .addOrderBy('product.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [products, total] = await qb.getManyAndCount();
    return paginate(products.map(toProductRow), total, page, limit);
  }

  /**
   * GET /barcode-labels/units: the units that may get a label now, IN_STOCK
   * units of active IMEI- or serial-tracked products, the same rule as the
   * till's sellable lookup. query.search matches part of the IMEI, legacy
   * imei column, serial number, unit code, or the product's SKU or name, as
   * GET /product-units/search does; % _ and \ match themselves.
   *
   * Sorted by created_at DESC, id DESC. Only many-to-one relations are
   * joined (product, branch), so a row is one unit.
   */
  async searchUnits(
    query: SearchUnitLabelsQueryDto,
  ): Promise<UnitLabelSearchResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.unitLabelQuery()
      .where('unit.status = :status', { status: ProductUnitStatus.IN_STOCK })
      .andWhere('product.is_active = :active', { active: true })
      .andWhere('product.tracking_method IN (:...trackingMethods)', {
        trackingMethods: UNIT_TRACKING_METHODS,
      });

    if (query.branchId) {
      qb.andWhere('unit.branch_id = :branchId', { branchId: query.branchId });
    }
    if (query.productId) {
      qb.andWhere('unit.product_id = :productId', {
        productId: query.productId,
      });
    }
    if (query.search) {
      const pattern = likePattern(query.search);
      // Inside Brackets, or the OR would bypass the branch and status.
      qb.andWhere(
        new Brackets((match) => {
          match
            .where('unit.imei_number ILIKE :pattern', { pattern })
            .orWhere('unit.imei ILIKE :pattern', { pattern })
            .orWhere('unit.serial_number ILIKE :pattern', { pattern })
            .orWhere('unit.unit_code ILIKE :pattern', { pattern })
            .orWhere('product.sku ILIKE :pattern', { pattern })
            .orWhere('product.name ILIKE :pattern', { pattern });
        }),
      );
    }

    qb.orderBy('unit.created_at', 'DESC')
      .addOrderBy('unit.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [units, total] = await qb.getManyAndCount();
    return paginate(units.map(toUnitRow), total, page, limit);
  }

  /**
   * POST /barcode-labels/resolve: check a whole label queue and return its
   * rows in the order asked. All or nothing: if any item can't be printed,
   * the answer is one 400 listing every such item, and no rows.
   *
   * 1. Without the database: the 500-label total (400 LABEL_LIMIT_EXCEEDED),
   *    and each product and unit at most once (DUPLICATE_*).
   * 2. Two queries, whatever the queue's length: the products by id, and
   *    the units by id with their product and branch.
   * 3. Each item checked: a product must be active and QUANTITY-tracked; a
   *    unit must be in scope (another branch's is UNIT_NOT_FOUND, as an
   *    unknown one), IN_STOCK, of an active IMEI- or serial-tracked product.
   *
   * Read-only, so no transaction: a unit sold just after this answer is
   * refused at the till by its own checks.
   */
  async resolveQueue(
    dto: ResolveLabelQueueDto,
    branchId: string | undefined,
  ): Promise<ResolvedLabelQueueResponseDto> {
    const totalLabels = dto.items.reduce(
      (sum, item) =>
        sum + (item.type === LabelKind.PRODUCT ? item.quantity! : 1),
      0,
    );
    if (totalLabels > MAX_LABELS_PER_QUEUE) {
      throw new BadRequestException({
        message: `A label queue can hold at most ${MAX_LABELS_PER_QUEUE} labels; this one has ${totalLabels}.`,
        code: 'LABEL_LIMIT_EXCEEDED',
        total_labels: totalLabels,
        max_labels: MAX_LABELS_PER_QUEUE,
      });
    }

    const problems: LabelItemProblem[] = [];
    const flag = (index: number, reason: LabelItemProblemReason) =>
      problems.push({ index, reason, message: PROBLEM_MESSAGES[reason] });

    // A repeat is reported once, as a duplicate; the first occurrence is
    // the one checked against the database.
    const seenProducts = new Set<string>();
    const seenUnits = new Set<string>();
    const repeats = new Set<number>();
    dto.items.forEach((item, index) => {
      const [seen, id, reason] =
        item.type === LabelKind.PRODUCT
          ? [seenProducts, item.productId!, 'DUPLICATE_PRODUCT' as const]
          : [seenUnits, item.unitId!, 'DUPLICATE_UNIT' as const];
      if (seen.has(id)) {
        flag(index, reason);
        repeats.add(index);
      }
      seen.add(id);
    });

    const [products, units] = await Promise.all([
      seenProducts.size
        ? this.productsRepository
            .createQueryBuilder('product')
            .select([
              ...this.productLabelColumns(),
              'product.is_active',
              'product.tracking_method',
            ])
            .where({ id: In([...seenProducts]) })
            .getMany()
        : Promise.resolve([]),
      seenUnits.size
        ? this.unitLabelQuery()
            .where({ id: In([...seenUnits]) })
            .getMany()
        : Promise.resolve([]),
    ]);
    const productsById = new Map(products.map((p) => [p.id, p]));
    const unitsById = new Map(units.map((u) => [u.id, u]));

    const data: ResolvedQueueItem[] = [];
    dto.items.forEach((item, index) => {
      if (repeats.has(index)) return;
      if (item.type === LabelKind.PRODUCT) {
        const product = productsById.get(item.productId!);
        if (!product) return flag(index, 'PRODUCT_NOT_FOUND');
        if (!product.is_active) return flag(index, 'PRODUCT_INACTIVE');
        if (product.tracking_method !== TrackingMethod.QUANTITY)
          return flag(index, 'PRODUCT_NOT_QUANTITY_TRACKED');
        data.push({ ...toProductRow(product), quantity: item.quantity! });
        return;
      }
      const unit = unitsById.get(item.unitId!);
      // Branch first, so another branch's unit reveals nothing, not even
      // its status.
      if (!unit || (branchId !== undefined && unit.branch_id !== branchId))
        return flag(index, 'UNIT_NOT_FOUND');
      if (unit.status !== ProductUnitStatus.IN_STOCK)
        return flag(index, 'UNIT_NOT_IN_STOCK');
      if (!unit.product!.is_active) return flag(index, 'UNIT_PRODUCT_INACTIVE');
      if (!isUnitTracked(unit.product!.tracking_method))
        return flag(index, 'UNIT_NOT_SERIALIZED');
      data.push(toUnitRow(unit));
    });

    if (problems.length) {
      throw new BadRequestException({
        message: 'Some items in the label queue cannot be printed.',
        code: 'INVALID_LABEL_ITEMS',
        errors: problems.sort((a, b) => a.index - b.index),
      });
    }
    return { data, total_labels: totalLabels };
  }

  /** The product columns a label row is built from. */
  private productLabelColumns(): string[] {
    return [
      'product.id',
      'product.name',
      'product.model',
      'product.sku',
      'product.barcode',
      'product.barcode_type',
      'product.selling_price',
    ];
  }

  /**
   * Units with the columns a label row (and the queue's checks) need, their
   * product and branch. created_at is selected for the search's ORDER BY,
   * which TypeORM needs selected once skip/take meet a join.
   */
  private unitLabelQuery() {
    return this.productUnitsRepository
      .createQueryBuilder('unit')
      .select([
        'unit.id',
        'unit.product_id',
        'unit.branch_id',
        'unit.imei',
        'unit.imei_number',
        'unit.serial_number',
        'unit.unit_code',
        'unit.status',
        'unit.selling_price',
        'unit.created_at',
      ])
      .innerJoin('unit.product', 'product')
      .addSelect([
        'product.id',
        'product.name',
        'product.tracking_method',
        'product.is_active',
        'product.selling_price',
      ])
      .innerJoin('unit.branch', 'branch')
      .addSelect(['branch.id', 'branch.name']);
  }
}

const isUnitTracked = (method: TrackingMethod): method is UnitTrackingMethod =>
  (UNIT_TRACKING_METHODS as TrackingMethod[]).includes(method);

/** A product label row, field by field. */
export const toProductRow = (product: Product): ProductLabelRowDto => ({
  kind: LabelKind.PRODUCT,
  product_id: product.id,
  name: product.name,
  model: product.model,
  sku: product.sku,
  barcode: product.barcode,
  barcode_type: product.barcode_type,
  selling_price: product.selling_price,
});

/**
 * A unit label row, field by field. The barcode value is unit_code; the
 * readable identifier is the real IMEI or serial number, chosen as a sale
 * records it (unitSaleIdentifier, with the legacy imei column for old rows),
 * and identifier_type says which it is, as the till's lookup does. The price
 * is the unit's, else its product's, else null.
 */
export const toUnitRow = (unit: ProductUnit): UnitLabelRowDto => {
  const product = unit.product!;
  const identifier = unitSaleIdentifier(unit, product.tracking_method);
  const identifierType: UnitIdentifierType =
    unit.imei_number === identifier
      ? TrackingMethod.IMEI
      : unit.serial_number === identifier
        ? TrackingMethod.SERIAL_NUMBER
        : (product.tracking_method as UnitIdentifierType);
  return {
    kind: LabelKind.UNIT,
    unit_id: unit.id,
    unit_code: unit.unit_code,
    product_id: unit.product_id,
    name: product.name,
    tracking_method: product.tracking_method as UnitTrackingMethod,
    identifier_type: identifierType,
    identifier,
    selling_price: unit.selling_price ?? product.selling_price ?? null,
    branch: { id: unit.branch!.id, name: unit.branch!.name },
  };
};
