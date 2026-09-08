import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { Sale } from './entities/sale.entity';
import { SaleLine } from './entities/sale-line.entity';
import { SaleStatus } from './enums/sale-status.enum';
import { SaleType } from './enums/sale-type.enum';
import { DiscountType } from './enums/discount-type.enum';
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';
import { ProductsService } from '../products/products.service';
import { SuppliersService } from '../suppliers/suppliers.service';

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
        { provide: getRepositoryToken(Branch), useValue: mockBranchesRepo },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: ProductsService, useValue: mockProductsService },
        { provide: SuppliersService, useValue: mockSuppliersService },
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
    it('returns the sale with nested branch and cashier', async () => {
      const sale = { id: 's1', branch: {}, cashier: {} };
      mockSalesRepo.findOne.mockResolvedValue(sale);

      const result = await service.findOne('s1');

      expect(mockSalesRepo.findOne).toHaveBeenCalledWith({
        where: { id: 's1' },
        relations: ['branch', 'cashier'],
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
});
