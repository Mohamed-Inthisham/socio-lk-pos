import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { UserRole } from '../users/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * The stock reads are branch-scoped (Phase 2 P2-4,
 * common/utils/branch-scope): admins read any branch, managers and
 * cashiers only their own; another branchId is 403 WRONG_BRANCH, another
 * branch's row is the service's 404 (it is looked up with the staff
 * member's branch), and by-product gives staff only their branch's row.
 * GET /stock validates productId and branchId as UUIDs.
 */
describe('StockController: branch-scoped reads', () => {
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
  const rows = [{ id: 's1' }];

  const setup = () => {
    const service = {
      findAll: jest.fn().mockResolvedValue(rows),
      findOne: jest.fn().mockResolvedValue({ id: 's1' }),
      findByProduct: jest.fn().mockResolvedValue(rows),
    };
    return {
      service,
      controller: new StockController(service as unknown as StockService),
    };
  };

  const wrongBranch: unknown = expect.objectContaining({
    response: {
      message: 'You can only access data for your own branch.',
      code: 'WRONG_BRANCH',
    },
    status: 403,
  });

  describe('GET /stock', () => {
    it('lets an admin list every branch, or the one asked for', async () => {
      const { service, controller } = setup();

      await controller.findAll(admin, 'p1', undefined, true);
      await controller.findAll(admin, undefined, 'branch-b', undefined);

      expect(service.findAll).toHaveBeenNthCalledWith(1, {
        productId: 'p1',
        branchId: undefined,
        lowStockOnly: true,
      });
      expect(service.findAll).toHaveBeenNthCalledWith(2, {
        productId: undefined,
        branchId: 'branch-b',
        lowStockOnly: undefined,
      });
    });

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])(
      'scopes a %s to their branch, left out or their own, keeping the other filters',
      async (_, user) => {
        const { service, controller } = setup();

        await expect(
          controller.findAll(user, 'p1', undefined, true),
        ).resolves.toBe(rows);
        await controller.findAll(user, 'p1', 'branch-a', true);

        for (const call of [1, 2]) {
          expect(service.findAll).toHaveBeenNthCalledWith(call, {
            productId: 'p1',
            branchId: 'branch-a',
            lowStockOnly: true,
          });
        }
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
          controller.findAll(user, undefined, 'branch-b', undefined),
        ).rejects.toEqual(wrongBranch);
        expect(service.findAll).not.toHaveBeenCalled();
      },
    );

    it('validates productId and branchId as optional UUIDs (400 otherwise)', async () => {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        StockController,
        'findAll',
      ) as Record<string, { data?: string; pipes: unknown[] }>;
      const uuidPipeFor = (name: string) => {
        const arg = Object.values(args).find((a) => a.data === name);
        return arg!.pipes[0] as {
          transform: (value: unknown, meta: object) => Promise<unknown>;
        };
      };

      for (const name of ['productId', 'branchId']) {
        const pipe = uuidPipeFor(name);
        await expect(
          pipe.transform(undefined, { type: 'query', data: name }),
        ).resolves.toBeUndefined();
        await expect(
          pipe.transform('not-a-uuid', { type: 'query', data: name }),
        ).rejects.toThrow(BadRequestException);
      }
    });
  });

  describe('GET /stock/:id', () => {
    it('looks up an admin’s row at any branch', async () => {
      const { service, controller } = setup();

      await controller.findOne('s1', admin);

      expect(service.findOne).toHaveBeenCalledWith('s1', {
        branchId: undefined,
      });
    });

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])('looks up a %s’s row at their own branch only', async (_, user) => {
      const { service, controller } = setup();

      await controller.findOne('s1', user);

      expect(service.findOne).toHaveBeenCalledWith('s1', {
        branchId: 'branch-a',
      });
    });

    it('passes the service’s 404 (another branch’s row) through unchanged', async () => {
      const { service, controller } = setup();
      const notFound = new NotFoundException('Stock row not found');
      service.findOne.mockRejectedValue(notFound);

      await expect(controller.findOne('s1', cashier)).rejects.toBe(notFound);
    });
  });

  describe('GET /stock/by-product/:productId', () => {
    it('gives an admin every branch’s row', async () => {
      const { service, controller } = setup();

      await expect(controller.findByProduct('p1', admin)).resolves.toBe(rows);

      expect(service.findByProduct).toHaveBeenCalledWith('p1', undefined);
    });

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])('gives a %s only their own branch’s row', async (_, user) => {
      const { service, controller } = setup();

      await controller.findByProduct('p1', user);

      expect(service.findByProduct).toHaveBeenCalledWith('p1', 'branch-a');
    });
  });
});
