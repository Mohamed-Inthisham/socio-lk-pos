import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { Sale } from './entities/sale.entity';
import { SaleLine } from './entities/sale-line.entity';
import { SaleStatus } from './enums/sale-status.enum';
import { SaleType } from './enums/sale-type.enum';
import { DiscountType } from './enums/discount-type.enum';
import { Payment } from './entities/payment.entity';
import { PaymentMethod } from './enums/payment-method.enum';
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';
import { ProductsService } from '../products/products.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { StockService } from '../stock/stock.service';
import { SaleNumberCountersService } from '../sale-number-counters/sale-number-counters.service';

describe('SalesService', () => {
  let service: SalesService;

  // Shared query-builder mock. Covers both the existing findAll chain
  // (leftJoinAndSelect/andWhere/orderBy/skip/take/getManyAndCount) and the
  // new transactional chain used inside line mutations
  // (setLock/where/andWhere/getOne, plus select/getRawOne for MAX line_number).
  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    getOne: jest.fn(),
    getRawOne: jest.fn(),
  };

  const mockSalesRepo = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  const mockSaleLinesRepo = {
    findOne: jest.fn(),
  };

  const mockPaymentsRepo = {
    findOne: jest.fn(),
  };

  const mockBranchesRepo = {
    findOne: jest.fn(),
  };

  const mockUsersRepo = {
    findOne: jest.fn(),
  };

  // Manager mock used inside dataSource.transaction() callbacks. addLine,
  // updateLine, removeLine all use it. Reuses mockQueryBuilder for the
  // sale-lock query and the MAX(line_number) query.
  const mockManager = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    query: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn(),
  };

  const mockProductsService = {
    findOne: jest.fn(),
  };

  const mockSuppliersService = {
    findOne: jest.fn(),
  };

  const mockStockService = {
    decrementForSale: jest.fn(),
    incrementForReversal: jest.fn(),
  };

  const mockSaleNumberCountersService = {
    generateNext: jest.fn(),
  };

  const seedActiveBranch = (overrides: Partial<Branch> = {}): Branch =>
    ({
      id: 'branch-1',
      name: 'Main Shop',
      is_active: true,
      ...overrides,
    }) as Branch;

  const seedAdmin = (overrides: Partial<User> = {}): User =>
    ({
      id: 'admin-1',
      email: 'admin@t.com',
      role: 'admin',
      is_active: true,
      branch_id: null,
      ...overrides,
    }) as User;

  const seedCashier = (overrides: Partial<User> = {}): User =>
    ({
      id: 'cashier-1',
      email: 'c@t.com',
      role: 'cashier',
      is_active: true,
      branch_id: 'branch-1',
      ...overrides,
    }) as User;

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.values(mockQueryBuilder).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReturnThis' in fn) {
        fn.mockReturnThis();
      }
    });
    mockSalesRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    mockManager.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    // Default transaction behavior: invoke the callback with our mock manager.
    // Individual tests can override with mockImplementationOnce if they need
    // to simulate rollback or a different manager shape.
    mockDataSource.transaction.mockImplementation(
      (cb: (m: typeof mockManager) => unknown) => cb(mockManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: getRepositoryToken(Sale), useValue: mockSalesRepo },
        { provide: getRepositoryToken(SaleLine), useValue: mockSaleLinesRepo },
        { provide: getRepositoryToken(Payment), useValue: mockPaymentsRepo },
        { provide: getRepositoryToken(Branch), useValue: mockBranchesRepo },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: ProductsService, useValue: mockProductsService },
        { provide: SuppliersService, useValue: mockSuppliersService },
        { provide: StockService, useValue: mockStockService },
        {
          provide: SaleNumberCountersService,
          useValue: mockSaleNumberCountersService,
        },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a DRAFT sale with server-controlled defaults', async () => {
      mockUsersRepo.findOne.mockResolvedValue(seedCashier());
      mockBranchesRepo.findOne.mockResolvedValue(seedActiveBranch());
      mockSalesRepo.create.mockImplementation((e) => e);
      mockSalesRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 'sale-1', ...e }),
      );

      const result = await service.create(
        { branch_id: 'branch-1' },
        'cashier-1',
      );

      expect(mockSalesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sale_type: SaleType.RETAIL,
          status: SaleStatus.DRAFT,
          branch_id: 'branch-1',
          cashier_id: 'cashier-1',
          customer_id: null,
          notes: null,
        }),
      );
      expect(result.id).toBe('sale-1');
    });

    it('accepts optional customer_id and notes', async () => {
      mockUsersRepo.findOne.mockResolvedValue(seedCashier());
      mockBranchesRepo.findOne.mockResolvedValue(seedActiveBranch());
      mockSalesRepo.create.mockImplementation((e) => e);
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.create(
        {
          branch_id: 'branch-1',
          customer_id: 'cust-1',
          notes: 'SMS receipt',
        },
        'cashier-1',
      );

      expect(mockSalesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: 'cust-1',
          notes: 'SMS receipt',
        }),
      );
    });

    it('allows admin (no branch_id) to create at any branch', async () => {
      mockUsersRepo.findOne.mockResolvedValue(seedAdmin());
      mockBranchesRepo.findOne.mockResolvedValue(
        seedActiveBranch({ id: 'branch-99' }),
      );
      mockSalesRepo.create.mockImplementation((e) => e);
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.create({ branch_id: 'branch-99' }, 'admin-1');

      expect(mockSalesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ branch_id: 'branch-99' }),
      );
    });

    it('throws NotFoundException when cashier does not exist', async () => {
      mockUsersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({ branch_id: 'branch-1' }, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when cashier is inactive', async () => {
      mockUsersRepo.findOne.mockResolvedValue(
        seedCashier({ is_active: false }),
      );

      await expect(
        service.create({ branch_id: 'branch-1' }, 'cashier-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when branch does not exist', async () => {
      mockUsersRepo.findOne.mockResolvedValue(seedCashier());
      mockBranchesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({ branch_id: 'missing' }, 'cashier-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when branch is inactive', async () => {
      mockUsersRepo.findOne.mockResolvedValue(seedCashier());
      mockBranchesRepo.findOne.mockResolvedValue(
        seedActiveBranch({ is_active: false }),
      );

      await expect(
        service.create({ branch_id: 'branch-1' }, 'cashier-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when non-admin cashier targets a different branch', async () => {
      mockUsersRepo.findOne.mockResolvedValue(
        seedCashier({ branch_id: 'branch-1' }),
      );
      mockBranchesRepo.findOne.mockResolvedValue(
        seedActiveBranch({ id: 'branch-2' }),
      );

      await expect(
        service.create({ branch_id: 'branch-2' }, 'cashier-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('returns paginated response with meta', async () => {
      const sales = [{ id: 's1' }, { id: 's2' }];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([sales, 137]);

      const result = await service.findAll({ page: 1, limit: 50 });

      expect(result.data).toBe(sales);
      expect(result.meta).toEqual({
        total: 137,
        page: 1,
        limit: 50,
        totalPages: 3,
        hasNext: true,
        hasPrev: false,
      });
    });

    it('defaults page=1 and limit=50 when omitted', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(50);
    });

    it('applies branchId filter when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ branchId: 'branch-1' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'sale.branch_id = :branchId',
        { branchId: 'branch-1' },
      );
    });

    it('applies cashierId filter when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ cashierId: 'cashier-1' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'sale.cashier_id = :cashierId',
        { cashierId: 'cashier-1' },
      );
    });

    it('applies status filter when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ status: SaleStatus.COMPLETED });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'sale.status = :status',
        { status: SaleStatus.COMPLETED },
      );
    });

    it('normalizes date-only "to" filter to exclusive end-of-day', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ to: '2026-08-31' });

      // Should be called with '2026-09-01T00:00:00.000Z' (start of next day, exclusive)
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'sale.created_at < :to',
        { to: '2026-09-01T00:00:00.000Z' },
      );
    });

    it('passes through "to" filter with time component unchanged', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ to: '2026-08-31T15:30:00Z' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'sale.created_at < :to',
        { to: '2026-08-31T15:30:00Z' },
      );
    });

    it('applies "from" filter when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ from: '2026-08-01' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'sale.created_at >= :from',
        { from: '2026-08-01' },
      );
    });

    it('joins branch and cashier for nested response', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'sale.branch',
        'branch',
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'sale.cashier',
        'cashier',
      );
    });

    it('orders by created_at DESC', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'sale.created_at',
        'DESC',
      );
    });

    it('computes correct offset for page 3, limit 20', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 3, limit: 20 });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(40);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
    });
  });

  describe('findOne', () => {
    it('returns the sale with nested branch, cashier, lines, and payments', async () => {
      const sale = {
        id: 's1',
        branch: {},
        cashier: {},
        lines: [],
        payments: [],
      };
      mockSalesRepo.findOne.mockResolvedValue(sale);

      const result = await service.findOne('s1');

      expect(mockSalesRepo.findOne).toHaveBeenCalledWith({
        where: { id: 's1' },
        relations: ['branch', 'cashier', 'lines', 'payments'],
        order: {
          lines: { line_number: 'ASC' },
          payments: { created_at: 'ASC' },
        },
      });
      expect(result).toBe(sale);
    });
    it('throws NotFoundException when the sale does not exist', async () => {
      mockSalesRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates notes and customer_id on a DRAFT sale', async () => {
      const sale = {
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: null,
        notes: null,
      };
      mockSalesRepo.findOne.mockResolvedValue(sale);
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', {
        customer_id: 'cust-99',
        notes: 'New notes',
      });

      expect(result.customer_id).toBe('cust-99');
      expect(result.notes).toBe('New notes');
    });

    it('clears customer_id when null is passed', async () => {
      const sale = {
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: 'cust-old',
        notes: null,
      };
      mockSalesRepo.findOne.mockResolvedValue(sale);
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', { customer_id: null });

      expect(result.customer_id).toBeNull();
    });

    it('does not touch fields not sent in the DTO', async () => {
      const sale = {
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: 'cust-old',
        notes: 'old notes',
      };
      mockSalesRepo.findOne.mockResolvedValue(sale);
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', { notes: 'new notes' });

      expect(result.customer_id).toBe('cust-old');
      expect(result.notes).toBe('new notes');
    });

    it('throws BadRequestException when updating a COMPLETED sale', async () => {
      mockSalesRepo.findOne.mockResolvedValue({
        id: 's1',
        status: SaleStatus.COMPLETED,
      });

      await expect(
        service.update('s1', { notes: 'try to change' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when updating a VOIDED sale', async () => {
      mockSalesRepo.findOne.mockResolvedValue({
        id: 's1',
        status: SaleStatus.VOIDED,
      });

      await expect(
        service.update('s1', { notes: 'try to change' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when sale does not exist', async () => {
      mockSalesRepo.findOne.mockResolvedValue(null);

      await expect(service.update('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('discardDraft', () => {
    it('removes a DRAFT sale', async () => {
      const sale = { id: 's1', status: SaleStatus.DRAFT };
      mockSalesRepo.findOne.mockResolvedValue(sale);
      mockSalesRepo.remove.mockResolvedValue(sale);

      await service.discardDraft('s1');

      expect(mockSalesRepo.remove).toHaveBeenCalledWith(sale);
    });

    it('throws BadRequestException when discarding a COMPLETED sale', async () => {
      mockSalesRepo.findOne.mockResolvedValue({
        id: 's1',
        status: SaleStatus.COMPLETED,
      });

      await expect(service.discardDraft('s1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockSalesRepo.remove).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when discarding a VOIDED sale', async () => {
      mockSalesRepo.findOne.mockResolvedValue({
        id: 's1',
        status: SaleStatus.VOIDED,
      });

      await expect(service.discardDraft('s1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when sale does not exist', async () => {
      mockSalesRepo.findOne.mockResolvedValue(null);

      await expect(service.discardDraft('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- D2 seed helpers ----

  const seedProduct = (
    overrides: Partial<{
      id: string;
      name: string;
      sku: string;
      selling_price: string;
      buying_price: string;
      branch_id: string;
      is_active: boolean;
    }> = {},
  ) => ({
    id: 'prod-1',
    name: 'iPhone 15',
    sku: 'PH-000001',
    selling_price: '250000.00',
    buying_price: '220000.00',
    branch_id: 'branch-1',
    is_active: true,
    ...overrides,
  });

  const seedSupplier = (
    overrides: Partial<{
      id: string;
      name: string;
      is_active: boolean;
    }> = {},
  ) => ({
    id: 'supplier-1',
    name: 'Friendly Shop A',
    is_active: true,
    ...overrides,
  });

  const seedDraftSale = (
    overrides: Partial<{
      id: string;
      status: SaleStatus;
      branch_id: string;
    }> = {},
  ) => ({
    id: 'sale-1',
    status: SaleStatus.DRAFT,
    branch_id: 'branch-1',
    ...overrides,
  });

  const seedLine = (
    overrides: Partial<{
      id: string;
      sale_id: string;
      unit_price: string;
      quantity: number;
      discount_type: DiscountType | null;
      discount_value: string | null;
      discount_amount: string;
      line_total: string;
      external_supplier_id: string | null;
      imei_snapshot: string | null;
    }> = {},
  ) => ({
    id: 'line-1',
    sale_id: 'sale-1',
    unit_price: '100.00',
    quantity: 2,
    discount_type: null,
    discount_value: null,
    discount_amount: '0.00',
    line_total: '200.00',
    external_supplier_id: null,
    imei_snapshot: null,
    ...overrides,
  });

  describe('addLine', () => {
    it('inserts a line with resolved snapshots and recomputes totals', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(seedProduct());
      mockManager.create.mockImplementation((_entity, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'line-new', ...e }),
      );

      const result = await service.addLine(
        'sale-1',
        { product_id: 'prod-1', quantity: 2 },
        'cashier-1',
      );

      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({
          sale_id: 'sale-1',
          line_number: 1,
          product_id: 'prod-1',
          product_sku_snapshot: 'PH-000001',
          product_name_snapshot: 'iPhone 15',
          unit_price: '250000.00',
          cost_price_snapshot: '220000.00',
          quantity: 2,
          discount_type: null,
          discount_value: null,
          discount_amount: '0.00',
          line_total: '500000.00',
        }),
      );
      expect(result.id).toBe('line-new');
      expect(mockManager.query).toHaveBeenCalled(); // recompute totals
    });

    it('assigns line_number as max + 1 when other lines exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '4' });
      mockProductsService.findOne.mockResolvedValue(seedProduct());
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        { product_id: 'prod-1', quantity: 1 },
        'cashier-1',
      );

      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({ line_number: 5 }),
      );
    });

    it('resolves a PERCENT discount to the correct LKR amount', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ selling_price: '100.00' }),
      );
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 3,
          discount_type: DiscountType.PERCENT,
          discount_value: 10,
        },
        'cashier-1',
      );

      // 10% of (100 * 3) = 30
      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({
          discount_type: DiscountType.PERCENT,
          discount_value: '10.00',
          discount_amount: '30.00',
          line_total: '270.00',
        }),
      );
    });

    it('rounds a PERCENT discount half-up to 2 decimals', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ selling_price: '333.33' }),
      );
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          discount_type: DiscountType.PERCENT,
          discount_value: 10,
        },
        'cashier-1',
      );

      // 10% of 333.33 = 33.333 → 33.33 (half-up on the 3rd decimal is down)
      // line_total = 333.33 - 33.33 = 300.00
      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({
          discount_amount: '33.33',
          line_total: '300.00',
        }),
      );
    });

    it('accepts an AMOUNT discount up to line subtotal', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ selling_price: '100.00' }),
      );
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 2,
          discount_type: DiscountType.AMOUNT,
          discount_value: 50,
        },
        'cashier-1',
      );

      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({
          discount_amount: '50.00',
          line_total: '150.00',
        }),
      );
    });

    it('throws BadRequestException when AMOUNT discount exceeds line subtotal', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ selling_price: '100.00' }),
      );

      await expect(
        service.addLine(
          'sale-1',
          {
            product_id: 'prod-1',
            quantity: 2,
            discount_type: DiscountType.AMOUNT,
            discount_value: 500,
          },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when only discount_type is provided', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(seedProduct());

      await expect(
        service.addLine(
          'sale-1',
          {
            product_id: 'prod-1',
            quantity: 1,
            discount_type: DiscountType.AMOUNT,
          },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates external supplier when set', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(seedProduct());
      mockSuppliersService.findOne.mockResolvedValue(seedSupplier());
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          external_supplier_id: 'supplier-1',
        },
        'cashier-1',
      );

      expect(mockSuppliersService.findOne).toHaveBeenCalledWith('supplier-1');
      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({ external_supplier_id: 'supplier-1' }),
      );
    });

    it('throws BadRequestException when external supplier is inactive', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(seedProduct());
      mockSuppliersService.findOne.mockResolvedValue(
        seedSupplier({ is_active: false }),
      );

      await expect(
        service.addLine(
          'sale-1',
          {
            product_id: 'prod-1',
            quantity: 1,
            external_supplier_id: 'supplier-1',
          },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the sale does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.addLine(
          'missing',
          { product_id: 'prod-1', quantity: 1 },
          'cashier-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when sale is not DRAFT', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({ status: SaleStatus.COMPLETED }),
      );

      await expect(
        service.addLine(
          'sale-1',
          { product_id: 'prod-1', quantity: 1 },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when product is inactive', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_active: false }),
      );

      await expect(
        service.addLine(
          'sale-1',
          { product_id: 'prod-1', quantity: 1 },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when product belongs to a different branch', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({ branch_id: 'branch-1' }),
      );
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ branch_id: 'branch-2' }),
      );

      await expect(
        service.addLine(
          'sale-1',
          { product_id: 'prod-1', quantity: 1 },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('locks the sale row for update', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(seedProduct());
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        { product_id: 'prod-1', quantity: 1 },
        'cashier-1',
      );

      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
    });
  });

  describe('updateLine', () => {
    it('updates quantity and recomputes discount_amount + line_total', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(
        seedLine({
          unit_price: '100.00',
          quantity: 2,
          discount_type: DiscountType.PERCENT,
          discount_value: '10',
          discount_amount: '20.00',
          line_total: '180.00',
        }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateLine('sale-1', 'line-1', {
        quantity: 5,
      });

      // 10% of (100 * 5) = 50 → line_total = 450
      expect(result.quantity).toBe(5);
      expect(result.discount_amount).toBe('50.00');
      expect(result.line_total).toBe('450.00');
    });

    it('clears the discount when both type and value are null', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(
        seedLine({
          unit_price: '100.00',
          quantity: 2,
          discount_type: DiscountType.PERCENT,
          discount_value: '10',
          discount_amount: '20.00',
          line_total: '180.00',
        }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateLine('sale-1', 'line-1', {
        discount_type: null,
        discount_value: null,
      });

      expect(result.discount_type).toBeNull();
      expect(result.discount_value).toBeNull();
      expect(result.discount_amount).toBe('0.00');
      expect(result.line_total).toBe('200.00');
    });

    it('throws BadRequestException when only discount_type is touched', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(seedLine());

      await expect(
        service.updateLine('sale-1', 'line-1', {
          discount_type: DiscountType.PERCENT,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when only discount_value is touched', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(seedLine());

      await expect(
        service.updateLine('sale-1', 'line-1', { discount_value: 10 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not touch fields not sent in the DTO', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(
        seedLine({
          unit_price: '100.00',
          quantity: 2,
          imei_snapshot: '354789102345678',
          external_supplier_id: 'supplier-old',
        }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateLine('sale-1', 'line-1', {
        quantity: 3,
      });

      expect(result.quantity).toBe(3);
      expect(result.imei_snapshot).toBe('354789102345678');
      expect(result.external_supplier_id).toBe('supplier-old');
    });

    it('validates external supplier when changed to non-null', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(seedLine());
      mockSuppliersService.findOne.mockResolvedValue(seedSupplier());
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.updateLine('sale-1', 'line-1', {
        external_supplier_id: 'supplier-1',
      });

      expect(mockSuppliersService.findOne).toHaveBeenCalledWith('supplier-1');
    });

    it('does not validate supplier when clearing to null', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(
        seedLine({ external_supplier_id: 'supplier-old' }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.updateLine('sale-1', 'line-1', {
        external_supplier_id: null,
      });

      expect(mockSuppliersService.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the sale does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.updateLine('missing', 'line-1', { quantity: 3 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when sale is not DRAFT', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({ status: SaleStatus.COMPLETED }),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', { quantity: 3 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the line does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(null);

      await expect(
        service.updateLine('sale-1', 'missing', { quantity: 3 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when line belongs to a different sale', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({ id: 'sale-1' }),
      );
      mockManager.findOne.mockResolvedValue(seedLine({ sale_id: 'sale-99' }));

      await expect(
        service.updateLine('sale-1', 'line-1', { quantity: 3 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeLine', () => {
    it('removes the line and recomputes totals', async () => {
      const line = seedLine();
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(line);
      mockManager.remove.mockResolvedValue(line);

      await service.removeLine('sale-1', 'line-1');

      expect(mockManager.remove).toHaveBeenCalledWith(line);
      expect(mockManager.query).toHaveBeenCalled();
    });

    it('throws NotFoundException when the sale does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(service.removeLine('missing', 'line-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when sale is not DRAFT', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({ status: SaleStatus.COMPLETED }),
      );

      await expect(service.removeLine('sale-1', 'line-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockManager.remove).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the line does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(null);

      await expect(service.removeLine('sale-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when line belongs to a different sale', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({ id: 'sale-1' }),
      );
      mockManager.findOne.mockResolvedValue(seedLine({ sale_id: 'sale-99' }));

      await expect(service.removeLine('sale-1', 'line-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
  // ---- E2 seed helpers ----

  const seedPayment = (
    overrides: Partial<{
      id: string;
      sale_id: string;
      payment_method: PaymentMethod;
      amount: string;
      cash_received: string | null;
      reference_number: string | null;
      notes: string | null;
    }> = {},
  ) => ({
    id: 'payment-1',
    sale_id: 'sale-1',
    payment_method: PaymentMethod.CASH,
    amount: '500.00',
    cash_received: '500.00',
    reference_number: null,
    notes: null,
    ...overrides,
  });

  describe('addPayment', () => {
    it('inserts a CASH payment and recomputes totals', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({ id: 'sale-1' }),
      );
      // remainingBalance query
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'pay-new', ...e }),
      );
      // sale.total mock — the seedDraftSale doesn't include `total`
      // so we override it inline via a fresh mock
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });

      const result = await service.addPayment('sale-1', {
        payment_method: PaymentMethod.CASH,
        amount: 500,
        cash_received: 500,
      });

      expect(mockManager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          sale_id: 'sale-1',
          payment_method: PaymentMethod.CASH,
          amount: '500.00',
          cash_received: '500.00',
          reference_number: null,
        }),
      );
      expect(result.id).toBe('pay-new');
      expect(mockManager.query).toHaveBeenCalled(); // recompute
    });

    it('inserts a CARD payment with reference_number', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '1000.00',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addPayment('sale-1', {
        payment_method: PaymentMethod.CARD,
        amount: 1000,
        reference_number: 'AUTH-482913',
      });

      expect(mockManager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          payment_method: PaymentMethod.CARD,
          amount: '1000.00',
          cash_received: null,
          reference_number: 'AUTH-482913',
        }),
      );
    });

    it('inserts a KOKO payment with reference_number', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '2500.00',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addPayment('sale-1', {
        payment_method: PaymentMethod.KOKO,
        amount: 2500,
        reference_number: 'KOKO-TXN-XYZ',
      });

      expect(mockManager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          payment_method: PaymentMethod.KOKO,
          reference_number: 'KOKO-TXN-XYZ',
        }),
      );
    });

    it('throws BadRequestException when CASH payment has no cash_received', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });

      await expect(
        service.addPayment('sale-1', {
          payment_method: PaymentMethod.CASH,
          amount: 500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when CASH cash_received is less than amount', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });

      await expect(
        service.addPayment('sale-1', {
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 400,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when non-CASH payment has cash_received', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });

      await expect(
        service.addPayment('sale-1', {
          payment_method: PaymentMethod.CARD,
          amount: 500,
          cash_received: 500,
          reference_number: 'AUTH-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when non-CASH payment has no reference_number', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });

      await expect(
        service.addPayment('sale-1', {
          payment_method: PaymentMethod.CARD,
          amount: 500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when amount exceeds remaining balance', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      // Already paid 400, remaining = 100
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '400' });

      await expect(
        service.addPayment('sale-1', {
          payment_method: PaymentMethod.CASH,
          amount: 200,
          cash_received: 200,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a payment that exactly closes the remaining balance', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      // Already paid 400, remaining = 100 — new payment of exactly 100 should succeed
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '400' });
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addPayment('sale-1', {
        payment_method: PaymentMethod.CASH,
        amount: 100,
        cash_received: 100,
      });

      expect(mockManager.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when the sale does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(
        service.addPayment('missing', {
          payment_method: PaymentMethod.CASH,
          amount: 100,
          cash_received: 100,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when sale is not DRAFT', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale({ status: SaleStatus.COMPLETED }),
        total: '500.00',
      });

      await expect(
        service.addPayment('sale-1', {
          payment_method: PaymentMethod.CASH,
          amount: 100,
          cash_received: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('locks the sale row for update', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addPayment('sale-1', {
        payment_method: PaymentMethod.CASH,
        amount: 500,
        cash_received: 500,
      });

      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
    });
  });

  describe('updatePayment', () => {
    it('updates amount and recomputes totals', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '1000.00',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({ amount: '400.00', cash_received: '400.00' }),
      );
      // No other payments — but excludeAmount = 400, so remaining = 1000 - 0 + 400 = wait
      // Actually: paidSoFar = SUM - excludeAmount = 400 - 400 = 0, remaining = 1000 - 0 = 1000
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '400' });
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updatePayment('sale-1', 'payment-1', {
        amount: 600,
        cash_received: 600,
      });

      expect(result.amount).toBe('600.00');
      expect(result.cash_received).toBe('600.00');
    });

    it('allows amount up to sale.total when this is the only payment', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '1000.00',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({ amount: '500.00', cash_received: '500.00' }),
      );
      // Existing payment is 500 (the one being updated). Update to 1000 should succeed.
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '500' });
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.updatePayment('sale-1', 'payment-1', {
        amount: 1000,
        cash_received: 1000,
      });

      expect(mockManager.save).toHaveBeenCalled();
    });

    it('throws BadRequestException when new amount would exceed remaining balance', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '1000.00',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({ amount: '300.00', cash_received: '300.00' }),
      );
      // SUM = 300 (this) + 400 (other) = 700. excludeAmount = 300.
      // paidSoFar = 700 - 300 = 400. remaining = 1000 - 400 = 600.
      // Update to 700 should exceed (600).
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '700' });

      await expect(
        service.updatePayment('sale-1', 'payment-1', {
          amount: 700,
          cash_received: 700,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates reference_number on a CARD payment', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '1000.00',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({
          payment_method: PaymentMethod.CARD,
          amount: '1000.00',
          cash_received: null,
          reference_number: 'OLD-REF',
        }),
      );
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '1000' });
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updatePayment('sale-1', 'payment-1', {
        reference_number: 'NEW-REF',
      });

      expect(result.reference_number).toBe('NEW-REF');
    });

    it('throws BadRequestException when clearing reference on a CARD payment', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '1000.00',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({
          payment_method: PaymentMethod.CARD,
          amount: '1000.00',
          cash_received: null,
          reference_number: 'AUTH-1',
        }),
      );

      await expect(
        service.updatePayment('sale-1', 'payment-1', {
          reference_number: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates cash_received on a CASH payment (cashier miscount fix)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({ amount: '500.00', cash_received: '1000.00' }),
      );
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '500' });
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updatePayment('sale-1', 'payment-1', {
        cash_received: 700,
      });

      expect(result.cash_received).toBe('700.00');
      expect(result.amount).toBe('500.00'); // unchanged
    });

    it('throws BadRequestException when merged cash_received < amount', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({ amount: '500.00', cash_received: '500.00' }),
      );
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '500' });

      await expect(
        service.updatePayment('sale-1', 'payment-1', {
          cash_received: 400,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when payment belongs to a different sale', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale({ id: 'sale-1' }),
        total: '500.00',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({ sale_id: 'sale-99' }),
      );

      await expect(
        service.updatePayment('sale-1', 'payment-1', { amount: 300 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the sale does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(
        service.updatePayment('missing', 'payment-1', { amount: 300 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when sale is not DRAFT', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale({ status: SaleStatus.COMPLETED }),
        total: '500.00',
      });

      await expect(
        service.updatePayment('sale-1', 'payment-1', { amount: 300 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the payment does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockManager.findOne.mockResolvedValue(null);

      await expect(
        service.updatePayment('sale-1', 'missing', { amount: 300 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removePayment', () => {
    it('removes the payment and recomputes totals', async () => {
      const payment = seedPayment();
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockManager.findOne.mockResolvedValue(payment);
      mockManager.remove.mockResolvedValue(payment);

      await service.removePayment('sale-1', 'payment-1');

      expect(mockManager.remove).toHaveBeenCalledWith(payment);
      expect(mockManager.query).toHaveBeenCalled();
    });

    it('throws NotFoundException when the sale does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(
        service.removePayment('missing', 'payment-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when sale is not DRAFT', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale({ status: SaleStatus.COMPLETED }),
        total: '500.00',
      });

      await expect(
        service.removePayment('sale-1', 'payment-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockManager.remove).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the payment does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockManager.findOne.mockResolvedValue(null);

      await expect(service.removePayment('sale-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when payment belongs to a different sale', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale({ id: 'sale-1' }),
        total: '500.00',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({ sale_id: 'sale-99' }),
      );

      await expect(
        service.removePayment('sale-1', 'payment-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
  describe('completeSale', () => {
    // Helper: seed a DRAFT sale that's ready to complete — total matches
    // amount_paid, so the invariant check passes by default. Tests that
    // exercise the invariant guard override the relevant field.
    const seedCompletableSale = (overrides: Record<string, unknown> = {}) => ({
      id: 'sale-1',
      status: SaleStatus.DRAFT,
      branch_id: 'branch-1',
      total: '500.00',
      amount_paid: '500.00',
      ...overrides,
    });

    // Helper: seed a SaleLine ready for stock decrement. Defaults are for
    // an in-house line (no external supplier).
    const seedCompletableLine = (
      overrides: Partial<{
        id: string;
        product_id: string;
        product_name_snapshot: string;
        quantity: number;
        external_supplier_id: string | null;
      }> = {},
    ) => ({
      id: 'line-1',
      sale_id: 'sale-1',
      product_id: 'prod-1',
      product_name_snapshot: 'iPhone 15',
      quantity: 2,
      external_supplier_id: null,
      ...overrides,
    });

    it('completes a DRAFT sale: decrements stock, issues sale_number, marks COMPLETED', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      mockManager.find.mockResolvedValue([
        seedCompletableLine({ product_id: 'prod-1', quantity: 2 }),
        seedCompletableLine({
          id: 'line-2',
          product_id: 'prod-2',
          product_name_snapshot: 'AirPods',
          quantity: 1,
        }),
      ]);
      mockStockService.decrementForSale.mockResolvedValue(undefined);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-20260910-0001',
      );
      mockManager.query.mockResolvedValue(undefined);

      await service.completeSale('sale-1');

      // Stock decremented for each in-house line
      expect(mockStockService.decrementForSale).toHaveBeenCalledTimes(2);
      expect(mockStockService.decrementForSale).toHaveBeenCalledWith(
        mockManager,
        'prod-1',
        'branch-1',
        2,
        'iPhone 15',
      );
      expect(mockStockService.decrementForSale).toHaveBeenCalledWith(
        mockManager,
        'prod-2',
        'branch-1',
        1,
        'AirPods',
      );

      // Sale number issued with the transaction's manager (enlistment)
      expect(mockSaleNumberCountersService.generateNext).toHaveBeenCalledWith(
        'branch-1',
        mockManager,
      );

      // Final UPDATE fires with COMPLETED status and the issued number
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sales'),
        [SaleStatus.COMPLETED, 'INV-20260910-0001', 'sale-1'],
      );
    });

    it('skips stock decrement for lines sourced from an external supplier', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      mockManager.find.mockResolvedValue([
        // In-house line — should decrement
        seedCompletableLine({ product_id: 'prod-in-house', quantity: 1 }),
        // External-supplier line — should be skipped
        seedCompletableLine({
          id: 'line-2',
          product_id: 'prod-friendly',
          product_name_snapshot: 'iPhone from friend shop',
          quantity: 1,
          external_supplier_id: 'supplier-1',
        }),
      ]);
      mockStockService.decrementForSale.mockResolvedValue(undefined);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-20260910-0002',
      );

      await service.completeSale('sale-1');

      expect(mockStockService.decrementForSale).toHaveBeenCalledTimes(1);
      expect(mockStockService.decrementForSale).toHaveBeenCalledWith(
        mockManager,
        'prod-in-house',
        'branch-1',
        1,
        'iPhone 15',
      );
      // Verify the friendly-shop product was NOT decremented
      expect(mockStockService.decrementForSale).not.toHaveBeenCalledWith(
        expect.anything(),
        'prod-friendly',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('throws NotFoundException when the sale does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(service.completeSale('missing')).rejects.toThrow(
        NotFoundException,
      );

      // Nothing downstream ran
      expect(mockManager.find).not.toHaveBeenCalled();
      expect(mockStockService.decrementForSale).not.toHaveBeenCalled();
      expect(mockSaleNumberCountersService.generateNext).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when sale is COMPLETED', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedCompletableSale({ status: SaleStatus.COMPLETED }),
      );

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStockService.decrementForSale).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when sale is VOIDED', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedCompletableSale({ status: SaleStatus.VOIDED }),
      );

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the sale has no lines', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      mockManager.find.mockResolvedValue([]);

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        BadRequestException,
      );
      // Guard fires before stock decrement + number issue
      expect(mockStockService.decrementForSale).not.toHaveBeenCalled();
      expect(mockSaleNumberCountersService.generateNext).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when amount_paid does not equal total (underpaid)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedCompletableSale({ total: '500.00', amount_paid: '400.00' }),
      );
      mockManager.find.mockResolvedValue([seedCompletableLine()]);

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStockService.decrementForSale).not.toHaveBeenCalled();
    });

    it('accepts amount_paid == total on the exact cent boundary', async () => {
      // 99.99 vs 99.99 is trivial. The real risk is fractional strings
      // like SUM outputs. Simulate that: sale.amount_paid comes back
      // as '99.99' from a SUM, sale.total is '99.99' from computed math.
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedCompletableSale({ total: '99.99', amount_paid: '99.99' }),
      );
      mockManager.find.mockResolvedValue([seedCompletableLine()]);
      mockStockService.decrementForSale.mockResolvedValue(undefined);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-20260910-0003',
      );

      await expect(service.completeSale('sale-1')).resolves.toBeUndefined();
    });

    it('propagates ConflictException from StockService (insufficient stock rolls back)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      mockManager.find.mockResolvedValue([
        seedCompletableLine({ product_id: 'prod-1', quantity: 100 }),
      ]);
      mockStockService.decrementForSale.mockRejectedValue(
        new ConflictException(
          'Insufficient stock for "iPhone 15": requested 100, available 3',
        ),
      );

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        ConflictException,
      );

      // Number was NOT issued because the failure happened before that step
      expect(mockSaleNumberCountersService.generateNext).not.toHaveBeenCalled();
      // Final UPDATE was NOT executed
      expect(mockManager.query).not.toHaveBeenCalled();
    });

    it('locks the sale row for update', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      mockManager.find.mockResolvedValue([seedCompletableLine()]);
      mockStockService.decrementForSale.mockResolvedValue(undefined);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-20260910-0004',
      );

      await service.completeSale('sale-1');

      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
    });

    it('stops decrementing further lines if one throws (loop bail-out)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      mockManager.find.mockResolvedValue([
        seedCompletableLine({ id: 'line-1', product_id: 'prod-1' }),
        seedCompletableLine({ id: 'line-2', product_id: 'prod-2' }),
        seedCompletableLine({ id: 'line-3', product_id: 'prod-3' }),
      ]);
      // Second line fails
      mockStockService.decrementForSale
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new ConflictException('Insufficient stock'));

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        ConflictException,
      );

      // Third line was never attempted
      expect(mockStockService.decrementForSale).toHaveBeenCalledTimes(2);
    });
  });

  describe('voidSale', () => {
    // Helper: seed a COMPLETED sale that's ready to be voided. Tests
    // exercising the status guard override the status field.
    const seedVoidableSale = (overrides: Record<string, unknown> = {}) => ({
      id: 'sale-1',
      status: SaleStatus.COMPLETED,
      branch_id: 'branch-1',
      sale_number: 'INV-20260910-0001',
      ...overrides,
    });

    // Helper: seed a SaleLine for the stock re-increment loop. Defaults
    // to an in-house line (no external supplier) so the increment fires.
    const seedVoidableLine = (
      overrides: Partial<{
        id: string;
        product_id: string;
        quantity: number;
        external_supplier_id: string | null;
      }> = {},
    ) => ({
      id: 'line-1',
      sale_id: 'sale-1',
      product_id: 'prod-1',
      quantity: 2,
      external_supplier_id: null,
      ...overrides,
    });

    const validDto = { void_reason: 'Customer returned defective phone' };

    it('voids a COMPLETED sale: re-increments stock, marks payments reversed, flips to VOIDED', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      mockManager.find.mockResolvedValue([
        seedVoidableLine({ product_id: 'prod-1', quantity: 2 }),
        seedVoidableLine({
          id: 'line-2',
          product_id: 'prod-2',
          quantity: 1,
        }),
      ]);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockManager.query.mockResolvedValue(undefined);

      await service.voidSale('sale-1', 'admin-1', validDto);

      // Stock re-incremented for each in-house line
      expect(mockStockService.incrementForReversal).toHaveBeenCalledTimes(2);
      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        mockManager,
        'prod-1',
        'branch-1',
        2,
      );
      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        mockManager,
        'prod-2',
        'branch-1',
        1,
      );

      // Payments UPDATE fires with the trimmed reason
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        ['Customer returned defective phone', 'sale-1'],
      );

      // Sale UPDATE fires with VOIDED status, voidedBy, and reason
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sales'),
        [
          SaleStatus.VOIDED,
          'admin-1',
          'Customer returned defective phone',
          'sale-1',
        ],
      );
    });

    it('skips stock re-increment for lines sourced from an external supplier', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      mockManager.find.mockResolvedValue([
        // In-house — should re-increment
        seedVoidableLine({ product_id: 'prod-in-house', quantity: 3 }),
        // External-supplier — should be skipped (was never our stock)
        seedVoidableLine({
          id: 'line-2',
          product_id: 'prod-friendly',
          quantity: 5,
          external_supplier_id: 'supplier-1',
        }),
      ]);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      await service.voidSale('sale-1', 'admin-1', validDto);

      expect(mockStockService.incrementForReversal).toHaveBeenCalledTimes(1);
      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        mockManager,
        'prod-in-house',
        'branch-1',
        3,
      );
      // Friendly-shop line was NOT re-incremented — symmetric with completeSale's skip
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalledWith(
        expect.anything(),
        'prod-friendly',
        expect.anything(),
        expect.anything(),
      );
    });

    it('trims whitespace from void_reason before persisting', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      mockManager.find.mockResolvedValue([seedVoidableLine()]);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      await service.voidSale('sale-1', 'admin-1', {
        void_reason: '   Duplicate transaction   ',
      });

      // Both queries receive the trimmed string, byte-for-byte identical
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        ['Duplicate transaction', 'sale-1'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sales'),
        [SaleStatus.VOIDED, 'admin-1', 'Duplicate transaction', 'sale-1'],
      );
    });

    it('throws NotFoundException when the sale does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(
        service.voidSale('missing', 'admin-1', validDto),
      ).rejects.toThrow(NotFoundException);

      // Nothing downstream ran
      expect(mockManager.find).not.toHaveBeenCalled();
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
      expect(mockManager.query).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when sale is DRAFT (cannot void an unfinalized sale)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedVoidableSale({ status: SaleStatus.DRAFT }),
      );

      await expect(
        service.voidSale('sale-1', 'admin-1', validDto),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when sale is already VOIDED (terminal state)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedVoidableSale({ status: SaleStatus.VOIDED }),
      );

      await expect(
        service.voidSale('sale-1', 'admin-1', validDto),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when void_reason is missing', async () => {
      // Fails at the pre-transaction guard — sale is never even fetched
      await expect(
        service.voidSale('sale-1', 'admin-1', {
          void_reason: undefined as unknown as string,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when void_reason is whitespace-only', async () => {
      // Defense-in-depth: DTO should catch this, but internal callers
      // that bypass the DTO shouldn't be able to slip a blank reason.
      await expect(
        service.voidSale('sale-1', 'admin-1', { void_reason: '     ' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when void_reason is too short after trim', async () => {
      await expect(
        service.voidSale('sale-1', 'admin-1', { void_reason: 'no' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('propagates errors from stock re-increment (data integrity failure rolls back)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      mockManager.find.mockResolvedValue([seedVoidableLine()]);
      mockStockService.incrementForReversal.mockRejectedValue(
        new Error('Stock row missing for product prod-1 at branch branch-1'),
      );

      await expect(
        service.voidSale('sale-1', 'admin-1', validDto),
      ).rejects.toThrow(/Stock row missing/);

      // Sale UPDATE was NOT executed — nothing flipped to VOIDED
      expect(mockManager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sales'),
        expect.anything(),
      );
      // Payments UPDATE was also NOT executed (increment failed before it)
      expect(mockManager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        expect.anything(),
      );
    });

    it('locks the sale row for update', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      mockManager.find.mockResolvedValue([seedVoidableLine()]);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      await service.voidSale('sale-1', 'admin-1', validDto);

      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
    });

    it('stops re-incrementing further lines if one throws (loop bail-out)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      mockManager.find.mockResolvedValue([
        seedVoidableLine({ id: 'line-1', product_id: 'prod-1' }),
        seedVoidableLine({ id: 'line-2', product_id: 'prod-2' }),
        seedVoidableLine({ id: 'line-3', product_id: 'prod-3' }),
      ]);
      mockStockService.incrementForReversal
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Stock row missing'));

      await expect(
        service.voidSale('sale-1', 'admin-1', validDto),
      ).rejects.toThrow();

      // Third line was never attempted — sequential loop bails on first throw
      expect(mockStockService.incrementForReversal).toHaveBeenCalledTimes(2);
    });

    it('stamps payments UPDATE before sales UPDATE (order matters for the transaction)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      mockManager.find.mockResolvedValue([seedVoidableLine()]);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      await service.voidSale('sale-1', 'admin-1', validDto);

      // Extract only the query() calls, not any other mock.query invocations
      const calls = mockManager.query.mock.calls;
      const paymentsIdx = calls.findIndex((c) =>
        (c[0] as string).includes('UPDATE payments'),
      );
      const salesIdx = calls.findIndex((c) =>
        (c[0] as string).includes('UPDATE sales'),
      );

      expect(paymentsIdx).toBeGreaterThanOrEqual(0);
      expect(salesIdx).toBeGreaterThanOrEqual(0);
      expect(paymentsIdx).toBeLessThan(salesIdx);
    });
  });
});
