import { refundShareCents, tradeInShareCents } from './return-math';

describe('refundShareCents (P7-3)', () => {
  // 3 × 1000.00 with 100.00 off: line_total 2900.00.
  const L = 290000;

  it('shares a discounted line one unit at a time, adding up to the line total', () => {
    const first = refundShareCents(L, 3, 0, 1);
    const second = refundShareCents(L, 3, 1, 1);
    const third = refundShareCents(L, 3, 2, 1);

    expect([first, second, third]).toEqual([96667, 96666, 96667]);
    expect(first + second + third).toBe(L);
  });

  it('two units then one gives the same total', () => {
    const two = refundShareCents(L, 3, 0, 2);
    const last = refundShareCents(L, 3, 2, 1);

    expect(two).toBe(193333);
    expect(last).toBe(96667);
    expect(two + last).toBe(L);
  });

  it('the whole line at once is the line total', () => {
    expect(refundShareCents(L, 3, 0, 3)).toBe(L);
  });

  it('rounds an exact half-cent up', () => {
    // 10.01 over 2 units: 5.005 → 5.01, then 5.00.
    expect(refundShareCents(1001, 2, 0, 1)).toBe(501);
    expect(refundShareCents(1001, 2, 1, 1)).toBe(500);
  });

  it('a free line shares nothing', () => {
    expect(refundShareCents(0, 4, 1, 2)).toBe(0);
  });

  it('stays exact beyond 2^53', () => {
    // 9,999,999,999.99 (the numeric(12,2) maximum) over 7 units.
    const big = 999999999999;
    let sum = 0;
    for (let r = 0; r < 7; r++) sum += refundShareCents(big, 7, r, 1);
    expect(sum).toBe(big);
  });

  it('every way of splitting a line adds up to its total', () => {
    const totals = [1, 99, 1001, 290000, 333333, 1234567];
    for (const total of totals) {
      for (let q = 1; q <= 7; q++) {
        // Return in chunks of 1, 2, … and check the sum each time.
        for (let chunk = 1; chunk <= q; chunk++) {
          let r = 0;
          let sum = 0;
          while (r < q) {
            const k = Math.min(chunk, q - r);
            const share = refundShareCents(total, q, r, k);
            expect(share).toBeGreaterThanOrEqual(0);
            sum += share;
            r += k;
          }
          expect(sum).toBe(total);
        }
      }
    }
  });
});

describe('tradeInShareCents (P7-5)', () => {
  it('a full cash refund of a trade-in sale includes the trade-in value', () => {
    // Total 50,000: TRADE_IN 30,000 + CASH 20,000; refund 50,000 in cash.
    expect(tradeInShareCents(5000000, 2000000, 0)).toBe(3000000);
  });

  it('is 0 while the non-trade-in money covers the refund', () => {
    expect(tradeInShareCents(1500000, 2000000, 0)).toBe(0);
  });

  it('counts earlier refunds against the non-trade-in money', () => {
    // 15,000 refunded before; 20,000 more now: 15,000 of it is trade-in.
    expect(tradeInShareCents(2000000, 2000000, 1500000)).toBe(1500000);
  });

  it('earlier refunds above the non-trade-in money: never more than the refund', () => {
    // 65,590 refunded before against 30,290 non-trade-in; 1,600 more now:
    // all of it is trade-in money (1,600), not 1,600 − (30,290 − 65,590).
    expect(tradeInShareCents(160000, 3029000, 6559000)).toBe(160000);
  });
});
