import { NotFoundException } from '@nestjs/common';
import { PhonePurchasesController } from './phone-purchases.controller';
import { PhonePurchasesService } from './phone-purchases.service';
import { UserRole } from '../users/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * The phone-purchase reads are branch-scoped (Phase 2 P2-2,
 * common/utils/branch-scope): admins read any branch, managers and
 * cashiers only their own; another branchId is 403 WRONG_BRANCH, and
 * another branch's purchase is the service's 404 (it is looked up with
 * the staff member's branch). POST /phone-purchases is unchanged.
 */
describe('PhonePurchasesController: branch-scoped reads', () => {
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    branch_id: null,
  } as AuthenticatedUser;
  const manager = {
    id: 'manager-1',
    role: UserRole.MANAGER,
    branch_id: 'branch-a',
  } as AuthenticatedUser;
  const cashier = {
    id: 'cashier-1',
    role: UserRole.CASHIER,
    branch_id: 'branch-a',
  } as AuthenticatedUser;
  const page = { data: [], meta: {} };

  const setup = () => {
    const service = {
      findAll: jest.fn().mockResolvedValue(page),
      findOne: jest.fn().mockResolvedValue({ id: 'p1' }),
    };
    return {
      service,
      controller: new PhonePurchasesController(
        service as unknown as PhonePurchasesService,
      ),
    };
  };

  const wrongBranch: unknown = expect.objectContaining({
    response: {
      message: 'You can only access data for your own branch.',
      code: 'WRONG_BRANCH',
    },
    status: 403,
  });

  describe('GET /phone-purchases', () => {
    it('lets an admin list every branch, or the one asked for', async () => {
      const { service, controller } = setup();

      await controller.findAll({ customer_id: 'c1' }, admin);
      await controller.findAll({ branchId: 'branch-b' }, admin);

      expect(service.findAll).toHaveBeenNthCalledWith(1, {
        customer_id: 'c1',
        branchId: undefined,
      });
      expect(service.findAll).toHaveBeenNthCalledWith(2, {
        branchId: 'branch-b',
      });
    });

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])(
      'scopes a %s to their branch, left out or their own, keeping the other filters',
      async (_, user) => {
        const { service, controller } = setup();
        const filters = { customer_id: 'c1', page: 2, limit: 10 };

        await expect(controller.findAll(filters, user)).resolves.toBe(page);
        await controller.findAll({ ...filters, branchId: 'branch-a' }, user);

        expect(service.findAll).toHaveBeenNthCalledWith(1, {
          ...filters,
          branchId: 'branch-a',
        });
        expect(service.findAll).toHaveBeenNthCalledWith(2, {
          ...filters,
          branchId: 'branch-a',
        });
      },
    );

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])(
      'refuses a %s another branch with 403 WRONG_BRANCH, without querying',
      async (_, user) => {
        const { service, controller } = setup();

        await expect(
          controller.findAll({ branchId: 'branch-b' }, user),
        ).rejects.toEqual(wrongBranch);
        expect(service.findAll).not.toHaveBeenCalled();
      },
    );
  });

  describe('GET /phone-purchases/:id', () => {
    it('looks up an admin’s purchase at any branch', async () => {
      const { service, controller } = setup();

      await controller.findOne('p1', admin);

      expect(service.findOne).toHaveBeenCalledWith('p1', {
        branchId: undefined,
      });
    });

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])('looks up a %s’s purchase at their own branch only', async (_, user) => {
      const { service, controller } = setup();

      await controller.findOne('p1', user);

      expect(service.findOne).toHaveBeenCalledWith('p1', {
        branchId: 'branch-a',
      });
    });

    it('passes the service’s 404 through unchanged', async () => {
      const { service, controller } = setup();
      const notFound = new NotFoundException('Phone purchase not found');
      service.findOne.mockRejectedValue(notFound);

      await expect(controller.findOne('p1', cashier)).rejects.toBe(notFound);
    });
  });
});
