import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ApprovalsService, VerifyApprovalInput } from './approvals.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { TypedConfigService } from '../config/typed-config.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const PIN = '482916';

describe('ApprovalsService (Phase 6.4 P6-15 – P6-21)', () => {
  let service: ApprovalsService;

  const mockAuditRepo = { save: jest.fn() };
  const mockQb = {
    setLock: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    withDeleted: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getMany: jest.fn(),
  };
  const mockManager = {
    query: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQb),
    getRepository: jest.fn(() => mockAuditRepo),
  };
  const mockDataSource = {
    transaction: jest.fn((cb: (m: typeof mockManager) => unknown) =>
      cb(mockManager),
    ),
  };
  const mockUsersRepo = { createQueryBuilder: jest.fn(() => mockQb) };
  const mockConfig = { get: jest.fn(() => 4) };

  const cashier = {
    id: 'cashier-1',
    full_name: 'Till Cashier',
    role: UserRole.CASHIER,
    branch_id: 'branch-1',
  };
  const input = (
    over: Partial<VerifyApprovalInput> = {},
  ): VerifyApprovalInput => ({
    approverId: 'manager-1',
    pin: PIN,
    action: 'SALE_VOID',
    branchId: 'branch-1',
    requestedBy: cashier,
    ip: '10.0.0.5',
    ...over,
  });
  /** The approver row as the locked SELECT returns it. */
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'manager-1',
    full_name: 'Shop Manager',
    role: UserRole.MANAGER,
    branch_id: 'branch-1',
    is_active: true,
    deleted_at: null,
    approval_pin_hash: '$2b$04$hash',
    approval_pin_failed_attempts: 0,
    approval_pin_locked_until: null,
    locked: null,
    lock_expired: null,
    ...over,
  });

  const compare = bcrypt.compare as unknown as jest.Mock;
  const hash = bcrypt.hash as unknown as jest.Mock;

  /** The locked SELECT returns `r`; every later query (UPDATEs) returns `rest`. */
  const arrange = (r: unknown, ...rest: unknown[]) => {
    mockManager.query.mockReset();
    mockManager.query.mockResolvedValueOnce(r ? [r] : []);
    for (const value of rest) mockManager.query.mockResolvedValueOnce(value);
    mockManager.query.mockResolvedValue([]);
  };

  const errorOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as HttpException;
    }
    throw new Error('expected a refusal');
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.values(mockQb).forEach((fn) => {
      if (
        'mockReturnThis' in fn &&
        fn !== mockQb.getOne &&
        fn !== mockQb.getMany
      ) {
        fn.mockReturnThis();
      }
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        { provide: TypedConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(ApprovalsService);
  });

  describe('verify', () => {
    it('locks the approver row and reads the lock against the DB clock in the same query', async () => {
      arrange(row());
      compare.mockResolvedValue(true);

      await service.verify(input());

      const [sql, params] = mockManager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toMatch(/FOR UPDATE/);
      expect(sql).toMatch(/approval_pin_locked_until > now\(\)\s+AS locked/);
      expect(sql).toMatch(
        /approval_pin_locked_until <= now\(\) AS lock_expired/,
      );
      expect(params).toEqual(['manager-1']);
      // In its own transaction, not the caller's
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('returns the approver and resets the count to 0 on a correct PIN', async () => {
      arrange(row({ approval_pin_failed_attempts: 3 }));
      compare.mockResolvedValue(true);

      await expect(service.verify(input())).resolves.toEqual({
        id: 'manager-1',
        full_name: 'Shop Manager',
        role: UserRole.MANAGER,
      });
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringMatching(
          /SET approval_pin_failed_attempts = 0,\s+approval_pin_locked_until = NULL/,
        ),
        ['manager-1'],
      );
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });

    it.each([
      [
        'unknown approver',
        null,
        'APPROVER_NOT_FOUND',
        'Approval failed: approver not found.',
      ],
      [
        'soft-deleted approver',
        row({ deleted_at: new Date() }),
        'APPROVER_NOT_FOUND',
        'Approval failed: approver not found.',
      ],
      [
        'inactive approver',
        row({ is_active: false }),
        'APPROVER_INACTIVE',
        "Shop Manager can't approve: their account is inactive.",
      ],
      [
        'cashier approver',
        row({ role: UserRole.CASHIER }),
        'APPROVER_NOT_MANAGER',
        "Shop Manager can't approve: only managers and admins can.",
      ],
      [
        'manager of another branch',
        row({ branch_id: 'branch-2' }),
        'APPROVER_WRONG_BRANCH',
        'Shop Manager can only approve for their own branch.',
      ],
      [
        'approver without a PIN',
        row({ approval_pin_hash: null }),
        'APPROVER_NO_PIN',
        'Shop Manager has no approval PIN set.',
      ],
    ])(
      'refuses a %s with 403 and does not compare',
      async (_case, r, code, message) => {
        arrange(r);

        const err = await errorOf(service.verify(input()));

        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.getResponse()).toEqual({ message, code });
        expect(compare).not.toHaveBeenCalled();
      },
    );

    it('lets an admin approve at any branch', async () => {
      arrange(row({ id: 'admin-1', role: UserRole.ADMIN, branch_id: null }));
      compare.mockResolvedValue(true);

      await expect(
        service.verify(input({ approverId: 'admin-1', branchId: 'branch-9' })),
      ).resolves.toMatchObject({ id: 'admin-1' });
    });

    it('lets the session user approve their own request', async () => {
      arrange(row());
      compare.mockResolvedValue(true);

      await expect(
        service.verify(
          input({
            requestedBy: {
              id: 'manager-1',
              full_name: 'Shop Manager',
              role: UserRole.MANAGER,
              branch_id: 'branch-1',
            },
          }),
        ),
      ).resolves.toMatchObject({ id: 'manager-1' });
    });

    it('refuses a locked PIN with 423 WITHOUT comparing or changing the count', async () => {
      const until = new Date('2026-10-22T09:15:00Z');
      arrange(
        row({
          locked: true,
          approval_pin_failed_attempts: 5,
          approval_pin_locked_until: until,
        }),
      );

      const err = await errorOf(service.verify(input()));

      expect(err.getStatus()).toBe(HttpStatus.LOCKED);
      expect(err.getResponse()).toEqual({
        message: "Shop Manager's PIN is locked until 14:45.",
        code: 'PIN_LOCKED',
        locked_until: until.toISOString(),
      });
      expect(compare).not.toHaveBeenCalled();
      expect(mockManager.query).toHaveBeenCalledTimes(1); // the SELECT only
    });

    it('counts a wrong PIN: 403 WRONG_PIN with attempts_left, saved and audited (never the PIN)', async () => {
      arrange(row({ approval_pin_failed_attempts: 1 }));
      compare.mockResolvedValue(false);

      const err = await errorOf(service.verify(input()));

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toEqual({
        message: 'Wrong PIN. 3 attempts left.',
        code: 'WRONG_PIN',
        attempts_left: 3,
      });
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringMatching(/SET approval_pin_failed_attempts = \$2/),
        ['manager-1', 2],
      );
      expect(mockAuditRepo.save).toHaveBeenCalledTimes(1);
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'cashier-1',
          action: AuditAction.APPROVAL_PIN_FAILED,
          entity_type: 'User',
          entity_id: 'manager-1',
        }),
      );
      expect(JSON.stringify(mockAuditRepo.save.mock.calls)).not.toContain(PIN);
      expect(JSON.stringify(err.getResponse())).not.toContain(PIN);
    });

    it('says "1 attempt left" on the 4th wrong PIN', async () => {
      arrange(row({ approval_pin_failed_attempts: 3 }));
      compare.mockResolvedValue(false);

      const err = await errorOf(service.verify(input()));

      expect(err.getResponse()).toMatchObject({
        message: 'Wrong PIN. 1 attempt left.',
        attempts_left: 1,
      });
    });

    it('locks at exactly the 5th wrong PIN: lock set with now() + interval, 423 with locked_until, audited FAILED + LOCKED', async () => {
      const until = new Date('2026-10-22T09:15:00Z');
      // UPDATE … RETURNING via manager.query(): [rows, affectedCount]
      arrange(row({ approval_pin_failed_attempts: 4 }), [
        [{ approval_pin_locked_until: until }],
        1,
      ]);
      compare.mockResolvedValue(false);

      const err = await errorOf(service.verify(input()));

      expect(err.getStatus()).toBe(HttpStatus.LOCKED);
      expect(err.getResponse()).toEqual({
        message: "Wrong PIN. Shop Manager's PIN is locked until 14:45.",
        code: 'PIN_LOCKED',
        locked_until: until.toISOString(),
      });
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringMatching(
          /approval_pin_locked_until = now\(\) \+ \$3::interval/,
        ),
        ['manager-1', 5, '15 minutes'],
      );
      expect(
        mockAuditRepo.save.mock.calls.map(
          ([e]) => (e as { action: string }).action,
        ),
      ).toEqual([
        AuditAction.APPROVAL_PIN_FAILED,
        AuditAction.APPROVAL_PIN_LOCKED,
      ]);
    });

    it('starts the count again from 0 once the lock has expired', async () => {
      arrange(
        row({
          approval_pin_failed_attempts: 5,
          approval_pin_locked_until: new Date('2026-10-22T08:00:00Z'),
          locked: false,
          lock_expired: true,
        }),
      );
      compare.mockResolvedValue(false);

      const err = await errorOf(service.verify(input()));

      expect(err.getResponse()).toMatchObject({
        code: 'WRONG_PIN',
        attempts_left: 4,
      });
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringMatching(/SET approval_pin_failed_attempts = \$2/),
        ['manager-1', 1],
      );
    });

    it('throws only after its transaction has returned (the count commits)', async () => {
      arrange(row());
      compare.mockResolvedValue(false);
      let callbackThrew = false;
      mockDataSource.transaction.mockImplementationOnce(
        async (cb: (m: typeof mockManager) => unknown) => {
          try {
            return await cb(mockManager);
          } catch (e) {
            callbackThrew = true;
            throw e;
          }
        },
      );

      await errorOf(service.verify(input()));

      expect(callbackThrew).toBe(false);
    });
  });

  describe('setOwnPin', () => {
    const managerCaller = {
      id: 'manager-1',
      full_name: 'Shop Manager',
      role: UserRole.MANAGER,
      branch_id: 'branch-1',
    };
    const dto = { current_password: 'correct-password', pin: PIN };

    it('hashes the PIN with the password cost, resets count and lock, audits SET (never the PIN or password)', async () => {
      const setAt = new Date('2026-10-22T09:00:00Z');
      mockQb.getOne.mockResolvedValue({
        id: 'manager-1',
        password_hash: '$2b$04$pw',
        approval_pin_set_at: null,
      });
      compare.mockResolvedValue(true);
      hash.mockResolvedValue('$2b$04$pinhash');
      mockManager.query.mockReset();
      // UPDATE … RETURNING via manager.query(): [rows, affectedCount]
      mockManager.query.mockResolvedValueOnce([
        [{ approval_pin_set_at: setAt }],
        1,
      ]);

      await expect(
        service.setOwnPin(managerCaller, dto, '10.0.0.5'),
      ).resolves.toEqual({
        has_approval_pin: true,
        approval_pin_set_at: setAt,
      });
      expect(hash).toHaveBeenCalledWith(PIN, 4);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringMatching(
          /approval_pin_failed_attempts = 0,\s+approval_pin_locked_until = NULL/,
        ),
        ['manager-1', '$2b$04$pinhash'],
      );
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'manager-1',
          action: AuditAction.APPROVAL_PIN_SET,
          entity_id: 'manager-1',
        }),
      );
      const audited = JSON.stringify(mockAuditRepo.save.mock.calls);
      expect(audited).not.toContain(PIN);
      expect(audited).not.toContain('correct-password');
      expect(audited).not.toContain('$2b$');
    });

    it('refuses a wrong current password with 403 WRONG_PASSWORD, audited, PIN unchanged', async () => {
      mockQb.getOne.mockResolvedValue({
        id: 'manager-1',
        password_hash: '$2b$04$pw',
      });
      compare.mockResolvedValue(false);
      mockManager.query.mockReset();

      const err = await errorOf(service.setOwnPin(managerCaller, dto));

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toEqual({
        message: 'Current password is incorrect.',
        code: 'WRONG_PASSWORD',
      });
      expect(hash).not.toHaveBeenCalled();
      expect(mockManager.query).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.APPROVAL_PIN_SET_REJECTED,
        }),
      );
    });

    it('refuses a weak PIN with 400 before checking the password', async () => {
      const err = await errorOf(
        service.setOwnPin(managerCaller, { ...dto, pin: '345678' }),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(err.getResponse())).not.toContain('345678');
      expect(compare).not.toHaveBeenCalled();
    });

    it('refuses a cashier', async () => {
      await expect(service.setOwnPin(cashier, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('clearPin', () => {
    const admin = {
      id: 'admin-1',
      full_name: 'Admin',
      role: UserRole.ADMIN,
      branch_id: null,
    };

    it('clears hash, set time, count and lock, and audits actor + target', async () => {
      mockQb.getOne.mockResolvedValue({
        id: 'manager-1',
        full_name: 'Shop Manager',
        approval_pin_set_at: new Date(),
      });
      mockManager.query.mockReset();
      mockManager.query.mockResolvedValue([]);

      await service.clearPin(admin, 'manager-1', '10.0.0.5');

      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringMatching(
          /approval_pin_hash = NULL,\s+approval_pin_set_at = NULL,\s+approval_pin_failed_attempts = 0,\s+approval_pin_locked_until = NULL/,
        ),
        ['manager-1'],
      );
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'admin-1',
          action: AuditAction.APPROVAL_PIN_CLEARED,
          entity_id: 'manager-1',
          description: 'Approval PIN of Shop Manager cleared.',
        }),
      );
    });

    it('still clears and audits when no PIN was set', async () => {
      mockQb.getOne.mockResolvedValue({
        id: 'manager-1',
        full_name: 'Shop Manager',
        approval_pin_set_at: null,
      });

      await service.clearPin(admin, 'manager-1');

      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Approval PIN of Shop Manager cleared (none was set).',
        }),
      );
    });

    it('404 for an unknown user', async () => {
      mockQb.getOne.mockResolvedValue(null);

      await expect(service.clearPin(admin, 'ghost')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('listApprovers', () => {
    it('returns only id and full_name, filtered to PIN-holding admins and the branch managers', async () => {
      mockQb.getMany.mockResolvedValue([
        { id: 'manager-1', full_name: 'Shop Manager', email: 'leak@x' },
      ]);

      await expect(service.listApprovers(cashier, 'branch-1')).resolves.toEqual(
        [{ id: 'manager-1', full_name: 'Shop Manager' }],
      );
      expect(mockQb.select).toHaveBeenCalledWith(['user.id', 'user.full_name']);
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'user.approval_pin_hash IS NOT NULL',
      );
      expect(mockQb.where).toHaveBeenCalledWith('user.is_active = true');
    });

    it('403 when a non-admin asks for another branch', async () => {
      await expect(service.listApprovers(cashier, 'branch-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockQb.getMany).not.toHaveBeenCalled();
    });

    it('lets an admin ask for any branch', async () => {
      mockQb.getMany.mockResolvedValue([]);
      await expect(
        service.listApprovers(
          {
            id: 'admin-1',
            full_name: 'Admin',
            role: UserRole.ADMIN,
            branch_id: null,
          },
          'branch-2',
        ),
      ).resolves.toEqual([]);
    });
  });
});
