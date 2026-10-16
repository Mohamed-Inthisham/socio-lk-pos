import { instanceToPlain } from 'class-transformer';
import { User } from './user.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';

// Defence in depth behind `select: false`: even when a hash IS loaded
// (UsersService.findByEmail), ClassSerializerInterceptor must drop it.
describe('secret fields are @Exclude()d from serialization', () => {
  it('drops User.password_hash', () => {
    const user = Object.assign(new User(), {
      id: 'u1',
      email: 'a@b.com',
      password_hash: '$2b$04$abcdefghijklmnopqrstuv',
    });
    const plain = instanceToPlain(user);
    expect(plain).toMatchObject({ id: 'u1', email: 'a@b.com' });
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
