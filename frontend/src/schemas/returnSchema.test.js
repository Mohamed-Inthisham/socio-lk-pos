import {
  LOWER_REFUND_MESSAGE,
  OTHER,
  RETURN_REASONS,
  amountCents,
  buildReturnPayload,
  buildReturnReason,
  buildReturnSchema,
  defaultRefundRows,
  itemsIssues,
  refundIssues,
  refundTotalCents,
  returnContext,
  returnFormDefaults,
} from "./returnSchema";
import { formatLKR } from "../utils/money";
import { paymentEntity, saleEntity } from "../test/saleEntities";
import { CLIENT_REQUEST_ID, saleWithReturnsEntity } from "../test/returnEntities";

// saleEntity: phone 63,990 (within warranty on the 23rd), 2 cases 3,200
// (Checking: outside), charger 1,600 (within), cable 1,500 (No
// warranty: outside; its product isn't stock-tracked here). Card payment
// 10,000.
const TODAY = "2026-10-23";
const STOCK_TRACKED = { "p-a15": true, "p-case": true, "p-charger": true, "p-cable": false };

const contextFor = (sale = saleEntity(), opts = {}) =>
  returnContext(sale, { stockTracked: STOCK_TRACKED, today: TODAY, ...opts });

// The fixture return (returnEntities saleReturnView): the phone and one case.
const valid = (overrides = {}) => ({
  ...returnFormDefaults(saleEntity(), { approverId: "user-manager" }),
  quantities: { "line-phone": 1, "line-case": 1, "line-charger": 0, "line-cable": 0 },
  conditions: { "line-phone": "", "line-case": "RESALEABLE", "line-charger": "", "line-cable": "" },
  reason_preset: "FAULTY",
  reason_detail: "screen flickers",
  override_reason: "Case split at the seam on day two",
  refunds: [
    { method: "CARD", payment_id: "pay-card", reference: "REV-482913", amount: "10000" },
    { method: "CASH", payment_id: "", reference: "", amount: "55590.00" },
  ],
  pin: "482915",
  ...overrides,
});

const issues = (values, context = contextFor()) => {
  const result = buildReturnSchema(context).safeParse(values);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("RETURN_REASONS", () => {
  it("lists the five presets in order, keys 1–5", () => {
    expect(RETURN_REASONS.map((r) => [r.key, r.label])).toEqual([
      ["1", "Faulty item"],
      ["2", "Wrong item or doesn't fit"],
      ["3", "Changed their mind"],
      ["4", "Not as described"],
      ["5", "Other"],
    ]);
  });
});

describe("buildReturnReason", () => {
  it("the preset alone, the preset and detail, the detail alone for Other", () => {
    expect(buildReturnReason({ reason_preset: "CHANGED_MIND", reason_detail: "  " })).toBe("Changed their mind");
    expect(buildReturnReason({ reason_preset: "FAULTY", reason_detail: " screen flickers " })).toBe(
      "Faulty item — screen flickers",
    );
    expect(buildReturnReason({ reason_preset: OTHER, reason_detail: " Gift, wrong colour " })).toBe("Gift, wrong colour");
  });
});

describe("amountCents and refundTotalCents", () => {
  it("reads typed amounts in cents, NaN for anything else", () => {
    expect(amountCents("1500")).toBe(150000);
    expect(amountCents(" 1499.8 ")).toBe(149980);
    expect(amountCents("966.67")).toBe(96667);
    expect(amountCents("1,500")).toBeNaN();
    expect(amountCents("1.234")).toBeNaN();
    expect(amountCents("-5")).toBeNaN();
    expect(amountCents("")).toBeNaN();
  });

  it("sums the valid rows", () => {
    expect(refundTotalCents([{ amount: "0.10" }, { amount: "0.20" }, { amount: "x" }])).toBe(30);
  });
});

describe("buildReturnSchema", () => {
  it("accepts the fixture return", () => {
    expect(issues(valid())).toEqual({});
  });

  describe("items", () => {
    it("needs at least one item", () => {
      expect(issues(valid({ quantities: { "line-phone": 0, "line-case": 0 }, refunds: [] }))).toMatchObject({
        quantities: "Pick at least one item to return",
      });
    });

    it("no more than is left of a line", () => {
      expect(issues(valid({ quantities: { "line-phone": 1, "line-case": 3 } }))).toMatchObject({
        "quantities.line-case": "At most 2",
      });
      const returned = contextFor(saleWithReturnsEntity());
      expect(issues(valid({ refunds: [], reason_detail: "x lower" }), returned)).toMatchObject({
        "quantities.line-phone": "Already returned",
      });
    });

    it("a line that isn't on the sale", () => {
      expect(issues(valid({ quantities: { "line-phone": 1, "line-other": 1 } }))).toMatchObject({
        "quantities.line-other": "Not on this sale",
      });
    });

    it("a tracked item from our stock needs Back to stock or Damaged", () => {
      expect(issues(valid({ conditions: { "line-case": "" } }))).toMatchObject({
        "conditions.line-case": "Back to stock or damaged?",
      });
    });

    it("a phone and an untracked product need none", () => {
      const values = valid({
        quantities: { "line-phone": 1, "line-cable": 1 },
        conditions: {},
        refunds: [{ method: "CASH", payment_id: "", reference: "", amount: "65490.00" }],
      });
      expect(issues(values)).toEqual({});
    });
  });

  describe("refunds (P7-3, P7-4)", () => {
    it("the total may be the refund due, never more", () => {
      const over = valid({
        refunds: [{ method: "CASH", payment_id: "", reference: "", amount: "65590.01" }],
      });
      expect(issues(over)).toMatchObject({ refunds: `The refund can be at most ${formatLKR("65590.00")}` });
    });

    it("a lower refund needs the reason detail to say why", () => {
      const lower = { refunds: [{ method: "CASH", payment_id: "", reference: "", amount: "60000" }] };
      expect(issues(valid({ ...lower, reason_detail: "" }))).toMatchObject({ reason_detail: LOWER_REFUND_MESSAGE });
      expect(issues(valid({ ...lower, reason_detail: "Scratched back, agreed 60,000" }))).toEqual({});
    });

    it("no refund at all is a lower refund too", () => {
      expect(issues(valid({ refunds: [], reason_detail: "" }))).toMatchObject({ reason_detail: LOWER_REFUND_MESSAGE });
      expect(issues(valid({ refunds: [], reason_detail: "Store policy, no refund" }))).toEqual({});
    });

    it("amounts must be positive with at most 2 decimals", () => {
      const card = (amount) => [{ method: "CARD", payment_id: "pay-card", reference: "REV-1", amount }];
      const cash = (amount) => [{ method: "CASH", payment_id: "", reference: "", amount }];
      expect(issues(valid({ refunds: card("0") }))).toMatchObject({ "refunds.0.amount": "Amount must be more than 0" });
      expect(issues(valid({ refunds: card("") }))).toMatchObject({
        "refunds.0.amount": "Enter an amount like 1500 or 1499.80",
      });
      expect(issues(valid({ refunds: cash("10.005") }))).toMatchObject({
        "refunds.0.amount": "Enter an amount like 1500 or 1499.80",
      });
    });

    it("a cash row left empty or at 0 is no cash: the refund is lower, not wrong", () => {
      const cash = (amount) => ({ method: "CASH", payment_id: "", reference: "", amount });
      for (const amount of ["", "  ", "0", "0.00"]) {
        const found = issues(valid({ refunds: [cash(amount)], reason_detail: "" }));
        expect(found).not.toHaveProperty("refunds.0.amount");
        expect(found).toMatchObject({ reason_detail: LOWER_REFUND_MESSAGE });
      }
      expect(issues(valid({ refunds: [cash("")], reason_detail: "Agreed with the customer" }))).toEqual({});
    });

    it("cash takes no payment or reference, and appears once", () => {
      const cash = { method: "CASH", payment_id: "", reference: "", amount: "100" };
      expect(issues(valid({ refunds: [cash, cash] }))).toMatchObject({
        "refunds.1.method": "Cash is already on another row",
      });
      expect(issues(valid({ refunds: [{ ...cash, reference: "R-1" }] }))).toMatchObject({
        "refunds.0.method": "A cash refund has no payment or reference",
      });
    });

    it("non-cash goes back to this sale's payment of that method, once, with a reference", () => {
      const card = { method: "CARD", payment_id: "pay-card", reference: "REV-1", amount: "100" };
      expect(issues(valid({ refunds: [{ ...card, payment_id: "pay-ti" }] }))).toMatchObject({
        "refunds.0.payment_id": "Pick a card, bank, Koko or Mintpay payment of this sale",
      });
      expect(issues(valid({ refunds: [{ ...card, method: "KOKO" }] }))).toMatchObject({
        "refunds.0.payment_id": "Pick a card, bank, Koko or Mintpay payment of this sale",
      });
      expect(issues(valid({ refunds: [card, card] }))).toMatchObject({
        "refunds.1.payment_id": "This payment is already on another row",
      });
      expect(issues(valid({ refunds: [{ ...card, reference: "  " }] }))).toMatchObject({
        "refunds.0.reference": "Enter the reversal's reference",
      });
      expect(issues(valid({ refunds: [{ ...card, reference: "R".repeat(101) }] }))).toMatchObject({
        "refunds.0.reference": "At most 100 characters",
      });
    });

    it("a payment takes no more than is left of it", () => {
      const card = (amount) => ({ method: "CARD", payment_id: "pay-card", reference: "REV-2", amount });
      expect(issues(valid({ refunds: [card("10000.01")] }))).toMatchObject({
        "refunds.0.amount": `At most ${formatLKR("10000.00")} can go back to this payment`,
      });

      // After the fixture return took 10,000.00 back to the card, nothing is left.
      const sale = saleWithReturnsEntity();
      const charger = {
        quantities: { "line-charger": 1 },
        conditions: { "line-charger": "DAMAGED" },
        reason_detail: "",
        override_reason: "",
      };
      expect(issues(valid({ ...charger, refunds: [card("1600")] }), contextFor(sale))).toMatchObject({
        "refunds.0.amount": `At most ${formatLKR("0.00")} can go back to this payment`,
      });
      expect(
        issues(valid({ ...charger, refunds: [{ method: "CASH", payment_id: "", reference: "", amount: "1600" }] }), contextFor(sale)),
      ).toEqual({});
    });
  });

  describe("reason", () => {
    it("needs a preset; Other needs a detail", () => {
      expect(issues(valid({ reason_preset: "" }))).toMatchObject({ reason_preset: "Pick a reason" });
      expect(issues(valid({ reason_preset: OTHER, reason_detail: "ab" }))).toMatchObject({
        reason_detail: "Say what happened (at least 3 characters)",
      });
    });

    it("at most 500 characters as sent", () => {
      // "Faulty item — " is 14 characters
      expect(issues(valid({ reason_detail: "x".repeat(486) }))).toEqual({});
      expect(issues(valid({ reason_detail: "x".repeat(487) }))).toMatchObject({
        reason_detail: "The reason must be 500 characters or fewer (now 501)",
      });
    });
  });

  describe("override reason (P7-23)", () => {
    const withinOnly = {
      quantities: { "line-phone": 1, "line-charger": 1 },
      conditions: { "line-charger": "RESALEABLE" },
      refunds: [{ method: "CASH", payment_id: "", reference: "", amount: "65590" }],
    };

    it("required when a selected line is outside warranty", () => {
      expect(issues(valid({ override_reason: "  " }))).toMatchObject({
        override_reason: "Outside warranty: give the override reason (at least 3 characters)",
      });
      expect(issues(valid({ override_reason: "y".repeat(501) }))).toMatchObject({
        override_reason: "At most 500 characters (now 501)",
      });
    });

    it("not needed when every selected line is within warranty", () => {
      expect(issues(valid({ ...withinOnly, override_reason: "" }))).toEqual({});
    });

    it("required for the lines the server says are outside (OVERRIDE_REASON_REQUIRED)", () => {
      const context = contextFor(saleEntity(), { serverOutsideIds: ["line-charger"] });
      expect(issues(valid({ ...withinOnly, override_reason: "" }), context)).toMatchObject({
        override_reason: "Outside warranty: give the override reason (at least 3 characters)",
      });
    });
  });

  it("needs an approver and a 6-digit PIN", () => {
    expect(issues(valid({ approver_id: "", pin: "12345" }))).toMatchObject({
      approver_id: "Pick who approves",
      pin: "PIN must be 6 digits",
    });
  });
});

describe("itemsIssues and refundIssues (the dialog's two steps)", () => {
  const paths = (list) => list.map((i) => i.path.join("."));

  it("the items step checks only the items: the refund step's empty fields don't count", () => {
    const itemsOnly = valid({ reason_preset: "", reason_detail: "", override_reason: "", refunds: [], pin: "" });
    expect(itemsIssues(itemsOnly, contextFor())).toEqual([]);
    expect(paths(itemsIssues(valid({ conditions: { "line-case": "" } }), contextFor()))).toEqual(["conditions.line-case"]);
  });

  it("the refund step checks the refunds, the reason and the override, never the items", () => {
    const noCondition = valid({ conditions: { "line-case": "" }, override_reason: "", refunds: [], reason_detail: "" });
    expect(paths(refundIssues(noCondition, contextFor()))).toEqual(["reason_detail", "override_reason"]);
  });

  it("the schema reports both", () => {
    const both = valid({ conditions: { "line-case": "" }, override_reason: "" });
    expect(Object.keys(issues(both))).toEqual(["conditions.line-case", "override_reason"]);
  });
});

describe("defaultRefundRows (refunds start the way the sale was paid)", () => {
  const card = (id, amount, ref = "AUTH-1") =>
    paymentEntity({ id, payment_method: "CARD", amount, reference_number: ref });
  const koko = (id, amount) => paymentEntity({ id, payment_method: "KOKO", amount, reference_number: "K-1" });
  const cashPaid = (amount) => paymentEntity({ id: "pay-cash", payment_method: "CASH", amount });
  const tradeIn = (amount) => paymentEntity({ id: "pay-ti", payment_method: "TRADE_IN", amount });
  const rowsFor = (payments, dueCents, sale = saleEntity({ payments })) =>
    defaultRefundRows(contextFor(sale), dueCents);
  const row = (method, amount, paymentId = "") => ({ method, payment_id: paymentId, reference: "", amount });

  it("a cash-only sale: one Cash row for the refund due", () => {
    expect(rowsFor([cashPaid("70290.00")], 6559000)).toEqual([row("CASH", "65590.00")]);
  });

  it("a card-only sale: one Card row for the refund due, no Cash", () => {
    expect(rowsFor([card("pay-card", "70290.00")], 6559000)).toEqual([row("CARD", "65590.00", "pay-card")]);
  });

  it("a mixed sale: the card up to its amount, the rest in Cash (the fixture)", () => {
    expect(rowsFor(saleEntity().payments, 6559000, saleEntity())).toEqual([
      row("CARD", "10000.00", "pay-card"),
      row("CASH", "55590.00"),
    ]);
  });

  it("several payments in the order paid, each up to what is left of it", () => {
    expect(rowsFor([koko("pay-koko", "3000.00"), card("pay-card", "5000.00"), cashPaid("2000.00")], 900000)).toEqual([
      row("KOKO", "3000.00", "pay-koko"),
      row("CARD", "5000.00", "pay-card"),
      row("CASH", "1000.00"),
    ]);
    // A refund due smaller than the first payment stays on it
    expect(rowsFor([koko("pay-koko", "3000.00"), card("pay-card", "5000.00")], 120000)).toEqual([
      row("KOKO", "1200.00", "pay-koko"),
    ]);
  });

  it("a trade-in sale: the trade-in's share goes to Cash, never to the trade-in", () => {
    expect(rowsFor([tradeIn("40000.00"), cashPaid("30290.00")], 6559000)).toEqual([row("CASH", "65590.00")]);
    expect(rowsFor([tradeIn("40000.00"), card("pay-card", "30290.00")], 6559000)).toEqual([
      row("CARD", "30290.00", "pay-card"),
      row("CASH", "35300.00"),
    ]);
  });

  it("a payment already refunded by an earlier return takes only what is left", () => {
    // The fixture return took the card's 10,000.00: the rest is cash.
    expect(defaultRefundRows(contextFor(saleWithReturnsEntity()), 160000)).toEqual([row("CASH", "1600.00")]);
  });

  it("nothing due: no rows", () => {
    expect(rowsFor([card("pay-card", "100.00")], 0)).toEqual([]);
  });
});

describe("returnFormDefaults", () => {
  it("every line at 0, nothing else filled in; the session's approver", () => {
    expect(returnFormDefaults(saleEntity(), { approverId: "user-manager" })).toEqual({
      quantities: { "line-phone": 0, "line-case": 0, "line-charger": 0, "line-cable": 0 },
      conditions: { "line-phone": "", "line-case": "", "line-charger": "", "line-cable": "" },
      reason_preset: "",
      reason_detail: "",
      override_reason: "",
      refunds: [],
      approver_id: "user-manager",
      pin: "",
    });
    expect(returnFormDefaults(saleEntity()).approver_id).toBe("");
  });
});

describe("buildReturnPayload", () => {
  it("is exactly CreateSaleReturnDto for the fixture return", () => {
    expect(buildReturnPayload(valid(), { clientRequestId: CLIENT_REQUEST_ID, context: contextFor() })).toEqual({
      client_request_id: CLIENT_REQUEST_ID,
      lines: [
        { sale_line_id: "line-phone", quantity: 1 },
        { sale_line_id: "line-case", quantity: 1, condition: "RESALEABLE" },
      ],
      refunds: [
        { method: "CARD", amount: 10000, original_payment_id: "pay-card", reference_number: "REV-482913" },
        { method: "CASH", amount: 55590 },
      ],
      reason: "Faulty item — screen flickers",
      override_reason: "Case split at the seam on day two",
      approval: { approver_id: "user-manager", pin: "482915" },
    });
  });

  it("each part carries only the server's keys", () => {
    const payload = buildReturnPayload(valid({ quantities: { "line-case": 1, "line-cable": 1 } }), {
      clientRequestId: CLIENT_REQUEST_ID,
      context: contextFor(),
    });
    expect(Object.keys(payload).sort()).toEqual([
      "approval",
      "client_request_id",
      "lines",
      "override_reason",
      "reason",
      "refunds",
    ]);
    // the untracked cable takes no condition
    expect(payload.lines).toEqual([
      { sale_line_id: "line-case", quantity: 1, condition: "RESALEABLE" },
      { sale_line_id: "line-cable", quantity: 1 },
    ]);
    expect(Object.keys(payload.refunds[1])).toEqual(["method", "amount"]);
    expect(Object.keys(payload.approval).sort()).toEqual(["approver_id", "pin"]);
  });

  it("amounts are numbers from cents, references trimmed", () => {
    const payload = buildReturnPayload(
      valid({
        refunds: [
          { method: "CARD", payment_id: "pay-card", reference: "  REV-9 ", amount: "966.67" },
          { method: "CASH", payment_id: "", reference: "", amount: "0.1" },
        ],
      }),
      { clientRequestId: CLIENT_REQUEST_ID, context: contextFor() },
    );
    expect(payload.refunds).toEqual([
      { method: "CARD", amount: 966.67, original_payment_id: "pay-card", reference_number: "REV-9" },
      { method: "CASH", amount: 0.1 },
    ]);
  });

  it("a cash row left empty or at 0 is not sent", () => {
    const payload = buildReturnPayload(
      valid({
        refunds: [
          { method: "CARD", payment_id: "pay-card", reference: "REV-1", amount: "10000" },
          { method: "CASH", payment_id: "", reference: "", amount: "" },
        ],
      }),
      { clientRequestId: CLIENT_REQUEST_ID, context: contextFor() },
    );
    expect(payload.refunds).toEqual([
      { method: "CARD", amount: 10000, original_payment_id: "pay-card", reference_number: "REV-1" },
    ]);
    const zero = buildReturnPayload(
      valid({ refunds: [{ method: "CASH", payment_id: "", reference: "", amount: "0" }] }),
      { clientRequestId: CLIENT_REQUEST_ID, context: contextFor() },
    );
    expect(zero.refunds).toEqual([]);
  });

  it("no override reason within warranty; an empty refund list when nothing is refunded", () => {
    const payload = buildReturnPayload(
      valid({ quantities: { "line-phone": 1 }, override_reason: "left over", refunds: [] }),
      { clientRequestId: CLIENT_REQUEST_ID, context: contextFor() },
    );
    expect(payload).not.toHaveProperty("override_reason");
    expect(payload.refunds).toEqual([]);
  });

  it("the server's outside-warranty lines bring the override reason", () => {
    const payload = buildReturnPayload(
      valid({ quantities: { "line-phone": 1 }, override_reason: " Manager's exception " }),
      { clientRequestId: CLIENT_REQUEST_ID, context: contextFor(saleEntity(), { serverOutsideIds: ["line-phone"] }) },
    );
    expect(payload.override_reason).toBe("Manager's exception");
  });
});
