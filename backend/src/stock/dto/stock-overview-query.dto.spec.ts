import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StockOverviewQueryDto } from './stock-overview-query.dto';
import { StockStatus } from '../enums/stock-status.enum';

const parse = (query: Record<string, unknown>) => {
  const dto = plainToInstance(StockOverviewQueryDto, query);
  return { dto, errors: validateSync(dto).map((error) => error.property) };
};

describe('StockOverviewQueryDto', () => {
  it('needs nothing', () => {
    expect(parse({}).errors).toEqual([]);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('reads includeInactive=%s as a boolean', (value, expected) => {
    const { dto, errors } = parse({ includeInactive: value });

    expect(errors).toEqual([]);
    expect(dto.includeInactive).toBe(expected);
  });

  it('refuses any other includeInactive', () => {
    expect(parse({ includeInactive: 'yes' }).errors).toContain(
      'includeInactive',
    );
  });

  it.each(Object.values(StockStatus))(
    'accepts stockStatus %s',
    (stockStatus) => {
      expect(parse({ stockStatus }).errors).toEqual([]);
    },
  );

  it('refuses an unknown stockStatus', () => {
    expect(parse({ stockStatus: 'SOLD' }).errors).toContain('stockStatus');
  });

  it('refuses a branchId that is not a UUID', () => {
    expect(parse({ branchId: 'main' }).errors).toContain('branchId');
  });

  it('trims the search, and ignores an empty one', () => {
    expect(parse({ search: '  iphone  ' }).dto.search).toBe('iphone');

    const { dto, errors } = parse({ search: '   ' });
    expect(errors).toEqual([]);
    expect(dto.search).toBeUndefined();
  });

  it.each([
    ['one character', 'a'],
    ['over 100 characters', 'a'.repeat(101)],
  ])('refuses a search of %s', (_, search) => {
    expect(parse({ search }).errors).toContain('search');
  });

  it('refuses a limit over 200', () => {
    expect(parse({ limit: '201' }).errors).toContain('limit');
  });
});
