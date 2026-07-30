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

  const activeProduct = { id: 'p1', name: 'iPhone', is_active: true };
  const activeBranch = { id: 'b1', name: 'Main Shop', is_active: true };

  beforeEach(async () => {
    jest.clearAllMocks();

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
});
