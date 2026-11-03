import { NotFoundException } from '@nestjs/common';
import { ProductUnitsController } from './product-units.controller';
import { ProductUnitsService } from './product-units.service';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * The product-unit reads are branch-scoped (Phase 2 P2-3,
 * common/utils/branch-scope): admins read any branch, managers (and, for
 * the till lookup, cashiers) only their own; another branchId is 403
 * WRONG_BRANCH, and another branch's unit is the service's 404 (it is
 * looked up with the manager's branch). Cashiers still can't list or
 * open units.
 */
describe('ProductUnitsController: branch-scoped reads', () => {
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
  const sellable = { unitId: 'u1', identifier: '356938035643810' };

  const setup = () => {
    const service = {
      findAll: jest.fn().mockResolvedValue(page),
      findOne: jest.fn().mockResolvedValue({ id: 'u1' }),
      findSellableByIdentifier: jest.fn().mockResolvedValue(sellable),
    };
    return {
      service,
      controller: new ProductUnitsController(
        service as unknown as ProductUnitsService,
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

  /** The roles a handler's @Roles() allows. */
  const rolesOf = (handler: keyof ProductUnitsController): unknown =>
    Reflect.getMetadata(
      ROLES_KEY,
      Object.getOwnPropertyDescriptor(
        ProductUnitsController.prototype,
        handler,
      )!.value as object,
    );

  describe('GET /product-units', () => {
    it('still allows admins and managers only (cashiers are refused by role)', () => {
      expect(rolesOf('findAll')).toEqual([UserRole.ADMIN, UserRole.MANAGER]);
    });

    it('lets an admin list every branch, or the one asked for', async () => {
      const { service, controller } = setup();

      await controller.findAll({ status: undefined }, admin);
      await controller.findAll({ branchId: 'branch-b' }, admin);

      expect(service.findAll).toHaveBeenNthCalledWith(1, {
        status: undefined,
        branchId: undefined,
      });
      expect(service.findAll).toHaveBeenNthCalledWith(2, {
        branchId: 'branch-b',
      });
    });

    it('scopes a manager to their branch, left out or their own, keeping the other filters', async () => {
      const { service, controller } = setup();
      const filters = {
        productId: 'p1',
        imei: '356938035643810',
        page: 2,
        limit: 10,
      };

      await expect(controller.findAll(filters, manager)).resolves.toBe(page);
      await controller.findAll({ ...filters, branchId: 'branch-a' }, manager);

      expect(service.findAll).toHaveBeenNthCalledWith(1, {
        ...filters,
        branchId: 'branch-a',
      });
      expect(service.findAll).toHaveBeenNthCalledWith(2, {
        ...filters,
        branchId: 'branch-a',
      });
    });

    it('refuses a manager another branch with 403 WRONG_BRANCH, without querying', async () => {
      const { service, controller } = setup();

      await expect(
        controller.findAll({ branchId: 'branch-b' }, manager),
      ).rejects.toEqual(wrongBranch);
      expect(service.findAll).not.toHaveBeenCalled();
    });
  });

  describe('GET /product-units/:id', () => {
    it('still allows admins and managers only', () => {
      expect(rolesOf('findOne')).toEqual([UserRole.ADMIN, UserRole.MANAGER]);
    });

    it('looks up an admin’s unit at any branch', async () => {
      const { service, controller } = setup();

      await controller.findOne('u1', admin);

      expect(service.findOne).toHaveBeenCalledWith('u1', {
        branchId: undefined,
      });
    });

    it('looks up a manager’s unit at their own branch only', async () => {
      const { service, controller } = setup();

      await controller.findOne('u1', manager);

      expect(service.findOne).toHaveBeenCalledWith('u1', {
        branchId: 'branch-a',
      });
    });

    it('passes the service’s 404 (another branch’s unit) through unchanged', async () => {
      const { service, controller } = setup();
      const notFound = new NotFoundException('Product unit not found');
      service.findOne.mockRejectedValue(notFound);

      await expect(controller.findOne('u1', manager)).rejects.toBe(notFound);
    });
  });

  describe('GET /product-units/sellable/by-identifier/:identifier', () => {
    it('allows every till role', () => {
      expect(rolesOf('findSellableByIdentifier')).toEqual([
        UserRole.ADMIN,
        UserRole.MANAGER,
        UserRole.CASHIER,
      ]);
    });

    it('lets an admin look up any branch', async () => {
      const { service, controller } = setup();

      await expect(
        controller.findSellableByIdentifier(
          '356938035643810',
          'branch-b',
          admin,
        ),
      ).resolves.toBe(sellable);

      expect(service.findSellableByIdentifier).toHaveBeenCalledWith(
        '356938035643810',
        'branch-b',
      );
    });

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])('lets a %s look up their own branch', async (_, user) => {
      const { service, controller } = setup();

      await controller.findSellableByIdentifier('SN-HUB-1', 'branch-a', user);

      expect(service.findSellableByIdentifier).toHaveBeenCalledWith(
        'SN-HUB-1',
        'branch-a',
      );
    });

    it.each([
      ['manager', manager],
      ['cashier', cashier],
    ])(
      'refuses a %s another branch with 403 WRONG_BRANCH, without looking',
      async (_, user) => {
        const { service, controller } = setup();

        await expect(
          controller.findSellableByIdentifier('SN-HUB-1', 'branch-b', user),
        ).rejects.toEqual(wrongBranch);
        expect(service.findSellableByIdentifier).not.toHaveBeenCalled();
      },
    );
  });
});
