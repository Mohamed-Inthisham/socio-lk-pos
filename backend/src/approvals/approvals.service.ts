import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import {
  AuditActor,
  writeAuditEntry,
} from '../audit-log/utils/write-audit-entry';
import { TypedConfigService } from '../config/typed-config.service';
import { formatColomboTime } from '../common/utils/colombo-time';
import { isWeakPin } from './weak-pin';
import { SetApprovalPinDto } from './dto/set-approval-pin.dto';

/** Wrong PINs in a row before the PIN locks (P6-19). */
export const MAX_PIN_ATTEMPTS = 5;
/** How long the lock lasts; applied with the DB clock (P6-19). */
export const PIN_LOCK_INTERVAL = '15 minutes';

/** The session user asking for an approval or changing a PIN. */
export interface ApprovalCaller extends AuditActor {
  role: UserRole;
  branch_id: string | null;
}

/** The approver a successful check returns. */
export interface Approver {
  id: string;
  full_name: string;
  role: UserRole;
}

export interface VerifyApprovalInput {
  approverId: string;
  pin: string;
  /** What is being approved, e.g. 'SALE_VOID' (P7: returns). Audited. */
  action: string;
  /** The branch the approved action belongs to. */
  branchId: string;
  requestedBy: ApprovalCaller;
  ip?: string | null;
}

/**
 * Refusal codes in error bodies, for the till to word (P6-19). Every body
 * is { message, code } plus attempts_left or locked_until; never the PIN.
 */
export type ApprovalErrorCode =
  | 'APPROVER_NOT_FOUND'
  | 'APPROVER_INACTIVE'
  | 'APPROVER_NOT_MANAGER'
  | 'APPROVER_WRONG_BRANCH'
  | 'APPROVER_NO_PIN'
  | 'WRONG_PIN'
  | 'PIN_LOCKED'
  | 'WRONG_PASSWORD';

type CheckOutcome =
  | { ok: true; approver: Approver }
  | { ok: false; error: HttpException };

/** The approver's row, read under FOR UPDATE with the DB's verdict on the lock. */
interface LockedApproverRow {
  id: string;
  full_name: string;
  role: UserRole;
  branch_id: string | null;
  is_active: boolean;
  deleted_at: Date | null;
  approval_pin_hash: string | null;
  approval_pin_failed_attempts: number;
  approval_pin_locked_until: Date | null;
  locked: boolean | null;
  lock_expired: boolean | null;
}

/**
 * The rows of an `UPDATE … RETURNING` run through manager.query(): the
 * Postgres driver returns them as `[rows, affectedCount]`.
 */
const returnedRows = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0])
    ? result[0]
    : result) as T[];

/**
 * Manager approval PIN (Phase 6.4 P6-15 – P6-21): checking one, setting
 * your own, an admin clearing one, and the approver list. Shared by every
 * action that needs a manager's approval (sale void now, returns in P7).
 *
 * The check runs in its OWN transaction, committed before the approved
 * action's transaction opens, so a wrong PIN's count and lock can never
 * be rolled back by the action failing. Inside it the approver's row is
 * locked (SELECT … FOR UPDATE), so guesses sent at the same moment queue
 * and each sees the count the one before left. Lock times come from the
 * database clock on both sides: now() + interval when setting, compared
 * with now() in the same locked SELECT.
 *
 * The PIN, its hash and passwords are never logged, audited or echoed.
 */
@Injectable()
export class ApprovalsService {
  private readonly bcryptRounds: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    config: TypedConfigService,
  ) {
    this.bcryptRounds = config.get('BCRYPT_ROUNDS');
  }

  /**
   * Check an approver's PIN for an action at a branch. Returns the
   * approver, or throws 403 (wrong PIN, approver refused) / 423 (locked).
   *
   * Order: the approver must exist, be active, be an admin or a manager
   * (a manager of `branchId`), and have a PIN. A locked PIN is refused
   * with 423 without comparing. A lock that has expired starts the count
   * again from 0. Then the compare: a correct PIN resets the count to 0;
   * a wrong one adds 1 (403 with attempts_left), and the 5th in a row
   * locks the PIN for 15 minutes (423 with locked_until).
   */
  async verify(input: VerifyApprovalInput): Promise<Approver> {
    const outcome = await this.dataSource.transaction((manager) =>
      this.checkPin(manager, input),
    );
    if (!outcome.ok) throw outcome.error;
    return outcome.approver;
  }

  /**
   * The check itself, inside verify()'s own transaction. Returns refusals
   * instead of throwing them, so the transaction commits the count, the
   * lock and their audit rows; verify() throws after the commit.
   */
  private async checkPin(
    manager: EntityManager,
    input: VerifyApprovalInput,
  ): Promise<CheckOutcome> {
    const rows: LockedApproverRow[] = await manager.query(
      `SELECT id, full_name, role, branch_id, is_active, deleted_at,
              approval_pin_hash, approval_pin_failed_attempts,
              approval_pin_locked_until,
              approval_pin_locked_until > now()  AS locked,
              approval_pin_locked_until <= now() AS lock_expired
         FROM users
        WHERE id = $1
          FOR UPDATE`,
      [input.approverId],
    );
    const row = rows[0];

    const refuse = (code: ApprovalErrorCode, message: string) =>
      ({
        ok: false,
        error: new ForbiddenException({ message, code }),
      }) as const;

    if (!row || row.deleted_at) {
      return refuse(
        'APPROVER_NOT_FOUND',
        'Approval failed: approver not found.',
      );
    }
    const name = row.full_name;
    if (!row.is_active) {
      return refuse(
        'APPROVER_INACTIVE',
        `${name} can't approve: their account is inactive.`,
      );
    }
    if (row.role !== UserRole.ADMIN && row.role !== UserRole.MANAGER) {
      return refuse(
        'APPROVER_NOT_MANAGER',
        `${name} can't approve: only managers and admins can.`,
      );
    }
    if (row.role === UserRole.MANAGER && row.branch_id !== input.branchId) {
      return refuse(
        'APPROVER_WRONG_BRANCH',
        `${name} can only approve for their own branch.`,
      );
    }
    if (!row.approval_pin_hash) {
      return refuse('APPROVER_NO_PIN', `${name} has no approval PIN set.`);
    }

    // Locked: refuse without comparing, so guessing stops during the lock.
    if (row.locked) {
      return {
        ok: false,
        error: this.lockedError(name, row.approval_pin_locked_until!),
      };
    }
    // An expired lock starts the count again from 0.
    const attemptsSoFar = row.lock_expired
      ? 0
      : row.approval_pin_failed_attempts;

    const matches = await bcrypt.compare(input.pin, row.approval_pin_hash);

    if (matches) {
      await manager.query(
        `UPDATE users
            SET approval_pin_failed_attempts = 0,
                approval_pin_locked_until = NULL
          WHERE id = $1`,
        [row.id],
      );
      return {
        ok: true,
        approver: { id: row.id, full_name: row.full_name, role: row.role },
      };
    }

    const attempts = attemptsSoFar + 1;
    const audit = (action: AuditAction, description: string) =>
      writeAuditEntry(manager, {
        actor: input.requestedBy,
        action,
        entityType: 'User',
        entityId: row.id,
        description,
        ip: input.ip,
      });

    if (attempts >= MAX_PIN_ATTEMPTS) {
      const locked: unknown = await manager.query(
        `UPDATE users
            SET approval_pin_failed_attempts = $2,
                approval_pin_locked_until = now() + $3::interval
          WHERE id = $1
        RETURNING approval_pin_locked_until`,
        [row.id, attempts, PIN_LOCK_INTERVAL],
      );
      const until = returnedRows<{ approval_pin_locked_until: Date }>(locked)[0]
        .approval_pin_locked_until;
      await audit(
        AuditAction.APPROVAL_PIN_FAILED,
        `Wrong approval PIN for ${input.action} (attempt ${attempts} of ${MAX_PIN_ATTEMPTS}).`,
      );
      await audit(
        AuditAction.APPROVAL_PIN_LOCKED,
        `Approval PIN locked until ${until.toISOString()} after ${MAX_PIN_ATTEMPTS} wrong PINs in a row.`,
      );
      return {
        ok: false,
        error: this.lockedError(name, until, 'Wrong PIN. '),
      };
    }

    await manager.query(
      `UPDATE users
          SET approval_pin_failed_attempts = $2,
              approval_pin_locked_until = NULL
        WHERE id = $1`,
      [row.id, attempts],
    );
    const attemptsLeft = MAX_PIN_ATTEMPTS - attempts;
    await audit(
      AuditAction.APPROVAL_PIN_FAILED,
      `Wrong approval PIN for ${input.action} (attempt ${attempts} of ${MAX_PIN_ATTEMPTS}).`,
    );
    return {
      ok: false,
      error: new ForbiddenException({
        message: `Wrong PIN. ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`,
        code: 'WRONG_PIN' satisfies ApprovalErrorCode,
        attempts_left: attemptsLeft,
      }),
    };
  }

  private lockedError(name: string, until: Date, prefix = ''): HttpException {
    return new HttpException(
      {
        message: `${prefix}${name}'s PIN is locked until ${formatColomboTime(until)}.`,
        code: 'PIN_LOCKED' satisfies ApprovalErrorCode,
        locked_until: until.toISOString(),
      },
      HttpStatus.LOCKED,
    );
  }

  /**
   * PUT /auth/me/approval-pin: an admin or manager sets their own PIN
   * (P6-18). The current password proves it's them; a wrong one is 403
   * and audited. Setting resets the count and the lock.
   */
  async setOwnPin(
    caller: ApprovalCaller,
    dto: SetApprovalPinDto,
    ip?: string | null,
  ): Promise<{ has_approval_pin: true; approval_pin_set_at: Date }> {
    if (caller.role !== UserRole.ADMIN && caller.role !== UserRole.MANAGER) {
      throw new ForbiddenException(
        'Only managers and admins can set an approval PIN.',
      );
    }
    if (isWeakPin(dto.pin)) {
      throw new BadRequestException(
        'That PIN is too easy to guess: avoid one repeated digit and ' +
          'straight runs like 123456 or 654321.',
      );
    }

    const outcome = await this.dataSource.transaction(async (manager) => {
      const user = await manager
        .createQueryBuilder(User, 'user')
        .setLock('pessimistic_write')
        .addSelect('user.password_hash')
        .where('user.id = :id', { id: caller.id })
        .getOne();
      if (!user) {
        return {
          ok: false as const,
          error: new NotFoundException('User not found'),
        };
      }

      const passwordOk = await bcrypt.compare(
        dto.current_password,
        user.password_hash,
      );
      if (!passwordOk) {
        await writeAuditEntry(manager, {
          actor: caller,
          action: AuditAction.APPROVAL_PIN_SET_REJECTED,
          entityType: 'User',
          entityId: caller.id,
          description: 'Approval PIN not set: current password was wrong.',
          ip,
        });
        return {
          ok: false as const,
          error: new ForbiddenException({
            message: 'Current password is incorrect.',
            code: 'WRONG_PASSWORD' satisfies ApprovalErrorCode,
          }),
        };
      }

      const hash = await bcrypt.hash(dto.pin, this.bcryptRounds);
      const saved: unknown = await manager.query(
        `UPDATE users
            SET approval_pin_hash = $2,
                approval_pin_set_at = now(),
                approval_pin_failed_attempts = 0,
                approval_pin_locked_until = NULL
          WHERE id = $1
        RETURNING approval_pin_set_at`,
        [caller.id, hash],
      );
      const setAt = returnedRows<{ approval_pin_set_at: Date }>(saved)[0]
        .approval_pin_set_at;
      await writeAuditEntry(manager, {
        actor: caller,
        action: AuditAction.APPROVAL_PIN_SET,
        entityType: 'User',
        entityId: caller.id,
        description: 'Approval PIN set.',
        changes: {
          approval_pin_set_at: { old: user.approval_pin_set_at, new: setAt },
        },
        ip,
      });
      return { ok: true as const, setAt };
    });

    if (!outcome.ok) throw outcome.error;
    return { has_approval_pin: true, approval_pin_set_at: outcome.setAt };
  }

  /**
   * DELETE /users/:id/approval-pin: an admin clears anyone's PIN, with its
   * count and lock (P6-18). Clearing an unset PIN is still 204 and still
   * audited. There is no way to set someone else's PIN.
   */
  async clearPin(
    caller: ApprovalCaller,
    userId: string,
    ip?: string | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const target = await manager
        .createQueryBuilder(User, 'user')
        .setLock('pessimistic_write')
        .withDeleted()
        .where('user.id = :id', { id: userId })
        .getOne();
      if (!target) {
        throw new NotFoundException('User not found');
      }

      await manager.query(
        `UPDATE users
            SET approval_pin_hash = NULL,
                approval_pin_set_at = NULL,
                approval_pin_failed_attempts = 0,
                approval_pin_locked_until = NULL
          WHERE id = $1`,
        [userId],
      );
      await writeAuditEntry(manager, {
        actor: caller,
        action: AuditAction.APPROVAL_PIN_CLEARED,
        entityType: 'User',
        entityId: userId,
        description: target.approval_pin_set_at
          ? `Approval PIN of ${target.full_name} cleared.`
          : `Approval PIN of ${target.full_name} cleared (none was set).`,
        changes: {
          approval_pin_set_at: { old: target.approval_pin_set_at, new: null },
        },
        ip,
      });
    });
  }

  /**
   * GET /approvers?branchId=: who can approve at a branch (P6-16). Only
   * { id, full_name }: active admins, and active managers of that branch,
   * who have a PIN set. Non-admins may ask only for their own branch.
   */
  async listApprovers(
    caller: ApprovalCaller,
    branchId: string,
  ): Promise<{ id: string; full_name: string }[]> {
    if (caller.role !== UserRole.ADMIN && caller.branch_id !== branchId) {
      throw new ForbiddenException(
        'You can only list approvers for your own branch.',
      );
    }
    return this.usersRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.full_name'])
      .where('user.is_active = true')
      .andWhere('user.approval_pin_hash IS NOT NULL')
      .andWhere(
        `(user.role = :admin OR (user.role = :manager AND user.branch_id = :branchId))`,
        { admin: UserRole.ADMIN, manager: UserRole.MANAGER, branchId },
      )
      .orderBy('user.full_name', 'ASC')
      .getMany()
      .then((users) => users.map(({ id, full_name }) => ({ id, full_name })));
  }
}
