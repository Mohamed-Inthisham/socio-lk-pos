import { BadRequestException } from '@nestjs/common';
import { StockService } from './stock.service';
import {
  StockMovementType,
  StockMovementReferenceType,
} from './enums/stock-movement-type.enum';

const movement = (overrides: Record<string, unknown> = {}) => ({
  id: 'movement-1',
  movement_type: StockMovementType.REVERSAL,
  product_id: 'product-1',
  product: { id: 'product-1', name: 'Phone', buying_price: '85000.00' },
  branch_id: 'branch-1',
  branch: { id: 'branch-1', name: 'Colombo' },
  product_unit_id: 'unit-1',
  product_unit: {
    id: 'unit-1',
    unit_code: '12345678',
    buying_price: '85000.00',
  },
  quantity_delta: 1,
  quantity_before: 0,
  quantity_after: 1,
  stock_managed: true,
  unit_status_from: 'SOLD',
  unit_status_to: 'IN_STOCK',
  reason_code: null,
  note: null,
  reference_type: StockMovementReferenceType.SALE_LINE,
  reference_id: 'line-1',
  reverses_movement_id: 'movement-original',
  created_by: {
    id: 'user-1',
    full_name: 'Cashier One',
    email: 'private@example.com',
  },
  approved_by: { id: 'user-2', full_name: 'Manager Two', phone: '0770000000' },
  created_at: new Date('2026-11-18T05:00:00.000Z'),
  buying_price: '85000.00',
  ...overrides,
});

describe('StockService movement history', () => {
  const setup = (rows = [movement()], total = rows.length) => {
    const qb = {
      withDeleted: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([rows, total]),
    };
    const repository = { createQueryBuilder: jest.fn(() => qb) };
    const service = new StockService(
      {} as never,
      repository as never,
      {} as never,
      {} as never,
    );
    return { service, qb, repository };
  };

  it.each([
    [
      'productId',
      { productId: 'product-1' },
      'movement.product_id = :productId',
      { productId: 'product-1' },
    ],
    [
      'branchId',
      { branchId: 'branch-1' },
      'movement.branch_id = :branchId',
      { branchId: 'branch-1' },
    ],
    [
      'movementType',
      { movementType: StockMovementType.SALE },
      'movement.movement_type = :movementType',
      { movementType: StockMovementType.SALE },
    ],
    [
      'referenceType',
      { referenceType: StockMovementReferenceType.PAYMENT },
      'movement.reference_type = :referenceType',
      { referenceType: StockMovementReferenceType.PAYMENT },
    ],
    [
      'referenceId',
      { referenceId: 'reference-1' },
      'movement.reference_id = :referenceId',
      { referenceId: 'reference-1' },
    ],
    [
      'performedBy',
      { performedBy: 'user-1' },
      'movement.created_by_id = :performedBy',
      { performedBy: 'user-1' },
    ],
  ])('applies the %s filter', async (_label, query, clause, params) => {
    const { service, qb } = setup();
    await service.getMovementHistory(query);
    expect(qb.andWhere).toHaveBeenCalledWith(clause, params);
  });

  it('applies inclusive Colombo calendar date bounds and rejects an inverted range', async () => {
    const { service, qb } = setup();
    await service.getMovementHistory({
      startDate: '2026-11-01',
      endDate: '2026-11-18',
    });
    expect(qb.andWhere).toHaveBeenNthCalledWith(
      1,
      `movement.created_at >= (CAST(:startDate AS date)::timestamp AT TIME ZONE 'Asia/Colombo')`,
      { startDate: '2026-11-01' },
    );
    expect(qb.andWhere).toHaveBeenNthCalledWith(
      2,
      `movement.created_at < ((CAST(:endDate AS date) + 1)::timestamp AT TIME ZONE 'Asia/Colombo')`,
      { endDate: '2026-11-18' },
    );
    await expect(
      service.getMovementHistory({
        startDate: '2026-11-19',
        endDate: '2026-11-18',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('paginates with stable newest-first ordering and maps only safe history fields', async () => {
    const { service, qb } = setup([movement()], 26);
    const result = await service.getMovementHistory({
      page: 2,
      limit: 25,
    });
    expect(qb.orderBy).toHaveBeenCalledWith('movement.created_at', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('movement.seq', 'DESC');
    expect(qb.skip).toHaveBeenCalledWith(25);
    expect(qb.take).toHaveBeenCalledWith(25);
    expect(result.meta).toEqual({
      total: 26,
      page: 2,
      limit: 25,
      totalPages: 2,
      hasNext: false,
      hasPrev: true,
    });
    expect(result.data[0]).toMatchObject({
      movement_type: 'REVERSAL',
      product_name: 'Phone',
      branch_name: 'Colombo',
      product_unit_code: '12345678',
      quantity_before: 0,
      quantity_after: 1,
      stock_managed: true,
      unit_status_from: 'SOLD',
      unit_status_to: 'IN_STOCK',
      reverses_movement_id: 'movement-original',
      performed_by: { id: 'user-1', full_name: 'Cashier One' },
      approved_by: { id: 'user-2', full_name: 'Manager Two' },
    });
    expect(result.data[0]).not.toHaveProperty('buying_price');
    expect(result.data[0].performed_by).not.toHaveProperty('email');
    expect(result.data[0].approved_by).not.toHaveProperty('phone');
  });

  it('returns an explicit empty page shape', async () => {
    const { service } = setup([], 0);
    await expect(
      service.getMovementHistory({ page: 1, limit: 50 }),
    ).resolves.toEqual({
      data: [],
      meta: {
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    });
  });
});
