import {
  centsByMethod,
  describeDifference,
  expectedCents,
  settleReason,
  tenderTotals,
} from './cash-day-math';
import { PaymentMethod } from '../sales/enums/payment-method.enum';

/** The cash day's arithmetic (Phase 6.4 P9-5, P9-6, P9-11, C9). */
describe('cash-day-math', () => {
  describe('expectedCents', () => {
    it('P9-5: 5,000.00 + 12,000.00 − 1,500.00 − 0 = 15,500.00', () => {
      expect(
        expectedCents({
          openingCents: 500000,
          cashSalesCents: 1200000,
          cashRefundsCents: 150000,
          cashVoidsEarlierCents: 0,
        }),
      ).toBe(1550000);
    });

    it('P9-6: 15,500.00 + 8,000.00 − 0 − 12,000.00 = 11,500.00', () => {
      expect(
        expectedCents({
          openingCents: 1550000,
          cashSalesCents: 800000,
          cashRefundsCents: 0,
          cashVoidsEarlierCents: 1200000,
        }),
      ).toBe(1150000);
    });

    it('may be negative', () => {
      expect(
        expectedCents({
          openingCents: 0,
          cashSalesCents: 0,
          cashRefundsCents: 2500,
          cashVoidsEarlierCents: 0,
        }),
      ).toBe(-2500);
    });
  });

  describe('settleReason', () => {
    it('a zero difference stores null, whatever was sent', () => {
      expect(settleReason(0, undefined)).toEqual({ ok: true, reason: null });
      expect(settleReason(0, null)).toEqual({ ok: true, reason: null });
      expect(settleReason(0, 'ok')).toEqual({ ok: true, reason: null });
      expect(settleReason(0, 'Counted twice, all fine')).toEqual({
        ok: true,
        reason: null,
      });
    });

    it('a difference of 1.00 or more needs 3+ characters after trimming', () => {
      expect(settleReason(-10000, undefined)).toEqual({ ok: false });
      expect(settleReason(-10000, null)).toEqual({ ok: false });
      expect(settleReason(5000, 'ab')).toEqual({ ok: false });
      expect(settleReason(5000, '  ab  ')).toEqual({ ok: false });
      expect(settleReason(5000, 'abc')).toEqual({ ok: true, reason: 'abc' });
    });

    it('the rounding rule: under 1.00 either way needs no reason and stores null; 1.00 needs one', () => {
      for (const cents of [0, 99, -99]) {
        expect(settleReason(cents, undefined)).toEqual({
          ok: true,
          reason: null,
        });
        expect(settleReason(cents, 'Coins short')).toEqual({
          ok: true,
          reason: null,
        });
      }
      for (const cents of [100, -100]) {
        expect(settleReason(cents, undefined)).toEqual({ ok: false });
        expect(settleReason(cents, 'ab')).toEqual({ ok: false });
        expect(settleReason(cents, 'Coins short')).toEqual({
          ok: true,
          reason: 'Coins short',
        });
      }
    });

    it('stores the reason trimmed', () => {
      expect(settleReason(-10000, '  Float miscounted  ')).toEqual({
        ok: true,
        reason: 'Float miscounted',
      });
    });
  });

  describe('centsByMethod and tenderTotals', () => {
    it('sums the rows in exact cents', () => {
      const byMethod = centsByMethod([
        { method: PaymentMethod.CASH, total: '0.10' },
        { method: PaymentMethod.CASH, total: '0.20' },
        { method: PaymentMethod.CARD, total: '500.00' },
      ]);
      expect(byMethod.get(PaymentMethod.CASH)).toBe(30);
      expect(byMethod.get(PaymentMethod.CARD)).toBe(50000);
      expect(byMethod.has(PaymentMethod.KOKO)).toBe(false);
    });

    it('lists every non-cash tender, "0.00" when absent, never CASH or TRADE_IN', () => {
      const totals = tenderTotals(
        centsByMethod([
          { method: PaymentMethod.CASH, total: '12000.00' },
          { method: PaymentMethod.CARD, total: '500.00' },
          { method: PaymentMethod.TRADE_IN, total: '30000.00' },
        ]),
      );
      expect(totals).toEqual({
        CARD: '500.00',
        BANK_TRANSFER: '0.00',
        KOKO: '0.00',
        MINTPAY: '0.00',
      });
    });
  });

  describe('describeDifference', () => {
    it('short, over or exact', () => {
      expect(describeDifference(-10000)).toBe('Short LKR 100.00');
      expect(describeDifference(5050)).toBe('Over LKR 50.50');
      expect(describeDifference(0)).toBe('Exact');
    });

    it('the rounding rule: "Rounding" under 1.00 either way, "Exact" only at 0.00', () => {
      expect(describeDifference(0)).toBe('Exact');
      expect(describeDifference(-50)).toBe('Rounding LKR 0.50');
      expect(describeDifference(50)).toBe('Rounding LKR 0.50');
      expect(describeDifference(-99)).toBe('Rounding LKR 0.99');
      expect(describeDifference(-100)).toBe('Short LKR 1.00');
      expect(describeDifference(100)).toBe('Over LKR 1.00');
    });
  });
});
