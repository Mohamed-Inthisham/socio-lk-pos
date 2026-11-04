import { instanceToPlain } from 'class-transformer';
import { UserRole } from '../../users/enums/user-role.enum';
import { canViewCost, COST_GROUP, ExposeCost } from './cost-visibility';

class Priced {
  name = 'Cable';

  @ExposeCost()
  buying_price = '80.00';
}

describe('canViewCost', () => {
  it.each([
    [UserRole.ADMIN, true],
    [UserRole.MANAGER, true],
    [UserRole.CASHIER, false],
  ])('%s: %s', (role, allowed) => {
    expect(canViewCost({ role })).toBe(allowed);
  });

  it('is false without a user', () => {
    expect(canViewCost(undefined)).toBe(false);
    expect(canViewCost(null)).toBe(false);
  });
});

describe('ExposeCost', () => {
  it('hides the field unless the cost group is given', () => {
    expect(instanceToPlain(new Priced())).toEqual({ name: 'Cable' });
  });

  it('keeps the field with the cost group', () => {
    expect(instanceToPlain(new Priced(), { groups: [COST_GROUP] })).toEqual({
      name: 'Cable',
      buying_price: '80.00',
    });
  });

  it('reaches a field nested in a plain object', () => {
    expect(instanceToPlain({ product: new Priced() })).toEqual({
      product: { name: 'Cable' },
    });
  });
});
