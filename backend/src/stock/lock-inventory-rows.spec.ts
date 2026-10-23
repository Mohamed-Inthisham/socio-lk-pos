import { EntityManager } from 'typeorm';
import { lockInventoryRows } from './lock-inventory-rows';
import { Stock } from './entities/stock.entity';
import { ProductUnit } from '../product-units/entities/product-unit.entity';

/**
 * Records every locking query the helper sends, in order: the entity, the
 * lock mode and the parameters of its WHERE clauses.
 */
const recordingManager = () => {
  const queries: {
    entity: unknown;
    lock?: string;
    params: Record<string, unknown>;
  }[] = [];
  const manager = {
    createQueryBuilder: jest.fn((entity: unknown) => {
      const query: (typeof queries)[number] = { entity, params: {} };
      queries.push(query);
      const qb = {
        setLock: jest.fn((mode: string) => {
          query.lock = mode;
          return qb;
        }),
        select: jest.fn(() => qb),
        where: jest.fn((_sql: string, params: Record<string, unknown>) => {
          Object.assign(query.params, params);
          return qb;
        }),
        andWhere: jest.fn((_sql: string, params: Record<string, unknown>) => {
          Object.assign(query.params, params);
          return qb;
        }),
        getOne: jest.fn().mockResolvedValue(null),
      };
      return qb;
    }),
  };
  return { manager: manager as unknown as EntityManager, queries };
};

describe('lockInventoryRows (Phase 6.4 P7-25)', () => {
  it('locks Stock rows sorted by product then branch, then units sorted by id', async () => {
    const { manager, queries } = recordingManager();

    await lockInventoryRows(manager, {
      unitIds: ['cccc-unit', 'aaaa-unit', 'bbbb-unit'],
      stock: [
        { productId: 'p-2', branchId: 'b-1' },
        { productId: 'p-1', branchId: 'b-2' },
        { productId: 'p-1', branchId: 'b-1' },
      ],
    });

    expect(queries.map((q) => [q.entity, q.params])).toEqual([
      [Stock, { productId: 'p-1', branchId: 'b-1' }],
      [Stock, { productId: 'p-1', branchId: 'b-2' }],
      [Stock, { productId: 'p-2', branchId: 'b-1' }],
      [ProductUnit, { unitId: 'aaaa-unit' }],
      [ProductUnit, { unitId: 'bbbb-unit' }],
      [ProductUnit, { unitId: 'cccc-unit' }],
    ]);
  });

  it('locks every row FOR UPDATE (pessimistic_write)', async () => {
    const { manager, queries } = recordingManager();

    await lockInventoryRows(manager, {
      stock: [{ productId: 'p-1', branchId: 'b-1' }],
      unitIds: ['u-1'],
    });

    expect(queries.map((q) => q.lock)).toEqual([
      'pessimistic_write',
      'pessimistic_write',
    ]);
  });

  it('locks each row once, whatever the case of its ids', async () => {
    const { manager, queries } = recordingManager();

    await lockInventoryRows(manager, {
      stock: [
        { productId: 'p-1', branchId: 'b-1' },
        { productId: 'P-1', branchId: 'B-1' },
        { productId: 'p-1', branchId: 'b-1' },
      ],
      unitIds: ['u-1', 'U-1', 'u-1'],
    });

    expect(queries.map((q) => [q.entity, q.params])).toEqual([
      [Stock, { productId: 'p-1', branchId: 'b-1' }],
      [ProductUnit, { unitId: 'u-1' }],
    ]);
  });

  it('sends nothing when there is nothing to lock', async () => {
    const { manager, queries } = recordingManager();

    await lockInventoryRows(manager, {});
    await lockInventoryRows(manager, { stock: [], unitIds: [] });

    expect(queries).toEqual([]);
  });

  it('locks only Stock rows when given no units, and only units when given no Stock rows', async () => {
    const stockOnly = recordingManager();
    await lockInventoryRows(stockOnly.manager, {
      stock: [{ productId: 'p-1', branchId: 'b-1' }],
    });
    expect(stockOnly.queries.map((q) => q.entity)).toEqual([Stock]);

    const unitsOnly = recordingManager();
    await lockInventoryRows(unitsOnly.manager, { unitIds: ['u-1'] });
    expect(unitsOnly.queries.map((q) => q.entity)).toEqual([ProductUnit]);
  });

  it('skips a row that does not exist instead of throwing', async () => {
    const { manager } = recordingManager();

    await expect(
      lockInventoryRows(manager, {
        stock: [{ productId: 'missing', branchId: 'b-1' }],
        unitIds: ['missing-unit'],
      }),
    ).resolves.toBeUndefined();
  });
});
