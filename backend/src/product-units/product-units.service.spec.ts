import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductUnitsService } from './product-units.service';
import { ProductUnit } from './entities/product-unit.entity';
import { ProductUnitStatus } from './enums/product-unit-status.enum';
import { Brackets, QueryFailedError } from 'typeorm';
import { StockService } from '../stock/stock.service';
import { lockInventoryRows } from '../stock/lock-inventory-rows';
import {
  StockMovementReferenceType,
  StockMovementType,
} from '../stock/enums/stock-movement-type.enum';
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
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };

  const mockRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  // passInspection (Phase 6.4 P7-7) opens a transaction, adds stock and
  // writes an audit row through the transaction's manager.
  const mockDataSource = { transaction: jest.fn(), query: jest.fn() };
  const mockStockService = { incrementForReversal: jest.fn() };
  const mockAuditRepo = { save: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockQueryBuilder.leftJoinAndSelect.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();
    mockQueryBuilder.orderBy.mockReturnThis();
    mockQueryBuilder.addOrderBy.mockReturnThis();
    mockQueryBuilder.skip.mockReturnThis();
    mockQueryBuilder.take.mockReturnThis();
    mockQueryBuilder.select.mockReturnThis();
    mockQueryBuilder.addSelect.mockReturnThis();
    mockQueryBuilder.innerJoin.mockReturnThis();
    mockQueryBuilder.where.mockReturnThis();
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
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'unit.id',
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

    it('with a branch scope (GET /product-units/:id for a manager), looks the unit up at that branch in the same query, keeping its relations', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'u-1', branch_id: 'b-1' });

      await service.findOne('u-1', { branchId: 'b-1' });

      expect(mockRepo.findOne).toHaveBeenCalledTimes(1);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'u-1', branch_id: 'b-1' },
        relations: expect.arrayContaining([
          'phone_purchase',
          'phone_purchase.customer',
          'sale_lines',
          'sale_lines.sale',
        ]),
      });
    });

    it('answers a unit at another branch exactly as a missing one: 404 Product unit not found', async () => {
      // The scoped query finds nothing for a unit at another branch.
      mockRepo.findOne.mockResolvedValue(null);
      const otherBranch = await service
        .findOne('u-other', { branchId: 'b-1' })
        .catch((e: unknown) => e);
      const missing = await service
        .findOne('u-missing')
        .catch((e: unknown) => e);

      expect(otherBranch).toBeInstanceOf(NotFoundException);
      expect((otherBranch as NotFoundException).getResponse()).toEqual(
        (missing as NotFoundException).getResponse(),
      );
    });

    it('with no scope or an admin’s empty one, looks the unit up by id only', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'u-1' });

      await service.findOne('u-1');
      await service.findOne('u-1', { branchId: undefined });

      for (const [options] of mockRepo.findOne.mock.calls) {
        expect((options as { where: object }).where).toEqual({ id: 'u-1' });
      }
    });
  });

  // ---- markSoldForSale ----

  describe('search', () => {
    const CREATED_AT = new Date('2026-10-01T04:00:00.000Z');
    /** What must never leave this endpoint, even if the query loaded it. */
    const SENSITIVE = {
      buying_price: '80000.00',
      selling_price: '100000.00',
      phone_purchase_id: 'pp-1',
      phone_purchase: {
        total_amount: '80000.00',
        notes: 'Call 0771234567',
        customer: {
          name: 'Kamal',
          phone: '0771234567',
          nic: '199300000001',
          email: 'kamal@example.com',
          address: '1 Galle Road',
        },
      },
      sale_lines: [{ cost_price_snapshot: '80000.00' }],
    };
    const unit = (overrides = {}) => ({
      id: 'u-1',
      product_id: 'p-1',
      branch_id: 'b-1',
      imei: '356938035643809',
      imei_number: '356938035643809',
      serial_number: 'SN-1',
      unit_code: 'SLU00000123',
      status: ProductUnitStatus.SOLD,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
      product: {
        id: 'p-1',
        name: 'Galaxy A15',
        sku: 'SKU-000007',
        tracking_method: 'IMEI',
        buying_price: '70000.00',
        selling_price: '90000.00',
      },
      branch: { id: 'b-1', name: 'Main Shop', phone: '0112345678' },
      ...overrides,
    });

    /** The conditions inside the search's Brackets, as they were added. */
    const matchConditions = (): {
      kind: 'where' | 'orWhere';
      sql: string;
      params: { pattern: string };
    }[] => {
      const added: {
        kind: 'where' | 'orWhere';
        sql: string;
        params: { pattern: string };
      }[] = [];
      const collect =
        (kind: 'where' | 'orWhere') =>
        (sql: string, params: { pattern: string }) => {
          added.push({ kind, sql, params });
          return builder;
        };
      const builder = { where: collect('where'), orWhere: collect('orWhere') };
      const [brackets] = mockQueryBuilder.where.mock.calls[0] as [Brackets];
      brackets.whereFactory(builder as never);
      return added;
    };

    beforeEach(() => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
    });

    it.each([
      ['the IMEI', 'unit.imei_number'],
      ['the legacy imei column', 'unit.imei'],
      ['the serial number', 'unit.serial_number'],
      ['the unit code', 'unit.unit_code'],
      ['the SKU', 'product.sku'],
      ['the product name', 'product.name'],
    ])('matches part of %s, in any case', async (_, column) => {
      await service.search({ q: 'gAlAx' });

      expect(matchConditions()).toContainEqual(
        expect.objectContaining({
          sql: `${column} ILIKE :pattern`,
          params: { pattern: '%gAlAx%' },
        }),
      );
    });

    it('searches exactly those six columns', async () => {
      await service.search({ q: 'gal' });

      expect(matchConditions().map((condition) => condition.sql)).toEqual([
        'unit.imei_number ILIKE :pattern',
        'unit.imei ILIKE :pattern',
        'unit.serial_number ILIKE :pattern',
        'unit.unit_code ILIKE :pattern',
        'product.sku ILIKE :pattern',
        'product.name ILIKE :pattern',
      ]);
    });

    it('groups the OR inside Brackets, and adds no OR outside them', async () => {
      await service.search({ q: 'gal', branchId: 'b-1' });

      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where.mock.calls[0][0]).toBeInstanceOf(Brackets);
      expect(matchConditions().map((condition) => condition.kind)).toEqual([
        'where',
        'orWhere',
        'orWhere',
        'orWhere',
        'orWhere',
        'orWhere',
      ]);
      expect(mockQueryBuilder).not.toHaveProperty('orWhere');
    });

    it.each([
      ['a percent sign', '50%', '%50\\%%'],
      ['an underscore', 'a_b', '%a\\_b%'],
      ['a backslash', 'a\\b', '%a\\\\b%'],
      ['all three', '%_\\', '%\\%\\_\\\\%'],
    ])('escapes %s so it matches itself', async (_, q, pattern) => {
      await service.search({ q });

      expect(matchConditions()[0].params).toEqual({ pattern });
    });

    it('adds the branch as a separate AND', async () => {
      await service.search({ q: 'gal', branchId: 'b-1' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.branch_id = :branchId',
        { branchId: 'b-1' },
      );
    });

    it('adds no branch for an admin searching every branch', async () => {
      await service.search({ q: 'gal' });

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('applies no status filter, even if one reached it', async () => {
      await service.search({
        q: 'gal',
        status: ProductUnitStatus.SOLD,
      } as never);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
      for (const { sql } of matchConditions()) {
        expect(sql).not.toContain('status');
      }
    });

    it('sorts by created_at DESC, then id DESC', async () => {
      await service.search({ q: 'gal' });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'unit.created_at',
        'DESC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'unit.id',
        'DESC',
      );
    });

    it('joins only the product and branch', async () => {
      await service.search({ q: 'gal' });

      expect(mockQueryBuilder.innerJoin.mock.calls).toEqual([
        ['unit.product', 'product'],
        ['unit.branch', 'branch'],
      ]);
      expect(mockQueryBuilder.leftJoinAndSelect).not.toHaveBeenCalled();
    });

    it('selects no price, customer or note column', async () => {
      await service.search({ q: 'gal' });

      const selected = [
        ...(mockQueryBuilder.select.mock.calls[0][0] as string[]),
        ...mockQueryBuilder.addSelect.mock.calls.flatMap(
          ([columns]) => columns as string[],
        ),
      ];
      expect(selected).toEqual([
        'unit.id',
        'unit.product_id',
        'unit.imei',
        'unit.imei_number',
        'unit.serial_number',
        'unit.unit_code',
        'unit.status',
        'unit.created_at',
        'product.id',
        'product.name',
        'product.sku',
        'product.tracking_method',
        'branch.id',
        'branch.name',
      ]);
    });

    it('maps each unit to the permitted fields', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[unit()], 1]);

      const { data } = await service.search({ q: 'gal' });

      expect(data).toEqual([
        {
          id: 'u-1',
          product_id: 'p-1',
          imei: '356938035643809',
          imei_number: '356938035643809',
          serial_number: 'SN-1',
          unit_code: 'SLU00000123',
          status: ProductUnitStatus.SOLD,
          created_at: CREATED_AT,
          product: {
            name: 'Galaxy A15',
            sku: 'SKU-000007',
            tracking_method: 'IMEI',
          },
          branch: { name: 'Main Shop' },
        },
      ]);
    });

    it('drops anything else, even if the query had loaded it', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [unit(SENSITIVE)],
        1,
      ]);

      const result = await service.search({ q: 'gal' });

      const text = JSON.stringify(result);
      for (const value of [
        'buying_price',
        'selling_price',
        'phone_purchase',
        'customer',
        'sale_lines',
        'cost_price_snapshot',
        'updated_at',
        '0771234567',
        '199300000001',
        'kamal@example.com',
        '1 Galle Road',
        '80000.00',
        '70000.00',
        '0112345678',
      ]) {
        expect(text).not.toContain(value);
      }
    });

    it('returns each record of a bought-back IMEI on its own', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [unit({ id: 'u-new' }), unit({ id: 'u-old' })],
        2,
      ]);

      const { data } = await service.search({ q: '3569' });

      expect(data.map((row) => row.id)).toEqual(['u-new', 'u-old']);
    });

    it('pages, with the metadata', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[unit()], 60]);

      const { meta } = await service.search({ q: 'gal', page: 2, limit: 25 });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(25);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(25);
      expect(meta).toEqual({
        total: 60,
        page: 2,
        limit: 25,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });

    it('defaults to the list’s page and limit', async () => {
      await service.search({ q: 'gal' });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(50);
    });
  });

  describe('findDetails', () => {
    const IMEI = '356938035643809';
    const CREATED_AT = new Date('2026-10-01T04:00:00.000Z');
    const unitRow = {
      id: 'u-1',
      imei: IMEI,
      imei_number: IMEI,
      serial_number: 'SN-1',
      unit_code: 'SLU00000123',
      status: ProductUnitStatus.SOLD,
      created_at: CREATED_AT,
      phone_purchase_id: null as string | null,
      product_id: 'p-1',
      product_name: 'Galaxy A15',
      product_sku: 'SKU-000007',
      tracking_method: 'IMEI',
      branch_id: 'b-1',
      branch_name: 'Main Shop',
    };
    /** What must never leave this endpoint, even if a query returned it. */
    const SENSITIVE = {
      buying_price: '80000.00',
      selling_price: '100000.00',
      cost_price_snapshot: '80000.00',
      unit_buying_price: '80000.00',
      trade_in_buying_price: '80000.00',
      total_amount: '80000.00',
      amount: '80000.00',
      phone: '0771234567',
      nic: '199300000001',
      email: 'kamal@example.com',
      address: '1 Galle Road',
      notes: 'Call 0771234567',
      reason: 'Screen cracked',
      override_reason: 'Manager said ok',
    };

    /** Answer each query by the table it reads, in place of the database. */
    const answer = (tables: {
      unit?: object[];
      phonePurchase?: object[];
      ledger?: object[];
      sales?: object[];
      returns?: object[];
    }) => {
      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM product_units')) {
          return Promise.resolve(tables.unit ?? [unitRow]);
        }
        if (sql.includes('FROM phone_purchases')) {
          return Promise.resolve(tables.phonePurchase ?? []);
        }
        if (sql.includes('FROM stock_movements')) {
          return Promise.resolve(tables.ledger ?? []);
        }
        if (sql.includes('FROM sale_return_lines')) {
          return Promise.resolve(tables.returns ?? []);
        }
        if (sql.includes('FROM sales')) {
          return Promise.resolve(tables.sales ?? []);
        }
        return Promise.reject(new Error(`Unexpected query: ${sql}`));
      });
    };
    const sqlFor = (table: string): [string, unknown[]] =>
      mockDataSource.query.mock.calls.find(([sql]) =>
        (sql as string).includes(`FROM ${table}`),
      ) as [string, unknown[]];

    const allKeys = (node: unknown): string[] => {
      if (Array.isArray(node)) return node.flatMap(allKeys);
      if (node instanceof Date || node === null) return [];
      if (typeof node === 'object') {
        return Object.entries(node).flatMap(([k, v]) => [k, ...allKeys(v)]);
      }
      return [];
    };

    it('maps the unit, product and branch', async () => {
      answer({});

      const result = await service.findDetails('u-1', {});

      expect(result.unit).toEqual({
        id: 'u-1',
        imei: IMEI,
        imei_number: IMEI,
        serial_number: 'SN-1',
        unit_code: 'SLU00000123',
        status: ProductUnitStatus.SOLD,
        created_at: CREATED_AT,
      });
      expect(result.product).toEqual({
        id: 'p-1',
        name: 'Galaxy A15',
        sku: 'SKU-000007',
        tracking_method: 'IMEI',
      });
      expect(result.branch).toEqual({ id: 'b-1', name: 'Main Shop' });
    });

    it('throws NotFoundException for a missing unit, and reads nothing else', async () => {
      answer({ unit: [] });

      await expect(service.findDetails('u-missing', {})).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDataSource.query).toHaveBeenCalledTimes(1);
    });

    it('scopes the unit to a manager’s branch: another branch’s unit is the same 404', async () => {
      answer({ unit: [] });

      await expect(
        service.findDetails('u-1', { branchId: 'b-2' }),
      ).rejects.toThrow(new NotFoundException('Product unit not found'));
      const [sql, params] = sqlFor('product_units');
      expect(sql).toContain('u.branch_id = $2::uuid');
      expect(params).toEqual(['u-1', 'b-2']);
    });

    it('passes no branch for an admin', async () => {
      answer({});

      await service.findDetails('u-1', { branchId: undefined });

      expect(sqlFor('product_units')[1]).toEqual(['u-1', null]);
    });

    it('a stock purchase comes from the ledger’s PURCHASE row', async () => {
      answer({
        ledger: [
          {
            id: 'sp-1',
            purchase_number: 'SP-1A2B3C4D',
            purchase_date: '2026-10-27',
            supplier_name: 'Ranjith Mobiles',
          },
        ],
      });

      const { acquisition } = await service.findDetails('u-1', {});

      expect(acquisition).toEqual({
        type: 'STOCK_PURCHASE',
        date: '2026-10-27',
        stock_purchase: { id: 'sp-1', purchase_number: 'SP-1A2B3C4D' },
        supplier_name: 'Ranjith Mobiles',
        customer_name: null,
        sale: null,
      });
      expect(sqlFor('stock_movements')[1]).toEqual([
        'u-1',
        StockMovementType.PURCHASE,
        StockMovementReferenceType.STOCK_PURCHASE_ITEM,
      ]);
    });

    it('a phone purchase with no trade-in payment is PHONE_PURCHASE', async () => {
      answer({
        unit: [{ ...unitRow, phone_purchase_id: 'pp-1' }],
        phonePurchase: [
          {
            created_at: CREATED_AT,
            customer_name: 'Kamal',
            sale_id: null,
            sale_number: null,
          },
        ],
      });

      const { acquisition } = await service.findDetails('u-1', {});

      expect(acquisition).toEqual({
        type: 'PHONE_PURCHASE',
        date: CREATED_AT,
        stock_purchase: null,
        supplier_name: null,
        customer_name: 'Kamal',
        sale: null,
      });
      expect(sqlFor('phone_purchases')[1]).toEqual(['pp-1']);
    });

    it('a phone purchase stamped on a payment is TRADE_IN, with its sale', async () => {
      answer({
        unit: [{ ...unitRow, phone_purchase_id: 'pp-1' }],
        phonePurchase: [
          {
            created_at: CREATED_AT,
            customer_name: 'Kamal',
            sale_id: 's-1',
            sale_number: 'INV-20261021-0007',
          },
        ],
      });

      const { acquisition } = await service.findDetails('u-1', {});

      expect(acquisition).toEqual({
        type: 'TRADE_IN',
        date: CREATED_AT,
        stock_purchase: null,
        supplier_name: null,
        customer_name: 'Kamal',
        sale: { id: 's-1', sale_number: 'INV-20261021-0007' },
      });
    });

    it('a phone purchase never reads the ledger', async () => {
      answer({
        unit: [{ ...unitRow, phone_purchase_id: 'pp-1' }],
        phonePurchase: [
          {
            created_at: CREATED_AT,
            customer_name: 'Kamal',
            sale_id: null,
            sale_number: null,
          },
        ],
      });

      await service.findDetails('u-1', {});

      expect(sqlFor('stock_movements')).toBeUndefined();
    });

    it('a unit with no ledger row is UNKNOWN, and every other field is null', async () => {
      answer({ ledger: [] });

      const { acquisition } = await service.findDetails('u-1', {});

      expect(acquisition).toEqual({
        type: 'UNKNOWN',
        date: null,
        stock_purchase: null,
        supplier_name: null,
        customer_name: null,
        sale: null,
      });
    });

    it('never guesses from the purchase lines’ identifier lists', async () => {
      answer({ ledger: [] });

      await service.findDetails('u-1', {});

      for (const [sql] of mockDataSource.query.mock.calls) {
        expect(sql).not.toMatch(/imei_numbers|serial_numbers/);
      }
    });

    it('asks for COMPLETED and VOIDED sales only, newest first', async () => {
      answer({});

      await service.findDetails('u-1', {});

      const [sql, params] = sqlFor('sales');
      expect(params).toEqual(['u-1', ['COMPLETED', 'VOIDED']]);
      expect(sql).toContain('ORDER BY s.completed_at DESC');
    });

    it('maps sales, and a sale with no customer has a null customer_name', async () => {
      const completedAt = new Date('2026-10-20T04:00:00.000Z');
      const voidedAt = new Date('2026-10-21T04:00:00.000Z');
      answer({
        sales: [
          {
            id: 's-2',
            sale_number: 'INV-2',
            status: 'COMPLETED',
            completed_at: completedAt,
            voided_at: null,
            customer_name: null,
          },
          {
            id: 's-1',
            sale_number: 'INV-1',
            status: 'VOIDED',
            completed_at: completedAt,
            voided_at: voidedAt,
            customer_name: 'Nimal',
          },
        ],
      });

      const { sales } = await service.findDetails('u-1', {});

      expect(sales).toEqual([
        {
          id: 's-2',
          sale_number: 'INV-2',
          status: 'COMPLETED',
          completed_at: completedAt,
          voided_at: null,
          customer_name: null,
        },
        {
          id: 's-1',
          sale_number: 'INV-1',
          status: 'VOIDED',
          completed_at: completedAt,
          voided_at: voidedAt,
          customer_name: 'Nimal',
        },
      ]);
    });

    it('maps returns, newest first', async () => {
      const returnedAt = new Date('2026-10-22T04:00:00.000Z');
      answer({
        returns: [
          {
            id: 'r-1',
            return_number: 'RET-20261022-0001',
            sale_id: 's-1',
            sale_number: 'INV-1',
            disposition: 'INSPECTION',
            returned_at: returnedAt,
          },
        ],
      });

      const { returns } = await service.findDetails('u-1', {});

      expect(returns).toEqual([
        {
          id: 'r-1',
          return_number: 'RET-20261022-0001',
          sale_id: 's-1',
          sale_number: 'INV-1',
          disposition: 'INSPECTION',
          returned_at: returnedAt,
        },
      ]);
      expect(sqlFor('sale_return_lines')[0]).toContain(
        'ORDER BY r.created_at DESC',
      );
    });

    it('selects no sensitive column in any query', async () => {
      answer({
        unit: [{ ...unitRow, phone_purchase_id: 'pp-1' }],
        phonePurchase: [
          {
            created_at: CREATED_AT,
            customer_name: 'Kamal',
            sale_id: null,
            sale_number: null,
          },
        ],
      });
      await service.findDetails('u-1', {});
      answer({});
      await service.findDetails('u-1', {});

      expect(mockDataSource.query.mock.calls.length).toBeGreaterThanOrEqual(8);
      for (const [sql] of mockDataSource.query.mock.calls) {
        const selected = (sql as string).split(/\bFROM\b/)[0];
        expect(selected).not.toContain('*');
        for (const column of Object.keys(SENSITIVE)) {
          expect(selected).not.toMatch(new RegExp(`\\b${column}\\b`));
        }
      }
    });

    it('drops anything a query returned beyond the mapped fields', async () => {
      answer({
        unit: [{ ...unitRow, phone_purchase_id: 'pp-1', ...SENSITIVE }],
        phonePurchase: [
          {
            created_at: CREATED_AT,
            customer_name: 'Kamal',
            sale_id: 's-1',
            sale_number: 'INV-1',
            ...SENSITIVE,
          },
        ],
        sales: [
          {
            id: 's-1',
            sale_number: 'INV-1',
            status: 'COMPLETED',
            completed_at: CREATED_AT,
            voided_at: null,
            customer_name: 'Kamal',
            ...SENSITIVE,
          },
        ],
        returns: [
          {
            id: 'r-1',
            return_number: 'RET-1',
            sale_id: 's-1',
            sale_number: 'INV-1',
            disposition: 'INSPECTION',
            returned_at: CREATED_AT,
            ...SENSITIVE,
          },
        ],
      });

      const result = await service.findDetails('u-1', {});

      const keys = allKeys(result);
      for (const forbidden of Object.keys(SENSITIVE)) {
        expect(keys).not.toContain(forbidden);
      }
      expect(JSON.stringify(result)).not.toContain('0771234567');
      expect(JSON.stringify(result)).not.toContain('199300000001');
      expect(JSON.stringify(result)).not.toContain('80000.00');
    });

    it('drops a stock purchase’s extra fields too', async () => {
      answer({
        ledger: [
          {
            id: 'sp-1',
            purchase_number: 'SP-1',
            purchase_date: '2026-10-27',
            supplier_name: 'Ranjith Mobiles',
            ...SENSITIVE,
          },
        ],
      });

      const result = await service.findDetails('u-1', {});

      const keys = allKeys(result);
      for (const forbidden of Object.keys(SENSITIVE)) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });

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
      // The return line that sent the phone to inspection (the stock
      // ledger's reference, Phase 1 T1); the status UPDATE returns nothing.
      manager.query.mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes('FROM sale_return_lines') ? [{ id: 'rl-1' }] : undefined,
        ),
      );
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

      // The re-read after the pass is unscoped (Phase 2 P2-3): its own
      // branch check already ran.
      const [, [reRead]] = mockRepo.findOne.mock.calls as [
        unknown,
        [{ where: object }],
      ];
      expect(reRead.where).toEqual({ id: 'u-1' });

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
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM sale_return_lines'),
        ['u-1', 'INSPECTION'],
      );
      expect(mockStockService.incrementForReversal).toHaveBeenCalledWith(
        manager,
        'p-1',
        'b-1',
        1,
        {
          type: StockMovementType.INSPECTION_PASSED,
          referenceType: StockMovementReferenceType.SALE_RETURN_LINE,
          referenceId: 'rl-1',
          createdById: 'm-1',
          unit: {
            id: 'u-1',
            from: ProductUnitStatus.INSPECTION,
            to: ProductUnitStatus.IN_STOCK,
          },
        },
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

  // ---- findSellableByIdentifier ----

  describe('findSellableByIdentifier', () => {
    const IMEI = '356938035643809';
    const SERIAL = 'SN-HUB-1';
    const CODE = 'SLU00000123';
    const BRANCH = 'b-1';

    const lookup = {
      innerJoinAndSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      getOne: jest.fn(),
    };

    const phone = (overrides = {}) => ({
      id: 'u-1',
      product_id: 'p-1',
      branch_id: BRANCH,
      imei: IMEI,
      imei_number: IMEI,
      serial_number: null as string | null,
      unit_code: CODE,
      status: ProductUnitStatus.IN_STOCK,
      product: { id: 'p-1', tracking_method: 'IMEI' },
      ...overrides,
    });
    const hub = (overrides = {}) =>
      phone({
        imei: SERIAL,
        imei_number: null,
        serial_number: SERIAL,
        product: { id: 'p-2', tracking_method: 'SERIAL_NUMBER' },
        ...overrides,
      });

    /** Every condition added to the lookups, in order. */
    const conditions = () =>
      (lookup.andWhere.mock.calls as [string][]).map(([sql]) => sql);
    const IDENTIFIER_SQL =
      '(unit.imei = :identifier OR unit.imei_number = :identifier OR unit.serial_number = :identifier)';

    beforeEach(() => {
      lookup.innerJoinAndSelect.mockReturnThis();
      lookup.where.mockReturnThis();
      lookup.andWhere.mockReturnThis();
      lookup.orderBy.mockReturnThis();
      lookup.addOrderBy.mockReturnThis();
      mockRepo.createQueryBuilder.mockReturnValue(
        lookup as unknown as typeof mockQueryBuilder,
      );
    });

    it('resolves a unit code to the exact unit and its real IMEI', async () => {
      lookup.getOne.mockResolvedValueOnce(phone());

      const result = await service.findSellableByIdentifier(CODE, BRANCH);

      expect(result).toMatchObject({
        identifier: IMEI,
        identifierType: 'IMEI',
        unitId: 'u-1',
      });
      expect(lookup.andWhere).toHaveBeenCalledWith(
        'unit.unit_code = :unitCode',
        { unitCode: CODE },
      );
      expect(conditions()).not.toContain(IDENTIFIER_SQL);
    });

    it('resolves a unit code to the real serial number', async () => {
      lookup.getOne.mockResolvedValueOnce(hub());

      const result = await service.findSellableByIdentifier(CODE, BRANCH);

      expect(result).toMatchObject({
        identifier: SERIAL,
        identifierType: 'SERIAL_NUMBER',
      });
    });

    it('never returns the code', async () => {
      lookup.getOne.mockResolvedValueOnce(phone());

      const result = await service.findSellableByIdentifier(CODE, BRANCH);

      expect(result.identifier).not.toBe(CODE);
      expect(Object.keys(result).sort()).toEqual([
        'identifier',
        'identifierType',
        'product',
        'unitId',
      ]);
    });

    it('reads a code in any case, and looks up its stored form', async () => {
      lookup.getOne.mockResolvedValueOnce(phone());

      await service.findSellableByIdentifier(' slu00000123 ', BRANCH);

      expect(lookup.andWhere).toHaveBeenCalledWith(
        'unit.unit_code = :unitCode',
        { unitCode: CODE },
      );
    });

    it('looks a code up at this branch only', async () => {
      lookup.getOne.mockResolvedValueOnce(phone());

      await service.findSellableByIdentifier(CODE, BRANCH);

      expect(lookup.where).toHaveBeenCalledWith('unit.branch_id = :branchId', {
        branchId: BRANCH,
      });
    });

    it.each([
      ProductUnitStatus.SOLD,
      ProductUnitStatus.INSPECTION,
      ProductUnitStatus.RETURNED,
      ProductUnitStatus.WRITTEN_OFF,
    ])(
      'refuses the code of a %s unit, and does not go on to its IMEI',
      async (status) => {
        lookup.getOne.mockResolvedValueOnce(phone({ status }));

        await expect(
          service.findSellableByIdentifier(CODE, BRANCH),
        ).rejects.toThrow(ConflictException);

        expect(lookup.getOne).toHaveBeenCalledTimes(1);
        expect(conditions()).not.toContain(IDENTIFIER_SQL);
      },
    );

    it('answers an unknown code, or one at another branch, with one 404', async () => {
      lookup.getOne.mockResolvedValue(null);

      const miss = service.findSellableByIdentifier(CODE, BRANCH);

      await expect(miss).rejects.toThrow(NotFoundException);
      await expect(miss).rejects.toThrow(
        'No item matches that unit code at this branch.',
      );
    });

    it('goes on to the IMEI and serial lookup when no unit has that code', async () => {
      const older = hub({
        imei: CODE,
        serial_number: CODE,
        unit_code: 'SLU00000007',
      });
      lookup.getOne.mockResolvedValueOnce(null).mockResolvedValueOnce(older);

      const result = await service.findSellableByIdentifier(CODE, BRANCH);

      expect(lookup.andWhere).toHaveBeenCalledWith(IDENTIFIER_SQL, {
        identifier: CODE,
      });
      expect(result).toMatchObject({
        identifier: CODE,
        identifierType: 'SERIAL_NUMBER',
      });
    });

    it('finds an IMEI as before, with no code lookup', async () => {
      lookup.getOne.mockResolvedValueOnce(phone());

      const result = await service.findSellableByIdentifier(IMEI, BRANCH);

      expect(lookup.getOne).toHaveBeenCalledTimes(1);
      expect(conditions()).not.toContain('unit.unit_code = :unitCode');
      expect(result).toMatchObject({
        identifier: IMEI,
        identifierType: 'IMEI',
      });
    });

    it('finds a serial number as before, with no code lookup', async () => {
      lookup.getOne.mockResolvedValueOnce(hub());

      const result = await service.findSellableByIdentifier(SERIAL, BRANCH);

      expect(lookup.getOne).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        identifier: SERIAL,
        identifierType: 'SERIAL_NUMBER',
      });
    });

    it('keeps the 404 wording for anything else', async () => {
      lookup.getOne.mockResolvedValue(null);

      await expect(
        service.findSellableByIdentifier(IMEI, BRANCH),
      ).rejects.toThrow(
        'No available item matches that identifier at this branch',
      );
    });
  });
});
