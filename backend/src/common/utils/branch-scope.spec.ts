import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../users/enums/user-role.enum';
import { assertBranchAccess, BranchActor, scopeBranch } from './branch-scope';

const admin: BranchActor = { role: UserRole.ADMIN, branch_id: null };
const manager: BranchActor = { role: UserRole.MANAGER, branch_id: 'branch-a' };
const cashier: BranchActor = { role: UserRole.CASHIER, branch_id: 'branch-a' };
const unassigned: BranchActor = { role: UserRole.CASHIER, branch_id: null };

/** The 403 body the helper refuses with. */
const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenException);
    return (err as ForbiddenException).getResponse();
  }
  throw new Error('expected a 403');
};

const WRONG_BRANCH = {
  message: 'You can only access data for your own branch.',
  code: 'WRONG_BRANCH',
};

describe('scopeBranch', () => {
  it('gives an admin every branch when none is requested', () => {
    expect(scopeBranch(admin)).toBeUndefined();
  });

  it('gives an admin the branch requested', () => {
    expect(scopeBranch(admin, 'branch-b')).toBe('branch-b');
  });

  it.each([
    ['manager', manager],
    ['cashier', cashier],
  ])('gives a %s their own branch when none is requested', (_, actor) => {
    expect(scopeBranch(actor)).toBe('branch-a');
  });

  it.each([
    ['manager', manager],
    ['cashier', cashier],
  ])('lets a %s request their own branch', (_, actor) => {
    expect(scopeBranch(actor, 'branch-a')).toBe('branch-a');
  });

  it.each([
    ['manager', manager],
    ['cashier', cashier],
  ])('refuses a %s another branch with 403 WRONG_BRANCH', (_, actor) => {
    expect(refusal(() => scopeBranch(actor, 'branch-b'))).toEqual(WRONG_BRANCH);
  });

  it('refuses a staff user with no branch, whether or not one is requested', () => {
    expect(refusal(() => scopeBranch(unassigned))).toEqual(WRONG_BRANCH);
    expect(refusal(() => scopeBranch(unassigned, 'branch-a'))).toEqual(
      WRONG_BRANCH,
    );
  });
});

describe('assertBranchAccess', () => {
  it('lets an admin into any branch', () => {
    expect(() => assertBranchAccess(admin, 'branch-b')).not.toThrow();
  });

  it('lets staff into their own branch', () => {
    expect(() => assertBranchAccess(manager, 'branch-a')).not.toThrow();
    expect(() => assertBranchAccess(cashier, 'branch-a')).not.toThrow();
  });

  it('refuses staff another branch, and staff with no branch', () => {
    expect(refusal(() => assertBranchAccess(cashier, 'branch-b'))).toEqual(
      WRONG_BRANCH,
    );
    expect(refusal(() => assertBranchAccess(unassigned, 'branch-a'))).toEqual(
      WRONG_BRANCH,
    );
  });
});
