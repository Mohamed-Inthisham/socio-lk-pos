import { BadRequestException, NotFoundException } from '@nestjs/common';
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

/**
 * The sales reads are branch-scoped (Phase 2 P2-1, common/utils/branch-scope):
 * admins read any branch, managers and cashiers only their own; another
 * branchId is 403 WRONG_BRANCH, and another branch's sale is the service's
 * 404 (it is looked up with the staff member's branch).
 */
describe('SalesController: branch-scoped reads', () => {
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
  const summary = { sales_count: 0 };

  const setup = () => {
    const service = {
      findAll: jest.fn().mockResolvedValue(page),
      dailySummary: jest.fn().mockResolvedValue(summary),
      findOne: jest.fn().mockResolvedValue({ id: 's1' }),
    };
    return {
      service,
      controller: new SalesController(service as unknown as SalesService),
    };
  };

  const wrongBranch: unknown = expect.objectContaining({
    response: {
      message: 'You can only access data for your own branch.',
      code: 'WRONG_BRANCH',
    },
    status: 403,
  });

  describe('GET /sales', () => {
    it('lets an admin list every branch, or the one asked for', async () => {
      const { service, controller } = setup();

      await controller.findAll({ status: undefined, q: 'INV' }, admin);
      await controller.findAll({ branchId: 'branch-b' }, admin);

      expect(service.findAll).toHaveBeenNthCalledWith(1, {
        status: undefined,
        q: 'INV',
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
      'scopes a %s to their branch, keeping the other filters',
      async (_, user) => {
        const { service, controller } = setup();
        const filters = {
          customerId: 'c1',
          sort: 'completed_at' as const,
          page: 2,
          limit: 10,
        };

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

    it('refuses staff another branch with 403 WRONG_BRANCH, without querying', async () => {
      const { service, controller } = setup();

      await expect(
        controller.findAll({ branchId: 'branch-b' }, cashier),
      ).rejects.toEqual(wrongBranch);
      expect(service.findAll).not.toHaveBeenCalled();
    });
  });

  describe('GET /sales/daily-summary', () => {
    const dates = { from: '2026-11-01', to: '2026-11-02' };

    it('gives an admin the branch asked for, and is 400 without one', async () => {
      const { service, controller } = setup();

      await expect(
        controller.dailySummary({ ...dates, branchId: 'branch-b' }, admin),
      ).resolves.toBe(summary);
      await expect(controller.dailySummary(dates, admin)).rejects.toThrow(
        BadRequestException,
      );

      expect(service.dailySummary).toHaveBeenCalledTimes(1);
      expect(service.dailySummary).toHaveBeenCalledWith({
        ...dates,
        branchId: 'branch-b',
      });
    });

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])(
      'gives a %s their own branch, with or without branchId',
      async (_, user) => {
        const { service, controller } = setup();

        await controller.dailySummary(dates, user);
        await controller.dailySummary({ ...dates, branchId: 'branch-a' }, user);

        expect(service.dailySummary).toHaveBeenNthCalledWith(1, {
          ...dates,
          branchId: 'branch-a',
        });
        expect(service.dailySummary).toHaveBeenNthCalledWith(2, {
          ...dates,
          branchId: 'branch-a',
        });
      },
    );

    it.each([
      ['an admin', { ...dates, branchId: 'branch-a' }, admin],
      ['a manager', dates, manager],
    ])('gives %s the cost of sales (INV-F3)', async (_, query, user) => {
      const { service, controller } = setup();
      service.dailySummary.mockResolvedValue({
        sales_count: 1,
        cost_of_sales: '80.00',
      });

      await expect(controller.dailySummary(query, user)).resolves.toEqual({
        sales_count: 1,
        cost_of_sales: '80.00',
      });
    });

    it('leaves the cost of sales out for a cashier (INV-F3)', async () => {
      const { service, controller } = setup();
      service.dailySummary.mockResolvedValue({
        sales_count: 1,
        cost_of_sales: '80.00',
      });

      await expect(controller.dailySummary(dates, cashier)).resolves.toEqual({
        sales_count: 1,
      });
    });

    it('refuses staff another branch with 403 WRONG_BRANCH', async () => {
      const { service, controller } = setup();

      await expect(
        controller.dailySummary({ ...dates, branchId: 'branch-b' }, manager),
      ).rejects.toEqual(wrongBranch);
      expect(service.dailySummary).not.toHaveBeenCalled();
    });
  });

  describe('GET /sales/:id', () => {
    it('looks up an admin’s sale at any branch', async () => {
      const { service, controller } = setup();

      await controller.findOne('s1', admin);

      expect(service.findOne).toHaveBeenCalledWith('s1', {
        branchId: undefined,
      });
    });

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])('looks up a %s’s sale at their own branch only', async (_, user) => {
      const { service, controller } = setup();

      await controller.findOne('s1', user);

      expect(service.findOne).toHaveBeenCalledWith('s1', {
        branchId: 'branch-a',
      });
    });

    it('passes the service’s 404 through unchanged', async () => {
      const { service, controller } = setup();
      const notFound = new NotFoundException('Sale not found');
      service.findOne.mockRejectedValue(notFound);

      await expect(controller.findOne('s1', cashier)).rejects.toBe(notFound);
    });
  });
});
