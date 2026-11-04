import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Exclude } from 'class-transformer';
import { firstValueFrom, of } from 'rxjs';
import { UserRole } from '../../users/enums/user-role.enum';
import { ExposeCost } from '../utils/cost-visibility';
import { RoleAwareSerializerInterceptor } from './role-aware-serializer.interceptor';

class Priced {
  selling_price = '100.00';

  @ExposeCost()
  buying_price = '80.00';

  @Exclude()
  secret = 'hidden';
}

const serializeFor = (
  user?: { role: UserRole },
  body: unknown = new Priced(),
): Promise<unknown> => {
  const interceptor = new RoleAwareSerializerInterceptor(new Reflector());
  const context = {
    getHandler: () => serializeFor,
    getClass: () => RoleAwareSerializerInterceptor,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(body) };
  return firstValueFrom(interceptor.intercept(context, next));
};

describe('RoleAwareSerializerInterceptor', () => {
  it.each([UserRole.ADMIN, UserRole.MANAGER])('%s gets cost', async (role) => {
    await expect(serializeFor({ role })).resolves.toEqual({
      selling_price: '100.00',
      buying_price: '80.00',
    });
  });

  it('a cashier gets no cost, and still the selling price', async () => {
    await expect(serializeFor({ role: UserRole.CASHIER })).resolves.toEqual({
      selling_price: '100.00',
    });
  });

  it('a request without a user gets no cost', async () => {
    await expect(serializeFor()).resolves.toEqual({ selling_price: '100.00' });
  });

  it('covers every item of an array', async () => {
    await expect(
      serializeFor({ role: UserRole.CASHIER }, [new Priced(), new Priced()]),
    ).resolves.toEqual([
      { selling_price: '100.00' },
      { selling_price: '100.00' },
    ]);
  });
});
