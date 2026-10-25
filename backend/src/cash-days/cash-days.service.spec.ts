import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CashDaysService } from './cash-days.service';
import { CashDay } from './entities/cash-day.entity';
import { OpenCashDayDto } from './dto/open-cash-day.dto';
import { CloseCashDayDto } from './dto/close-cash-day.dto';
import { CashDayBreakdown, MethodTotalRow } from './cash-day-math';
import { Branch } from '../branches/entities/branch.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { PaymentMethod } from '../sales/enums/payment-method.enum';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

/**
 * The order of the cash day's checks (Phase 6.4 P9, C2 – C9 of the
 * planning doc's error table) and what open and close write. The
 * database behaviour (the summary SQL, locks, constraints) is in
 * test/cash-days.e2e-spec.ts.
 *
 * The manager mock answers from `fixtures`: findOne matches its `where`
 * against fixtures.days, and the summary queries return fixture rows.
 */
describe('CashDaysService', () => {
  let service: CashDaysService;

  const cashier = {
    id: 'cashier-1',
    full_name: 'Till Cashier',
    role: UserRole.CASHIER,
    branch_id: 'branch-1',
  };
  const otherCashier = { ...cashier, id: 'cashier-2', full_name: 'Other' };
  const branchBCashier = { ...cashier, id: 'cashier-b', branch_id: 'branch-2' };
  const admin = {
    id: 'admin-1',
    full_name: 'Shop Admin',
    role: UserRole.ADMIN,
    branch_id: null,
  };

  const userRef = (u: { id: string; full_name: string }) =>
    ({ id: u.id, full_name: u.full_name, email: 'hidden@x' }) as User;
  // The users the relations load, by id.
  const people = new Map(
    [cashier, otherCashier, branchBCashier, admin].map((u) => [u.id, u]),
  );

  const BREAKDOWN: CashDayBreakdown = {
    non_cash_sales: {
      CARD: '0.00',
      BANK_TRANSFER: '0.00',
      KOKO: '0.00',
      MINTPAY: '0.00',
    },
    non_cash_refunds: {
      CARD: '0.00',
      BANK_TRANSFER: '0.00',
      KOKO: '0.00',
      MINTPAY: '0.00',
    },
    earlier_voids_non_cash: {
      CARD: '0.00',
      BANK_TRANSFER: '0.00',
      KOKO: '0.00',
      MINTPAY: '0.00',
    },
    trade_in_value: '0.00',
    counts: { sales_completed: 0, returns: 0, voids: 0 },
  };

  const openDay = (overrides: Partial<CashDay> = {}): CashDay => ({
    id: 'day-1',
    branch_id: 'branch-1',
    business_date: '2026-10-20',
    opening_balance: '5000.00',
    opened_by: 'cashier-1',
    opener: userRef(cashier),
    opened_at: new Date('2026-10-20T03:30:00Z'),
    open_client_request_id: 'open-crid-1',
    cash_sales: null,
    cash_refunds: null,
    cash_voids_earlier: null,
    expected_balance: null,
    counted_balance: null,
    difference: null,
    difference_reason: null,
    summary: null,
    closed_by: null,
    closer: null,
    closed_at: null,
    close_client_request_id: null,
    created_at: new Date('2026-10-20T03:30:00Z'),
    updated_at: new Date('2026-10-20T03:30:00Z'),
    ...overrides,
  });

  const closedDay = (overrides: Partial<CashDay> = {}): CashDay =>
    openDay({
      cash_sales: '12000.00',
      cash_refunds: '1500.00',
      cash_voids_earlier: '0.00',
      expected_balance: '15500.00',
      counted_balance: '15500.00',
      difference: '0.00',
      summary: BREAKDOWN,
      closed_by: 'cashier-1',
      closer: userRef(cashier),
      closed_at: new Date('2026-10-20T15:00:00Z'),
      close_client_request_id: 'close-crid-1',
      ...overrides,
    });

  // What the manager mock answers, per test.
  let fixtures: {
    today: string;
    branches: string[];
    days: CashDay[];
    openSales: { id: string }[];
    sales: MethodTotalRow[];
    refunds: MethodTotalRow[];
    earlierVoids: MethodTotalRow[];
    counts: CashDayBreakdown['counts'];
  };
  // Every manager.query, in order, and whether it ran in the transaction.
  let queries: { sql: string; params: unknown[]; inTx: boolean }[];
  let inTx: boolean;

  const matches = (day: CashDay, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([k, v]) => (day as unknown as Record<string, unknown>)[k] === v,
    );

  const mockAuditRepo = { save: jest.fn() };
  const mockLock = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const mockManager = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
    getRepository: jest.fn(),
  };
  const mockDataSource = { manager: mockManager, transaction: jest.fn() };

  const runQuery = (sql: string, params: unknown[] = []): unknown => {
    queries.push({ sql, params, inTx });
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('AS today')) return [{ today: fixtures.today }];
    if (sql.includes('business_date < $2::date')) {
      return fixtures.days
        .filter(
          (d) =>
            d.branch_id === params[0] &&
            d.business_date < (params[1] as string) &&
            d.closed_at === null,
        )
        .sort((a, b) => a.business_date.localeCompare(b.business_date))
        .slice(0, 1)
        .map((d) => ({ id: d.id, business_date: d.business_date }));
    }
    if (sql.includes('closed_at IS NOT NULL')) {
      return fixtures.days
        .filter((d) => d.branch_id === params[0] && d.closed_at !== null)
        .sort((a, b) => b.business_date.localeCompare(a.business_date))
        .slice(0, 1)
        .map((d) => ({
          business_date: d.business_date,
          counted_balance: d.counted_balance,
        }));
    }
    if (sql.includes('FOR UPDATE OF s')) return fixtures.openSales;
    if (sql.includes('-- cash day: sales')) return fixtures.sales;
    if (sql.includes('-- cash day: refunds')) return fixtures.refunds;
    if (sql.includes('-- cash day: earlier voids'))
      return fixtures.earlierVoids;
    if (sql.includes('-- cash day: counts')) return [fixtures.counts];
    if (sql.includes('INSERT INTO cash_days')) {
      const [branchId, date, opening, openedBy, crid] = params as string[];
      fixtures.days.push(
        openDay({
          id: 'day-new',
          branch_id: branchId,
          business_date: date,
          opening_balance: opening,
          opened_by: openedBy,
          opener: userRef(people.get(openedBy)!),
          open_client_request_id: crid,
        }),
      );
      return [{ id: 'day-new' }];
    }
    if (sql.includes('UPDATE cash_days')) {
      const p = params as (string | null)[];
      const day = fixtures.days.find((d) => d.id === p[0])!;
      Object.assign(day, {
        cash_sales: p[1],
        cash_refunds: p[2],
        cash_voids_earlier: p[3],
        expected_balance: p[4],
        counted_balance: p[5],
        difference: p[6],
        difference_reason: p[7],
        summary: JSON.parse(p[8]!) as CashDayBreakdown,
        closed_by: p[9],
        closer: userRef(people.get(p[9]!)!),
        closed_at: new Date(),
        close_client_request_id: p[10],
      });
      return [];
    }
    throw new Error(`unexpected query: ${sql}`);
  };

  const openDto = (
    overrides: Partial<OpenCashDayDto> = {},
  ): OpenCashDayDto => ({
    branch_id: 'branch-1',
    opening_balance: 5000,
    client_request_id: 'open-crid-new',
    ...overrides,
  });
  const closeDto = (
    overrides: Partial<CloseCashDayDto> = {},
  ): CloseCashDayDto => ({
    counted_balance: 15500,
    expected_seen: 15500,
    client_request_id: 'close-crid-new',
    ...overrides,
  });

  /** The refusal's body, or fails if `promise` doesn't reject with one. */
  const refusal = async (promise: Promise<unknown>) => {
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    return {
      err: err as HttpException,
      body: (err as HttpException).getResponse() as Record<string, unknown>,
    };
  };
  const auditRows = () =>
    (mockAuditRepo.save.mock.calls as unknown[][]).map(
      (c) => c[0] as { action: string; changes: Record<string, unknown> },
    );
  const whereCalls = () => mockLock.where.mock.calls as unknown[][];
  const updates = () =>
    queries.filter((q) => q.sql.trimStart().startsWith('UPDATE '));

  beforeEach(async () => {
    jest.resetAllMocks();
    fixtures = {
      today: '2026-10-20',
      branches: ['branch-1', 'branch-2'],
      days: [],
      openSales: [],
      // P9-5: sale A paid 12,000.00 cash (B, voided the same day, is left
      // out by the SQL); the return refunds CARD 500.00 + CASH 1,500.00.
      sales: [{ method: PaymentMethod.CASH, total: '12000.00' }],
      refunds: [
        { method: PaymentMethod.CASH, total: '1500.00' },
        { method: PaymentMethod.CARD, total: '500.00' },
      ],
      earlierVoids: [],
      counts: { sales_completed: 3, returns: 1, voids: 1 },
    };
    queries = [];
    inTx = false;

    mockManager.findOne.mockImplementation(
      (entity: unknown, opts: { where: Record<string, unknown> }) => {
        if (entity === Branch) {
          return Promise.resolve(
            fixtures.branches.includes(opts.where.id as string)
              ? { id: opts.where.id }
              : null,
          );
        }
        return Promise.resolve(
          fixtures.days.find((d) => matches(d, opts.where)) ?? null,
        );
      },
    );
    mockManager.findAndCount.mockImplementation(() =>
      Promise.resolve([fixtures.days, fixtures.days.length]),
    );
    mockManager.query.mockImplementation((sql: string, params?: unknown[]) =>
      Promise.resolve(runQuery(sql, params)),
    );
    mockLock.setLock.mockReturnThis();
    mockLock.where.mockReturnThis();
    mockLock.getOne.mockImplementation(() =>
      Promise.resolve(
        fixtures.days.find(
          (d) => d.id === (whereCalls().at(-1)?.[1] as { id: string }).id,
        ) ?? null,
      ),
    );
    mockManager.createQueryBuilder.mockReturnValue(mockLock);
    mockManager.getRepository.mockReturnValue(mockAuditRepo);
    mockDataSource.transaction.mockImplementation(
      async (cb: (m: typeof mockManager) => unknown) => {
        inTx = true;
        try {
          return await cb(mockManager);
        } finally {
          inTx = false;
        }
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashDaysService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();
    service = module.get(CashDaysService);
  });

  describe('open', () => {
    it('opens today: advisory lock first, then today, the row and DAY_OPEN', async () => {
      const result = await service.open(
        openDto({ opening_balance: 5000 }),
        cashier,
      );

      expect(result.created).toBe(true);
      expect(result.day).toMatchObject({
        id: 'day-new',
        business_date: '2026-10-20',
        opening_balance: '5000.00',
        opened_by: { id: 'cashier-1', full_name: 'Till Cashier' },
        closed_by: null,
      });
      expect(result.day.opened_by).not.toHaveProperty('email');
      const txQueries = queries.filter((q) => q.inTx);
      expect(txQueries[0].sql).toContain('pg_advisory_xact_lock');
      expect(txQueries[0].sql).toContain(`'cash_days:' || $1::text`);
      expect(txQueries[0].params).toEqual(['branch-1']);
      expect(txQueries[1].sql).toContain('AS today');
      expect(auditRows()).toEqual([
        expect.objectContaining({
          action: AuditAction.DAY_OPEN,
          entity_type: 'CashDay',
          entity_id: 'day-new',
          changes: {
            business_date: { old: null, new: '2026-10-20' },
            opening_balance: { old: null, new: '5000.00' },
          },
        }),
      ]);
    });

    it('C3: the same user and branch get the recorded day (200), unchecked, with no transaction', async () => {
      fixtures.days.push(openDay({ open_client_request_id: 'open-crid-1' }));
      // The user has since moved branch; C3 comes before C2.
      const result = await service.open(
        openDto({ client_request_id: 'open-crid-1', opening_balance: 99 }),
        { ...cashier, branch_id: 'branch-2' },
      );

      expect(result.created).toBe(false);
      expect(result.day.id).toBe('day-1');
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('C3: another user, or another branch, is 409 CLIENT_REQUEST_ID_CONFLICT', async () => {
      fixtures.days.push(openDay({ open_client_request_id: 'open-crid-1' }));

      const byOther = await refusal(
        service.open(
          openDto({ client_request_id: 'open-crid-1' }),
          otherCashier,
        ),
      );
      expect(byOther.err).toBeInstanceOf(ConflictException);
      expect(byOther.body.code).toBe('CLIENT_REQUEST_ID_CONFLICT');

      const otherBranch = await refusal(
        service.open(
          openDto({ client_request_id: 'open-crid-1', branch_id: 'branch-2' }),
          admin,
        ),
      );
      expect(otherBranch.body.code).toBe('CLIENT_REQUEST_ID_CONFLICT');
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('C2: a cashier at another branch is 403 CASH_DAY_WRONG_BRANCH; an admin may open any', async () => {
      const { err, body } = await refusal(
        service.open(openDto(), branchBCashier),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(body.code).toBe('CASH_DAY_WRONG_BRANCH');
      expect(mockDataSource.transaction).not.toHaveBeenCalled();

      const result = await service.open(openDto(), admin);
      expect(result.created).toBe(true);
    });

    it('404 when the branch does not exist', async () => {
      await expect(
        service.open(openDto({ branch_id: 'branch-x' }), admin),
      ).rejects.toThrow(NotFoundException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('C4: today already open is 409 DAY_ALREADY_OPEN with cash_day_id and closed_at null', async () => {
      fixtures.days.push(openDay());

      const { body } = await refusal(service.open(openDto(), cashier));
      expect(body).toMatchObject({
        code: 'DAY_ALREADY_OPEN',
        cash_day_id: 'day-1',
        closed_at: null,
      });
      expect(body.message).toContain('is already open');
      expect(auditRows()).toEqual([]);
    });

    it('C4: today already closed says so, with closed_at', async () => {
      fixtures.days.push(closedDay());

      const { body } = await refusal(service.open(openDto(), cashier));
      expect(body).toMatchObject({
        code: 'DAY_ALREADY_OPEN',
        cash_day_id: 'day-1',
        closed_at: new Date('2026-10-20T15:00:00Z'),
      });
      expect(body.message).toContain('already opened and closed at 8:30 PM');
    });

    it('C5: an earlier day still open is 409 EARLIER_DAY_NOT_CLOSED, naming the oldest', async () => {
      fixtures.days.push(
        openDay({ id: 'day-18', business_date: '2026-10-18' }),
        openDay({ id: 'day-16', business_date: '2026-10-16' }),
        closedDay({ id: 'day-15', business_date: '2026-10-15' }),
      );

      const { body } = await refusal(service.open(openDto(), cashier));
      expect(body).toMatchObject({
        code: 'EARLIER_DAY_NOT_CLOSED',
        business_date: '2026-10-16',
        cash_day_id: 'day-16',
      });
      expect(queries.some((q) => q.sql.includes('INSERT'))).toBe(false);
    });

    it('a clash on the open client_request_id key answers C3 (the recorded day)', async () => {
      mockDataSource.transaction.mockImplementationOnce(() => {
        // The other request committed first.
        fixtures.days.push(
          openDay({ open_client_request_id: 'open-crid-new' }),
        );
        return Promise.reject(
          new QueryFailedError('INSERT', [], {
            constraint: 'UQ_cash_days_open_client_request_id',
          } as unknown as Error),
        );
      });

      const result = await service.open(openDto(), cashier);
      expect(result.created).toBe(false);
      expect(result.day.id).toBe('day-1');
    });
  });

  describe('close', () => {
    beforeEach(() => {
      fixtures.days.push(openDay());
    });

    it('refuses close while this cash day has an unfinished sale', async () => {
      fixtures.openSales = [{ id: 'draft-sale-1' }];

      const { body } = await refusal(
        service.close('day-1', closeDto(), cashier),
      );

      expect(body).toMatchObject({ code: 'OPEN_SALES', sale_count: 1 });
      expect(queries.find((q) => q.sql.includes('FOR UPDATE OF s'))?.params).toEqual([
        'branch-1',
        openDay().opened_at,
      ]);
      expect(updates().some((q) => q.sql.includes('UPDATE cash_days'))).toBe(
        false,
      );
    });

    it('closes: FOR UPDATE by id with no closed_at filter, the snapshot and DAY_CLOSE', async () => {
      const day = await service.close('day-1', closeDto(), cashier);

      expect(mockLock.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(mockLock.where).toHaveBeenCalledWith('day.id = :id', {
        id: 'day-1',
      });
      expect(whereCalls()[0][0]).not.toContain('closed_at');
      // The summary runs after the lock is held, in the transaction.
      const summaryQueries = queries.filter((q) =>
        q.sql.includes('-- cash day:'),
      );
      expect(summaryQueries.length).toBe(4);
      expect(summaryQueries.every((q) => q.inTx)).toBe(true);

      expect(day).toMatchObject({
        cash_sales: '12000.00',
        cash_refunds: '1500.00',
        cash_voids_earlier: '0.00',
        expected_balance: '15500.00',
        counted_balance: '15500.00',
        difference: '0.00',
        difference_reason: null,
        closed_by: { id: 'cashier-1', full_name: 'Till Cashier' },
      });
      expect(day.summary).toMatchObject({
        non_cash_refunds: { CARD: '500.00' },
        counts: { sales_completed: 3, returns: 1, voids: 1 },
      });
      expect(auditRows()).toEqual([
        expect.objectContaining({
          action: AuditAction.DAY_CLOSE,
          entity_id: 'day-1',
          changes: {
            expected_balance: { old: null, new: '15500.00' },
            counted_balance: { old: null, new: '15500.00' },
            difference: { old: null, new: '0.00' },
            difference_reason: { old: null, new: null },
          },
        }),
      ]);
    });

    it('C6: 404 when the day does not exist', async () => {
      await expect(
        service.close('missing', closeDto(), cashier),
      ).rejects.toThrow(NotFoundException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('C3: a resend by the same user for the same day gets the closed day, unchecked', async () => {
      fixtures.days[0] = closedDay();

      const day = await service.close(
        'day-1',
        closeDto({ client_request_id: 'close-crid-1', expected_seen: 1 }),
        cashier,
      );
      expect(day.closed_at).not.toBeNull();
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('C3: the id used for another day, or by another user, is 409', async () => {
      fixtures.days.push(
        closedDay({ id: 'day-0', business_date: '2026-10-19' }),
      );
      const otherDay = await refusal(
        service.close(
          'day-1',
          closeDto({ client_request_id: 'close-crid-1' }),
          cashier,
        ),
      );
      expect(otherDay.body.code).toBe('CLIENT_REQUEST_ID_CONFLICT');

      fixtures.days[0] = closedDay();
      const otherUser = await refusal(
        service.close(
          'day-1',
          closeDto({ client_request_id: 'close-crid-1' }),
          otherCashier,
        ),
      );
      expect(otherUser.body.code).toBe('CLIENT_REQUEST_ID_CONFLICT');
    });

    it('C2: a cashier at another branch is 403', async () => {
      const { body } = await refusal(
        service.close('day-1', closeDto(), branchBCashier),
      );
      expect(body.code).toBe('CASH_DAY_WRONG_BRANCH');
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('C7: an already closed day is 409 DAY_ALREADY_CLOSED', async () => {
      fixtures.days[0] = closedDay();

      const { body } = await refusal(
        service.close('day-1', closeDto(), cashier),
      );
      expect(body).toMatchObject({
        code: 'DAY_ALREADY_CLOSED',
        cash_day_id: 'day-1',
      });
      expect(updates()).toEqual([]);
    });

    it('C8: expected_seen out of date is 409 EXPECTED_CHANGED with the fresh summary, before C9', async () => {
      const { body } = await refusal(
        service.close(
          'day-1',
          // Short and no reason too: C8 decides first.
          closeDto({ expected_seen: 14000, counted_balance: 14000 }),
          cashier,
        ),
      );
      expect(body.code).toBe('EXPECTED_CHANGED');
      expect(body.summary).toMatchObject({
        cash_day_id: 'day-1',
        expected_balance: '15500.00',
        cash_sales: '12000.00',
      });
      expect(updates()).toEqual([]);
      expect(auditRows()).toEqual([]);
    });

    it('C9: a difference with no reason, or under 3 characters, is 400 REASON_REQUIRED', async () => {
      for (const reason of [undefined, null, 'ab', '   ']) {
        const { err, body } = await refusal(
          service.close(
            'day-1',
            closeDto({ counted_balance: 15400, difference_reason: reason }),
            cashier,
          ),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(body).toMatchObject({
          code: 'REASON_REQUIRED',
          difference: '-100.00',
        });
      }
      expect(updates()).toEqual([]);
    });

    it('a short count with a reason stores it trimmed, with the difference', async () => {
      const day = await service.close(
        'day-1',
        closeDto({
          counted_balance: 15400,
          difference_reason: '  Float miscounted  ',
        }),
        cashier,
      );
      expect(day).toMatchObject({
        difference: '-100.00',
        difference_reason: 'Float miscounted',
      });
      expect(auditRows()[0].changes.difference_reason).toEqual({
        old: null,
        new: 'Float miscounted',
      });
    });

    it('a zero difference ignores any reason sent and stores null', async () => {
      const day = await service.close(
        'day-1',
        closeDto({ difference_reason: 'ok' }),
        cashier,
      );
      expect(day.difference).toBe('0.00');
      expect(day.difference_reason).toBeNull();
    });

    it('P9-6: an earlier day sale voided today comes off expected', async () => {
      fixtures.days[0] = openDay({
        opening_balance: '15500.00',
        business_date: '2026-10-21',
      });
      fixtures.sales = [{ method: PaymentMethod.CASH, total: '8000.00' }];
      fixtures.refunds = [];
      fixtures.earlierVoids = [
        { method: PaymentMethod.CASH, total: '12000.00' },
        { method: PaymentMethod.CARD, total: '3000.00' },
        { method: PaymentMethod.TRADE_IN, total: '5000.00' },
      ];

      const day = await service.close(
        'day-1',
        closeDto({ counted_balance: 11500, expected_seen: 11500 }),
        cashier,
      );
      expect(day).toMatchObject({
        cash_sales: '8000.00',
        cash_voids_earlier: '12000.00',
        expected_balance: '11500.00',
      });
      expect(day.summary!.earlier_voids_non_cash).toEqual({
        CARD: '3000.00',
        BANK_TRANSFER: '0.00',
        KOKO: '0.00',
        MINTPAY: '0.00',
      });
    });
  });

  describe('reads', () => {
    it('summary: a closed day is its snapshot, never recomputed', async () => {
      fixtures.days.push(closedDay());

      const summary = await service.summary(cashier, 'day-1');
      expect(summary).toMatchObject({
        closed: true,
        expected_balance: '15500.00',
        summary: BREAKDOWN,
      });
      expect(queries.filter((q) => q.sql.includes('-- cash day:'))).toEqual([]);
    });

    it('summary: an open day is worked out now, with trade-in value from counted sales', async () => {
      fixtures.days.push(openDay());
      fixtures.sales.push({
        method: PaymentMethod.TRADE_IN,
        total: '30000.00',
      });

      const summary = await service.summary(cashier, 'day-1');
      expect(summary).toMatchObject({
        closed: false,
        expected_balance: '15500.00',
        summary: { trade_in_value: '30000.00' },
      });
    });

    it('current: today, the oldest earlier open day and the last closed day', async () => {
      fixtures.today = '2026-10-21';
      fixtures.days.push(
        closedDay({
          id: 'day-17',
          business_date: '2026-10-17',
          counted_balance: '9000.00',
        }),
        openDay({ id: 'day-19', business_date: '2026-10-19' }),
        closedDay({
          id: 'day-18',
          business_date: '2026-10-18',
          counted_balance: '7000.00',
        }),
      );

      const current = await service.current(cashier, 'branch-1');
      expect(current).toEqual({
        business_date: '2026-10-21',
        today: null,
        earlier_open: { id: 'day-19', business_date: '2026-10-19' },
        last_closed: {
          business_date: '2026-10-18',
          counted_balance: '7000.00',
        },
      });
    });

    it('current and list: 403 for another branch, 404 for an unknown one', async () => {
      const wrong = await refusal(service.current(branchBCashier, 'branch-1'));
      expect(wrong.body.code).toBe('CASH_DAY_WRONG_BRANCH');
      await expect(service.current(admin, 'branch-x')).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.list(admin, { branchId: 'branch-x', page: 1, limit: 50 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('list: newest first, people as { id, full_name }, open days included', async () => {
      fixtures.days.push(
        openDay({ id: 'day-2', business_date: '2026-10-21' }),
        closedDay(),
      );

      const page = await service.list(cashier, {
        branchId: 'branch-1',
        page: 1,
        limit: 2,
      });
      expect(mockManager.findAndCount).toHaveBeenCalledWith(
        CashDay,
        expect.objectContaining({
          where: { branch_id: 'branch-1' },
          relations: { opener: true, closer: true },
          order: { business_date: 'DESC' },
          skip: 0,
          take: 2,
        }),
      );
      expect(page.data.map((d) => d.closed_by)).toEqual([
        null,
        { id: 'cashier-1', full_name: 'Till Cashier' },
      ]);
      expect(page.meta).toMatchObject({ total: 2, page: 1, limit: 2 });
    });

    it('findOne: 404, and 403 for another branch', async () => {
      fixtures.days.push(openDay());
      await expect(service.findOne(cashier, 'missing')).rejects.toThrow(
        NotFoundException,
      );
      const { body } = await refusal(service.findOne(branchBCashier, 'day-1'));
      expect(body.code).toBe('CASH_DAY_WRONG_BRANCH');
    });
  });
});
