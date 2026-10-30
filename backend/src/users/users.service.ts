import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  IsNull,
  Repository,
} from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { UserRole } from './enums/user-role.enum';
import { Branch } from '../branches/entities/branch.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { TypedConfigService } from '../config/typed-config.service';
import { assertBcryptPasswordLength } from '../common/bcrypt-input';
import {
  PaginatedResponse,
  paginate,
} from '../common/dto/paginated-response.dto';
import {
  AuditActor,
  writeAuditEntry,
} from '../audit-log/utils/write-audit-entry';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

/** User fields never returned to a client. */
type SecretUserField =
  | 'password_hash'
  | 'approval_pin_hash'
  | 'approval_pin_failed_attempts'
  | 'approval_pin_locked_until';

/** A user safe to return: no password hash, no approval PIN hash, count or lock. */
export type SafeUser = Omit<User, SecretUserField>;

/**
 * Strip the secret fields. The result is a plain object, which the global
 * ClassSerializerInterceptor doesn't process, so the entity's @Exclude
 * doesn't apply to it: every field to hide is dropped here (Phase 6.4
 * P6-15 added the approval PIN's).
 */
function toSafeUser(user: User): SafeUser {
  const {
    password_hash: _passwordHash,
    approval_pin_hash: _pinHash,
    approval_pin_failed_attempts: _pinAttempts,
    approval_pin_locked_until: _pinLockedUntil,
    ...safeUser
  } = user;
  return safeUser;
}

/**
 * Revoke every unrevoked refresh token of a user, inside the caller's
 * transaction. The same predicate as AuthService's reuse revocation, so a
 * token already revoked keeps its original revoked_at. Used when a user
 * stops being able to log in (deactivate, softDelete); a future
 * reactivation flow must call it too.
 *
 * A refresh racing with this can commit a replacement token after it ran;
 * that token is unusable while the user is inactive or deleted (refresh and
 * every request check the user), so only reactivation would revive it;
 * reactivate() revokes again for exactly that reason.
 */
async function revokeRefreshTokens(
  manager: EntityManager,
  userId: string,
): Promise<void> {
  await manager.update(
    RefreshToken,
    { user_id: userId, revoked_at: IsNull() },
    { revoked_at: new Date() },
  );
}

/** A user row locked FOR UPDATE in the caller's transaction (not deleted). */
function lockUser(manager: EntityManager, id: string): Promise<User | null> {
  return manager
    .createQueryBuilder(User, 'user')
    .setLock('pessimistic_write')
    .where('user.id = :id', { id })
    .getOne();
}

/**
 * Lock every active admin, always in id order. Two admins deactivating
 * each other at once both lock the same rows first, so the second waits,
 * then sees the first's change and finds itself the last admin.
 */
function lockActiveAdmins(manager: EntityManager): Promise<User[]> {
  return manager
    .createQueryBuilder(User, 'user')
    .setLock('pessimistic_write')
    .where('user.role = :role', { role: UserRole.ADMIN })
    .andWhere('user.is_active = true')
    .orderBy('user.id', 'ASC')
    .getMany();
}

@Injectable()
export class UsersService {
  private readonly bcryptRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Branch)
    private readonly branchesRepository: Repository<Branch>,
    config: TypedConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    this.bcryptRounds = config.get('BCRYPT_ROUNDS');
  }

  /**
   * Find a user by email — INCLUDES password_hash.
   * Used by AuthService during login. Do not expose externally.
   *
   * password_hash is `select: false` on the entity, so it has to be
   * opted back in explicitly here — this is the only read that needs it.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  /**
   * Find a user by id — no password_hash, no relations.
   * Used internally by AuthService for token generation flows
   * (needs id, role, branch_id, is_active).
   */
  async findByIdForAuth(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  /**
   * Find a user by id — EXCLUDES password_hash and the approval PIN's
   * hash, count and lock (toSafeUser).
   * Safe to return to clients. Includes nested branch (may be null for admins).
   */
  async findById(id: string): Promise<SafeUser | null> {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: { branch: true },
    });
    if (!user) return null;
    return toSafeUser(user);
  }

  /**
   * GET /users: a page of users with their branch, by name. Each row goes
   * through toSafeUser, like findById. Soft-deleted users are left out.
   */
  async findAll(
    query: ListUsersQueryDto,
  ): Promise<PaginatedResponse<SafeUser>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.branch', 'branch');

    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('user.full_name ILIKE :pattern', { pattern })
            .orWhere('user.email ILIKE :pattern', { pattern });
        }),
      );
    }
    if (query.role) {
      qb.andWhere('user.role = :role', { role: query.role });
    }
    if (query.branchId) {
      qb.andWhere('user.branch_id = :branchId', { branchId: query.branchId });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('user.is_active = :isActive', { isActive: query.isActive });
    }

    qb.orderBy('user.full_name', 'ASC')
      .addOrderBy('user.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return paginate(rows.map(toSafeUser), total, page, limit);
  }

  /**
   * Create a new user. Hashes password, enforces email uniqueness,
   * enforces the branch/role invariant (admin: no branch; staff: required).
   * The insert and its CREATE audit row commit together.
   */
  async create(
    dto: CreateUserDto,
    actor: AuditActor,
    ip?: string | null,
  ): Promise<SafeUser> {
    const normalizedEmail = dto.email.toLowerCase();

    const existing = await this.usersRepository.findOne({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    // Resolve effective role: DTO omits → entity default (CASHIER).
    const effectiveRole = dto.role ?? UserRole.CASHIER;

    // Enforce branch/role invariant BEFORE hashing the password —
    // no point burning bcrypt CPU on a payload we're about to reject.
    const resolvedBranchId = await this.resolveBranchForRole(
      effectiveRole,
      dto.branch_id,
    );

    // Also enforced by CreateUserDto; repeated here for callers that skip
    // the HTTP ValidationPipe, since bcrypt would silently truncate.
    assertBcryptPasswordLength(dto.password);
    const password_hash = await bcrypt.hash(dto.password, this.bcryptRounds);

    const user = this.usersRepository.create({
      email: normalizedEmail,
      password_hash,
      full_name: dto.full_name,
      role: dto.role, // undefined → entity default ('cashier')
      branch_id: resolvedBranchId,
    });

    const saved = await this.dataSource.transaction(async (manager) => {
      let created: User;
      try {
        created = await manager.save(user);
      } catch (error) {
        // The same email registered between the check above and here.
        const detail = error as { code?: string; constraint?: string };
        if (
          detail.code === '23505' &&
          detail.constraint === 'idx_users_email'
        ) {
          throw new ConflictException('Email is already registered');
        }
        throw error;
      }
      await writeAuditEntry(manager, {
        actor,
        action: AuditAction.CREATE,
        entityType: 'User',
        entityId: created.id,
        description: `User ${created.full_name} created as ${created.role}.`,
        changes: {
          email: { old: null, new: created.email },
          full_name: { old: null, new: created.full_name },
          role: { old: null, new: created.role },
          branch_id: { old: null, new: created.branch_id },
        },
        ip,
      });
      return created;
    });
    return toSafeUser(saved);
  }

  /**
   * Partial update. Password is not updatable here (and there is no
   * password-change endpoint yet — see FOLLOWUPS.md).
   * Role is not changed here (the DTO omits it): changeRole() does that.
   * Branch transfers are allowed for staff; admins cannot be given a branch.
   */
  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.email) {
      const normalized = dto.email.toLowerCase();
      if (normalized !== user.email) {
        const clash = await this.usersRepository.findOne({
          where: { email: normalized },
        });
        if (clash) {
          throw new ConflictException('Email is already registered');
        }
        user.email = normalized;
      }
    }
    if (dto.full_name !== undefined) user.full_name = dto.full_name;

    if (dto.branch_id !== undefined) {
      if (user.role === UserRole.ADMIN) {
        throw new BadRequestException(
          'Admin users cannot be assigned to a branch',
        );
      }
      await this.assertActiveBranch(dto.branch_id);
      user.branch_id = dto.branch_id;
    }

    const saved = await this.usersRepository.save(user);
    return toSafeUser(saved);
  }

  /**
   * PATCH /users/:id/role: set a user's role and branch together, with the
   * same branch rule as create (admin: none; staff: an active branch). Also
   * moves a staff user to another branch with the same role.
   *
   * - Refused (400) for the caller's own account and for the last active
   *   admin, under the same locks as deactivate().
   * - Becoming a cashier clears the approval PIN, its count and lock in
   *   the same UPDATE (CHK_users_approval_pin_role). Admin ↔ manager keeps
   *   the PIN.
   * - Any change revokes the user's refresh tokens, so their next refresh
   *   sends them to log in again and their app reloads the new role and
   *   branch. Access tokens need nothing: every request re-reads the user.
   * - The update, the revocation and the ROLE_CHANGED audit row commit
   *   together. Asking for the current role and branch changes nothing.
   */
  async changeRole(
    id: string,
    dto: ChangeRoleDto,
    actor: AuditActor,
    ip?: string | null,
  ): Promise<void> {
    if (id === actor.id) {
      throw new BadRequestException({
        message: 'You cannot change your own role.',
        code: 'CANNOT_CHANGE_OWN_ROLE',
      });
    }
    // null and omitted mean the same thing: no branch.
    const branchId = await this.resolveBranchForRole(
      dto.role,
      dto.branch_id ?? undefined,
    );

    await this.dataSource.transaction(async (manager) => {
      // Admins first, then the target: the lock order deactivate() uses.
      const activeAdmins = await lockActiveAdmins(manager);
      const target = await lockUser(manager, id);
      if (!target) {
        throw new NotFoundException('User not found');
      }
      if (target.role === dto.role && target.branch_id === branchId) return;

      if (
        target.role === UserRole.ADMIN &&
        dto.role !== UserRole.ADMIN &&
        target.is_active &&
        activeAdmins.length <= 1
      ) {
        throw new BadRequestException({
          message:
            'Cannot change the role of the last active admin. At least one active admin must exist.',
          code: 'LAST_ACTIVE_ADMIN',
        });
      }

      const clearPin =
        dto.role === UserRole.CASHIER && target.approval_pin_set_at !== null;
      await manager.update(User, id, {
        role: dto.role,
        branch_id: branchId,
        // Cleared even without a set time: no leftover count or lock either.
        ...(dto.role === UserRole.CASHIER && {
          approval_pin_hash: null,
          approval_pin_set_at: null,
          approval_pin_failed_attempts: 0,
          approval_pin_locked_until: null,
        }),
      });
      await revokeRefreshTokens(manager, id);

      const changes: Record<string, { old: unknown; new: unknown }> = {
        role: { old: target.role, new: dto.role },
        branch_id: { old: target.branch_id, new: branchId },
      };
      if (clearPin) {
        changes.approval_pin_set_at = {
          old: target.approval_pin_set_at,
          new: null,
        };
      }
      await writeAuditEntry(manager, {
        actor,
        action: AuditAction.ROLE_CHANGED,
        entityType: 'User',
        entityId: id,
        description:
          target.role === dto.role
            ? `${target.full_name} moved to another branch as ${dto.role}.`
            : `Role of ${target.full_name} changed from ${target.role} to ${dto.role}.` +
              (clearPin ? ' Approval PIN cleared.' : ''),
        changes,
        ip,
      });
    });
  }

  /**
   * Deactivate a user — they keep existing but cannot log in.
   * This is the everyday "remove user" operation in a POS.
   *
   * Also clears their approval PIN, its count and lock (Phase 6.4 P6-15):
   * an inactive user never approves anything.
   *
   * Revokes the user's refresh tokens in the same transaction, so a later
   * reactivation can't bring old sessions back; reactivate() revokes them
   * again too (see revokeRefreshTokens).
   *
   * Refused (400) for the caller's own account and for the last active
   * admin. Repeating it on an inactive user clears and revokes again but
   * writes no second DEACTIVATE audit row.
   */
  async deactivate(
    id: string,
    actor: AuditActor,
    ip?: string | null,
  ): Promise<void> {
    if (id === actor.id) {
      throw new BadRequestException({
        message: 'You cannot deactivate your own account.',
        code: 'CANNOT_DEACTIVATE_SELF',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      // Admins first, then the target: one lock order for every call.
      const activeAdmins = await lockActiveAdmins(manager);
      const target = await lockUser(manager, id);
      if (!target) {
        throw new NotFoundException('User not found');
      }
      if (
        target.role === UserRole.ADMIN &&
        target.is_active &&
        activeAdmins.length <= 1
      ) {
        throw new BadRequestException({
          message:
            'Cannot deactivate the last active admin. At least one active admin must exist.',
          code: 'LAST_ACTIVE_ADMIN',
        });
      }

      await manager.update(User, id, {
        is_active: false,
        approval_pin_hash: null,
        approval_pin_set_at: null,
        approval_pin_failed_attempts: 0,
        approval_pin_locked_until: null,
      });
      await revokeRefreshTokens(manager, id);

      if (target.is_active) {
        await writeAuditEntry(manager, {
          actor,
          action: AuditAction.DEACTIVATE,
          entityType: 'User',
          entityId: id,
          description: `User ${target.full_name} deactivated.`,
          changes: { is_active: { old: true, new: false } },
          ip,
        });
      }
    });
  }

  /**
   * Let a deactivated user log in again, keeping their role and branch.
   * A staff user's branch must still be active (400 otherwise, as on
   * create and transfer). Revokes their refresh tokens again in the same
   * transaction, so no session from before the deactivation, nor one a
   * racing refresh committed, comes back. The approval PIN stays cleared;
   * a manager sets a new one. An already active user is left alone.
   */
  async reactivate(
    id: string,
    actor: AuditActor,
    ip?: string | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const target = await lockUser(manager, id);
      if (!target) {
        throw new NotFoundException('User not found');
      }
      if (target.is_active) return;

      if (target.branch_id) {
        await this.assertActiveBranch(target.branch_id);
      }

      await revokeRefreshTokens(manager, id);
      await manager.update(User, id, { is_active: true });
      await writeAuditEntry(manager, {
        actor,
        action: AuditAction.REACTIVATE,
        entityType: 'User',
        entityId: id,
        description: `User ${target.full_name} reactivated.`,
        changes: { is_active: { old: false, new: true } },
        ip,
      });
    });
  }

  /**
   * Soft-delete — sets deleted_at. Subsequent queries exclude this user.
   * Use sparingly; prefer deactivate() for normal POS user lifecycle.
   * Revokes the user's refresh tokens in the same transaction.
   */
  async softDelete(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.softDelete(User, id);
      if (result.affected === 0) {
        throw new NotFoundException('User not found');
      }
      await revokeRefreshTokens(manager, id);
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Enforce the User ↔ Branch invariant on creation:
   *   - admin        → branch_id MUST be absent
   *   - manager/cashier → branch_id MUST be present AND point to an active branch
   * Returns the resolved branch_id (null for admin, UUID for staff).
   *
   * This mirrors the DB-level CHK_users_branch_role constraint but produces
   * a clean 400 with a helpful message instead of a raw Postgres error.
   */
  private async resolveBranchForRole(
    role: UserRole,
    providedBranchId: string | undefined,
  ): Promise<string | null> {
    if (role === UserRole.ADMIN) {
      if (providedBranchId !== undefined) {
        throw new BadRequestException(
          'Admin users cannot be assigned to a branch',
        );
      }
      return null;
    }

    if (!providedBranchId) {
      throw new BadRequestException(
        `${role} users must be assigned to a branch (branch_id is required)`,
      );
    }

    await this.assertActiveBranch(providedBranchId);
    return providedBranchId;
  }

  /**
   * Confirms a branch exists AND is currently active. Produces a clean 400
   * instead of letting Postgres throw an FK error at insert time.
   *
   * A null id is refused first: TypeORM drops a null where-value, so the
   * findOne below would otherwise load an arbitrary branch.
   */
  private async assertActiveBranch(branchId: string): Promise<void> {
    if (!branchId) {
      throw new BadRequestException('branch_id must not be null');
    }
    const branch = await this.branchesRepository.findOne({
      where: { id: branchId },
    });
    if (!branch) {
      throw new BadRequestException(`Branch ${branchId} does not exist`);
    }
    if (!branch.is_active) {
      throw new BadRequestException(`Branch "${branch.name}" is not active`);
    }
  }
}
