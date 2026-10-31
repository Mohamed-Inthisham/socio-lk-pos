# Stock Movement Ledger

Phase 1 T1. Every change to a stock row's quantity, and every change of a
product unit's status, is recorded in `stock_movements`: one append-only row,
written in the same transaction as the change.

## What a movement records

| Column | Meaning |
|---|---|
| `product_id`, `branch_id` | The stock row (one per product and branch) |
| `product_unit_id` | The IMEI/serial unit, for unit events; else null |
| `movement_type` | What happened (below) |
| `quantity_delta` | Signed change of the stock row's quantity (0 for a status-only change) |
| `quantity_before`, `quantity_after` | The row's quantity around the change |
| `stock_managed` | The row's `manage_stock` at the time |
| `unit_status_from`, `unit_status_to` | The unit's status change (`from` is null when the unit is created) |
| `reason_code`, `note` | Required reason for adjustments (`MANUAL_ADJUSTMENT` for now) |
| `reference_type`, `reference_id` | The business row it came from |
| `reverses_movement_id` | For a `REVERSAL`, the movement it undoes (null for activity before the ledger) |
| `created_by_id` | Who did it (the requester for approved events) |
| `approved_by_id` | The manager or admin whose PIN approved it (voids, returns) |
| `seq` | Insertion order |

No prices are stored.

| Type | Where | Δ | Unit | Reference | Approved |
|---|---|---|---|---|---|
| `OPENING_BALANCE` | Backfill; `POST /stock` with a starting quantity | +qty | — | `STOCK` | — |
| `PURCHASE` | Stock purchase (one row per unit, one for the rest) | +1 / +rest | → IN_STOCK | `STOCK_PURCHASE_ITEM` | — |
| `PURCHASE` | Phone purchase | +1 | → IN_STOCK | `PHONE_PURCHASE` | — |
| `TRADE_IN` | Sale completion | +1 | → IN_STOCK | `PAYMENT` | — |
| `SALE` | Sale completion | −qty | IN_STOCK → SOLD | `SALE_LINE` | — |
| `REVERSAL` | Void: sale line / trade-in | +qty / −1 | SOLD → IN_STOCK / IN_STOCK → RETURNED | `SALE_LINE` / `PAYMENT` | yes |
| `CUSTOMER_RETURN` | Return: resaleable item / phone | +qty / 0 | — / SOLD → INSPECTION | `SALE_RETURN_LINE` | yes |
| `INSPECTION_PASSED` | Inspection pass | +1 | INSPECTION → IN_STOCK | latest `SALE_RETURN_LINE` of the unit | — |
| `ADJUSTMENT_IN` / `_OUT` | `PATCH /stock/:id` quantity change | ± | — | `STOCK_ADJUSTMENT` (new id) | — |

On an untracked row (`manage_stock = false`) the quantity doesn't move: a
unit's status change is still recorded, with Δ 0 and `stock_managed = false`.
A sale's or purchase's actor is the user doing it: the ledger's actor on a
completed sale is the user who completed it, which may differ from the draft's
cashier (`sales.cashier_id`, kept on the trade-in's phone purchase).

## Guarantees

- **Same transaction.** Only `StockService` writes the ledger
  (`insertStockMovement`, `backend/src/stock/stock-movements.ts`), right after
  the change, with the quantity read under the stock row's lock. A rollback
  removes both.
- **Lock order.** A writer locks (`FOR UPDATE`) or writes the stock row before
  inserting its movement.
- **One row per event.** Partial unique indexes on (type, reference) for
  quantity rows and (type, reference, unit) for unit rows.
- **Append-only.** A trigger refuses `UPDATE` and `DELETE`, and `TRUNCATE`
  unless the transaction sets `socio.allow_ledger_truncate = 'on'` (the e2e
  reset does, with `SET LOCAL`). This guards against mistakes, not against the
  table's owner, who can disable or drop triggers.
- **History can't disappear.** Foreign keys to products, branches, units and
  users are `RESTRICT`.

## Stale adjustments

`PATCH /stock/:id` runs in one transaction holding the row `FOR UPDATE`. A
client sends `expected_quantity` with a changed `quantity`: the quantity it
showed the user. If the stock changed meanwhile, the answer is
`409 { code: 'STOCK_QUANTITY_CHANGED', stock_id, expected_quantity,
current_quantity }` and nothing is written. Changing only `min_quantity` or
`manage_stock` records no movement.

## Opening balances and deployment

Migration `1793600000000-BackfillStockOpeningBalances` writes one
`OPENING_BALANCE` per existing stock row (its current quantity, zero and
untracked rows included) through `backfill_stock_opening_balances()`, and
marks completion in `stock_ledger_backfill` (one immutable row). Once the
marker exists the function returns 0: rows created after go-live begin their
chain at 0.

The function refuses, and nothing is written, when an existing opening doesn't
belong to its stock row, an opening comes after another movement of its row, or
a row has movements without an opening. Before the marker it checks there is
exactly one valid opening per stock row.

It stays in the database for safe re-runs. **Only an authorized database
operator should execute it, with every backend instance stopped.** Execution is
revoked from `PUBLIC`. It takes `EXCLUSIVE` on `stock` then `SHARE ROW
EXCLUSIVE` on `stock_movements` (plain reads continue), with a lock wait
of `lock_wait` (default 30 s, at least 1 ms).

**Deploy:**

1. Stop **all** backend instances. An old backend writes no ledger rows.
2. `npm run migration:run`.
3. Start the new backend straight away.
4. Run the reconciliation below. Investigate any problem; correct nothing
   automatically.

Rolling back (`migration:revert`) is refused once any movement other than an
opening balance exists.

## Reconciliation

Read-only. `backend/test/stock-ledger.helper.ts` runs these queries in the e2e
tests. Problems:

```sql
-- 1. Unanchored: a row's first movement must start at 0 (its opening balance,
--    or any movement for a row created after go-live).
SELECT s.id AS stock_id, f.movement_type, f.quantity_before
  FROM stock s
  JOIN LATERAL (SELECT m.* FROM stock_movements m
                 WHERE m.product_id = s.product_id AND m.branch_id = s.branch_id
                 ORDER BY m.seq LIMIT 1) f ON true
 WHERE f.quantity_before <> 0
    OR (f.movement_type = 'OPENING_BALANCE'
        AND NOT (f.reference_type = 'STOCK' AND f.reference_id = s.id));

-- 2. Chain breaks: each movement starts where the previous one ended.
SELECT x.id, x.product_id, x.branch_id, x.quantity_before, x.previous_after
  FROM (SELECT m.*, LAG(m.quantity_after) OVER (
               PARTITION BY m.product_id, m.branch_id ORDER BY m.seq) AS previous_after
          FROM stock_movements m) x
 WHERE x.previous_after IS NOT NULL AND x.quantity_before <> x.previous_after;

-- 3. Quantity: the ledger adds up to the stock row, and ends on it.
SELECT s.id, s.quantity, t.sum_delta, t.last_after
  FROM stock s
  JOIN (SELECT product_id, branch_id, SUM(quantity_delta) AS sum_delta,
               (array_agg(quantity_after ORDER BY seq DESC))[1] AS last_after
          FROM stock_movements GROUP BY product_id, branch_id) t
    ON t.product_id = s.product_id AND t.branch_id = s.branch_id
 WHERE t.sum_delta <> s.quantity OR t.last_after <> s.quantity;

-- 4. Quantity with no history at all (a change made outside the ledger).
SELECT s.id, s.quantity FROM stock s
 WHERE s.quantity <> 0
   AND NOT EXISTS (SELECT 1 FROM stock_movements m
                    WHERE m.product_id = s.product_id AND m.branch_id = s.branch_id);

-- 5. Units on tracked rows: IMEI quantity = IN_STOCK units; serial quantity
--    >= IN_STOCK units (the rest has no serial number).
SELECT s.id, p.tracking_method, s.quantity,
       (SELECT count(*) FROM product_units u
         WHERE u.product_id = s.product_id AND u.branch_id = s.branch_id
           AND u.status = 'IN_STOCK') AS in_stock_units
  FROM stock s JOIN products p ON p.id = s.product_id
 WHERE s.manage_stock AND p.tracking_method IN ('IMEI', 'SERIAL_NUMBER');

-- 6. Completion marker: present, and its counts equal.
SELECT completed_at, stock_rows, opening_rows FROM stock_ledger_backfill;
```

Reported for information, not as problems: each serial row's untracked quantity
(query 5), untracked rows still holding `IN_STOCK` units, unit events with
`stock_managed = false`, and rows with no history at quantity 0.

Mismatches between stock and units that existed before the ledger are carried
into the opening balances as they were and show up here; they are investigated
and corrected through adjustments, never automatically.
