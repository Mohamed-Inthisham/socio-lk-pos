import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { assertDayOpen } from './day-gate';
import { TODAY_SQL } from './cash-days.service';

/**
 * The day gate (Phase 6.4 P9-9, P9-10, C10, C11): its queries and its
 * verdict. The services' call order is in sales.service.spec.ts and
 * sale-returns.service.spec.ts; the locking itself in
 * test/cash-days-enforcement.e2e-spec.ts.
 */
describe('assertDayOpen', () => {
  const query = jest.fn<Promise<unknown>, [string, unknown[]?]>();
  const manager = { query } as unknown as EntityManager;

  /** The manager answers today, then the day rows. */
  const arrange = (rows: { id: string; closed_at: Date | null }[]) => {
    query
      .mockResolvedValueOnce([{ today: '2026-10-25' }])
      .mockResolvedValueOnce(rows);
  };

  const daySql = (): string => query.mock.calls[1][0];
  const whereOf = (sql: string): string => sql.slice(sql.indexOf('WHERE'));

  beforeEach(() => {
    query.mockReset();
  });

  it('reads today first, then selects the day by branch and that date', async () => {
    arrange([{ id: 'day-1', closed_at: null }]);

    await assertDayOpen(manager, 'branch-1', { lock: true });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]).toEqual([TODAY_SQL]);
    expect(daySql()).toContain('FROM cash_days');
    expect(query.mock.calls[1][1]).toEqual(['branch-1', '2026-10-25']);
  });

  it('with lock: FOR SHARE, and no closed_at filter in the WHERE', async () => {
    arrange([{ id: 'day-1', closed_at: null }]);

    await assertDayOpen(manager, 'branch-1', { lock: true });

    expect(daySql()).toMatch(/FOR SHARE\s*$/);
    expect(whereOf(daySql())).not.toContain('closed_at');
  });

  it('without lock: no row lock, and no closed_at filter either', async () => {
    arrange([{ id: 'day-1', closed_at: null }]);

    await assertDayOpen(manager, 'branch-1', { lock: false });

    expect(daySql()).not.toContain('FOR ');
    expect(whereOf(daySql())).not.toContain('closed_at');
  });

  it('an open day passes', async () => {
    arrange([{ id: 'day-1', closed_at: null }]);

    await expect(
      assertDayOpen(manager, 'branch-1', { lock: true }),
    ).resolves.toBeUndefined();
  });

  it.each([true, false])(
    'no record for today is 409 DAY_NOT_OPEN with business_date (lock: %s)',
    async (lock) => {
      arrange([]);

      const err = await assertDayOpen(manager, 'branch-1', { lock }).catch(
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual({
        message:
          "Today (2026-10-25) hasn't been opened. Enter the opening balance first.",
        code: 'DAY_NOT_OPEN',
        business_date: '2026-10-25',
      });
    },
  );

  it.each([true, false])(
    'a closed day is 409 DAY_CLOSED with business_date (lock: %s)',
    async (lock) => {
      arrange([{ id: 'day-1', closed_at: new Date('2026-10-25T13:00:00Z') }]);

      const err = await assertDayOpen(manager, 'branch-1', { lock }).catch(
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual({
        message:
          "Today (2026-10-25) is closed. No sales, voids or returns until tomorrow's opening.",
        code: 'DAY_CLOSED',
        business_date: '2026-10-25',
      });
    },
  );
});
