import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { StockPurchasesService } from './stock-purchases.service';
import { StockPurchase } from './entities/stock-purchase.entity';
import { StockService } from '../stock/stock.service';
import {
  ensureStockRows,
  lockInventoryRows,
} from '../stock/lock-inventory-rows';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { Branch } from '../branches/entities/branch.entity';
import { Product } from '../products/entities/product.entity';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { TrackingMethod } from '../products/enums/tracking-method.enum';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';

jest.mock('../stock/lock-inventory-rows');

const ADVISORY_SQL =
  /pg_advisory_xact_lock\(hashtext\('product-serial'\), hashtext\(\$1\)\)/;

/**
 * StockPurchasesService.create: the order its inventory locks are taken
 * in (T0). Serial-number advisory locks, in product order; then the
 * missing Stock rows are created and every Stock row locked, through
 * ensureStockRows and lockInventoryRows (whose own sorting is tested in
 * lock-inventory-rows.spec.ts); all after the identifier checks.
 */
describe('StockPurchasesService (inventory lock order)', () => {
  let service: StockPurchasesService;

  const products: Record<string, Partial<Product>> = {
    'aaaaaaaa-0000-4000-8000-000000000001': {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      name: 'UGREEN Hub',
      sku: 'SKU-HUB',
      is_active: true,
      tracking_method: TrackingMethod.SERIAL_NUMBER,
      is_serialized: true,
      selling_price: '9000.00',
    },
    'bbbbbbbb-0000-4000-8000-000000000002': {
      id: 'bbbbbbbb-0000-4000-8000-000000000002',
      name: 'Anker Power Bank',
      sku: 'SKU-PB',
      is_active: true,
      tracking_method: TrackingMethod.SERIAL_NUMBER,
      is_serialized: true,
      selling_price: '12000.00',
    },
    'cccccccc-0000-4000-8000-000000000003': {
      id: 'cccccccc-0000-4000-8000-000000000003',
      name: 'UGREEN Cable',
      sku: 'SKU-CABLE',
      is_active: true,
      tracking_method: TrackingMethod.QUANTITY,
      is_serialized: false,
      selling_price: '1500.00',
    },
  };
  const [HUB, POWER_BANK, CABLE] = Object.keys(products);

  const mockManager = {
    findOne: jest.fn(),
    query: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const mockDataSource = {
    transaction: jest.fn((cb: (m: typeof mockManager) => unknown) =>
      cb(mockManager),
    ),
  };
  const mockRepository = { findOne: jest.fn() };
  const mockStockService = { receivePurchase: jest.fn() };

  const admin = { id: 'admin-1', role: UserRole.ADMIN, branch_id: null };

  const serialItem = (productId: string, serial: string) => ({
    product_id: productId,
    quantity: 1,
    unit_buying_price: '100.00',
    unit_identifiers: [{ serial_number: serial }],
  });
  const cableItem = {
    product_id: CABLE,
    quantity: 4,
    unit_buying_price: '100.00',
  };
  const purchaseOf = (
    items: CreateStockPurchaseDto['items'],
  ): CreateStockPurchaseDto => ({
    supplier_id: 'supplier-1',
    branch_id: 'branch-1',
    items,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockManager.findOne.mockImplementation(
      (entity: unknown, options: { where: { id?: string } }) => {
        if (entity === Supplier || entity === Branch) {
          return Promise.resolve({ id: options.where.id, is_active: true });
        }
        if (entity === Product) {
          return Promise.resolve(products[options.where.id!] ?? null);
        }
        // ProductUnit: no live unit holds any of the identifiers.
        return Promise.resolve(null);
      },
    );
    mockManager.query.mockResolvedValue([]);
    mockManager.create.mockImplementation((_entity: unknown, data: object) => ({
      ...data,
    }));
    mockManager.save.mockImplementation((data: object) =>
      Promise.resolve(data),
    );
    mockManager.update.mockResolvedValue(undefined);
    mockStockService.receivePurchase.mockResolvedValue(undefined);
    mockRepository.findOne.mockResolvedValue({
      id: 'purchase-1',
      branch_id: 'branch-1',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockPurchasesService,
        {
          provide: getRepositoryToken(StockPurchase),
          useValue: mockRepository,
        },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: StockService, useValue: mockStockService },
      ],
    }).compile();
    service = module.get(StockPurchasesService);
  });

  /** The product ids the advisory locks were taken for, in order. */
  const advisoryLockedProducts = (): string[] =>
    (mockManager.query.mock.calls as [string, unknown[]][])
      .filter(([sql]) => ADVISORY_SQL.test(sql))
      .map(([, params]) => params[0] as string);

  const advisoryCallOrders = (): number[] =>
    (mockManager.query.mock.calls as [string][])
      .map(([sql], index) => ({ sql, index }))
      .filter(({ sql }) => ADVISORY_SQL.test(sql))
      .map(({ index }) => mockManager.query.mock.invocationCallOrder[index]);

  it('takes the serial-number advisory locks in ascending product order, whatever the line order', async () => {
    await service.create(
      purchaseOf([
        serialItem(POWER_BANK, 'SN-PB-1'),
        cableItem,
        serialItem(HUB, 'SN-HUB-1'),
      ]),
      admin,
    );
    const forward = advisoryLockedProducts();

    jest.clearAllMocks();
    await service.create(
      purchaseOf([
        serialItem(HUB, 'SN-HUB-1'),
        cableItem,
        serialItem(POWER_BANK, 'SN-PB-1'),
      ]),
      admin,
    );
    const reversed = advisoryLockedProducts();

    // Only serial-tracked lines take one; the key is hashtext(product id),
    // computed by Postgres from this parameter.
    expect(forward).toEqual([HUB, POWER_BANK]);
    expect(reversed).toEqual(forward);
  });

  it('creates the missing Stock rows, then locks every Stock row, for every line, after the advisory locks', async () => {
    await service.create(
      purchaseOf([
        serialItem(POWER_BANK, 'SN-PB-1'),
        cableItem,
        serialItem(HUB, 'SN-HUB-1'),
      ]),
      admin,
    );

    const targets = [
      { productId: POWER_BANK, branchId: 'branch-1' },
      { productId: CABLE, branchId: 'branch-1' },
      { productId: HUB, branchId: 'branch-1' },
    ];
    const ensureMock = jest.mocked(ensureStockRows);
    const lockMock = jest.mocked(lockInventoryRows);
    expect(ensureMock).toHaveBeenCalledTimes(1);
    expect(ensureMock).toHaveBeenCalledWith(mockManager, targets);
    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(lockMock).toHaveBeenCalledWith(mockManager, { stock: targets });

    const ensureOrder = ensureMock.mock.invocationCallOrder[0];
    const lockOrder = lockMock.mock.invocationCallOrder[0];
    for (const advisory of advisoryCallOrders()) {
      expect(advisory).toBeLessThan(ensureOrder);
    }
    expect(ensureOrder).toBeLessThan(lockOrder);
    // Before anything is written or any stock is added.
    expect(lockOrder).toBeLessThan(
      mockManager.save.mock.invocationCallOrder[0],
    );
    expect(lockOrder).toBeLessThan(
      mockStockService.receivePurchase.mock.invocationCallOrder[0],
    );
  });

  it('checks for live identifiers before creating or locking any Stock row', async () => {
    await service.create(purchaseOf([serialItem(HUB, 'SN-HUB-1')]), admin);

    const liveCheck = mockManager.findOne.mock.calls.findIndex(
      ([entity]) => entity === ProductUnit,
    );
    expect(liveCheck).toBeGreaterThanOrEqual(0);
    const liveCheckOrder =
      mockManager.findOne.mock.invocationCallOrder[liveCheck];
    expect(liveCheckOrder).toBeLessThan(
      jest.mocked(ensureStockRows).mock.invocationCallOrder[0],
    );
  });

  it('creates and locks no Stock row when an identifier is already on a live unit', async () => {
    mockManager.findOne.mockImplementation(
      (entity: unknown, options: { where: { id?: string } }) => {
        if (entity === ProductUnit) {
          return Promise.resolve({
            id: 'unit-9',
            product_id: HUB,
            status: ProductUnitStatus.IN_STOCK,
            imei_number: null,
            serial_number: 'SN-HUB-1',
          });
        }
        if (entity === Product) {
          return Promise.resolve(products[options.where.id!]);
        }
        return Promise.resolve({ id: options.where.id, is_active: true });
      },
    );

    await expect(
      service.create(purchaseOf([serialItem(HUB, 'SN-HUB-1')]), admin),
    ).rejects.toThrow(ConflictException);
    expect(ensureStockRows).not.toHaveBeenCalled();
    expect(lockInventoryRows).not.toHaveBeenCalled();
    expect(mockStockService.receivePurchase).not.toHaveBeenCalled();
  });

  it('creates and locks no Stock row when the purchase repeats an identifier', async () => {
    await expect(
      service.create(
        purchaseOf([
          serialItem(HUB, 'SN-SAME'),
          serialItem(POWER_BANK, 'SN-SAME'),
        ]),
        admin,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(advisoryLockedProducts()).toEqual([]);
    expect(ensureStockRows).not.toHaveBeenCalled();
    expect(lockInventoryRows).not.toHaveBeenCalled();
  });

  it('creates and locks no Stock row when a serial number was received before', async () => {
    mockManager.query.mockImplementation((sql: string) =>
      Promise.resolve(
        /jsonb_array_elements_text/.test(sql)
          ? [{ serial_number: 'SN-HUB-1' }]
          : [],
      ),
    );

    await expect(
      service.create(purchaseOf([serialItem(HUB, 'SN-HUB-1')]), admin),
    ).rejects.toThrow(ConflictException);
    expect(ensureStockRows).not.toHaveBeenCalled();
    expect(lockInventoryRows).not.toHaveBeenCalled();
  });
});
