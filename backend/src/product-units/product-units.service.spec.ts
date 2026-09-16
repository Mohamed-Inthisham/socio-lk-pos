import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ProductUnitsService } from './product-units.service';
import { ProductUnit } from './entities/product-unit.entity';
import { ProductUnitStatus } from './enums/product-unit-status.enum';

describe('ProductUnitsService', () => {
  let service: ProductUnitsService;

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

  beforeEach(async () => {
    jest.resetAllMocks();
    mockQueryBuilder.leftJoinAndSelect.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();
    mockQueryBuilder.orderBy.mockReturnThis();
    mockQueryBuilder.skip.mockReturnThis();
    mockQueryBuilder.take.mockReturnThis();
    mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductUnitsService,
        { provide: getRepositoryToken(ProductUnit), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ProductUnitsService>(ProductUnitsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---- findAll ----

  describe('findAll', () => {
    it('returns paginated results with default page and limit', async () => {
      const units = [
        { id: 'u-1', imei: '356938035643809' },
        { id: 'u-2', imei: '356938035643810' },
      ];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([units, 2]);

      const result = await service.findAll({});

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(50);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'unit.created_at',
        'DESC',
      );
      expect(result).toEqual({
        data: units,
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

    it('applies pagination correctly on page 3 with custom limit', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 3, limit: 25 });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(50);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(25);
    });

    it('filters by productId when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ productId: 'prod-42' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.product_id = :productId',
        { productId: 'prod-42' },
      );
    });

    it('filters by branchId when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ branchId: 'branch-7' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.branch_id = :branchId',
        { branchId: 'branch-7' },
      );
    });

    it('filters by status when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ status: ProductUnitStatus.SOLD });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.status = :status',
        { status: ProductUnitStatus.SOLD },
      );
    });

    it('filters by imei (exact match) when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ imei: '356938035643809' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.imei = :imei',
        { imei: '356938035643809' },
      );
    });

    it('combines all four filters with AND', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({
        productId: 'prod-42',
        branchId: 'branch-7',
        status: ProductUnitStatus.IN_STOCK,
        imei: '356938035643809',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(4);
    });

    it('does not apply filters when none provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('joins product, branch, phone_purchase, and customer for hydrated results', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'unit.product',
        'product',
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'unit.branch',
        'branch',
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'unit.phone_purchase',
        'phone_purchase',
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'phone_purchase.customer',
        'customer',
      );
    });
  });

  // ---- findOne ----

  describe('findOne', () => {
    it('returns the unit with all relations hydrated', async () => {
      const unit = {
        id: 'u-1',
        imei: '356938035643809',
        product: { id: 'p-1' },
        branch: { id: 'b-1' },
        phone_purchase: { id: 'pp-1', customer: { id: 'c-1' } },
      };
      mockRepo.findOne.mockResolvedValue(unit);

      const result = await service.findOne('u-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        relations: expect.arrayContaining([
          'product',
          'branch',
          'phone_purchase',
          'phone_purchase.customer',
        ]),
      });
      expect(result).toBe(unit);
    });

    it('throws NotFoundException when the unit does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('u-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
