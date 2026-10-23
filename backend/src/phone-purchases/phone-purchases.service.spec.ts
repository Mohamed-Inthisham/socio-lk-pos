import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PhonePurchasesService } from './phone-purchases.service';
import { PhonePurchase } from './entities/phone-purchase.entity';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { StockService } from '../stock/stock.service';
import { EntityManager, In, QueryFailedError } from 'typeorm';
import { lockInventoryRows } from '../stock/lock-inventory-rows';

// The global lock order's helper takes its own queries on the manager;
// mocked so the per-call manager mocks below stay exact (Phase 6.4 P7-25).
jest.mock('../stock/lock-inventory-rows');

// A Postgres unique violation (23505) on the named index/constraint, as
// TypeORM surfaces it.
const uniqueViolation = (constraint: string) =>
  new QueryFailedError(
    'INSERT INTO "product_units" ...',
    [],
    Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint,
    }),
  );

describe('PhonePurchasesService', () => {
  let service: PhonePurchasesService;

  // Mock manager for transaction operations. findOne is dispatched by
  // entity class — tests configure it per-call via mockResolvedValueOnce
  // to simulate specific lookup outcomes.
  const mockManager = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn(),
  };

  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };

  const mockRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockStockService = {
    incrementForReversal: jest.fn(),
  };

  // Reusable seed helpers. Kept inline (not in a shared file) because
  // Slice D is the only current caller.
  const validCashier = () => ({
    id: 'cashier-1',
    branch_id: 'branch-1',
  });

  const adminCashier = () => ({
    id: 'admin-1',
    branch_id: null,
  });

  const validCustomer = () => ({
    id: 'cust-1',
    name: 'Kamal Perera',
    phone: '0771234567',
    // A phone purchase needs the seller's NIC (P4-13)
    nic: '199012345678',
    deleted_at: null,
  });

  const validBranch = () => ({
    id: 'branch-1',
    name: 'Main',
    is_active: true,
  });

  const validSerializedProduct = () => ({
    id: 'prod-1',
    name: 'Used iPhone 12 Pro Max 256GB',
    branch_id: 'branch-1',
    is_serialized: true,
    is_active: true,
  });

  const validCreateDto = () => ({
    customer_id: 'cust-1',
    branch_id: 'branch-1',
    product_id: 'prod-1',
    imei: '356938035643809',
    buying_price: 80000,
    selling_price: 100000,
    notes: 'Screen scratch top-right',
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    mockQueryBuilder.leftJoinAndSelect.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();
    mockQueryBuilder.orderBy.mockReturnThis();
    mockQueryBuilder.skip.mockReturnThis();
    mockQueryBuilder.take.mockReturnThis();
    mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    // Default transaction behavior: invoke callback with mockManager.
    // Individual tests can override with mockImplementationOnce.
    mockDataSource.transaction.mockImplementation(
      (cb: (m: typeof mockManager) => unknown) => cb(mockManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhonePurchasesService,
        { provide: getRepositoryToken(PhonePurchase), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: StockService, useValue: mockStockService },
      ],
    }).compile();

    service = module.get<PhonePurchasesService>(PhonePurchasesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---- create (the transaction) ----

  describe('create', () => {
    // Configure the standard happy-path lookup sequence:
    //   1. cashier (User)
    //   2. customer (Customer)
    //   3. branch (Branch)
    //   4. product (Product)
    //   5. IMEI check (ProductUnit) — returns null (no conflict)
    // Tests can override individual steps via additional
    // mockResolvedValueOnce chains before calling create.
    const setupHappyPathLookups = (overrides?: {
      cashier?: unknown;
      customer?: unknown;
      branch?: unknown;
      product?: unknown;
      existingUnit?: unknown;
    }) => {
      const pick = <T>(key: string, fallback: T): unknown =>
        overrides && key in overrides
          ? (overrides as Record<string, unknown>)[key]
          : fallback;

      mockManager.findOne
        .mockResolvedValueOnce(pick('cashier', validCashier()))
        .mockResolvedValueOnce(pick('customer', validCustomer()))
        .mockResolvedValueOnce(pick('branch', validBranch()))
        .mockResolvedValueOnce(pick('product', validSerializedProduct()))
        .mockResolvedValueOnce(pick('existingUnit', null));
    };

    it('creates PhonePurchase + ProductUnit + increments Stock in one transaction', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_entity, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-1', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      // findOne after transaction commits — hydrated re-read
      mockRepo.findOne.mockResolvedValue({
        id: 'purchase-1',
        customer_id: 'cust-1',
      });

      const result = await service.create(validCreateDto(), 'cashier-1');

      // PhonePurchase row created with correct shape
      expect(mockManager.create).toHaveBeenCalledWith(
        PhonePurchase,
        expect.objectContaining({
          customer_id: 'cust-1',
          branch_id: 'branch-1',
          cashier_id: 'cashier-1',
          total_amount: '80000.00',
          notes: 'Screen scratch top-right',
        }),
      );

      // ProductUnit row created with correct shape
      expect(mockManager.create).toHaveBeenCalledWith(
        ProductUnit,
        expect.objectContaining({
          product_id: 'prod-1',
          branch_id: 'branch-1',
          imei: '356938035643809',
          status: ProductUnitStatus.IN_STOCK,
          buying_price: '80000.00',
          selling_price: '100000.00',
        }),
      );

      // Stock incremented via StockService with the transaction manager
      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        mockManager,
        'prod-1',
        'branch-1',
        1,
      );

      // Post-commit fresh read for hydrated response
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'purchase-1' },
        relations: expect.arrayContaining([
          'customer',
          'branch',
          'cashier',
          'product_units',
        ]),
      });

      expect(result.id).toBe('purchase-1');
    });

    it('stores selling_price as null when omitted from the DTO', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-2', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockRepo.findOne.mockResolvedValue({ id: 'purchase-2' });

      const dto = validCreateDto();
      delete (dto as Partial<typeof dto>).selling_price;

      await service.create(dto, 'cashier-1');

      expect(mockManager.create).toHaveBeenCalledWith(
        ProductUnit,
        expect.objectContaining({ selling_price: null }),
      );
    });

    it('stores notes as null when omitted from the DTO', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-3', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockRepo.findOne.mockResolvedValue({ id: 'purchase-3' });

      const dto = validCreateDto();
      delete (dto as Partial<typeof dto>).notes;

      await service.create(dto, 'cashier-1');

      expect(mockManager.create).toHaveBeenCalledWith(
        PhonePurchase,
        expect.objectContaining({ notes: null }),
      );
    });

    it('rounds buying_price to 2 decimal places on storage', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-4', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockRepo.findOne.mockResolvedValue({ id: 'purchase-4' });

      await service.create(
        { ...validCreateDto(), buying_price: 80000 },
        'cashier-1',
      );

      // 80000 → "80000.00"
      expect(mockManager.create).toHaveBeenCalledWith(
        PhonePurchase,
        expect.objectContaining({ total_amount: '80000.00' }),
      );
      expect(mockManager.create).toHaveBeenCalledWith(
        ProductUnit,
        expect.objectContaining({ buying_price: '80000.00' }),
      );
    });

    it('allows admin (branch_id = null) to intake at any branch', async () => {
      setupHappyPathLookups({ cashier: adminCashier() });
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-5', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockRepo.findOne.mockResolvedValue({ id: 'purchase-5' });

      await service.create(validCreateDto(), 'admin-1');

      expect(mockStockService.incrementForReversal).toHaveBeenCalled();
    });

    // ---- Failure paths ----

    it('throws NotFoundException when cashier not found (edge case)', async () => {
      mockManager.findOne.mockResolvedValueOnce(null); // cashier lookup

      await expect(
        service.create(validCreateDto(), 'cashier-missing'),
      ).rejects.toThrow(NotFoundException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when non-admin cashier intakes at different branch', async () => {
      mockManager.findOne.mockResolvedValueOnce({
        id: 'cashier-1',
        branch_id: 'branch-2', // different from dto.branch_id ('branch-1')
      });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when customer_id not found', async () => {
      setupHappyPathLookups({ customer: null });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the customer has no NIC (P4-13), before any write', async () => {
      setupHappyPathLookups({ customer: { ...validCustomer(), nic: null } });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow("A phone purchase needs the customer's NIC");
      expect(mockManager.save).not.toHaveBeenCalled();
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when branch_id not found', async () => {
      setupHappyPathLookups({ branch: null });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when branch is inactive', async () => {
      setupHappyPathLookups({
        branch: { ...validBranch(), is_active: false },
      });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when product not found', async () => {
      setupHappyPathLookups({ product: null });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when product belongs to different branch', async () => {
      setupHappyPathLookups({
        product: { ...validSerializedProduct(), branch_id: 'branch-99' },
      });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when product is not serialized', async () => {
      setupHappyPathLookups({
        product: { ...validSerializedProduct(), is_serialized: false },
      });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws ConflictException with existing_unit payload when IMEI collides', async () => {
      // Buy-back: only a unit the shop holds collides (SOLD no longer does).
      const existingUnit = {
        id: 'unit-99',
        status: ProductUnitStatus.IN_STOCK,
        product_id: 'prod-old',
      };
      setupHappyPathLookups({ existingUnit });

      try {
        await service.create(validCreateDto(), 'cashier-1');
        fail('Expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse() as {
          message: string;
          existing_unit: { id: string; status: string; product_id: string };
        };
        expect(response.existing_unit).toEqual({
          id: 'unit-99',
          status: ProductUnitStatus.IN_STOCK,
          product_id: 'prod-old',
        });
      }
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('checks IMEI collisions against live units only (IN_STOCK, WRITTEN_OFF)', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-live', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockRepo.findOne.mockResolvedValue({ id: 'purchase-live' });

      await service.create(validCreateDto(), 'cashier-1');

      expect(mockManager.findOne).toHaveBeenCalledWith(ProductUnit, {
        where: {
          imei: '356938035643809',
          status: In([
            ProductUnitStatus.IN_STOCK,
            ProductUnitStatus.WRITTEN_OFF,
          ]),
        },
      });
    });

    it('throws BadRequestException when product is inactive', async () => {
      setupHappyPathLookups({
        product: { ...validSerializedProduct(), is_active: false },
      });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow('Product "Used iPhone 12 Pro Max 256GB" is inactive');
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('keeps the id in the message when the product does not exist', async () => {
      setupHappyPathLookups({ product: null });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow('Product prod-1 not found or inactive');
    });

    it('maps a concurrent live-IMEI unique violation on the unit insert to 409', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e: { imei?: string }) =>
        e.imei
          ? Promise.reject(uniqueViolation('uq_product_units_imei_live'))
          : Promise.resolve({ id: 'purchase-race', ...e }),
      );

      try {
        await service.create(validCreateDto(), 'cashier-1');
        fail('Expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).getResponse()).toEqual({
          message: 'IMEI already exists in inventory',
          imei: '356938035643809',
          existing_unit: null,
        });
      }
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('propagates other database errors from the unit insert unchanged', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      const other = uniqueViolation('PK_product_units_id');
      mockManager.save.mockImplementation((e: { imei?: string }) =>
        e.imei
          ? Promise.reject(other)
          : Promise.resolve({ id: 'purchase-other', ...e }),
      );

      await expect(service.create(validCreateDto(), 'cashier-1')).rejects.toBe(
        other,
      );
    });

    it('propagates errors from stock increment (data integrity failure rolls back)', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-x', ...e }),
      );
      mockStockService.incrementForReversal.mockRejectedValue(
        new Error('Stock row missing for product prod-1 at branch branch-1'),
      );

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow(
        'Stock row missing for product prod-1 at branch branch-1',
      );
      // Post-commit findOne should not have fired
      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });

    it('passes the transaction manager to StockService.incrementForReversal', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-6', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockRepo.findOne.mockResolvedValue({ id: 'purchase-6' });

      await service.create(validCreateDto(), 'cashier-1');

      const firstArg = mockStockService.incrementForReversal.mock.calls[0][0];
      expect(firstArg).toBe(mockManager);
    });

    it('locks the stock row after the IMEI pre-check and before any insert (P7-25)', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-7', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockRepo.findOne.mockResolvedValue({ id: 'purchase-7' });

      await service.create(validCreateDto(), 'cashier-1');

      const lockMock = jest.mocked(lockInventoryRows);
      expect(lockMock).toHaveBeenCalledTimes(1);
      expect(lockMock).toHaveBeenCalledWith(mockManager, {
        stock: [{ productId: 'prod-1', branchId: 'branch-1' }],
      });
      const lockOrder = lockMock.mock.invocationCallOrder[0];
      // The 5th findOne is the IMEI pre-check.
      expect(mockManager.findOne.mock.invocationCallOrder[4]).toBeLessThan(
        lockOrder,
      );
      expect(lockOrder).toBeLessThan(
        mockManager.save.mock.invocationCallOrder[0],
      );
    });

    it('takes no lock when the IMEI pre-check refuses (P7-25)', async () => {
      setupHappyPathLookups({
        existingUnit: {
          id: 'unit-9',
          status: ProductUnitStatus.IN_STOCK,
          product_id: 'prod-1',
        },
      });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).rejects.toThrow(ConflictException);
      expect(lockInventoryRows).not.toHaveBeenCalled();
    });
  });

  // ---- createForTradeIn ----

  describe('createForTradeIn', () => {
    const tradeInInput = () => ({
      customer_id: 'cust-1',
      branch_id: 'branch-1',
      cashier_id: 'cashier-1',
      product_id: 'prod-1',
      imei: '356938035643809',
      buying_price: '60000.00',
      selling_price: null,
      notes: null,
    });

    it('locks the stock row after the IMEI pre-check and before any insert (P7-25)', async () => {
      mockManager.findOne
        .mockResolvedValueOnce(validSerializedProduct())
        .mockResolvedValueOnce(null);
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'saved-1', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      await service.createForTradeIn(
        mockManager as unknown as EntityManager,
        tradeInInput(),
      );

      const lockMock = jest.mocked(lockInventoryRows);
      expect(lockMock).toHaveBeenCalledTimes(1);
      expect(lockMock).toHaveBeenCalledWith(mockManager, {
        stock: [{ productId: 'prod-1', branchId: 'branch-1' }],
      });
      const lockOrder = lockMock.mock.invocationCallOrder[0];
      expect(mockManager.findOne.mock.invocationCallOrder[1]).toBeLessThan(
        lockOrder,
      );
      expect(lockOrder).toBeLessThan(
        mockManager.save.mock.invocationCallOrder[0],
      );
    });
  });

  // ---- findAll ----

  describe('findAll', () => {
    it('returns paginated results with default page and limit', async () => {
      const purchases = [
        { id: 'p-1', customer_id: 'cust-1' },
        { id: 'p-2', customer_id: 'cust-2' },
      ];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([purchases, 2]);

      const result = await service.findAll({});

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(50);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'purchase.created_at',
        'DESC',
      );
      expect(result).toEqual({
        data: purchases,
        meta: {
          total: 2,
          page: 1,
          limit: 50,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });
    });

    it('applies pagination correctly on page 2 with custom limit', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 2, limit: 20 });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(20);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
    });

    it('filters by customer_id when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ customer_id: 'cust-42' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'purchase.customer_id = :customerId',
        { customerId: 'cust-42' },
      );
    });

    it('filters by branchId when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ branchId: 'branch-7' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'purchase.branch_id = :branchId',
        { branchId: 'branch-7' },
      );
    });

    it('combines customer_id and branchId filters with AND', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({
        customer_id: 'cust-42',
        branchId: 'branch-7',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'purchase.customer_id = :customerId',
        { customerId: 'cust-42' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'purchase.branch_id = :branchId',
        { branchId: 'branch-7' },
      );
    });

    it('does not apply filters when none provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('joins customer, branch, cashier, and product_units for hydrated results', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'purchase.customer',
        'customer',
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'purchase.branch',
        'branch',
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'purchase.cashier',
        'cashier',
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'purchase.product_units',
        'product_units',
      );
    });

    it('reports correct pagination metadata for multi-page results', async () => {
      const purchases = Array.from({ length: 50 }, (_, i) => ({
        id: `p-${i}`,
      }));
      mockQueryBuilder.getManyAndCount.mockResolvedValue([purchases, 173]);

      const result = await service.findAll({ page: 2, limit: 50 });

      expect(result.meta).toEqual({
        total: 173,
        page: 2,
        limit: 50,
        totalPages: 4,
        hasNext: true,
        hasPrev: true,
      });
    });
  });

  // ---- findOne ----

  describe('findOne', () => {
    it('returns the purchase with all relations hydrated', async () => {
      const purchase = {
        id: 'p-1',
        customer: { id: 'c-1', name: 'Kamal' },
        branch: { id: 'b-1' },
        cashier: { id: 'user-1' },
        product_units: [{ id: 'u-1' }],
      };
      mockRepo.findOne.mockResolvedValue(purchase);

      const result = await service.findOne('p-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'p-1' },
        relations: expect.arrayContaining([
          'customer',
          'branch',
          'cashier',
          'product_units',
        ]),
      });
      expect(result).toBe(purchase);
    });

    it('throws NotFoundException when the purchase does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('p-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- Validation helper edge cases ----
  //
  // The happy paths and common failures are exercised via `create`
  // tests above. This block covers the specific edge cases each
  // helper is responsible for, in isolation from the full transaction
  // orchestration.

  // ---- createForTradeIn (manager-enlisted trade-in materialization) ----

  describe('createForTradeIn', () => {
    // Reusable input shape — matches the entity-string types (buying_price
    // and selling_price come off the Payment row as numeric strings).
    const validInput = (): {
      customer_id: string;
      branch_id: string;
      cashier_id: string;
      product_id: string;
      imei: string;
      buying_price: string;
      selling_price: string | null;
      notes: string | null;
    } => ({
      customer_id: 'cust-1',
      branch_id: 'branch-1',
      cashier_id: 'cashier-1',
      product_id: 'prod-1',
      imei: '356938035643809',
      buying_price: '60000.00',
      selling_price: '75000.00',
      notes: 'Trade-in against new phone',
    });

    // Configure the lookup sequence for createForTradeIn (only 2 reads):
    //   1. product (Product) — via assertProductReference
    //   2. IMEI check (ProductUnit) — via assertImeiAvailable
    // No cashier / customer / branch reads (those are the parent Sale's
    // responsibility per the design docstring).
    const setupHappyPathLookups = (overrides?: {
      product?: unknown;
      existingUnit?: unknown;
    }) => {
      const pick = <T>(key: string, fallback: T): unknown =>
        overrides && key in overrides
          ? (overrides as Record<string, unknown>)[key]
          : fallback;

      mockManager.findOne
        .mockResolvedValueOnce(pick('product', validSerializedProduct()))
        .mockResolvedValueOnce(pick('existingUnit', null));
    };

    it('creates PhonePurchase + ProductUnit + increments Stock via the caller manager', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_entity, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({
          id: e.imei ? 'unit-1' : 'purchase-1',
          ...e,
        }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      const result = await service.createForTradeIn(
        mockManager as never,
        validInput(),
      );

      // PhonePurchase created with correct shape. buying_price comes
      // in already as a numeric string from the Payment row, so
      // total_amount is stored as-is without .toFixed() reformatting.
      expect(mockManager.create).toHaveBeenCalledWith(
        PhonePurchase,
        expect.objectContaining({
          customer_id: 'cust-1',
          branch_id: 'branch-1',
          cashier_id: 'cashier-1',
          total_amount: '60000.00',
          notes: 'Trade-in against new phone',
        }),
      );

      // ProductUnit created IN_STOCK, linked to the (mocked) purchase id
      expect(mockManager.create).toHaveBeenCalledWith(
        ProductUnit,
        expect.objectContaining({
          product_id: 'prod-1',
          branch_id: 'branch-1',
          imei: '356938035643809',
          status: ProductUnitStatus.IN_STOCK,
          buying_price: '60000.00',
          selling_price: '75000.00',
          phone_purchase_id: 'purchase-1',
        }),
      );

      // Stock incremented via the caller's manager (enlistment proof)
      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        mockManager,
        'prod-1',
        'branch-1',
        1,
      );

      // Returned shape gives caller both the PP (for stamping) and PU
      // (for potential future use / logging)
      expect(result.phone_purchase).toEqual(
        expect.objectContaining({ id: 'purchase-1' }),
      );
      expect(result.product_unit).toEqual(
        expect.objectContaining({ id: 'unit-1' }),
      );
    });

    it('passes null through for selling_price and notes when the input has them null', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: e.imei ? 'unit-2' : 'purchase-2', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      await service.createForTradeIn(mockManager as never, {
        ...validInput(),
        selling_price: null,
        notes: null,
      });

      // Notes null goes to PhonePurchase
      expect(mockManager.create).toHaveBeenCalledWith(
        PhonePurchase,
        expect.objectContaining({ notes: null }),
      );
      // selling_price null goes to ProductUnit
      expect(mockManager.create).toHaveBeenCalledWith(
        ProductUnit,
        expect.objectContaining({ selling_price: null }),
      );
    });

    it('throws ConflictException with existing_unit payload on IMEI collision', async () => {
      // Cross-DRAFT race arbiter behavior: the pre-check inside
      // createForTradeIn returns 409 (best-effort UX);
      // uq_product_units_imei_live backstops any race that leaks through.
      // Only a live unit collides (buy-back: SOLD no longer does).
      const existingUnit = {
        id: 'unit-99',
        status: ProductUnitStatus.IN_STOCK,
        product_id: 'prod-old',
      };
      setupHappyPathLookups({ existingUnit });

      try {
        await service.createForTradeIn(mockManager as never, validInput());
        fail('Expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse() as {
          message: string;
          existing_unit: { id: string; status: string; product_id: string };
        };
        expect(response.existing_unit).toEqual({
          id: 'unit-99',
          status: ProductUnitStatus.IN_STOCK,
          product_id: 'prod-old',
        });
      }

      // Full rollback proof: no PP/PU created, no Stock touched
      expect(mockManager.create).not.toHaveBeenCalled();
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when product is not serialized (defensive: addPayment should have caught it)', async () => {
      setupHappyPathLookups({
        product: { ...validSerializedProduct(), is_serialized: false },
      });

      await expect(
        service.createForTradeIn(mockManager as never, validInput()),
      ).rejects.toThrow(BadRequestException);
      expect(mockManager.create).not.toHaveBeenCalled();
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when product was deactivated since addPayment', async () => {
      setupHappyPathLookups({
        product: { ...validSerializedProduct(), is_active: false },
      });

      await expect(
        service.createForTradeIn(mockManager as never, validInput()),
      ).rejects.toThrow('Product "Used iPhone 12 Pro Max 256GB" is inactive');
      expect(mockManager.create).not.toHaveBeenCalled();
    });

    it('maps a concurrent live-IMEI unique violation on the unit insert to 409', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e: { imei?: string }) =>
        e.imei
          ? Promise.reject(uniqueViolation('uq_product_units_imei_live'))
          : Promise.resolve({ id: 'purchase-race', ...e }),
      );

      await expect(
        service.createForTradeIn(mockManager as never, validInput()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('names the IMEI in the live-index 409 (P5-2)', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e: { imei?: string }) =>
        e.imei
          ? Promise.reject(uniqueViolation('uq_product_units_imei_live'))
          : Promise.resolve({ id: 'purchase-race', ...e }),
      );

      const err = await service
        .createForTradeIn(mockManager as never, validInput())
        .catch((e: unknown) => e);
      expect((err as ConflictException).getResponse()).toEqual({
        message: 'IMEI already exists in inventory',
        imei: '356938035643809',
        existing_unit: null,
      });
    });

    it('names the IMEI in the pre-check 409 (P5-2)', async () => {
      setupHappyPathLookups({
        existingUnit: {
          id: 'unit-99',
          status: ProductUnitStatus.IN_STOCK,
          product_id: 'prod-old',
        },
      });

      const err = await service
        .createForTradeIn(mockManager as never, validInput())
        .catch((e: unknown) => e);
      expect((err as ConflictException).getResponse()).toEqual({
        message: 'IMEI already exists in inventory',
        imei: '356938035643809',
        existing_unit: {
          id: 'unit-99',
          status: ProductUnitStatus.IN_STOCK,
          product_id: 'prod-old',
        },
      });
    });

    it('propagates other database errors from the unit insert unchanged', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      const other = new Error('connection reset');
      mockManager.save.mockImplementation((e: { imei?: string }) =>
        e.imei
          ? Promise.reject(other)
          : Promise.resolve({ id: 'purchase-other', ...e }),
      );

      await expect(
        service.createForTradeIn(mockManager as never, validInput()),
      ).rejects.toBe(other);
    });

    it('throws BadRequestException when product does not exist (defensive)', async () => {
      // Product was deleted/deactivated between addPayment and completeSale.
      // Real edge case, not a code bug.
      setupHappyPathLookups({ product: null });

      await expect(
        service.createForTradeIn(mockManager as never, validInput()),
      ).rejects.toThrow(BadRequestException);
      expect(mockManager.create).not.toHaveBeenCalled();
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('propagates errors from stock increment (integrity failure rolls the caller transaction back)', async () => {
      setupHappyPathLookups();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: e.imei ? 'unit-x' : 'purchase-x', ...e }),
      );
      mockStockService.incrementForReversal.mockRejectedValue(
        new Error('Stock row missing for product prod-1 at branch branch-1'),
      );

      await expect(
        service.createForTradeIn(mockManager as never, validInput()),
      ).rejects.toThrow('Stock row missing');

      // Method threw — caller transaction rolls back everything the
      // manager did (PP save, PU save). We can't test the rollback
      // itself at the unit level (that's the transaction manager's
      // job); the e2e crown-jewel test proves it end-to-end.
      // What we CAN prove here: the method did NOT swallow the error.
    });
  });

  describe('assertBranchAccess (implicit via create)', () => {
    // Setup: bypass all other checks and confirm branch access alone
    // is the gate. We do this by seeding the cashier with a specific
    // branch_id and letting the failure fire before other lookups.
    it('does NOT throw when cashier and dto branch match', async () => {
      // Full happy path already covers this — this test is a
      // sanity-check "same branch is allowed" case with a specific
      // branch id (not the seed default) to catch any hardcoding.
      mockManager.findOne
        .mockResolvedValueOnce({ id: 'cashier-x', branch_id: 'branch-xyz' })
        .mockResolvedValueOnce(validCustomer())
        .mockResolvedValueOnce({ ...validBranch(), id: 'branch-xyz' })
        .mockResolvedValueOnce({
          ...validSerializedProduct(),
          branch_id: 'branch-xyz',
        })
        .mockResolvedValueOnce(null);
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-branch-match', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockRepo.findOne.mockResolvedValue({ id: 'purchase-branch-match' });

      await expect(
        service.create(
          { ...validCreateDto(), branch_id: 'branch-xyz' },
          'cashier-x',
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('assertImeiAvailable edge cases (implicit via create)', () => {
    it('does NOT throw when no unit with that IMEI exists', async () => {
      // Happy path already covers this — reasserted for clarity.
      // Standard happy-path setup with existingUnit explicitly null.
      mockManager.findOne
        .mockResolvedValueOnce(validCashier())
        .mockResolvedValueOnce(validCustomer())
        .mockResolvedValueOnce(validBranch())
        .mockResolvedValueOnce(validSerializedProduct())
        .mockResolvedValueOnce(null); // no existing unit
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'purchase-imei-ok', ...e }),
      );
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockRepo.findOne.mockResolvedValue({ id: 'purchase-imei-ok' });

      await expect(
        service.create(validCreateDto(), 'cashier-1'),
      ).resolves.toBeDefined();
    });

    it('surfaces existing unit status in the ConflictException payload for each live status', async () => {
      // Verify the payload correctly reflects each blocking status —
      // critical for frontend messaging. Only live statuses can come
      // back from the (status-filtered) lookup; SOLD / RETURNED are
      // buy-back cases and are covered by the e2e suite.
      const statuses = [
        ProductUnitStatus.IN_STOCK,
        ProductUnitStatus.WRITTEN_OFF,
      ];

      for (const status of statuses) {
        jest.clearAllMocks();
        mockManager.findOne
          .mockResolvedValueOnce(validCashier())
          .mockResolvedValueOnce(validCustomer())
          .mockResolvedValueOnce(validBranch())
          .mockResolvedValueOnce(validSerializedProduct())
          .mockResolvedValueOnce({
            id: `unit-${status}`,
            status,
            product_id: 'prod-old',
          });
        mockDataSource.transaction.mockImplementation(
          (cb: (m: typeof mockManager) => unknown) => cb(mockManager),
        );

        try {
          await service.create(validCreateDto(), 'cashier-1');
          fail(`Expected ConflictException for status ${status}`);
        } catch (err) {
          expect(err).toBeInstanceOf(ConflictException);
          const response = (err as ConflictException).getResponse() as {
            existing_unit: { status: string };
          };
          expect(response.existing_unit.status).toBe(status);
        }
      }
    });
  });
});
