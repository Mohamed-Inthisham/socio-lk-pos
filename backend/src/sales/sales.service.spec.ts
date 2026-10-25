import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { Brackets, In, QueryFailedError } from 'typeorm';
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
import { SaleReturn } from './entities/sale-return.entity';
import { PaymentMethod } from './enums/payment-method.enum';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';
import { ProductsService } from '../products/products.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { StockService } from '../stock/stock.service';
import { SaleNumberCountersService } from '../sale-number-counters/sale-number-counters.service';
import { CustomersService } from '../customers/customers.service';
import { Customer } from '../customers/entities/customer.entity';
import { ProductUnitsService } from '../product-units/product-units.service';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { PhonePurchasesService } from '../phone-purchases/phone-purchases.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { UserRole } from '../users/enums/user-role.enum';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { WarrantyPeriod } from '../products/enums/warranty-period.enum';
import { lockInventoryRows } from '../stock/lock-inventory-rows';
import { assertDayOpen } from '../cash-days/day-gate';

// The global lock order's helper takes its own queries on the manager;
// mocked so the per-call manager mocks below stay exact (Phase 6.4 P7-25).
jest.mock('../stock/lock-inventory-rows');
// The day gate (P9-9, P9-10) likewise: its own spec covers its queries.
// Mocked, it resolves: today is open unless a test says otherwise.
jest.mock('../cash-days/day-gate');

describe('SalesService', () => {
  let service: SalesService;

  // Shared query-builder mock. Covers both the existing findAll chain
  // (leftJoinAndSelect/andWhere/orderBy/skip/take/getManyAndCount) and the
  // new transactional chain used inside line mutations
  // (setLock/where/andWhere/getOne, plus select/getRawOne for MAX line_number).
  const mockQueryBuilder = {
    withDeleted: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
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

  // Returns (Phase 6.4 P7): no sale here has any. findOne's returns query,
  // findAll's return-state query and the void's SALE_HAS_RETURNS check all
  // come back empty unless a test says otherwise.
  const mockSaleReturnsQueryBuilder = {
    withDeleted: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  const mockSaleReturnsRepo = {
    createQueryBuilder: jest.fn(() => mockSaleReturnsQueryBuilder),
    count: jest.fn(),
    query: jest.fn(),
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
  // The VOID audit row (P6-17) goes through manager.getRepository(AuditLog)
  const mockAuditRepo = { save: jest.fn() };

  const mockManager = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    query: jest.fn(),
    count: jest.fn(),
    getRepository: jest.fn(() => mockAuditRepo),
  };

  const mockApprovalsService = {
    verify: jest.fn(),
  };

  /** An admin approving their own void with their PIN (P6-17). */
  const voidApproval = {
    approver: { id: 'admin-1', full_name: 'Test Admin', role: UserRole.ADMIN },
    requestedBy: {
      id: 'admin-1',
      full_name: 'Test Admin',
      role: UserRole.ADMIN,
      branch_id: null,
    },
    ip: '127.0.0.1',
  };

  // The data source's own manager: the lock-free reads before the PIN.
  const mockReadManager = { name: 'read-manager', query: jest.fn() };

  const mockDataSource = {
    transaction: jest.fn(),
    manager: mockReadManager,
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
    decrementForVoidedTradeIn: jest.fn(),
  };

  const mockSaleNumberCountersService = {
    generateNext: jest.fn(),
  };

  const mockCustomersService = {
    findOne: jest.fn(),
  };

  const mockProductUnitsService = {
    markSoldForSale: jest.fn(),
    markAvailableForReversal: jest.fn(),
    markReturnedForVoid: jest.fn(),
  };

  const mockPhonePurchasesService = {
    createForTradeIn: jest.fn(),
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
    Object.values(mockSaleReturnsQueryBuilder).forEach((fn) => {
      if ('mockReturnThis' in fn) fn.mockReturnThis();
    });
    mockSaleReturnsQueryBuilder.getMany.mockResolvedValue([]);
    mockSaleReturnsRepo.createQueryBuilder.mockReturnValue(
      mockSaleReturnsQueryBuilder,
    );
    mockSaleReturnsRepo.count.mockResolvedValue(0);
    mockSaleReturnsRepo.query.mockResolvedValue([]);
    mockManager.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: getRepositoryToken(Sale), useValue: mockSalesRepo },
        { provide: getRepositoryToken(SaleLine), useValue: mockSaleLinesRepo },
        { provide: getRepositoryToken(Payment), useValue: mockPaymentsRepo },
        {
          provide: getRepositoryToken(SaleReturn),
          useValue: mockSaleReturnsRepo,
        },
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
        { provide: CustomersService, useValue: mockCustomersService },
        {
          provide: ProductUnitsService,
          useValue: mockProductUnitsService,
        },
        {
          provide: PhonePurchasesService,
          useValue: mockPhonePurchasesService,
        },
        { provide: ApprovalsService, useValue: mockApprovalsService },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('aggregates all completed sales for the selected Colombo date range', async () => {
    mockReadManager.query.mockResolvedValueOnce([{
      sales_count: 3,
      sales_amount: '12500.00',
      quantity_count: 7,
      cost_of_sales: '9000.00',
      return_count: 2,
      return_quantity: 3,
      voided_count: 1,
    }]);

    await expect(service.dailySummary({
      branchId: 'branch-1',
      from: '2026-10-20',
      to: '2026-10-25',
    })).resolves.toEqual({
      sales_count: 3,
      sales_amount: '12500.00',
      quantity_count: 7,
      cost_of_sales: '9000.00',
      return_count: 2,
      return_quantity: 3,
      voided_count: 1,
    });
    expect(mockReadManager.query).toHaveBeenCalledWith(
      expect.stringContaining("AT TIME ZONE 'Asia/Colombo'"),
      ['branch-1', '2026-10-20', '2026-10-25'],
    );
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
      mockCustomersService.findOne.mockResolvedValue({
        id: 'cust-1',
        deleted_at: null,
      });
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

    // ---- customer_id validation (Phase 6.3.5 Slice B) ----

    it('throws BadRequestException when customer_id refers to a nonexistent customer', async () => {
      mockUsersRepo.findOne.mockResolvedValue(seedCashier());
      mockBranchesRepo.findOne.mockResolvedValue(seedActiveBranch());
      mockCustomersService.findOne.mockRejectedValue(
        new NotFoundException('Customer not found'),
      );

      await expect(
        service.create(
          { branch_id: 'branch-1', customer_id: 'missing-cust' },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when customer_id refers to a soft-deleted customer', async () => {
      mockUsersRepo.findOne.mockResolvedValue(seedCashier());
      mockBranchesRepo.findOne.mockResolvedValue(seedActiveBranch());
      mockCustomersService.findOne.mockResolvedValue({
        id: 'deleted-cust',
        deleted_at: new Date(),
      });

      await expect(
        service.create(
          { branch_id: 'branch-1', customer_id: 'deleted-cust' },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not call customersService.findOne when customer_id is omitted', async () => {
      mockUsersRepo.findOne.mockResolvedValue(seedCashier());
      mockBranchesRepo.findOne.mockResolvedValue(seedActiveBranch());
      mockSalesRepo.create.mockImplementation((e) => e);
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.create({ branch_id: 'branch-1' }, 'cashier-1');

      expect(mockCustomersService.findOne).not.toHaveBeenCalled();
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

    it('adds return_state and refunded_total to each row (P7-18)', async () => {
      const sales = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([sales, 3]);
      mockSaleReturnsRepo.query.mockResolvedValue([
        { sale_id: 's1', quantity: 3, returned: 0, refunded: '0' },
        { sale_id: 's2', quantity: 3, returned: 1, refunded: '966.67' },
        { sale_id: 's3', quantity: 3, returned: 3, refunded: '2900' },
      ]);

      const result = await service.findAll({});

      expect(mockSaleReturnsRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('unnest($1::uuid[])'),
        [['s1', 's2', 's3']],
      );
      expect(result.data).toEqual([
        { id: 's1', return_state: 'NONE', refunded_total: '0.00' },
        { id: 's2', return_state: 'PARTIAL', refunded_total: '966.67' },
        { id: 's3', return_state: 'FULL', refunded_total: '2900.00' },
      ]);
    });

    it('skips the return-state query on an empty page', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockSaleReturnsRepo.query).not.toHaveBeenCalled();
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

    // Phase 6.4 P6: recent sales at the till
    it('joins the customer and keeps soft-deleted cashiers and customers', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockQueryBuilder.withDeleted).toHaveBeenCalled();
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'sale.customer',
        'customer',
      );
    });

    it('applies completedFrom (inclusive) and completedTo (exclusive) on completed_at', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({
        completedFrom: '2026-10-21T00:00:00+05:30',
        completedTo: '2026-10-22T00:00:00+05:30',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'sale.completed_at >= :completedFrom',
        { completedFrom: '2026-10-21T00:00:00+05:30' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'sale.completed_at < :completedTo',
        { completedTo: '2026-10-22T00:00:00+05:30' },
      );
    });

    it('sort=completed_at orders by completed_at DESC (drafts last), then created_at DESC', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ sort: 'completed_at' });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'sale.completed_at',
        'DESC',
        'NULLS LAST',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sale.created_at',
        'DESC',
      );
    });

    it('q adds one bracketed search condition', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ q: '0042' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.any(Brackets),
      );
    });
  });

  describe('findOne', () => {
    it('returns the sale with nested branch, cashier, customer, voider, void requester, lines, and payments (including soft-deleted relations)', async () => {
      const sale = {
        id: 's1',
        branch: {},
        cashier: {},
        customer: {},
        lines: [],
        payments: [],
      };
      mockSalesRepo.findOne.mockResolvedValue(sale);

      const result = await service.findOne('s1');

      expect(mockSalesRepo.findOne).toHaveBeenCalledWith({
        where: { id: 's1' },
        relations: [
          'branch',
          'cashier',
          'customer',
          'voider',
          'void_requester',
          'lines',
          'payments',
          'payments.trade_in_product',
        ],
        withDeleted: true,
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

    it('attaches returns, naming approver and requester by id and full_name only (P7-18)', async () => {
      mockSalesRepo.findOne.mockResolvedValue({ id: 's1', lines: [] });
      mockSaleReturnsQueryBuilder.getMany.mockResolvedValue([
        {
          id: 'ret-1',
          return_number: 'RET-20261024-0001',
          created_at: new Date('2026-10-24T05:00:00Z'),
          reason: 'Changed mind',
          override_reason: null,
          out_of_warranty: false,
          refund_due: '966.67',
          refund_total: '900.00',
          client_request_id: 'crid-1',
          approver: { id: 'm1', full_name: 'Manager One', email: 'x@t.com' },
          requester: { id: 'c1', full_name: 'Cashier One', role: 'cashier' },
          lines: [
            {
              id: 'rl-1',
              sale_return_id: 'ret-1',
              sale_line_id: 'line-1',
              quantity: 1,
              refund_share: '966.67',
              out_of_warranty: false,
              disposition: 'RESTOCKED',
              product_unit_id: null,
              sale_line: { id: 'line-1', line_number: 1 },
            },
          ],
          refunds: [
            {
              id: 'f-1',
              sale_return_id: 'ret-1',
              method: PaymentMethod.CASH,
              amount: '900.00',
              reference_number: null,
              original_payment_id: null,
              created_at: new Date(),
            },
          ],
        },
      ]);

      const result = await service.findOne('s1');

      expect(mockSaleReturnsQueryBuilder.where).toHaveBeenCalledWith(
        'ret.sale_id = :saleId',
        { saleId: 's1' },
      );
      expect(result.returns).toEqual([
        {
          id: 'ret-1',
          return_number: 'RET-20261024-0001',
          created_at: new Date('2026-10-24T05:00:00Z'),
          reason: 'Changed mind',
          override_reason: null,
          out_of_warranty: false,
          refund_due: '966.67',
          refund_total: '900.00',
          client_request_id: 'crid-1',
          approver: { id: 'm1', full_name: 'Manager One' },
          requester: { id: 'c1', full_name: 'Cashier One' },
          lines: [
            {
              sale_line_id: 'line-1',
              quantity: 1,
              refund_share: '966.67',
              out_of_warranty: false,
              disposition: 'RESTOCKED',
              product_unit: null,
            },
          ],
          refunds: [
            {
              method: PaymentMethod.CASH,
              amount: '900.00',
              reference_number: null,
              original_payment_id: null,
            },
          ],
        },
      ]);
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
      mockCustomersService.findOne.mockResolvedValue({
        id: 'cust-99',
        deleted_at: null,
      });
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', {
        customer_id: 'cust-99',
        notes: 'New notes',
      });

      expect(result.customer_id).toBe('cust-99');
      expect(result.notes).toBe('New notes');
    });

    it('drops the loaded customer relation before saving a new customer_id', async () => {
      // Regression: findOne loads `customer`; if it is still on the entity
      // at save(), TypeORM writes the old relation over the new FK.
      const sale = {
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: null,
        customer: null,
        notes: null,
      };
      mockSalesRepo.findOne.mockResolvedValue(sale);
      mockCustomersService.findOne.mockResolvedValue({
        id: 'cust-99',
        deleted_at: null,
      });
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.update('s1', { customer_id: 'cust-99' });

      const saved = mockSalesRepo.save.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(saved.customer_id).toBe('cust-99');
      expect('customer' in saved).toBe(false);
      // Re-read after save so the response has the fresh relation
      expect(mockSalesRepo.findOne).toHaveBeenCalledTimes(2);
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

    // ---- customer_id validation (Phase 6.3.5 Slice B) ----

    it('throws BadRequestException when updating to a nonexistent customer_id', async () => {
      mockSalesRepo.findOne.mockResolvedValue({
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: null,
      });
      mockCustomersService.findOne.mockRejectedValue(
        new NotFoundException('Customer not found'),
      );

      await expect(
        service.update('s1', { customer_id: 'missing-cust' }),
      ).rejects.toThrow(BadRequestException);

      // Sale should not be saved when validation fails
      expect(mockSalesRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when updating to a soft-deleted customer_id', async () => {
      mockSalesRepo.findOne.mockResolvedValue({
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: null,
      });
      mockCustomersService.findOne.mockResolvedValue({
        id: 'deleted-cust',
        deleted_at: new Date(),
      });

      await expect(
        service.update('s1', { customer_id: 'deleted-cust' }),
      ).rejects.toThrow(BadRequestException);

      expect(mockSalesRepo.save).not.toHaveBeenCalled();
    });

    it('does not call customersService.findOne when clearing customer_id (null)', async () => {
      const sale = {
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: 'cust-old',
      };
      mockSalesRepo.findOne.mockResolvedValue(sale);
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.update('s1', { customer_id: null });

      expect(mockCustomersService.findOne).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when detaching customer with a TRADE_IN payment present', async () => {
      mockSalesRepo.findOne.mockResolvedValue({
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: 'cust-1',
        payments: [
          { id: 'p1', payment_method: PaymentMethod.CASH },
          { id: 'p2', payment_method: PaymentMethod.TRADE_IN },
        ],
      });

      await expect(service.update('s1', { customer_id: null })).rejects.toThrow(
        /Cannot change or detach the customer/,
      );

      expect(mockSalesRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when reassigning customer with a TRADE_IN payment present', async () => {
      mockSalesRepo.findOne.mockResolvedValue({
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: 'cust-1',
        payments: [{ id: 'p1', payment_method: PaymentMethod.TRADE_IN }],
      });

      await expect(
        service.update('s1', { customer_id: 'cust-2' }),
      ).rejects.toThrow(/Cannot change or detach the customer/);

      // Refused before the reference lookup or any write
      expect(mockCustomersService.findOne).not.toHaveBeenCalled();
      expect(mockSalesRepo.save).not.toHaveBeenCalled();
    });

    it('allows re-sending the same customer_id on a sale with a TRADE_IN payment', async () => {
      const sale = {
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: 'cust-1',
        notes: null,
        payments: [{ id: 'p1', payment_method: PaymentMethod.TRADE_IN }],
      };
      mockSalesRepo.findOne.mockResolvedValue(sale);
      mockCustomersService.findOne.mockResolvedValue({
        id: 'cust-1',
        deleted_at: null,
      });
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', { customer_id: 'cust-1' });

      expect(result.customer_id).toBe('cust-1');
      expect(mockSalesRepo.save).toHaveBeenCalledTimes(1);
    });

    it('allows updating notes without customer_id on a sale with a TRADE_IN payment', async () => {
      const sale = {
        id: 's1',
        status: SaleStatus.DRAFT,
        customer_id: 'cust-1',
        notes: null,
        payments: [{ id: 'p1', payment_method: PaymentMethod.TRADE_IN }],
      };
      mockSalesRepo.findOne.mockResolvedValue(sale);
      mockSalesRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', { notes: 'Box included' });

      expect(result.notes).toBe('Box included');
      expect(result.customer_id).toBe('cust-1');
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
      is_serialized: boolean;
      default_warranty: WarrantyPeriod;
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
      total: string;
      amount_paid: string;
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
      product_unit_id: string | null;
      warranty: WarrantyPeriod;
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

    it("starts the line on the product's default warranty (P5-18)", async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ default_warranty: WarrantyPeriod.MONTH_12 }),
      );
      mockManager.create.mockImplementation((_entity, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        { product_id: 'prod-1', quantity: 1 },
        'cashier-1',
      );

      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({ warranty: WarrantyPeriod.MONTH_12 }),
      );
    });

    it('takes the warranty the cashier chose over the default (P5-18)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ default_warranty: WarrantyPeriod.MONTH_12 }),
      );
      mockManager.create.mockImplementation((_entity, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        { product_id: 'prod-1', quantity: 1, warranty: WarrantyPeriod.WEEK_1 },
        'cashier-1',
      );

      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({ warranty: WarrantyPeriod.WEEK_1 }),
      );
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

    // F3: 50% of 4.35 = 2.175 exactly; the float path gave 2.17.
    it('rounds an exact half-cent PERCENT discount up (F3: 50% of 4.35)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ selling_price: '4.35' }),
      );
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          discount_type: DiscountType.PERCENT,
          discount_value: 50,
        },
        'cashier-1',
      );

      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({
          discount_amount: '2.18',
          line_total: '2.17',
        }),
      );
    });

    describe('UNIT_PRICE discount (P5-20)', () => {
      const addAtPrice = (priceEach: number, quantity = 3) => {
        mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
        mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
        mockProductsService.findOne.mockResolvedValue(
          seedProduct({ selling_price: '200.00' }),
        );
        mockManager.create.mockImplementation((_e, data) => data);
        mockManager.save.mockImplementation((e) => Promise.resolve(e));
        return service.addLine(
          'sale-1',
          {
            product_id: 'prod-1',
            quantity,
            discount_type: DiscountType.UNIT_PRICE,
            discount_value: priceEach,
          },
          'cashier-1',
        );
      };

      it('takes (unit price − price each) × qty off the line', async () => {
        await addAtPrice(160);

        // (200 − 160) × 3 = 120 off; 160 × 3 = 480
        expect(mockManager.create).toHaveBeenCalledWith(
          SaleLine,
          expect.objectContaining({
            discount_type: DiscountType.UNIT_PRICE,
            discount_value: '160.00',
            discount_amount: '120.00',
            line_total: '480.00',
          }),
        );
      });

      it('is exact in cents (199.99 each × 3)', async () => {
        await addAtPrice(199.99);

        expect(mockManager.create).toHaveBeenCalledWith(
          SaleLine,
          expect.objectContaining({
            discount_amount: '0.03',
            line_total: '599.97',
          }),
        );
      });

      it('allows a price of 0 (free)', async () => {
        await addAtPrice(0);

        expect(mockManager.create).toHaveBeenCalledWith(
          SaleLine,
          expect.objectContaining({
            discount_amount: '600.00',
            line_total: '0.00',
          }),
        );
      });

      it('takes nothing off when the price equals the unit price', async () => {
        await addAtPrice(200);

        expect(mockManager.create).toHaveBeenCalledWith(
          SaleLine,
          expect.objectContaining({
            discount_amount: '0.00',
            line_total: '600.00',
          }),
        );
      });

      it('rejects a price above the unit price', async () => {
        await expect(addAtPrice(200.01)).rejects.toThrow(
          'Price each 200.01 must be between 0.00 and the unit price 200.00',
        );
        expect(mockManager.save).not.toHaveBeenCalled();
      });
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

    // F2: 100.10 * 3 = 300.29999... in floats, which used to reject a
    // discount equal to the full line subtotal.
    it('accepts an AMOUNT discount equal to the full subtotal (100.10 x 3)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ selling_price: '100.10' }),
      );
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 3,
          discount_type: DiscountType.AMOUNT,
          discount_value: 300.3,
        },
        'cashier-1',
      );

      expect(mockManager.create).toHaveBeenCalledWith(
        SaleLine,
        expect.objectContaining({
          discount_amount: '300.30',
          line_total: '0.00',
        }),
      );
    });

    it('rejects an AMOUNT discount one cent over the subtotal (100.10 x 3)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ selling_price: '100.10' }),
      );

      await expect(
        service.addLine(
          'sale-1',
          {
            product_id: 'prod-1',
            quantity: 3,
            discount_type: DiscountType.AMOUNT,
            discount_value: 300.31,
          },
          'cashier-1',
        ),
      ).rejects.toThrow('Discount amount 300.31 exceeds line subtotal 300.30');
      expect(mockManager.save).not.toHaveBeenCalled();
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

    it('keeps a UNIT_PRICE line at its price each when qty changes (P5-20)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(
        seedLine({
          unit_price: '200.00',
          quantity: 1,
          discount_type: DiscountType.UNIT_PRICE,
          discount_value: '160.00',
          discount_amount: '40.00',
          line_total: '160.00',
        }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateLine('sale-1', 'line-1', {
        quantity: 4,
      });

      // still 160 each: (200 − 160) × 4 = 160 off, 640 total
      expect(result.discount_value).toBe('160.00');
      expect(result.discount_amount).toBe('160.00');
      expect(result.line_total).toBe('640.00');
    });

    it('sets a UNIT_PRICE discount on an existing line (P5-20)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(
        seedLine({ unit_price: '100.00', quantity: 2 }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateLine('sale-1', 'line-1', {
        discount_type: DiscountType.UNIT_PRICE,
        discount_value: 75.5,
      });

      expect(result.discount_type).toBe(DiscountType.UNIT_PRICE);
      expect(result.discount_value).toBe('75.50');
      expect(result.discount_amount).toBe('49.00');
      expect(result.line_total).toBe('151.00');
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

    it('changes only the warranty, leaving the money as it was (P5-18)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(
        seedLine({
          unit_price: '100.00',
          quantity: 2,
          discount_amount: '0.00',
          line_total: '200.00',
          warranty: WarrantyPeriod.CHECKING,
        }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateLine('sale-1', 'line-1', {
        warranty: WarrantyPeriod.MONTH_6,
      });

      expect(result.warranty).toBe(WarrantyPeriod.MONTH_6);
      expect(result.quantity).toBe(2);
      expect(result.line_total).toBe('200.00');
    });

    it('changes the warranty on a serialized line too (P5-18)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue(
        seedLine({
          unit_price: '250000.00',
          quantity: 1,
          discount_amount: '0.00',
          line_total: '250000.00',
          product_unit_id: 'unit-1',
          imei_snapshot: '354789102345678',
          warranty: WarrantyPeriod.MONTH_12,
        }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateLine('sale-1', 'line-1', {
        warranty: WarrantyPeriod.MONTH_24,
      });

      expect(result.warranty).toBe(WarrantyPeriod.MONTH_24);
      expect(result.imei_snapshot).toBe('354789102345678');
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

    // ============================================================
    // Slice E — mode-aware updateLine
    // ============================================================

    // ---- Non-serialized: reject imei_snapshot set ----

    it('rejects setting imei_snapshot on a non-serialized line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: null,
        quantity: 2,
        unit_price: '100.00',
        discount_type: null,
        discount_value: null,
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: false }),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', {
          imei_snapshot: '354789102345678',
        }),
      ).rejects.toThrow(/is not serialized; imei_snapshot must not be set/);
    });

    it('allows clearing imei_snapshot on a non-serialized line (null → null no-op)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: null,
        quantity: 2,
        unit_price: '100.00',
        discount_type: null,
        discount_value: null,
        imei_snapshot: null,
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: false }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await expect(
        service.updateLine('sale-1', 'line-1', { imei_snapshot: null }),
      ).resolves.toBeDefined();
    });

    // ---- Serialized in-house: freezes ----

    it('rejects quantity != 1 on a serialized in-house line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: null,
        product_unit_id: 'unit-1',
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', { quantity: 2 }),
      ).rejects.toThrow(/quantity must be 1 for serialized product/);
    });

    it('allows quantity: 1 (no-op) on a serialized in-house line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: null,
        product_unit_id: 'unit-1',
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await expect(
        service.updateLine('sale-1', 'line-1', { quantity: 1 }),
      ).resolves.toBeDefined();
    });

    it('rejects external_supplier_id on a serialized in-house line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: null,
        product_unit_id: 'unit-1',
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', {
          external_supplier_id: 'supplier-1',
        }),
      ).rejects.toThrow(
        /Cannot change external_supplier_id on a serialized line/,
      );
    });

    it('rejects imei_snapshot change on a serialized in-house line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: null,
        product_unit_id: 'unit-1',
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
        imei_snapshot: '354789102345678',
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', {
          imei_snapshot: '999888777666555',
        }),
      ).rejects.toThrow(
        /Cannot change imei_snapshot on a serialized in-house line/,
      );
    });

    it('allows discount edit on a serialized in-house line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: null,
        product_unit_id: 'unit-1',
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.updateLine('sale-1', 'line-1', {
        discount_type: DiscountType.AMOUNT,
        discount_value: 5000,
      });

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          discount_type: DiscountType.AMOUNT,
          discount_value: '5000.00',
          discount_amount: '5000.00',
          line_total: '245000.00',
        }),
      );
    });

    // ---- Serialized external: allows imei_snapshot edit with collision check ----

    it('allows imei_snapshot edit on a serialized external line (no collision)', async () => {
      // getOne calls: 1) sale load, 2) collision check → null
      mockQueryBuilder.getOne
        .mockResolvedValueOnce(seedDraftSale({ branch_id: 'branch-1' }))
        .mockResolvedValueOnce(null);
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: 'supplier-1',
        product_unit_id: null,
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
        imei_snapshot: '111222333444555',
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      await service.updateLine('sale-1', 'line-1', {
        imei_snapshot: '999888777666555',
      });

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ imei_snapshot: '999888777666555' }),
      );
    });

    it('rejects imei_snapshot edit on external line if new IMEI matches IN_STOCK PU', async () => {
      mockQueryBuilder.getOne
        .mockResolvedValueOnce(seedDraftSale({ branch_id: 'branch-1' }))
        .mockResolvedValueOnce({
          id: 'unit-conflict',
          imei: '999888777666555',
          status: ProductUnitStatus.IN_STOCK,
          product_id: 'prod-inhouse',
          branch_id: 'branch-1',
        });
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: 'supplier-1',
        product_unit_id: null,
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
        imei_snapshot: '111222333444555',
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );

      try {
        await service.updateLine('sale-1', 'line-1', {
          imei_snapshot: '999888777666555',
        });
        fail('expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).getResponse()).toMatchObject({
          message: expect.stringContaining('currently in your stock'),
          existing_unit: {
            id: 'unit-conflict',
            product_id: 'prod-inhouse',
            branch_id: 'branch-1',
          },
        });
      }
    });

    it('rejects an external line IMEI the shop holds in any live status, naming the status (P7 step 0a)', async () => {
      mockQueryBuilder.getOne
        .mockResolvedValueOnce(seedDraftSale({ branch_id: 'branch-1' }))
        .mockResolvedValueOnce({
          id: 'unit-inspection',
          imei: '999888777666555',
          status: ProductUnitStatus.INSPECTION,
          product_id: 'prod-inhouse',
          branch_id: 'branch-1',
        });
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: 'supplier-1',
        product_unit_id: null,
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
        imei_snapshot: '111222333444555',
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', {
          imei_snapshot: '999888777666555',
        }),
      ).rejects.toMatchObject({
        response: {
          message:
            "IMEI '999888777666555' is currently in your stock (status: INSPECTION). " +
            'If you meant to sell your own inventory, remove external_supplier_id.',
          existing_unit: {
            id: 'unit-inspection',
            product_id: 'prod-inhouse',
            branch_id: 'branch-1',
          },
        },
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.status IN (:...statuses)',
        {
          statuses: [
            ProductUnitStatus.IN_STOCK,
            ProductUnitStatus.WRITTEN_OFF,
            ProductUnitStatus.INSPECTION,
          ],
        },
      );
    });

    it('rejects nulling imei_snapshot on a serialized external line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: 'supplier-1',
        product_unit_id: null,
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
        imei_snapshot: '111222333444555',
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', { imei_snapshot: null }),
      ).rejects.toThrow(
        /imei_snapshot is required for serialized external-sourced line/,
      );
    });

    it('rejects quantity change on a serialized external line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: 'supplier-1',
        product_unit_id: null,
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', { quantity: 3 }),
      ).rejects.toThrow(/quantity must be 1 for serialized product/);
    });

    it('rejects external_supplier_id change on a serialized external line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.findOne.mockResolvedValue({
        id: 'line-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        external_supplier_id: 'supplier-1',
        product_unit_id: null,
        quantity: 1,
        unit_price: '250000.00',
        discount_type: null,
        discount_value: null,
      });
      mockProductsService.findOne.mockResolvedValue(
        seedProduct({ is_serialized: true }),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', {
          external_supplier_id: 'supplier-OTHER',
        }),
      ).rejects.toThrow(
        /Cannot change external_supplier_id on a serialized line/,
      );
    });
  });

  // B2: when a line mutation drops sale.total below amount_paid, the
  // recompute UPDATE violates CHK_sales_amount_paid_bounded. The service
  // maps exactly that violation to a 400.
  describe('shrink below amount_paid', () => {
    const SHRINK_MESSAGE =
      'Cannot reduce the sale total below the amount already paid. ' +
      'Remove or reduce payments first.';

    const checkViolation = (constraint: string) =>
      new QueryFailedError(
        'UPDATE sales SET ...',
        ['sale-1'],
        Object.assign(new Error(`violates check constraint "${constraint}"`), {
          code: '23514',
          constraint,
        }),
      );

    beforeEach(() => {
      mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
      mockManager.save.mockImplementation((e) => Promise.resolve(e));
    });

    it('updateLine: reducing quantity → 400 with the shrink message', async () => {
      mockManager.findOne.mockResolvedValue(seedLine({ quantity: 2 }));
      mockManager.query.mockRejectedValueOnce(
        checkViolation('CHK_sales_amount_paid_bounded'),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', { quantity: 1 }),
      ).rejects.toThrow(new BadRequestException(SHRINK_MESSAGE));
    });

    it('updateLine: raising the discount → 400 with the shrink message', async () => {
      mockManager.findOne.mockResolvedValue(seedLine());
      mockManager.query.mockRejectedValueOnce(
        checkViolation('CHK_sales_amount_paid_bounded'),
      );

      await expect(
        service.updateLine('sale-1', 'line-1', {
          discount_type: DiscountType.AMOUNT,
          discount_value: 150,
        }),
      ).rejects.toThrow(new BadRequestException(SHRINK_MESSAGE));
    });

    it('removeLine → 400 with the shrink message', async () => {
      mockManager.findOne.mockResolvedValue(seedLine());
      mockManager.query.mockRejectedValueOnce(
        checkViolation('CHK_sales_amount_paid_bounded'),
      );

      await expect(service.removeLine('sale-1', 'line-1')).rejects.toThrow(
        new BadRequestException(SHRINK_MESSAGE),
      );
    });

    it('propagates a QueryFailedError on a different constraint unchanged', async () => {
      const other = checkViolation('CHK_sales_totals_nonneg');
      mockManager.findOne.mockResolvedValue(seedLine());
      mockManager.query.mockRejectedValueOnce(other);

      await expect(service.removeLine('sale-1', 'line-1')).rejects.toBe(other);
    });

    it('propagates a non-QueryFailedError unchanged', async () => {
      const boom = new Error('connection reset');
      mockManager.findOne.mockResolvedValue(seedLine({ quantity: 2 }));
      mockManager.query.mockRejectedValueOnce(boom);

      await expect(
        service.updateLine('sale-1', 'line-1', { quantity: 1 }),
      ).rejects.toBe(boom);
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

    // B1 repros: total - paid is not exact in floats (100.30 - 50.10 =
    // 50.199999...), so the exact remainder used to be rejected.
    it.each([
      ['100.30', '50.10', 50.2],
      ['2000.00', '1765.20', 234.8],
      ['150.60', '50.20', 100.4],
    ])(
      'allows the exact remainder when total %s, paid %s, paying %s',
      async (total, paid, amount) => {
        mockQueryBuilder.getOne.mockResolvedValueOnce({
          ...seedDraftSale(),
          total,
        });
        mockQueryBuilder.getRawOne.mockResolvedValue({ sum: paid });
        mockManager.create.mockImplementation((_e, data) => data);
        mockManager.save.mockImplementation((e) => Promise.resolve(e));

        await service.addPayment('sale-1', {
          payment_method: PaymentMethod.CASH,
          amount,
          cash_received: amount,
        });

        expect(mockManager.create).toHaveBeenCalledWith(
          Payment,
          expect.objectContaining({ amount: amount.toFixed(2) }),
        );
      },
    );

    it('still rejects one cent over the remainder, formatting 2 decimals', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '100.30',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '50.10' });

      await expect(
        service.addPayment('sale-1', {
          payment_method: PaymentMethod.CASH,
          amount: 50.21,
          cash_received: 50.21,
        }),
      ).rejects.toThrow('Payment amount 50.21 exceeds remaining balance 50.20');
      expect(mockManager.save).not.toHaveBeenCalled();
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
    // ---- TRADE_IN branch (Slice G) ----
    //
    // TRADE_IN payments carry additional fields and additional validation.
    // The DTO's trade_in_* fields are what addPayment checks; the actual
    // PhonePurchase / ProductUnit / Stock materialization happens later
    // at completeSale (via createForTradeIn) — none of that is exercised
    // in this block.

    // Common trade-in test setup: seed a DRAFT sale with a customer_id
    // and total, prime remainingBalance to zero. Individual tests
    // override sale fields as needed.
    const primeTradeInSale = (overrides?: {
      total?: string;
      customer_id?: string | null;
      branch_id?: string;
    }) => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: overrides?.total ?? '150000.00',
        customer_id:
          overrides?.customer_id === undefined
            ? 'cust-1'
            : overrides.customer_id,
        branch_id: overrides?.branch_id ?? 'branch-1',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });
    };

    // Prime the manager.findOne lookups of the TRADE_IN branch, in
    // order: Product and IMEI check (ProductUnit) inside
    // assertTradeInPaymentReferencesValid, then the customer's NIC
    // check (Customer, P4-13).
    const primeTradeInReferences = (overrides?: {
      product?: unknown;
      existingImei?: unknown;
      customer?: unknown;
    }) => {
      const defaultProduct = {
        id: 'prod-trade',
        branch_id: 'branch-1',
        is_serialized: true,
        is_active: true,
      };
      mockManager.findOne
        .mockResolvedValueOnce(
          overrides?.product === undefined ? defaultProduct : overrides.product,
        )
        .mockResolvedValueOnce(
          overrides?.existingImei === undefined ? null : overrides.existingImei,
        )
        .mockResolvedValueOnce(
          overrides?.customer === undefined
            ? { id: 'cust-1', nic: '199012345678' }
            : overrides.customer,
        );
    };

    const validTradeInDto = () => ({
      payment_method: PaymentMethod.TRADE_IN,
      amount: 60000,
      trade_in_product_id: 'prod-trade',
      trade_in_imei: '356938035643809',
      trade_in_buying_price: 60000,
      trade_in_selling_price: 75000,
      trade_in_notes: 'Trade-in notes',
    });

    it('inserts a TRADE_IN payment with all trade-in fields populated', async () => {
      primeTradeInSale();
      primeTradeInReferences();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'pay-trade-1', ...e }),
      );

      const result = await service.addPayment('sale-1', validTradeInDto());

      expect(mockManager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          sale_id: 'sale-1',
          payment_method: PaymentMethod.TRADE_IN,
          amount: '60000.00',
          cash_received: null,
          reference_number: null,
          trade_in_product_id: 'prod-trade',
          trade_in_imei: '356938035643809',
          trade_in_buying_price: '60000.00',
          trade_in_selling_price: '75000.00',
          trade_in_notes: 'Trade-in notes',
          // trade_in_phone_purchase_id stays null until completeSale
          trade_in_phone_purchase_id: null,
        }),
      );
      expect(result.id).toBe('pay-trade-1');
    });

    it('stores trade_in_selling_price and trade_in_notes as null when omitted', async () => {
      primeTradeInSale();
      primeTradeInReferences();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'pay-trade-2', ...e }),
      );

      const dto = validTradeInDto();
      delete (dto as Partial<typeof dto>).trade_in_selling_price;
      delete (dto as Partial<typeof dto>).trade_in_notes;

      await service.addPayment('sale-1', dto);

      expect(mockManager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          trade_in_selling_price: null,
          trade_in_notes: null,
        }),
      );
    });

    it('rejects TRADE_IN when amount does not equal trade_in_buying_price (Q2 lock)', async () => {
      primeTradeInSale();
      // No primeTradeInReferences — validation should fail before we
      // reach that step.

      await expect(
        service.addPayment('sale-1', {
          ...validTradeInDto(),
          amount: 60000,
          trade_in_buying_price: 55000, // mismatch
        }),
      ).rejects.toThrow(/must equal trade_in_buying_price/);

      // Reference validation should not have run
      expect(mockManager.findOne).not.toHaveBeenCalled();
    });

    it('rejects TRADE_IN when the sale has no customer', async () => {
      primeTradeInSale({ customer_id: null });

      await expect(
        service.addPayment('sale-1', validTradeInDto()),
      ).rejects.toThrow(/requires a customer on the sale/);

      // Reference validation should not have run
      expect(mockManager.findOne).not.toHaveBeenCalled();
    });

    it('rejects TRADE_IN when the customer has no NIC (P4-13), before any insert', async () => {
      primeTradeInSale();
      primeTradeInReferences({ customer: { id: 'cust-1', nic: null } });

      await expect(
        service.addPayment('sale-1', validTradeInDto()),
      ).rejects.toThrow("A trade-in needs the customer's NIC");

      expect(mockManager.findOne).toHaveBeenLastCalledWith(Customer, {
        where: { id: 'cust-1' },
        withDeleted: true,
      });
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('rejects TRADE_IN when required trade_in_product_id is missing', async () => {
      primeTradeInSale();
      const dto = validTradeInDto();
      delete (dto as Partial<typeof dto>).trade_in_product_id;

      await expect(service.addPayment('sale-1', dto)).rejects.toThrow(
        /TRADE_IN payments require/,
      );
    });

    it('rejects TRADE_IN when required trade_in_imei is missing', async () => {
      primeTradeInSale();
      const dto = validTradeInDto();
      delete (dto as Partial<typeof dto>).trade_in_imei;

      await expect(service.addPayment('sale-1', dto)).rejects.toThrow(
        /TRADE_IN payments require/,
      );
    });

    it('rejects TRADE_IN when required trade_in_buying_price is missing', async () => {
      primeTradeInSale();
      const dto = validTradeInDto();
      delete (dto as Partial<typeof dto>).trade_in_buying_price;

      await expect(service.addPayment('sale-1', dto)).rejects.toThrow(
        /TRADE_IN payments require/,
      );
    });

    it('rejects TRADE_IN when trade-in product does not exist', async () => {
      primeTradeInSale();
      mockManager.findOne.mockResolvedValueOnce(null); // product lookup fails

      await expect(
        service.addPayment('sale-1', validTradeInDto()),
      ).rejects.toThrow(/not found or inactive/);
    });

    it('rejects TRADE_IN when trade-in product is not serialized', async () => {
      primeTradeInSale();
      // Only product lookup runs; the IMEI check is after the product
      // serialized check which throws here. Queue only one findOne.
      mockManager.findOne.mockResolvedValueOnce({
        id: 'prod-trade',
        branch_id: 'branch-1',
        is_serialized: false,
        is_active: true,
      });

      await expect(
        service.addPayment('sale-1', validTradeInDto()),
      ).rejects.toThrow(/is not a serialized SKU/);
    });

    it('rejects TRADE_IN when trade-in product is inactive', async () => {
      primeTradeInSale();
      mockManager.findOne.mockResolvedValueOnce({
        id: 'prod-trade',
        branch_id: 'branch-1',
        is_serialized: true,
        is_active: false,
      });

      await expect(
        service.addPayment('sale-1', validTradeInDto()),
      ).rejects.toThrow('Trade-in product prod-trade not found or inactive');
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('rejects TRADE_IN when trade-in product belongs to a different branch', async () => {
      primeTradeInSale({ branch_id: 'branch-1' });
      mockManager.findOne.mockResolvedValueOnce({
        id: 'prod-trade',
        branch_id: 'branch-99',
        is_serialized: true,
        is_active: true,
      });

      await expect(
        service.addPayment('sale-1', validTradeInDto()),
      ).rejects.toThrow(/does not belong to branch/);
    });

    it('rejects TRADE_IN with 409 + existing_unit payload when IMEI collides', async () => {
      // Buy-back: only a unit the shop holds collides (SOLD no longer does).
      primeTradeInSale();
      mockManager.findOne
        .mockResolvedValueOnce({
          id: 'prod-trade',
          branch_id: 'branch-1',
          is_serialized: true,
          is_active: true,
        })
        .mockResolvedValueOnce({
          id: 'unit-99',
          status: 'IN_STOCK',
          product_id: 'prod-old',
        });

      try {
        await service.addPayment('sale-1', validTradeInDto());
        fail('Expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse() as {
          existing_unit: { id: string; status: string; product_id: string };
        };
        expect(response.existing_unit).toEqual({
          id: 'unit-99',
          status: 'IN_STOCK',
          product_id: 'prod-old',
        });
      }
    });

    it('checks the TRADE_IN IMEI against live units only (IN_STOCK, WRITTEN_OFF, INSPECTION)', async () => {
      primeTradeInSale();
      primeTradeInReferences();
      mockManager.create.mockImplementation((_e, data) => data);
      mockManager.save.mockImplementation((e) =>
        Promise.resolve({ id: 'pay-trade-live', ...e }),
      );

      await service.addPayment('sale-1', validTradeInDto());

      expect(mockManager.findOne).toHaveBeenCalledWith(ProductUnit, {
        where: {
          imei: '356938035643809',
          status: In([
            ProductUnitStatus.IN_STOCK,
            ProductUnitStatus.WRITTEN_OFF,
            ProductUnitStatus.INSPECTION,
          ]),
        },
      });
    });

    it('rejects non-TRADE_IN payments that carry trade-in fields', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '0' });

      await expect(
        service.addPayment('sale-1', {
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 500,
          trade_in_product_id: 'prod-trade', // <-- forbidden on CASH
        }),
      ).rejects.toThrow(/must not be set for CASH/);
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

    it('allows updating to the exact remainder (B1: no float drift)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '100.30',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({ amount: '10.00', cash_received: '10.00' }),
      );
      // SUM = 10.00 (this) + 50.10 (other). In floats the remainder is
      // 100.30 - (60.10 - 10.00) = 50.199999..., rejecting 50.20.
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '60.10' });
      mockManager.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updatePayment('sale-1', 'payment-1', {
        amount: 50.2,
        cash_received: 50.2,
      });

      expect(result.amount).toBe('50.20');
    });

    it('still rejects updating to one cent over the remainder', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '100.30',
      });
      mockManager.findOne.mockResolvedValue(
        seedPayment({ amount: '10.00', cash_received: '10.00' }),
      );
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '60.10' });

      await expect(
        service.updatePayment('sale-1', 'payment-1', {
          amount: 50.21,
          cash_received: 50.21,
        }),
      ).rejects.toThrow('Payment amount 50.21 exceeds remaining balance 50.20');
      expect(mockManager.save).not.toHaveBeenCalled();
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

    // ---- TRADE_IN freeze (Slice G, Q2 lock) ----
    //
    // TRADE_IN payments: only notes is editable. Any payment: trade_in_*
    // fields are never patchable (UpdatePaymentDto doesn't declare them,
    // so tests smuggle them in via a cast, as a raw JSON client would).

    const seedTradeInPayment = () => ({
      ...seedPayment({
        payment_method: PaymentMethod.TRADE_IN,
        amount: '60000.00',
        cash_received: null,
        reference_number: null,
      }),
      trade_in_product_id: 'prod-trade',
      trade_in_imei: '356938035643809',
      trade_in_buying_price: '60000.00',
      trade_in_selling_price: null,
      trade_in_notes: null,
      trade_in_phone_purchase_id: null,
    });

    const arrangeTradeInUpdate = () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '100000.00',
      });
      mockManager.findOne.mockResolvedValue(seedTradeInPayment());
      mockQueryBuilder.getRawOne.mockResolvedValue({ sum: '60000' });
      mockManager.save.mockImplementation((e) => Promise.resolve(e));
    };

    it('rejects amount changes on a TRADE_IN payment', async () => {
      arrangeTradeInUpdate();

      await expect(
        service.updatePayment('sale-1', 'payment-1', { amount: 55000 }),
      ).rejects.toThrow(/amount cannot be updated on a TRADE_IN payment/);
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('rejects cash_received changes on a TRADE_IN payment', async () => {
      arrangeTradeInUpdate();

      await expect(
        service.updatePayment('sale-1', 'payment-1', { cash_received: 60000 }),
      ).rejects.toThrow(
        /cash_received cannot be updated on a TRADE_IN payment/,
      );
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('rejects a smuggled trade_in_buying_price on a TRADE_IN payment', async () => {
      arrangeTradeInUpdate();

      await expect(
        service.updatePayment('sale-1', 'payment-1', {
          trade_in_buying_price: 55000,
        } as UpdatePaymentDto),
      ).rejects.toThrow(/trade_in_buying_price cannot be updated/);
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('allows notes changes on a TRADE_IN payment', async () => {
      arrangeTradeInUpdate();

      const result = await service.updatePayment('sale-1', 'payment-1', {
        notes: 'Customer collected charger separately',
      });

      expect(result.notes).toBe('Customer collected charger separately');
      expect(result.amount).toBe('60000.00'); // unchanged
      expect(result.trade_in_buying_price).toBe('60000.00'); // unchanged
      expect(mockManager.save).toHaveBeenCalled();
    });

    it('rejects a smuggled trade_in_* field on a non-TRADE_IN payment', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        ...seedDraftSale(),
        total: '500.00',
      });
      mockManager.findOne.mockResolvedValue(seedPayment());

      await expect(
        service.updatePayment('sale-1', 'payment-1', {
          notes: 'ok',
          trade_in_imei: '356938035643809',
        } as UpdatePaymentDto),
      ).rejects.toThrow(/trade_in_imei cannot be updated/);
      expect(mockManager.save).not.toHaveBeenCalled();
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
  // completeSale and voidSale each call manager.find twice: SaleLine
  // (outgoing loop) then Payment (TRADE_IN loop). Dispatch on entity so
  // each query gets its own fixture. Payments default to none.
  const arrangeManagerFind = (
    lines: unknown[],
    tradeInPayments: unknown[] = [],
  ) => {
    mockManager.find.mockImplementation((entity: unknown) =>
      Promise.resolve(
        entity === SaleLine ? lines : entity === Payment ? tradeInPayments : [],
      ),
    );
  };

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
      arrangeManagerFind([
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
      arrangeManagerFind([
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
      arrangeManagerFind([]);

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
      arrangeManagerFind([seedCompletableLine()]);

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
      arrangeManagerFind([seedCompletableLine()]);
      mockStockService.decrementForSale.mockResolvedValue(undefined);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-20260910-0003',
      );

      await expect(service.completeSale('sale-1')).resolves.toBeUndefined();
    });

    it('propagates ConflictException from StockService (insufficient stock rolls back)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      arrangeManagerFind([
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
      arrangeManagerFind([seedCompletableLine()]);
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
      arrangeManagerFind([
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

    // ============================================================
    // Slice E — PU flip on completeSale
    // ============================================================

    it('flips PU to SOLD for each serialized in-house line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.DRAFT,
          total: '250000.00',
          amount_paid: '250000.00',
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-1',
          product_id: 'prod-1',
          quantity: 1,
          product_name_snapshot: 'iPhone 15',
          external_supplier_id: null,
          product_unit_id: 'unit-1',
        },
      ]);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000001',
      );

      await service.completeSale('sale-1');

      expect(mockStockService.decrementForSale).toHaveBeenCalledWith(
        expect.anything(),
        'prod-1',
        'branch-1',
        1,
        'iPhone 15',
      );
      expect(mockProductUnitsService.markSoldForSale).toHaveBeenCalledWith(
        expect.anything(),
        'unit-1',
      );
    });

    it('skips PU flip for external-sourced serialized lines (no product_unit_id)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.DRAFT,
          total: '250000.00',
          amount_paid: '250000.00',
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-1',
          product_id: 'prod-1',
          quantity: 1,
          product_name_snapshot: 'iPhone 15',
          external_supplier_id: 'supplier-1',
          product_unit_id: null,
        },
      ]);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000001',
      );

      await service.completeSale('sale-1');

      expect(mockStockService.decrementForSale).not.toHaveBeenCalled();
      expect(mockProductUnitsService.markSoldForSale).not.toHaveBeenCalled();
    });

    it('skips PU flip for non-serialized in-house lines', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.DRAFT,
          total: '1000.00',
          amount_paid: '1000.00',
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-1',
          product_id: 'prod-1',
          quantity: 5,
          product_name_snapshot: 'Charger',
          external_supplier_id: null,
          product_unit_id: null,
        },
      ]);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000001',
      );

      await service.completeSale('sale-1');

      expect(mockStockService.decrementForSale).toHaveBeenCalled(); // stock yes
      expect(mockProductUnitsService.markSoldForSale).not.toHaveBeenCalled(); // PU no
    });

    it('handles a mixed sale (serialized in-house + non-serialized + external serialized)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.DRAFT,
          total: '500000.00',
          amount_paid: '500000.00',
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-a',
          product_id: 'prod-A',
          quantity: 1,
          product_name_snapshot: 'iPhone 15 (in-house)',
          external_supplier_id: null,
          product_unit_id: 'unit-A',
        },
        {
          id: 'line-b',
          product_id: 'prod-B',
          quantity: 3,
          product_name_snapshot: 'Charger',
          external_supplier_id: null,
          product_unit_id: null,
        },
        {
          id: 'line-c',
          product_id: 'prod-C',
          quantity: 1,
          product_name_snapshot: 'iPhone 12 (external)',
          external_supplier_id: 'supplier-1',
          product_unit_id: null,
        },
      ]);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000001',
      );

      await service.completeSale('sale-1');

      // Stock decrement fires for line-a (in-house serialized) and line-b
      // (non-serialized in-house). NOT for line-c (external).
      expect(mockStockService.decrementForSale).toHaveBeenCalledTimes(2);
      expect(mockStockService.decrementForSale).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        'prod-A',
        'branch-1',
        1,
        'iPhone 15 (in-house)',
      );
      expect(mockStockService.decrementForSale).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        'prod-B',
        'branch-1',
        3,
        'Charger',
      );

      // PU flip fires only for line-a (serialized in-house).
      expect(mockProductUnitsService.markSoldForSale).toHaveBeenCalledTimes(1);
      expect(mockProductUnitsService.markSoldForSale).toHaveBeenCalledWith(
        expect.anything(),
        'unit-A',
      );
    });

    it('propagates ConflictException from markSoldForSale (cross-DRAFT race)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.DRAFT,
          total: '250000.00',
          amount_paid: '250000.00',
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-1',
          product_id: 'prod-1',
          quantity: 1,
          product_name_snapshot: 'iPhone 15',
          external_supplier_id: null,
          product_unit_id: 'unit-1',
        },
      ]);
      mockProductUnitsService.markSoldForSale.mockRejectedValue(
        new ConflictException({
          message: "IMEI 'X' is not available (status: SOLD)",
          existing_unit: {
            id: 'unit-1',
            status: ProductUnitStatus.SOLD,
            product_id: 'prod-1',
            branch_id: 'branch-1',
          },
        }),
      );

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        ConflictException,
      );
      // sale_number should not have been issued if the flip fails
      expect(mockSaleNumberCountersService.generateNext).not.toHaveBeenCalled();
    });

    it('locks Stock before PU per line (Q4 ordering)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.DRAFT,
          total: '250000.00',
          amount_paid: '250000.00',
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-1',
          product_id: 'prod-1',
          quantity: 1,
          product_name_snapshot: 'iPhone 15',
          external_supplier_id: null,
          product_unit_id: 'unit-1',
        },
      ]);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000001',
      );

      const callOrder: string[] = [];
      mockStockService.decrementForSale.mockImplementation(() => {
        callOrder.push('stock');
        return Promise.resolve();
      });
      mockProductUnitsService.markSoldForSale.mockImplementation(() => {
        callOrder.push('pu');
        return Promise.resolve();
      });

      await service.completeSale('sale-1');

      expect(callOrder).toEqual(['stock', 'pu']);
    });

    // ============================================================
    // Slice G — trade-in materialization on completeSale
    // ============================================================

    const seedTradeInSale = (overrides: Record<string, unknown> = {}) =>
      seedCompletableSale({
        cashier_id: 'cashier-1',
        customer_id: 'cust-1',
        total: '60000.00',
        amount_paid: '60000.00',
        ...overrides,
      });

    const seedTradeInRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'pay-ti-1',
      sale_id: 'sale-1',
      payment_method: PaymentMethod.TRADE_IN,
      amount: '60000.00',
      cash_received: null,
      reference_number: null,
      trade_in_product_id: 'prod-used',
      trade_in_imei: '356938035643809',
      trade_in_buying_price: '60000.00',
      trade_in_selling_price: '75000.00',
      trade_in_notes: 'Screen scratch',
      trade_in_phone_purchase_id: null,
      ...overrides,
    });

    // The NIC check (P4-13) runs once per sale with trade-ins, before
    // the materialize loop: one Customer lookup through the manager.
    const arrangeTradeInCustomer = (nic: string | null = '199012345678') => {
      mockManager.findOne.mockResolvedValueOnce({ id: 'cust-1', nic });
    };

    const arrangeCreateForTradeIn = () => {
      let n = 0;
      mockPhonePurchasesService.createForTradeIn.mockImplementation(() => {
        n++;
        return Promise.resolve({
          phone_purchase: { id: `pp-${n}` },
          product_unit: { id: `unit-ti-${n}` },
        });
      });
    };

    it('materializes a TRADE_IN-only sale and stamps the phone purchase id', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedTradeInSale());
      arrangeManagerFind(
        [seedCompletableLine({ quantity: 1 })],
        [seedTradeInRow()],
      );
      arrangeTradeInCustomer();
      arrangeCreateForTradeIn();
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000010',
      );

      await service.completeSale('sale-1');

      expect(mockManager.find).toHaveBeenCalledWith(Payment, {
        where: { sale_id: 'sale-1', payment_method: PaymentMethod.TRADE_IN },
        order: { created_at: 'ASC' },
      });
      expect(mockPhonePurchasesService.createForTradeIn).toHaveBeenCalledWith(
        mockManager,
        {
          customer_id: 'cust-1',
          branch_id: 'branch-1',
          cashier_id: 'cashier-1',
          product_id: 'prod-used',
          imei: '356938035643809',
          buying_price: '60000.00',
          selling_price: '75000.00',
          notes: 'Screen scratch',
        },
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        ['pp-1', 'pay-ti-1'],
      );
    });

    it('materializes TRADE_IN alongside CASH (only the TRADE_IN row is passed through)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedTradeInSale({ total: '100000.00', amount_paid: '100000.00' }),
      );
      // The Payment query filters to TRADE_IN at the DB, so the CASH row
      // never reaches the loop — the fixture mirrors that.
      arrangeManagerFind(
        [seedCompletableLine({ quantity: 1 })],
        [
          seedTradeInRow({
            trade_in_selling_price: null,
            trade_in_notes: null,
          }),
        ],
      );
      arrangeTradeInCustomer();
      arrangeCreateForTradeIn();
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000011',
      );

      await service.completeSale('sale-1');

      expect(mockPhonePurchasesService.createForTradeIn).toHaveBeenCalledTimes(
        1,
      );
      expect(mockPhonePurchasesService.createForTradeIn).toHaveBeenCalledWith(
        mockManager,
        expect.objectContaining({ selling_price: null, notes: null }),
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sales'),
        [SaleStatus.COMPLETED, 'INV-000011', 'sale-1'],
      );
    });

    it('materializes and stamps each of two TRADE_IN payments with distinct IMEIs', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedTradeInSale({ total: '100000.00', amount_paid: '100000.00' }),
      );
      arrangeManagerFind(
        [seedCompletableLine({ quantity: 1 })],
        [
          seedTradeInRow(),
          seedTradeInRow({
            id: 'pay-ti-2',
            amount: '40000.00',
            trade_in_imei: '490154203237518',
            trade_in_buying_price: '40000.00',
          }),
        ],
      );
      arrangeTradeInCustomer();
      arrangeCreateForTradeIn();
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000012',
      );

      await service.completeSale('sale-1');

      expect(mockPhonePurchasesService.createForTradeIn).toHaveBeenCalledTimes(
        2,
      );
      expect(
        mockPhonePurchasesService.createForTradeIn,
      ).toHaveBeenNthCalledWith(
        2,
        mockManager,
        expect.objectContaining({
          imei: '490154203237518',
          buying_price: '40000.00',
        }),
      );
      // Each payment is stamped with its own phone purchase
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        ['pp-1', 'pay-ti-1'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        ['pp-2', 'pay-ti-2'],
      );
    });

    it('propagates ConflictException from createForTradeIn (IMEI collision rolls back)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedTradeInSale());
      arrangeManagerFind(
        [seedCompletableLine({ quantity: 1 })],
        [seedTradeInRow()],
      );
      arrangeTradeInCustomer();
      mockPhonePurchasesService.createForTradeIn.mockRejectedValue(
        new ConflictException({
          message: "IMEI '356938035643809' already exists",
          existing_unit: { id: 'unit-x', status: ProductUnitStatus.IN_STOCK },
        }),
      );

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        ConflictException,
      );

      // No stamp, no sale_number, no COMPLETED flip
      expect(mockManager.query).not.toHaveBeenCalled();
      expect(mockSaleNumberCountersService.generateNext).not.toHaveBeenCalled();
    });

    it('rejects with 400 when the customer was cleared after a TRADE_IN was added', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedTradeInSale({ customer_id: null }),
      );
      arrangeManagerFind(
        [seedCompletableLine({ quantity: 1 })],
        [seedTradeInRow()],
      );

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        /TRADE_IN payments require a customer/,
      );
      expect(mockPhonePurchasesService.createForTradeIn).not.toHaveBeenCalled();
      expect(mockSaleNumberCountersService.generateNext).not.toHaveBeenCalled();
    });

    it("rejects with 400 when the customer's NIC was cleared after a TRADE_IN was added (P4-13)", async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedTradeInSale());
      arrangeManagerFind(
        [seedCompletableLine({ quantity: 1 })],
        [
          seedTradeInRow(),
          seedTradeInRow({ id: 'pay-ti-2', trade_in_imei: '352810061234569' }),
        ],
      );
      arrangeTradeInCustomer(null);

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        "A trade-in needs the customer's NIC",
      );
      expect(mockManager.findOne).toHaveBeenCalledTimes(1);
      expect(mockManager.findOne).toHaveBeenCalledWith(Customer, {
        where: { id: 'cust-1' },
        withDeleted: true,
      });
      expect(mockPhonePurchasesService.createForTradeIn).not.toHaveBeenCalled();
      expect(mockManager.query).not.toHaveBeenCalled();
      expect(mockSaleNumberCountersService.generateNext).not.toHaveBeenCalled();
    });

    it('runs the trade-in loop after the outgoing loop and before issuing sale_number', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedTradeInSale());
      arrangeManagerFind(
        [
          {
            ...seedCompletableLine({ quantity: 1 }),
            product_unit_id: 'unit-out',
          },
        ],
        [seedTradeInRow()],
      );
      arrangeTradeInCustomer();

      const callOrder: string[] = [];
      mockStockService.decrementForSale.mockImplementation(() => {
        callOrder.push('stock');
        return Promise.resolve();
      });
      mockProductUnitsService.markSoldForSale.mockImplementation(() => {
        callOrder.push('pu');
        return Promise.resolve();
      });
      mockPhonePurchasesService.createForTradeIn.mockImplementation(() => {
        callOrder.push('trade-in');
        return Promise.resolve({
          phone_purchase: { id: 'pp-1' },
          product_unit: { id: 'unit-ti-1' },
        });
      });
      mockManager.query.mockImplementation((sql: string) => {
        callOrder.push(
          sql.includes('UPDATE payments')
            ? 'stamp'
            : sql.includes('UPDATE sale_lines')
              ? 'warranty'
              : 'sale',
        );
        return Promise.resolve();
      });
      mockSaleNumberCountersService.generateNext.mockImplementation(() => {
        callOrder.push('number');
        return Promise.resolve('INV-000013');
      });

      await service.completeSale('sale-1');

      expect(callOrder).toEqual([
        'stock',
        'pu',
        'trade-in',
        'stamp',
        'number',
        'warranty',
        'sale',
      ]);
    });

    it('skips the trade-in loop when the sale has no TRADE_IN payments', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      arrangeManagerFind([seedCompletableLine()]);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000014',
      );

      await service.completeSale('sale-1');

      expect(mockPhonePurchasesService.createForTradeIn).not.toHaveBeenCalled();
      expect(mockManager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        expect.anything(),
      );
    });

    // ============================================================
    // Phase 6.4 P5 — warranty_until (P5-18), 409 details (P5-2)
    // ============================================================

    it("sets each line's warranty_until from its period in one UPDATE", async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      arrangeManagerFind([
        seedCompletableLine(),
        seedCompletableLine({ id: 'line-2', product_id: 'prod-2' }),
      ]);
      mockStockService.decrementForSale.mockResolvedValue(undefined);
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-000015',
      );

      await service.completeSale('sale-1');

      const warrantyCalls = mockManager.query.mock.calls.filter(
        ([sql]: [string]) => sql.includes('UPDATE sale_lines'),
      );
      expect(warrantyCalls).toHaveLength(1);
      const [sql, params] = warrantyCalls[0] as [string, unknown[]];
      expect(sql).toContain('SET warranty_until = CASE warranty');
      // The Colombo completion date: the same now() completed_at gets
      expect(sql).toContain("(now() AT TIME ZONE 'Asia/Colombo')::date");
      expect(sql).toContain("WHEN 'WEEK_1' THEN");
      expect(sql).toContain("interval '12 months'");
      expect(sql).toContain('ELSE NULL END');
      expect(params).toEqual(['sale-1']);
    });

    it('does not set warranty_until when the complete fails (insufficient stock)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      arrangeManagerFind([seedCompletableLine()]);
      mockStockService.decrementForSale.mockRejectedValueOnce(
        new ConflictException({
          message:
            'Insufficient stock for "iPhone 15": requested 2, available 0',
          product_id: 'prod-1',
        }),
      );

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        ConflictException,
      );
      expect(mockManager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sale_lines'),
        expect.anything(),
      );
    });

    it('adds the sale_line_id to the insufficient-stock 409', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      arrangeManagerFind([
        seedCompletableLine({ id: 'line-1', product_id: 'prod-1' }),
        seedCompletableLine({ id: 'line-2', product_id: 'prod-2' }),
      ]);
      mockStockService.decrementForSale
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new ConflictException({
            message:
              'Insufficient stock for "AirPods": requested 2, available 1',
            product_id: 'prod-2',
          }),
        );

      const err = await service.completeSale('sale-1').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual({
        message: 'Insufficient stock for "AirPods": requested 2, available 1',
        product_id: 'prod-2',
        sale_line_id: 'line-2',
      });
    });

    it('keeps the message of a plain-string 409 when adding the line id', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      arrangeManagerFind([seedCompletableLine({ id: 'line-1' })]);
      mockStockService.decrementForSale.mockRejectedValueOnce(
        new ConflictException('Insufficient stock'),
      );

      const err = await service.completeSale('sale-1').catch((e: unknown) => e);

      expect((err as ConflictException).getResponse()).toMatchObject({
        message: 'Insufficient stock',
        sale_line_id: 'line-1',
      });
    });

    it('passes non-409 errors from the stock decrement through unchanged', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedCompletableSale());
      arrangeManagerFind([seedCompletableLine()]);
      const integrity = new Error('Stock row missing for product prod-1');
      mockStockService.decrementForSale.mockRejectedValueOnce(integrity);

      await expect(service.completeSale('sale-1')).rejects.toBe(integrity);
    });

    it('adds the payment_id of the colliding trade-in to its 409', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedTradeInSale({ total: '100000.00', amount_paid: '100000.00' }),
      );
      arrangeManagerFind(
        [seedCompletableLine({ quantity: 1 })],
        [
          seedTradeInRow(),
          seedTradeInRow({ id: 'pay-ti-2', trade_in_imei: '490154203237518' }),
        ],
      );
      arrangeTradeInCustomer();
      mockStockService.decrementForSale.mockResolvedValue(undefined);
      mockPhonePurchasesService.createForTradeIn
        .mockResolvedValueOnce({
          phone_purchase: { id: 'pp-1' },
          product_unit: { id: 'unit-ti-1' },
        })
        .mockRejectedValueOnce(
          new ConflictException({
            message: 'IMEI already exists in inventory',
            imei: '490154203237518',
            existing_unit: null,
          }),
        );

      const err = await service.completeSale('sale-1').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual({
        message: 'IMEI already exists in inventory',
        imei: '490154203237518',
        existing_unit: null,
        payment_id: 'pay-ti-2',
      });
      expect(mockSaleNumberCountersService.generateNext).not.toHaveBeenCalled();
    });

    it('passes a 400 from createForTradeIn (inactive product) through unchanged', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedTradeInSale());
      arrangeManagerFind(
        [seedCompletableLine({ quantity: 1 })],
        [seedTradeInRow()],
      );
      arrangeTradeInCustomer();
      const inactive = new BadRequestException(
        'Product "Used iPhone 12 128GB" is inactive',
      );
      mockStockService.decrementForSale.mockResolvedValue(undefined);
      mockPhonePurchasesService.createForTradeIn.mockRejectedValueOnce(
        inactive,
      );

      await expect(service.completeSale('sale-1')).rejects.toBe(inactive);
    });
  });

  describe('global lock order (Phase 6.4 P7-25)', () => {
    const lockMock = lockInventoryRows as jest.MockedFunction<
      typeof lockInventoryRows
    >;

    const tradeInPayment = {
      id: 'pay-ti-1',
      sale_id: 'sale-1',
      payment_method: PaymentMethod.TRADE_IN,
      amount: '100.00',
      trade_in_product_id: 'prod-used',
      trade_in_imei: '356938035643809',
      trade_in_buying_price: '100.00',
      trade_in_selling_price: null,
      trade_in_notes: null,
      trade_in_phone_purchase_id: 'pp-1',
    };

    // Line 1: in-house, serialized. Line 2: from another shop. Line 3:
    // in-house, not serialized.
    const lines = [
      {
        id: 'line-1',
        sale_id: 'sale-1',
        line_number: 1,
        product_id: 'prod-1',
        product_name_snapshot: 'iPhone 15',
        quantity: 1,
        external_supplier_id: null,
        product_unit_id: 'unit-1',
      },
      {
        id: 'line-2',
        sale_id: 'sale-1',
        line_number: 2,
        product_id: 'prod-2',
        product_name_snapshot: 'Case (other shop)',
        quantity: 1,
        external_supplier_id: 'sup-1',
        product_unit_id: null,
      },
      {
        id: 'line-3',
        sale_id: 'sale-1',
        line_number: 3,
        product_id: 'prod-3',
        product_name_snapshot: 'Cable',
        quantity: 2,
        external_supplier_id: null,
        product_unit_id: null,
      },
    ];

    it('completeSale locks the in-house lines and trade-ins stock, then the lines units, before any change', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.DRAFT,
        branch_id: 'branch-1',
        cashier_id: 'cashier-1',
        customer_id: 'cust-1',
        total: '500.00',
        amount_paid: '500.00',
      });
      arrangeManagerFind(lines, [
        { ...tradeInPayment, trade_in_phone_purchase_id: null },
      ]);
      mockManager.findOne.mockResolvedValue({
        id: 'cust-1',
        nic: '199012345678',
      });
      mockStockService.decrementForSale.mockResolvedValue(undefined);
      mockProductUnitsService.markSoldForSale.mockResolvedValue(undefined);
      mockPhonePurchasesService.createForTradeIn.mockResolvedValue({
        phone_purchase: { id: 'pp-1' },
        product_unit: { id: 'unit-ti' },
      });
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-20261023-0001',
      );
      mockManager.query.mockResolvedValue(undefined);

      await service.completeSale('sale-1');

      expect(lockMock).toHaveBeenCalledTimes(1);
      expect(lockMock).toHaveBeenCalledWith(mockManager, {
        stock: [
          { productId: 'prod-1', branchId: 'branch-1' },
          { productId: 'prod-3', branchId: 'branch-1' },
          { productId: 'prod-used', branchId: 'branch-1' },
        ],
        unitIds: ['unit-1'],
      });
      expect(lockMock.mock.invocationCallOrder[0]).toBeLessThan(
        mockStockService.decrementForSale.mock.invocationCallOrder[0],
      );
      expect(lockMock.mock.invocationCallOrder[0]).toBeLessThan(
        mockPhonePurchasesService.createForTradeIn.mock.invocationCallOrder[0],
      );
    });

    it('completeSale takes no inventory locks when a check fails first', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.DRAFT,
        branch_id: 'branch-1',
        total: '500.00',
        amount_paid: '400.00',
      });
      arrangeManagerFind(lines);

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(lockMock).not.toHaveBeenCalled();
    });

    it('voidSale locks the lines and trade-in units stock, then the lines and trade-in units, before any change', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.COMPLETED,
        branch_id: 'branch-1',
      });
      arrangeManagerFind(lines, [tradeInPayment]);
      const tradeInUnit = {
        id: 'unit-ti',
        product_id: 'prod-used',
        branch_id: 'branch-1',
        status: ProductUnitStatus.IN_STOCK,
      };
      mockManager.findOne.mockResolvedValue(tradeInUnit);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockStockService.decrementForVoidedTradeIn.mockResolvedValue(undefined);
      mockProductUnitsService.markAvailableForReversal.mockResolvedValue(
        undefined,
      );
      mockProductUnitsService.markReturnedForVoid.mockResolvedValue(
        tradeInUnit,
      );
      mockManager.query.mockResolvedValue(undefined);

      await service.voidSale('sale-1', voidApproval, {
        void_reason: 'Wrong item rung up',
      });

      expect(mockManager.findOne).toHaveBeenCalledWith(ProductUnit, {
        where: { phone_purchase_id: 'pp-1' },
      });
      expect(lockMock).toHaveBeenCalledTimes(1);
      expect(lockMock).toHaveBeenCalledWith(mockManager, {
        stock: [
          { productId: 'prod-1', branchId: 'branch-1' },
          { productId: 'prod-3', branchId: 'branch-1' },
          { productId: 'prod-used', branchId: 'branch-1' },
        ],
        unitIds: ['unit-1', 'unit-ti'],
      });
      expect(lockMock.mock.invocationCallOrder[0]).toBeLessThan(
        mockStockService.incrementForReversal.mock.invocationCallOrder[0],
      );
      // The unit found for locking is the one step 5b reverses (one read).
      expect(mockManager.findOne).toHaveBeenCalledTimes(1);
      expect(mockProductUnitsService.markReturnedForVoid).toHaveBeenCalledWith(
        mockManager,
        'unit-ti',
      );
    });

    it('voidSale takes no inventory locks when the sale is not COMPLETED', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.VOIDED,
        branch_id: 'branch-1',
      });

      await expect(
        service.voidSale('sale-1', voidApproval, {
          void_reason: 'Wrong item rung up',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(lockMock).not.toHaveBeenCalled();
    });

    // ---- Today's cash day: lock-order step 4 (Phase 6.4 P9-9, P9-10) ----

    const dayMock = assertDayOpen as jest.MockedFunction<typeof assertDayOpen>;
    const dayClosed = () =>
      new ConflictException({
        message: 'Today (2026-10-25) is closed.',
        code: 'DAY_CLOSED',
        business_date: '2026-10-25',
      });

    it('completeSale takes todays cash day FOR SHARE after the inventory locks and before any change', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.DRAFT,
        branch_id: 'branch-1',
        cashier_id: 'cashier-1',
        customer_id: 'cust-1',
        total: '500.00',
        amount_paid: '500.00',
      });
      arrangeManagerFind(lines, [
        { ...tradeInPayment, trade_in_phone_purchase_id: null },
      ]);
      mockManager.findOne.mockResolvedValue({
        id: 'cust-1',
        nic: '199012345678',
      });
      mockPhonePurchasesService.createForTradeIn.mockResolvedValue({
        phone_purchase: { id: 'pp-1' },
        product_unit: { id: 'unit-ti' },
      });
      mockSaleNumberCountersService.generateNext.mockResolvedValue(
        'INV-20261023-0001',
      );
      mockManager.query.mockResolvedValue(undefined);

      await service.completeSale('sale-1');

      expect(dayMock).toHaveBeenCalledTimes(1);
      expect(dayMock).toHaveBeenCalledWith(mockManager, 'branch-1', {
        lock: true,
      });
      const day = dayMock.mock.invocationCallOrder[0];
      expect(lockMock.mock.invocationCallOrder[0]).toBeLessThan(day);
      expect(day).toBeLessThan(
        mockStockService.decrementForSale.mock.invocationCallOrder[0],
      );
      expect(day).toBeLessThan(
        mockProductUnitsService.markSoldForSale.mock.invocationCallOrder[0],
      );
      expect(day).toBeLessThan(
        mockPhonePurchasesService.createForTradeIn.mock.invocationCallOrder[0],
      );
      expect(day).toBeLessThan(
        mockSaleNumberCountersService.generateNext.mock.invocationCallOrder[0],
      );
      expect(day).toBeLessThan(mockManager.query.mock.invocationCallOrder[0]);
    });

    it('completeSale refused by the day gate changes nothing', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.DRAFT,
        branch_id: 'branch-1',
        customer_id: 'cust-1',
        total: '500.00',
        amount_paid: '500.00',
      });
      arrangeManagerFind(lines, [
        { ...tradeInPayment, trade_in_phone_purchase_id: null },
      ]);
      dayMock.mockRejectedValueOnce(dayClosed());

      const err = await service.completeSale('sale-1').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        code: 'DAY_CLOSED',
        business_date: '2026-10-25',
      });
      expect(mockStockService.decrementForSale).not.toHaveBeenCalled();
      expect(mockProductUnitsService.markSoldForSale).not.toHaveBeenCalled();
      expect(mockPhonePurchasesService.createForTradeIn).not.toHaveBeenCalled();
      expect(mockSaleNumberCountersService.generateNext).not.toHaveBeenCalled();
      expect(mockManager.query).not.toHaveBeenCalled();
    });

    it('completeSale does not reach the day gate when a check fails first', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.DRAFT,
        branch_id: 'branch-1',
        total: '500.00',
        amount_paid: '400.00',
      });
      arrangeManagerFind(lines);

      await expect(service.completeSale('sale-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(dayMock).not.toHaveBeenCalled();
    });

    it('voidSale takes todays cash day FOR SHARE after the inventory locks and before any change', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.COMPLETED,
        branch_id: 'branch-1',
      });
      arrangeManagerFind(lines, [tradeInPayment]);
      const tradeInUnit = {
        id: 'unit-ti',
        product_id: 'prod-used',
        branch_id: 'branch-1',
        status: ProductUnitStatus.IN_STOCK,
      };
      mockManager.findOne.mockResolvedValue(tradeInUnit);
      mockProductUnitsService.markReturnedForVoid.mockResolvedValue(
        tradeInUnit,
      );
      mockManager.query.mockResolvedValue(undefined);

      await service.voidSale('sale-1', voidApproval, {
        void_reason: 'Wrong item rung up',
      });

      expect(dayMock).toHaveBeenCalledTimes(1);
      expect(dayMock).toHaveBeenCalledWith(mockManager, 'branch-1', {
        lock: true,
      });
      const day = dayMock.mock.invocationCallOrder[0];
      expect(lockMock.mock.invocationCallOrder[0]).toBeLessThan(day);
      expect(day).toBeLessThan(
        mockStockService.incrementForReversal.mock.invocationCallOrder[0],
      );
      expect(day).toBeLessThan(
        mockProductUnitsService.markAvailableForReversal.mock
          .invocationCallOrder[0],
      );
      expect(day).toBeLessThan(
        mockProductUnitsService.markReturnedForVoid.mock.invocationCallOrder[0],
      );
      expect(day).toBeLessThan(mockManager.query.mock.invocationCallOrder[0]);
    });

    it('voidSale refused by the day gate changes nothing and writes no audit row', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.COMPLETED,
        branch_id: 'branch-1',
      });
      arrangeManagerFind(lines);
      dayMock.mockRejectedValueOnce(dayClosed());

      await expect(
        service.voidSale('sale-1', voidApproval, {
          void_reason: 'Wrong item rung up',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
      expect(
        mockProductUnitsService.markAvailableForReversal,
      ).not.toHaveBeenCalled();
      expect(mockManager.query).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });

    it('voidSale does not reach the day gate when the sale is not COMPLETED', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'sale-1',
        status: SaleStatus.VOIDED,
        branch_id: 'branch-1',
      });

      await expect(
        service.voidSale('sale-1', voidApproval, {
          void_reason: 'Wrong item rung up',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(dayMock).not.toHaveBeenCalled();
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

    it('409 SALE_HAS_RETURNS under the sale lock when a return committed meanwhile (P7-11)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      mockManager.count.mockResolvedValue(1);

      const err = await service
        .voidSale('sale-1', voidApproval, validDto)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        code: 'SALE_HAS_RETURNS',
      });
      expect(mockManager.count).toHaveBeenCalledWith(SaleReturn, {
        where: { sale_id: 'sale-1' },
      });
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
      expect(mockManager.query).not.toHaveBeenCalled();
    });

    it('voids a COMPLETED sale: re-increments stock, marks payments reversed, flips to VOIDED', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([
        seedVoidableLine({ product_id: 'prod-1', quantity: 2 }),
        seedVoidableLine({
          id: 'line-2',
          product_id: 'prod-2',
          quantity: 1,
        }),
      ]);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockManager.query.mockResolvedValue(undefined);

      await service.voidSale('sale-1', voidApproval, validDto);

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

      // Sale UPDATE fires with VOIDED status, the approver (voided_by),
      // the session user (void_requested_by) and the reason
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sales'),
        [
          SaleStatus.VOIDED,
          'admin-1',
          'admin-1',
          'Customer returned defective phone',
          'sale-1',
        ],
      );
    });

    it('records the approver as voided_by and the session user as void_requested_by, and audits both in the transaction (P6-17)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([seedVoidableLine()]);

      await service.voidSale(
        'sale-1',
        {
          approver: {
            id: 'manager-1',
            full_name: 'Shop Manager',
            role: UserRole.MANAGER,
          },
          requestedBy: {
            id: 'cashier-1',
            full_name: 'Till Cashier',
            role: UserRole.CASHIER,
            branch_id: 'branch-1',
          },
          ip: '10.0.0.5',
        },
        validDto,
      );

      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('void_requested_by = $3'),
        [
          SaleStatus.VOIDED,
          'manager-1',
          'cashier-1',
          'Customer returned defective phone',
          'sale-1',
        ],
      );
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'cashier-1',
          user_name: 'Till Cashier',
          user_role: UserRole.CASHIER,
          action: AuditAction.VOID,
          entity_type: 'Sale',
          entity_id: 'sale-1',
          ip_address: '10.0.0.5',
          changes: expect.objectContaining({
            voided_by: { old: null, new: 'manager-1' },
            void_requested_by: { old: null, new: 'cashier-1' },
          }),
          description: expect.stringContaining(
            'Voided with approval by Shop Manager (manager-1); requested by Till Cashier (cashier-1)',
          ),
        }),
      );
    });

    it('skips stock re-increment for lines sourced from an external supplier', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([
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

      await service.voidSale('sale-1', voidApproval, validDto);

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
      arrangeManagerFind([seedVoidableLine()]);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      await service.voidSale('sale-1', voidApproval, {
        void_reason: '   Duplicate transaction   ',
      });

      // Both queries receive the trimmed string, byte-for-byte identical
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        ['Duplicate transaction', 'sale-1'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sales'),
        [
          SaleStatus.VOIDED,
          'admin-1',
          'admin-1',
          'Duplicate transaction',
          'sale-1',
        ],
      );
    });

    it('throws NotFoundException when the sale does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(
        service.voidSale('missing', voidApproval, validDto),
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
        service.voidSale('sale-1', voidApproval, validDto),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when sale is already VOIDED (terminal state)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(
        seedVoidableSale({ status: SaleStatus.VOIDED }),
      );

      await expect(
        service.voidSale('sale-1', voidApproval, validDto),
      ).rejects.toThrow(BadRequestException);
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when void_reason is missing', async () => {
      // Fails at the pre-transaction guard — sale is never even fetched
      await expect(
        service.voidSale('sale-1', voidApproval, {
          void_reason: undefined as unknown as string,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when void_reason is whitespace-only', async () => {
      // Defense-in-depth: DTO should catch this, but internal callers
      // that bypass the DTO shouldn't be able to slip a blank reason.
      await expect(
        service.voidSale('sale-1', voidApproval, { void_reason: '     ' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when void_reason is too short after trim', async () => {
      await expect(
        service.voidSale('sale-1', voidApproval, { void_reason: 'no' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('propagates errors from stock re-increment (data integrity failure rolls back)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([seedVoidableLine()]);
      mockStockService.incrementForReversal.mockRejectedValue(
        new Error('Stock row missing for product prod-1 at branch branch-1'),
      );

      await expect(
        service.voidSale('sale-1', voidApproval, validDto),
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
      arrangeManagerFind([seedVoidableLine()]);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      await service.voidSale('sale-1', voidApproval, validDto);

      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
    });

    it('stops re-incrementing further lines if one throws (loop bail-out)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([
        seedVoidableLine({ id: 'line-1', product_id: 'prod-1' }),
        seedVoidableLine({ id: 'line-2', product_id: 'prod-2' }),
        seedVoidableLine({ id: 'line-3', product_id: 'prod-3' }),
      ]);
      mockStockService.incrementForReversal
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Stock row missing'));

      await expect(
        service.voidSale('sale-1', voidApproval, validDto),
      ).rejects.toThrow();

      // Third line was never attempted — sequential loop bails on first throw
      expect(mockStockService.incrementForReversal).toHaveBeenCalledTimes(2);
    });

    it('stamps payments UPDATE before sales UPDATE (order matters for the transaction)', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([seedVoidableLine()]);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);

      await service.voidSale('sale-1', voidApproval, validDto);

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

    // ============================================================
    // Slice E — PU flip on voidSale
    // ============================================================

    it('flips PU back to IN_STOCK for each serialized in-house line', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.COMPLETED,
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-1',
          product_id: 'prod-1',
          quantity: 1,
          external_supplier_id: null,
          product_unit_id: 'unit-1',
        },
      ]);

      await service.voidSale('sale-1', voidApproval, {
        void_reason: 'customer changed mind',
      });

      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        expect.anything(),
        'prod-1',
        'branch-1',
        1,
      );
      expect(
        mockProductUnitsService.markAvailableForReversal,
      ).toHaveBeenCalledWith(expect.anything(), 'unit-1');
    });

    it('skips PU flip for external-sourced serialized lines on void', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.COMPLETED,
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-1',
          product_id: 'prod-1',
          quantity: 1,
          external_supplier_id: 'supplier-1',
          product_unit_id: null,
        },
      ]);

      await service.voidSale('sale-1', voidApproval, {
        void_reason: 'customer changed mind',
      });

      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
      expect(
        mockProductUnitsService.markAvailableForReversal,
      ).not.toHaveBeenCalled();
    });

    it('handles a mixed sale on void (serialized in-house + non-serialized + external)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.COMPLETED,
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-a',
          product_id: 'prod-A',
          quantity: 1,
          external_supplier_id: null,
          product_unit_id: 'unit-A',
        },
        {
          id: 'line-b',
          product_id: 'prod-B',
          quantity: 3,
          external_supplier_id: null,
          product_unit_id: null,
        },
        {
          id: 'line-c',
          product_id: 'prod-C',
          quantity: 1,
          external_supplier_id: 'supplier-1',
          product_unit_id: null,
        },
      ]);

      await service.voidSale('sale-1', voidApproval, {
        void_reason: 'customer changed mind',
      });

      expect(mockStockService.incrementForReversal).toHaveBeenCalledTimes(2);
      expect(
        mockProductUnitsService.markAvailableForReversal,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockProductUnitsService.markAvailableForReversal,
      ).toHaveBeenCalledWith(expect.anything(), 'unit-A');
    });

    it('propagates integrity error from markAvailableForReversal (rolls back)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.COMPLETED,
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-1',
          product_id: 'prod-1',
          quantity: 1,
          external_supplier_id: null,
          product_unit_id: 'unit-1',
        },
      ]);
      mockProductUnitsService.markAvailableForReversal.mockRejectedValue(
        new Error(
          'ProductUnit unit-1 has status IN_STOCK at void time, expected SOLD',
        ),
      );

      await expect(
        service.voidSale('sale-1', voidApproval, {
          void_reason: 'customer changed mind',
        }),
      ).rejects.toThrow(/expected SOLD/);
    });

    it('locks Stock before PU per line on void (Q4 ordering)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(
        seedDraftSale({
          status: SaleStatus.COMPLETED,
          branch_id: 'branch-1',
        }),
      );
      arrangeManagerFind([
        {
          id: 'line-1',
          product_id: 'prod-1',
          quantity: 1,
          external_supplier_id: null,
          product_unit_id: 'unit-1',
        },
      ]);

      const callOrder: string[] = [];
      mockStockService.incrementForReversal.mockImplementation(() => {
        callOrder.push('stock');
        return Promise.resolve();
      });
      mockProductUnitsService.markAvailableForReversal.mockImplementation(
        () => {
          callOrder.push('pu');
          return Promise.resolve();
        },
      );

      await service.voidSale('sale-1', voidApproval, {
        void_reason: 'customer changed mind',
      });

      expect(callOrder).toEqual(['stock', 'pu']);
    });

    // ============================================================
    // Slice G — trade-in reversal on voidSale
    // ============================================================

    // A COMPLETED sale's TRADE_IN payment, already stamped by completeSale.
    const seedVoidableTradeIn = (overrides: Record<string, unknown> = {}) => ({
      id: 'pay-ti-1',
      sale_id: 'sale-1',
      payment_method: PaymentMethod.TRADE_IN,
      amount: '60000.00',
      trade_in_product_id: 'prod-used',
      trade_in_imei: '356938035643809',
      trade_in_buying_price: '60000.00',
      trade_in_phone_purchase_id: 'pp-1',
      ...overrides,
    });

    // findOne(ProductUnit, { where: { phone_purchase_id } }) resolves to
    // a unit named after its purchase; markReturnedForVoid echoes back a
    // full unit with product/branch ids keyed off the unit id.
    const arrangeTradeInUnits = (
      units: Record<string, { product_id: string; branch_id: string }>,
    ) => {
      mockManager.findOne.mockImplementation(
        (entity: unknown, opts: { where: { phone_purchase_id: string } }) =>
          Promise.resolve(
            entity === ProductUnit
              ? { id: `unit-of-${opts.where.phone_purchase_id}` }
              : null,
          ),
      );
      mockProductUnitsService.markReturnedForVoid.mockImplementation(
        (_m: unknown, unitId: string) =>
          Promise.resolve({
            id: unitId,
            status: ProductUnitStatus.IN_STOCK,
            ...units[unitId],
          }),
      );
    };

    it('reverses a single TRADE_IN: PU → RETURNED, stock decremented, payment reversed', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([seedVoidableLine()], [seedVoidableTradeIn()]);
      arrangeTradeInUnits({
        'unit-of-pp-1': { product_id: 'prod-used', branch_id: 'branch-1' },
      });

      await service.voidSale('sale-1', voidApproval, validDto);

      expect(mockManager.find).toHaveBeenCalledWith(Payment, {
        where: { sale_id: 'sale-1', payment_method: PaymentMethod.TRADE_IN },
        order: { created_at: 'ASC' },
      });
      expect(mockManager.findOne).toHaveBeenCalledWith(ProductUnit, {
        where: { phone_purchase_id: 'pp-1' },
      });
      expect(mockProductUnitsService.markReturnedForVoid).toHaveBeenCalledWith(
        mockManager,
        'unit-of-pp-1',
      );
      expect(mockStockService.decrementForVoidedTradeIn).toHaveBeenCalledWith(
        mockManager,
        'prod-used',
        'branch-1',
        1,
      );
      // The existing bulk UPDATE reverses the TRADE_IN payment too
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        ['Customer returned defective phone', 'sale-1'],
      );
    });

    it('reverses each of two TRADE_IN payments', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind(
        [seedVoidableLine()],
        [
          seedVoidableTradeIn(),
          seedVoidableTradeIn({
            id: 'pay-ti-2',
            trade_in_imei: '490154203237518',
            trade_in_phone_purchase_id: 'pp-2',
          }),
        ],
      );
      arrangeTradeInUnits({
        'unit-of-pp-1': { product_id: 'prod-used', branch_id: 'branch-1' },
        'unit-of-pp-2': { product_id: 'prod-used-2', branch_id: 'branch-1' },
      });

      await service.voidSale('sale-1', voidApproval, validDto);

      expect(
        mockProductUnitsService.markReturnedForVoid,
      ).toHaveBeenNthCalledWith(1, mockManager, 'unit-of-pp-1');
      expect(
        mockProductUnitsService.markReturnedForVoid,
      ).toHaveBeenNthCalledWith(2, mockManager, 'unit-of-pp-2');
      expect(mockStockService.decrementForVoidedTradeIn).toHaveBeenCalledTimes(
        2,
      );
      expect(
        mockStockService.decrementForVoidedTradeIn,
      ).toHaveBeenNthCalledWith(2, mockManager, 'prod-used-2', 'branch-1', 1);
    });

    it('propagates 409 when the trade-in phone was resold (Q7) and rolls back', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([seedVoidableLine()], [seedVoidableTradeIn()]);
      arrangeTradeInUnits({});
      mockProductUnitsService.markReturnedForVoid.mockRejectedValue(
        new ConflictException({
          message:
            "Cannot void this sale: trade-in phone (IMEI '356938035643809') " +
            'has been resold in a subsequent sale.',
          existing_unit: {
            id: 'unit-of-pp-1',
            status: ProductUnitStatus.SOLD,
            product_id: 'prod-used',
            branch_id: 'branch-1',
          },
        }),
      );

      await expect(
        service.voidSale('sale-1', voidApproval, validDto),
      ).rejects.toThrow(ConflictException);

      // Nothing after the failed flip ran
      expect(mockStockService.decrementForVoidedTradeIn).not.toHaveBeenCalled();
      expect(mockManager.query).not.toHaveBeenCalled();
    });

    it('handles a mixed sale: outgoing serialized line + TRADE_IN', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind(
        [
          {
            ...seedVoidableLine({ product_id: 'prod-new', quantity: 1 }),
            product_unit_id: 'unit-out',
          },
        ],
        [seedVoidableTradeIn()],
      );
      arrangeTradeInUnits({
        'unit-of-pp-1': { product_id: 'prod-used', branch_id: 'branch-1' },
      });

      await service.voidSale('sale-1', voidApproval, validDto);

      // Outgoing side restored
      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        mockManager,
        'prod-new',
        'branch-1',
        1,
      );
      expect(
        mockProductUnitsService.markAvailableForReversal,
      ).toHaveBeenCalledWith(mockManager, 'unit-out');
      // Incoming side reversed
      expect(mockProductUnitsService.markReturnedForVoid).toHaveBeenCalledWith(
        mockManager,
        'unit-of-pp-1',
      );
      expect(mockStockService.decrementForVoidedTradeIn).toHaveBeenCalledWith(
        mockManager,
        'prod-used',
        'branch-1',
        1,
      );
    });

    it('leaves the trade-in path untouched when the sale has no TRADE_IN payments', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([seedVoidableLine()]);

      await service.voidSale('sale-1', voidApproval, validDto);

      expect(mockManager.findOne).not.toHaveBeenCalled();
      expect(
        mockProductUnitsService.markReturnedForVoid,
      ).not.toHaveBeenCalled();
      expect(mockStockService.decrementForVoidedTradeIn).not.toHaveBeenCalled();
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sales'),
        expect.anything(),
      );
    });

    it('runs the trade-in loop after outgoing reversal and before the payments UPDATE', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind(
        [{ ...seedVoidableLine({ quantity: 1 }), product_unit_id: 'unit-out' }],
        [seedVoidableTradeIn()],
      );
      arrangeTradeInUnits({
        'unit-of-pp-1': { product_id: 'prod-used', branch_id: 'branch-1' },
      });

      const callOrder: string[] = [];
      mockStockService.incrementForReversal.mockImplementation(() => {
        callOrder.push('stock-in');
        return Promise.resolve();
      });
      mockProductUnitsService.markAvailableForReversal.mockImplementation(
        () => {
          callOrder.push('pu-available');
          return Promise.resolve();
        },
      );
      mockProductUnitsService.markReturnedForVoid.mockImplementation(() => {
        callOrder.push('pu-returned');
        return Promise.resolve({
          id: 'unit-of-pp-1',
          product_id: 'prod-used',
          branch_id: 'branch-1',
        });
      });
      mockStockService.decrementForVoidedTradeIn.mockImplementation(() => {
        callOrder.push('stock-out');
        return Promise.resolve();
      });
      mockManager.query.mockImplementation((sql: string) => {
        callOrder.push(sql.includes('UPDATE payments') ? 'payments' : 'sale');
        return Promise.resolve();
      });

      await service.voidSale('sale-1', voidApproval, validDto);

      expect(callOrder).toEqual([
        'stock-in',
        'pu-available',
        'pu-returned',
        'stock-out',
        'payments',
        'sale',
      ]);
    });

    it('decrements stock using product_id/branch_id from the returned PU, not the payment or sale', async () => {
      // Sale is at branch-1 and the payment says prod-used, but the PU
      // markReturnedForVoid hands back is the source of truth.
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([seedVoidableLine()], [seedVoidableTradeIn()]);
      arrangeTradeInUnits({
        'unit-of-pp-1': { product_id: 'prod-from-pu', branch_id: 'branch-pu' },
      });

      await service.voidSale('sale-1', voidApproval, validDto);

      expect(mockStockService.decrementForVoidedTradeIn).toHaveBeenCalledWith(
        mockManager,
        'prod-from-pu',
        'branch-pu',
        1,
      );
    });

    it('throws a raw integrity error when no ProductUnit is linked to the phone purchase', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind([seedVoidableLine()], [seedVoidableTradeIn()]);
      mockManager.findOne.mockResolvedValue(null);

      await expect(
        service.voidSale('sale-1', voidApproval, validDto),
      ).rejects.toThrow(/No ProductUnit linked to phone purchase pp-1/);
      expect(
        mockProductUnitsService.markReturnedForVoid,
      ).not.toHaveBeenCalled();
      expect(mockManager.query).not.toHaveBeenCalled();
    });

    it('throws a raw integrity error when a TRADE_IN payment was never stamped', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
      arrangeManagerFind(
        [seedVoidableLine()],
        [seedVoidableTradeIn({ trade_in_phone_purchase_id: null })],
      );

      await expect(
        service.voidSale('sale-1', voidApproval, validDto),
      ).rejects.toThrow(/has no trade_in_phone_purchase_id/);
      // Never queried with a null condition
      expect(mockManager.findOne).not.toHaveBeenCalled();
    });

    // ---- voidWithApproval: pre-check, PIN, then the void (P6-17) ----

    describe('voidWithApproval', () => {
      const approvalDto = {
        void_reason: 'Wrong price',
        approval: { approver_id: 'manager-1', pin: '482916' },
      };
      const cashierAtBranch1 = {
        id: 'cashier-1',
        full_name: 'Till Cashier',
        role: UserRole.CASHIER,
        branch_id: 'branch-1',
      };
      const manager = {
        id: 'manager-1',
        full_name: 'Shop Manager',
        role: UserRole.MANAGER,
      };

      it('checks the PIN for SALE_VOID at the sale branch, then voids with approver and requester', async () => {
        mockSalesRepo.findOne.mockResolvedValue(seedVoidableSale());
        mockApprovalsService.verify.mockResolvedValue(manager);
        mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
        arrangeManagerFind([seedVoidableLine()]);

        await service.voidWithApproval(
          'sale-1',
          cashierAtBranch1,
          approvalDto,
          '10.0.0.5',
        );

        expect(mockApprovalsService.verify).toHaveBeenCalledWith({
          approverId: 'manager-1',
          pin: '482916',
          action: 'SALE_VOID',
          branchId: 'branch-1',
          requestedBy: cashierAtBranch1,
          ip: '10.0.0.5',
        });
        expect(mockManager.query).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE sales'),
          [
            SaleStatus.VOIDED,
            'manager-1',
            'cashier-1',
            'Wrong price',
            'sale-1',
          ],
        );
      });

      it('404 before any PIN check when the sale does not exist', async () => {
        mockSalesRepo.findOne.mockResolvedValue(null);

        await expect(
          service.voidWithApproval('missing', cashierAtBranch1, approvalDto),
        ).rejects.toThrow(NotFoundException);
        expect(mockApprovalsService.verify).not.toHaveBeenCalled();
      });

      it('409 SALE_HAS_RETURNS before any PIN check when the sale has a return (P7-11)', async () => {
        mockSalesRepo.findOne.mockResolvedValue(seedVoidableSale());
        mockSaleReturnsRepo.count.mockResolvedValue(1);

        const err = await service
          .voidWithApproval('sale-1', cashierAtBranch1, approvalDto)
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).getResponse()).toMatchObject({
          code: 'SALE_HAS_RETURNS',
        });
        expect(mockSaleReturnsRepo.count).toHaveBeenCalledWith({
          where: { sale_id: 'sale-1' },
        });
        expect(mockApprovalsService.verify).not.toHaveBeenCalled();
        expect(mockDataSource.transaction).not.toHaveBeenCalled();
      });

      it('400 before any PIN check when the sale is not COMPLETED', async () => {
        mockSalesRepo.findOne.mockResolvedValue(
          seedVoidableSale({ status: SaleStatus.VOIDED }),
        );

        await expect(
          service.voidWithApproval('sale-1', cashierAtBranch1, approvalDto),
        ).rejects.toThrow('Cannot void a VOIDED sale');
        expect(mockApprovalsService.verify).not.toHaveBeenCalled();
      });

      it('403 VOID_WRONG_BRANCH before any PIN check when the session user is at another branch', async () => {
        mockSalesRepo.findOne.mockResolvedValue(seedVoidableSale());

        const err = await service
          .voidWithApproval(
            'sale-1',
            { ...cashierAtBranch1, branch_id: 'branch-2' },
            approvalDto,
          )
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          code: 'VOID_WRONG_BRANCH',
        });
        expect(mockApprovalsService.verify).not.toHaveBeenCalled();
      });

      it('lets an admin session ask at any branch', async () => {
        mockSalesRepo.findOne.mockResolvedValue(seedVoidableSale());
        mockApprovalsService.verify.mockResolvedValue(manager);
        mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
        arrangeManagerFind([seedVoidableLine()]);

        await service.voidWithApproval(
          'sale-1',
          { ...voidApproval.requestedBy },
          approvalDto,
        );

        expect(mockApprovalsService.verify).toHaveBeenCalled();
      });

      it('never opens the void transaction when the PIN check refuses', async () => {
        mockSalesRepo.findOne.mockResolvedValue(seedVoidableSale());
        mockApprovalsService.verify.mockRejectedValue(
          new ForbiddenException({ message: 'Wrong PIN.', code: 'WRONG_PIN' }),
        );

        await expect(
          service.voidWithApproval('sale-1', cashierAtBranch1, approvalDto),
        ).rejects.toThrow(ForbiddenException);
        expect(mockDataSource.transaction).not.toHaveBeenCalled();
      });

      // ---- Today's cash day before the PIN (Phase 6.4 P9-9) ----

      const dayMock = assertDayOpen as jest.MockedFunction<
        typeof assertDayOpen
      >;

      it('checks todays cash day lock-free after SALE_HAS_RETURNS and before the PIN, then again in the transaction', async () => {
        mockSalesRepo.findOne.mockResolvedValue(seedVoidableSale());
        mockApprovalsService.verify.mockResolvedValue(manager);
        mockQueryBuilder.getOne.mockResolvedValueOnce(seedVoidableSale());
        arrangeManagerFind([seedVoidableLine()]);

        await service.voidWithApproval('sale-1', cashierAtBranch1, approvalDto);

        expect(dayMock).toHaveBeenCalledTimes(2);
        expect(dayMock).toHaveBeenNthCalledWith(
          1,
          mockReadManager,
          'branch-1',
          {
            lock: false,
          },
        );
        expect(dayMock).toHaveBeenNthCalledWith(2, mockManager, 'branch-1', {
          lock: true,
        });
        const [preCheck, inTransaction] = dayMock.mock.invocationCallOrder;
        expect(
          mockSaleReturnsRepo.count.mock.invocationCallOrder[0],
        ).toBeLessThan(preCheck);
        const verified =
          mockApprovalsService.verify.mock.invocationCallOrder[0];
        expect(preCheck).toBeLessThan(verified);
        expect(verified).toBeLessThan(inTransaction);
      });

      it.each([
        ['DAY_NOT_OPEN', 'hasn’t been opened'],
        ['DAY_CLOSED', 'is closed'],
      ])(
        '409 %s before any PIN check: no PIN attempt, no transaction',
        async (code, words) => {
          mockSalesRepo.findOne.mockResolvedValue(seedVoidableSale());
          dayMock.mockRejectedValueOnce(
            new ConflictException({
              message: `Today (2026-10-25) ${words}.`,
              code,
              business_date: '2026-10-25',
            }),
          );

          const err = await service
            .voidWithApproval('sale-1', cashierAtBranch1, approvalDto)
            .catch((e: unknown) => e);

          expect(err).toBeInstanceOf(ConflictException);
          expect((err as ConflictException).getResponse()).toMatchObject({
            code,
            business_date: '2026-10-25',
          });
          expect(mockApprovalsService.verify).not.toHaveBeenCalled();
          expect(mockDataSource.transaction).not.toHaveBeenCalled();
        },
      );

      it.each([
        ['404, no sale', null, cashierAtBranch1, 0],
        [
          '400, not COMPLETED',
          { status: SaleStatus.VOIDED },
          cashierAtBranch1,
          0,
        ],
        [
          '403, another branch',
          {},
          { ...cashierAtBranch1, branch_id: 'branch-2' },
          0,
        ],
        ['409, has a return', {}, cashierAtBranch1, 1],
      ])(
        'the sale checks come before the day check (%s)',
        async (_label, overrides, requestedBy, returns) => {
          mockSalesRepo.findOne.mockResolvedValue(
            overrides === null ? null : seedVoidableSale(overrides),
          );
          mockSaleReturnsRepo.count.mockResolvedValue(returns);

          await expect(
            service.voidWithApproval('sale-1', requestedBy, approvalDto),
          ).rejects.toThrow();
          expect(dayMock).not.toHaveBeenCalled();
        },
      );
    });
  });

  // ============================================================
  // Slice E — mode-aware addLine
  // ============================================================

  // ---- Non-serialized: reject non-null imei_snapshot ----

  it('rejects non-null imei_snapshot on a non-serialized in-house line', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({ is_serialized: false }),
    );

    await expect(
      service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      ),
    ).rejects.toThrow(/is not serialized; imei_snapshot must not be set/);
  });

  it('rejects non-null imei_snapshot on a non-serialized external-sourced line', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({ is_serialized: false }),
    );
    mockSuppliersService.findOne.mockResolvedValue(seedSupplier());

    await expect(
      service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          external_supplier_id: 'supplier-1',
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      ),
    ).rejects.toThrow(/is not serialized; imei_snapshot must not be set/);
  });

  // ---- In-house serialized ----

  it('stores product_unit_id and PU-sourced snapshots on serialized in-house line', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
        selling_price: '250000.00',
        buying_price: '999999.00',
      }),
    );
    mockManager.findOne.mockResolvedValue({
      id: 'unit-1',
      imei: '354789102345678',
      status: ProductUnitStatus.IN_STOCK,
      product_id: 'prod-1',
      branch_id: 'branch-1',
      selling_price: '260000.00',
      buying_price: '210000.00',
    });
    mockManager.create.mockImplementation((_e, data) => data);
    mockManager.save.mockImplementation((e) =>
      Promise.resolve({ id: 'line-new', ...e }),
    );

    await service.addLine(
      'sale-1',
      {
        product_id: 'prod-1',
        quantity: 1,
        imei_snapshot: '354789102345678',
      },
      'cashier-1',
    );

    expect(mockManager.create).toHaveBeenCalledWith(
      SaleLine,
      expect.objectContaining({
        product_unit_id: 'unit-1',
        imei_snapshot: '354789102345678', // from PU, authoritative
        unit_price: '260000.00', // PU price used
        cost_price_snapshot: '210000.00', // PU cost always
        quantity: 1,
      }),
    );
  });

  it('falls back to Product.selling_price when PU.selling_price is null', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
        selling_price: '250000.00',
      }),
    );
    mockManager.findOne.mockResolvedValue({
      id: 'unit-1',
      imei: '354789102345678',
      status: ProductUnitStatus.IN_STOCK,
      product_id: 'prod-1',
      branch_id: 'branch-1',
      selling_price: null,
      buying_price: '210000.00',
    });
    mockManager.create.mockImplementation((_e, data) => data);
    mockManager.save.mockImplementation((e) => Promise.resolve(e));

    await service.addLine(
      'sale-1',
      {
        product_id: 'prod-1',
        quantity: 1,
        imei_snapshot: '354789102345678',
      },
      'cashier-1',
    );

    expect(mockManager.create).toHaveBeenCalledWith(
      SaleLine,
      expect.objectContaining({
        unit_price: '250000.00', // Product fallback
        cost_price_snapshot: '210000.00', // still PU, no fallback
      }),
    );
  });

  it('throws BadRequestException when both PU and Product selling_price are null', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
        selling_price: null as unknown as string,
      }),
    );
    mockManager.findOne.mockResolvedValue({
      id: 'unit-1',
      imei: '354789102345678',
      status: ProductUnitStatus.IN_STOCK,
      product_id: 'prod-1',
      branch_id: 'branch-1',
      selling_price: null,
      buying_price: '210000.00',
    });

    await expect(
      service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      ),
    ).rejects.toThrow(/no selling price set on unit or product/);
  });

  it('throws BadRequestException when serialized in-house imei_snapshot missing', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({ is_serialized: true }),
    );

    await expect(
      service.addLine(
        'sale-1',
        { product_id: 'prod-1', quantity: 1 },
        'cashier-1',
      ),
    ).rejects.toThrow(/imei_snapshot is required/);
  });

  it('throws BadRequestException when serialized in-house quantity != 1', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({ is_serialized: true }),
    );

    await expect(
      service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 2,
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      ),
    ).rejects.toThrow(/quantity must be 1/);
  });

  it('throws BadRequestException when IMEI is not found in stock', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({ is_serialized: true }),
    );
    mockManager.findOne.mockResolvedValue(null);

    await expect(
      service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      ),
    ).rejects.toThrow(/is not in stock/);
  });

  it('throws BadRequestException when IMEI belongs to a different product', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
      }),
    );
    mockManager.findOne.mockResolvedValue({
      id: 'unit-1',
      imei: '354789102345678',
      status: ProductUnitStatus.IN_STOCK,
      product_id: 'prod-OTHER',
      branch_id: 'branch-1',
      selling_price: '260000.00',
      buying_price: '210000.00',
    });

    await expect(
      service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      ),
    ).rejects.toThrow(/does not belong to product/);
  });

  it('throws BadRequestException when IMEI is at a different branch', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
      }),
    );
    mockManager.findOne.mockResolvedValue({
      id: 'unit-1',
      imei: '354789102345678',
      status: ProductUnitStatus.IN_STOCK,
      product_id: 'prod-1',
      branch_id: 'branch-OTHER',
      selling_price: '260000.00',
      buying_price: '210000.00',
    });

    await expect(
      service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      ),
    ).rejects.toThrow(/is not available at this branch/);
  });

  it('throws ConflictException with structured payload when IMEI is SOLD', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
      }),
    );
    mockManager.findOne.mockResolvedValue({
      id: 'unit-1',
      imei: '354789102345678',
      status: ProductUnitStatus.SOLD,
      product_id: 'prod-1',
      branch_id: 'branch-1',
      selling_price: '260000.00',
      buying_price: '210000.00',
    });

    try {
      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      );
      fail('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        message: expect.stringContaining('SOLD'),
        existing_unit: {
          id: 'unit-1',
          status: ProductUnitStatus.SOLD,
          product_id: 'prod-1',
          branch_id: 'branch-1',
        },
      });
    }
  });

  // ---- Buy-back: an IMEI can have one unit row per acquisition ----

  it('sells the live unit when an IMEI has several rows (bought back)', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-used',
        is_serialized: true,
        branch_id: 'branch-1',
      }),
    );
    mockManager.findOne.mockResolvedValueOnce({
      id: 'unit-2',
      imei: '354789102345678',
      status: ProductUnitStatus.IN_STOCK,
      product_id: 'prod-used',
      branch_id: 'branch-1',
      selling_price: '90000.00',
      buying_price: '60000.00',
    });
    mockManager.create.mockImplementation((_e, data) => data);
    mockManager.save.mockImplementation((e) => Promise.resolve(e));

    await service.addLine(
      'sale-1',
      {
        product_id: 'prod-used',
        quantity: 1,
        imei_snapshot: '354789102345678',
      },
      'cashier-1',
    );

    expect(mockManager.findOne).toHaveBeenCalledWith(ProductUnit, {
      where: {
        imei: '354789102345678',
        status: In([
          ProductUnitStatus.IN_STOCK,
          ProductUnitStatus.WRITTEN_OFF,
          ProductUnitStatus.INSPECTION,
        ]),
      },
    });
    // The live row was found, so the newest-row fallback never ran.
    expect(mockManager.findOne).not.toHaveBeenCalledWith(
      ProductUnit,
      expect.objectContaining({ order: { created_at: 'DESC' } }),
    );
    expect(mockManager.create).toHaveBeenCalledWith(
      SaleLine,
      expect.objectContaining({
        product_unit_id: 'unit-2',
        cost_price_snapshot: '60000.00',
      }),
    );
  });

  it('reports the newest row when no unit for the IMEI is live', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({ id: 'prod-1', is_serialized: true, branch_id: 'branch-1' }),
    );
    mockManager.findOne
      .mockResolvedValueOnce(null) // no live unit
      .mockResolvedValueOnce({
        id: 'unit-3',
        imei: '354789102345678',
        status: ProductUnitStatus.SOLD,
        product_id: 'prod-1',
        branch_id: 'branch-1',
      });

    await expect(
      service.addLine(
        'sale-1',
        { product_id: 'prod-1', quantity: 1, imei_snapshot: '354789102345678' },
        'cashier-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockManager.findOne).toHaveBeenNthCalledWith(2, ProductUnit, {
      where: { imei: '354789102345678' },
      order: { created_at: 'DESC' },
    });
  });

  it('throws ConflictException when IMEI is RETURNED', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
      }),
    );
    mockManager.findOne.mockResolvedValue({
      id: 'unit-1',
      imei: '354789102345678',
      status: ProductUnitStatus.RETURNED,
      product_id: 'prod-1',
      branch_id: 'branch-1',
      selling_price: '260000.00',
      buying_price: '210000.00',
    });

    try {
      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      );
      fail('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        message: expect.stringContaining('RETURNED'),
        existing_unit: expect.objectContaining({
          status: ProductUnitStatus.RETURNED,
        }),
      });
    }
  });

  it('throws ConflictException when IMEI is WRITTEN_OFF', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(
      seedDraftSale({ branch_id: 'branch-1' }),
    );
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
      }),
    );
    mockManager.findOne.mockResolvedValue({
      id: 'unit-1',
      imei: '354789102345678',
      status: ProductUnitStatus.WRITTEN_OFF,
      product_id: 'prod-1',
      branch_id: 'branch-1',
      selling_price: '260000.00',
      buying_price: '210000.00',
    });

    try {
      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      );
      fail('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        message: expect.stringContaining('WRITTEN_OFF'),
        existing_unit: expect.objectContaining({
          status: ProductUnitStatus.WRITTEN_OFF,
        }),
      });
    }
  });

  // ---- External-sourced serialized ----

  it('stores imei_snapshot verbatim on external-sourced serialized line (no PU lookup)', async () => {
    // getOne calls: 1) sale load, 2) collision check → null (no match)
    mockQueryBuilder.getOne
      .mockResolvedValueOnce(seedDraftSale({ branch_id: 'branch-1' }))
      .mockResolvedValueOnce(null);
    mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
        selling_price: '250000.00',
        buying_price: '220000.00',
      }),
    );
    mockSuppliersService.findOne.mockResolvedValue(seedSupplier());
    mockManager.create.mockImplementation((_e, data) => data);
    mockManager.save.mockImplementation((e) => Promise.resolve(e));

    await service.addLine(
      'sale-1',
      {
        product_id: 'prod-1',
        quantity: 1,
        external_supplier_id: 'supplier-1',
        imei_snapshot: '999888777666555',
      },
      'cashier-1',
    );

    expect(mockManager.findOne).not.toHaveBeenCalled(); // no PU lookup
    expect(mockManager.create).toHaveBeenCalledWith(
      SaleLine,
      expect.objectContaining({
        product_unit_id: null,
        imei_snapshot: '999888777666555', // free text, verbatim
        external_supplier_id: 'supplier-1',
        unit_price: '250000.00', // Product price
        cost_price_snapshot: '220000.00', // Product cost
      }),
    );
  });

  it('throws BadRequestException when external-sourced serialized imei_snapshot missing', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({ is_serialized: true }),
    );
    mockSuppliersService.findOne.mockResolvedValue(seedSupplier());

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
    ).rejects.toThrow(/imei_snapshot is required/);
  });

  it('throws BadRequestException when external-sourced serialized quantity != 1', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(seedDraftSale());
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({ is_serialized: true }),
    );
    mockSuppliersService.findOne.mockResolvedValue(seedSupplier());

    await expect(
      service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 2,
          external_supplier_id: 'supplier-1',
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      ),
    ).rejects.toThrow(/quantity must be 1/);
  });

  it('throws ConflictException when external imei_snapshot matches an IN_STOCK PU', async () => {
    // getOne calls: 1) sale load, 2) collision check → found IN_STOCK unit
    mockQueryBuilder.getOne
      .mockResolvedValueOnce(seedDraftSale({ branch_id: 'branch-1' }))
      .mockResolvedValueOnce({
        id: 'unit-conflict',
        imei: '354789102345678',
        status: ProductUnitStatus.IN_STOCK,
        product_id: 'prod-inhouse',
        branch_id: 'branch-1',
      });
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({ is_serialized: true }),
    );
    mockSuppliersService.findOne.mockResolvedValue(seedSupplier());

    try {
      await service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          external_supplier_id: 'supplier-1',
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      );
      fail('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        message: expect.stringContaining('currently in your stock'),
        existing_unit: {
          id: 'unit-conflict',
          product_id: 'prod-inhouse',
          branch_id: 'branch-1',
        },
      });
    }
  });

  it('allows external imei_snapshot matching a SOLD PU (historical, not diagnostic)', async () => {
    // Collision check returns null because the SQL filters by status=IN_STOCK.
    // We simulate that: the query for status=IN_STOCK finds nothing even if
    // a SOLD row exists in the "real" DB.
    mockQueryBuilder.getOne
      .mockResolvedValueOnce(seedDraftSale({ branch_id: 'branch-1' }))
      .mockResolvedValueOnce(null);
    mockQueryBuilder.getRawOne.mockResolvedValue({ max: '0' });
    mockProductsService.findOne.mockResolvedValue(
      seedProduct({
        id: 'prod-1',
        is_serialized: true,
        branch_id: 'branch-1',
      }),
    );
    mockSuppliersService.findOne.mockResolvedValue(seedSupplier());
    mockManager.create.mockImplementation((_e, data) => data);
    mockManager.save.mockImplementation((e) => Promise.resolve(e));

    await expect(
      service.addLine(
        'sale-1',
        {
          product_id: 'prod-1',
          quantity: 1,
          external_supplier_id: 'supplier-1',
          imei_snapshot: '354789102345678',
        },
        'cashier-1',
      ),
    ).resolves.toBeDefined();
  });
});
