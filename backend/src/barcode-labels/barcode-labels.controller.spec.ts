import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BarcodeLabelsController } from './barcode-labels.controller';
import { BarcodeLabelsService } from './barcode-labels.service';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { LabelKind } from './dto/label-row.dto';

/**
 * Who may use the label endpoints, and which branch they get. The real
 * RolesGuard runs against each handler, so a handler-level @Roles that
 * loosened the class's would fail here. Unauthenticated requests are
 * refused by the global JwtAuthGuard: no handler is @Public. The HTTP 401
 * and 403 themselves are in test/barcode-labels.e2e-spec.ts.
 */
describe('BarcodeLabelsController: access and branch scope', () => {
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
  const handlers = ['searchProducts', 'searchUnits', 'resolveQueue'] as const;

  const setup = () => {
    const page = { data: [], meta: {} };
    const service = {
      searchProducts: jest.fn().mockResolvedValue(page),
      searchUnits: jest.fn().mockResolvedValue(page),
      resolveQueue: jest.fn().mockResolvedValue({ data: [], total_labels: 0 }),
    };
    return {
      service,
      controller: new BarcodeLabelsController(
        service as unknown as BarcodeLabelsService,
      ),
    };
  };

  const handlerOf = (name: (typeof handlers)[number]) =>
    Object.getOwnPropertyDescriptor(BarcodeLabelsController.prototype, name)!
      .value as () => unknown;

  /** Run the real RolesGuard for `user` against `handler`. */
  const rolesGuardAllows = (
    user: AuthenticatedUser | undefined,
    handler: (typeof handlers)[number],
  ): boolean => {
    const context = {
      getHandler: () => handlerOf(handler),
      getClass: () => BarcodeLabelsController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    return new RolesGuard(new Reflector()).canActivate(context);
  };

  const wrongBranch: unknown = expect.objectContaining({
    response: {
      message: 'You can only access data for your own branch.',
      code: 'WRONG_BRANCH',
    },
    status: 403,
  });

  it('sets admin and manager on the class, and no handler overrides it', () => {
    expect(Reflect.getMetadata(ROLES_KEY, BarcodeLabelsController)).toEqual([
      UserRole.ADMIN,
      UserRole.MANAGER,
    ]);
    for (const handler of handlers) {
      expect(
        Reflect.getMetadata(ROLES_KEY, handlerOf(handler)),
      ).toBeUndefined();
    }
  });

  it('has no public route, so the global JwtAuthGuard refuses a request without a session', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, BarcodeLabelsController),
    ).toBeUndefined();
    for (const handler of handlers) {
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, handlerOf(handler)),
      ).toBeUndefined();
    }
  });

  it.each(handlers)(
    'lets admins and managers through, and refuses cashiers, on %s',
    (handler) => {
      expect(rolesGuardAllows(admin, handler)).toBe(true);
      expect(rolesGuardAllows(manager, handler)).toBe(true);
      expect(() => rolesGuardAllows(cashier, handler)).toThrow(
        ForbiddenException,
      );
      expect(() => rolesGuardAllows(undefined, handler)).toThrow(
        ForbiddenException,
      );
    },
  );

  describe('GET /barcode-labels/units', () => {
    it('lets an admin search every branch, or the one asked for', async () => {
      const { service, controller } = setup();

      await controller.searchUnits({}, admin);
      await controller.searchUnits({ branchId: 'branch-b' }, admin);

      expect(service.searchUnits).toHaveBeenNthCalledWith(1, {
        branchId: undefined,
      });
      expect(service.searchUnits).toHaveBeenNthCalledWith(2, {
        branchId: 'branch-b',
      });
    });

    it('holds a manager to their own branch', async () => {
      const { service, controller } = setup();

      await controller.searchUnits({ search: 'iph' }, manager);
      await controller.searchUnits({ branchId: 'branch-a' }, manager);

      expect(service.searchUnits).toHaveBeenNthCalledWith(1, {
        search: 'iph',
        branchId: 'branch-a',
      });
      expect(service.searchUnits).toHaveBeenNthCalledWith(2, {
        branchId: 'branch-a',
      });
    });

    it('refuses a manager another branch with 403 WRONG_BRANCH, before searching', async () => {
      const { service, controller } = setup();

      await expect(
        controller.searchUnits({ branchId: 'branch-b' }, manager),
      ).rejects.toEqual(wrongBranch);
      expect(service.searchUnits).not.toHaveBeenCalled();
    });

    it('refuses a manager with no branch rather than widening the scope', async () => {
      const { service, controller } = setup();
      const noBranch = { ...manager, branch_id: null } as AuthenticatedUser;

      await expect(controller.searchUnits({}, noBranch)).rejects.toThrow(
        ForbiddenException,
      );
      expect(service.searchUnits).not.toHaveBeenCalled();
    });
  });

  describe('POST /barcode-labels/resolve', () => {
    const items = [{ type: LabelKind.UNIT, unitId: 'u-1' }];

    it('resolves an admin’s queue for the branch named, or every branch', async () => {
      const { service, controller } = setup();

      await controller.resolveQueue({ items }, admin);
      await controller.resolveQueue({ branchId: 'branch-b', items }, admin);

      expect(service.resolveQueue).toHaveBeenNthCalledWith(
        1,
        { items },
        undefined,
      );
      expect(service.resolveQueue).toHaveBeenNthCalledWith(
        2,
        { branchId: 'branch-b', items },
        'branch-b',
      );
    });

    it('resolves a manager’s queue at their own branch, named or not', async () => {
      const { service, controller } = setup();

      await controller.resolveQueue({ items }, manager);

      expect(service.resolveQueue).toHaveBeenCalledWith({ items }, 'branch-a');
    });

    it('refuses a manager naming another branch, before resolving', async () => {
      const { service, controller } = setup();

      await expect(
        controller.resolveQueue({ branchId: 'branch-b', items }, manager),
      ).rejects.toEqual(wrongBranch);
      expect(service.resolveQueue).not.toHaveBeenCalled();
    });
  });

  it('passes the product search straight through: products are not branch-specific', async () => {
    const { service, controller } = setup();

    await controller.searchProducts({ search: 'cable' });

    expect(service.searchProducts).toHaveBeenCalledWith({ search: 'cable' });
  });
});
