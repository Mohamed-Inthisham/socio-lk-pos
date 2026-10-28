import { plainToInstance } from 'class-transformer';
import { IsString, validate } from 'class-validator';
import { MaxUtf8Bytes } from './max-utf8-bytes.decorator';

class Thing {
  @IsString()
  @MaxUtf8Bytes(72)
  value!: unknown;
}

const SINHALA = 'ම'; // 1 UTF-16 unit, 3 bytes
const EMOJI = '\u{1F600}'; // 2 UTF-16 units, 4 bytes

const errorsFor = async (value: unknown) => {
  const errors = await validate(plainToInstance(Thing, { value }));
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
};

describe('MaxUtf8Bytes', () => {
  it.each([
    ['empty', ''],
    ['72 ASCII bytes', 'a'.repeat(72)],
    ['24 Sinhala letters (72 bytes)', SINHALA.repeat(24)],
    ['18 emoji (72 bytes)', EMOJI.repeat(18)],
    ['70 ASCII + one 2-byte letter (72 bytes)', 'a'.repeat(70) + 'é'],
  ])('accepts %s', async (_, value) => {
    expect(await errorsFor(value)).toEqual([]);
  });

  it.each([
    ['73 ASCII bytes', 'a'.repeat(73)],
    ['25 Sinhala letters (75 bytes, 25 units)', SINHALA.repeat(25)],
    ['19 emoji (76 bytes, 38 units)', EMOJI.repeat(19)],
    [
      '71 ASCII + one 3-byte letter (74 bytes, 72 units)',
      'a'.repeat(71) + SINHALA,
    ],
  ])('rejects %s (all but the first pass @MaxLength(72))', async (_, value) => {
    expect(await errorsFor(value)).toEqual([
      'value must not exceed 72 bytes in UTF-8',
    ]);
  });

  it('leaves non-strings to @IsString', async () => {
    expect(await errorsFor(12345)).toEqual(['value must be a string']);
  });

  it('never puts the value in the message', async () => {
    const [message] = await errorsFor(`secret-${'x'.repeat(80)}`);
    expect(message).not.toContain('secret-');
  });
});
