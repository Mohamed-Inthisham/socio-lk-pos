# Returns and Refunds

A customer brings back some or all of what they bought, and some money may go back. Phase 6.4 P7; the decisions are in the planning doc [phase-6.4-pos-terminal.md](../frontend/phase-6.4-pos-terminal.md) section 8 "P7 decision log" (P7-1 – P7-36). Code: `backend/src/sales/sale-returns.service.ts`, `sale-returns.controller.ts`, `return-math.ts`. Related: [sales.md](./sales.md) (lock order, void), [approvals.md](./approvals.md) (the PIN), [used-phones.md](./used-phones.md) (INSPECTION).

## The model

A return is **its own record, linked to the sale** (P7-1). The sale stays COMPLETED and its money never changes; its lines only gain `returned_quantity`. A return is final: no status, no undo. Void stays for mistakes, and **a sale with a return can't be voided** (409 `SALE_HAS_RETURNS`, P7-11).

Migration `CreateSaleReturns`:

| Table / column | What | Constraints |
|---|---|---|
| `sale_lines.returned_quantity` | Units of the line that came back | `CHK_sale_lines_returned_qty` (0 … `quantity`): the backstop against an over-return under a race |
| `sale_number_counters.kind` | `SALE` (INV-) or `RETURN` (RET-) | `CHK_sale_counter_kind`; unique `UQ_sale_counter_branch_kind_date` (replaces `UQ_sale_counter_branch_date`) |
| `sale_returns` | One per return: `return_number`, `reason`, `refund_due`, `refund_total`, `out_of_warranty`, `override_reason`, `approved_by`, `requested_by`, `client_request_id` | `UQ_sale_returns_branch_number`, `UQ_sale_returns_client_request_id`, `CHK_sale_returns_reason`, `CHK_sale_returns_refund_due_nonneg`, `CHK_sale_returns_refund_total` (0 … `refund_due`), `CHK_sale_returns_override` (`override_reason` present exactly when `out_of_warranty`) |
| `sale_return_lines` | What came back from each line: `quantity`, `refund_share`, `out_of_warranty`, `disposition`, `product_unit_id` | `UQ_sale_return_lines_return_line`, `CHK_sale_return_lines_qty_positive`, `CHK_sale_return_lines_refund_share_nonneg`, `CHK_sale_return_lines_disposition`, `CHK_sale_return_lines_unit` (a unit exactly on INSPECTION lines) |
| `sale_refunds` | How the money went back: `method`, `amount`, `original_payment_id`, `reference_number` | `CHK_sale_refunds_method` (never TRADE_IN), `CHK_sale_refunds_amount_positive`, `CHK_sale_refunds_original_payment` (CASH exactly when none), `CHK_sale_refunds_reference` (non-cash needs one) |

All foreign keys are `RESTRICT` and named (`FK_sale_returns_*`, `FK_sale_return_lines_*`, `FK_sale_refunds_*`), matching the entities, so the dry-run drift is unchanged. **`down()` refuses while any `sale_returns` row or `RETURN` counter row exists** and changes nothing (P7-30).

Rules across tables are the service's, inside the return's transaction with the sale row locked: refunds add up to `refund_total`; `refund_due` is the sum of the lines' shares; a non-cash refund's payment is a non-TRADE_IN payment of this sale with the same method; refunds to one payment never exceed its amount.

## Where items go (disposition)

| Line | Disposition | Stock | `condition` |
|---|---|---|---|
| Our non-phone item, stock tracked, resaleable | `RESTOCKED` | + quantity | `RESALEABLE` (required) |
| Our non-phone item, stock tracked, damaged | `DAMAGED` | none | `DAMAGED` (required) |
| A phone from our stock | `INSPECTION` | none until it passes | refused |
| Another shop's line (`external_supplier_id`) | `NOT_OUR_STOCK` | none; the shop returns it to that shop | refused |
| A product without stock tracking | `UNTRACKED` | none | refused |

A missing or refused `condition` is 400 `RETURN_CONDITION_INVALID` with `sale_line_id` (P7-27). A returned phone goes **SOLD → INSPECTION** on the same unit row (`ProductUnitsService.markInspectionForReturn`) and is listed by `GET /sale-returns/inspection` until a manager or admin passes it (`POST /product-units/:id/inspection-pass`: IN_STOCK, stock +1). A phone taken back after the sale (a later trade-in or phone purchase) can't be returned: 409 `PHONE_TAKEN_BACK` with `imei`, `reason` (`TAKEN_BACK_ON_SALE` / `BOUGHT_BACK_ON_PURCHASE`, or null for a race the live-IMEI index caught) and `later_sale`.

## Refund arithmetic (P7-3, P7-5)

In integer cents (`return-math.ts`, BigInt). With `L` the line total, `q` its quantity, `r` already returned and `k` returned now:

```
refund_share = round_half_up(L × (r + k) / q) − round_half_up(L × r / q)
```

Every return on a line adds up to exactly `line_total`. Example: 3 × 1000.00 less 100.00 (L = 2900.00) returned one at a time gives 966.67, 966.66, 966.67; two then one gives 1933.33 and 966.67.

- **`refund_due`** is the sum of the request's shares. The refunds may total anything from 0 to `refund_due`; more is 400 `REFUND_TOO_HIGH` with `refund_due`. A lowered refund doesn't raise a later one: shares follow quantities.
- **Per payment:** a refund back to payment P may be at most `P.amount` less every earlier refund to P (409 `REFUND_EXCEEDS_PAYMENT` with `payment_id` and `refundable`). Cash has no per-payment cap, which is how a trade-in's share goes back as cash.
- **Per sale:** since every share is a share of `line_total`, all refunds on a sale never exceed its total; the transaction asserts it (a plain Error if the arithmetic ever broke).
- **Trade-in share (P7-5):** X = refund total − (non-TRADE_IN payments − earlier refunds), when positive. Not stored; the till shows it, and the `RETURN` audit description adds "includes LKR X from a trade-in" (P7-35). The trade-in phone stays with the shop.

## Warranty (P7-22, P7-23)

A line is within warranty when today in Colombo, by the **database clock**, is on or before its `warranty_until`; `NO_WARRANTY` and `CHECKING` have none and are outside from the day of sale. Outside warranty needs `override_reason` (3–500 characters): 400 `OVERRIDE_REASON_REQUIRED` with `sale_line_ids` otherwise. Checked before the PIN and again in the transaction; the transaction's verdict is stored per line and on the return. An `override_reason` sent when every line is within warranty is stored null.

## `POST /sales/:id/returns`

All roles, at the sale's branch (admins: any). Body:

```
{ client_request_id: uuid,
  lines:   [{ sale_line_id, quantity, condition?: 'RESALEABLE' | 'DAMAGED' }],
  refunds: [{ method, amount, original_payment_id?, reference_number? }],   // may be empty
  reason: string (3–500),
  override_reason?: string (3–500),
  approval: { approver_id, pin } }
→ 201 { return_id, sale }   the return was made; sale as GET /sales/:id
→ 200 { return_id, sale }   an accepted resend
```

Checked in this order (P7-34). Everything before the PIN runs without locks, so **a return that can't go through never spends a PIN attempt**:

| # | Check | Refusal |
|---|---|---|
| R1 | DTO: no lines, quantity < 1, a line twice, a bad condition value, CASH with `original_payment_id` or `reference_number` (P7-31), non-cash without both, reason or override the wrong length, no `approval` | 400 (validation) |
| R2 | Sale exists | 404 |
| R3 | `client_request_id` already used: same sale and session user → the recorded return, **200, nothing else checked, no PIN**; otherwise | 409 `CLIENT_REQUEST_ID_CONFLICT` (only `{ message, code }`) |
| R4 | Sale COMPLETED | 400 `SALE_NOT_COMPLETED` |
| R5 | Session user at the sale's branch (admins: any) | 403 `RETURN_WRONG_BRANCH` |
| — | Today's cash day at the sale's branch is open (Phase 6.4 P9-9; today, whenever the sale was made) | 409 `DAY_NOT_OPEN` / `DAY_CLOSED` + `business_date` |
| R6 | Every line is this sale's | 400 `LINE_NOT_ON_SALE` + `sale_line_id` |
| — | Condition (P7-27) | 400 `RETURN_CONDITION_INVALID` + `sale_line_id` |
| R7 | Quantity ≤ what is left | 409 `RETURN_QTY_EXCEEDED` + `sale_line_id`, `returnable` |
| R8 | Phone not taken back later | 409 `PHONE_TAKEN_BACK` + `imei`, `reason`, `later_sale` |
| R9 | Override reason when outside warranty | 400 `OVERRIDE_REASON_REQUIRED` + `sale_line_ids` |
| R10 | Refunds ≤ `refund_due` | 400 `REFUND_TOO_HIGH` + `refund_due` |
| R11 | Each refund CASH, or to a non-TRADE_IN payment of this sale with the same method | 400 `REFUND_METHOD_NOT_ALLOWED` + `method`, `original_payment_id` |
| R12 | Refunds to a payment ≤ what is left of it | 409 `REFUND_EXCEEDS_PAYMENT` + `payment_id`, `refundable` |
| — | `ApprovalsService.verify` with `action: 'SALE_RETURN'`, its own committed transaction | 403 `WRONG_PIN` / `APPROVER_*`, 423 `PIN_LOCKED` |

### The transaction

In the global lock order ([sales.md](./sales.md) "Lock order"):

1. Lock the sale row. Look up `client_request_id` again: a second send that waited on this lock sees the first one's return and is answered as R3, writing nothing.
2. R4 again. Then `lockInventoryRows`: the Stock rows of the lines going back to stock, then the returned phones. Then today's cash day `FOR SHARE` (lock-order step 4, P9-10) and the day check again: a day closed after the check before the PIN is refused here, before the re-checks, writing nothing.
3. R6 – R12 again under the locks (`returned_quantity`, a phone's later acquisition, the warranty date, the shares (P7-28), prior refunds, and stock tracking (P7-29: a `manage_stock` change meanwhile gives the same `RETURN_CONDITION_INVALID`)).
4. `returned_quantity += k` per line; stock + quantity for `RESTOCKED`; SOLD → INSPECTION for phones.
5. The `RET-YYYYMMDD-NNNN` number (`generateNext(branchId, manager, 'RETURN')`, per branch and Colombo day, no gaps on rollback; P7-10, P7-32).
6. The `sale_returns`, `sale_return_lines` and `sale_refunds` rows (refunds one at a time with `clock_timestamp()`, so they read back in the order sent), and the per-sale total check.
7. The `RETURN` audit row (P7-14): actor = the session user, entity = the sale; `changes` carry `approved_by`, `requested_by`, `refund_due`, `refund_total`, `out_of_warranty`. The description names the approver and requester, the lines and dispositions, the refund and how it went back, the trade-in share, the reason and the override. Example: "Return RET-20261023-0002 on INV-20261023-0002: approved by Nimal Manager (…); requested by Sunil Cashier (…). Lines: 1 × Galaxy A55 128GB → RESTOCKED. Refund LKR 50000.00 of LKR 50000.00 due, includes LKR 30000.00 from a trade-in (CASH 50000.00). Reason: Faulty screen". Never the PIN.

### Lost responses and resends (P7-15, P7-24)

The till makes one `client_request_id` per return dialog and resends it with every attempt. A resend from the same sale and session user gets the recorded return back with 200, without the PIN check or the day check (so also after the day is closed), so no attempt or audit row is spent twice; its body is ignored. From another sale or another user: 409, never revealing that return. Two first sends at the same moment: one 201, one 200, one return. Accepted: with a wrong PIN, two simultaneous first sends each run `verify` and count two attempts (P7-36). A clash on the unique key (the same id sent at once on another sale) is answered as R3.

## Read side (P7-18)

- **`GET /sales/:id`** (and every hydrated sale response): `lines[].returned_quantity`, and `returns[]` oldest first, each with `id`, `return_number`, `created_at`, `reason`, `override_reason`, `out_of_warranty`, `refund_due`, `refund_total`, `client_request_id`, `approver` and `requester` as **`{ id, full_name }` only**, `lines[]` (`sale_line_id`, `quantity`, `refund_share`, `out_of_warranty`, `disposition`, `product_unit` `{ id, imei }` or null) in the sale's line order, and `refunds[]` (`method`, `amount`, `reference_number`, `original_payment_id`) in the order recorded. Loaded by their own query, not joined into the lines × payments load.
- **`GET /sales`**: each row gains `return_state` (`NONE`, `PARTIAL`, `FULL` by returned units) and `refunded_total`, from one query over the page. `q` also matches `RET-` numbers (contains), finding the sale.
- **`GET /sale-returns/inspection?branchId=`** — admin, manager (own branch; another is 403 `INSPECTION_WRONG_BRANCH`; a cashier 403): the branch's INSPECTION phones, each with the latest return that brought it back, oldest first, unpaginated (P7-33): `[{ product_unit: { id, imei, product_name }, return_id, return_number, sale_id, sale_number, returned_at }]`. A phone returned, passed, sold again and returned again is listed once, with its latest return.

## Tests

`src/sales/return-math.spec.ts` (shares and the trade-in part), `src/sales/sale-returns.service.spec.ts` (the check order; every refusal before the PIN leaves `verify` uncalled), `test/returns.e2e-spec.ts` (31 tests: partial and parallel returns, shares, caps, trade-ins, dispositions, INSPECTION and a phone's second life, buy-backs, warranty overrides, no PIN spent, `client_request_id`, void refused, RET- numbering, the read side), and the returns block in `test/secret-exposure.e2e-spec.ts`. The day check: `test/cash-days-enforcement.e2e-spec.ts` ([cash-days.md](./cash-days.md#enforcement-backend-0b)).
