import { BadRequestException } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { BarcodeLabelsService } from './barcode-labels.service';
import { Product } from '../products/entities/product.entity';
import { ProductUnit } from '../product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../product-units/enums/product-unit-status.enum';
import { TrackingMethod } from '../products/enums/tracking-method.enum';
import { BarcodeType } from '../products/enums/barcode-type.enum';
import { LabelKind } from './dto/label-row.dto';
import type { LabelQueueItemDto } from './dto/resolve-label-queue.dto';

/**
 * BarcodeLabelsService with a recording query builder: no database. These
 * check the query each method builds (columns, filters, the LIKE pattern,
 * the conditions inside Brackets, paging) and how rows are mapped. What
 * Postgres then does with that query is covered by
 * test/barcode-labels.e2e-spec.ts.
 *
 * The entities handed back carry a buying price, a customer and sale lines,
 * as a careless SELECT would load them: the rows must still hold none.
 */

type Call = [method: string, ...args: unknown[]];

/** A chainable query builder that records every call. */
function recordingQb(result: { many?: unknown[]; total?: number } = {}) {
  const calls: Call[] = [];
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'addSelect',
    'innerJoin',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
  ]) {
    qb[method] = jest.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return qb;
    });
  }
  qb.getManyAndCount = jest.fn(() =>
    Promise.resolve([result.many ?? [], result.total ?? 0]),
  );
  qb.getMany = jest.fn(() => Promise.resolve(result.many ?? []));
  return { qb, calls };
}

/** The where/orWhere conditions a Brackets builds. */
function bracketConditions(brackets: Brackets): string[] {
  const conditions: string[] = [];
  const inner = {
    where: (condition: string) => {
      conditions.push(condition);
      return inner;
    },
    orWhere: (condition: string) => {
      conditions.push(condition);
      return inner;
    },
  };
  brackets.whereFactory(inner as never);
  return conditions;
}

const SECRET_BUYING = '81234.00';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    name: 'USB-C Charger',
    model: 'PD-20',
    sku: 'SKU-000001',
    barcode: 'SLP-000001',
    barcode_type: BarcodeType.CODE_128,
    selling_price: '4500.00',
    buying_price: SECRET_BUYING,
    is_active: true,
    tracking_method: TrackingMethod.QUANTITY,
    brand: { id: 'b-1', name: 'Brand' },
    ...overrides,
  } as unknown as Product;
}

function unit(overrides: Partial<ProductUnit> = {}): ProductUnit {
  return {
    id: 'u-1',
    product_id: 'p-phone',
    branch_id: 'branch-a',
    imei: '356938035643809',
    imei_number: '356938035643809',
    serial_number: null,
    unit_code: 'SLU00000001',
    status: ProductUnitStatus.IN_STOCK,
    selling_price: '185000.00',
    buying_price: SECRET_BUYING,
    created_at: new Date('2026-11-01T00:00:00Z'),
    product: {
      id: 'p-phone',
      name: 'iPhone 13 128GB',
      tracking_method: TrackingMethod.IMEI,
      is_active: true,
      selling_price: '190000.00',
      buying_price: SECRET_BUYING,
    },
    branch: { id: 'branch-a', name: 'Main Shop', address: 'not needed' },
    phone_purchase: { customer: { phone: '0771234567' } },
    sale_lines: [{ id: 'line-1' }],
    ...overrides,
  } as unknown as ProductUnit;
}

const PRODUCT_ROW_KEYS = [
  'barcode',
  'barcode_type',
  'kind',
  'model',
  'name',
  'product_id',
  'selling_price',
  'sku',
];
const UNIT_ROW_KEYS = [
  'branch',
  'identifier',
  'identifier_type',
  'kind',
  'name',
  'product_id',
  'selling_price',
  'tracking_method',
  'unit_code',
  'unit_id',
];

describe('BarcodeLabelsService', () => {
  function setup(
    productResult: { many?: unknown[]; total?: number } = {},
    unitResult: { many?: unknown[]; total?: number } = {},
  ) {
    const products = recordingQb(productResult);
    const units = recordingQb(unitResult);
    const productsRepository = {
      createQueryBuilder: jest.fn(() => products.qb),
    };
    const productUnitsRepository = {
      createQueryBuilder: jest.fn(() => units.qb),
    };
    const service = new BarcodeLabelsService(
      productsRepository as never,
      productUnitsRepository as never,
    );
    return {
      service,
      products,
      units,
      productsRepository,
      productUnitsRepository,
    };
  }

  const callsOf = (calls: Call[], method: string) =>
    calls.filter(([name]) => name === method).map(([, ...args]) => args);

  describe('searchProducts', () => {
    it('selects only the label columns, joins nothing, and filters to active QUANTITY products', async () => {
      const { service, products } = setup();

      await service.searchProducts({ page: 1, limit: 50 });

      expect(callsOf(products.calls, 'select')).toEqual([
        [
          [
            'product.id',
            'product.name',
            'product.model',
            'product.sku',
            'product.barcode',
            'product.barcode_type',
            'product.selling_price',
          ],
        ],
      ]);
      expect(callsOf(products.calls, 'innerJoin')).toEqual([]);
      expect(callsOf(products.calls, 'where')).toEqual([
        [
          'product.tracking_method = :trackingMethod',
          { trackingMethod: TrackingMethod.QUANTITY },
        ],
      ]);
      expect(callsOf(products.calls, 'andWhere')).toEqual([
        ['product.is_active = :active', { active: true }],
      ]);
    });

    it('searches name, SKU and barcode inside one Brackets, with wildcards and backslash escaped', async () => {
      const { service, products } = setup();

      await service.searchProducts({ search: '50%_a\\b' });

      const andWheres = callsOf(products.calls, 'andWhere');
      expect(andWheres).toHaveLength(2);
      const brackets = andWheres[1][0] as Brackets;
      expect(brackets).toBeInstanceOf(Brackets);
      expect(bracketConditions(brackets)).toEqual([
        'product.name ILIKE :pattern',
        'product.sku ILIKE :pattern',
        'product.barcode ILIKE :pattern',
      ]);
      // Captured from the Brackets' parameters.
      const params: Record<string, unknown>[] = [];
      brackets.whereFactory({
        where: (_c: string, p: Record<string, unknown>) => {
          params.push(p);
          return { orWhere: () => ({ orWhere: () => undefined }) };
        },
      } as never);
      expect(params[0]).toEqual({ pattern: '%50\\%\\_a\\\\b%' });
    });

    it('adds no search condition without search', async () => {
      const { service, products } = setup();

      await service.searchProducts({});

      expect(callsOf(products.calls, 'andWhere')).toHaveLength(1);
    });

    it('pages with skip/take in a stable order and returns { data, meta }', async () => {
      const { service, products } = setup({ many: [product()], total: 120 });

      const result = await service.searchProducts({ page: 3, limit: 50 });

      expect(callsOf(products.calls, 'orderBy')).toEqual([
        ['product.created_at', 'DESC'],
      ]);
      expect(callsOf(products.calls, 'addOrderBy')).toEqual([
        ['product.id', 'DESC'],
      ]);
      expect(callsOf(products.calls, 'skip')).toEqual([[100]]);
      expect(callsOf(products.calls, 'take')).toEqual([[50]]);
      expect(result.meta).toEqual({
        total: 120,
        page: 3,
        limit: 50,
        totalPages: 3,
        hasNext: false,
        hasPrev: true,
      });
    });

    it('defaults to page 1, 50 per page', async () => {
      const { service, products } = setup();

      await service.searchProducts({});

      expect(callsOf(products.calls, 'skip')).toEqual([[0]]);
      expect(callsOf(products.calls, 'take')).toEqual([[50]]);
    });

    it('maps each row field by field: no buying price or relation, prices kept as strings or null', async () => {
      const { service } = setup({
        many: [
          product(),
          product({ id: 'p-2', selling_price: null, model: null }),
        ],
        total: 2,
      });

      const { data } = await service.searchProducts({});

      expect(data[0]).toEqual({
        kind: LabelKind.PRODUCT,
        product_id: 'p-1',
        name: 'USB-C Charger',
        model: 'PD-20',
        sku: 'SKU-000001',
        barcode: 'SLP-000001',
        barcode_type: BarcodeType.CODE_128,
        selling_price: '4500.00',
      });
      expect(data[1].selling_price).toBeNull();
      expect(data[1].model).toBeNull();
      for (const row of data) {
        expect(Object.keys(row).sort()).toEqual(PRODUCT_ROW_KEYS);
      }
      expect(JSON.stringify(data)).not.toContain(SECRET_BUYING);
    });
  });

  describe('searchUnits', () => {
    it('selects named columns of the unit, product and branch only: no buying price, customer or sale', async () => {
      const { service, units } = setup();

      await service.searchUnits({});

      const selected = [
        ...callsOf(units.calls, 'select'),
        ...callsOf(units.calls, 'addSelect'),
      ].flatMap(([columns]) => columns as string[]);
      expect(selected).toEqual([
        'unit.id',
        'unit.product_id',
        'unit.branch_id',
        'unit.imei',
        'unit.imei_number',
        'unit.serial_number',
        'unit.unit_code',
        'unit.status',
        'unit.selling_price',
        'unit.created_at',
        'product.id',
        'product.name',
        'product.tracking_method',
        'product.is_active',
        'product.selling_price',
        'branch.id',
        'branch.name',
      ]);
      expect(selected.some((column) => column.includes('buying'))).toBe(false);
      expect(callsOf(units.calls, 'innerJoin')).toEqual([
        ['unit.product', 'product'],
        ['unit.branch', 'branch'],
      ]);
    });

    it('keeps IN_STOCK units of active IMEI or serial products only', async () => {
      const { service, units } = setup();

      await service.searchUnits({});

      expect(callsOf(units.calls, 'where')).toEqual([
        ['unit.status = :status', { status: ProductUnitStatus.IN_STOCK }],
      ]);
      expect(callsOf(units.calls, 'andWhere')).toEqual([
        ['product.is_active = :active', { active: true }],
        [
          'product.tracking_method IN (:...trackingMethods)',
          {
            trackingMethods: [
              TrackingMethod.IMEI,
              TrackingMethod.SERIAL_NUMBER,
            ],
          },
        ],
      ]);
    });

    it('filters by the scoped branch and product when given', async () => {
      const { service, units } = setup();

      await service.searchUnits({ branchId: 'branch-a', productId: 'p-phone' });

      expect(callsOf(units.calls, 'andWhere')).toEqual(
        expect.arrayContaining([
          ['unit.branch_id = :branchId', { branchId: 'branch-a' }],
          ['unit.product_id = :productId', { productId: 'p-phone' }],
        ]),
      );
    });

    it('covers every branch when the scope is undefined (an admin choosing none)', async () => {
      const { service, units } = setup();

      await service.searchUnits({ branchId: undefined });

      expect(
        callsOf(units.calls, 'andWhere').some(([condition]) =>
          String(condition).includes('branch_id'),
        ),
      ).toBe(false);
    });

    it('searches identifiers, unit code, SKU and name inside one Brackets', async () => {
      const { service, units } = setup();

      await service.searchUnits({ search: 'SLU_1' });

      const brackets = callsOf(units.calls, 'andWhere')
        .map(([condition]) => condition)
        .find((condition) => condition instanceof Brackets) as Brackets;
      expect(bracketConditions(brackets)).toEqual([
        'unit.imei_number ILIKE :pattern',
        'unit.imei ILIKE :pattern',
        'unit.serial_number ILIKE :pattern',
        'unit.unit_code ILIKE :pattern',
        'product.sku ILIKE :pattern',
        'product.name ILIKE :pattern',
      ]);
    });

    it('pages with skip/take, newest first', async () => {
      const { service, units } = setup();

      await service.searchUnits({ page: 2, limit: 10 });

      expect(callsOf(units.calls, 'orderBy')).toEqual([
        ['unit.created_at', 'DESC'],
      ]);
      expect(callsOf(units.calls, 'addOrderBy')).toEqual([['unit.id', 'DESC']]);
      expect(callsOf(units.calls, 'skip')).toEqual([[10]]);
      expect(callsOf(units.calls, 'take')).toEqual([[10]]);
    });

    it('maps an IMEI unit: unit_code to encode, the IMEI as text, its own price', async () => {
      const { service } = setup({}, { many: [unit()], total: 1 });

      const { data } = await service.searchUnits({});

      expect(data).toEqual([
        {
          kind: LabelKind.UNIT,
          unit_id: 'u-1',
          unit_code: 'SLU00000001',
          product_id: 'p-phone',
          name: 'iPhone 13 128GB',
          tracking_method: TrackingMethod.IMEI,
          identifier_type: TrackingMethod.IMEI,
          identifier: '356938035643809',
          selling_price: '185000.00',
          branch: { id: 'branch-a', name: 'Main Shop' },
        },
      ]);
      expect(Object.keys(data[0]).sort()).toEqual(UNIT_ROW_KEYS);
      expect(JSON.stringify(data)).not.toContain(SECRET_BUYING);
      expect(JSON.stringify(data)).not.toContain('0771234567');
      expect(JSON.stringify(data)).not.toContain('not needed');
    });

    it('maps a serial unit to its serial number, even when it also has an IMEI', async () => {
      const serialUnit = unit({
        imei: 'SN-ABC-123',
        imei_number: '356938035643810',
        serial_number: 'SN-ABC-123',
        product: {
          id: 'p-laptop',
          name: 'Laptop',
          tracking_method: TrackingMethod.SERIAL_NUMBER,
          is_active: true,
          selling_price: '250000.00',
        } as Product,
      });
      const { service } = setup({}, { many: [serialUnit], total: 1 });

      const [row] = (await service.searchUnits({})).data;

      expect(row.tracking_method).toBe(TrackingMethod.SERIAL_NUMBER);
      expect(row.identifier_type).toBe(TrackingMethod.SERIAL_NUMBER);
      expect(row.identifier).toBe('SN-ABC-123');
      expect(row.unit_code).toBe('SLU00000001');
    });

    it('maps a legacy unit (only the old imei column) by its product’s tracking', async () => {
      const legacy = unit({ imei: 'LEGACY-777', imei_number: null });
      const legacySerial = unit({
        id: 'u-2',
        imei: 'LEGACY-SN-9',
        imei_number: null,
        serial_number: null,
        product: {
          id: 'p-laptop',
          name: 'Laptop',
          tracking_method: TrackingMethod.SERIAL_NUMBER,
          is_active: true,
          selling_price: null,
        } as Product,
      });
      const { service } = setup({}, { many: [legacy, legacySerial], total: 2 });

      const [imeiRow, serialRow] = (await service.searchUnits({})).data;

      expect(imeiRow).toMatchObject({
        identifier: 'LEGACY-777',
        identifier_type: TrackingMethod.IMEI,
      });
      expect(serialRow).toMatchObject({
        identifier: 'LEGACY-SN-9',
        identifier_type: TrackingMethod.SERIAL_NUMBER,
      });
    });

    it('a serial-only unit of an IMEI product shows its serial number, typed as one', async () => {
      const serialOnly = unit({
        imei: 'R58N-ONLY',
        imei_number: null,
        serial_number: 'R58N-ONLY',
      });
      const { service } = setup({}, { many: [serialOnly], total: 1 });

      const [row] = (await service.searchUnits({})).data;

      expect(row).toMatchObject({
        identifier: 'R58N-ONLY',
        identifier_type: TrackingMethod.SERIAL_NUMBER,
        tracking_method: TrackingMethod.IMEI,
      });
    });

    it('falls back to the product price, then null, keeping decimal strings', async () => {
      const fromProduct = unit({ selling_price: null });
      const noPrice = unit({
        id: 'u-2',
        selling_price: null,
        product: {
          id: 'p-phone',
          name: 'iPhone 13 128GB',
          tracking_method: TrackingMethod.IMEI,
          is_active: true,
          selling_price: null,
        } as Product,
      });
      const { service } = setup({}, { many: [fromProduct, noPrice], total: 2 });

      const [first, second] = (await service.searchUnits({})).data;

      expect(first.selling_price).toBe('190000.00');
      expect(second.selling_price).toBeNull();
    });
  });

  describe('resolveQueue', () => {
    const P1 = '11111111-1111-4111-8111-111111111111';
    const P2 = '22222222-2222-4222-8222-222222222222';
    const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const U3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    const productItem = (productId: string, quantity: number) =>
      ({ type: LabelKind.PRODUCT, productId, quantity }) as LabelQueueItemDto;
    const unitItem = (unitId: string) =>
      ({ type: LabelKind.UNIT, unitId }) as LabelQueueItemDto;

    const catalogue = [
      product({ id: P1, name: 'Charger' }),
      product({ id: P2, name: 'Cable', selling_price: null }),
    ];
    const stock = [
      unit({ id: U1, unit_code: 'SLU00000011' }),
      unit({
        id: U2,
        unit_code: 'SLU00000012',
        imei: 'SN-2',
        imei_number: null,
        serial_number: 'SN-2',
        product: {
          id: 'p-laptop',
          name: 'Laptop',
          tracking_method: TrackingMethod.SERIAL_NUMBER,
          is_active: true,
          selling_price: '250000.00',
        } as Product,
      }),
    ];

    async function rejectionOf(promise: Promise<unknown>) {
      const error = await promise.then(
        () => {
          throw new Error('expected a rejection');
        },
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse() as {
        code: string;
        errors?: { index: number; reason: string }[];
        total_labels?: number;
        max_labels?: number;
      };
    }

    it('resolves a mixed queue in the order sent, with total_labels', async () => {
      const { service } = setup({ many: catalogue }, { many: stock });

      const result = await service.resolveQueue(
        {
          items: [
            unitItem(U2),
            productItem(P1, 2),
            unitItem(U1),
            productItem(P2, 3),
          ],
        },
        'branch-a',
      );

      expect(result.data.map((row) => row.kind)).toEqual([
        LabelKind.UNIT,
        LabelKind.PRODUCT,
        LabelKind.UNIT,
        LabelKind.PRODUCT,
      ]);
      expect(result.data[0]).toMatchObject({
        unit_id: U2,
        unit_code: 'SLU00000012',
        identifier: 'SN-2',
        identifier_type: TrackingMethod.SERIAL_NUMBER,
      });
      expect(result.data[1]).toMatchObject({
        product_id: P1,
        quantity: 2,
        barcode: 'SLP-000001',
      });
      expect(result.data[2]).toMatchObject({
        unit_id: U1,
        unit_code: 'SLU00000011',
      });
      expect(result.data[3]).toMatchObject({
        product_id: P2,
        quantity: 3,
        selling_price: null,
      });
      expect(result.total_labels).toBe(2 + 1 + 1 + 3);
      expect(JSON.stringify(result)).not.toContain(SECRET_BUYING);
      expect(JSON.stringify(result)).not.toContain('0771234567');
      expect(Object.keys(result.data[1]).sort()).toEqual(
        [...PRODUCT_ROW_KEYS, 'quantity'].sort(),
      );
      expect(Object.keys(result.data[0]).sort()).toEqual(UNIT_ROW_KEYS);
    });

    it('runs one products query and one units query, whatever the queue length', async () => {
      const {
        service,
        products,
        units,
        productsRepository,
        productUnitsRepository,
      } = setup({ many: catalogue }, { many: stock });

      await service.resolveQueue(
        {
          items: [
            productItem(P1, 1),
            productItem(P2, 1),
            unitItem(U1),
            unitItem(U2),
          ],
        },
        undefined,
      );

      expect(productsRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(productUnitsRepository.createQueryBuilder).toHaveBeenCalledTimes(
        1,
      );
      expect(products.qb.getMany).toHaveBeenCalledTimes(1);
      expect(units.qb.getMany).toHaveBeenCalledTimes(1);
      const productSelect = callsOf(products.calls, 'select')[0][0] as string[];
      expect(productSelect.some((column) => column.includes('buying'))).toBe(
        false,
      );
      const unitColumns = [
        ...callsOf(units.calls, 'select'),
        ...callsOf(units.calls, 'addSelect'),
      ].flatMap(([columns]) => columns as string[]);
      expect(unitColumns.some((column) => column.includes('buying'))).toBe(
        false,
      );
    });

    it('skips the units query for a products-only queue, and the products query for units only', async () => {
      const productsOnly = setup({ many: catalogue });
      await productsOnly.service.resolveQueue(
        { items: [productItem(P1, 1)] },
        undefined,
      );
      expect(
        productsOnly.productUnitsRepository.createQueryBuilder,
      ).not.toHaveBeenCalled();

      const unitsOnly = setup({}, { many: stock });
      await unitsOnly.service.resolveQueue(
        { items: [unitItem(U1)] },
        undefined,
      );
      expect(
        unitsOnly.productsRepository.createQueryBuilder,
      ).not.toHaveBeenCalled();
    });

    it('accepts exactly 500 labels and refuses 501 before querying', async () => {
      const ok = setup({ many: catalogue }, { many: stock });
      const result = await ok.service.resolveQueue(
        { items: [productItem(P1, 499), unitItem(U1)] },
        undefined,
      );
      expect(result.total_labels).toBe(500);

      const over = setup({ many: catalogue }, { many: stock });
      const response = await rejectionOf(
        over.service.resolveQueue(
          { items: [productItem(P1, 300), productItem(P2, 200), unitItem(U1)] },
          undefined,
        ),
      );
      expect(response).toMatchObject({
        code: 'LABEL_LIMIT_EXCEEDED',
        total_labels: 501,
        max_labels: 500,
      });
      expect(over.productsRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(
        over.productUnitsRepository.createQueryBuilder,
      ).not.toHaveBeenCalled();
    });

    it('refuses a unit twice, and a product twice, by index', async () => {
      const { service } = setup({ many: catalogue }, { many: stock });

      const response = await rejectionOf(
        service.resolveQueue(
          {
            items: [
              unitItem(U1),
              productItem(P1, 1),
              unitItem(U1),
              productItem(P1, 2),
            ],
          },
          undefined,
        ),
      );

      expect(response.code).toBe('INVALID_LABEL_ITEMS');
      expect(response.errors).toEqual([
        expect.objectContaining({ index: 2, reason: 'DUPLICATE_UNIT' }),
        expect.objectContaining({ index: 3, reason: 'DUPLICATE_PRODUCT' }),
      ]);
    });

    it('reports a repeated bad item once as a duplicate, and its first occurrence for the real problem', async () => {
      const { service } = setup({ many: [] }, { many: [] });

      const response = await rejectionOf(
        service.resolveQueue(
          {
            items: [
              unitItem(U3),
              unitItem(U3),
              productItem(P1, 1),
              productItem(P1, 1),
            ],
          },
          undefined,
        ),
      );

      expect(response.errors).toEqual([
        expect.objectContaining({ index: 0, reason: 'UNIT_NOT_FOUND' }),
        expect.objectContaining({ index: 1, reason: 'DUPLICATE_UNIT' }),
        expect.objectContaining({ index: 2, reason: 'PRODUCT_NOT_FOUND' }),
        expect.objectContaining({ index: 3, reason: 'DUPLICATE_PRODUCT' }),
      ]);
    });

    it('allows several different units of the same product', async () => {
      const sameProduct = [
        unit({ id: U1, unit_code: 'SLU00000011' }),
        unit({
          id: U3,
          unit_code: 'SLU00000013',
          imei: '356938035643811',
          imei_number: '356938035643811',
        }),
      ];
      const { service } = setup({}, { many: sameProduct });

      const result = await service.resolveQueue(
        { items: [unitItem(U1), unitItem(U3)] },
        'branch-a',
      );

      expect(
        result.data.map((row) => (row as { unit_code: string }).unit_code),
      ).toEqual(['SLU00000011', 'SLU00000013']);
      expect(result.total_labels).toBe(2);
    });

    it('refuses another branch’s unit as UNIT_NOT_FOUND, the same as an unknown one', async () => {
      const { service } = setup(
        {},
        {
          many: [
            unit({
              id: U1,
              branch_id: 'branch-b',
              status: ProductUnitStatus.SOLD,
            }),
          ],
        },
      );

      const response = await rejectionOf(
        service.resolveQueue(
          { items: [unitItem(U1), unitItem(U3)] },
          'branch-a',
        ),
      );

      // Not UNIT_NOT_IN_STOCK: the other branch's status isn't revealed.
      expect(response.errors).toEqual([
        expect.objectContaining({ index: 0, reason: 'UNIT_NOT_FOUND' }),
        expect.objectContaining({ index: 1, reason: 'UNIT_NOT_FOUND' }),
      ]);
    });

    it('lets an admin with no branch resolve a unit at any branch', async () => {
      const { service } = setup(
        {},
        { many: [unit({ id: U1, branch_id: 'branch-b' })] },
      );

      const result = await service.resolveQueue(
        { items: [unitItem(U1)] },
        undefined,
      );

      expect(result.data).toHaveLength(1);
    });

    it.each([
      ProductUnitStatus.SOLD,
      ProductUnitStatus.RETURNED,
      ProductUnitStatus.WRITTEN_OFF,
      ProductUnitStatus.INSPECTION,
    ])('refuses a %s unit as UNIT_NOT_IN_STOCK', async (status) => {
      const { service } = setup({}, { many: [unit({ id: U1, status })] });

      const response = await rejectionOf(
        service.resolveQueue({ items: [unitItem(U1)] }, 'branch-a'),
      );

      expect(response.errors).toEqual([
        expect.objectContaining({ index: 0, reason: 'UNIT_NOT_IN_STOCK' }),
      ]);
    });

    it('refuses inactive products, directly or through a unit', async () => {
      const inactiveUnit = unit({
        id: U1,
        product: {
          id: 'p-phone',
          name: 'Old phone',
          tracking_method: TrackingMethod.IMEI,
          is_active: false,
          selling_price: null,
        } as Product,
      });
      const { service } = setup(
        { many: [product({ id: P1, is_active: false })] },
        { many: [inactiveUnit] },
      );

      const response = await rejectionOf(
        service.resolveQueue(
          { items: [productItem(P1, 1), unitItem(U1)] },
          undefined,
        ),
      );

      expect(response.errors).toEqual([
        expect.objectContaining({ index: 0, reason: 'PRODUCT_INACTIVE' }),
        expect.objectContaining({ index: 1, reason: 'UNIT_PRODUCT_INACTIVE' }),
      ]);
    });

    it('refuses the wrong tracking method both ways', async () => {
      const quantityUnit = unit({
        id: U1,
        product: {
          id: 'p-1',
          name: 'Charger',
          tracking_method: TrackingMethod.QUANTITY,
          is_active: true,
          selling_price: null,
        } as Product,
      });
      const { service } = setup(
        {
          many: [
            product({ id: P1, tracking_method: TrackingMethod.IMEI }),
            product({ id: P2, tracking_method: TrackingMethod.SERIAL_NUMBER }),
          ],
        },
        { many: [quantityUnit] },
      );

      const response = await rejectionOf(
        service.resolveQueue(
          { items: [productItem(P1, 1), productItem(P2, 1), unitItem(U1)] },
          undefined,
        ),
      );

      expect(response.errors).toEqual([
        expect.objectContaining({
          index: 0,
          reason: 'PRODUCT_NOT_QUANTITY_TRACKED',
        }),
        expect.objectContaining({
          index: 1,
          reason: 'PRODUCT_NOT_QUANTITY_TRACKED',
        }),
        expect.objectContaining({ index: 2, reason: 'UNIT_NOT_SERIALIZED' }),
      ]);
    });

    it('refuses an unknown product', async () => {
      const { service } = setup({ many: [] });

      const response = await rejectionOf(
        service.resolveQueue({ items: [productItem(P1, 1)] }, undefined),
      );

      expect(response.errors).toEqual([
        expect.objectContaining({ index: 0, reason: 'PRODUCT_NOT_FOUND' }),
      ]);
    });

    it('rejects the whole queue when one item is invalid, listing only the bad ones', async () => {
      const { service } = setup({ many: catalogue }, { many: stock });

      const response = await rejectionOf(
        service.resolveQueue(
          {
            items: [
              productItem(P1, 2),
              unitItem(U1),
              unitItem(U3),
              unitItem(U2),
            ],
          },
          'branch-a',
        ),
      );

      expect(response).not.toHaveProperty('data');
      expect(response.errors).toEqual([
        {
          index: 2,
          reason: 'UNIT_NOT_FOUND',
          message: 'No unit with that id at this branch.',
        },
      ]);
    });

    it('looks units up by id with no status or branch filter in SQL, so each problem can be named', async () => {
      const { service, units } = setup({}, { many: stock });

      await service.resolveQueue({ items: [unitItem(U1)] }, 'branch-a');

      expect(callsOf(units.calls, 'andWhere')).toEqual([]);
      expect(callsOf(units.calls, 'where')).toHaveLength(1);
    });
  });
});
