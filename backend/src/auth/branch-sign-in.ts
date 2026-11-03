import { UserRole } from '../users/enums/user-role.enum';

/** What the rule reads: the user's role and branch, as just loaded. */
export interface BranchSignInSubject {
  role: UserRole;
  branch?: { is_active: boolean } | null;
}

/**
 * Whether a user's branch lets them sign in (Phase 2 P2-5). Admins have no
 * branch and are never limited by one. A manager or cashier needs a branch
 * that is active: when it is deactivated they can't log in, their access
 * token stops working and they can't refresh; when it is reactivated they
 * can again. A staff user with no branch is refused, never treated as an
 * admin.
 *
 * Used by AuthService.validateUser (login), JwtStrategy.validate (every
 * request) and AuthService's refresh, always on the user and branch read
 * from the database for that call, never on the token's claims.
 */
export function branchAllowsSignIn(user: BranchSignInSubject): boolean {
  if (user.role === UserRole.ADMIN) return true;
  return user.branch?.is_active === true;
}
