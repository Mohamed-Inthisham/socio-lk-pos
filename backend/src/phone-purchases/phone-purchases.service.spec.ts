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
      const existingUnit = {
        id: 'unit-99',
        status: ProductUnitStatus.SOLD,
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
          status: ProductUnitStatus.SOLD,
          product_id: 'prod-old',
        });
      }
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
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

    it('surfaces existing unit status in the ConflictException payload for each status', async () => {
      // Verify the payload correctly reflects each ProductUnitStatus
      // — critical for frontend messaging.
      const statuses = [
        ProductUnitStatus.IN_STOCK,
        ProductUnitStatus.SOLD,
        ProductUnitStatus.RETURNED,
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
