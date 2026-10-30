import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
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

describe('contact details (Task 2.5)', () => {
  const valid = {
    email: 'new@socio.lk',
    password: 'abcd1234',
    full_name: 'New User',
    role: UserRole.ADMIN,
    phone: '0771234567',
    nic: '199012345678',
    address: '12 Temple Road, Kandy',
  };

  const check = async <T extends object>(cls: new () => T, body: object) => {
    const dto = plainToInstance(cls, body);
    const errors = await validate(dto, { forbidUnknownValues: true });
    const messages = Object.fromEntries(
      errors.map((e) => [e.property, Object.values(e.constraints ?? {})]),
    );
    return { dto: dto as Record<string, unknown>, messages };
  };

  it('accepts and normalizes them', async () => {
    const { dto, messages } = await check(CreateUserDto, {
      ...valid,
      phone: '+94 77 123-4567',
      nic: ' 901234567v ',
      address: '  12 Temple Road, Kandy  ',
    });
    expect(messages).toEqual({});
    expect(dto).toMatchObject({
      phone: '0771234567',
      nic: '901234567V',
      address: '12 Temple Road, Kandy',
    });
  });

  it.each(['phone', 'nic', 'address'])(
    'requires %s on create',
    async (field) => {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      const { messages } = await check(CreateUserDto, body);
      expect(Object.keys(messages)).toEqual([field]);
    },
  );

  it.each([
    ['phone', '12345', 'Contact number must be a valid Sri Lankan number'],
    ['phone', 'abcdefghij', 'Contact number must be a valid Sri Lankan number'],
    ['phone', '0071234567', 'Contact number must be a valid Sri Lankan number'],
    ['nic', '90123456V', 'NIC must be 9 digits followed by V or X'],
    ['nic', '199012345678V', 'NIC must be 9 digits followed by V or X'],
    ['nic', '1990 1234 5678', 'NIC must be 9 digits followed by V or X'],
    ['address', '   ', 'Address is required'],
    ['address', 'x'.repeat(501), 'Address must be at most 500 characters'],
  ])('refuses %s %j', async (field, value, message) => {
    const { messages } = await check(CreateUserDto, {
      ...valid,
      [field]: value,
    });
    expect(Object.keys(messages)).toEqual([field]);
    expect(messages[field].join(' ')).toContain(message);
  });

  describe('UpdateUserDto', () => {
    it('lets them be left out (users created before them have none)', async () => {
      const { messages } = await check(UpdateUserDto, { full_name: 'Renamed' });
      expect(messages).toEqual({});
    });

    it('changes them with the same normalization', async () => {
      const { dto, messages } = await check(UpdateUserDto, {
        phone: '94712345678',
        nic: '901234567x',
      });
      expect(messages).toEqual({});
      expect(dto).toMatchObject({ phone: '0712345678', nic: '901234567X' });
    });

    it.each([
      ['phone', null],
      ['phone', ''],
      ['nic', null],
      ['nic', ''],
      ['address', null],
      ['address', '  '],
    ])('never clears %s (%j is a 400)', async (field, value) => {
      const { messages } = await check(UpdateUserDto, { [field]: value });
      expect(Object.keys(messages)).toEqual([field]);
    });
  });
});
