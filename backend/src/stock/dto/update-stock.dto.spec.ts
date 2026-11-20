import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStockDto } from './update-stock.dto';
import { ManualStockAdjustmentReason } from '../enums/stock-movement-type.enum';

const errorsFor = async (input: Record<string, unknown>) =>
  validate(plainToInstance(UpdateStockDto, input));

describe('UpdateStockDto adjustment reason and note', () => {
  it.each(Object.values(ManualStockAdjustmentReason))(
    'accepts approved reason %s',
    async (reasonCode) => {
      await expect(
        errorsFor({ quantity: 11, reasonCode }),
      ).resolves.toHaveLength(0);
    },
  );

  it('allows reason and note to be omitted for non-quantity updates', async () => {
    await expect(errorsFor({ min_quantity: 5 })).resolves.toHaveLength(0);
    await expect(errorsFor({ quantity: 10 })).resolves.toHaveLength(0);
  });

  it('rejects unsupported and blank reason codes when supplied', async () => {
    for (const reasonCode of ['MANUAL_ADJUSTMENT', 'OTHER', ' ']) {
      const errors = await errorsFor({ quantity: 11, reasonCode });
      expect(errors.map((error) => error.property)).toContain('reasonCode');
    }
  });

  it('trims an optional note and accepts a 500 character note', async () => {
    const dto = plainToInstance(UpdateStockDto, {
      note: '  checked shelf count  ',
    });
    expect(dto.note).toBe('checked shelf count');
    await expect(errorsFor({ note: 'x'.repeat(500) })).resolves.toHaveLength(0);
  });

  it('rejects notes longer than 500 characters and non-string values', async () => {
    const tooLong = await errorsFor({ note: 'x'.repeat(501) });
    expect(tooLong.map((error) => error.property)).toContain('note');

    const nonString = await errorsFor({ note: 123 });
    expect(nonString.map((error) => error.property)).toContain('note');
  });
});
