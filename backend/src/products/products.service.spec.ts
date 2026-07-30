import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { BrandsService } from '../brands/brands.service';
import { CategoriesService } from '../categories/categories.service';
import { BranchesService } from '../branches/branches.service';
import { SkuBarcodeCountersService } from '../sku-barcode-counters/sku-barcode-counters.service';
import { CounterType } from '../sku-barcode-counters/enums/counter-type.enum';
import { ProductType } from './enums/product-type.enum';
import { StockService } from '../stock/stock.service';

describe('ProductsService', () => {
  let service: ProductsService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockBrandsService = { findOne: jest.fn() };
  const mockCategoriesService = { findOne: jest.fn() };
  const mockBranchesService = { findOne: jest.fn() };
  const mockCountersService = { next: jest.fn() };
  const mockStockService = { createForNewProduct: jest.fn() };

  const validDto = {
    product_type: ProductType.PHONE,
    name: 'iPhone 15 Pro Max',
    brand_id: 'brand-1',
    category_id: 'cat-1',
    branch_id: 'branch-1',
    buying_price: '180000.00',
    selling_price: '199900.00',
  };

  const activeBrand = { id: 'brand-1', name: 'Apple', is_active: true };
  const activeCategory = { id: 'cat-1', name: 'Phones', is_active: true };
  const activeBranch = { id: 'branch-1', name: 'Main Shop', is_active: true };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: mockRepo },
        { provide: BrandsService, useValue: mockBrandsService },
        { provide: CategoriesService, useValue: mockCategoriesService },
        { provide: BranchesService, useValue: mockBranchesService },
        { provide: SkuBarcodeCountersService, useValue: mockCountersService },
        { provide: StockService, useValue: mockStockService },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    beforeEach(() => {
      mockBrandsService.findOne.mockResolvedValue(activeBrand);
      mockCategoriesService.findOne.mockResolvedValue(activeCategory);
      mockBranchesService.findOne.mockResolvedValue(activeBranch);
      mockCountersService.next
        .mockResolvedValueOnce('SKU-000001')
        .mockResolvedValueOnce('SLP-000001');
      mockRepo.create.mockImplementation((e) => e);
      mockStockService.createForNewProduct.mockResolvedValue({ id: 'stock-1' });
      mockRepo.save.mockImplementation((e) =>
        Promise.resolve({ id: 'new-product-id', ...e }),
      );
      mockRepo.findOne.mockResolvedValue({
        id: 'new-product-id',
        sku: 'SKU-000001',
        barcode: 'SLP-000001',
        brand: activeBrand,
        category: activeCategory,
        branch: activeBranch,
        ...validDto,
      });
    });

    it('auto-generates SKU and barcode when barcode is omitted', async () => {
      const result = await service.create(validDto);

      expect(mockCountersService.next).toHaveBeenCalledWith(CounterType.SKU);
      expect(mockCountersService.next).toHaveBeenCalledWith(
        CounterType.BARCODE,
      );
      expect(result.sku).toBe('SKU-000001');
      expect(result.barcode).toBe('SLP-000001');
    });

    it('uses provided barcode when given, only auto-generates SKU', async () => {
      mockCountersService.next.mockReset();
      mockCountersService.next.mockResolvedValueOnce('SKU-000001');
      mockRepo.findOne.mockResolvedValue(null); // for the uniqueness check
      mockRepo.findOne.mockResolvedValueOnce(null); // uniqueness check
      mockRepo.findOne.mockResolvedValueOnce({
        id: 'new-product-id',
        sku: 'SKU-000001',
        barcode: '194252056387',
        brand: activeBrand,
        category: activeCategory,
        branch: activeBranch,
        ...validDto,
      });

      await service.create({ ...validDto, barcode: '194252056387' });

      // Called once (SKU only) — barcode counter NOT called
      expect(mockCountersService.next).toHaveBeenCalledTimes(1);
      expect(mockCountersService.next).toHaveBeenCalledWith(CounterType.SKU);
    });

    it('throws BadRequestException when brand does not exist', async () => {
      mockBrandsService.findOne.mockResolvedValue(null);

      await expect(service.create(validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when brand is inactive', async () => {
      mockBrandsService.findOne.mockResolvedValue({
        ...activeBrand,
        is_active: false,
      });

      await expect(service.create(validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when category is inactive', async () => {
      mockCategoriesService.findOne.mockResolvedValue({
        ...activeCategory,
        is_active: false,
      });

      await expect(service.create(validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when branch is inactive', async () => {
      mockBranchesService.findOne.mockResolvedValue({
        ...activeBranch,
        is_active: false,
      });

      await expect(service.create(validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException when provided barcode already exists', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'other',
        barcode: '194252056387',
      });

      await expect(
        service.create({ ...validDto, barcode: '194252056387' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns only active products by default, sorted DESC by created_at', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAll({});

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { is_active: true },
        relations: ['brand', 'category', 'branch'],
        order: { created_at: 'DESC' },
      });
    });

    it('includes inactive when includeInactive=true', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAll({ includeInactive: true });

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filters by brandId when provided', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAll({ brandId: 'brand-1' });

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { is_active: true, brand_id: 'brand-1' },
        }),
      );
    });

    it('filters by multiple criteria', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAll({
        brandId: 'brand-1',
        categoryId: 'cat-1',
        branchId: 'branch-1',
        productType: 'PHONE',
      });

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            is_active: true,
            brand_id: 'brand-1',
            category_id: 'cat-1',
            branch_id: 'branch-1',
            product_type: 'PHONE',
          },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the product with nested relations when found', async () => {
      const product = {
        id: 'p1',
        name: 'iPhone',
        brand: activeBrand,
        category: activeCategory,
        branch: activeBranch,
      };
      mockRepo.findOne.mockResolvedValue(product);

      const result = await service.findOne('p1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'p1' },
        relations: ['brand', 'category', 'branch'],
      });
      expect(result).toBe(product);
    });

    it('throws NotFoundException when the product does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByBarcode', () => {
    it('returns the product with nested relations when found', async () => {
      const product = {
        id: 'p1',
        barcode: 'SLP-000001',
        brand: activeBrand,
        category: activeCategory,
        branch: activeBranch,
      };
      mockRepo.findOne.mockResolvedValue(product);

      const result = await service.findByBarcode('SLP-000001');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { barcode: 'SLP-000001' },
        relations: ['brand', 'category', 'branch'],
      });
      expect(result).toBe(product);
    });

    it('throws NotFoundException when no product has that barcode', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findByBarcode('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const existingProduct = {
      id: 'p1',
      product_type: ProductType.PHONE,
      name: 'iPhone 15',
      sku: 'SKU-000047',
      barcode: 'SLP-000047',
      brand_id: 'brand-1',
      category_id: 'cat-1',
      branch_id: 'branch-1',
      is_active: true,
      brand: activeBrand,
      category: activeCategory,
      branch: activeBranch,
    };

    beforeEach(() => {
      mockRepo.findOne.mockResolvedValue(existingProduct);
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));
    });

    it('renames a product', async () => {
      // First findOne = the existing product; second = refetch with relations
      mockRepo.findOne
        .mockResolvedValueOnce(existingProduct)
        .mockResolvedValueOnce({
          ...existingProduct,
          name: 'iPhone 15 Renamed',
        });

      const result = await service.update('p1', { name: 'iPhone 15 Renamed' });

      expect(result.name).toBe('iPhone 15 Renamed');
    });

    it('does not re-validate brand/category/branch when they do not change', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(existingProduct)
        .mockResolvedValueOnce(existingProduct);

      await service.update('p1', { name: 'New Name' });

      expect(mockBrandsService.findOne).not.toHaveBeenCalled();
      expect(mockCategoriesService.findOne).not.toHaveBeenCalled();
      expect(mockBranchesService.findOne).not.toHaveBeenCalled();
    });

    it('validates new brand when brand_id changes', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(existingProduct)
        .mockResolvedValueOnce(existingProduct);
      mockBrandsService.findOne.mockResolvedValue({
        id: 'brand-2',
        name: 'Samsung',
        is_active: true,
      });
      mockCategoriesService.findOne.mockResolvedValue(activeCategory);
      mockBranchesService.findOne.mockResolvedValue(activeBranch);

      await service.update('p1', { brand_id: 'brand-2' });

      expect(mockBrandsService.findOne).toHaveBeenCalledWith('brand-2');
    });

    it('throws when SKU is changed to one that already exists', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(existingProduct) // findOne
        .mockResolvedValueOnce({ id: 'other', sku: 'SKU-CUSTOM' }); // uniqueness check

      await expect(service.update('p1', { sku: 'SKU-CUSTOM' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws when barcode is changed to one that already exists', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(existingProduct)
        .mockResolvedValueOnce({ id: 'other', barcode: 'TAKEN' });

      await expect(service.update('p1', { barcode: 'TAKEN' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not check SKU uniqueness when SKU is unchanged', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(existingProduct)
        .mockResolvedValueOnce(existingProduct);

      await service.update('p1', { sku: 'SKU-000047' });

      // Only two findOne calls: initial fetch + refetch. No uniqueness check.
      expect(mockRepo.findOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('deactivate', () => {
    it('flips is_active to false', async () => {
      const product = { id: 'p1', is_active: true };
      mockRepo.findOne
        .mockResolvedValueOnce(product)
        .mockResolvedValueOnce({ ...product, is_active: false });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.deactivate('p1');

      expect(result.is_active).toBe(false);
    });

    it('is idempotent when already inactive', async () => {
      const inactive = { id: 'p1', is_active: false };
      mockRepo.findOne.mockResolvedValue(inactive);

      const result = await service.deactivate('p1');

      expect(result).toBe(inactive);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivate', () => {
    it('flips is_active to true', async () => {
      const product = { id: 'p1', is_active: false };
      mockRepo.findOne
        .mockResolvedValueOnce(product)
        .mockResolvedValueOnce({ ...product, is_active: true });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.reactivate('p1');

      expect(result.is_active).toBe(true);
    });

    it('is idempotent when already active', async () => {
      const active = { id: 'p1', is_active: true };
      mockRepo.findOne.mockResolvedValue(active);

      const result = await service.reactivate('p1');

      expect(result).toBe(active);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });
});
