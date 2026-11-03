import { instanceToPlain } from 'class-transformer';
import { User } from './user.entity';
import { UserRole } from '../enums/user-role.enum';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';

// Defence in depth behind `select: false`: even when a hash IS loaded
// (UsersService.findByEmail), ClassSerializerInterceptor must drop it.
describe('secret fields are @Exclude()d from serialization', () => {
  it('drops User.password_hash', () => {
    const user = Object.assign(new User(), {
      id: 'u1',
      full_name: 'Asha Perera',
      password_hash: '$2b$04$abcdefghijklmnopqrstuv',
    });
    const plain = instanceToPlain(user);
    expect(plain).toMatchObject({ id: 'u1', full_name: 'Asha Perera' });
    expect(plain).not.toHaveProperty('password_hash');
  });

  it('drops a nested User.password_hash (e.g. sale.cashier)', () => {
    const cashier = Object.assign(new User(), {
      id: 'u1',
      password_hash: '$2b$04$abcdefghijklmnopqrstuv',
    });
    const plain = instanceToPlain({ data: [{ id: 's1', cashier }] });
    expect(plain.data[0].cashier).toEqual({ id: 'u1' });
  });

  it('drops RefreshToken.token_hash', () => {
    const token = Object.assign(new RefreshToken(), {
      id: 't1',
      token_hash: 'a'.repeat(64),
    });
    const plain = instanceToPlain(token);
    expect(plain).toMatchObject({ id: 't1' });
    expect(plain).not.toHaveProperty('token_hash');
  });
});

/**
 * Staff personal data (F3): a User serialized as an entity (an embedded
 * sale.cashier, phone_purchase.cashier, stock_purchase.created_by, …)
 * carries no email, phone, NIC or address, and still no secret. What the
 * operational screens read (id, full_name) and the other fields stay.
 * Admin user management keeps the four through UsersService's plain
 * objects (users.service.spec.ts, findById).
 */
describe('staff personal data is @Exclude()d from serialization (F3)', () => {
  const PERSONAL = ['email', 'phone', 'nic', 'address'];
  const SECRETS = [
    'password_hash',
    'approval_pin_hash',
    'approval_pin_failed_attempts',
    'approval_pin_locked_until',
  ];
  const setAt = new Date('2026-11-01T09:00:00.000Z');

  const staffMember = () =>
    Object.assign(new User(), {
      id: 'u1',
      email: 'asha@shop.test',
      full_name: 'Asha Perera',
      phone: '0771234567',
      nic: '199012345678',
      address: '12 Galle Road, Colombo 03',
      password_hash: '$2b$04$abcdefghijklmnopqrstuv',
      approval_pin_hash: '$2b$04$pinpinpinpinpinpinpinpi',
      approval_pin_set_at: setAt,
      approval_pin_failed_attempts: 2,
      approval_pin_locked_until: setAt,
      role: UserRole.MANAGER,
      is_active: true,
      branch_id: 'branch-1',
    });

  it('drops email, phone, nic and address, and every secret, keeping the rest', () => {
    const plain = instanceToPlain(staffMember());

    for (const key of [...PERSONAL, ...SECRETS]) {
      expect(plain).not.toHaveProperty(key);
    }
    expect(plain).toEqual({
      id: 'u1',
      full_name: 'Asha Perera',
      approval_pin_set_at: setAt,
      role: UserRole.MANAGER,
      is_active: true,
      branch_id: 'branch-1',
    });
  });

  it('drops them from a user nested in a response (sale.cashier inside a page)', () => {
    const plain = instanceToPlain({
      data: [{ id: 's1', cashier: staffMember() }],
      meta: { total: 1 },
    });

    const cashier = plain.data[0].cashier as Record<string, unknown>;
    for (const key of [...PERSONAL, ...SECRETS]) {
      expect(cashier).not.toHaveProperty(key);
    }
    expect(cashier).toMatchObject({ id: 'u1', full_name: 'Asha Perera' });
  });
});
