import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { Sale } from './entities/sale.entity';
import { SaleStatus } from './enums/sale-status.enum';
import { SaleType } from './enums/sale-type.enum';
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';

describe('SalesService', () => {
  let service: SalesService;

  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };

  const mockSalesRepo = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  const mockBranchesRepo = {
    findOne: jest.fn(),
  };

  const mockUsersRepo = {
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
        (fn as jest.Mock).mockReturnThis();
      }
    });
    mockSalesRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: getRepositoryToken(Sale), useValue: mockSalesRepo },
        { provide: getRepositoryToken(Branch), useValue: mockBranchesRepo },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
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
});
