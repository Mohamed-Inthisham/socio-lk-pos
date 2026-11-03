import { UserRole } from '../users/enums/user-role.enum';
import { branchAllowsSignIn } from './branch-sign-in';

const active = { is_active: true };
const inactive = { is_active: false };

describe('branchAllowsSignIn', () => {
  it('lets an admin sign in without a branch', () => {
    expect(branchAllowsSignIn({ role: UserRole.ADMIN, branch: null })).toBe(
      true,
    );
    expect(branchAllowsSignIn({ role: UserRole.ADMIN })).toBe(true);
  });

  it('lets an admin sign in whatever branch is attached', () => {
    expect(branchAllowsSignIn({ role: UserRole.ADMIN, branch: active })).toBe(
      true,
    );
    expect(branchAllowsSignIn({ role: UserRole.ADMIN, branch: inactive })).toBe(
      true,
    );
  });

  it.each([UserRole.MANAGER, UserRole.CASHIER])(
    'lets a %s at an active branch sign in',
    (role) => {
      expect(branchAllowsSignIn({ role, branch: active })).toBe(true);
    },
  );

  it.each([UserRole.MANAGER, UserRole.CASHIER])(
    'refuses a %s at an inactive branch',
    (role) => {
      expect(branchAllowsSignIn({ role, branch: inactive })).toBe(false);
    },
  );

  it.each([UserRole.MANAGER, UserRole.CASHIER])(
    'refuses a %s with no branch (never treated as an admin)',
    (role) => {
      expect(branchAllowsSignIn({ role, branch: null })).toBe(false);
      expect(branchAllowsSignIn({ role })).toBe(false);
    },
  );
});
