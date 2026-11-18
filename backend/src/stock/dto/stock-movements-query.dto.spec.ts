import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StockMovementsQueryDto } from './stock-movements-query.dto';

const errorsFor = async (input: Record<string, unknown>) => {
  const dto = plainToInstance(StockMovementsQueryDto, input);
  return validate(dto);
};

describe('StockMovementsQueryDto', () => {
  it('accepts supported filters and pagination', async () => {
    await expect(
      errorsFor({
        page: '2',
        limit: '25',
        productId: '11111111-1111-4111-8111-111111111111',
        branchId: '22222222-2222-4222-8222-222222222222',
        movementType: 'SALE',
        referenceType: 'SALE_LINE',
        referenceId: '33333333-3333-4333-8333-333333333333',
        performedBy: '44444444-4444-4444-8444-444444444444',
        startDate: '2026-11-01',
        endDate: '2026-11-18',
      }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['productId', 'not-a-uuid'],
    ['branchId', 'not-a-uuid'],
    ['movementType', 'UNKNOWN'],
    ['referenceType', 'UNKNOWN'],
    ['referenceId', 'not-a-uuid'],
    ['performedBy', 'not-a-uuid'],
    ['startDate', '2026-02-30'],
    ['endDate', '2026-11-18T12:00:00Z'],
    ['page', '0'],
    ['limit', '201'],
  ])('rejects invalid %s', async (field, value) => {
    const errors = await errorsFor({ [field]: value });
    expect(errors.map((error) => error.property)).toContain(field);
  });
});
