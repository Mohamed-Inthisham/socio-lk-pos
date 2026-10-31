import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Branch } from '../branches/entities/branch.entity';
import { Product } from '../products/entities/product.entity';
import { TrackingMethod } from '../products/enums/tracking-method.enum';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { LIVE_UNIT_STATUSES } from '../product-units/live-imei';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { StockService } from '../stock/stock.service';
import {
  ensureStockRows,
  lockInventoryRows,
} from '../stock/lock-inventory-rows';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';
import { CreateStockPurchasePaymentDto } from './dto/create-stock-purchase-payment.dto';
import { UpdateStockPurchasePaymentStatusDto } from './dto/update-stock-purchase-payment-status.dto';
import { StockPurchaseItem } from './entities/stock-purchase-item.entity';
import { StockPurchasePayment } from './entities/stock-purchase-payment.entity';
import { StockPurchase } from './entities/stock-purchase.entity';
import { StockPurchasePaymentMethod } from './enums/stock-purchase-payment-method.enum';
import { StockPurchasePaymentStatus } from './enums/stock-purchase-payment-status.enum';

const PURCHASE_RELATIONS = [
  'supplier',
  'branch',
  'created_by',
  'items',
  'items.product',
  'payments',
  'payments.created_by',
] as const;
const MAX_QUANTITY = 1_000_000;
const MAX_PURCHASE_TOTAL_CENTS = 99_999_999_999_999;

const amountToCents = (value: string): number => {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) {
    throw new BadRequestException('Prices must be non-negative amounts with up to 2 decimals.');
  }
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};

const centsToAmount = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

const paymentAmountToCents = (value: string): number => {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value)) {
    throw new BadRequestException('Payment amounts must be non-negative with up to 2 decimals.');
  }
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};

const currentColomboDate = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

type UnitIdentifierPair = {
  imei_number?: string;
  serial_number?: string;
};

const unitIdentifierPairs = (item: CreateStockPurchaseDto['items'][number]): UnitIdentifierPair[] => {
  if (item.unit_identifiers) {
    return item.unit_identifiers
      .map(({ imei_number, serial_number }) => ({
        ...(imei_number?.trim() && { imei_number: imei_number.trim() }),
        ...(serial_number?.trim() && { serial_number: serial_number.trim() }),
      }))
      .filter((pair) => pair.imei_number || pair.serial_number);
  }
  const imeis = item.imei_numbers ?? [];
  const serials = item.serial_numbers ?? [];
  return Array.from({ length: Math.max(imeis.length, serials.length) }, (_, index) => ({
    ...(imeis[index] && { imei_number: imeis[index] }),
    ...(serials[index] && { serial_number: serials[index] }),
  }));
};

@Injectable()
export class StockPurchasesService {
  constructor(
    @InjectRepository(StockPurchase)
    private readonly purchasesRepository: Repository<StockPurchase>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stockService: StockService,
  ) {}

  async create(
    dto: CreateStockPurchaseDto,
    actor: { id: string; role: UserRole; branch_id: string | null },
  ): Promise<StockPurchase> {
    const id = randomUUID();
    const purchaseNumber = `SP-${id.slice(0, 8).toUpperCase()}`;
    await this.dataSource.transaction(async (manager) => {
      await this.assertBranchAccess(actor, dto.branch_id);
      const supplier = await manager.findOne(Supplier, {
        where: { id: dto.supplier_id },
      });
      if (!supplier || !supplier.is_active) {
        throw new BadRequestException('Select an active supplier.');
      }
      const branch = await manager.findOne(Branch, {
        where: { id: dto.branch_id },
      });
      if (!branch || !branch.is_active) {
        throw new BadRequestException('Select an active branch.');
      }

      const productIds = dto.items.map((item) => item.product_id);
      if (new Set(productIds).size !== productIds.length) {
        throw new BadRequestException(
          'Add each product once. Combine repeated products into one line.',
        );
      }

      const products = new Map<string, Product>();
      for (const item of dto.items) {
        const product = await manager.findOne(Product, {
          where: { id: item.product_id },
          relations: ['category'],
        });
        if (!product || !product.is_active) {
          throw new BadRequestException(
            `Product ${item.product_id} was not found or is inactive.`,
          );
        }
        if (item.quantity > MAX_QUANTITY) {
          throw new BadRequestException('A purchase line quantity is too large.');
        }
        const pairs = unitIdentifierPairs(item);
        const imeis = pairs.flatMap((pair) => pair.imei_number ? [pair.imei_number] : []);
        const trackingMethod =
          product.tracking_method ??
          (product.is_serialized
            ? TrackingMethod.IMEI
            : TrackingMethod.QUANTITY);
        if (trackingMethod === TrackingMethod.IMEI) {
          if (imeis.length !== item.quantity || pairs.some((pair) => !pair.imei_number)) {
            throw new BadRequestException(
              `${product.name} needs one IMEI for each of its ${item.quantity} units.`,
            );
          }
        } else if (trackingMethod === TrackingMethod.SERIAL_NUMBER) {
          if (pairs.length > item.quantity) {
            throw new BadRequestException(
              `Identifiers for ${product.name} must not exceed the received quantity.`,
            );
          }
        } else if (pairs.length) {
          throw new BadRequestException(
            `${product.name} is set to receive stock without per-unit identifiers.`,
          );
        }
        if (item.unit_selling_price !== undefined) {
          amountToCents(item.unit_selling_price);
        }
        amountToCents(item.unit_buying_price);
        products.set(product.id, product);
      }

      this.assertUniqueIdentifiers(dto);
      await this.assertSerialsNotPreviouslyReceived(manager, dto);
      const allPairs = dto.items.flatMap((item) => unitIdentifierPairs(item));
      const allImeis = allPairs.flatMap((pair) => pair.imei_number ? [pair.imei_number] : []);
      const allSerials = allPairs.flatMap((pair) => pair.serial_number ? [pair.serial_number] : []);
      const allCodes = [...new Set([...allImeis, ...allSerials])];
      if (allCodes.length) {
        const existing = await manager.findOne(ProductUnit, {
          where: [
            { imei: In(allCodes), status: In([...LIVE_UNIT_STATUSES]) },
            { imei_number: In(allCodes), status: In([...LIVE_UNIT_STATUSES]) },
            { serial_number: In(allCodes), status: In([...LIVE_UNIT_STATUSES]) },
          ],
        });
        if (existing) {
          throw new ConflictException({
            message: 'An IMEI or serial number is already recorded on a live unit.',
            imei: existing.imei_number,
            serial_number: existing.serial_number,
            existing_unit: {
              id: existing.id,
              product_id: existing.product_id,
              status: existing.status,
            },
          });
        }
      }

      // Create any missing stock rows, then lock them, both in the global
      // lock order (P7-25), so two purchases listing the same products in
      // a different order can't deadlock.
      const stockTargets = dto.items.map((item) => ({
        productId: item.product_id,
        branchId: dto.branch_id,
      }));
      await ensureStockRows(manager, stockTargets);
      await lockInventoryRows(manager, { stock: stockTargets });

      const purchase = manager.create(StockPurchase, {
        id,
        purchase_number: purchaseNumber,
        supplier_id: dto.supplier_id,
        branch_id: dto.branch_id,
        created_by_id: actor.id,
        purchase_date:
          dto.purchase_date ??
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Colombo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date()),
        supplier_invoice_number: dto.supplier_invoice_number?.trim() || null,
        total_amount: '0.00',
        notes: dto.notes?.trim() || null,
      });
      const savedPurchase = await manager.save(purchase);
      let totalCents = 0;

      for (const item of dto.items) {
        const product = products.get(item.product_id)!;
        const unitBuyingCents = amountToCents(item.unit_buying_price);
        const lineTotalCents = unitBuyingCents * item.quantity;
        totalCents += lineTotalCents;
        if (
          !Number.isSafeInteger(lineTotalCents) ||
          !Number.isSafeInteger(totalCents) ||
          totalCents > MAX_PURCHASE_TOTAL_CENTS
        ) {
          throw new BadRequestException('The purchase total is too large.');
        }
        const unitSellingPrice = item.unit_selling_price ?? product.selling_price;
        const unitPairs = unitIdentifierPairs(item);
        const line = manager.create(StockPurchaseItem, {
          stock_purchase_id: savedPurchase.id,
          product_id: product.id,
          product_name_snapshot: product.name,
          product_sku_snapshot: product.sku,
          quantity: item.quantity,
          unit_buying_price: centsToAmount(unitBuyingCents),
          unit_selling_price:
            item.unit_selling_price !== undefined
              ? centsToAmount(amountToCents(item.unit_selling_price))
              : null,
          line_total: centsToAmount(lineTotalCents),
          imei_numbers: unitPairs.flatMap((pair) => pair.imei_number ? [pair.imei_number] : []),
          serial_numbers: unitPairs.flatMap((pair) => pair.serial_number ? [pair.serial_number] : []),
        });
        await manager.save(line);

        await this.stockService.receivePurchase(
          manager,
          product.id,
          dto.branch_id,
          item.quantity,
        );

        for (const pair of unitPairs) {
          const legacyIdentifier = pair.imei_number ?? pair.serial_number;
          if (!legacyIdentifier) continue;
          const unit = manager.create(ProductUnit, {
            product_id: product.id,
            branch_id: dto.branch_id,
            imei: legacyIdentifier,
            imei_number: pair.imei_number ?? null,
            serial_number: pair.serial_number ?? null,
            status: ProductUnitStatus.IN_STOCK,
            buying_price: centsToAmount(unitBuyingCents),
            selling_price: unitSellingPrice,
            phone_purchase_id: null,
          });
          try {
            await manager.save(unit);
          } catch (error) {
            const detail = error as { code?: string; constraint?: string };
            if (
              detail.code === '23505' &&
              ['uq_product_units_imei_live', 'uq_product_units_imei_number_live', 'uq_product_units_serial_number_live'].includes(detail.constraint ?? '')
            ) {
              throw new ConflictException(
                `Identifier ${legacyIdentifier} is already in stock.`,
              );
            }
            throw error;
          }
        }

        await manager.update(Product, product.id, {
          buying_price: centsToAmount(unitBuyingCents),
          ...(item.unit_selling_price !== undefined && {
            selling_price: centsToAmount(amountToCents(item.unit_selling_price)),
          }),
        });
      }

      await manager.update(StockPurchase, savedPurchase.id, {
        total_amount: centsToAmount(totalCents),
      });
      if (dto.initial_payment) {
        await this.recordPayment(
          manager,
          savedPurchase.id,
          dto.initial_payment,
          actor.id,
          totalCents,
          0,
        );
      }
    });
    return this.findOne(id, actor);
  }

  async addPayment(
    purchaseId: string,
    dto: CreateStockPurchasePaymentDto,
    actor: { id: string; role: UserRole; branch_id: string | null },
  ): Promise<StockPurchase> {
    await this.dataSource.transaction(async (manager) => {
      const purchase = await manager.findOne(StockPurchase, {
        where: { id: purchaseId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!purchase) throw new NotFoundException('Stock purchase not found.');
      await this.assertBranchAccess(actor, purchase.branch_id);
      const [{ reserved_amount: reservedAmount }] = await manager.query(
        `SELECT COALESCE(SUM("amount"), 0)::text AS "reserved_amount"
         FROM "stock_purchase_payments"
         WHERE "stock_purchase_id" = $1 AND "status" <> $2`,
        [purchaseId, StockPurchasePaymentStatus.BOUNCED],
      );
      const reservedCents = paymentAmountToCents(reservedAmount);
      const totalCents = paymentAmountToCents(purchase.total_amount);
      await this.recordPayment(
        manager,
        purchaseId,
        dto,
        actor.id,
        totalCents,
        reservedCents,
      );
    });
    return this.findOne(purchaseId, actor);
  }

  async resolveCheque(
    purchaseId: string,
    paymentId: string,
    dto: UpdateStockPurchasePaymentStatusDto,
    actor: { id: string; role: UserRole; branch_id: string | null },
  ): Promise<StockPurchase> {
    await this.dataSource.transaction(async (manager) => {
      const purchase = await manager.findOne(StockPurchase, {
        where: { id: purchaseId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!purchase) throw new NotFoundException('Stock purchase not found.');
      await this.assertBranchAccess(actor, purchase.branch_id);
      const payment = await manager.findOne(StockPurchasePayment, {
        where: { id: paymentId, stock_purchase_id: purchaseId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException('Supplier payment not found.');
      if (
        payment.method !== StockPurchasePaymentMethod.CHEQUE ||
        payment.status !== StockPurchasePaymentStatus.PENDING
      ) {
        throw new BadRequestException('Only pending cheques can be cleared or marked bounced.');
      }
      await manager.update(StockPurchasePayment, payment.id, {
        status: dto.status,
      });
    });
    return this.findOne(purchaseId, actor);
  }

  private async recordPayment(
    manager: EntityManager,
    purchaseId: string,
    dto: CreateStockPurchasePaymentDto,
    actorId: string,
    totalCents: number,
    reservedCents: number,
  ): Promise<void> {
    const amountCents = paymentAmountToCents(dto.amount);
    if (!amountCents) throw new BadRequestException('Payment amount must be greater than zero.');
    if (!Number.isSafeInteger(amountCents) || reservedCents + amountCents > totalCents) {
      throw new BadRequestException('Payments cannot exceed the stock purchase total.');
    }
    const isCheque = dto.method === StockPurchasePaymentMethod.CHEQUE;
    const chequeValues = [dto.cheque_number, dto.cheque_date, dto.bank];
    if (isCheque && chequeValues.some((value) => !value?.trim())) {
      throw new BadRequestException('Cheque number, cheque date, and bank are required for cheque payments.');
    }
    if (!isCheque && chequeValues.some((value) => value !== undefined)) {
      throw new BadRequestException('Cheque details can only be supplied for cheque payments.');
    }
    const payment = manager.create(StockPurchasePayment, {
      stock_purchase_id: purchaseId,
      amount: centsToAmount(amountCents),
      method: dto.method,
      status: isCheque
        ? StockPurchasePaymentStatus.PENDING
        : StockPurchasePaymentStatus.CLEARED,
      payment_date: dto.payment_date || currentColomboDate(),
      reference: dto.reference?.trim() || null,
      cheque_number: isCheque ? dto.cheque_number!.trim() : null,
      cheque_date: isCheque ? dto.cheque_date! : null,
      bank: isCheque ? dto.bank!.trim() : null,
      created_by_id: actorId,
    });
    await manager.save(payment);
  }

  async findAll(actor: { role: UserRole; branch_id: string | null }): Promise<StockPurchase[]> {
    const where = actor.role === UserRole.ADMIN ? {} : { branch_id: actor.branch_id! };
    return this.purchasesRepository.find({
      where,
      relations: [...PURCHASE_RELATIONS],
      order: { purchase_date: 'DESC', created_at: 'DESC' },
      take: 200,
    });
  }

  async findProductIdentifiers(
    productId: string,
    actor: { role: UserRole; branch_id: string | null },
  ) {
    const query = this.dataSource
      .getRepository(StockPurchaseItem)
      .createQueryBuilder('item')
      .innerJoin('item.purchase', 'purchase')
      .innerJoin('purchase.branch', 'branch')
      .select('item.id', 'purchase_item_id')
      .addSelect('item.quantity', 'quantity')
      .addSelect('item.imei_numbers', 'imei_numbers')
      .addSelect('item.serial_numbers', 'serial_numbers')
      .addSelect('purchase.id', 'purchase_id')
      .addSelect('purchase.purchase_number', 'purchase_number')
      .addSelect('purchase.purchase_date', 'purchase_date')
      .addSelect('branch.id', 'branch_id')
      .addSelect('branch.name', 'branch_name')
      .where('item.product_id = :productId', { productId });

    if (actor.role !== UserRole.ADMIN) {
      query.andWhere('purchase.branch_id = :branchId', {
        branchId: actor.branch_id,
      });
    }

    return query
      .orderBy('purchase.purchase_date', 'DESC')
      .addOrderBy('purchase.created_at', 'DESC')
      .getRawMany();
  }

  async supplierBalances(actor: {
    role: UserRole;
    branch_id: string | null;
  }): Promise<Array<{
    supplier_id: string;
    total_amount: string;
    paid_amount: string;
    pending_cheque_amount: string;
    outstanding_amount: string;
  }>> {
    const branchCondition = actor.role === UserRole.ADMIN ? '' : 'WHERE sp."branch_id" = $1';
    const parameters = actor.role === UserRole.ADMIN ? [] : [actor.branch_id];
    return this.dataSource.manager.query(
      `SELECT "supplier_id",
              SUM("total_amount")::text AS "total_amount",
              SUM("paid_amount")::text AS "paid_amount",
              SUM("pending_cheque_amount")::text AS "pending_cheque_amount",
              GREATEST(SUM("total_amount") - SUM("paid_amount"), 0)::text AS "outstanding_amount"
       FROM (
         SELECT sp."id", sp."supplier_id", sp."total_amount",
                COALESCE(SUM(payment."amount") FILTER (WHERE payment."status" = $${parameters.length + 1}), 0)::numeric AS "paid_amount",
                COALESCE(SUM(payment."amount") FILTER (WHERE payment."status" = $${parameters.length + 2}), 0)::numeric AS "pending_cheque_amount"
         FROM "stock_purchases" sp
         LEFT JOIN "stock_purchase_payments" payment ON payment."stock_purchase_id" = sp."id"
         ${branchCondition}
         GROUP BY sp."id"
       ) purchase_totals
       GROUP BY "supplier_id"`,
      [...parameters, StockPurchasePaymentStatus.CLEARED, StockPurchasePaymentStatus.PENDING],
    );
  }

  async findOne(
    id: string,
    actor: { role: UserRole; branch_id: string | null },
  ): Promise<StockPurchase> {
    const purchase = await this.purchasesRepository.findOne({
      where: { id },
      relations: [...PURCHASE_RELATIONS],
    });
    if (!purchase) throw new NotFoundException('Stock purchase not found.');
    await this.assertBranchAccess(actor, purchase.branch_id);
    return purchase;
  }

  private async assertBranchAccess(
    actor: { role: UserRole; branch_id: string | null },
    branchId: string,
  ): Promise<void> {
    if (actor.role !== UserRole.ADMIN && actor.branch_id !== branchId) {
      throw new ForbiddenException('You can only record stock purchases for your branch.');
    }
  }

  private assertUniqueIdentifiers(dto: CreateStockPurchaseDto): void {
    const identifiers = dto.items.flatMap((item) =>
      unitIdentifierPairs(item).flatMap((pair) =>
        [pair.imei_number, pair.serial_number].filter(
          (identifier): identifier is string => Boolean(identifier),
        ),
      ),
    );
    if (new Set(identifiers).size !== identifiers.length) {
      throw new BadRequestException(
        'An IMEI or serial number can only appear once in a stock purchase.',
      );
    }
  }

  private async assertSerialsNotPreviouslyReceived(
    manager: EntityManager,
    dto: CreateStockPurchaseDto,
  ): Promise<void> {
    // Advisory locks in product order, so two purchases with the same
    // serial-tracked products in a different order can't deadlock.
    const items = [...dto.items].sort((a, b) =>
      a.product_id.toLowerCase() < b.product_id.toLowerCase()
        ? -1
        : a.product_id.toLowerCase() > b.product_id.toLowerCase()
          ? 1
          : 0,
    );
    for (const item of items) {
      const serials = unitIdentifierPairs(item).flatMap((pair) =>
        pair.serial_number ? [pair.serial_number] : [],
      );
      if (!serials.length) continue;

      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('product-serial'), hashtext($1))`,
        [item.product_id],
      );

      const [existing] = await manager.query(
        `SELECT received.serial_number
           FROM "stock_purchase_items" purchase_item
           CROSS JOIN LATERAL jsonb_array_elements_text(purchase_item."serial_numbers")
             AS received(serial_number)
          WHERE purchase_item."product_id" = $1
            AND received.serial_number = ANY($2::text[])
          LIMIT 1`,
        [item.product_id, serials],
      );
      if (existing) {
        throw new ConflictException(
          `Serial number ${existing.serial_number} was already received for this product.`,
        );
      }
    }
  }
}
