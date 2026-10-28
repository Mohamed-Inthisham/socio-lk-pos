import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { LoginDto } from '../../auth/dto/login.dto';
import { SetApprovalPinDto } from '../../approvals/dto/set-approval-pin.dto';
import { PASSWORD_TOO_LONG_MESSAGE } from '../../common/bcrypt-input';
import { UserRole } from '../enums/user-role.enum';

const SINHALA = 'ම'; // 1 UTF-16 unit, 3 bytes
const EMOJI = '\u{1F600}'; // 2 UTF-16 units, 4 bytes

const passwordErrors = async <T extends object>(
  cls: new () => T,
  body: object,
  field = 'password',
) => {
  const errors = await validate(plainToInstance(cls, body));
  return errors
    .filter((e) => e.property === field)
    .flatMap((e) => Object.values(e.constraints ?? {}));
};

describe('CreateUserDto.password', () => {
  const create = (password: unknown) =>
    passwordErrors(CreateUserDto, {
      email: 'new@socio.lk',
      password,
      full_name: 'New User',
      role: UserRole.ADMIN,
    });

  it.each([
    ['8 ASCII characters (the minimum)', 'abcd1234'],
    ['72 ASCII characters', 'a'.repeat(72)],
    ['24 Sinhala letters (72 bytes)', SINHALA.repeat(24)],
    ['18 emoji (72 bytes)', EMOJI.repeat(18)],
  ])('accepts %s', async (_, password) => {
    expect(await create(password)).toEqual([]);
  });

  it.each([
    ['73 ASCII characters', 'a'.repeat(73)],
    ['25 Sinhala letters (75 bytes)', SINHALA.repeat(25)],
    [
      '72 Sinhala letters (216 bytes), accepted before this change',
      SINHALA.repeat(72),
    ],
    ['36 emoji (144 bytes), accepted before this change', EMOJI.repeat(36)],
    ['71 ASCII + one 3-byte letter (74 bytes)', 'a'.repeat(71) + SINHALA],
  ])('rejects %s with the byte message only', async (_, password) => {
    expect(await create(password)).toEqual([PASSWORD_TOO_LONG_MESSAGE]);
  });

  it('keeps the 8-character minimum', async () => {
    expect(await create('abc1234')).toEqual([
      'Password must be at least 8 characters',
    ]);
  });

  it('never puts the password in a message', async () => {
    const messages = await create(`secret-${SINHALA.repeat(30)}`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain('secret-');
  });
});

// Checking an existing password is deliberately not byte-limited: bcrypt
// truncates at login exactly as it did when hashing, so a password longer
// than 72 bytes set before this check must keep working.
describe('password checks stay unchanged', () => {
  const long = SINHALA.repeat(30); // 30 units, 90 bytes

  it('LoginDto still accepts a 90-byte password', async () => {
    expect(
      await passwordErrors(LoginDto, { email: 'a@socio.lk', password: long }),
    ).toEqual([]);
  });

  it('SetApprovalPinDto.current_password still accepts it', async () => {
    expect(
      await passwordErrors(
        SetApprovalPinDto,
        { current_password: long, pin: '482916' },
        'current_password',
      ),
    ).toEqual([]);
  });
});
