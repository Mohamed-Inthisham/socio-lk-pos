import { z } from "zod";
import { formatLKR, fromCents, toCents } from "../utils/money";
import {
  lineDisposition,
  refundDueCents,
  returnableQuantity,
  saleRefundContext,
  selectionOutsideWarranty,
} from "../utils/returnMath";
import { CASH } from "./paymentSchema";

/**
 * Return Schema (Zod)
 *
 * Client-side validation for the POS ReturnDialog (planning doc P7-3,
 * P7-4, P7-8, P7-20, P7-23). Mirrors the backend CreateSaleReturnDto and
 * the SaleReturnsService checks (docs/backend/returns.md R1–R12); the
 * server stays authoritative.
 *
 * - Items: quantities per sale line, at least one, each 0 … what is left
 *   to return. A line whose disposition the server decides
 *   (lineDisposition: another shop's, a phone, untracked) takes no
 *   condition; the others need RESALEABLE (back to stock) or DAMAGED.
 * - Reason: one of five presets (keys 1–5) plus a detail, required for
 *   Other and whenever the refund is lower than the refund due (P7-3:
 *   the reason says why). Sent as one `reason`: "Faulty item — <detail>",
 *   the preset alone, or the detail alone for Other; 3–500 characters.
 * - Override reason (P7-23): 3–500 characters, required and sent only
 *   when a selected line is outside warranty (by the till's Colombo date,
 *   or the server's `sale_line_ids` after OVERRIDE_REASON_REQUIRED).
 * - Refunds (P7-4): at most one CASH row and one row per non-cash payment
 *   of this sale. CASH has no payment or reference; non-cash goes back to
 *   its payment, same method, with the reversal's reference (1–100). Each
 *   payment takes no more than is left of it; the total no more than the
 *   refund due. Amounts in integer cents. A cash row left empty or at 0
 *   is no cash (the refund is lower), never sent. The rows start as
 *   defaultRefundRows: the way the sale was paid.
 * - Approval: an approver and their 6-digit PIN, never stored (P6-20).
 *
 * The client_request_id is not a form value: the dialog makes it when it
 * opens and passes it to buildReturnPayload (P7-15).
 */

export const OTHER = "OTHER";
export const RETURN_REASON_MAX = 500;
const REASON_MIN = 3;
const REFERENCE_MAX = 100;

export const RETURN_REASONS = [
  { key: "1", value: "FAULTY", label: "Faulty item" },
  { key: "2", value: "WRONG_ITEM", label: "Wrong item or doesn't fit" },
  { key: "3", value: "CHANGED_MIND", label: "Changed their mind" },
  { key: "4", value: "NOT_AS_DESCRIBED", label: "Not as described" },
  { key: "5", value: OTHER, label: "Other" },
];

export const RETURN_CONDITIONS = [
  { value: "RESALEABLE", label: "Back to stock" },
  { value: "DAMAGED", label: "Damaged" },
];

export const LOWER_REFUND_MESSAGE = "Say why the refund is lower.";

const MONEY_SHAPE = /^\d+(\.\d{1,2})?$/;
const PIN_SHAPE = /^\d{6}$/;

const labelOf = (preset) => RETURN_REASONS.find((r) => r.value === preset)?.label ?? "";

/** A typed amount in cents, or NaN when it isn't one ("1500", "1499.8", "1499.80"). */
export const amountCents = (value) => {
  const text = String(value ?? "").trim();
  return MONEY_SHAPE.test(text) ? toCents(text) : NaN;
};

/** The sum of the refund rows' valid amounts, in cents. */
export const refundTotalCents = (refunds) =>
  refunds.reduce((sum, row) => {
    const cents = amountCents(row.amount);
    return Number.isNaN(cents) ? sum : sum + cents;
  }, 0);

/** A cash row left empty or at 0: no cash refund (not an error, not sent). */
const isNoCash = (row) =>
  row.method === CASH && (String(row.amount ?? "").trim() === "" || amountCents(row.amount) === 0);

/**
 * The refund rows a return starts with: they mirror how the sale was
 * paid. This sale's card / bank / Koko / Mintpay payments first, in the
 * order paid, each up to what is left of it; whatever remains (cash
 * paid, a trade-in's share) in one Cash row. A card-only sale therefore
 * starts with its card row for the whole refund due.
 *
 * @param {ReturnType<typeof returnContext>} context
 * @param {number} dueCents - the refund due
 * @returns {Array<{ method, payment_id, reference, amount }>}
 */
export const defaultRefundRows = (context, dueCents) => {
  const rows = [];
  let left = dueCents;
  for (const payment of context.payments) {
    if (left <= 0) break;
    const take = Math.min(payment.refundableCents, left);
    if (take <= 0) continue;
    rows.push({ method: payment.method, payment_id: payment.id, reference: "", amount: fromCents(take) });
    left -= take;
  }
  if (left > 0) rows.push({ method: CASH, payment_id: "", reference: "", amount: fromCents(left) });
  return rows;
};

/**
 * The `reason` sent for a preset and detail: "Faulty item — <detail>",
 * the preset alone without a detail, the detail alone for Other.
 */
export const buildReturnReason = ({ reason_preset, reason_detail }) => {
  const detail = String(reason_detail ?? "").trim();
  if (reason_preset === OTHER) return detail;
  const label = labelOf(reason_preset);
  return detail ? `${label} — ${detail}` : label;
};

/**
 * What the schema and the payload builder need to know about the sale.
 *
 * @param {Object} sale - GET /sales/:id, with lines[].returned_quantity, payments, returns[]
 * @param {Object} opts
 * @param {Record<string, boolean>} opts.stockTracked - { [product_id]: manage_stock } at
 *   the sale's branch (GET /stock?branchId=); a product missing from it
 *   counts as tracked, as every product has a stock row
 * @param {string[]} [opts.serverOutsideIds] - sale_line_ids from OVERRIDE_REASON_REQUIRED
 * @param {string} [opts.today] - "YYYY-MM-DD" in Colombo
 */
export const returnContext = (sale, { stockTracked = {}, serverOutsideIds = [], today } = {}) => {
  const tracked = (line) => stockTracked[line.product_id] !== false;
  return {
    sale,
    needsCondition: (line) => lineDisposition(line, { stockTracked: tracked(line) }) === null,
    outsideIds: (quantities) => [
      ...new Set([
        ...selectionOutsideWarranty(sale, quantities, today),
        ...serverOutsideIds.filter((id) => (quantities[id] ?? 0) > 0),
      ]),
    ],
    refundDueCents: (quantities) => refundDueCents(sale, quantities),
    payments: saleRefundContext(sale).payments,
  };
};

/**
 * The items step's checks (P7-2, P7-8): at least one item, each no more
 * than is left of its line, a condition where the cashier picks one.
 * Next on the items step runs these alone; buildReturnSchema runs them
 * with refundIssues.
 *
 * @param {Object} values - the form's values
 * @param {ReturnType<typeof returnContext>} context
 * @returns {Array<{ path: (string|number)[], message: string }>}
 */
export const itemsIssues = (values, context) => {
  const issues = [];
  const add = (path, message) => issues.push({ path, message });
  const { sale } = context;
  const { quantities } = values;

  const selected = sale.lines.filter((line) => (quantities[line.id] ?? 0) > 0);
  if (selected.length === 0) add(["quantities"], "Pick at least one item to return");
  for (const line of selected) {
    const left = returnableQuantity(line);
    if (quantities[line.id] > left) {
      add(["quantities", line.id], left === 0 ? "Already returned" : `At most ${left}`);
    }
    const condition = values.conditions[line.id] ?? "";
    if (context.needsCondition(line)) {
      if (!RETURN_CONDITIONS.some((c) => c.value === condition)) {
        add(["conditions", line.id], "Back to stock or damaged?");
      }
    }
  }
  for (const id of Object.keys(quantities)) {
    if (quantities[id] > 0 && !sale.lines.some((line) => line.id === id)) {
      add(["quantities", id], "Not on this sale");
    }
  }
  return issues;
};

/**
 * The refund step's checks (P7-3, P7-4, P7-23): the refund rows, the
 * reason and the override reason. The approver and PIN are the schema's.
 *
 * @param {Object} values - the form's values
 * @param {ReturnType<typeof returnContext>} context
 * @returns {Array<{ path: (string|number)[], message: string }>}
 */
export const refundIssues = (values, context) => {
  const issues = [];
  const add = (path, message) => issues.push({ path, message });
  const { payments } = context;
  const { quantities } = values;

  // Refunds
  const dueCents = context.refundDueCents(quantities);
  let totalCents = 0;
  const perPayment = new Map();
  let cashRows = 0;
  values.refunds.forEach((row, i) => {
    const cents = amountCents(row.amount);
    if (isNoCash(row)) {
      // An empty or 0 cash amount is no cash: the total is lower, not wrong.
    } else if (Number.isNaN(cents)) {
      add(["refunds", i, "amount"], "Enter an amount like 1500 or 1499.80");
    } else if (cents <= 0) {
      add(["refunds", i, "amount"], "Amount must be more than 0");
    } else {
      totalCents += cents;
    }

    if (row.method === CASH) {
      cashRows += 1;
      if (cashRows > 1) add(["refunds", i, "method"], "Cash is already on another row");
      if (row.payment_id || row.reference.trim()) {
        add(["refunds", i, "method"], "A cash refund has no payment or reference");
      }
      return;
    }

    const payment = payments.find((p) => p.id === row.payment_id);
    if (!payment || payment.method !== row.method) {
      add(["refunds", i, "payment_id"], "Pick a card, bank, Koko or Mintpay payment of this sale");
      return;
    }
    if (perPayment.has(payment.id)) {
      add(["refunds", i, "payment_id"], "This payment is already on another row");
      return;
    }
    perPayment.set(payment.id, true);
    const reference = row.reference.trim();
    if (reference.length === 0) {
      add(["refunds", i, "reference"], "Enter the reversal's reference");
    } else if (reference.length > REFERENCE_MAX) {
      add(["refunds", i, "reference"], `At most ${REFERENCE_MAX} characters`);
    }
    if (!Number.isNaN(cents) && cents > payment.refundableCents) {
      add(["refunds", i, "amount"], `At most ${formatLKR(fromCents(payment.refundableCents))} can go back to this payment`);
    }
  });
  if (totalCents > dueCents) {
    add(["refunds"], `The refund can be at most ${formatLKR(fromCents(dueCents))}`);
  }

  // Reason
  const detail = values.reason_detail.trim();
  if (values.reason_preset === OTHER && detail.length < REASON_MIN) {
    add(["reason_detail"], "Say what happened (at least 3 characters)");
  } else if (totalCents < dueCents && detail.length < REASON_MIN) {
    add(["reason_detail"], LOWER_REFUND_MESSAGE);
  } else {
    const length = buildReturnReason(values).length;
    if (length > RETURN_REASON_MAX) {
      add(["reason_detail"], `The reason must be ${RETURN_REASON_MAX} characters or fewer (now ${length})`);
    }
  }

  // Override reason (P7-23)
  if (context.outsideIds(quantities).length > 0) {
    const override = values.override_reason.trim();
    if (override.length < REASON_MIN) {
      add(["override_reason"], "Outside warranty: give the override reason (at least 3 characters)");
    } else if (override.length > RETURN_REASON_MAX) {
      add(["override_reason"], `At most ${RETURN_REASON_MAX} characters (now ${override.length})`);
    }
  }
  return issues;
};

/**
 * The schema for one sale. Rebuild it when the context changes (a re-read
 * sale, the server's outside-warranty lines).
 *
 * @param {ReturnType<typeof returnContext>} context
 */
export const buildReturnSchema = (context) =>
  z
    .object({
      quantities: z.record(z.string(), z.number().int().min(0)),
      conditions: z.record(z.string(), z.string()),
      reason_preset: z.enum(
        RETURN_REASONS.map((r) => r.value),
        { error: "Pick a reason" },
      ),
      reason_detail: z.string(),
      override_reason: z.string(),
      refunds: z.array(
        z.object({
          method: z.string(),
          payment_id: z.string(),
          reference: z.string(),
          amount: z.string(),
        }),
      ),
      approver_id: z.string().min(1, "Pick who approves"),
      pin: z.string().regex(PIN_SHAPE, "PIN must be 6 digits"),
    })
    .superRefine((values, ctx) => {
      for (const { path, message } of [...itemsIssues(values, context), ...refundIssues(values, context)]) {
        ctx.addIssue({ code: "custom", path, message });
      }
    });

/**
 * Fresh form values for a sale: every line at 0, no conditions, no
 * refund rows. `approverId`: the session's manager or admin when they're
 * on the approver list, "" otherwise (P6-20).
 */
export const returnFormDefaults = (sale, { approverId = "" } = {}) => ({
  quantities: Object.fromEntries(sale.lines.map((line) => [line.id, 0])),
  conditions: Object.fromEntries(sale.lines.map((line) => [line.id, ""])),
  reason_preset: "",
  reason_detail: "",
  override_reason: "",
  refunds: [],
  approver_id: approverId,
  pin: "",
});

/**
 * Validated form values → POST /sales/:id/returns body, exactly the
 * server's CreateSaleReturnDto: lines with a quantity only, `condition`
 * only where the cashier picks it, refunds as numbers from cents (CASH
 * with method and amount only), `override_reason` only when outside
 * warranty.
 *
 * @param {Object} values - the form's values
 * @param {{ clientRequestId: string, context: ReturnType<typeof returnContext> }} opts
 */
export const buildReturnPayload = (values, { clientRequestId, context }) => {
  const { sale } = context;
  const lines = sale.lines
    .filter((line) => (values.quantities[line.id] ?? 0) > 0)
    .map((line) => ({
      sale_line_id: line.id,
      quantity: values.quantities[line.id],
      ...(context.needsCondition(line) ? { condition: values.conditions[line.id] } : {}),
    }));

  const refunds = values.refunds.filter((row) => !isNoCash(row)).map((row) => {
    const amount = Number(fromCents(amountCents(row.amount)));
    return row.method === CASH
      ? { method: CASH, amount }
      : {
          method: row.method,
          amount,
          original_payment_id: row.payment_id,
          reference_number: row.reference.trim(),
        };
  });

  const outside = context.outsideIds(values.quantities).length > 0;
  return {
    client_request_id: clientRequestId,
    lines,
    refunds,
    reason: buildReturnReason(values),
    ...(outside ? { override_reason: values.override_reason.trim() } : {}),
    approval: { approver_id: values.approver_id, pin: values.pin },
  };
};
