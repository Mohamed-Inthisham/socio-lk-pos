import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SearchProductUnitsQueryDto } from './search-product-units-query.dto';

const parse = (query: Record<string, unknown>) => {
  const dto = plainToInstance(SearchProductUnitsQueryDto, query);
  return { dto, errors: validateSync(dto).map((error) => error.property) };
};

describe('SearchProductUnitsQueryDto', () => {
  it('trims the search text', () => {
    const { dto, errors } = parse({ q: '  3569  ' });

    expect(errors).toEqual([]);
    expect(dto.q).toBe('3569');
  });

  it.each([
    ['missing', {}],
    ['one character', { q: 'a' }],
    ['only spaces', { q: '     ' }],
    ['over 100 characters', { q: 'a'.repeat(101) }],
  ])('refuses a search that is %s', (_, query) => {
    expect(parse(query).errors).toContain('q');
  });

  it('accepts two characters', () => {
    expect(parse({ q: 'a5' }).errors).toEqual([]);
  });

  it('refuses a branchId that is not a UUID', () => {
    expect(parse({ q: 'a5', branchId: 'main' }).errors).toContain('branchId');
  });
});
