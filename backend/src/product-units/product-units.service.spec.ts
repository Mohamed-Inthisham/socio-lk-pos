import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
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

  // ---- markSoldForSale ----

  describe('markSoldForSale', () => {
    let mockReadQb: {
      setLock: jest.Mock;
      where: jest.Mock;
      getOne: jest.Mock;
    };
    let mockUpdateQb: {
      update: jest.Mock;
      set: jest.Mock;
      where: jest.Mock;
      execute: jest.Mock;
    };
    let mockManager: { createQueryBuilder: jest.Mock };

    beforeEach(() => {
      mockReadQb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      };
      mockUpdateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManager = {
        createQueryBuilder: jest.fn((entityArg?: unknown) =>
          entityArg ? mockReadQb : mockUpdateQb,
        ),
      };
    });

    it('flips IN_STOCK to SOLD on the happy path', async () => {
      const unit = {
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.IN_STOCK,
        product_id: 'p-1',
        branch_id: 'b-1',
      };
      mockReadQb.getOne.mockResolvedValue(unit);

      await service.markSoldForSale(
        mockManager as unknown as import('typeorm').EntityManager,
        'u-1',
      );

      expect(mockReadQb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(mockReadQb.where).toHaveBeenCalledWith('unit.id = :unitId', {
        unitId: 'u-1',
      });
      expect(mockUpdateQb.update).toHaveBeenCalledWith(ProductUnit);
      expect(mockUpdateQb.set).toHaveBeenCalledWith({
        status: ProductUnitStatus.SOLD,
      });
      expect(mockUpdateQb.where).toHaveBeenCalledWith('id = :id', {
        id: 'u-1',
      });
      expect(mockUpdateQb.execute).toHaveBeenCalled();
    });

    it('throws raw Error when the unit does not exist (data integrity)', async () => {
      mockReadQb.getOne.mockResolvedValue(null);

      await expect(
        service.markSoldForSale(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-missing',
        ),
      ).rejects.toThrow('ProductUnit u-missing not found at complete time');
    });

    it('throws ConflictException with structured payload when status is SOLD', async () => {
      const unit = {
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.SOLD,
        product_id: 'p-1',
        branch_id: 'b-1',
      };
      mockReadQb.getOne.mockResolvedValue(unit);

      try {
        await service.markSoldForSale(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        );
        fail('expected ConflictException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse();
        expect(response).toMatchObject({
          message: expect.stringContaining('SOLD'),
          existing_unit: {
            id: 'u-1',
            status: ProductUnitStatus.SOLD,
            product_id: 'p-1',
            branch_id: 'b-1',
          },
        });
      }
    });

    it('throws ConflictException with structured payload when status is RETURNED', async () => {
      const unit = {
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.RETURNED,
        product_id: 'p-1',
        branch_id: 'b-1',
      };
      mockReadQb.getOne.mockResolvedValue(unit);

      try {
        await service.markSoldForSale(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        );
        fail('expected ConflictException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse();
        expect(response).toMatchObject({
          message: expect.stringContaining('RETURNED'),
          existing_unit: expect.objectContaining({
            status: ProductUnitStatus.RETURNED,
          }),
        });
      }
    });

    it('throws ConflictException with structured payload when status is WRITTEN_OFF', async () => {
      const unit = {
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.WRITTEN_OFF,
        product_id: 'p-1',
        branch_id: 'b-1',
      };
      mockReadQb.getOne.mockResolvedValue(unit);

      try {
        await service.markSoldForSale(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        );
        fail('expected ConflictException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse();
        expect(response).toMatchObject({
          message: expect.stringContaining('WRITTEN_OFF'),
          existing_unit: expect.objectContaining({
            status: ProductUnitStatus.WRITTEN_OFF,
          }),
        });
      }
    });

    it('does NOT run the UPDATE when the status check fails', async () => {
      mockReadQb.getOne.mockResolvedValue({
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.SOLD,
        product_id: 'p-1',
        branch_id: 'b-1',
      });

      await expect(
        service.markSoldForSale(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockUpdateQb.execute).not.toHaveBeenCalled();
    });
  });

  // ---- markAvailableForReversal ----

  describe('markAvailableForReversal', () => {
    let mockReadQb: {
      setLock: jest.Mock;
      where: jest.Mock;
      getOne: jest.Mock;
    };
    let mockUpdateQb: {
      update: jest.Mock;
      set: jest.Mock;
      where: jest.Mock;
      execute: jest.Mock;
    };
    let mockManager: { createQueryBuilder: jest.Mock };

    beforeEach(() => {
      mockReadQb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      };
      mockUpdateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManager = {
        createQueryBuilder: jest.fn((entityArg?: unknown) =>
          entityArg ? mockReadQb : mockUpdateQb,
        ),
      };
    });

    it('flips SOLD to IN_STOCK on the happy path', async () => {
      mockReadQb.getOne.mockResolvedValue({
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.SOLD,
        product_id: 'p-1',
        branch_id: 'b-1',
      });

      await service.markAvailableForReversal(
        mockManager as unknown as import('typeorm').EntityManager,
        'u-1',
      );

      expect(mockReadQb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(mockUpdateQb.update).toHaveBeenCalledWith(ProductUnit);
      expect(mockUpdateQb.set).toHaveBeenCalledWith({
        status: ProductUnitStatus.IN_STOCK,
      });
      expect(mockUpdateQb.execute).toHaveBeenCalled();
    });

    it('throws raw Error when the unit does not exist (data integrity)', async () => {
      mockReadQb.getOne.mockResolvedValue(null);

      await expect(
        service.markAvailableForReversal(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-missing',
        ),
      ).rejects.toThrow('ProductUnit u-missing not found at void time');
    });

    it('throws raw Error when status is IN_STOCK (integrity: state machine bypassed)', async () => {
      mockReadQb.getOne.mockResolvedValue({
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.IN_STOCK,
        product_id: 'p-1',
        branch_id: 'b-1',
      });

      await expect(
        service.markAvailableForReversal(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        ),
      ).rejects.toThrow('expected SOLD');
    });

    it('throws raw Error when status is RETURNED (integrity)', async () => {
      mockReadQb.getOne.mockResolvedValue({
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.RETURNED,
        product_id: 'p-1',
        branch_id: 'b-1',
      });

      await expect(
        service.markAvailableForReversal(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        ),
      ).rejects.toThrow('expected SOLD');
    });

    it('throws raw Error when status is WRITTEN_OFF (integrity)', async () => {
      mockReadQb.getOne.mockResolvedValue({
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.WRITTEN_OFF,
        product_id: 'p-1',
        branch_id: 'b-1',
      });

      await expect(
        service.markAvailableForReversal(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        ),
      ).rejects.toThrow('expected SOLD');
    });

    it('does NOT run the UPDATE when the status check fails', async () => {
      mockReadQb.getOne.mockResolvedValue({
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.IN_STOCK,
        product_id: 'p-1',
        branch_id: 'b-1',
      });

      await expect(
        service.markAvailableForReversal(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        ),
      ).rejects.toThrow(Error);

      expect(mockUpdateQb.execute).not.toHaveBeenCalled();
    });
  });
});
