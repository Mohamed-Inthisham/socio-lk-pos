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
import { CashDaysService, DRAFTS_LOCK_SQL } from './cash-days.service';
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

  // A sale row as the draft-cleanup queries see it, with its lines (as the
  // snapshot SELECT returns them: no cost price) and its payments.
  type SaleFixture = {
    id: string;
    branch_id: string;
    status: 'DRAFT' | 'COMPLETED' | 'VOIDED';
    cashier_id: string;
    cashier_name: string | null;
    customer_id: string | null;
    subtotal: string;
    discount_total: string;
    tax_total: string;
    total: string;
    notes: string | null;
    created_at: Date;
    updated_at: Date;
    lines: Record<string, unknown>[];
    payments: string[];
  };
  const saleRow = (overrides: Partial<SaleFixture> = {}): SaleFixture => ({
    id: 'draft-1',
    branch_id: 'branch-1',
    status: 'DRAFT',
    cashier_id: 'cashier-1',
    cashier_name: 'Till Cashier',
    customer_id: null,
    subtotal: '0.00',
    discount_total: '0.00',
    tax_total: '0.00',
    total: '0.00',
    notes: null,
    created_at: new Date('2026-10-20T04:00:00Z'),
    updated_at: new Date('2026-10-20T04:00:00Z'),
    lines: [],
    payments: [],
    ...overrides,
  });
  const glassLine = {
    line_number: 1,
    product_id: 'product-glass',
    product_sku_snapshot: 'SLP-0001',
    product_name_snapshot: 'Tempered Glass',
    quantity: 2,
    unit_price: '990.00',
    discount_type: null,
    discount_value: null,
    discount_amount: '0.00',
    line_total: '1980.00',
    product_unit_id: null,
    imei_snapshot: null,
    identifier_type_snapshot: null,
  };
  const phoneLine = {
    ...glassLine,
    line_number: 2,
    product_id: 'product-phone',
    product_sku_snapshot: 'SLP-0002',
    product_name_snapshot: 'iPhone 13 128GB',
    quantity: 1,
    unit_price: '150000.00',
    line_total: '150000.00',
    product_unit_id: 'unit-1',
    imei_snapshot: '356789012345678',
    identifier_type_snapshot: 'IMEI',
  };

  // What the manager mock answers, per test.
  let fixtures: {
    today: string;
    branches: string[];
    days: CashDay[];
    saleRows: SaleFixture[];
    // Make the close's UPDATE cash_days fail (rollback tests).
    failCloseUpdate: boolean;
    sales: MethodTotalRow[];
    refunds: MethodTotalRow[];
    earlierVoids: MethodTotalRow[];
    counts: CashDayBreakdown['counts'];
  };
  // Every manager.query, in order, and whether it ran in the transaction.
  let queries: { sql: string; params: unknown[]; inTx: boolean }[];
  let inTx: boolean;
  // Whether each audit row was saved inside the transaction, and the
  // number of queries run before the cash-day row was locked.
  let auditInTx: boolean[];
  let dayLockAt: number;

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
    // The draft cleanup's statements (DRAFT and branch filtered here as the
    // SQL does; the SQL text itself is asserted in the tests).
    if (sql.includes('FOR UPDATE OF s')) {
      return fixtures.saleRows
        .filter((s) => s.branch_id === params[0] && s.status === 'DRAFT')
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((s) => ({ id: s.id }));
    }
    const ids = (params[0] ?? []) as string[];
    if (sql.includes('SELECT DISTINCT p.sale_id')) {
      return fixtures.saleRows
        .filter((s) => ids.includes(s.id) && s.payments.length > 0)
        .map((s) => ({ sale_id: s.id }));
    }
    if (sql.includes('FROM sale_lines sl')) {
      return fixtures.saleRows
        .filter((s) => ids.includes(s.id))
        .flatMap((s) => s.lines.map((line) => ({ sale_id: s.id, ...line })));
    }
    if (sql.includes('LEFT JOIN users u')) {
      return fixtures.saleRows
        .filter((s) => ids.includes(s.id))
        .map(({ status: _s, lines: _l, payments: _p, ...row }) => row);
    }
    if (sql.includes('DELETE FROM sales')) {
      const gone = fixtures.saleRows.filter(
        (s) =>
          ids.includes(s.id) && s.status === 'DRAFT' && s.payments.length === 0,
      );
      fixtures.saleRows = fixtures.saleRows.filter((s) => !gone.includes(s));
      // The Postgres driver answers a DELETE with [rows, affected count].
      return [[], gone.length];
    }
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
      if (fixtures.failCloseUpdate) throw new Error('UPDATE cash_days failed');
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
      saleRows: [],
      failCloseUpdate: false,
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
    mockLock.getOne.mockImplementation(() => {
      // Where the cash-day row lock falls among the queries.
      dayLockAt = queries.length;
      return Promise.resolve(
        fixtures.days.find(
          (d) => d.id === (whereCalls().at(-1)?.[1] as { id: string }).id,
        ) ?? null,
      );
    });
    mockManager.createQueryBuilder.mockReturnValue(mockLock);
    mockManager.getRepository.mockReturnValue(mockAuditRepo);
    auditInTx = [];
    dayLockAt = -1;
    mockAuditRepo.save.mockImplementation(() => {
      auditInTx.push(inTx);
      return Promise.resolve({});
    });
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

    it('refuses close while a draft at the branch has a payment', async () => {
      fixtures.saleRows = [
        saleRow({ id: 'draft-paid', payments: ['payment-1'] }),
      ];

      const { err, body } = await refusal(
        service.close('day-1', closeDto(), cashier),
      );

      expect(err).toBeInstanceOf(ConflictException);
      expect(body).toEqual({
        message:
          'An unfinished sale with a payment cannot be discarded ' +
          'automatically. Please ask an administrator to resolve it before ' +
          'closing the cash day.',
        code: 'OPEN_SALES',
        sale_count: 1,
      });
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
            drafts_discarded: { old: null, new: 0 },
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

  describe('close: unpaid drafts discarded', () => {
    type AuditRow = {
      action: AuditAction;
      entity_type: string;
      entity_id: string;
      user_id: string;
      description: string;
      changes: Record<string, { old: unknown; new: unknown }>;
    };
    const audits = () =>
      (mockAuditRepo.save.mock.calls as unknown[][]).map(
        (c) => c[0] as AuditRow,
      );
    const draftAudits = () =>
      audits().filter((a) => a.action === AuditAction.DRAFT_DISCARDED);
    const dayCloseAudit = () =>
      audits().find((a) => a.action === AuditAction.DAY_CLOSE);
    const at = (needle: string) =>
      queries.findIndex((q) => q.sql.includes(needle));
    const ran = (needle: string) => at(needle) !== -1;
    const ids = () => fixtures.saleRows.map((s) => s.id).sort();

    // The transaction as Postgres runs it: on a throw, every write made
    // through it (drafts deleted, the day closed) is undone. The audit rows
    // go the same way; each test checks they were written inside it.
    const rollingBack = () => {
      mockDataSource.transaction.mockImplementationOnce(
        async (cb: (m: typeof mockManager) => unknown) => {
          const saved = {
            saleRows: structuredClone(fixtures.saleRows),
            days: structuredClone(fixtures.days),
          };
          inTx = true;
          try {
            return await cb(mockManager);
          } catch (err) {
            fixtures.saleRows = saved.saleRows;
            fixtures.days = saved.days;
            throw err;
          } finally {
            inTx = false;
          }
        },
      );
    };

    beforeEach(() => {
      fixtures.days.push(openDay());
    });

    it('discards every unpaid draft at the branch: empty or with lines, any age, any cashier', async () => {
      fixtures.saleRows = [
        saleRow({ id: 'draft-a' }),
        saleRow({
          id: 'draft-b',
          cashier_id: 'cashier-2',
          cashier_name: 'Other',
          lines: [glassLine],
          subtotal: '1980.00',
          total: '1980.00',
          created_at: new Date('2026-10-15T09:00:00Z'),
          updated_at: new Date('2026-10-15T09:05:00Z'),
        }),
        saleRow({
          id: 'draft-c',
          cashier_id: 'admin-1',
          cashier_name: 'Shop Admin',
          lines: [glassLine, phoneLine],
          created_at: new Date('2026-09-01T09:00:00Z'),
          updated_at: new Date('2026-09-01T09:00:00Z'),
        }),
        // Not this close's: another branch's draft, and finished sales.
        saleRow({ id: 'draft-other-branch', branch_id: 'branch-2' }),
        saleRow({ id: 'sale-completed', status: 'COMPLETED' }),
        saleRow({ id: 'sale-voided', status: 'VOIDED' }),
      ];

      const day = await service.close('day-1', closeDto(), cashier);

      expect(day.closed_at).not.toBeNull();
      expect(ids()).toEqual([
        'draft-other-branch',
        'sale-completed',
        'sale-voided',
      ]);
      expect(draftAudits().map((a) => a.entity_id)).toEqual([
        'draft-a',
        'draft-b',
        'draft-c',
      ]);
      expect(dayCloseAudit()?.changes.drafts_discarded).toEqual({
        old: null,
        new: 3,
      });

      // Every draft at the closing branch: no age, line or cashier filter.
      const lock = queries[at('FOR UPDATE OF s')];
      expect(lock.params).toEqual(['branch-1']);
      expect(lock.sql).toContain("s.status = 'DRAFT'");
      expect(lock.sql).not.toMatch(/updated_at|opened_at|sale_lines|cashier/);
      expect(lock.sql).toContain('ORDER BY s.id');
      // The DELETE re-checks DRAFT and no payment, for exactly those ids.
      const del = queries[at('DELETE FROM sales')];
      expect(del.sql).toContain("s.status = 'DRAFT'");
      expect(del.sql).toContain(
        'NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id)',
      );
      expect(del.params).toEqual([['draft-a', 'draft-b', 'draft-c']]);
    });

    it('keeps each draft in its DRAFT_DISCARDED row: sale, cashier, lines, totals, times, cash day, reason, closer; never a cost price', async () => {
      fixtures.saleRows = [
        saleRow({
          id: 'draft-b',
          cashier_id: 'cashier-2',
          cashier_name: 'Other',
          customer_id: 'customer-9',
          notes: 'Hold for pickup',
          lines: [glassLine, phoneLine],
          subtotal: '151980.00',
          total: '151980.00',
          created_at: new Date('2026-10-15T09:00:00Z'),
          updated_at: new Date('2026-10-15T09:05:00Z'),
        }),
      ];

      await service.close('day-1', closeDto(), admin);

      const [row] = draftAudits();
      expect(row).toMatchObject({
        action: AuditAction.DRAFT_DISCARDED,
        entity_type: 'Sale',
        entity_id: 'draft-b',
        user_id: 'admin-1',
      });
      expect(row.description).toBe(
        'Unpaid draft draft-b (2 lines, LKR 151980.00, cashier Other) ' +
          'discarded when day 2026-10-20 was closed by Shop Admin (admin-1).',
      );
      expect(row.changes).toEqual({
        status: { old: 'DRAFT', new: 'DISCARDED' },
        sale: {
          old: {
            id: 'draft-b',
            branch_id: 'branch-1',
            cashier_id: 'cashier-2',
            cashier_name: 'Other',
            customer_id: 'customer-9',
            subtotal: '151980.00',
            discount_total: '0.00',
            tax_total: '0.00',
            total: '151980.00',
            notes: 'Hold for pickup',
            created_at: new Date('2026-10-15T09:00:00Z'),
            updated_at: new Date('2026-10-15T09:05:00Z'),
            lines: [glassLine, phoneLine],
          },
          new: null,
        },
        discard: {
          old: null,
          new: {
            reason: 'AUTO_DISCARD_ON_DAY_CLOSE',
            cash_day_id: 'day-1',
            business_date: '2026-10-20',
            closed_by: 'admin-1',
          },
        },
      });
      // No cost price is selected, so none can be kept.
      expect(queries[at('FROM sale_lines sl')].sql).not.toMatch(/cost/);
      expect(queries[at('LEFT JOIN users u')].sql).not.toMatch(/cost/);
      expect(JSON.stringify(row)).not.toMatch(/cost/);
    });

    it('records the count on DAY_CLOSE, in its changes and description', async () => {
      fixtures.saleRows = [
        saleRow({ id: 'draft-a' }),
        saleRow({ id: 'draft-b' }),
      ];

      await service.close('day-1', closeDto(), cashier);

      const row = dayCloseAudit()!;
      expect(row.changes.drafts_discarded).toEqual({ old: null, new: 2 });
      expect(row.description).toContain('. Unpaid drafts discarded: 2.');
      // The discard rows come before DAY_CLOSE, all in the transaction.
      expect(audits().map((a) => a.action)).toEqual([
        AuditAction.DRAFT_DISCARDED,
        AuditAction.DRAFT_DISCARDED,
        AuditAction.DAY_CLOSE,
      ]);
      expect(auditInTx).toEqual([true, true, true]);
    });

    it('with no drafts: no snapshot or DELETE, and drafts_discarded 0', async () => {
      await service.close('day-1', closeDto(), cashier);

      expect(ran('SELECT DISTINCT p.sale_id')).toBe(false);
      expect(ran('LEFT JOIN users u')).toBe(false);
      expect(ran('DELETE FROM sales')).toBe(false);
      expect(dayCloseAudit()?.changes.drafts_discarded).toEqual({
        old: null,
        new: 0,
      });
      expect(dayCloseAudit()?.description).not.toContain('Unpaid drafts');
    });

    it('any payment protects its draft: the check has no method or amount filter (CASH, card, split, TRADE_IN, zero)', async () => {
      // Payment rows of any kind are just rows here: the check asks only
      // whether one exists.
      fixtures.saleRows = [
        saleRow({ id: 'draft-cash', payments: ['p-cash'] }),
        saleRow({ id: 'draft-split', payments: ['p-card', 'p-cash-2'] }),
        saleRow({ id: 'draft-trade-in', payments: ['p-trade-in'] }),
        saleRow({ id: 'draft-zero', payments: ['p-zero'] }),
      ];

      const { body } = await refusal(
        service.close('day-1', closeDto(), cashier),
      );

      expect(body).toMatchObject({ code: 'OPEN_SALES', sale_count: 4 });
      // No payment detail in the refusal.
      expect(Object.keys(body).sort()).toEqual([
        'code',
        'message',
        'sale_count',
      ]);
      const check = queries[at('SELECT DISTINCT p.sale_id')];
      expect(check.sql).toContain('FROM payments p');
      expect(check.sql).toContain('p.sale_id = ANY($1::uuid[])');
      expect(check.sql).not.toMatch(/payment_method|amount|status/);
    });

    it('a paid draft next to unpaid ones: nothing deleted, no DRAFT_DISCARDED, the day stays open', async () => {
      fixtures.saleRows = [
        saleRow({ id: 'draft-a' }),
        saleRow({ id: 'draft-b', lines: [glassLine] }),
        saleRow({
          id: 'draft-old-paid',
          cashier_id: 'cashier-2',
          created_at: new Date('2026-10-01T09:00:00Z'),
          payments: ['p-trade-in'],
        }),
      ];

      const { body } = await refusal(
        service.close('day-1', closeDto(), cashier),
      );

      expect(body).toMatchObject({ code: 'OPEN_SALES', sale_count: 1 });
      expect(ids()).toEqual(['draft-a', 'draft-b', 'draft-old-paid']);
      expect(ran('DELETE FROM sales')).toBe(false);
      expect(ran('LEFT JOIN users u')).toBe(false);
      expect(audits()).toEqual([]);
      expect(fixtures.days[0].closed_at).toBeNull();
      // Refused before the cash-day row was locked or the figures read.
      expect(dayLockAt).toBe(-1);
      expect(ran('-- cash day:')).toBe(false);
    });

    it('locks in order: draft lock, drafts by id, payments in their own statement, day row; discards after every check', async () => {
      fixtures.saleRows = [
        saleRow({ id: 'draft-b' }),
        saleRow({ id: 'draft-a' }),
      ];

      await service.close('day-1', closeDto(), cashier);

      // The branch's draft lock, exclusive, with the branch id.
      const lock = queries[at('pg_advisory_xact_lock')];
      expect(lock.sql).toBe(DRAFTS_LOCK_SQL);
      expect(lock.sql).toContain(`hashtext('sale_drafts:' || $1::text)`);
      expect(lock.sql).not.toContain('_shared');
      expect(lock.params).toEqual(['branch-1']);

      const lockAt = at('pg_advisory_xact_lock');
      const draftsAt = at('FOR UPDATE OF s');
      const paymentsAt = at('SELECT DISTINCT p.sale_id');
      const summaryAt = at('-- cash day: counts');
      const deleteAt = at('DELETE FROM sales');
      const closeAt = at('UPDATE cash_days');
      // The locking statement reads no payment: a FOR UPDATE that waited
      // re-checks only its row, so payments are read after, fresh.
      expect(queries[draftsAt].sql).not.toContain('payments');
      expect(lockAt).toBeLessThan(draftsAt);
      expect(draftsAt).toBeLessThan(paymentsAt);
      expect(paymentsAt).toBeLessThan(dayLockAt);
      expect(dayLockAt).toBeLessThan(summaryAt);
      expect(summaryAt).toBeLessThan(deleteAt);
      expect(deleteAt).toBeLessThan(closeAt);
      expect(queries.slice(lockAt).every((q) => q.inTx)).toBe(true);
      expect(queries[deleteAt].params).toEqual([['draft-a', 'draft-b']]);
    });

    it('a refusal after the locks (EXPECTED_CHANGED, REASON_REQUIRED, DAY_ALREADY_CLOSED) discards nothing', async () => {
      const drafts = () => [saleRow({ id: 'draft-a', lines: [glassLine] })];

      fixtures.saleRows = drafts();
      const changed = await refusal(
        service.close('day-1', closeDto({ expected_seen: 1 }), cashier),
      );
      expect(changed.body.code).toBe('EXPECTED_CHANGED');

      const reason = await refusal(
        service.close('day-1', closeDto({ counted_balance: 15000 }), cashier),
      );
      expect(reason.body.code).toBe('REASON_REQUIRED');

      fixtures.days[0] = closedDay();
      const closed = await refusal(service.close('day-1', closeDto(), cashier));
      expect(closed.body.code).toBe('DAY_ALREADY_CLOSED');

      expect(ids()).toEqual(['draft-a']);
      expect(ran('DELETE FROM sales')).toBe(false);
      expect(audits()).toEqual([]);
    });

    it('a failing DRAFT_DISCARDED write rolls back the discard and the close', async () => {
      fixtures.saleRows = [
        saleRow({ id: 'draft-a' }),
        saleRow({ id: 'draft-b' }),
      ];
      rollingBack();
      mockAuditRepo.save
        .mockImplementationOnce(() => {
          auditInTx.push(inTx);
          return Promise.resolve({});
        })
        .mockImplementationOnce(() => {
          auditInTx.push(inTx);
          return Promise.reject(new Error('audit write failed'));
        });

      await expect(service.close('day-1', closeDto(), cashier)).rejects.toThrow(
        'audit write failed',
      );

      // Everything was written through the transaction that failed.
      expect(queries[at('DELETE FROM sales')].inTx).toBe(true);
      expect(auditInTx).toEqual([true, true]);
      expect(ran('UPDATE cash_days')).toBe(false);
      expect(ids()).toEqual(['draft-a', 'draft-b']);
      expect(fixtures.days[0].closed_at).toBeNull();
    });

    it('a failing cash-day UPDATE rolls back the discard and its DRAFT_DISCARDED rows', async () => {
      fixtures.saleRows = [saleRow({ id: 'draft-a', lines: [glassLine] })];
      fixtures.failCloseUpdate = true;
      rollingBack();

      await expect(service.close('day-1', closeDto(), cashier)).rejects.toThrow(
        'UPDATE cash_days failed',
      );

      expect(queries[at('DELETE FROM sales')].inTx).toBe(true);
      expect(draftAudits()).toHaveLength(1);
      expect(auditInTx).toEqual([true]);
      expect(dayCloseAudit()).toBeUndefined();
      expect(ids()).toEqual(['draft-a']);
      expect(fixtures.days[0].closed_at).toBeNull();
    });

    it('fewer rows deleted than drafts locked throws, writes no audit and rolls back', async () => {
      fixtures.saleRows = [
        saleRow({ id: 'draft-a' }),
        saleRow({ id: 'draft-b' }),
      ];
      rollingBack();
      // Can't happen with the drafts locked; if it ever did, the close
      // must not go through on a partial discard.
      const answer = mockManager.query.getMockImplementation()!;
      mockManager.query.mockImplementation(
        (sql: string, params?: unknown[]) => {
          if (sql.includes('DELETE FROM sales')) {
            queries.push({ sql, params: params ?? [], inTx });
            return Promise.resolve([[], 1]);
          }
          return answer(sql, params);
        },
      );

      await expect(service.close('day-1', closeDto(), cashier)).rejects.toThrow(
        '1 of 2 locked drafts discarded',
      );

      expect(audits()).toEqual([]);
      expect(ran('UPDATE cash_days')).toBe(false);
      expect(ids()).toEqual(['draft-a', 'draft-b']);
    });

    it('a resend of a close that discarded drafts gets the closed day; nothing discarded or audited again', async () => {
      fixtures.saleRows = [saleRow({ id: 'draft-a' })];
      await service.close('day-1', closeDto(), cashier);
      expect(draftAudits()).toHaveLength(1);
      const auditCount = audits().length;
      fixtures.saleRows = [saleRow({ id: 'draft-later' })];
      queries = [];

      const day = await service.close('day-1', closeDto(), cashier);

      expect(day.closed_at).not.toBeNull();
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(audits()).toHaveLength(auditCount);
      expect(ran('pg_advisory_xact_lock')).toBe(false);
      expect(ids()).toEqual(['draft-later']);
    });

    it('a resend recorded by the time its transaction starts returns before any draft is locked', async () => {
      fixtures.saleRows = [saleRow({ id: 'draft-a' })];
      mockDataSource.transaction.mockImplementationOnce(
        async (cb: (m: typeof mockManager) => unknown) => {
          // The first request commits while this one waits to start.
          fixtures.days[0] = closedDay({
            close_client_request_id: 'close-crid-new',
          });
          inTx = true;
          try {
            return await cb(mockManager);
          } finally {
            inTx = false;
          }
        },
      );

      const day = await service.close('day-1', closeDto(), cashier);

      expect(day.closed_at).not.toBeNull();
      expect(ran('pg_advisory_xact_lock')).toBe(false);
      expect(ran('DELETE FROM sales')).toBe(false);
      expect(audits()).toEqual([]);
      expect(ids()).toEqual(['draft-a']);
    });

    it('never touches stock, units, payments or lines directly, nor the figures', async () => {
      fixtures.saleRows = [
        saleRow({ id: 'draft-a', lines: [glassLine, phoneLine] }),
      ];

      const day = await service.close('day-1', closeDto(), cashier);

      const writes = queries.filter((q) =>
        /^\s*(INSERT|UPDATE|DELETE)/i.test(q.sql),
      );
      expect(
        writes.map((q) => q.sql.trim().split(/\s+/).slice(0, 3).join(' ')),
      ).toEqual(['DELETE FROM sales', 'UPDATE cash_days SET']);
      expect(queries.some((q) => /\bstock\b|product_units/.test(q.sql))).toBe(
        false,
      );
      // The figures are the same as a close with no drafts.
      expect(day).toMatchObject({
        cash_sales: '12000.00',
        cash_refunds: '1500.00',
        expected_balance: '15500.00',
        difference: '0.00',
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
