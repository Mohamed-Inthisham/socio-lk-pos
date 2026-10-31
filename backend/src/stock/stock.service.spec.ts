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
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import {
  StockMovementReferenceType,
  StockMovementType,
} from './enums/stock-movement-type.enum';

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
    query: jest.fn(),
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

    it('puts the product_id in the insufficient-stock 409 body (P5-2)', async () => {
      mockManager.createQueryBuilder.mockReturnValueOnce(
        buildSelectQB({
          id: 'stock-3',
          product_id: 'p1',
          branch_id: 'b1',
          quantity: 2,
          manage_stock: true,
        }),
      );

      const err = await service
        .decrementForSale(mockManager as never, 'p1', 'b1', 5, 'iPhone 15 Pro')
        .catch((e: unknown) => e);
      expect((err as ConflictException).getResponse()).toEqual({
        message:
          'Insufficient stock for "iPhone 15 Pro": requested 5, available 2',
        product_id: 'p1',
      });
    });

    it('answers the insufficient-stock 409 with available 0 when the branch has no stock row', async () => {
      mockManager.createQueryBuilder.mockReturnValueOnce(buildSelectQB(null));

      const err = await service
        .decrementForSale(
          mockManager as never,
          'never-stocked',
          'b1',
          1,
          'UGREEN Cable',
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual({
        message:
          'Insufficient stock for "UGREEN Cable": requested 1, available 0',
        product_id: 'never-stocked',
      });
      expect(mockManager.createQueryBuilder).toHaveBeenCalledTimes(1);
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

  describe('decrementForVoidedTradeIn', () => {
    // Same QB shape as decrementForSale / incrementForReversal.
    // SELECT ... FOR UPDATE, then UPDATE with SQL-side arithmetic.
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

    it('decrements quantity when stock is tracked and sufficient', async () => {
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

      await service.decrementForVoidedTradeIn(
        mockManager as never,
        'p1',
        'b1',
        1,
      );

      // SQL-side arithmetic — mirrors decrementForSale exactly.
      expect(updateQB.update).toHaveBeenCalledWith(Stock);
      const setArg = updateQB.set.mock.calls[0][0] as {
        quantity: () => string;
      };
      expect(setArg.quantity()).toBe('quantity - 1');
      expect(updateQB.where).toHaveBeenCalledWith('id = :id', {
        id: 'stock-1',
      });
      expect(updateQB._execute).toHaveBeenCalled();
    });

    it('no-ops silently when manage_stock is false', async () => {
      // Defensive branch — trade-in phones are serialized so
      // manage_stock is always true in real flow, but the sibling
      // methods respect this and we do the same for consistency.
      const untrackedRow = {
        id: 'stock-2',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 3,
        manage_stock: false,
      };
      mockManager.createQueryBuilder.mockReturnValueOnce(
        buildSelectQB(untrackedRow),
      );

      await expect(
        service.decrementForVoidedTradeIn(mockManager as never, 'p1', 'b1', 1),
      ).resolves.toBeUndefined();

      // Only SELECT was called; no UPDATE.
      expect(mockManager.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('throws when stock row is missing (data integrity failure)', async () => {
      mockManager.createQueryBuilder.mockReturnValueOnce(buildSelectQB(null));

      await expect(
        service.decrementForVoidedTradeIn(
          mockManager as never,
          'ghost-product',
          'b1',
          1,
        ),
      ).rejects.toThrow(/Stock row missing/);
    });

    it('throws ConflictException with void-context message when insufficient (defensive)', async () => {
      // Should never happen in real flow (a trade-in being voided was
      // intook via the same-numbered sale's createForTradeIn, so the
      // Stock row was incremented). But if data corruption causes it,
      // the error message names the void context, not a "for sale"
      // context — so operators know what to investigate.
      const stockRow = {
        id: 'stock-3',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 0,
        manage_stock: true,
      };
      // Two mock returns because we assert on the exception twice —
      // each service call consumes one mockReturnValueOnce.
      mockManager.createQueryBuilder
        .mockReturnValueOnce(buildSelectQB(stockRow))
        .mockReturnValueOnce(buildSelectQB(stockRow));

      await expect(
        service.decrementForVoidedTradeIn(mockManager as never, 'p1', 'b1', 1),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.decrementForVoidedTradeIn(mockManager as never, 'p1', 'b1', 1),
      ).rejects.toThrow(/voided trade-in/);
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

      await service.decrementForVoidedTradeIn(
        mockManager as never,
        'p1',
        'b1',
        1,
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

    it('decrements by 1 (normal trade-in void quantity)', async () => {
      // A trade-in is always 1 phone per PhonePurchase in Slice D/G.
      // This test is essentially the happy path renamed — it exists to
      // pin the quantity=1 semantic contract so a future "batch trade-in"
      // feature would need to explicitly extend it.
      const stockRow = {
        id: 'stock-5',
        product_id: 'p1',
        branch_id: 'b1',
        quantity: 1,
        manage_stock: true,
      };
      const updateQB = buildUpdateQB();
      mockManager.createQueryBuilder
        .mockReturnValueOnce(buildSelectQB(stockRow))
        .mockReturnValueOnce(updateQB);

      await service.decrementForVoidedTradeIn(
        mockManager as never,
        'p1',
        'b1',
        1,
      );

      const setArg = updateQB.set.mock.calls[0][0] as {
        quantity: () => string;
      };
      expect(setArg.quantity()).toBe('quantity - 1');
    });
  });

  // ---- Stock movement ledger (Phase 1 T1a) ----

  describe('stock movement ledger', () => {
    const lockQB = (row: unknown) => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(row),
    });
    const updateQB = () => ({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    });
    const stockRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'stock-1',
      product_id: 'p1',
      branch_id: 'b1',
      quantity: 10,
      manage_stock: true,
      ...overrides,
    });
    const sale = {
      type: StockMovementType.SALE,
      referenceType: StockMovementReferenceType.SALE_LINE,
      referenceId: 'line-1',
      createdById: 'user-1',
    };
    const phoneSold = {
      id: 'unit-1',
      from: ProductUnitStatus.IN_STOCK,
      to: ProductUnitStatus.SOLD,
    };

    const isLedgerInsert = (sql: unknown) =>
      typeof sql === 'string' && sql.includes('INSERT INTO "stock_movements"');

    /** Each ledger INSERT's parameters, keyed by column, in call order. */
    const ledgerRows = () =>
      (mockManager.query.mock.calls as [string, unknown[]][])
        .filter(([sql]) => isLedgerInsert(sql))
        .map(([, p]) => ({
          product_id: p[0],
          branch_id: p[1],
          product_unit_id: p[2],
          movement_type: p[3],
          quantity_delta: p[4],
          quantity_before: p[5],
          quantity_after: p[6],
          stock_managed: p[7],
          unit_status_from: p[8],
          unit_status_to: p[9],
          reason_code: p[10],
          note: p[11],
          reference_type: p[12],
          reference_id: p[13],
          reverses_movement_id: p[14],
          created_by_id: p[15],
          approved_by_id: p[16],
        }));

    beforeEach(() => {
      mockManager.query.mockImplementation((sql: string) =>
        Promise.resolve(isLedgerInsert(sql) ? [{ id: 'movement-1' }] : []),
      );
    });

    describe('decrementForSale', () => {
      it('records a SALE row with the locked quantity as before', async () => {
        mockManager.createQueryBuilder
          .mockReturnValueOnce(lockQB(stockRow()))
          .mockReturnValueOnce(updateQB());

        await service.decrementForSale(
          mockManager as never,
          'p1',
          'b1',
          3,
          'UGREEN Cable',
          sale,
        );

        expect(ledgerRows()).toEqual([
          {
            product_id: 'p1',
            branch_id: 'b1',
            product_unit_id: null,
            movement_type: 'SALE',
            quantity_delta: -3,
            quantity_before: 10,
            quantity_after: 7,
            stock_managed: true,
            unit_status_from: null,
            unit_status_to: null,
            reason_code: null,
            note: null,
            reference_type: 'SALE_LINE',
            reference_id: 'line-1',
            reverses_movement_id: null,
            created_by_id: 'user-1',
            approved_by_id: null,
          },
        ]);
      });

      it('records the unit status change with the quantity change, in one row', async () => {
        mockManager.createQueryBuilder
          .mockReturnValueOnce(lockQB(stockRow({ quantity: 1 })))
          .mockReturnValueOnce(updateQB());

        await service.decrementForSale(
          mockManager as never,
          'p1',
          'b1',
          1,
          'iPhone 15',
          { ...sale, unit: phoneSold },
        );

        expect(ledgerRows()).toEqual([
          expect.objectContaining({
            product_unit_id: 'unit-1',
            quantity_delta: -1,
            quantity_before: 1,
            quantity_after: 0,
            unit_status_from: 'IN_STOCK',
            unit_status_to: 'SOLD',
          }),
        ]);
      });

      it('on an untracked row records the unit change with delta 0 and stock_managed false', async () => {
        mockManager.createQueryBuilder.mockReturnValueOnce(
          lockQB(stockRow({ quantity: 4, manage_stock: false })),
        );

        await service.decrementForSale(
          mockManager as never,
          'p1',
          'b1',
          1,
          'iPhone 15',
          { ...sale, unit: phoneSold },
        );

        expect(ledgerRows()).toEqual([
          expect.objectContaining({
            quantity_delta: 0,
            quantity_before: 4,
            quantity_after: 4,
            stock_managed: false,
            unit_status_from: 'IN_STOCK',
            unit_status_to: 'SOLD',
          }),
        ]);
      });

      it('on an untracked row without a unit records nothing', async () => {
        mockManager.createQueryBuilder.mockReturnValueOnce(
          lockQB(stockRow({ manage_stock: false })),
        );

        await service.decrementForSale(
          mockManager as never,
          'p1',
          'b1',
          1,
          'Reload',
          sale,
        );

        expect(ledgerRows()).toEqual([]);
      });

      it('records nothing when the sale is refused for stock', async () => {
        mockManager.createQueryBuilder.mockReturnValueOnce(
          lockQB(stockRow({ quantity: 1 })),
        );

        await expect(
          service.decrementForSale(
            mockManager as never,
            'p1',
            'b1',
            2,
            'UGREEN Cable',
            sale,
          ),
        ).rejects.toThrow(ConflictException);
        expect(ledgerRows()).toEqual([]);
      });

      it('records nothing without a movement (callers not yet wired)', async () => {
        mockManager.createQueryBuilder
          .mockReturnValueOnce(lockQB(stockRow()))
          .mockReturnValueOnce(updateQB());

        await service.decrementForSale(
          mockManager as never,
          'p1',
          'b1',
          1,
          'UGREEN Cable',
        );

        expect(mockManager.query).not.toHaveBeenCalled();
      });
    });

    it('incrementForReversal records a REVERSAL with its approver and the original movement', async () => {
      mockManager.createQueryBuilder
        .mockReturnValueOnce(lockQB(stockRow({ quantity: 0 })))
        .mockReturnValueOnce(updateQB());

      await service.incrementForReversal(mockManager as never, 'p1', 'b1', 1, {
        type: StockMovementType.REVERSAL,
        referenceType: StockMovementReferenceType.SALE_LINE,
        referenceId: 'line-1',
        createdById: 'cashier-1',
        approvedById: 'manager-1',
        reversesMovementId: 'movement-sale',
        unit: {
          id: 'unit-1',
          from: ProductUnitStatus.SOLD,
          to: ProductUnitStatus.IN_STOCK,
        },
      });

      expect(ledgerRows()).toEqual([
        expect.objectContaining({
          movement_type: 'REVERSAL',
          quantity_delta: 1,
          quantity_before: 0,
          quantity_after: 1,
          created_by_id: 'cashier-1',
          approved_by_id: 'manager-1',
          reverses_movement_id: 'movement-sale',
          unit_status_from: 'SOLD',
          unit_status_to: 'IN_STOCK',
        }),
      ]);
    });

    it('decrementForVoidedTradeIn records the trade-in reversal', async () => {
      mockManager.createQueryBuilder
        .mockReturnValueOnce(lockQB(stockRow({ quantity: 2 })))
        .mockReturnValueOnce(updateQB());

      await service.decrementForVoidedTradeIn(
        mockManager as never,
        'p1',
        'b1',
        1,
        {
          type: StockMovementType.REVERSAL,
          referenceType: StockMovementReferenceType.PAYMENT,
          referenceId: 'payment-1',
          createdById: 'cashier-1',
          approvedById: 'manager-1',
          unit: {
            id: 'unit-ti',
            from: ProductUnitStatus.IN_STOCK,
            to: ProductUnitStatus.RETURNED,
          },
        },
      );

      expect(ledgerRows()).toEqual([
        expect.objectContaining({
          quantity_delta: -1,
          quantity_before: 2,
          quantity_after: 1,
          reference_type: 'PAYMENT',
          reference_id: 'payment-1',
        }),
      ]);
    });

    describe('receivePurchase', () => {
      const purchase = {
        type: StockMovementType.PURCHASE,
        referenceType: StockMovementReferenceType.STOCK_PURCHASE_ITEM,
        referenceId: 'item-1',
        createdById: 'manager-1',
      };

      beforeEach(() => {
        // The upsert returns the row's quantity after this receipt: 3 + 5.
        mockManager.query.mockImplementation((sql: string) =>
          Promise.resolve(
            isLedgerInsert(sql) ? [{ id: 'movement-1' }] : [{ quantity: 8 }],
          ),
        );
      });

      it('records one row per unit, then one for the rest, chained from the quantity before', async () => {
        await service.receivePurchase(mockManager as never, 'p1', 'b1', 5, {
          ...purchase,
          unitIds: ['unit-a', 'unit-b'],
        });

        expect(
          ledgerRows().map((r) => [
            r.product_unit_id,
            r.quantity_delta,
            r.quantity_before,
            r.quantity_after,
            r.unit_status_from,
            r.unit_status_to,
          ]),
        ).toEqual([
          ['unit-a', 1, 3, 4, null, 'IN_STOCK'],
          ['unit-b', 1, 4, 5, null, 'IN_STOCK'],
          [null, 3, 5, 8, null, null],
        ]);
        for (const row of ledgerRows()) {
          expect(row).toMatchObject({
            movement_type: 'PURCHASE',
            reference_type: 'STOCK_PURCHASE_ITEM',
            reference_id: 'item-1',
            created_by_id: 'manager-1',
            stock_managed: true,
          });
        }
      });

      it('records one row for a quantity-only line', async () => {
        await service.receivePurchase(
          mockManager as never,
          'p1',
          'b1',
          5,
          purchase,
        );

        expect(ledgerRows()).toEqual([
          expect.objectContaining({
            product_unit_id: null,
            quantity_delta: 5,
            quantity_before: 3,
            quantity_after: 8,
          }),
        ]);
      });

      it('records no remainder row when every unit is identified', async () => {
        await service.receivePurchase(mockManager as never, 'p1', 'b1', 2, {
          ...purchase,
          unitIds: ['unit-a', 'unit-b'],
        });

        expect(ledgerRows().map((r) => r.product_unit_id)).toEqual([
          'unit-a',
          'unit-b',
        ]);
      });

      it('refuses more units than the received quantity, recording nothing', async () => {
        await expect(
          service.receivePurchase(mockManager as never, 'p1', 'b1', 1, {
            ...purchase,
            unitIds: ['unit-a', 'unit-b'],
          }),
        ).rejects.toThrow(/names 2 units/);
        expect(ledgerRows()).toEqual([]);
      });

      it('records nothing without a movement', async () => {
        await service.receivePurchase(mockManager as never, 'p1', 'b1', 5);

        expect(ledgerRows()).toEqual([]);
        expect(mockManager.query).toHaveBeenCalledTimes(1);
      });
    });

    describe('recordUnitEvent', () => {
      const phoneReturned = {
        type: StockMovementType.CUSTOMER_RETURN,
        referenceType: StockMovementReferenceType.SALE_RETURN_LINE,
        referenceId: 'return-line-1',
        createdById: 'cashier-1',
        approvedById: 'manager-1',
        unit: {
          id: 'unit-1',
          from: ProductUnitStatus.SOLD,
          to: ProductUnitStatus.INSPECTION,
        },
      };

      it('locks the stock row and records delta 0 with its quantity as before and after', async () => {
        const qb = lockQB(stockRow({ quantity: 6 }));
        mockManager.createQueryBuilder.mockReturnValueOnce(qb);

        const id = await service.recordUnitEvent(
          mockManager as never,
          'p1',
          'b1',
          phoneReturned,
        );

        expect(id).toBe('movement-1');
        expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(ledgerRows()).toEqual([
          expect.objectContaining({
            movement_type: 'CUSTOMER_RETURN',
            product_unit_id: 'unit-1',
            quantity_delta: 0,
            quantity_before: 6,
            quantity_after: 6,
            stock_managed: true,
            unit_status_from: 'SOLD',
            unit_status_to: 'INSPECTION',
            approved_by_id: 'manager-1',
          }),
        ]);
      });

      it('records stock_managed false for an untracked row', async () => {
        mockManager.createQueryBuilder.mockReturnValueOnce(
          lockQB(stockRow({ manage_stock: false })),
        );

        await service.recordUnitEvent(
          mockManager as never,
          'p1',
          'b1',
          phoneReturned,
        );

        expect(ledgerRows()[0].stock_managed).toBe(false);
      });

      it('throws (integrity) and records nothing when the stock row is missing', async () => {
        mockManager.createQueryBuilder.mockReturnValueOnce(lockQB(null));

        await expect(
          service.recordUnitEvent(
            mockManager as never,
            'p1',
            'b1',
            phoneReturned,
          ),
        ).rejects.toThrow(/Stock row missing/);
        expect(ledgerRows()).toEqual([]);
      });
    });
  });
});
