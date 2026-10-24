import {
  REASON_THRESHOLD_CENTS,
  describeDifference,
  describeDifferenceForDisplay,
  differenceCents,
  needsReason,
  settleReason,
} from "./cashDayMath";

// ---------------------------------------------------------------------------
// The server's cases, copied verbatim from
// backend/src/cash-days/cash-day-math.spec.ts: settleReason lines 47–93,
// describeDifference lines 124–139 (P9-11, C9, the rounding rule). Keep
// them identical: change them only together with it.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Frontend only
// ---------------------------------------------------------------------------

// formatLKR puts a no-break space (U+00A0) between "LKR" and the amount.
const LKR = `LKR${String.fromCharCode(0xa0)}`;

describe("describeDifferenceForDisplay (the till's wording, formatLKR)", () => {
  it.each([
    [0, "Exact"],
    [-50, `Rounding ${LKR}0.50`],
    [50, `Rounding ${LKR}0.50`],
    [-99, `Rounding ${LKR}0.99`],
    [-100, `Short ${LKR}1.00`],
    [100, `Over ${LKR}1.00`],
    [-150000, `Short ${LKR}1,500.00`],
    [12345678, `Over ${LKR}123,456.78`],
  ])("%i cents → %s", (cents, words) => {
    expect(describeDifferenceForDisplay(cents)).toBe(words);
  });

  it("uses the same words as describeDifference, only the amount formatted", () => {
    for (const cents of [0, -50, 50, -99, -100, 100, -10000, 5050]) {
      expect(describeDifferenceForDisplay(cents).replaceAll(LKR, "LKR ")).toBe(describeDifference(cents));
    }
  });
});

describe("differenceCents", () => {
  it("is counted − the server's expected, in cents (negative = short)", () => {
    expect(differenceCents(1540000, "15500.00")).toBe(-10000);
    expect(differenceCents(1550050, "15500.00")).toBe(50);
    expect(differenceCents(1550000, "15500.00")).toBe(0);
  });

  it("subtracts exactly where floats would not (100.30 − 50.10)", () => {
    expect(differenceCents(10030, "50.10")).toBe(5020);
  });

  it("works with a negative expected balance", () => {
    expect(differenceCents(0, "-25.00")).toBe(2500);
  });

  it("is NaN while the counted cash isn't a number yet", () => {
    expect(differenceCents(NaN, "15500.00")).toBeNaN();
  });
});

describe("needsReason (the reason box)", () => {
  it("shows from 1.00 either way, the server's threshold", () => {
    expect(REASON_THRESHOLD_CENTS).toBe(100);
    expect([0, 99, -99, 100, -100, -150000].map(needsReason)).toEqual([false, false, false, true, true, true]);
  });

  it("agrees with settleReason at every boundary", () => {
    for (const cents of [0, 99, -99, 100, -100]) {
      expect(needsReason(cents)).toBe(!settleReason(cents, undefined).ok);
    }
  });

  it("stays hidden while the counted cash isn't a number", () => {
    expect(needsReason(NaN)).toBe(false);
  });
});
