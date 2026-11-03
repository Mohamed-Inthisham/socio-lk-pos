import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy, JwtPayload } from './jwt.strategy';
import { UsersService } from '../../users/users.service';
import { TypedConfigService } from '../../config/typed-config.service';
import { UserRole } from '../../users/enums/user-role.enum';

/**
 * JwtStrategy.validate runs on every protected request. It re-reads the
 * user, with their branch, from the database: an inactive user, or a
 * manager or cashier whose branch is inactive or missing (Phase 2 P2-5),
 * is refused with 401; an admin, who has no branch, is not. The token's
 * role and branch_id are never what decides.
 */
describe('JwtStrategy.validate', () => {
  const activeBranch = { id: 'branch-1', name: 'Main Shop', is_active: true };
  const inactiveBranch = { ...activeBranch, is_active: false };

  const setup = (dbUser: unknown) => {
    const usersService = { findById: jest.fn().mockResolvedValue(dbUser) };
    const config = { get: jest.fn().mockReturnValue('test-access-secret') };
    const strategy = new JwtStrategy(
      config as unknown as TypedConfigService,
      usersService as unknown as UsersService,
    );
    return { strategy, usersService };
  };

  const dbUser = (overrides: Record<string, unknown>) => ({
    id: 'user-1',
    email: 'staff@shop.test',
    full_name: 'Asha Perera',
    role: UserRole.CASHIER,
    is_active: true,
    branch_id: 'branch-1',
    branch: activeBranch,
    approval_pin_set_at: null,
    ...overrides,
  });

  const payload = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
    sub: 'user-1',
    role: UserRole.CASHIER,
    branch_id: 'branch-1',
    ...overrides,
  });

  it.each([UserRole.MANAGER, UserRole.CASHIER])(
    'accepts a %s at an active branch, with the branch from the database',
    async (role) => {
      const { strategy, usersService } = setup(dbUser({ role }));

      const user = await strategy.validate(payload({ role }));

      expect(usersService.findById).toHaveBeenCalledWith('user-1');
      expect(user).toMatchObject({ id: 'user-1', role, branch: activeBranch });
    },
  );

  it.each([UserRole.MANAGER, UserRole.CASHIER])(
    'refuses a %s whose branch is inactive (401)',
    async (role) => {
      const { strategy } = setup(dbUser({ role, branch: inactiveBranch }));

      await expect(strategy.validate(payload({ role }))).rejects.toThrow(
        UnauthorizedException,
      );
    },
  );

  it('refuses a staff user with no branch (401), never treating them as an admin', async () => {
    const { strategy } = setup(dbUser({ branch: null }));

    await expect(strategy.validate(payload())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts an admin without a branch', async () => {
    const { strategy } = setup(
      dbUser({ role: UserRole.ADMIN, branch_id: null, branch: null }),
    );

    await expect(
      strategy.validate(payload({ role: UserRole.ADMIN, branch_id: null })),
    ).resolves.toMatchObject({ role: UserRole.ADMIN, branch: null });
  });

  it('still refuses an inactive user, and a user who no longer exists', async () => {
    await expect(
      setup(dbUser({ is_active: false })).strategy.validate(payload()),
    ).rejects.toThrow(UnauthorizedException);
    await expect(setup(null).strategy.validate(payload())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('decides on the database’s role and branch, not the token’s', async () => {
    // A token still saying admin, for a user who is now a cashier at an
    // inactive branch: refused.
    const demoted = setup(dbUser({ branch: inactiveBranch }));
    await expect(
      demoted.strategy.validate(
        payload({ role: UserRole.ADMIN, branch_id: null }),
      ),
    ).rejects.toThrow(UnauthorizedException);

    // A token naming another branch, for a cashier whose branch is active:
    // accepted, with the database's branch.
    const moved = setup(dbUser({}));
    await expect(
      moved.strategy.validate(payload({ branch_id: 'branch-old' })),
    ).resolves.toMatchObject({ branch_id: 'branch-1', branch: activeBranch });
  });
});
