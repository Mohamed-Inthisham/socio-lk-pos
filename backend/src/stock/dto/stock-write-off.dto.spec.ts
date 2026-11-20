import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  IdentifiedUnitWriteOffDto,
  StockWriteOffDto,
  StockWriteOffReason,
} from './stock-write-off.dto';

describe('stock write-off request validation', () => {
  it('requires positive quantity, expected quantity and a known reason', async () => {
    const invalid = plainToInstance(StockWriteOffDto, {
      quantity: 0,
      expected_quantity: -1,
      reasonCode: 'COUNT_CORRECTION',
    });
    expect((await validate(invalid)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['quantity', 'expected_quantity', 'reasonCode']),
    );
  });

  it.each(Object.values(StockWriteOffReason))(
    'accepts reason %s',
    async (reasonCode) => {
      const dto = plainToInstance(IdentifiedUnitWriteOffDto, { reasonCode });
      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it('limits notes to 500 characters', async () => {
    const dto = plainToInstance(IdentifiedUnitWriteOffDto, {
      reasonCode: StockWriteOffReason.OTHER,
      note: 'x'.repeat(501),
    });
    expect((await validate(dto)).map((error) => error.property)).toContain(
      'note',
    );
  });
});
