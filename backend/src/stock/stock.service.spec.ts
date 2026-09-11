import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StockService } from './stock.service';
import { Stock } from './entities/stock.entity';
import { ProductsService } from '../products/products.service';
import { BranchesService } from '../branches/branches.service';

describe('StockService', () => {
  let service: StockService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockProductsService = { findOne: jest.fn() };
  const mockBranchesService = { findOne: jest.fn() };
  const mockManager = {
    createQueryBuilder: jest.fn(),
  };

  const activeProduct = { id: 'p1', name: 'iPhone', is_active: true };
  const activeBranch = { id: 'b1', name: 'Main Shop', is_active: true };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockManager.createQueryBuilder.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: getRepositoryToken(Stock), useValue: mockRepo },
        { provide: ProductsService, useValue: mockProductsService },
        { provide: BranchesService, useValue: mockBranchesService },
      ],
    }).compile();

    service = module.get<StockService>(StockService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    beforeEach(() => {
      mockProductsService.findOne.mockResolvedValue(activeProduct);
      mockBranchesService.findOne.mockResolvedValue(activeBranch);
      mockRepo.findOne.mockResolvedValue(null); // uniqueness check passes
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 'new-stock-id', ...e }),
      );
    });

    it('creates a stock row when product and branch are active', async () => {
      // Second findOne is the refetch with relations
      mockRepo.findOne
        .mockResolvedValueOnce(null) // uniqueness check
        .mockResolvedValueOnce({
          id: 'new-stock-id',
          product_id: 'p1',
          branch_id: 'b1',
          quantity: 10,
          min_quantity: 0,
          manage_stock: true,
          product: activeProduct,
          branch: activeBranch,
        });

      const result = await service.create({
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 10,
      });

      expect(result.quantity).toBe(10);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          product_id: 'p1',
          branch_id: 'b1',
          quantity: 10,
        }),
      );
    });

    it('defaults quantity to 0 when omitted', async () => {
      mockRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'new-stock-id',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 0,
        min_quantity: 0,
        manage_stock: true,
        product: activeProduct,
        branch: activeBranch,
      });

      await service.create({ product_id: 'p1', branch_id: 'b1' });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 0 }),
      );
    });

    it('throws BadRequestException when product does not exist', async () => {
      mockProductsService.findOne.mockResolvedValue(null);

      await expect(
        service.create({ product_id: 'missing', branch_id: 'b1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when product is inactive', async () => {
      mockProductsService.findOne.mockResolvedValue({
        ...activeProduct,
        is_active: false,
      });

      await expect(
        service.create({ product_id: 'p1', branch_id: 'b1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when branch is inactive', async () => {
      mockBranchesService.findOne.mockResolvedValue({
        ...activeBranch,
        is_active: false,
      });

      await expect(
        service.create({ product_id: 'p1', branch_id: 'b1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when stock row already exists for the pair', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ product_id: 'p1', branch_id: 'b1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns all rows with low_stock_alert computed', async () => {
      const rows = [
        {
          id: 's1',
          product_id: 'p1',
          branch_id: 'b1',
          quantity: 2,
          min_quantity: 5,
          manage_stock: true,
          product: activeProduct,
          branch: activeBranch,
        },
        {
          id: 's2',
          product_id: 'p2',
          branch_id: 'b1',
          quantity: 10,
          min_quantity: 5,
          manage_stock: true,
          product: activeProduct,
          branch: activeBranch,
        },
      ];
      mockRepo.find.mockResolvedValue(rows);

      const result = await service.findAll({});

      expect(result).toHaveLength(2);
      expect(result[0].low_stock_alert).toBe(true); // 2 <= 5
      expect(result[1].low_stock_alert).toBe(false); // 10 > 5
    });

    it('excludes rows with manage_stock=false from low_stock_alert', async () => {
      const rows = [
        {
          id: 's1',
          product_id: 'p1',
          branch_id: 'b1',
          quantity: 0,
          min_quantity: 5,
          manage_stock: false, // tracking disabled
          product: activeProduct,
          branch: activeBranch,
        },
      ];
      mockRepo.find.mockResolvedValue(rows);

      const result = await service.findAll({});

      // Even though quantity <= min_quantity, alert is false because manage_stock is false
      expect(result[0].low_stock_alert).toBe(false);
    });

    it('filters to low-stock rows only when lowStockOnly=true', async () => {
      const rows = [
        {
          id: 's1',
          quantity: 2,
          min_quantity: 5,
          manage_stock: true,
          product: activeProduct,
          branch: activeBranch,
        },
        {
          id: 's2',
          quantity: 10,
          min_quantity: 5,
          manage_stock: true,
          product: activeProduct,
          branch: activeBranch,
        },
      ];
      mockRepo.find.mockResolvedValue(rows);

      const result = await service.findAll({ lowStockOnly: true });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('s1');
    });

    it('filters by productId when provided', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAll({ productId: 'p1' });

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { product_id: 'p1' } }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the row with low_stock_alert computed', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 's1',
        quantity: 2,
        min_quantity: 5,
        manage_stock: true,
        product: activeProduct,
        branch: activeBranch,
      });

      const result = await service.findOne('s1');

      expect(result.low_stock_alert).toBe(true);
    });

    it('throws NotFoundException when missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const existing = {
      id: 's1',
      product_id: 'p1',
      branch_id: 'b1',
      quantity: 10,
      min_quantity: 3,
      manage_stock: true,
    };

    it('updates quantity', async () => {
      mockRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce({
        ...existing,
        quantity: 25,
        product: activeProduct,
        branch: activeBranch,
      });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', { quantity: 25 });

      expect(result.quantity).toBe(25);
    });

    it('updates min_quantity and recomputes low_stock_alert on return', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce({ ...existing, quantity: 5, min_quantity: 3 })
        .mockResolvedValueOnce({
          ...existing,
          quantity: 5,
          min_quantity: 10, // raised above quantity
          product: activeProduct,
          branch: activeBranch,
        });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('s1', { min_quantity: 10 });

      expect(result.min_quantity).toBe(10);
      expect(result.low_stock_alert).toBe(true); // 5 <= 10
    });

    it('throws NotFoundException when the row is missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.update('missing', { quantity: 10 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createForNewProduct', () => {
    it('creates a stock row with quantity=0 for a new product', async () => {
      mockRepo.findOne.mockResolvedValue(null); // no existing row
      mockRepo.create.mockImplementation((e) => e);
      mockRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 'new', ...e }),
      );

      const result = await service.createForNewProduct('p1', 'b1');

      expect(result.quantity).toBe(0);
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('is idempotent — returns existing row without creating a new one', async () => {
      const existing = { id: 'existing', product_id: 'p1', branch_id: 'b1' };
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.createForNewProduct('p1', 'b1');

      expect(result).toBe(existing);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });
  describe('decrementForSale', () => {
    // Helper: build a chainable QueryBuilder mock that resolves getOne()
    // to the provided stock row (or null for "no row found").
    const buildSelectQB = (returnValue: unknown) => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(returnValue),
    });

    // Helper: build a chainable QueryBuilder mock for the UPDATE path.
    const buildUpdateQB = () => {
      const execute = jest.fn().mockResolvedValue({ affected: 1 });
      return {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute,
        _execute: execute, // handle to assert on
      };
    };

    it('decrements quantity when stock is tracked and sufficient', async () => {
      const stockRow = {
        id: 'stock-1',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 10,
        manage_stock: true,
      };
      const updateQB = buildUpdateQB();
      mockManager.createQueryBuilder
        .mockReturnValueOnce(buildSelectQB(stockRow)) // SELECT ... FOR UPDATE
        .mockReturnValueOnce(updateQB); // UPDATE

      await service.decrementForSale(
        mockManager as never,
        'p1',
        'b1',
        3,
        'iPhone 15 Pro',
      );

      // UPDATE was called with SQL-side arithmetic and scoped to the row id
      expect(updateQB.update).toHaveBeenCalledWith(Stock);
      expect(updateQB.set).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: expect.any(Function) }),
      );
      // Verify the arrow function produces 'quantity - 3', not a literal value
      const setArg = updateQB.set.mock.calls[0][0] as {
        quantity: () => string;
      };
      expect(setArg.quantity()).toBe('quantity - 3');
      expect(updateQB.where).toHaveBeenCalledWith('id = :id', {
        id: 'stock-1',
      });
      expect(updateQB._execute).toHaveBeenCalled();
    });

    it('no-ops silently when manage_stock is false', async () => {
      const untrackedRow = {
        id: 'stock-2',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 0,
        manage_stock: false, // service, unlimited SIM, etc.
      };
      mockManager.createQueryBuilder.mockReturnValueOnce(
        buildSelectQB(untrackedRow),
      );

      await expect(
        service.decrementForSale(
          mockManager as never,
          'p1',
          'b1',
          5,
          'Mobile reload',
        ),
      ).resolves.toBeUndefined();

      // Only the SELECT was called; no UPDATE was ever built
      expect(mockManager.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException with product name and available qty when insufficient', async () => {
      const stockRow = {
        id: 'stock-3',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 2,
        manage_stock: true,
      };
      mockManager.createQueryBuilder.mockReturnValueOnce(
        buildSelectQB(stockRow),
      );

      await expect(
        service.decrementForSale(
          mockManager as never,
          'p1',
          'b1',
          5,
          'iPhone 15 Pro',
        ),
      ).rejects.toThrow(ConflictException);

      // Reset and re-run to inspect the message (the same call twice is fine)
      mockManager.createQueryBuilder.mockReturnValueOnce(
        buildSelectQB(stockRow),
      );
      await expect(
        service.decrementForSale(
          mockManager as never,
          'p1',
          'b1',
          5,
          'iPhone 15 Pro',
        ),
      ).rejects.toThrow(/iPhone 15 Pro.*requested 5.*available 2/);
    });

    it('throws when stock row is missing (data integrity failure)', async () => {
      mockManager.createQueryBuilder.mockReturnValueOnce(buildSelectQB(null));

      await expect(
        service.decrementForSale(
          mockManager as never,
          'ghost-product',
          'b1',
          1,
          'Ghost Product',
        ),
      ).rejects.toThrow(/Stock row missing/);
    });

    it('acquires pessimistic_write lock on the stock row', async () => {
      const stockRow = {
        id: 'stock-4',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 10,
        manage_stock: true,
      };
      const selectQB = buildSelectQB(stockRow);
      mockManager.createQueryBuilder
        .mockReturnValueOnce(selectQB)
        .mockReturnValueOnce(buildUpdateQB());

      await service.decrementForSale(
        mockManager as never,
        'p1',
        'b1',
        1,
        'iPhone',
      );

      expect(selectQB.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(selectQB.where).toHaveBeenCalledWith(
        'stock.product_id = :productId',
        { productId: 'p1' },
      );
      expect(selectQB.andWhere).toHaveBeenCalledWith(
        'stock.branch_id = :branchId',
        { branchId: 'b1' },
      );
    });

    it('allows decrementing to exactly zero (quantity === qty boundary)', async () => {
      const stockRow = {
        id: 'stock-5',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 3,
        manage_stock: true,
      };
      const updateQB = buildUpdateQB();
      mockManager.createQueryBuilder
        .mockReturnValueOnce(buildSelectQB(stockRow))
        .mockReturnValueOnce(updateQB);

      await expect(
        service.decrementForSale(
          mockManager as never,
          'p1',
          'b1',
          3, // == quantity, should succeed
          'Last iPhone',
        ),
      ).resolves.toBeUndefined();

      expect(updateQB._execute).toHaveBeenCalled();
    });
  });

  describe('incrementForReversal', () => {
    // Reuse the same query-builder helpers as decrementForSale — the
    // shape is identical (SELECT ... FOR UPDATE + optional UPDATE).
    const buildSelectQB = (returnValue: unknown) => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(returnValue),
    });

    const buildUpdateQB = () => {
      const execute = jest.fn().mockResolvedValue({ affected: 1 });
      return {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute,
        _execute: execute,
      };
    };

    it('increments quantity when stock is tracked', async () => {
      const stockRow = {
        id: 'stock-1',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 5,
        manage_stock: true,
      };
      const updateQB = buildUpdateQB();
      mockManager.createQueryBuilder
        .mockReturnValueOnce(buildSelectQB(stockRow))
        .mockReturnValueOnce(updateQB);

      await service.incrementForReversal(mockManager as never, 'p1', 'b1', 3);

      // UPDATE was called with SQL-side arithmetic — 'quantity + 3', not
      // a read-then-write JS expression. This is the anti-lost-update path.
      expect(updateQB.update).toHaveBeenCalledWith(Stock);
      const setArg = updateQB.set.mock.calls[0][0] as {
        quantity: () => string;
      };
      expect(setArg.quantity()).toBe('quantity + 3');
      expect(updateQB.where).toHaveBeenCalledWith('id = :id', {
        id: 'stock-1',
      });
      expect(updateQB._execute).toHaveBeenCalled();
    });

    it('no-ops silently when manage_stock is false', async () => {
      const untrackedRow = {
        id: 'stock-2',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 0,
        manage_stock: false,
      };
      mockManager.createQueryBuilder.mockReturnValueOnce(
        buildSelectQB(untrackedRow),
      );

      await expect(
        service.incrementForReversal(mockManager as never, 'p1', 'b1', 5),
      ).resolves.toBeUndefined();

      // Only SELECT was called; no UPDATE ever built. Symmetric to
      // decrementForSale's no-op path for services/reloads.
      expect(mockManager.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('throws when stock row is missing (data integrity failure)', async () => {
      mockManager.createQueryBuilder.mockReturnValueOnce(buildSelectQB(null));

      await expect(
        service.incrementForReversal(
          mockManager as never,
          'ghost-product',
          'b1',
          1,
        ),
      ).rejects.toThrow(/Stock row missing/);
    });

    it('acquires pessimistic_write lock on the stock row', async () => {
      const stockRow = {
        id: 'stock-3',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 10,
        manage_stock: true,
      };
      const selectQB = buildSelectQB(stockRow);
      mockManager.createQueryBuilder
        .mockReturnValueOnce(selectQB)
        .mockReturnValueOnce(buildUpdateQB());

      await service.incrementForReversal(mockManager as never, 'p1', 'b1', 1);

      // Locking is non-negotiable even though increment can't fail on
      // business grounds — races with concurrent decrements would
      // otherwise produce lost updates.
      expect(selectQB.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(selectQB.where).toHaveBeenCalledWith(
        'stock.product_id = :productId',
        { productId: 'p1' },
      );
      expect(selectQB.andWhere).toHaveBeenCalledWith(
        'stock.branch_id = :branchId',
        { branchId: 'b1' },
      );
    });

    it('allows large increments (no upper bound)', async () => {
      // Sanity: increment has no ConflictException path. Voiding a
      // bulk sale should not fail because inventory got "too high".
      const stockRow = {
        id: 'stock-4',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 5,
        manage_stock: true,
      };
      const updateQB = buildUpdateQB();
      mockManager.createQueryBuilder
        .mockReturnValueOnce(buildSelectQB(stockRow))
        .mockReturnValueOnce(updateQB);

      await expect(
        service.incrementForReversal(mockManager as never, 'p1', 'b1', 10000),
      ).resolves.toBeUndefined();

      const setArg = updateQB.set.mock.calls[0][0] as {
        quantity: () => string;
      };
      expect(setArg.quantity()).toBe('quantity + 10000');
    });

    it('increments by 1 (smallest realistic void quantity)', async () => {
      const stockRow = {
        id: 'stock-5',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 0,
        manage_stock: true,
      };
      const updateQB = buildUpdateQB();
      mockManager.createQueryBuilder
        .mockReturnValueOnce(buildSelectQB(stockRow))
        .mockReturnValueOnce(updateQB);

      await service.incrementForReversal(mockManager as never, 'p1', 'b1', 1);

      const setArg = updateQB.set.mock.calls[0][0] as {
        quantity: () => string;
      };
      expect(setArg.quantity()).toBe('quantity + 1');
    });
  });
});
