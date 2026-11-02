import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
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
import { AuditAction } from '../audit-log/enums/audit-action.enum';

jest.mock('../stock/lock-inventory-rows');

const ADVISORY_SQL =
  /pg_advisory_xact_lock\(hashtext\('product-serial'\), hashtext\(\$1\)\)/;

/**
 * StockPurchasesService.create: the order its inventory locks are taken
 * in (T0). Serial-number advisory locks, in product order; then the
 * missing Stock rows are created and every Stock row locked, through
 * ensureStockRows and lockInventoryRows (whose own sorting is tested in
 * lock-inventory-rows.spec.ts); all after the identifier checks. The
 * purchase row (the T1c claim) is written before every one of them; its
 * lines, units and stock only after the Stock rows are locked.
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

  const mockAuditSave = jest.fn();
  const mockManager = {
    findOne: jest.fn(),
    query: jest.fn(),
    create: jest.fn(),
    insert: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    getRepository: jest.fn(() => ({ save: mockAuditSave })),
  };
  // Outside the transaction: the client_request_id lookups.
  const mockOuterManager = { findOne: jest.fn() };
  const mockDataSource = {
    manager: mockOuterManager,
    transaction: jest.fn((cb: (m: typeof mockManager) => unknown) =>
      cb(mockManager),
    ),
  };
  const mockRepository = { findOne: jest.fn() };
  const mockStockService = { receivePurchase: jest.fn() };

  const admin = {
    id: 'admin-1',
    full_name: 'Shop Admin',
    role: UserRole.ADMIN,
    branch_id: null,
  };
  const REQUEST_ID = 'dddddddd-0000-4000-8000-000000000004';

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
    client_request_id: REQUEST_ID,
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
    mockManager.insert.mockResolvedValue(undefined);
    mockManager.update.mockResolvedValue(undefined);
    mockAuditSave.mockResolvedValue(undefined);
    // A new client_request_id: nothing recorded with it yet.
    mockOuterManager.findOne.mockResolvedValue(null);
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
    // Only the purchase row (the T1c claim) is written before the locks;
    // its lines, units and stock (with the ledger) come after them.
    expect(mockManager.insert.mock.invocationCallOrder[0]).toBeLessThan(
      ensureOrder,
    );
    for (const save of mockManager.save.mock.invocationCallOrder) {
      expect(lockOrder).toBeLessThan(save);
    }
    for (const receive of mockStockService.receivePurchase.mock
      .invocationCallOrder) {
      expect(lockOrder).toBeLessThan(receive);
    }
  });

  it('writes the purchase row (the T1c claim) first: before any advisory lock, live-identifier check or Stock row', async () => {
    await service.create(
      purchaseOf([
        serialItem(POWER_BANK, 'SN-PB-1'),
        cableItem,
        serialItem(HUB, 'SN-HUB-1'),
      ]),
      admin,
    );

    expect(mockManager.insert).toHaveBeenCalledTimes(1);
    expect(mockManager.insert).toHaveBeenCalledWith(
      StockPurchase,
      expect.objectContaining({
        supplier_id: 'supplier-1',
        branch_id: 'branch-1',
        created_by_id: 'admin-1',
        total_amount: '0.00',
        client_request_id: REQUEST_ID,
      }),
    );
    const claim = mockManager.insert.mock.invocationCallOrder[0];
    const advisories = advisoryCallOrders();
    expect(advisories).toHaveLength(2);
    for (const advisory of advisories) {
      expect(claim).toBeLessThan(advisory);
    }
    const liveCheck = mockManager.findOne.mock.calls.findIndex(
      ([entity]) => entity === ProductUnit,
    );
    expect(claim).toBeLessThan(
      mockManager.findOne.mock.invocationCallOrder[liveCheck],
    );
    expect(claim).toBeLessThan(
      jest.mocked(ensureStockRows).mock.invocationCallOrder[0],
    );
    expect(claim).toBeLessThan(
      jest.mocked(lockInventoryRows).mock.invocationCallOrder[0],
    );
    // Nothing else is written before it.
    for (const write of [
      ...mockManager.save.mock.invocationCallOrder,
      ...mockManager.update.mock.invocationCallOrder,
    ]) {
      expect(claim).toBeLessThan(write);
    }
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

  /**
   * client_request_id (Phase 1 T1c): a resend by the same user is answered
   * from the recorded purchase, without a transaction; anyone else's id is
   * 409; a clash on the claim (a resend sent at the same moment) is
   * answered the same way once the other request has committed.
   */
  describe('client_request_id (T1c)', () => {
    const recordedPurchase = {
      id: 'purchase-1',
      branch_id: 'branch-1',
    };
    const claimClash = () =>
      new QueryFailedError('INSERT', [], {
        code: '23505',
        constraint: 'UQ_stock_purchases_client_request_id',
      } as unknown as Error);
    const conflictBody = async (promise: Promise<unknown>) => {
      const err = (await promise.catch((e: unknown) => e)) as ConflictException;
      expect(err).toBeInstanceOf(ConflictException);
      return err.getResponse();
    };

    it('records a new purchase: created, one CREATE audit row written in the transaction, after the stock', async () => {
      const result = await service.create(
        purchaseOf([serialItem(HUB, 'SN-HUB-1'), cableItem]),
        admin,
        '10.0.0.7',
      );

      expect(result.created).toBe(true);
      expect(result.purchase).toEqual(recordedPurchase);
      const [[, claimed]] = mockManager.insert.mock.calls as [
        unknown,
        { id: string },
      ][];
      const id = claimed.id;
      expect(mockRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id } }),
      );
      expect(mockOuterManager.findOne).toHaveBeenCalledWith(StockPurchase, {
        where: { client_request_id: REQUEST_ID },
        select: { id: true, created_by_id: true },
      });

      expect(mockAuditSave).toHaveBeenCalledTimes(1);
      expect(mockAuditSave).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'admin-1',
          user_name: 'Shop Admin',
          action: AuditAction.CREATE,
          entity_type: 'StockPurchase',
          entity_id: id,
          ip_address: '10.0.0.7',
          changes: {
            total_amount: { old: null, new: '500.00' },
            initial_payment: { old: null, new: null },
          },
        }),
      );
      // Through the transaction's manager, after the last stock change.
      expect(mockManager.getRepository).toHaveBeenCalled();
      const receives =
        mockStockService.receivePurchase.mock.invocationCallOrder;
      expect(mockAuditSave.mock.invocationCallOrder[0]).toBeGreaterThan(
        receives[receives.length - 1],
      );
    });

    it('records the initial payment amount in the CREATE audit row', async () => {
      await service.create(
        {
          ...purchaseOf([cableItem]),
          initial_payment: { amount: '150', method: 'CASH' } as never,
        },
        admin,
      );

      expect(mockAuditSave).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            total_amount: { old: null, new: '400.00' },
            initial_payment: { old: null, new: '150.00' },
          },
        }),
      );
    });

    it("replays the same user's recorded purchase without a transaction, whatever the body", async () => {
      mockOuterManager.findOne.mockResolvedValue({
        id: 'purchase-1',
        created_by_id: 'admin-1',
      });
      // Even a body that would now fail validation: a replay doesn't check it.
      products[HUB].is_active = false;
      try {
        const result = await service.create(
          purchaseOf([serialItem(HUB, 'SN-OTHER')]),
          admin,
        );

        expect(result).toEqual({ created: false, purchase: recordedPurchase });
        expect(mockRepository.findOne).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'purchase-1' } }),
        );
      } finally {
        products[HUB].is_active = true;
      }
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
      expect(mockManager.insert).not.toHaveBeenCalled();
      expect(mockStockService.receivePurchase).not.toHaveBeenCalled();
      expect(mockAuditSave).not.toHaveBeenCalled();
    });

    it("answers another user's request id with 409 CLIENT_REQUEST_ID_CONFLICT, revealing nothing", async () => {
      mockOuterManager.findOne.mockResolvedValue({
        id: 'purchase-1',
        created_by_id: 'manager-2',
      });

      const body = await conflictBody(
        service.create(purchaseOf([cableItem]), admin),
      );

      expect(body).toEqual({
        message:
          'This request id was already used for another purchase. ' +
          'Start the purchase again.',
        code: 'CLIENT_REQUEST_ID_CONFLICT',
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
      expect(mockRepository.findOne).not.toHaveBeenCalled();
      expect(mockAuditSave).not.toHaveBeenCalled();
    });

    it('answers a clash on the claim from the purchase the other request committed', async () => {
      mockOuterManager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'purchase-1', created_by_id: 'admin-1' });
      mockManager.insert.mockRejectedValueOnce(claimClash());

      const result = await service.create(purchaseOf([cableItem]), admin);

      expect(result).toEqual({ created: false, purchase: recordedPurchase });
      expect(mockOuterManager.findOne).toHaveBeenCalledTimes(2);
      // The clash stops it at the claim: no lock, no stock, no audit row.
      expect(advisoryCallOrders()).toEqual([]);
      expect(ensureStockRows).not.toHaveBeenCalled();
      expect(lockInventoryRows).not.toHaveBeenCalled();
      expect(mockStockService.receivePurchase).not.toHaveBeenCalled();
      expect(mockAuditSave).not.toHaveBeenCalled();
    });

    it("answers a clash with another user's committed purchase with 409", async () => {
      mockOuterManager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'purchase-1',
          created_by_id: 'manager-2',
        });
      mockManager.insert.mockRejectedValueOnce(claimClash());

      const body = await conflictBody(
        service.create(purchaseOf([cableItem]), admin),
      );

      expect(body).toEqual(
        expect.objectContaining({ code: 'CLIENT_REQUEST_ID_CONFLICT' }),
      );
      expect(mockRepository.findOne).not.toHaveBeenCalled();
    });

    it('rethrows any other unique violation unchanged, without a second lookup', async () => {
      const unitClash = new QueryFailedError('INSERT', [], {
        code: '23505',
        constraint: 'UQ_stock_purchase_items_product',
      } as unknown as Error);
      mockManager.save.mockRejectedValueOnce(unitClash);

      await expect(service.create(purchaseOf([cableItem]), admin)).rejects.toBe(
        unitClash,
      );
      expect(mockOuterManager.findOne).toHaveBeenCalledTimes(1);
      expect(mockAuditSave).not.toHaveBeenCalled();
    });

    it('rethrows the clash if no purchase is found for it', async () => {
      const clash = claimClash();
      mockManager.insert.mockRejectedValueOnce(clash);

      await expect(service.create(purchaseOf([cableItem]), admin)).rejects.toBe(
        clash,
      );
      expect(mockOuterManager.findOne).toHaveBeenCalledTimes(2);
    });
  });
});
