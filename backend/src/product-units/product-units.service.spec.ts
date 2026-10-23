import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductUnitsService } from './product-units.service';
import { ProductUnit } from './entities/product-unit.entity';
import { ProductUnitStatus } from './enums/product-unit-status.enum';
import { QueryFailedError } from 'typeorm';
import { StockService } from '../stock/stock.service';
import { lockInventoryRows } from '../stock/lock-inventory-rows';
import { UserRole } from '../users/enums/user-role.enum';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

// The global lock order's helper takes its own queries on the manager;
// mocked so the per-call manager mocks below stay exact (Phase 6.4 P7-25).
jest.mock('../stock/lock-inventory-rows');

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

  // passInspection (Phase 6.4 P7-7) opens a transaction, adds stock and
  // writes an audit row through the transaction's manager.
  const mockDataSource = { transaction: jest.fn() };
  const mockStockService = { incrementForReversal: jest.fn() };
  const mockAuditRepo = { save: jest.fn() };

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
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: StockService, useValue: mockStockService },
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
    // Buy-back check: "is there a newer unit for this IMEI that isn't
    // RETURNED?" (alias 'later'). Defaults to none.
    let mockLaterQb: {
      where: jest.Mock;
      andWhere: jest.Mock;
      orderBy: jest.Mock;
      getOne: jest.Mock;
    };
    let mockManager: { createQueryBuilder: jest.Mock; query: jest.Mock };

    const soldUnit = () => ({
      id: 'u-1',
      imei: '354789102345678',
      status: ProductUnitStatus.SOLD,
      product_id: 'p-1',
      branch_id: 'b-1',
      created_at: new Date('2026-01-01T10:00:00Z'),
    });

    beforeEach(() => {
      mockReadQb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      };
      mockLaterQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockUpdateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManager = {
        createQueryBuilder: jest.fn((entityArg?: unknown, alias?: string) =>
          !entityArg
            ? mockUpdateQb
            : alias === 'later'
              ? mockLaterQb
              : mockReadQb,
        ),
        // The later-sale lookup (P6-22)
        query: jest.fn().mockResolvedValue([]),
      };
    });

    const laterUnit = () => ({
      id: 'u-2',
      imei: '354789102345678',
      status: ProductUnitStatus.IN_STOCK,
      product_id: 'p-used',
      branch_id: 'b-1',
      phone_purchase_id: 'pp-2',
    });

    const conflictOf = async () => {
      try {
        await service.markAvailableForReversal(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        );
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        return (err as ConflictException).getResponse() as Record<
          string,
          unknown
        >;
      }
      throw new Error('Expected ConflictException');
    };

    it('names the later sale when the phone was traded back in on it (TAKEN_BACK_ON_SALE)', async () => {
      mockReadQb.getOne.mockResolvedValue(soldUnit());
      mockLaterQb.getOne.mockResolvedValue(laterUnit());
      mockManager.query.mockResolvedValue([
        { id: 'sale-b', sale_number: 'INV-20261021-0002' },
      ]);

      const response = await conflictOf();

      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('p.trade_in_phone_purchase_id = $1'),
        ['pp-2'],
      );
      expect(response).toMatchObject({
        message: expect.stringContaining('taken back into stock'),
        imei: '354789102345678',
        reason: 'TAKEN_BACK_ON_SALE',
        later_sale: { id: 'sale-b', sale_number: 'INV-20261021-0002' },
        existing_unit: { id: 'u-2', status: ProductUnitStatus.IN_STOCK },
      });
      expect(mockUpdateQb.execute).not.toHaveBeenCalled();
    });

    it('refuses for good when the phone was bought back on a phone purchase (BOUGHT_BACK_ON_PURCHASE, no later sale)', async () => {
      mockReadQb.getOne.mockResolvedValue(soldUnit());
      mockLaterQb.getOne.mockResolvedValue(laterUnit());
      mockManager.query.mockResolvedValue([]);

      const response = await conflictOf();

      expect(response).toMatchObject({
        message:
          "This sale can't be voided: the phone (IMEI 354789102345678) " +
          'was bought back on a later purchase.',
        imei: '354789102345678',
        reason: 'BOUGHT_BACK_ON_PURCHASE',
        later_sale: null,
      });
      expect(mockUpdateQb.execute).not.toHaveBeenCalled();
    });

    it('checks for a newer, non-RETURNED unit with the same IMEI before flipping', async () => {
      const unit = soldUnit();
      mockReadQb.getOne.mockResolvedValue(unit);

      await service.markAvailableForReversal(
        mockManager as unknown as import('typeorm').EntityManager,
        'u-1',
      );

      expect(mockLaterQb.where).toHaveBeenCalledWith('later.imei = :imei', {
        imei: '354789102345678',
      });
      expect(mockLaterQb.andWhere).toHaveBeenCalledWith('later.id != :id', {
        id: 'u-1',
      });
      expect(mockLaterQb.andWhere).toHaveBeenCalledWith(
        'later.created_at > :createdAt',
        { createdAt: unit.created_at },
      );
      expect(mockLaterQb.andWhere).toHaveBeenCalledWith(
        'later.status != :returned',
        { returned: ProductUnitStatus.RETURNED },
      );
      expect(mockUpdateQb.execute).toHaveBeenCalled();
    });

    it('throws 409 when the phone was bought back after this sale (and does not flip)', async () => {
      mockReadQb.getOne.mockResolvedValue(soldUnit());
      mockLaterQb.getOne.mockResolvedValue({
        id: 'u-2',
        imei: '354789102345678',
        status: ProductUnitStatus.IN_STOCK,
        product_id: 'p-used',
        branch_id: 'b-1',
      });

      try {
        await service.markAvailableForReversal(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        );
        fail('Expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse() as {
          message: string;
          existing_unit: unknown;
        };
        expect(response.message).toContain('taken back into stock');
        expect(response.existing_unit).toEqual({
          id: 'u-2',
          status: ProductUnitStatus.IN_STOCK,
          product_id: 'p-used',
          branch_id: 'b-1',
        });
      }
      expect(mockUpdateQb.execute).not.toHaveBeenCalled();
    });

    it('maps a live-IMEI unique violation on the flip (concurrent buy-back) to 409', async () => {
      mockReadQb.getOne.mockResolvedValue(soldUnit());
      mockUpdateQb.execute.mockRejectedValue(
        new QueryFailedError(
          'UPDATE "product_units" ...',
          [],
          Object.assign(new Error('duplicate key value'), {
            code: '23505',
            constraint: 'uq_product_units_imei_live',
          }),
        ),
      );

      try {
        await service.markAvailableForReversal(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        );
        fail('Expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse() as {
          existing_unit: unknown;
        };
        expect(response.existing_unit).toBeNull();
        // The race: generic, no lookup in the aborted transaction (P6-22)
        expect(response).toMatchObject({
          message: expect.stringContaining('taken back into stock'),
          imei: '354789102345678',
          reason: null,
          later_sale: null,
        });
      }
      expect(mockManager.query).not.toHaveBeenCalled();
    });

    it('propagates other errors from the flip unchanged', async () => {
      mockReadQb.getOne.mockResolvedValue(soldUnit());
      const other = new QueryFailedError(
        'UPDATE "product_units" ...',
        [],
        Object.assign(new Error('check violation'), {
          code: '23514',
          constraint: 'CHK_product_units_status',
        }),
      );
      mockUpdateQb.execute.mockRejectedValue(other);

      await expect(
        service.markAvailableForReversal(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        ),
      ).rejects.toBe(other);
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

  // ---- markReturnedForVoid ----

  describe('markReturnedForVoid', () => {
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
    let mockManager: { createQueryBuilder: jest.Mock; query: jest.Mock };

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
        // The resale lookup (P6-22)
        query: jest.fn().mockResolvedValue([]),
      };
    });

    it('names the most recently completed sale that resold the trade-in phone (RESOLD)', async () => {
      mockReadQb.getOne.mockResolvedValue({
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.SOLD,
        product_id: 'p-1',
        branch_id: 'b-1',
      });
      // Two completed sales have a line on the unit: the query orders by
      // completed_at DESC with LIMIT 1, so the newest comes back first.
      mockManager.query.mockResolvedValue([
        { id: 'sale-newer', sale_number: 'INV-20261022-0003' },
        { id: 'sale-older', sale_number: 'INV-20261020-0001' },
      ]);

      let response: Record<string, unknown> | undefined;
      try {
        await service.markReturnedForVoid(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        );
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        response = (err as ConflictException).getResponse() as Record<
          string,
          unknown
        >;
      }

      const [sql, params] = mockManager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('l.product_unit_id = $1');
      expect(sql).toContain("s.status = 'COMPLETED'");
      expect(sql).toMatch(/ORDER BY s\.completed_at DESC\s+LIMIT 1/);
      expect(params).toEqual(['u-1']);
      expect(response).toMatchObject({
        imei: '354789102345678',
        reason: 'RESOLD',
        later_sale: { id: 'sale-newer', sale_number: 'INV-20261022-0003' },
      });
      expect(mockUpdateQb.execute).not.toHaveBeenCalled();
    });

    it('flips IN_STOCK to RETURNED and returns the unit on the happy path', async () => {
      const unit = {
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.IN_STOCK,
        product_id: 'p-1',
        branch_id: 'b-1',
      };
      mockReadQb.getOne.mockResolvedValue(unit);

      const result = await service.markReturnedForVoid(
        mockManager as unknown as import('typeorm').EntityManager,
        'u-1',
      );

      expect(mockReadQb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(mockReadQb.where).toHaveBeenCalledWith('unit.id = :unitId', {
        unitId: 'u-1',
      });
      expect(mockUpdateQb.update).toHaveBeenCalledWith(ProductUnit);
      expect(mockUpdateQb.set).toHaveBeenCalledWith({
        status: ProductUnitStatus.RETURNED,
      });
      expect(mockUpdateQb.where).toHaveBeenCalledWith('id = :id', {
        id: 'u-1',
      });
      expect(mockUpdateQb.execute).toHaveBeenCalled();
      // Returned unit gives voidSale product_id + branch_id for the
      // paired stock decrement, no second read needed.
      expect(result).toBe(unit);
    });

    it('throws raw Error when the unit does not exist (data integrity)', async () => {
      mockReadQb.getOne.mockResolvedValue(null);

      await expect(
        service.markReturnedForVoid(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-missing',
        ),
      ).rejects.toThrow(
        'ProductUnit u-missing not found at trade-in-void time',
      );
    });

    it('throws ConflictException with structured payload when status is SOLD (resold before void)', async () => {
      const unit = {
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.SOLD,
        product_id: 'p-1',
        branch_id: 'b-1',
      };
      mockReadQb.getOne.mockResolvedValue(unit);

      try {
        await service.markReturnedForVoid(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        );
        fail('expected ConflictException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse();
        expect(response).toMatchObject({
          message: expect.stringContaining('resold in a subsequent sale'),
          existing_unit: {
            id: 'u-1',
            status: ProductUnitStatus.SOLD,
            product_id: 'p-1',
            branch_id: 'b-1',
          },
        });
      }
    });

    it('throws raw Error when status is RETURNED (integrity: state machine bypassed)', async () => {
      mockReadQb.getOne.mockResolvedValue({
        id: 'u-1',
        imei: '354789102345678',
        status: ProductUnitStatus.RETURNED,
        product_id: 'p-1',
        branch_id: 'b-1',
      });

      await expect(
        service.markReturnedForVoid(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        ),
      ).rejects.toThrow(/expected IN_STOCK or SOLD/);
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
        service.markReturnedForVoid(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        ),
      ).rejects.toThrow(/expected IN_STOCK or SOLD/);
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
        service.markReturnedForVoid(
          mockManager as unknown as import('typeorm').EntityManager,
          'u-1',
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockUpdateQb.execute).not.toHaveBeenCalled();
    });
  });

  // ---- passInspection (Phase 6.4 P7-7) ----

  describe('passInspection', () => {
    const manager = {
      findOneOrFail: jest.fn(),
      query: jest.fn(),
      getRepository: jest.fn(() => mockAuditRepo),
    };

    const inspectionUnit = (overrides: Partial<ProductUnit> = {}) =>
      ({
        id: 'u-1',
        imei: '356938035643809',
        status: ProductUnitStatus.INSPECTION,
        product_id: 'p-1',
        branch_id: 'b-1',
        product: { name: 'Used iPhone 12 128GB' },
        ...overrides,
      }) as unknown as ProductUnit;

    const manager1 = {
      id: 'm-1',
      full_name: 'Branch Manager',
      role: UserRole.MANAGER,
      branch_id: 'b-1',
    };

    beforeEach(() => {
      mockDataSource.transaction.mockImplementation(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );
      manager.getRepository.mockReturnValue(mockAuditRepo);
      manager.findOneOrFail.mockResolvedValue(inspectionUnit());
      manager.query.mockResolvedValue(undefined);
      mockStockService.incrementForReversal.mockResolvedValue(undefined);
      mockAuditRepo.save.mockResolvedValue(undefined);
    });

    it('locks the stock row then the unit, flips INSPECTION to IN_STOCK, adds 1 to stock and audits it', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(inspectionUnit())
        .mockResolvedValueOnce({
          id: 'u-1',
          status: ProductUnitStatus.IN_STOCK,
        });

      const result = await service.passInspection('u-1', manager1, '1.2.3.4');

      expect(lockInventoryRows).toHaveBeenCalledWith(manager, {
        stock: [{ productId: 'p-1', branchId: 'b-1' }],
        unitIds: ['u-1'],
      });
      const lockOrder =
        jest.mocked(lockInventoryRows).mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(
        manager.findOneOrFail.mock.invocationCallOrder[0],
      );
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE product_units'),
        [ProductUnitStatus.IN_STOCK, 'u-1'],
      );
      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        manager,
        'p-1',
        'b-1',
        1,
      );
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'm-1',
          action: AuditAction.INSPECTION_PASSED,
          entity_type: 'ProductUnit',
          entity_id: 'u-1',
          description:
            'Inspection passed: IMEI 356938035643809 (Used iPhone 12 128GB) back in stock',
          changes: {
            status: {
              old: ProductUnitStatus.INSPECTION,
              new: ProductUnitStatus.IN_STOCK,
            },
          },
          ip_address: '1.2.3.4',
        }),
      );
      expect(result).toEqual({ id: 'u-1', status: ProductUnitStatus.IN_STOCK });
    });

    it('404 for an unknown unit, before any transaction', async () => {
      mockRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.passInspection('u-x', manager1)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('403 INSPECTION_WRONG_BRANCH for a manager of another branch, before the status check', async () => {
      mockRepo.findOne.mockResolvedValueOnce(
        inspectionUnit({
          branch_id: 'b-2',
          status: ProductUnitStatus.IN_STOCK,
        }),
      );

      await expect(
        service.passInspection('u-1', manager1),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'INSPECTION_WRONG_BRANCH' },
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('lets an admin pass at any branch', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(inspectionUnit({ branch_id: 'b-2' }))
        .mockResolvedValueOnce({ id: 'u-1' });

      await service.passInspection('u-1', {
        id: 'a-1',
        full_name: 'Admin',
        role: UserRole.ADMIN,
        branch_id: null,
      });

      expect(mockStockService.incrementForReversal).toHaveBeenCalled();
    });

    it('409 NOT_IN_INSPECTION when the unit is not waiting for inspection, before any transaction', async () => {
      mockRepo.findOne.mockResolvedValueOnce(
        inspectionUnit({ status: ProductUnitStatus.IN_STOCK }),
      );

      await expect(
        service.passInspection('u-1', manager1),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          message:
            'This phone (IMEI 356938035643809) is not waiting for inspection (status: IN_STOCK).',
          code: 'NOT_IN_INSPECTION',
          status: ProductUnitStatus.IN_STOCK,
        },
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('re-checks under the lock: a pass that lost the race gets the same 409 and changes nothing', async () => {
      mockRepo.findOne.mockResolvedValueOnce(inspectionUnit());
      manager.findOneOrFail.mockResolvedValueOnce(
        inspectionUnit({ status: ProductUnitStatus.IN_STOCK }),
      );

      await expect(
        service.passInspection('u-1', manager1),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'NOT_IN_INSPECTION' },
      });
      expect(manager.query).not.toHaveBeenCalled();
      expect(mockStockService.incrementForReversal).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });
  });
});
