import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../users/enums/user-role.enum';

/**
 * Branch scoping for reads (Phase 2 P2-1).
 *
 * Admins may read any branch. Managers and cashiers read only their own
 * branch: leaving branchId out means their branch, sending their own is
 * fine, and sending another is 403 WRONG_BRANCH (never silently replaced).
 * A staff user with no branch is refused too; CHK_users_branch_role
 * prevents it, but a missing branch must never widen the scope.
 *
 * The actor is the session user (request.user), which JwtStrategy re-reads
 * from the database on every request; only a branchId the client sends is
 * untrusted.
 */
export interface BranchActor {
  role: UserRole;
  branch_id: string | null;
}

const wrongBranch = (): ForbiddenException =>
  new ForbiddenException({
    message: 'You can only access data for your own branch.',
    code: 'WRONG_BRANCH',
  });

/**
 * The branch a read may cover. Admin: the requested branch, or undefined
 * for every branch. Staff: their own branch; 403 for any other.
 */
export function scopeBranch(
  actor: BranchActor,
  requestedBranchId?: string,
): string | undefined {
  if (actor.role === UserRole.ADMIN) return requestedBranchId;
  if (!actor.branch_id) throw wrongBranch();
  if (
    requestedBranchId !== undefined &&
    requestedBranchId !== actor.branch_id
  ) {
    throw wrongBranch();
  }
  return actor.branch_id;
}

/** 403 WRONG_BRANCH unless the actor is an admin or at branchId. */
export function assertBranchAccess(actor: BranchActor, branchId: string): void {
  scopeBranch(actor, branchId);
}
