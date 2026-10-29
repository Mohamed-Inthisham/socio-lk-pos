import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { SaleBranchGuard } from './guards/sale-branch.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * DELETE /sales/:id keeps its authorization (the three till roles, and
 * SaleBranchGuard: staff only at their own branch, admins anywhere; the
 * guard's behaviour is in guards/sale-branch.guard.spec.ts) and hands the
 * session user and client IP to the service for the DRAFT_DISCARDED row.
 */
describe('SalesController: DELETE /sales/:id', () => {
  it('keeps SaleBranchGuard and the admin, manager and cashier roles', () => {
    // The handler function the decorators wrote their metadata on.
    const method = Object.getOwnPropertyDescriptor(
      SalesController.prototype,
      'discardDraft',
    )!.value as object;
    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toEqual([
      SaleBranchGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, method)).toEqual([
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.CASHIER,
    ]);
  });

  it('passes the session user and client IP to the service', async () => {
    const service = { discardDraft: jest.fn().mockResolvedValue(undefined) };
    const controller = new SalesController(service as unknown as SalesService);
    const user = {
      id: 'cashier-1',
      full_name: 'Till Cashier',
      role: UserRole.CASHIER,
      branch_id: 'branch-1',
    } as AuthenticatedUser;

    await controller.discardDraft('s1', user, '10.0.0.5');

    expect(service.discardDraft).toHaveBeenCalledWith('s1', user, '10.0.0.5');
  });
});
